import React from './runtime';
import type {
  AntigravityStatusPayload,
  ApiEnvelope,
  CatalogModelOption,
  DoctorReport,
  SwitchReason,
} from '../shared/types';
import enLocale from '../../locale/en.json';
import zhLocale from '../../locale/zh-CN.json';

type Dict = Record<string, string>;

function readLocaleCode(ctx: any): string {
  try {
    const snapActive = ctx?.locale?.getSnapshot?.()?.active;
    if (typeof snapActive === 'string' && snapActive.length > 0) {
      return snapActive;
    }
    if (typeof ctx?.locale?.current === 'string' && ctx.locale.current.length > 0) {
      return ctx.locale.current;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      return navigator.language;
    }
  } catch {
    // Fallback below.
  }
  return 'en';
}

function pickLocaleTable(lang: string): Dict {
  if (/^zh/i.test(lang)) {
    return zhLocale.antigravity as Dict;
  }
  return enLocale.antigravity as Dict;
}

function createTranslator(lang: string) {
  const table = pickLocaleTable(lang);
  return (key: string, params?: Record<string, string | number>): string => {
    let text = table[key] ?? (enLocale.antigravity as Dict)[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return text;
  };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !json.ok || json.value === undefined) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json.value;
}

function reasonLabel(reason: SwitchReason, t: (k: string) => string): string {
  switch (reason) {
    case 'manual':
      return t('switchReasonManual');
    case 'quota':
      return t('switchReasonQuota');
    case 'streak':
      return t('switchReasonStreak');
    default:
      return t('switchReasonUnavailable');
  }
}

function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function formatTime(ms?: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return String(ms);
  }
}

function formatResetCountdown(iso?: string): string {
  if (!iso) return '';
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return iso;
  const diffMs = target - Date.now();
  if (diffMs <= 0) return '0m';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

export function AntigravitySettingsPanel({ ctx }: { ctx: any }) {
  const [localeCode, setLocaleCode] = React.useState<string>(() => readLocaleCode(ctx));
  React.useEffect(() => {
    setLocaleCode(readLocaleCode(ctx));
    const sub = ctx?.locale?.subscribe;
    if (typeof sub !== 'function') return undefined;
    try {
      const off = sub.call(ctx.locale, () => {
        setLocaleCode(readLocaleCode(ctx));
      });
      return typeof off === 'function' ? off : undefined;
    } catch {
      return undefined;
    }
  }, [ctx]);
  const t = React.useMemo(() => createTranslator(localeCode), [localeCode]);

  const [status, setStatus] = React.useState<AntigravityStatusPayload | undefined>(undefined);
  const [doctor, setDoctor] = React.useState<DoctorReport | undefined>(undefined);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [doctorBusy, setDoctorBusy] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [manualInput, setManualInput] = React.useState<string>('');
  const [copiedUrl, setCopiedUrl] = React.useState<boolean>(false);

  const loadStatus = React.useCallback(async () => {
    try {
      const value = await apiFetch<AntigravityStatusPayload>('/antigravity/api/status');
      setStatus(value);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    if (status?.login?.state !== 'pending') return;
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [status?.login?.state, loadStatus]);

  const runAction = async (fn: () => Promise<AntigravityStatusPayload>) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await fn();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleBeginLogin = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const loginState = await apiFetch<AntigravityStatusPayload['login']>(
        '/antigravity/api/login',
        { method: 'POST', body: '{}' },
      );
      if (loginState.authUrl) {
        try {
          window.open(loginState.authUrl, '_blank', 'noopener,noreferrer');
        } catch {
          // Popup blockers allow manual click or copy fallback below.
        }
      }
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitManual = async () => {
    if (!manualInput.trim()) return;
    await runAction(async () => {
      const next = await apiFetch<AntigravityStatusPayload>(
        '/antigravity/api/login/manual',
        { method: 'POST', body: JSON.stringify({ input: manualInput.trim() }) },
      );
      setManualInput('');
      return next;
    });
  };

  const handleRunDoctor = async () => {
    setDoctorBusy(true);
    setError(undefined);
    try {
      const report = await apiFetch<DoctorReport>('/antigravity/api/doctor', {
        method: 'POST',
        body: '{}',
      });
      setDoctor(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDoctorBusy(false);
    }
  };

  const handleToggleModel = async (opt: CatalogModelOption) => {
    if (!status) return;
    const current = new Set(status.models.enabledModelIds);
    if (current.has(opt.id)) current.delete(opt.id);
    else current.add(opt.id);
    await runAction(() =>
      apiFetch<AntigravityStatusPayload>('/antigravity/api/models', {
        method: 'POST',
        body: JSON.stringify({ enabledModelIds: [...current] }),
      }),
    );
  };

  const handleSelectAllModels = async (all: boolean) => {
    if (!status) return;
    const nextIds = all
      ? status.models.options.map((m) => m.id)
      : status.models.options.filter((m) => m.defaultEnabled).map((m) => m.id);
    await runAction(() =>
      apiFetch<AntigravityStatusPayload>('/antigravity/api/models', {
        method: 'POST',
        body: JSON.stringify({ enabledModelIds: nextIds }),
      }),
    );
  };

  const copyAuthUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignore clipboard denials.
    }
  };

  if (loading && !status) {
    return <div className="dsha-root">Loading Antigravity...</div>;
  }

  const login = status?.login;
  const accounts = status?.accounts ?? [];
  const quota = status?.quota;
  const telemetry = status?.telemetry;
  const coldNotice = status?.coldNotice;

  return (
    <div className="dsha-root">
      {/* 1. Explicit Unofficial Channel Attribution Notice */}
      <div className="dsha-banner">
        <div>
          <div className="dsha-banner-title">{t('channelNoticeTitle')}</div>
          <div className="dsha-banner-desc">{t('channelNoticeBody')}</div>
        </div>
      </div>

      {/* 2. Cold-Cache Rebuilt Warning Banner */}
      {coldNotice && (
        <div className="dsha-banner dsha-banner-warn">
          <div>
            <div className="dsha-banner-title">{t('cacheColdTitle')}</div>
            <div className="dsha-banner-desc">
              {t('cacheColdDesc', {
                time: formatTime(coldNotice.at),
                reason: reasonLabel(coldNotice.reason, t),
                account: coldNotice.toEmail,
              })}
            </div>
          </div>
          <button
            type="button"
            className="dsha-btn"
            disabled={busy}
            onClick={() =>
              runAction(() =>
                apiFetch<AntigravityStatusPayload>('/antigravity/api/dismiss-cold-notice', {
                  method: 'POST',
                  body: '{}',
                }),
              )
            }
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {error && <div className="dsha-banner-error">{error}</div>}

      {/* 3. Multi-Account & Sticky Routing Card */}
      <section className="dsha-card">
        <div className="dsha-card-head">
          <div>
            <div className="dsha-card-title">{t('accountsTitle')}</div>
            <div className="dsha-card-desc">{t('accountsDesc')}</div>
          </div>
          <div className="dsha-actions">
            {login?.state === 'pending' ? (
              <button
                type="button"
                className="dsha-btn"
                disabled={busy}
                onClick={() =>
                  runAction(() =>
                    apiFetch<AntigravityStatusPayload>('/antigravity/api/login/cancel', {
                      method: 'POST',
                      body: '{}',
                    }),
                  )
                }
              >
                {t('cancelLogin')}
              </button>
            ) : (
              <button
                type="button"
                className="dsha-btn dsha-btn-primary"
                disabled={busy}
                onClick={handleBeginLogin}
              >
                {t('addAccount')}
              </button>
            )}
          </div>
        </div>

        {login?.state === 'pending' && login.authUrl && (
          <div className="dsha-oauth-box">
            <div className="dsha-actions">
              <a
                href={login.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="dsha-btn dsha-btn-primary"
              >
                {t('openAuthUrl')}
              </a>
              <button
                type="button"
                className="dsha-btn"
                onClick={() => copyAuthUrl(login.authUrl!)}
              >
                {copiedUrl ? t('copied') : t('copyAuthUrl')}
              </button>
            </div>
            <div className="dsha-oauth-link">{login.authUrl}</div>
            <div className="dsha-note">{t('manualCallback')}</div>
            <div className="dsha-input-row">
              <input
                type="text"
                className="dsha-input"
                value={manualInput}
                placeholder={t('manualCallbackPlaceholder')}
                onChange={(e) => setManualInput(e.target.value)}
              />
              <button
                type="button"
                className="dsha-btn"
                disabled={busy || !manualInput.trim()}
                onClick={handleSubmitManual}
              >
                {t('submitCode')}
              </button>
            </div>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="dsha-note">{t('noAccounts')}</div>
        ) : (
          <div className="dsha-list">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className={`dsha-row ${acc.isActive ? 'dsha-row-active' : ''}`}
              >
                <div className="dsha-row-main">
                  <div className="dsha-row-title">
                    <span>{acc.email}</span>
                    {acc.isActive && (
                      <span className="dsha-badge dsha-badge-green">{t('active')}</span>
                    )}
                    {acc.tierLabel && <span className="dsha-badge">{acc.tierLabel}</span>}
                    {acc.needsReauth && (
                      <span className="dsha-badge dsha-badge-red">{t('needsReauth')}</span>
                    )}
                    {acc.cooldownUntil && (
                      <span className="dsha-badge dsha-badge-warn">{t('cooldown')}</span>
                    )}
                    {acc.lowestQuotaFraction !== undefined && (
                      <span
                        className={`dsha-badge ${
                          acc.lowestQuotaFraction <= 0.05
                            ? 'dsha-badge-red'
                            : acc.lowestQuotaFraction < 0.15
                              ? 'dsha-badge-warn'
                              : ''
                        }`}
                      >
                        {formatPct(acc.lowestQuotaFraction)}
                      </span>
                    )}
                  </div>
                  <div className="dsha-row-sub">
                    {acc.projectId ? `project: ${acc.projectId}` : 'project pending'}
                    {acc.lastError ? ` · ${acc.lastError}` : ''}
                  </div>
                </div>
                <div className="dsha-actions">
                  {!acc.isActive && (
                    <button
                      type="button"
                      className="dsha-btn"
                      disabled={busy}
                      onClick={() =>
                        runAction(() =>
                          apiFetch<AntigravityStatusPayload>('/antigravity/api/accounts/switch', {
                            method: 'POST',
                            body: JSON.stringify({ accountId: acc.id }),
                          }),
                        )
                      }
                    >
                      {t('switchAccount')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="dsha-btn dsha-btn-danger"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        apiFetch<AntigravityStatusPayload>('/antigravity/api/accounts/remove', {
                          method: 'POST',
                          body: JSON.stringify({ accountId: acc.id }),
                        }),
                      )
                    }
                  >
                    {t('removeAccount')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Quota & Doctor Card */}
      <section className="dsha-card">
        <div className="dsha-card-head">
          <div>
            <div className="dsha-card-title">{t('quotaTitle')}</div>
            <div className="dsha-card-desc">{t('quotaDesc')}</div>
          </div>
          <div className="dsha-actions">
            <button
              type="button"
              className="dsha-btn"
              disabled={busy || accounts.length === 0}
              onClick={() =>
                runAction(() =>
                  apiFetch<AntigravityStatusPayload>('/antigravity/api/quota', {
                    method: 'POST',
                    body: '{}',
                  }),
                )
              }
            >
              {t('refreshQuota')}
            </button>
            <button
              type="button"
              className="dsha-btn"
              disabled={doctorBusy || accounts.length === 0}
              onClick={handleRunDoctor}
            >
              {doctorBusy ? t('runningDoctor') : t('runDoctor')}
            </button>
          </div>
        </div>

        {quota?.degraded && quota.error && (
          <div className="dsha-banner dsha-banner-warn">
            <div className="dsha-banner-desc">
              {t('quotaDegraded', { error: quota.error })}
            </div>
          </div>
        )}

        {quota && quota.groups.length > 0 && (
          <div className="dsha-list">
            {quota.groups.map((grp) => {
              const pct = Math.max(0, Math.min(100, Math.round(grp.remainingFraction * 100)));
              return (
                <div key={grp.id} className="dsha-quota-item">
                  <div className="dsha-quota-head">
                    <div className="dsha-row-title">
                      <span>{grp.label}</span>
                      {grp.isExhausted ? (
                        <span className="dsha-badge dsha-badge-red">
                          {t('exhaustedBadge')}
                        </span>
                      ) : grp.isLow ? (
                        <span className="dsha-badge dsha-badge-warn">
                          {t('lowWarning')}
                        </span>
                      ) : null}
                    </div>
                    <div className="dsha-row-sub" title={grp.resetTime ?? ''}>
                      <strong>{pct}%</strong>
                      {grp.resetTime
                        ? ` · ${t('resetsAt', { time: formatResetCountdown(grp.resetTime) })}`
                        : ''}
                    </div>
                  </div>
                  <div className="dsha-bar-track">
                    <div
                      className={`dsha-bar-fill ${
                        grp.windowType === 'weekly' ||
                        /week|每周|周限|7d/i.test(grp.label)
                          ? 'is-weekly'
                          : 'is-daily'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {quota && (
          <div className="dsha-note">
            {t('updatedAt', { time: formatTime(quota.fetchedAt) })}
          </div>
        )}

        {doctor && (
          <div className="dsha-oauth-box">
            <div className="dsha-banner-title">{t('doctorTitle')}</div>
            <div className="dsha-note">{doctor.userAgent}</div>
            {doctor.checks.map((chk) => (
              <div key={chk.name} className="dsha-row-sub">
                <span
                  className={`dsha-badge ${chk.ok ? 'dsha-badge-green' : 'dsha-badge-red'}`}
                >
                  {chk.ok ? 'PASS' : 'FAIL'}
                </span>{' '}
                <strong>{chk.name}</strong>: {chk.detail}
                {chk.latencyMs !== undefined ? ` (${chk.latencyMs}ms)` : ''}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Recent Cache & Token Telemetry Card */}
      <section className="dsha-card">
        <div className="dsha-card-head">
          <div>
            <div className="dsha-card-title">{t('statsTitle')}</div>
            <div className="dsha-card-desc">{t('statsDesc')}</div>
          </div>
        </div>

        {!telemetry || telemetry.turnCount === 0 ? (
          <div className="dsha-note">{t('noTelemetry')}</div>
        ) : (
          <div className="dsha-metrics-grid">
            <div className="dsha-metric">
              <div className="dsha-metric-val">
                {formatPct(telemetry.aggregateCacheHitRate)}
              </div>
              <div className="dsha-metric-key">{t('hitRateLabel')}</div>
            </div>
            <div className="dsha-metric">
              <div className="dsha-metric-val">{telemetry.turnCount}</div>
              <div className="dsha-metric-key">{t('turnsLabel')}</div>
            </div>
            <div className="dsha-metric">
              <div className="dsha-metric-val">
                {telemetry.totalCacheReadTokens.toLocaleString()}
              </div>
              <div className="dsha-metric-key">{t('cacheReadLabel')}</div>
            </div>
            <div className="dsha-metric">
              <div className="dsha-metric-val">
                {telemetry.totalUncachedInputTokens.toLocaleString()}
              </div>
              <div className="dsha-metric-key">{t('uncachedInputLabel')}</div>
            </div>
            <div className="dsha-metric">
              <div className="dsha-metric-val">
                {telemetry.totalOutputTokens.toLocaleString()}
              </div>
              <div className="dsha-metric-key">{t('outputLabel')}</div>
            </div>
          </div>
        )}
      </section>

      {/* 6. Model Visibility Selector */}
      {status && status.models.options.length > 0 && (
        <section className="dsha-card">
          <div className="dsha-card-head">
            <div>
              <div className="dsha-card-title">{t('modelsTitle')}</div>
              <div className="dsha-card-desc">{t('modelsDesc')}</div>
            </div>
            <div className="dsha-actions">
              <button
                type="button"
                className="dsha-btn"
                disabled={busy}
                onClick={() => handleSelectAllModels(true)}
              >
                {t('selectAll')}
              </button>
              <button
                type="button"
                className="dsha-btn"
                disabled={busy}
                onClick={() => handleSelectAllModels(false)}
              >
                {t('resetDefaults')}
              </button>
            </div>
          </div>

          <div className="dsha-list">
            {status.models.options.map((opt) => (
              <label key={opt.id} className="dsha-model-row">
                <div className="dsha-model-left">
                  <input
                    type="checkbox"
                    checked={opt.enabled}
                    disabled={busy}
                    onChange={() => handleToggleModel(opt)}
                  />
                  <div>
                    <div className="dsha-row-title">
                      <span>{opt.name}</span>
                      <span className="dsha-badge">{opt.id}</span>
                      {opt.tierAccess === 'ultra' ? (
                        <span className="dsha-badge dsha-badge-ultra">Ultra</span>
                      ) : opt.tierAccess === 'pro' ? (
                        <span className="dsha-badge dsha-badge-pro">Pro</span>
                      ) : null}
                      {opt.remainingFraction !== undefined && (
                        <span
                          className={`dsha-badge ${
                            opt.remainingFraction <= 0.05
                              ? 'dsha-badge-red'
                              : opt.remainingFraction < 0.15
                                ? 'dsha-badge-warn'
                                : 'dsha-badge-green'
                          }`}
                        >
                          {formatPct(opt.remainingFraction)}
                        </span>
                      )}
                    </div>
                    <div className="dsha-row-sub">
                      {opt.description} ·{' '}
                      {t('contextLabel', {
                        tokens: `${Math.round(opt.contextWindow / 1024)}K`,
                      })}
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

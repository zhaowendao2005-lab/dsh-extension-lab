import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  AccountPublicSummary,
  QuotaGroupSummary,
  QuotaSnapshotSummary,
  SwitchEventRecord,
  SwitchReason,
} from '../shared/types.ts';
import type { StickyFailureCategory } from './client.ts';
import type { AntigravityPluginConfig } from './config.ts';
import {
  refreshGoogleAccessToken,
  type OAuthCredentialsResult,
} from './oauth.ts';
import {
  readJsonFile,
  resolveAntigravityStorageDir,
  resolveLegacyCredentialCandidates,
  writePrivateJsonFile,
} from './storage.ts';

export interface AccountRecord {
  id: string;
  email: string;
  name?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  projectId?: string;
  tierLabel?: string;
  tierId?: string;
  needsReauth: boolean;
  lastError?: string;
  cooldownUntil?: number;
  addedAt: number;
  lastUsedAt?: number;
}

interface StoredAccountsState {
  version: 1;
  activeAccountId?: string;
  accounts: AccountRecord[];
}

interface SessionStickyState {
  accountId: string;
  failureStreak: number;
  lastFailureCategory?: StickyFailureCategory;
  boundAt: number;
}

const TOKEN_REFRESH_SKEW_MS = 120_000;
const MAX_SWITCH_HISTORY = 25;

function lowestFractionOf(
  quota: QuotaSnapshotSummary | undefined,
  preferredPool?: QuotaGroupSummary['pool'],
): number | undefined {
  if (!quota || quota.groups.length === 0) return undefined;
  if (preferredPool) {
    const match = quota.groups.find((g) => g.pool === preferredPool);
    if (match) return match.remainingFraction;
  }
  return quota.groups.reduce(
    (min, g) => Math.min(min, g.remainingFraction),
    quota.groups[0].remainingFraction,
  );
}

export class AntigravityAccountManager {
  private readonly accountsPath: string;
  private loaded = false;
  private loadPromise: Promise<void> | undefined;
  private accounts: AccountRecord[] = [];
  private activeAccountId: string | undefined;

  private readonly sessionBindings = new Map<string, SessionStickyState>();
  private readonly quotaCache = new Map<string, QuotaSnapshotSummary>();
  private readonly inFlightRefreshes = new Map<string, Promise<AccountRecord>>();
  private readonly upstreamSessionGeneration = new Map<string, number>();

  private recentSwitches: SwitchEventRecord[] = [];
  private coldNotice: SwitchEventRecord | undefined;

  constructor(private readonly config: AntigravityPluginConfig) {
    this.accountsPath = path.join(
      resolveAntigravityStorageDir(config.storageDir),
      'accounts.json',
    );
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk();
    }
    await this.loadPromise;
  }

  private async loadFromDisk(): Promise<void> {
    this.loaded = true;
    const saved = await readJsonFile<StoredAccountsState>(this.accountsPath).catch(
      () => undefined,
    );
    if (saved && Array.isArray(saved.accounts)) {
      this.accounts = saved.accounts.filter(
        (acc) =>
          acc &&
          typeof acc.id === 'string' &&
          typeof acc.email === 'string' &&
          typeof acc.refreshToken === 'string',
      );
      this.activeAccountId =
        saved.activeAccountId && this.accounts.some((a) => a.id === saved.activeAccountId)
          ? saved.activeAccountId
          : this.accounts[0]?.id;
      return;
    }

    // Migrate legacy single-account credentials if present.
    for (const candidate of resolveLegacyCredentialCandidates()) {
      const legacy = await readJsonFile<{
        email?: string;
        accessToken?: string;
        access_token?: string;
        refreshToken?: string;
        refresh_token?: string;
        expiresAt?: number;
        expires_at?: number;
        projectId?: string;
        project_id?: string;
      }>(candidate).catch(() => undefined);
      const refresh = legacy?.refreshToken ?? legacy?.refresh_token;
      const access = legacy?.accessToken ?? legacy?.access_token;
      if (legacy?.email && refresh && access) {
        const migrated: AccountRecord = {
          id: randomUUID(),
          email: legacy.email,
          accessToken: access,
          refreshToken: refresh,
          expiresAt: legacy.expiresAt ?? legacy.expires_at ?? Date.now() + 3600_000,
          projectId: legacy.projectId ?? legacy.project_id,
          needsReauth: false,
          addedAt: Date.now(),
        };
        this.accounts = [migrated];
        this.activeAccountId = migrated.id;
        await this.persist();
        break;
      }
    }
  }

  private async persist(): Promise<void> {
    const payload: StoredAccountsState = {
      version: 1,
      ...(this.activeAccountId ? { activeAccountId: this.activeAccountId } : {}),
      accounts: this.accounts,
    };
    await writePrivateJsonFile(this.accountsPath, payload);
  }

  listAccounts(): AccountPublicSummary[] {
    return this.accounts.map((acc) => {
      const q = this.quotaCache.get(acc.id);
      const lowest = lowestFractionOf(q);
      return {
        id: acc.id,
        email: acc.email,
        ...(acc.name ? { name: acc.name } : {}),
        ...(acc.projectId ? { projectId: acc.projectId } : {}),
        ...(acc.tierLabel ? { tierLabel: acc.tierLabel } : {}),
        ...(acc.tierId ? { tierId: acc.tierId } : {}),
        isActive: acc.id === this.activeAccountId,
        needsReauth: acc.needsReauth,
        ...(acc.lastError ? { lastError: acc.lastError } : {}),
        ...(acc.cooldownUntil && acc.cooldownUntil > Date.now()
          ? { cooldownUntil: acc.cooldownUntil }
          : {}),
        ...(lowest !== undefined ? { lowestQuotaFraction: lowest } : {}),
        addedAt: acc.addedAt,
        ...(acc.lastUsedAt ? { lastUsedAt: acc.lastUsedAt } : {}),
      };
    });
  }

  getActiveAccount(): AccountRecord | undefined {
    if (this.activeAccountId) {
      const found = this.accounts.find((a) => a.id === this.activeAccountId);
      if (found) return found;
    }
    return this.accounts[0];
  }

  getAccountById(id: string): AccountRecord | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  findAccountByQuery(query: string): AccountRecord | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    return (
      this.accounts.find((a) => a.id.toLowerCase() === q) ??
      this.accounts.find((a) => a.email.toLowerCase() === q) ??
      this.accounts.find((a) => a.email.toLowerCase().includes(q))
    );
  }

  getQuota(accountId?: string): QuotaSnapshotSummary | undefined {
    const id = accountId ?? this.activeAccountId ?? this.accounts[0]?.id;
    return id ? this.quotaCache.get(id) : undefined;
  }

  setQuota(snapshot: QuotaSnapshotSummary): void {
    this.quotaCache.set(snapshot.accountId, snapshot);
    const acc = this.getAccountById(snapshot.accountId);
    if (acc) {
      let dirty = false;
      if (snapshot.projectId && acc.projectId !== snapshot.projectId) {
        acc.projectId = snapshot.projectId;
        dirty = true;
      }
      if (snapshot.tierLabel && acc.tierLabel !== snapshot.tierLabel) {
        acc.tierLabel = snapshot.tierLabel;
        dirty = true;
      }
      if (snapshot.tierId && acc.tierId !== snapshot.tierId) {
        acc.tierId = snapshot.tierId;
        dirty = true;
      }
      if (dirty) {
        void this.persist();
      }
    }
  }

  async upsertAccountFromOAuth(creds: OAuthCredentialsResult): Promise<AccountRecord> {
    await this.ensureLoaded();
    const existing = this.accounts.find(
      (a) => a.email.toLowerCase() === creds.email.toLowerCase(),
    );
    if (existing) {
      existing.accessToken = creds.accessToken;
      existing.refreshToken = creds.refreshToken;
      existing.expiresAt = creds.expiresAt;
      existing.name = creds.name ?? existing.name;
      existing.needsReauth = false;
      existing.lastError = undefined;
      existing.cooldownUntil = undefined;
      this.activeAccountId = existing.id;
      await this.persist();
      return existing;
    }

    const record: AccountRecord = {
      id: randomUUID(),
      email: creds.email,
      ...(creds.name ? { name: creds.name } : {}),
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      needsReauth: false,
      addedAt: Date.now(),
    };
    this.accounts.push(record);
    if (!this.activeAccountId) {
      this.activeAccountId = record.id;
    } else if (this.accounts.length === 1) {
      this.activeAccountId = record.id;
    }
    await this.persist();
    return record;
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.ensureLoaded();
    this.accounts = this.accounts.filter((a) => a.id !== accountId);
    this.quotaCache.delete(accountId);
    for (const [sid, binding] of this.sessionBindings.entries()) {
      if (binding.accountId === accountId) {
        this.sessionBindings.delete(sid);
      }
    }
    if (this.activeAccountId === accountId) {
      this.activeAccountId = this.accounts[0]?.id;
    }
    await this.persist();
  }

  async clearAll(): Promise<void> {
    await this.ensureLoaded();
    this.accounts = [];
    this.activeAccountId = undefined;
    this.sessionBindings.clear();
    this.quotaCache.clear();
    await this.persist();
  }

  async updateAccountMeta(
    accountId: string,
    patch: Partial<Pick<AccountRecord, 'projectId' | 'tierLabel' | 'tierId'>>,
  ): Promise<void> {
    const acc = this.getAccountById(accountId);
    if (!acc) return;
    let changed = false;
    if (patch.projectId && acc.projectId !== patch.projectId) {
      acc.projectId = patch.projectId;
      changed = true;
    }
    if (patch.tierLabel && acc.tierLabel !== patch.tierLabel) {
      acc.tierLabel = patch.tierLabel;
      changed = true;
    }
    if (patch.tierId && acc.tierId !== patch.tierId) {
      acc.tierId = patch.tierId;
      changed = true;
    }
    if (changed) await this.persist();
  }

  /**
   * Ensure valid accessToken with concurrent refresh dedup lock per account.
   */
  async ensureFreshToken(accountId: string, signal?: AbortSignal): Promise<AccountRecord> {
    await this.ensureLoaded();
    const current = this.getAccountById(accountId);
    if (!current) {
      throw new Error(`Account "${accountId}" not found`);
    }
    if (current.expiresAt - Date.now() > TOKEN_REFRESH_SKEW_MS && current.accessToken) {
      return current;
    }

    const existingPromise = this.inFlightRefreshes.get(accountId);
    if (existingPromise) {
      return existingPromise;
    }

    const refreshPromise = (async () => {
      try {
        const refreshed = await refreshGoogleAccessToken(
          current.refreshToken,
          this.config,
          signal,
        );
        current.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) {
          current.refreshToken = refreshed.refreshToken;
        }
        current.expiresAt = refreshed.expiresAt;
        current.needsReauth = false;
        current.lastError = undefined;
        await this.persist();
        return current;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/invalid_grant|unauthorized_client|revoked/i.test(msg)) {
          current.needsReauth = true;
        }
        current.lastError = msg;
        await this.persist();
        throw error;
      } finally {
        this.inFlightRefreshes.delete(accountId);
      }
    })();

    this.inFlightRefreshes.set(accountId, refreshPromise);
    return refreshPromise;
  }

  private isAccountQuotaLowOrExhausted(
    accountId: string,
    pool?: QuotaGroupSummary['pool'],
  ): boolean {
    const quota = this.quotaCache.get(accountId);
    const lowest = lowestFractionOf(quota, pool);
    return lowest !== undefined && lowest <= this.config.quotaExhaustedThreshold;
  }

  private pickAlternativeAccount(
    excludeId: string | undefined,
    pool?: QuotaGroupSummary['pool'],
  ): AccountRecord | undefined {
    const now = Date.now();
    const candidates = this.accounts.filter((a) => a.id !== excludeId);
    if (candidates.length === 0) return undefined;

    const score = (acc: AccountRecord): number => {
      if (acc.needsReauth) return -1000;
      const cooling = acc.cooldownUntil !== undefined && acc.cooldownUntil > now;
      const quotaFrac = lowestFractionOf(this.quotaCache.get(acc.id), pool);
      const exhausted =
        quotaFrac !== undefined && quotaFrac <= this.config.quotaExhaustedThreshold;
      let s = 100;
      if (cooling) s -= 60;
      if (exhausted) s -= 40;
      if (acc.id === this.activeAccountId) s += 10;
      if (quotaFrac !== undefined) s += quotaFrac * 20;
      return s;
    };

    const eligible = candidates
      .filter((a) => !a.needsReauth)
      .sort((a, b) => score(b) - score(a));

    return eligible[0];
  }

  /**
   * Sticky session account selection (NEVER round-robin).
   */
  selectAccountForSession(
    sessionKey: string,
    pool?: QuotaGroupSummary['pool'],
  ): { account: AccountRecord; switchedFrom?: SwitchEventRecord } {
    if (this.accounts.length === 0) {
      throw new Error('No Google accounts signed in for Antigravity');
    }

    const now = Date.now();
    const binding = this.sessionBindings.get(sessionKey);

    if (binding) {
      const boundAcc = this.getAccountById(binding.accountId);
      if (boundAcc) {
        const streakTriggered = binding.failureStreak >= this.config.failureSwitchThreshold;
        const quotaTriggered = this.isAccountQuotaLowOrExhausted(boundAcc.id, pool);
        const unavailable = boundAcc.needsReauth;
        const inCooldown =
          boundAcc.cooldownUntil !== undefined && boundAcc.cooldownUntil > now;

        if (!streakTriggered && !quotaTriggered && !unavailable && !inCooldown) {
          boundAcc.lastUsedAt = now;
          return { account: boundAcc };
        }

        const alt = this.pickAlternativeAccount(boundAcc.id, pool);
        if (alt) {
          const reason: SwitchReason = quotaTriggered
            ? 'quota'
            : streakTriggered
              ? 'streak'
              : 'unavailable';
          const switchEvt = this.recordSwitch({
            sessionId: sessionKey,
            from: boundAcc,
            to: alt,
            reason,
            detail: boundAcc.lastError,
          });
          this.sessionBindings.set(sessionKey, {
            accountId: alt.id,
            failureStreak: 0,
            boundAt: now,
          });
          this.activeAccountId = alt.id;
          alt.lastUsedAt = now;
          return { account: alt, switchedFrom: switchEvt };
        }

        // No healthy alternative exists: stay sticky unless account literally requires reauth.
        if (!unavailable) {
          boundAcc.lastUsedAt = now;
          return { account: boundAcc };
        }
        throw new Error(
          `Account ${boundAcc.email} requires re-authentication and no backup account is available`,
        );
      }
    }

    const initial =
      this.getActiveAccount() && !this.getActiveAccount()!.needsReauth
        ? this.getActiveAccount()!
        : this.pickAlternativeAccount(undefined, pool);

    if (!initial || initial.needsReauth) {
      throw new Error(
        'All Antigravity accounts require re-authentication. Please sign in again.',
      );
    }

    this.sessionBindings.set(sessionKey, {
      accountId: initial.id,
      failureStreak: 0,
      boundAt: now,
    });
    initial.lastUsedAt = now;
    return { account: initial };
  }

  /**
   * Manual user switchovers update active account and rebind live sessions cleanly,
   * flagging a cache-cold warning notice for UI transparency.
   */
  async manualSwitchAccount(accountId: string, sessionKey?: string): Promise<SwitchEventRecord> {
    await this.ensureLoaded();
    const target = this.getAccountById(accountId);
    if (!target) {
      throw new Error(`Account "${accountId}" not found`);
    }
    const prev =
      (sessionKey ? this.getAccountById(this.sessionBindings.get(sessionKey)?.accountId ?? '') : undefined) ??
      this.getActiveAccount();

    this.activeAccountId = target.id;
    target.cooldownUntil = undefined;
    const now = Date.now();

    if (sessionKey) {
      this.sessionBindings.set(sessionKey, {
        accountId: target.id,
        failureStreak: 0,
        boundAt: now,
      });
    } else {
      for (const sid of this.sessionBindings.keys()) {
        this.sessionBindings.set(sid, {
          accountId: target.id,
          failureStreak: 0,
          boundAt: now,
        });
      }
    }

    await this.persist();
    return this.recordSwitch({
      ...(sessionKey ? { sessionId: sessionKey } : {}),
      from: prev && prev.id !== target.id ? prev : undefined,
      to: target,
      reason: 'manual',
    });
  }

  recordSuccess(accountId: string, sessionKey: string): void {
    const binding = this.sessionBindings.get(sessionKey);
    if (binding && binding.accountId === accountId) {
      binding.failureStreak = 0;
      binding.lastFailureCategory = undefined;
    }
    const acc = this.getAccountById(accountId);
    if (acc) {
      acc.cooldownUntil = undefined;
      acc.lastError = undefined;
      acc.lastUsedAt = Date.now();
    }
  }

  /**
   * Failure streak rules (PLAN §6):
   * - ONLY count `AUTH`, `QUOTA`, `RATE_LIMIT` failures toward sticky switch streak.
   * - NEVER count `INVALID_REQUEST`, `TRANSPORT`, `CONTEXT_LENGTH`, `SERVER`.
   * - `QUOTA` (QUOTA_EXCEEDED) or reaching `failureSwitchThreshold` triggers switch if another
   *   healthy account is available, returning that switch event cleanly.
   */
  recordFailure(params: {
    accountId: string;
    sessionKey: string;
    category: StickyFailureCategory;
    message: string;
    retryAfterMs?: number;
    pool?: QuotaGroupSummary['pool'];
  }): SwitchEventRecord | undefined {
    const acc = this.getAccountById(params.accountId);
    if (acc) {
      acc.lastError = params.message;
    }

    if (
      params.category !== 'AUTH' &&
      params.category !== 'QUOTA' &&
      params.category !== 'RATE_LIMIT'
    ) {
      return undefined;
    }

    if (acc && params.category === 'RATE_LIMIT') {
      const waitMs = Math.min(300_000, Math.max(5_000, params.retryAfterMs ?? 30_000));
      acc.cooldownUntil = Date.now() + waitMs;
    } else if (acc && params.category === 'QUOTA') {
      const waitMs = Math.min(3_600_000, Math.max(60_000, params.retryAfterMs ?? 300_000));
      acc.cooldownUntil = Date.now() + waitMs;
    }

    let binding = this.sessionBindings.get(params.sessionKey);
    if (!binding || binding.accountId !== params.accountId) {
      binding = {
        accountId: params.accountId,
        failureStreak: 0,
        boundAt: Date.now(),
      };
      this.sessionBindings.set(params.sessionKey, binding);
    }

    binding.failureStreak += 1;
    binding.lastFailureCategory = params.category;

    const shouldSwitchNow =
      params.category === 'QUOTA' ||
      binding.failureStreak >= this.config.failureSwitchThreshold;

    if (!shouldSwitchNow) {
      return undefined;
    }

    const alt = this.pickAlternativeAccount(params.accountId, params.pool);
    if (!alt) {
      return undefined;
    }

    const reason: SwitchReason = params.category === 'QUOTA' ? 'quota' : 'streak';
    const switchEvt = this.recordSwitch({
      sessionId: params.sessionKey,
      from: acc,
      to: alt,
      reason,
      detail: params.message,
    });

    this.sessionBindings.set(params.sessionKey, {
      accountId: alt.id,
      failureStreak: 0,
      boundAt: Date.now(),
    });
    this.activeAccountId = alt.id;
    void this.persist();
    return switchEvt;
  }

  getUpstreamSessionGeneration(accountId: string, sessionKey: string): number {
    return this.upstreamSessionGeneration.get(`${accountId}::${sessionKey}`) ?? 0;
  }

  bumpUpstreamSessionGeneration(accountId: string, sessionKey: string): number {
    const key = `${accountId}::${sessionKey}`;
    const next = (this.upstreamSessionGeneration.get(key) ?? 0) + 1;
    this.upstreamSessionGeneration.set(key, next);
    return next;
  }

  getColdNotice(): SwitchEventRecord | undefined {
    return this.coldNotice ? { ...this.coldNotice } : undefined;
  }

  dismissColdNotice(): void {
    this.coldNotice = undefined;
  }

  getRecentSwitches(): SwitchEventRecord[] {
    return [...this.recentSwitches];
  }

  private recordSwitch(params: {
    sessionId?: string;
    from?: AccountRecord;
    to: AccountRecord;
    reason: SwitchReason;
    detail?: string;
  }): SwitchEventRecord {
    const evt: SwitchEventRecord = {
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.from
        ? { fromAccountId: params.from.id, fromEmail: params.from.email }
        : {}),
      toAccountId: params.to.id,
      toEmail: params.to.email,
      reason: params.reason,
      ...(params.detail ? { detail: params.detail } : {}),
      at: Date.now(),
    };
    this.recentSwitches.unshift(evt);
    if (this.recentSwitches.length > MAX_SWITCH_HISTORY) {
      this.recentSwitches.length = MAX_SWITCH_HISTORY;
    }
    if (params.from && params.from.id !== params.to.id) {
      this.coldNotice = evt;
    }
    return evt;
  }
}

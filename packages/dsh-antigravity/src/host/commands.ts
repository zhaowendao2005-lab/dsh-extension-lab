import type { AntigravityService } from './adapter.ts';

function tryRegisterCommand(
  cmdService: any,
  def: {
    name: string;
    description: string;
    input?: { hint: string };
    handler: (invocation: any) => Promise<{ kind: 'success' | 'error'; text: string }>;
  },
): (() => void) | undefined {
  try {
    return cmdService.register({
      ...def,
      recordInput: false,
    });
  } catch (error) {
    console.warn(
      `[dsh-antigravity] command "/${def.name}" registration skipped:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function registerAntigravityCommands(
  ctx: any,
  service: AntigravityService,
): void {
  ctx.inject(['commands'], (cmdCtx: any) => {
    if (typeof cmdCtx?.commands?.register !== 'function') return;

    cmdCtx.effect(() => {
      const disposers: Array<() => void> = [];

      const reg = (def: Parameters<typeof tryRegisterCommand>[1]) => {
        const d = tryRegisterCommand(cmdCtx.commands, def);
        if (d) disposers.push(d);
      };

      reg({
        name: 'antigravity-status',
        description: 'Show Antigravity active account, quota pools, cold-cache notice, and cache hit rate',
        handler: async () => {
          const status = await service.getStatusPayload();
          const active = status.accounts.find((a) => a.isActive);
          const lines: string[] = [
            `Antigravity (${status.providerName})`,
            `Accounts: ${status.accounts.length}${active ? ` | Active: ${active.email}${active.tierLabel ? ` [${active.tierLabel}]` : ''}` : ' (not signed in)'}`,
          ];
          if (status.coldNotice) {
            lines.push(
              `Notice: 缓存已重建（冷缓存）-> ${status.coldNotice.toEmail} (${status.coldNotice.reason})`,
            );
          }
          if (status.quota && status.quota.groups.length > 0) {
            lines.push(
              'Quota: ' +
                status.quota.groups
                  .map((g) => `${g.label} ${formatPct(g.remainingFraction)}`)
                  .join(' | '),
            );
          }
          lines.push(
            `Telemetry: ${status.telemetry.turnCount} turns, cache hit ${formatPct(status.telemetry.aggregateCacheHitRate)} (${status.telemetry.totalCacheReadTokens} cached / ${status.telemetry.totalUncachedInputTokens} uncached input)`,
          );
          return { kind: 'success', text: lines.join('\n') };
        },
      });

      reg({
        name: 'antigravity-accounts',
        description: 'List configured Google accounts for Antigravity',
        handler: async () => {
          const status = await service.getStatusPayload();
          if (status.accounts.length === 0) {
            return {
              kind: 'success',
              text: 'No Google accounts connected. Open Settings -> Antigravity to sign in.',
            };
          }
          const lines = status.accounts.map((a, idx) => {
            const flags = [
              a.isActive ? 'ACTIVE' : undefined,
              a.tierLabel,
              a.needsReauth ? 'NEEDS_REAUTH' : undefined,
              a.cooldownUntil ? 'COOLDOWN' : undefined,
              a.lowestQuotaFraction !== undefined
                ? `minQuota=${formatPct(a.lowestQuotaFraction)}`
                : undefined,
            ]
              .filter(Boolean)
              .join(', ');
            return `${idx + 1}. ${a.email} (${a.id.slice(0, 8)}) [${flags}]`;
          });
          return { kind: 'success', text: lines.join('\n') };
        },
      });

      reg({
        name: 'antigravity-switch',
        description: 'Switch sticky Antigravity account by email or account id prefix',
        input: { hint: '<email-or-id>' },
        handler: async (invocation: any) => {
          const query = String(invocation?.rawInput ?? '').trim();
          if (!query) {
            return { kind: 'error', text: 'Usage: /antigravity-switch <email-or-id>' };
          }
          await service.accounts.ensureLoaded();
          const match = service.accounts.findAccountByQuery(query);
          if (!match) {
            return { kind: 'error', text: `No Antigravity account matches "${query}"` };
          }
          const sessionKey = invocation?.agent?.session?.id;
          const evt = await service.accounts.manualSwitchAccount(
            match.id,
            typeof sessionKey === 'string' ? sessionKey : undefined,
          );
          await service.refreshQuotaAndModelsForAccount(match.id).catch(() => undefined);
          service.notifyAdaptersUpdated();
          return {
            kind: 'success',
            text: `Switched Antigravity account to ${evt.toEmail} (缓存已重建 / 冷缓存).`,
          };
        },
      });

      reg({
        name: 'antigravity-quota',
        description: 'Refresh and display live Antigravity quota pools',
        handler: async () => {
          const quota = await service.refreshQuotaAndModelsForAccount();
          if (!quota) {
            return {
              kind: 'error',
              text: 'No active Antigravity account signed in.',
            };
          }
          if (quota.degraded && quota.groups.length === 0) {
            return {
              kind: 'error',
              text: `Quota lookup failed (fail-open active): ${quota.error ?? 'unknown error'}`,
            };
          }
          const rows = quota.groups.map((g) => {
            const flag = g.isExhausted
              ? ' [EXHAUSTED <=5%]'
              : g.isLow
                ? ' [LOW <15%]'
                : '';
            const reset = g.resetTime ? ` (resets ${g.resetTime})` : '';
            return `- ${g.label}: ${formatPct(g.remainingFraction)}${flag}${reset}`;
          });
          return {
            kind: 'success',
            text: [`Quota for ${quota.email}${quota.tierLabel ? ` (${quota.tierLabel})` : ''}:`, ...rows].join(
              '\n',
            ),
          };
        },
      });

      reg({
        name: 'antigravity-doctor',
        description: 'Run Antigravity direct connection diagnostics (OAuth, loadCodeAssist, countTokens, header hygiene)',
        handler: async () => {
          const report = await service.runDoctor();
          const lines = report.checks.map(
            (c) =>
              `${c.ok ? '[PASS]' : '[FAIL]'} ${c.name}: ${c.detail}${c.latencyMs !== undefined ? ` (${c.latencyMs}ms)` : ''}`,
          );
          return {
            kind: report.ok ? 'success' : 'error',
            text: [`User-Agent: ${report.userAgent}`, ...lines].join('\n'),
          };
        },
      });

      return () => {
        for (const dispose of disposers) {
          dispose();
        }
      };
    }, 'dsh-antigravity: commands');
  });
}

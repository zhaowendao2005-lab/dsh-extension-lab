import { AntigravityService } from './adapter.ts';
import { registerAntigravityCommands } from './commands.ts';
import { Config, PROVIDER_ID, normalizeConfig } from './config.ts';
import { registerAntigravityWebApi } from './server.ts';

export const name = 'dsh-antigravity';
export const inject = ['llm'] as const;
export { Config };

export function apply(ctx: any, rawConfig: unknown): void {
  const config = normalizeConfig(rawConfig);

  const service = new AntigravityService(config, {
    resolveAttachments: () => {
      try {
        return ctx.get?.('attachments');
      } catch {
        return undefined;
      }
    },
    resolveFsHostMapper: () => {
      try {
        const fsService = ctx.get?.('fs');
        if (fsService && typeof fsService.processPathFromHostPath === 'function') {
          return (hostPath: string) => fsService.processPathFromHostPath(hostPath);
        }
      } catch {
        // Optional service unavailable.
      }
      return undefined;
    },
    onAdaptersUpdated: () => {
      try {
        ctx.emit?.('llm/models-updated', PROVIDER_ID);
        ctx.emit?.('llm/adapters-updated');
      } catch {
        // Non-fatal if listener absent.
      }
    },
  });

  // Register Antigravity LLM adapter with Cordis lifecycle disposal.
  ctx.effect(() => {
    const handle = ctx.llm.registerAdapter([PROVIDER_ID], service.adapter);
    return () => {
      if (typeof handle === 'function') {
        handle();
      } else if (handle && typeof handle.dispose === 'function') {
        handle.dispose();
      }
    };
  }, 'dsh-antigravity: adapter');

  let disposed = false;

  // Preload accounts & model visibility asynchronously without blocking plugin mount.
  void service.accounts
    .ensureLoaded()
    .then(async () => {
      if (disposed) return;
      await service.catalog.ensureLoaded();
      if (disposed) return;
      const active = service.accounts.getActiveAccount();
      if (active && !active.needsReauth) {
        await service.refreshQuotaAndModelsForAccount(active.id).catch(() => undefined);
      }
      if (!disposed) {
        service.notifyAdaptersUpdated();
      }
    })
    .catch(() => undefined);

  // Clean up any open OAuth loopback socket on plugin disposal.
  ctx.effect(
    () => () => {
      disposed = true;
      service.oauth.cancelLogin();
    },
    'dsh-antigravity: cleanup',
  );

  registerAntigravityWebApi(ctx, service);
  registerAntigravityCommands(ctx, service);
}

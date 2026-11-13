import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AntigravityService } from './adapter.ts';

const API_PREFIX = '/antigravity/api';
const MAX_BODY_BYTES = 256 * 1024;

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendMethodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { ok: false, error: 'method not allowed' });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('request body too large');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}

export function registerAntigravityWebApi(
  ctx: any,
  service: AntigravityService,
): void {
  ctx.inject(['webServer'], (webCtx: any) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: API_PREFIX,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url || '/', 'http://dsh.local');
            const subpath = url.pathname
              .replace(/^\/antigravity\/api\/?/, '')
              .replace(/\/+$/, '');

            try {
              if (subpath === '' || subpath === 'status') {
                if (req.method !== 'GET') return sendMethodNotAllowed(res);
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              if (subpath === 'login') {
                if (req.method !== 'POST') return sendMethodNotAllowed(res);
                const status = await service.oauth.beginLogin();
                return sendJson(res, 200, { ok: true, value: status });
              }

              if (subpath === 'login/cancel') {
                if (req.method !== 'POST') return sendMethodNotAllowed(res);
                service.oauth.cancelLogin();
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              if (subpath === 'login/manual') {
                if (req.method !== 'POST') return sendMethodNotAllowed(res);
                const body = await readJsonBody(req);
                const input =
                  typeof body.input === 'string'
                    ? body.input
                    : typeof body.code === 'string'
                      ? body.code
                      : '';
                await service.oauth.completeManualCallback(input);
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              if (subpath === 'accounts/switch') {
                if (req.method !== 'POST') return sendMethodNotAllowed(res);
                const body = await readJsonBody(req);
                const accountId =
                  typeof body.accountId === 'string' ? body.accountId.trim() : '';
                if (!accountId) {
                  return sendJson(res, 400, {
                    ok: false,
                    error: 'accountId is required',
                  });
                }
                await service.accounts.manualSwitchAccount(accountId);
                await service.refreshQuotaAndModelsForAccount(accountId).catch(() => undefined);
                service.notifyAdaptersUpdated();
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              if (subpath === 'accounts/remove') {
                if (req.method !== 'POST') return sendMethodNotAllowed(res);
                const body = await readJsonBody(req);
                const accountId =
                  typeof body.accountId === 'string' ? body.accountId.trim() : '';
                if (!accountId) {
                  return sendJson(res, 400, {
                    ok: false,
                    error: 'accountId is required',
                  });
                }
                await service.accounts.removeAccount(accountId);
                service.notifyAdaptersUpdated();
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              if (subpath === 'logout') {
                if (req.method !== 'POST') return sendMethodNotAllowed(res);
                service.oauth.cancelLogin();
                await service.accounts.clearAll();
                service.notifyAdaptersUpdated();
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              if (subpath === 'quota') {
                if (req.method !== 'GET' && req.method !== 'POST') {
                  return sendMethodNotAllowed(res);
                }
                await service.refreshQuotaAndModelsForAccount();
                service.notifyAdaptersUpdated();
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              if (subpath === 'models') {
                if (req.method === 'GET') {
                  const status = await service.getStatusPayload();
                  return sendJson(res, 200, { ok: true, value: status.models });
                }
                if (req.method === 'POST') {
                  const body = await readJsonBody(req);
                  if (!Array.isArray(body.enabledModelIds)) {
                    return sendJson(res, 400, {
                      ok: false,
                      error: 'enabledModelIds must be an array',
                    });
                  }
                  await service.catalog.setEnabledModelIds(
                    body.enabledModelIds as string[],
                  );
                  service.notifyAdaptersUpdated();
                  return sendJson(res, 200, {
                    ok: true,
                    value: await service.getStatusPayload(),
                  });
                }
                return sendMethodNotAllowed(res);
              }

              if (subpath === 'doctor') {
                if (req.method !== 'POST' && req.method !== 'GET') {
                  return sendMethodNotAllowed(res);
                }
                const report = await service.runDoctor();
                return sendJson(res, 200, { ok: true, value: report });
              }

              if (subpath === 'dismiss-cold-notice') {
                if (req.method !== 'POST') return sendMethodNotAllowed(res);
                service.accounts.dismissColdNotice();
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload(),
                });
              }

              return sendJson(res, 404, { ok: false, error: 'not found' });
            } catch (error) {
              return sendJson(res, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
      'dsh-antigravity: web api',
    );
  });
}

import { createHash, randomBytes } from 'node:crypto';
import http, { type Server as HttpServer } from 'node:http';
import type { PendingLoginStatus } from '../shared/types.ts';
import type { AntigravityPluginConfig } from './config.ts';

/**
 * Antigravity Google OAuth 2.0 PKCE client.
 * Matches Google Code Assist desktop app credentials and local loopback callback flow.
 */
export const DEFAULT_OAUTH_CLIENT_ID =
  '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
export const DEFAULT_OAUTH_CLIENT_SECRET =
  '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';

export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
] as const;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const CALLBACK_PATH = '/oauth-callback';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface OAuthCredentialsResult {
  email: string;
  name?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
}

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

function resolveClientPair(config: AntigravityPluginConfig): {
  clientId: string;
  clientSecret: string;
} {
  const clientId =
    config.oauthClientId ||
    process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() ||
    DEFAULT_OAUTH_CLIENT_ID;
  const clientSecret =
    config.oauthClientSecret ||
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() ||
    DEFAULT_OAUTH_CLIENT_SECRET;
  return { clientId, clientSecret };
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function extractAuthCodeFromInput(rawInput: string): {
  code?: string;
  state?: string;
  error?: string;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) return { error: 'empty callback URL or authorization code' };

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    try {
      const parsed = new URL(trimmed, 'http://127.0.0.1');
      const err = parsed.searchParams.get('error');
      if (err) {
        return { error: parsed.searchParams.get('error_description') || err };
      }
      const code = parsed.searchParams.get('code')?.trim();
      const state = parsed.searchParams.get('state')?.trim();
      if (!code) return { error: 'callback URL missing code query parameter' };
      return { code, state };
    } catch {
      return { error: 'invalid callback URL format' };
    }
  }

  return { code: trimmed };
}

async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  signal?: AbortSignal;
}): Promise<OAuthCredentialsResult> {
  const form = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: params.signal,
  });

  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`Google OAuth token exchange failed (${tokenRes.status}): ${tokenText}`);
  }
  const tokenJson = JSON.parse(tokenText) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokenJson.access_token) {
    throw new Error('Google OAuth token response missing access_token');
  }
  if (!tokenJson.refresh_token) {
    throw new Error(
      'Google OAuth response missing refresh_token (please revoke prior consent or retry with prompt=consent)',
    );
  }

  const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    signal: params.signal,
  });
  const userInfoText = await userInfoRes.text();
  if (!userInfoRes.ok) {
    throw new Error(`Google userinfo fetch failed (${userInfoRes.status}): ${userInfoText}`);
  }
  const userInfo = JSON.parse(userInfoText) as { email?: string; name?: string };
  if (!userInfo.email) {
    throw new Error('Google userinfo response did not include an email address');
  }

  const expiresInMs = Math.max(60, Number(tokenJson.expires_in ?? 3600)) * 1000;
  return {
    email: userInfo.email.trim(),
    name: userInfo.name?.trim() || undefined,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt: Date.now() + expiresInMs,
    scope: tokenJson.scope,
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  config: AntigravityPluginConfig,
  signal?: AbortSignal,
): Promise<RefreshTokenResult> {
  const { clientId, clientSecret } = resolveClientPair(config);
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google OAuth refresh failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error('Google OAuth refresh response missing access_token');
  }
  const expiresInMs = Math.max(60, Number(json.expires_in ?? 3600)) * 1000;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + expiresInMs,
  };
}

function renderCallbackHtml(success: boolean, message: string): string {
  const title = success ? 'Antigravity Sign-In Complete' : 'Antigravity Sign-In Failed';
  const safeMsg = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 48px auto; max-width: 520px; padding: 24px; color: #1f2328; }
  .card { border: 1px solid #d0d7de; border-radius: 10px; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 12px; color: ${success ? '#1a7f37' : '#cf222e'}; }
  p { margin: 0; font-size: 14px; line-height: 1.5; color: #57606a; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${safeMsg}</p>
  </div>
</body>
</html>`;
}

type TimerHandle = ReturnType<typeof setTimeout>;

function unrefTimer(timer: TimerHandle): void {
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    const fn = (timer as { unref?: () => void }).unref;
    if (typeof fn === 'function') fn.call(timer);
  }
}

interface ActiveSession {
  state: string;
  verifier: string;
  redirectUri: string;
  authUrl: string;
  startedAt: number;
  server: HttpServer;
  timer: TimerHandle;
  clientId: string;
  clientSecret: string;
}

export class AntigravityOAuthManager {
  private status: PendingLoginStatus = { state: 'idle' };
  private active: ActiveSession | undefined;
  private onCompleted?: (creds: OAuthCredentialsResult) => Promise<void>;

  constructor(
    private readonly config: AntigravityPluginConfig,
    onCompleted?: (creds: OAuthCredentialsResult) => Promise<void>,
  ) {
    this.onCompleted = onCompleted;
  }

  getStatus(): PendingLoginStatus {
    return { ...this.status };
  }

  async beginLogin(
    onCompleted?: (creds: OAuthCredentialsResult) => Promise<void>,
  ): Promise<PendingLoginStatus> {
    if (onCompleted) this.onCompleted = onCompleted;
    this.cancelLogin();

    const { verifier, challenge } = generatePkcePair();
    const oauthState = base64UrlEncode(randomBytes(24));
    const { clientId, clientSecret } = resolveClientPair(this.config);
    let boundRedirectUri = '';

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const errParam = reqUrl.searchParams.get('error');
        if (errParam) {
          const desc = reqUrl.searchParams.get('error_description') || errParam;
          this.failSession(`OAuth error: ${desc}`);
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, desc));
          return;
        }
        const code = reqUrl.searchParams.get('code')?.trim();
        const returnedState = reqUrl.searchParams.get('state')?.trim();
        if (!code || returnedState !== oauthState) {
          const msg = !code ? 'Missing authorization code' : 'OAuth state mismatch';
          this.failSession(msg);
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, msg));
          return;
        }
        const creds = await exchangeCodeForTokens({
          code,
          redirectUri: boundRedirectUri || this.active?.redirectUri || '',
          codeVerifier: verifier,
          clientId,
          clientSecret,
        });
        await this.onCompleted?.(creds);
        this.completeSession(creds.email);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          renderCallbackHtml(
            true,
            `Signed in as ${creds.email}. You may close this tab and return to DeepSeek Harness.`,
          ),
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.failSession(msg);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderCallbackHtml(false, msg));
      }
    });

    const port = await listenLoopback(server, this.config.oauthPort);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    boundRedirectUri = redirectUri;
    const authUrlObj = new URL(GOOGLE_AUTH_URL);
    authUrlObj.searchParams.set('client_id', clientId);
    authUrlObj.searchParams.set('redirect_uri', redirectUri);
    authUrlObj.searchParams.set('response_type', 'code');
    authUrlObj.searchParams.set('scope', OAUTH_SCOPES.join(' '));
    authUrlObj.searchParams.set('access_type', 'offline');
    authUrlObj.searchParams.set('prompt', 'consent');
    authUrlObj.searchParams.set('code_challenge', challenge);
    authUrlObj.searchParams.set('code_challenge_method', 'S256');
    authUrlObj.searchParams.set('state', oauthState);

    const authUrl = authUrlObj.toString();
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      if (this.active?.state === oauthState) {
        this.failSession('OAuth sign-in timed out after 5 minutes');
      }
    }, LOGIN_TIMEOUT_MS);
    unrefTimer(timer);

    this.active = {
      state: oauthState,
      verifier,
      redirectUri,
      authUrl,
      startedAt,
      server,
      timer,
      clientId,
      clientSecret,
    };
    this.status = {
      state: 'pending',
      authUrl,
      redirectUri,
      startedAt,
    };
    return this.getStatus();
  }

  async completeManualCallback(rawInput: string): Promise<OAuthCredentialsResult> {
    if (!this.active) {
      throw new Error('No pending OAuth login session. Start login first.');
    }
    const parsed = extractAuthCodeFromInput(rawInput);
    if (parsed.error || !parsed.code) {
      throw new Error(parsed.error || 'Missing authorization code');
    }
    if (parsed.state && parsed.state !== this.active.state) {
      throw new Error('OAuth state parameter does not match the active login session');
    }

    const session = this.active;
    try {
      const creds = await exchangeCodeForTokens({
        code: parsed.code,
        redirectUri: session.redirectUri,
        codeVerifier: session.verifier,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
      });
      await this.onCompleted?.(creds);
      this.completeSession(creds.email);
      return creds;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.failSession(msg);
      throw error;
    }
  }

  cancelLogin(): void {
    this.cleanupActive();
    this.status = { state: 'idle' };
  }

  private completeSession(email: string): void {
    this.cleanupActive();
    this.status = { state: 'completed', email };
  }

  private failSession(error: string): void {
    this.cleanupActive();
    this.status = { state: 'failed', error };
  }

  private cleanupActive(): void {
    if (!this.active) return;
    clearTimeout(this.active.timer);
    try {
      this.active.server.close();
    } catch {
      // Ignore already closed server.
    }
    this.active = undefined;
  }
}

async function listenLoopback(server: HttpServer, preferredPort: number): Promise<number> {
  const tryListen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('Failed to bind OAuth callback listener'));
        }
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });

  try {
    return await tryListen(preferredPort);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EADDRINUSE' || code === 'EACCES') {
      return await tryListen(0);
    }
    throw error;
  }
}

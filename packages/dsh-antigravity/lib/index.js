// packages/dsh-antigravity/src/host/adapter.ts
import {
  LlmAdapter,
  LlmError as LlmError2,
  resolveImageAttachmentAccess,
  resolveRetryPolicy
} from "@deepseek-ai/dsh-llm";

// packages/dsh-antigravity/src/host/accounts.ts
import { randomUUID } from "node:crypto";
import path2 from "node:path";

// packages/dsh-antigravity/src/host/oauth.ts
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
var DEFAULT_OAUTH_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
var DEFAULT_OAUTH_CLIENT_SECRET = "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";
var OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];
var GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
var GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
var CALLBACK_PATH = "/oauth-callback";
var LOGIN_TIMEOUT_MS = 5 * 60 * 1e3;
function resolveClientPair(config) {
  const clientId = config.oauthClientId || process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() || DEFAULT_OAUTH_CLIENT_ID;
  const clientSecret = config.oauthClientSecret || process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() || DEFAULT_OAUTH_CLIENT_SECRET;
  return { clientId, clientSecret };
}
function base64UrlEncode(buf) {
  return buf.toString("base64url");
}
function generatePkcePair() {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
function extractAuthCodeFromInput(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return { error: "empty callback URL or authorization code" };
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    try {
      const parsed = new URL(trimmed, "http://127.0.0.1");
      const err = parsed.searchParams.get("error");
      if (err) {
        return { error: parsed.searchParams.get("error_description") || err };
      }
      const code = parsed.searchParams.get("code")?.trim();
      const state = parsed.searchParams.get("state")?.trim();
      if (!code) return { error: "callback URL missing code query parameter" };
      return { code, state };
    } catch {
      return { error: "invalid callback URL format" };
    }
  }
  return { code: trimmed };
}
async function exchangeCodeForTokens(params) {
  const form = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri
  });
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: params.signal
  });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`Google OAuth token exchange failed (${tokenRes.status}): ${tokenText}`);
  }
  const tokenJson = JSON.parse(tokenText);
  if (!tokenJson.access_token) {
    throw new Error("Google OAuth token response missing access_token");
  }
  if (!tokenJson.refresh_token) {
    throw new Error(
      "Google OAuth response missing refresh_token (please revoke prior consent or retry with prompt=consent)"
    );
  }
  const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    signal: params.signal
  });
  const userInfoText = await userInfoRes.text();
  if (!userInfoRes.ok) {
    throw new Error(`Google userinfo fetch failed (${userInfoRes.status}): ${userInfoText}`);
  }
  const userInfo = JSON.parse(userInfoText);
  if (!userInfo.email) {
    throw new Error("Google userinfo response did not include an email address");
  }
  const expiresInMs = Math.max(60, Number(tokenJson.expires_in ?? 3600)) * 1e3;
  return {
    email: userInfo.email.trim(),
    name: userInfo.name?.trim() || void 0,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt: Date.now() + expiresInMs,
    scope: tokenJson.scope
  };
}
async function refreshGoogleAccessToken(refreshToken, config, signal) {
  const { clientId, clientSecret } = resolveClientPair(config);
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google OAuth refresh failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token) {
    throw new Error("Google OAuth refresh response missing access_token");
  }
  const expiresInMs = Math.max(60, Number(json.expires_in ?? 3600)) * 1e3;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + expiresInMs
  };
}
function renderCallbackHtml(success, message) {
  const title = success ? "Antigravity Sign-In Complete" : "Antigravity Sign-In Failed";
  const safeMsg = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 48px auto; max-width: 520px; padding: 24px; color: #1f2328; }
  .card { border: 1px solid #d0d7de; border-radius: 10px; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 12px; color: ${success ? "#1a7f37" : "#cf222e"}; }
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
function unrefTimer(timer) {
  if (timer && typeof timer === "object" && "unref" in timer) {
    const fn = timer.unref;
    if (typeof fn === "function") fn.call(timer);
  }
}
var AntigravityOAuthManager = class {
  constructor(config, onCompleted) {
    this.config = config;
    this.onCompleted = onCompleted;
  }
  status = { state: "idle" };
  active;
  onCompleted;
  getStatus() {
    return { ...this.status };
  }
  async beginLogin(onCompleted) {
    if (onCompleted) this.onCompleted = onCompleted;
    this.cancelLogin();
    const { verifier, challenge } = generatePkcePair();
    const oauthState = base64UrlEncode(randomBytes(24));
    const { clientId, clientSecret } = resolveClientPair(this.config);
    let boundRedirectUri = "";
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (reqUrl.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        const errParam = reqUrl.searchParams.get("error");
        if (errParam) {
          const desc = reqUrl.searchParams.get("error_description") || errParam;
          this.failSession(`OAuth error: ${desc}`);
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCallbackHtml(false, desc));
          return;
        }
        const code = reqUrl.searchParams.get("code")?.trim();
        const returnedState = reqUrl.searchParams.get("state")?.trim();
        if (!code || returnedState !== oauthState) {
          const msg = !code ? "Missing authorization code" : "OAuth state mismatch";
          this.failSession(msg);
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCallbackHtml(false, msg));
          return;
        }
        const creds = await exchangeCodeForTokens({
          code,
          redirectUri: boundRedirectUri || this.active?.redirectUri || "",
          codeVerifier: verifier,
          clientId,
          clientSecret
        });
        await this.onCompleted?.(creds);
        this.completeSession(creds.email);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          renderCallbackHtml(
            true,
            `Signed in as ${creds.email}. You may close this tab and return to DeepSeek Harness.`
          )
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.failSession(msg);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCallbackHtml(false, msg));
      }
    });
    const port = await listenLoopback(server, this.config.oauthPort);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    boundRedirectUri = redirectUri;
    const authUrlObj = new URL(GOOGLE_AUTH_URL);
    authUrlObj.searchParams.set("client_id", clientId);
    authUrlObj.searchParams.set("redirect_uri", redirectUri);
    authUrlObj.searchParams.set("response_type", "code");
    authUrlObj.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    authUrlObj.searchParams.set("access_type", "offline");
    authUrlObj.searchParams.set("prompt", "consent");
    authUrlObj.searchParams.set("code_challenge", challenge);
    authUrlObj.searchParams.set("code_challenge_method", "S256");
    authUrlObj.searchParams.set("state", oauthState);
    const authUrl = authUrlObj.toString();
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      if (this.active?.state === oauthState) {
        this.failSession("OAuth sign-in timed out after 5 minutes");
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
      clientSecret
    };
    this.status = {
      state: "pending",
      authUrl,
      redirectUri,
      startedAt
    };
    return this.getStatus();
  }
  async completeManualCallback(rawInput) {
    if (!this.active) {
      throw new Error("No pending OAuth login session. Start login first.");
    }
    const parsed = extractAuthCodeFromInput(rawInput);
    if (parsed.error || !parsed.code) {
      throw new Error(parsed.error || "Missing authorization code");
    }
    if (parsed.state && parsed.state !== this.active.state) {
      throw new Error("OAuth state parameter does not match the active login session");
    }
    const session = this.active;
    try {
      const creds = await exchangeCodeForTokens({
        code: parsed.code,
        redirectUri: session.redirectUri,
        codeVerifier: session.verifier,
        clientId: session.clientId,
        clientSecret: session.clientSecret
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
  cancelLogin() {
    this.cleanupActive();
    this.status = { state: "idle" };
  }
  completeSession(email) {
    this.cleanupActive();
    this.status = { state: "completed", email };
  }
  failSession(error) {
    this.cleanupActive();
    this.status = { state: "failed", error };
  }
  cleanupActive() {
    if (!this.active) return;
    clearTimeout(this.active.timer);
    try {
      this.active.server.close();
    } catch {
    }
    this.active = void 0;
  }
};
async function listenLoopback(server, preferredPort) {
  const tryListen = (port) => new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      } else {
        reject(new Error("Failed to bind OAuth callback listener"));
      }
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
  try {
    return await tryListen(preferredPort);
  } catch (error) {
    const code = error?.code;
    if (code === "EADDRINUSE" || code === "EACCES") {
      return await tryListen(0);
    }
    throw error;
  }
}

// packages/dsh-antigravity/src/host/storage.ts
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
function resolveDshHome(env = process.env) {
  const configured = env.DSH_HOME?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  return path.join(homedir(), ".dsh");
}
function resolveAntigravityStorageDir(overrideDir) {
  if (overrideDir && overrideDir.trim() !== "") {
    return path.resolve(overrideDir.trim());
  }
  return path.join(resolveDshHome(), "antigravity");
}
function resolveLegacyCredentialCandidates() {
  return [
    path.join(resolveDshHome(), "credentials", "antigravity.json"),
    path.join(homedir(), ".deepseek-harness", "antigravity", "credentials.json")
  ];
}
async function ensurePrivateDir(dirPath) {
  await mkdir(dirPath, { recursive: true, mode: 448 });
  try {
    await chmod(dirPath, 448);
  } catch {
  }
}
async function writePrivateJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  await ensurePrivateDir(dir);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = JSON.stringify(data, null, 2) + "\n";
  await writeFile(tmpPath, payload, { encoding: "utf8", mode: 384 });
  try {
    await chmod(tmpPath, 384);
  } catch {
  }
  await rename(tmpPath, filePath);
  try {
    await chmod(filePath, 384);
  } catch {
  }
}
async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    if (!raw.trim()) return void 0;
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}

// packages/dsh-antigravity/src/host/accounts.ts
var TOKEN_REFRESH_SKEW_MS = 12e4;
var MAX_SWITCH_HISTORY = 25;
function lowestFractionOf(quota, preferredPool) {
  if (!quota || quota.groups.length === 0) return void 0;
  if (preferredPool) {
    const match = quota.groups.find((g) => g.pool === preferredPool);
    if (match) return match.remainingFraction;
  }
  return quota.groups.reduce(
    (min, g) => Math.min(min, g.remainingFraction),
    quota.groups[0].remainingFraction
  );
}
var AntigravityAccountManager = class {
  constructor(config) {
    this.config = config;
    this.accountsPath = path2.join(
      resolveAntigravityStorageDir(config.storageDir),
      "accounts.json"
    );
  }
  accountsPath;
  loaded = false;
  loadPromise;
  accounts = [];
  activeAccountId;
  sessionBindings = /* @__PURE__ */ new Map();
  quotaCache = /* @__PURE__ */ new Map();
  inFlightRefreshes = /* @__PURE__ */ new Map();
  upstreamSessionGeneration = /* @__PURE__ */ new Map();
  recentSwitches = [];
  coldNotice;
  async ensureLoaded() {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk();
    }
    await this.loadPromise;
  }
  async loadFromDisk() {
    this.loaded = true;
    const saved = await readJsonFile(this.accountsPath).catch(
      () => void 0
    );
    if (saved && Array.isArray(saved.accounts)) {
      this.accounts = saved.accounts.filter(
        (acc) => acc && typeof acc.id === "string" && typeof acc.email === "string" && typeof acc.refreshToken === "string"
      );
      this.activeAccountId = saved.activeAccountId && this.accounts.some((a) => a.id === saved.activeAccountId) ? saved.activeAccountId : this.accounts[0]?.id;
      return;
    }
    for (const candidate of resolveLegacyCredentialCandidates()) {
      const legacy = await readJsonFile(candidate).catch(() => void 0);
      const refresh = legacy?.refreshToken ?? legacy?.refresh_token;
      const access = legacy?.accessToken ?? legacy?.access_token;
      if (legacy?.email && refresh && access) {
        const migrated = {
          id: randomUUID(),
          email: legacy.email,
          accessToken: access,
          refreshToken: refresh,
          expiresAt: legacy.expiresAt ?? legacy.expires_at ?? Date.now() + 36e5,
          projectId: legacy.projectId ?? legacy.project_id,
          needsReauth: false,
          addedAt: Date.now()
        };
        this.accounts = [migrated];
        this.activeAccountId = migrated.id;
        await this.persist();
        break;
      }
    }
  }
  async persist() {
    const payload = {
      version: 1,
      ...this.activeAccountId ? { activeAccountId: this.activeAccountId } : {},
      accounts: this.accounts
    };
    await writePrivateJsonFile(this.accountsPath, payload);
  }
  listAccounts() {
    return this.accounts.map((acc) => {
      const q = this.quotaCache.get(acc.id);
      const lowest = lowestFractionOf(q);
      return {
        id: acc.id,
        email: acc.email,
        ...acc.name ? { name: acc.name } : {},
        ...acc.projectId ? { projectId: acc.projectId } : {},
        ...acc.tierLabel ? { tierLabel: acc.tierLabel } : {},
        ...acc.tierId ? { tierId: acc.tierId } : {},
        isActive: acc.id === this.activeAccountId,
        needsReauth: acc.needsReauth,
        ...acc.lastError ? { lastError: acc.lastError } : {},
        ...acc.cooldownUntil && acc.cooldownUntil > Date.now() ? { cooldownUntil: acc.cooldownUntil } : {},
        ...lowest !== void 0 ? { lowestQuotaFraction: lowest } : {},
        addedAt: acc.addedAt,
        ...acc.lastUsedAt ? { lastUsedAt: acc.lastUsedAt } : {}
      };
    });
  }
  getActiveAccount() {
    if (this.activeAccountId) {
      const found = this.accounts.find((a) => a.id === this.activeAccountId);
      if (found) return found;
    }
    return this.accounts[0];
  }
  getAccountById(id) {
    return this.accounts.find((a) => a.id === id);
  }
  findAccountByQuery(query) {
    const q = query.trim().toLowerCase();
    if (!q) return void 0;
    return this.accounts.find((a) => a.id.toLowerCase() === q) ?? this.accounts.find((a) => a.email.toLowerCase() === q) ?? this.accounts.find((a) => a.email.toLowerCase().includes(q));
  }
  getQuota(accountId) {
    const id = accountId ?? this.activeAccountId ?? this.accounts[0]?.id;
    return id ? this.quotaCache.get(id) : void 0;
  }
  setQuota(snapshot) {
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
  async upsertAccountFromOAuth(creds) {
    await this.ensureLoaded();
    const existing = this.accounts.find(
      (a) => a.email.toLowerCase() === creds.email.toLowerCase()
    );
    if (existing) {
      existing.accessToken = creds.accessToken;
      existing.refreshToken = creds.refreshToken;
      existing.expiresAt = creds.expiresAt;
      existing.name = creds.name ?? existing.name;
      existing.needsReauth = false;
      existing.lastError = void 0;
      existing.cooldownUntil = void 0;
      this.activeAccountId = existing.id;
      await this.persist();
      return existing;
    }
    const record = {
      id: randomUUID(),
      email: creds.email,
      ...creds.name ? { name: creds.name } : {},
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      needsReauth: false,
      addedAt: Date.now()
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
  async removeAccount(accountId) {
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
  async clearAll() {
    await this.ensureLoaded();
    this.accounts = [];
    this.activeAccountId = void 0;
    this.sessionBindings.clear();
    this.quotaCache.clear();
    await this.persist();
  }
  async updateAccountMeta(accountId, patch) {
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
  async ensureFreshToken(accountId, signal) {
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
          signal
        );
        current.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) {
          current.refreshToken = refreshed.refreshToken;
        }
        current.expiresAt = refreshed.expiresAt;
        current.needsReauth = false;
        current.lastError = void 0;
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
  isAccountQuotaLowOrExhausted(accountId, pool) {
    const quota = this.quotaCache.get(accountId);
    const lowest = lowestFractionOf(quota, pool);
    return lowest !== void 0 && lowest <= this.config.quotaExhaustedThreshold;
  }
  pickAlternativeAccount(excludeId, pool) {
    const now = Date.now();
    const candidates = this.accounts.filter((a) => a.id !== excludeId);
    if (candidates.length === 0) return void 0;
    const score = (acc) => {
      if (acc.needsReauth) return -1e3;
      const cooling = acc.cooldownUntil !== void 0 && acc.cooldownUntil > now;
      const quotaFrac = lowestFractionOf(this.quotaCache.get(acc.id), pool);
      const exhausted = quotaFrac !== void 0 && quotaFrac <= this.config.quotaExhaustedThreshold;
      let s = 100;
      if (cooling) s -= 60;
      if (exhausted) s -= 40;
      if (acc.id === this.activeAccountId) s += 10;
      if (quotaFrac !== void 0) s += quotaFrac * 20;
      return s;
    };
    const eligible = candidates.filter((a) => !a.needsReauth).sort((a, b) => score(b) - score(a));
    return eligible[0];
  }
  /**
   * Sticky session account selection (NEVER round-robin).
   */
  selectAccountForSession(sessionKey, pool) {
    if (this.accounts.length === 0) {
      throw new Error("No Google accounts signed in for Antigravity");
    }
    const now = Date.now();
    const binding = this.sessionBindings.get(sessionKey);
    if (binding) {
      const boundAcc = this.getAccountById(binding.accountId);
      if (boundAcc) {
        const streakTriggered = binding.failureStreak >= this.config.failureSwitchThreshold;
        const quotaTriggered = this.isAccountQuotaLowOrExhausted(boundAcc.id, pool);
        const unavailable = boundAcc.needsReauth;
        const inCooldown = boundAcc.cooldownUntil !== void 0 && boundAcc.cooldownUntil > now;
        if (!streakTriggered && !quotaTriggered && !unavailable && !inCooldown) {
          boundAcc.lastUsedAt = now;
          return { account: boundAcc };
        }
        const alt = this.pickAlternativeAccount(boundAcc.id, pool);
        if (alt) {
          const reason = quotaTriggered ? "quota" : streakTriggered ? "streak" : "unavailable";
          const switchEvt = this.recordSwitch({
            sessionId: sessionKey,
            from: boundAcc,
            to: alt,
            reason,
            detail: boundAcc.lastError
          });
          this.sessionBindings.set(sessionKey, {
            accountId: alt.id,
            failureStreak: 0,
            boundAt: now
          });
          this.activeAccountId = alt.id;
          alt.lastUsedAt = now;
          return { account: alt, switchedFrom: switchEvt };
        }
        if (!unavailable) {
          boundAcc.lastUsedAt = now;
          return { account: boundAcc };
        }
        throw new Error(
          `Account ${boundAcc.email} requires re-authentication and no backup account is available`
        );
      }
    }
    const initial = this.getActiveAccount() && !this.getActiveAccount().needsReauth ? this.getActiveAccount() : this.pickAlternativeAccount(void 0, pool);
    if (!initial || initial.needsReauth) {
      throw new Error(
        "All Antigravity accounts require re-authentication. Please sign in again."
      );
    }
    this.sessionBindings.set(sessionKey, {
      accountId: initial.id,
      failureStreak: 0,
      boundAt: now
    });
    initial.lastUsedAt = now;
    return { account: initial };
  }
  /**
   * Manual user switchovers update active account and rebind live sessions cleanly,
   * flagging a cache-cold warning notice for UI transparency.
   */
  async manualSwitchAccount(accountId, sessionKey) {
    await this.ensureLoaded();
    const target = this.getAccountById(accountId);
    if (!target) {
      throw new Error(`Account "${accountId}" not found`);
    }
    const prev = (sessionKey ? this.getAccountById(this.sessionBindings.get(sessionKey)?.accountId ?? "") : void 0) ?? this.getActiveAccount();
    this.activeAccountId = target.id;
    target.cooldownUntil = void 0;
    const now = Date.now();
    if (sessionKey) {
      this.sessionBindings.set(sessionKey, {
        accountId: target.id,
        failureStreak: 0,
        boundAt: now
      });
    } else {
      for (const sid of this.sessionBindings.keys()) {
        this.sessionBindings.set(sid, {
          accountId: target.id,
          failureStreak: 0,
          boundAt: now
        });
      }
    }
    await this.persist();
    return this.recordSwitch({
      ...sessionKey ? { sessionId: sessionKey } : {},
      from: prev && prev.id !== target.id ? prev : void 0,
      to: target,
      reason: "manual"
    });
  }
  recordSuccess(accountId, sessionKey) {
    const binding = this.sessionBindings.get(sessionKey);
    if (binding && binding.accountId === accountId) {
      binding.failureStreak = 0;
      binding.lastFailureCategory = void 0;
    }
    const acc = this.getAccountById(accountId);
    if (acc) {
      acc.cooldownUntil = void 0;
      acc.lastError = void 0;
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
  recordFailure(params) {
    const acc = this.getAccountById(params.accountId);
    if (acc) {
      acc.lastError = params.message;
    }
    if (params.category !== "AUTH" && params.category !== "QUOTA" && params.category !== "RATE_LIMIT") {
      return void 0;
    }
    if (acc && params.category === "RATE_LIMIT") {
      const waitMs = Math.min(3e5, Math.max(5e3, params.retryAfterMs ?? 3e4));
      acc.cooldownUntil = Date.now() + waitMs;
    } else if (acc && params.category === "QUOTA") {
      const waitMs = Math.min(36e5, Math.max(6e4, params.retryAfterMs ?? 3e5));
      acc.cooldownUntil = Date.now() + waitMs;
    }
    let binding = this.sessionBindings.get(params.sessionKey);
    if (!binding || binding.accountId !== params.accountId) {
      binding = {
        accountId: params.accountId,
        failureStreak: 0,
        boundAt: Date.now()
      };
      this.sessionBindings.set(params.sessionKey, binding);
    }
    binding.failureStreak += 1;
    binding.lastFailureCategory = params.category;
    const shouldSwitchNow = params.category === "QUOTA" || binding.failureStreak >= this.config.failureSwitchThreshold;
    if (!shouldSwitchNow) {
      return void 0;
    }
    const alt = this.pickAlternativeAccount(params.accountId, params.pool);
    if (!alt) {
      return void 0;
    }
    const reason = params.category === "QUOTA" ? "quota" : "streak";
    const switchEvt = this.recordSwitch({
      sessionId: params.sessionKey,
      from: acc,
      to: alt,
      reason,
      detail: params.message
    });
    this.sessionBindings.set(params.sessionKey, {
      accountId: alt.id,
      failureStreak: 0,
      boundAt: Date.now()
    });
    this.activeAccountId = alt.id;
    void this.persist();
    return switchEvt;
  }
  getUpstreamSessionGeneration(accountId, sessionKey) {
    return this.upstreamSessionGeneration.get(`${accountId}::${sessionKey}`) ?? 0;
  }
  bumpUpstreamSessionGeneration(accountId, sessionKey) {
    const key = `${accountId}::${sessionKey}`;
    const next = (this.upstreamSessionGeneration.get(key) ?? 0) + 1;
    this.upstreamSessionGeneration.set(key, next);
    return next;
  }
  getColdNotice() {
    return this.coldNotice ? { ...this.coldNotice } : void 0;
  }
  dismissColdNotice() {
    this.coldNotice = void 0;
  }
  getRecentSwitches() {
    return [...this.recentSwitches];
  }
  recordSwitch(params) {
    const evt = {
      ...params.sessionId ? { sessionId: params.sessionId } : {},
      ...params.from ? { fromAccountId: params.from.id, fromEmail: params.from.email } : {},
      toAccountId: params.to.id,
      toEmail: params.to.email,
      reason: params.reason,
      ...params.detail ? { detail: params.detail } : {},
      at: Date.now()
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
};

// packages/dsh-antigravity/src/host/catalog.ts
import {
  ReasoningEffortId
} from "@deepseek-ai/dsh-llm";
import path3 from "node:path";

// packages/dsh-antigravity/src/host/config.ts
import Schema from "@deepseek-ai/schemastery";
var PROVIDER_ID = "antigravity";
var PROVIDER_DISPLAY_NAME = "Antigravity (Cloud Code \xB7 Unofficial)";
var DEFAULT_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
];
var DEFAULT_QUOTA_WARN_THRESHOLD = 0.15;
var DEFAULT_QUOTA_EXHAUSTED_THRESHOLD = 0.05;
var DEFAULT_FAILURE_SWITCH_THRESHOLD = 3;
var DEFAULT_REQUEST_TIMEOUT_MS = 12e4;
var DEFAULT_STREAM_IDLE_TIMEOUT_MS = 6e4;
var DEFAULT_OAUTH_PORT = 51121;
var DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 4194304;
var DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1048576;
var effortEnum = Schema.union([
  "auto",
  "low",
  "medium",
  "high"
]).default("auto");
var Config = Schema.object({
  userAgent: Schema.string().description("Optional Hub User-Agent override (sanitized against Antigravity Hub version floor)").volatile(),
  endpoints: Schema.array(Schema.string()).default([...DEFAULT_ENDPOINTS]).description("Ordered Cloud Code internal endpoints (Daily -> Sandbox -> Prod)").volatile(),
  oauthPort: Schema.number().min(1024).max(65535).default(DEFAULT_OAUTH_PORT).description("Preferred localhost port for OAuth PKCE callback listener").volatile(),
  requestTimeoutMs: Schema.number().min(5e3).max(6e5).default(DEFAULT_REQUEST_TIMEOUT_MS).description("HTTP request / header connect timeout in milliseconds").volatile(),
  streamIdleTimeoutMs: Schema.number().min(5e3).max(6e5).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).description("Streaming idle watchdog timeout between SSE chunks in milliseconds").volatile(),
  quotaWarnThreshold: Schema.number().min(0.01).max(0.9).default(DEFAULT_QUOTA_WARN_THRESHOLD).description("Remaining quota fraction below which UI warns user").volatile(),
  quotaExhaustedThreshold: Schema.number().min(0).max(0.5).default(DEFAULT_QUOTA_EXHAUSTED_THRESHOLD).description("Remaining quota fraction at or below which sticky session switches account").volatile(),
  failureSwitchThreshold: Schema.number().min(1).max(10).default(DEFAULT_FAILURE_SWITCH_THRESHOLD).description("Consecutive AUTH/QUOTA/RATE_LIMIT failures on same account before switching").volatile(),
  includeNonGeminiModels: Schema.boolean().default(false).description("Expose non-Gemini models returned by fetchAvailableModels (experimental)").volatile(),
  defaultThinkingEffort: effortEnum.description("Default reasoning effort when caller omits reasoningEffort").volatile(),
  storageDir: Schema.string().description("Optional override directory for Antigravity credentials and settings").volatile()
});
function sanitizeEndpointList(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_ENDPOINTS];
  const cleaned = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().replace(/\/+$/, "");
    if (trimmed.startsWith("https://")) cleaned.push(trimmed);
  }
  return cleaned.length > 0 ? [...new Set(cleaned)] : [...DEFAULT_ENDPOINTS];
}
function clampNumber(raw, fallback, min, max, integer = false) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const clamped = Math.min(max, Math.max(min, raw));
  return integer ? Math.trunc(clamped) : clamped;
}
function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === "object" ? raw : {};
  const userAgent = typeof input.userAgent === "string" && input.userAgent.trim() !== "" ? input.userAgent.trim() : void 0;
  const storageDir = typeof input.storageDir === "string" && input.storageDir.trim() !== "" ? input.storageDir.trim() : void 0;
  const oauthClientId = typeof input.oauthClientId === "string" && input.oauthClientId.trim() !== "" ? input.oauthClientId.trim() : void 0;
  const oauthClientSecret = typeof input.oauthClientSecret === "string" && input.oauthClientSecret.trim() !== "" ? input.oauthClientSecret.trim() : void 0;
  const effort = input.defaultThinkingEffort;
  const defaultThinkingEffort = effort === "low" || effort === "medium" || effort === "high" || effort === "auto" ? effort : "auto";
  const quotaExhaustedThreshold = clampNumber(
    input.quotaExhaustedThreshold,
    DEFAULT_QUOTA_EXHAUSTED_THRESHOLD,
    0,
    0.5
  );
  const quotaWarnThreshold = Math.max(
    quotaExhaustedThreshold,
    clampNumber(input.quotaWarnThreshold, DEFAULT_QUOTA_WARN_THRESHOLD, 0.01, 0.9)
  );
  return {
    userAgent,
    endpoints: sanitizeEndpointList(input.endpoints),
    oauthClientId,
    oauthClientSecret,
    oauthPort: clampNumber(input.oauthPort, DEFAULT_OAUTH_PORT, 1024, 65535, true),
    requestTimeoutMs: clampNumber(
      input.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      5e3,
      6e5,
      true
    ),
    streamIdleTimeoutMs: clampNumber(
      input.streamIdleTimeoutMs,
      DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      5e3,
      6e5,
      true
    ),
    quotaWarnThreshold,
    quotaExhaustedThreshold,
    failureSwitchThreshold: clampNumber(
      input.failureSwitchThreshold,
      DEFAULT_FAILURE_SWITCH_THRESHOLD,
      1,
      10,
      true
    ),
    includeNonGeminiModels: input.includeNonGeminiModels === true,
    defaultThinkingEffort,
    storageDir,
    requestImagePixelBudget: clampNumber(
      input.requestImagePixelBudget,
      DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
      1,
      33554432,
      true
    ),
    requestImageMaxBytes: clampNumber(
      input.requestImageMaxBytes,
      DEFAULT_REQUEST_IMAGE_MAX_BYTES,
      1024,
      20971520,
      true
    )
  };
}

// packages/dsh-antigravity/src/host/identity.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { attributionHeaders } from "@deepseek-ai/dsh-llm";
var OFFICIAL_HUB_VERSION = "2.28.0";
var OFFICIAL_HUB_CL = "1008300195";
var MIN_STABLE_LEGACY_VERSION = "4.3.0";
function resolveHostPlatformTags(platform = process.platform, arch = process.arch) {
  const osType = platform === "darwin" ? "darwin" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : platform;
  const mappedArch = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : arch === "ia32" ? "386" : arch;
  return { osType, arch: mappedArch };
}
var DISALLOWED_HEADER_NAMES = /* @__PURE__ */ new Set([
  "x-session-id",
  "x-client-name",
  "x-client-version",
  "x-machine-id",
  "x-vscode-sessionid",
  "x-goog-api-client",
  "client-metadata",
  "user-agent",
  "authorization",
  "content-type",
  "accept-encoding",
  "x-goog-user-project"
]);
function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
function parseSemverTuple(raw) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) return void 0;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function buildHubUserAgent(options) {
  const version = options?.version?.trim() || OFFICIAL_HUB_VERSION;
  const cl = options?.cl?.trim() || OFFICIAL_HUB_CL;
  const host = resolveHostPlatformTags();
  const osType = options?.osType?.trim() || host.osType;
  const arch = options?.arch?.trim() || host.arch;
  return `antigravity/hub/${version} (aidev_client; os_type=${osType}; arch=${arch}; cl=${cl})`;
}
var DEFAULT_HUB_USER_AGENT = buildHubUserAgent();
function sanitizeUserAgent(raw) {
  if (!raw) return DEFAULT_HUB_USER_AGENT;
  const cleaned = raw.replace(/[\r\n\0]+/g, " ").trim();
  if (!cleaned) return DEFAULT_HUB_USER_AGENT;
  if (/^antigravity\/hub\//i.test(cleaned)) {
    return cleaned;
  }
  if (!/antigravity/i.test(cleaned)) {
    return DEFAULT_HUB_USER_AGENT;
  }
  const versionMatch = /^antigravity\/(\d+\.\d+\.\d+)(.*)$/i.exec(cleaned);
  if (versionMatch) {
    const parsed = parseSemverTuple(versionMatch[1]);
    const minTuple = parseSemverTuple(MIN_STABLE_LEGACY_VERSION);
    if (parsed && compareSemver(parsed, minTuple) < 0) {
      return `antigravity/${MIN_STABLE_LEGACY_VERSION}${versionMatch[2]}`;
    }
  }
  return cleaned;
}
function buildOutboundHeaders(params) {
  const headers = {};
  if (params.extraHeaders) {
    for (const [key, value] of Object.entries(params.extraHeaders)) {
      const lower = key.toLowerCase();
      if (DISALLOWED_HEADER_NAMES.has(lower) || lower.startsWith("x-jeikcode")) {
        continue;
      }
      const cleanVal = String(value).replace(/[\r\n\0]+/g, " ").trim();
      if (cleanVal) headers[key] = cleanVal;
    }
  }
  headers["Content-Type"] = "application/json";
  headers["Accept-Encoding"] = "gzip";
  headers["Authorization"] = `Bearer ${params.accessToken}`;
  headers["User-Agent"] = sanitizeUserAgent(params.userAgent);
  const normalizedProject = params.projectId?.trim();
  if (!params.isContentRequest && normalizedProject && normalizedProject.toLowerCase() !== "aicode-consumers") {
    headers["x-goog-user-project"] = normalizedProject;
  }
  return headers;
}
function resolveOfficialFingerprint(email) {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || normalized.endsWith("@gmail.com") || normalized.endsWith("@googlemail.com")) {
    return { envelopeUserAgent: "antigravity", ideType: "ANTIGRAVITY" };
  }
  return { envelopeUserAgent: "jetski", ideType: "JETSKI" };
}
function deriveConversationId(sessionId) {
  const seed = sessionId && sessionId.trim() !== "" ? sessionId.trim() : "default";
  return createHash2("sha256").update(seed).digest("hex").slice(0, 16);
}
function deriveTrajectoryId(seed) {
  if (seed && seed.trim() !== "") {
    return createHash2("sha256").update(seed.trim()).digest("hex").slice(0, 8);
  }
  return randomUUID2().replace(/-/g, "").slice(0, 8);
}
function buildOfficialRequestId(sessionId, step, trajectoryId, nowMs = Date.now()) {
  const conversationId = deriveConversationId(sessionId);
  const traj = trajectoryId && /^[0-9a-f]{8}$/i.test(trajectoryId) ? trajectoryId.toLowerCase() : deriveTrajectoryId();
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.trunc(step) : 0;
  return `agent/${conversationId}/${Math.trunc(nowMs)}/${traj}/${safeStep}`;
}
function extractTrajectoryId(requestId) {
  const parts = requestId.split("/");
  if (parts.length >= 4 && parts[3]) return parts[3];
  return deriveTrajectoryId(requestId);
}
var FNV_OFFSET_BASIS_I64 = -3750763034362895579n;
var FNV_PRIME_64 = 1099511628211n;
function deriveUpstreamSessionId(accountId, sessionId, generation = 0) {
  const fingerprint = sessionId?.trim() ?? "";
  const input = fingerprint === "" && generation === 0 ? accountId : `${accountId}|${fingerprint}|${generation}`;
  const bytes = Buffer.from(input, "utf8");
  let hash = BigInt.asUintN(64, FNV_OFFSET_BASIS_I64);
  for (const byte of bytes) {
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64);
    hash = BigInt.asUintN(64, hash ^ BigInt(byte));
  }
  return BigInt.asIntN(64, hash).toString();
}

// packages/dsh-antigravity/src/host/quota.ts
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function readString(obj, ...keys) {
  if (!obj) return void 0;
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim() !== "") return val.trim();
  }
  return void 0;
}
function readNumber(obj, ...keys) {
  if (!obj) return void 0;
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return void 0;
}
function extractProjectId(data) {
  const raw = data.cloudaicompanionProject ?? data.projectId ?? data.project;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  const obj = asRecord(raw);
  return readString(obj, "id", "projectId");
}
function normalizeTierLabel(tierId, tierName) {
  const combined = `${tierId ?? ""} ${tierName ?? ""}`.toLowerCase();
  if (combined.includes("ultra")) return "Ultra";
  if (combined.includes("pro")) return "Pro";
  if (combined.includes("enterprise")) return "Enterprise";
  if (combined.includes("standard")) return "Standard";
  if (combined.includes("free")) return "Free";
  return tierName || tierId;
}
function extractTierInfo(data) {
  const projectId = extractProjectId(data);
  const paidTier = asRecord(data.paidTier);
  const currentTier = asRecord(data.currentTier);
  const allowed = Array.isArray(data.allowedTiers) ? data.allowedTiers : [];
  const defaultAllowed = allowed.map(asRecord).find((item) => item && item.isDefault === true) ?? asRecord(allowed[0]);
  const tierObj = paidTier ?? currentTier ?? defaultAllowed;
  const tierId = readString(tierObj, "id", "tierId");
  const tierName = readString(tierObj, "name", "displayName");
  return {
    projectId,
    tierId,
    tierLabel: normalizeTierLabel(tierId, tierName)
  };
}
async function loadCodeAssist(params) {
  const { ideType } = resolveOfficialFingerprint(params.email);
  const body = {
    ...params.projectIdHint ? { cloudaicompanionProject: params.projectIdHint } : {},
    metadata: { ideType }
  };
  const { response } = await params.client.post({
    method: "loadCodeAssist",
    body,
    accessToken: params.accessToken,
    projectId: params.projectIdHint,
    isContentRequest: false,
    signal: params.signal
  });
  const json = await response.json();
  return extractTierInfo(json);
}
function classifyPool(modelId, labelOrProvider) {
  const lower = `${modelId} ${labelOrProvider ?? ""}`.toLowerCase();
  if (lower.includes("flash") && lower.includes("gemini")) return "gemini-flash";
  if (lower.includes("gemini") || lower.includes("bison")) return "gemini-pro";
  if (lower.includes("claude") || lower.includes("anthropic") || lower.includes("gpt") || lower.includes("openai") || lower.includes("3p")) {
    return "claude-3p";
  }
  return "other";
}
function poolDisplayLabel(pool) {
  switch (pool) {
    case "gemini-pro":
      return "Gemini Pro";
    case "gemini-flash":
      return "Gemini Flash";
    case "claude-3p":
      return "Claude / 3P";
    default:
      return "Other Models";
  }
}
function normalizeUpstreamModelId(rawId) {
  const trimmed = rawId.trim();
  const enumMap = {
    MODEL_GOOGLE_GEMINI_2_5_PRO: "gemini-2.5-pro",
    MODEL_GOOGLE_GEMINI_2_5_FLASH: "gemini-2.5-flash",
    MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING: "gemini-2.5-flash",
    MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE: "gemini-2.5-flash-lite"
  };
  if (enumMap[trimmed]) return enumMap[trimmed];
  if (trimmed.startsWith("MODEL_GOOGLE_")) {
    return trimmed.slice("MODEL_GOOGLE_".length).toLowerCase().replace(/_/g, "-").replace(/(\d)-(\d)/g, "$1.$2");
  }
  return trimmed;
}
function parseAvailableModelsResponse(raw) {
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  const modelsField = raw.models ?? raw.availableModels ?? raw.available_models ?? raw.clientModelConfigs ?? raw.client_model_configs;
  const pushEntry = (key, val) => {
    const obj = asRecord(val);
    if (!obj) return;
    const modelOrAlias = asRecord(obj.modelOrAlias ?? obj.model_or_alias);
    const rawId = readString(obj, "model", "modelId", "model_id", "id", "name") ?? readString(modelOrAlias, "model", "alias") ?? (key.trim() || void 0);
    if (!rawId) return;
    const id = normalizeUpstreamModelId(rawId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const quotaInfo = asRecord(obj.quotaInfo ?? obj.quota_info);
    const remainingFraction = readNumber(
      quotaInfo,
      "remainingFraction",
      "remaining_fraction"
    );
    const resetTime = readString(quotaInfo, "resetTime", "reset_time");
    const supportsThinking = typeof obj.supportsThinking === "boolean" ? obj.supportsThinking : typeof obj.supports_thinking === "boolean" ? obj.supports_thinking : void 0;
    const supportsImages = typeof obj.supportsImages === "boolean" ? obj.supportsImages : typeof obj.supports_images === "boolean" ? obj.supports_images : void 0;
    const isInternal = obj.isInternal === true || obj.is_internal === true;
    results.push({
      id,
      displayName: readString(obj, "displayName", "display_name", "label"),
      model: readString(obj, "model") ?? readString(modelOrAlias, "model"),
      modelProvider: readString(obj, "modelProvider", "model_provider"),
      maxTokens: readNumber(
        obj,
        "maxTokens",
        "max_tokens",
        "inputTokenLimit",
        "input_token_limit"
      ),
      maxOutputTokens: readNumber(
        obj,
        "maxOutputTokens",
        "max_output_tokens",
        "outputTokenLimit",
        "output_token_limit"
      ),
      supportsThinking,
      supportsImages,
      isInternal,
      ...remainingFraction !== void 0 ? { remainingFraction: Math.max(0, Math.min(1, remainingFraction)) } : {},
      ...resetTime ? { resetTime } : {}
    });
  };
  if (Array.isArray(modelsField)) {
    for (const item of modelsField) {
      const obj = asRecord(item);
      const modelOrAlias = asRecord(obj?.modelOrAlias ?? obj?.model_or_alias);
      const key = readString(obj, "id", "model", "modelId", "model_id", "name") ?? readString(modelOrAlias, "model", "alias") ?? "";
      pushEntry(key, item);
    }
  } else {
    const mapObj = asRecord(modelsField);
    if (mapObj) {
      for (const [key, val] of Object.entries(mapObj)) {
        pushEntry(key, val);
      }
    }
  }
  return results;
}
function classifyQuotaWindow(label, bucketId, resetTime) {
  const text = `${label ?? ""} ${bucketId ?? ""}`.toLowerCase();
  if (/week|每周|周限|7d|168h/.test(text)) return "weekly";
  if (/5h|小时|day|daily|日限|24h/.test(text)) return "daily";
  if (resetTime) {
    const target = Date.parse(resetTime);
    if (Number.isFinite(target) && target - Date.now() > 24 * 60 * 60 * 1e3) {
      return "weekly";
    }
  }
  return "daily";
}
function buildQuotaGroups(params) {
  const summaryGroups = [];
  const pushBucket = (item, parentLabel, index = 0) => {
    const fraction = readNumber(item, "remainingFraction", "remaining_fraction");
    if (fraction === void 0) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    const resetTime = readString(item, "resetTime", "reset_time");
    const modelId = readString(item, "modelId", "model_id", "model", "tokenType", "token_type") ?? "";
    const bucketId = readString(item, "bucketId", "bucket_id", "id");
    const bucketLabel = readString(item, "displayName", "display_name", "label", "title", "name", "groupName", "modelGroup");
    const windowLabel = readString(item, "window", "period", "duration");
    let combinedLabel = bucketLabel ?? "";
    if (parentLabel && bucketLabel) {
      combinedLabel = bucketLabel.toLowerCase().includes(parentLabel.toLowerCase()) ? bucketLabel : `${parentLabel} ${bucketLabel}`;
    } else if (parentLabel && !bucketLabel) {
      combinedLabel = windowLabel || bucketId ? `${parentLabel} ${windowLabel ?? bucketId}` : parentLabel;
    } else if (!combinedLabel && (windowLabel || bucketId)) {
      combinedLabel = windowLabel ?? bucketId ?? "";
    }
    const pool = classifyPool(modelId, `${combinedLabel} ${parentLabel ?? ""}`);
    const finalLabel = combinedLabel || poolDisplayLabel(pool);
    const idBase = bucketId ?? `${pool}-${index}`;
    const uniqueId = summaryGroups.some((g) => g.id === idBase) ? `${idBase}-${index}` : idBase;
    const windowType = classifyQuotaWindow(
      `${finalLabel} ${windowLabel ?? ""}`,
      bucketId,
      resetTime
    );
    summaryGroups.push({
      id: uniqueId,
      label: finalLabel,
      pool,
      windowType,
      remainingFraction: clamped,
      ...resetTime ? { resetTime } : {},
      isLow: clamped < params.config.quotaWarnThreshold,
      isExhausted: clamped <= params.config.quotaExhaustedThreshold,
      modelIds: modelId ? [modelId] : []
    });
  };
  if (Array.isArray(params.summaryRaw?.groups)) {
    let idx = 0;
    for (const grp of params.summaryRaw.groups) {
      const grpObj = asRecord(grp);
      if (!grpObj) continue;
      const grpLabel = readString(grpObj, "displayName", "display_name", "label", "title", "groupName", "name");
      const grpBuckets = Array.isArray(grpObj.buckets) ? grpObj.buckets : [];
      if (grpBuckets.length > 0) {
        for (const b of grpBuckets) {
          const bObj = asRecord(b);
          if (bObj) pushBucket(bObj, grpLabel, idx++);
        }
      } else if (readNumber(grpObj, "remainingFraction", "remaining_fraction") !== void 0) {
        pushBucket(grpObj, void 0, idx++);
      }
    }
  }
  const topLevelBuckets = (Array.isArray(params.summaryRaw?.buckets) ? params.summaryRaw.buckets : void 0) ?? (Array.isArray(params.summaryRaw?.userQuotaSummary) ? params.summaryRaw.userQuotaSummary : void 0) ?? (Array.isArray(params.summaryRaw?.quotaBuckets) ? params.summaryRaw.quotaBuckets : void 0) ?? [];
  for (let i = 0; i < topLevelBuckets.length; i++) {
    const obj = asRecord(topLevelBuckets[i]);
    if (obj) pushBucket(obj, void 0, summaryGroups.length + i);
  }
  if (summaryGroups.length > 0) {
    return summaryGroups;
  }
  const byPool = /* @__PURE__ */ new Map();
  for (const m of params.models) {
    if (m.remainingFraction === void 0 && !m.resetTime) continue;
    const pool = classifyPool(m.id, `${m.displayName ?? ""} ${m.modelProvider ?? ""}`);
    let entry = byPool.get(pool);
    if (!entry) {
      entry = { modelIds: /* @__PURE__ */ new Set() };
      byPool.set(pool, entry);
    }
    entry.modelIds.add(m.id);
    if (m.remainingFraction !== void 0) {
      entry.minFraction = entry.minFraction === void 0 ? m.remainingFraction : Math.min(entry.minFraction, m.remainingFraction);
    }
    if (m.resetTime && !entry.resetTime) entry.resetTime = m.resetTime;
  }
  const order = [
    "gemini-pro",
    "gemini-flash",
    "claude-3p",
    "other"
  ];
  const groups = [];
  for (const pool of order) {
    const entry = byPool.get(pool);
    if (!entry || entry.minFraction === void 0) continue;
    const remainingFraction = entry.minFraction;
    groups.push({
      id: pool,
      label: poolDisplayLabel(pool),
      pool,
      remainingFraction,
      ...entry.resetTime ? { resetTime: entry.resetTime } : {},
      isLow: remainingFraction < params.config.quotaWarnThreshold,
      isExhausted: remainingFraction <= params.config.quotaExhaustedThreshold,
      modelIds: [...entry.modelIds].sort()
    });
  }
  return groups;
}
async function fetchAccountQuotaAndModels(params) {
  const errors = [];
  let projectId = params.projectIdHint;
  let tierLabel;
  let tierId;
  try {
    const assist = await loadCodeAssist({
      client: params.client,
      accessToken: params.accessToken,
      email: params.email,
      projectIdHint: projectId,
      signal: params.signal
    });
    if (assist.projectId) projectId = assist.projectId;
    tierLabel = assist.tierLabel;
    tierId = assist.tierId;
  } catch (error) {
    errors.push(`loadCodeAssist: ${error instanceof Error ? error.message : String(error)}`);
  }
  let models = [];
  const { ideType } = resolveOfficialFingerprint(params.email);
  try {
    const { response } = await params.client.post({
      method: "fetchAvailableModels",
      body: projectId ? { project: projectId } : { metadata: { ideType } },
      accessToken: params.accessToken,
      projectId,
      isContentRequest: false,
      signal: params.signal
    });
    const rawModels = await response.json();
    models = parseAvailableModelsResponse(rawModels);
  } catch (error) {
    errors.push(
      `fetchAvailableModels: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let summaryRaw;
  if (projectId) {
    try {
      const { response } = await params.client.post({
        method: "retrieveUserQuotaSummary",
        body: { project: projectId },
        accessToken: params.accessToken,
        projectId,
        isContentRequest: false,
        signal: params.signal
      });
      summaryRaw = await response.json();
    } catch (error) {
      errors.push(
        `retrieveUserQuotaSummary: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const groups = buildQuotaGroups({
    models,
    summaryRaw,
    config: params.config
  });
  return {
    snapshot: {
      accountId: params.accountId,
      email: params.email,
      ...projectId ? { projectId } : {},
      ...tierLabel ? { tierLabel } : {},
      ...tierId ? { tierId } : {},
      fetchedAt: Date.now(),
      degraded: errors.length > 0 && groups.length === 0,
      ...errors.length > 0 && groups.length === 0 ? { error: errors.join("; ") } : {},
      groups
    },
    models
  };
}

// packages/dsh-antigravity/src/host/catalog.ts
var STATIC_GEMINI_MODELS = [
  {
    id: "gemini-4-hydrogen-xhigh",
    name: "Gemini 4 Hydrogen (XHigh)",
    description: "Antigravity Gemini 4 Hydrogen with maximum XHigh reasoning",
    defaultEnabled: true,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "high",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-4-hydrogen-high",
    name: "Gemini 4 Hydrogen (High)",
    description: "Antigravity Gemini 4 Hydrogen flagship with high reasoning",
    defaultEnabled: true,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "high",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-4-hydrogen-medium",
    name: "Gemini 4 Hydrogen (Medium)",
    description: "Balanced Gemini 4 Hydrogen tier for everyday coding",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "medium",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-4-hydrogen-low",
    name: "Gemini 4 Hydrogen (Low)",
    description: "Fast Gemini 4 Hydrogen tier with light thinking overhead",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "low",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-4-argon-high",
    name: "Gemini 4 Argon (High)",
    description: "Gemini 4 Argon high-reasoning model for Pro & Ultra plans",
    defaultEnabled: true,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "high",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-4-argon-medium",
    name: "Gemini 4 Argon (Medium)",
    description: "Gemini 4 Argon balanced tier for Pro & Ultra plans",
    defaultEnabled: true,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "medium",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-4-argon-low",
    name: "Gemini 4 Argon (Low)",
    description: "Fast Gemini 4 Argon tier for Pro & Ultra plans",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "low",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-pro-orchestrator-g1-pro",
    name: "Orchestrator (Argon)",
    description: "Antigravity Pro/Ultra orchestrator backed by Gemini 4 Argon",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "medium",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-4-carbon-high",
    name: "Gemini 4 Carbon (High)",
    description: "Gemini 4 Carbon deep reasoning tier (Ultra / entitled accounts)",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "high",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "ultra",
    isGemini3Series: true
  },
  {
    id: "gemini-4-carbon-medium",
    name: "Gemini 4 Carbon (Medium)",
    description: "Gemini 4 Carbon balanced tier (Ultra / entitled accounts)",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "medium",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "ultra",
    isGemini3Series: true
  },
  {
    id: "gemini-4-carbon-low",
    name: "Gemini 4 Carbon (Low)",
    description: "Gemini 4 Carbon fast tier (Ultra / entitled accounts)",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "low",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "ultra",
    isGemini3Series: true
  },
  {
    id: "gemini-3.8-flash-high",
    name: "Gemini 3.8 Flash (High)",
    description: "Gemini 3.8 Flash with deep thinking for fast agent loops",
    defaultEnabled: true,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "high",
    supportsImages: true,
    pool: "gemini-flash",
    tierAccess: "all",
    isGemini3Series: true
  },
  {
    id: "gemini-3.8-flash-medium",
    name: "Gemini 3.8 Flash (Medium)",
    description: "Gemini 3.8 Flash balanced speed & reasoning tier",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "medium",
    supportsImages: true,
    pool: "gemini-flash",
    tierAccess: "all",
    isGemini3Series: true
  },
  {
    id: "gemini-3.8-flash-low",
    name: "Gemini 3.8 Flash (Low)",
    description: "Ultra-low-latency Gemini 3.8 Flash tier",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "low",
    supportsImages: true,
    pool: "gemini-flash",
    tierAccess: "all",
    isGemini3Series: true
  },
  {
    id: "gemini-3.1-pro-high",
    name: "Gemini 3.1 Pro (High)",
    description: "Legacy Gemini 3.1 Pro with deep thinking",
    defaultEnabled: true,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "high",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-3.1-pro-low",
    name: "Gemini 3.1 Pro (Low)",
    description: "Fast Gemini 3.1 Pro tier with light thinking overhead",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "low",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro",
    isGemini3Series: true
  },
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash",
    description: "Low-latency Gemini 3 Flash for high-throughput agent loops",
    defaultEnabled: true,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "medium",
    supportsImages: true,
    pool: "gemini-flash",
    tierAccess: "all",
    isGemini3Series: true
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Stable Gemini 2.5 Pro coding and long-context model",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "medium",
    supportsImages: true,
    pool: "gemini-pro",
    tierAccess: "pro"
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Fast Gemini 2.5 Flash model with optional thinking budget",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: true,
    defaultEffort: "low",
    supportsImages: true,
    pool: "gemini-flash",
    tierAccess: "all"
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    description: "Ultra-light Gemini 2.5 Flash variant",
    defaultEnabled: false,
    contextWindow: 1048576,
    defaultMaxTokens: 65536,
    supportsReasoning: false,
    supportsImages: true,
    pool: "gemini-flash",
    tierAccess: "all"
  }
];
var MODEL_ALIASES = {
  "gemini-3-pro-high": "gemini-3.1-pro-high",
  "gemini-3-pro-low": "gemini-3.1-pro-low",
  "gemini-3.0-pro": "gemini-3.1-pro-high",
  "gemini-3.0-flash": "gemini-3-flash",
  "gemini-3-flash-preview": "gemini-3-flash",
  "gemini-3.1-pro-preview": "gemini-3.1-pro-high"
};
var REASONING_EFFORTS = [
  { id: ReasoningEffortId("low"), name: "Low", description: "Minimal thinking overhead" },
  { id: ReasoningEffortId("medium"), name: "Medium", description: "Balanced reasoning depth" },
  { id: ReasoningEffortId("high"), name: "High", description: "Maximum reasoning depth" }
];
function isGeminiModelId(modelId) {
  return modelId.toLowerCase().includes("gemini");
}
function normalizeModelId(modelId) {
  const trimmed = modelId.trim();
  return MODEL_ALIASES[trimmed] ?? trimmed;
}
function isGemini3SeriesModel(modelId) {
  const lower = modelId.toLowerCase();
  return /^gemini-(?:[3-9]|\d{2,})(?:\.|-|$)/.test(lower) || lower.startsWith("gemini-pro-orchestrator");
}
function inferModelTierAccess(modelId, displayName) {
  const lower = `${modelId} ${displayName ?? ""}`.toLowerCase();
  if (lower.includes("ultra") || lower.includes("gemini-4-carbon") || lower.endsWith("-max") || lower.includes("opus-5-5-max")) {
    return "ultra";
  }
  if (lower.includes("gemini-4-") || lower.includes("orchestrator") || lower.includes("-pro") || lower.includes("claude-") || lower.includes("gpt-")) {
    return "pro";
  }
  return "all";
}
function tierTagLabel(tier) {
  switch (tier) {
    case "ultra":
      return "Ultra";
    case "pro":
      return "Pro";
    default:
      return void 0;
  }
}
var AntigravityCatalog = class {
  constructor(config) {
    this.config = config;
    const storageDir = resolveAntigravityStorageDir(config.storageDir);
    this.settingsPath = path3.join(storageDir, "models.json");
    this.cachePath = path3.join(storageDir, "catalog-cache.json");
    this.enabledModelIds = STATIC_GEMINI_MODELS.filter((m) => m.defaultEnabled).map(
      (m) => m.id
    );
  }
  settingsPath;
  cachePath;
  enabledModelIds;
  loaded = false;
  dynamicModels = [];
  catalogSource = "static";
  async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    const saved = await readJsonFile(this.settingsPath).catch(
      () => void 0
    );
    if (saved && Array.isArray(saved.enabledModelIds)) {
      this.enabledModelIds = [...new Set(saved.enabledModelIds.filter((s) => typeof s === "string" && s.trim() !== ""))];
    }
    if (this.dynamicModels.length === 0) {
      const cached = await readJsonFile(this.cachePath).catch(
        () => void 0
      );
      if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
        this.dynamicModels = cached.models;
        this.catalogSource = "cache";
      }
    }
  }
  getCatalogSource() {
    return this.catalogSource;
  }
  async saveDynamicModels(models) {
    this.dynamicModels = [...models];
    if (models.length === 0) return;
    this.catalogSource = "upstream";
    await writePrivateJsonFile(this.cachePath, {
      version: 1,
      updatedAt: Date.now(),
      models: this.dynamicModels
    }).catch(() => void 0);
  }
  updateDynamicModels(models) {
    void this.saveDynamicModels(models);
  }
  async setEnabledModelIds(ids) {
    await this.ensureLoaded();
    this.enabledModelIds = [
      ...new Set(ids.filter((id) => typeof id === "string" && id.trim() !== "").map((id) => id.trim()))
    ];
    await writePrivateJsonFile(this.settingsPath, {
      version: 1,
      enabledModelIds: this.enabledModelIds
    });
    return [...this.enabledModelIds];
  }
  getEnabledModelIds() {
    return [...this.enabledModelIds];
  }
  defaultEnabledModelIds() {
    return STATIC_GEMINI_MODELS.filter((m) => m.defaultEnabled).map((m) => m.id);
  }
  mergedCatalog(quota) {
    const enabledSet = new Set(this.enabledModelIds);
    const quotaByModel = /* @__PURE__ */ new Map();
    const poolFallbackQuota = /* @__PURE__ */ new Map();
    for (const group of quota?.groups ?? []) {
      poolFallbackQuota.set(group.pool, {
        remainingFraction: group.remainingFraction,
        resetTime: group.resetTime
      });
      for (const mId of group.modelIds) {
        quotaByModel.set(mId, {
          remainingFraction: group.remainingFraction,
          resetTime: group.resetTime
        });
      }
    }
    const hasDynamic = this.dynamicModels.length > 0;
    const dynamicIds = new Set(this.dynamicModels.map((m) => m.id));
    const byId = /* @__PURE__ */ new Map();
    for (const entry of STATIC_GEMINI_MODELS) {
      const q = quotaByModel.get(entry.id) ?? poolFallbackQuota.get(entry.pool);
      byId.set(entry.id, {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        enabled: enabledSet.has(entry.id),
        defaultEnabled: entry.defaultEnabled,
        contextWindow: entry.contextWindow,
        defaultMaxTokens: entry.defaultMaxTokens,
        supportsReasoning: entry.supportsReasoning,
        supportsImages: entry.supportsImages,
        pool: entry.pool,
        tierAccess: entry.tierAccess,
        ...hasDynamic ? { isUpstreamAvailable: dynamicIds.has(entry.id) } : {},
        ...q?.remainingFraction !== void 0 ? { remainingFraction: q.remainingFraction } : {},
        ...q?.resetTime ? { resetTime: q.resetTime } : {},
        isDynamic: false
      });
    }
    for (const dyn of this.dynamicModels) {
      if (dyn.isInternal) continue;
      if (!this.config.includeNonGeminiModels && !isGeminiModelId(dyn.id)) {
        continue;
      }
      const existing = byId.get(dyn.id);
      const pool = existing?.pool ?? classifyPool(dyn.id, `${dyn.displayName ?? ""} ${dyn.modelProvider ?? ""}`);
      const tierAccess = existing?.tierAccess ?? inferModelTierAccess(dyn.id, dyn.displayName);
      const q = dyn.remainingFraction !== void 0 ? { remainingFraction: dyn.remainingFraction, resetTime: dyn.resetTime } : quotaByModel.get(dyn.id) ?? poolFallbackQuota.get(pool);
      byId.set(dyn.id, {
        id: dyn.id,
        name: existing?.name ?? dyn.displayName ?? dyn.id,
        description: existing?.description ?? `Antigravity upstream model (${dyn.modelProvider ?? "Google"})`,
        enabled: enabledSet.has(dyn.id),
        defaultEnabled: existing?.defaultEnabled ?? false,
        contextWindow: dyn.maxTokens ?? existing?.contextWindow ?? 1048576,
        defaultMaxTokens: dyn.maxOutputTokens ?? existing?.defaultMaxTokens ?? 65536,
        supportsReasoning: dyn.supportsThinking ?? existing?.supportsReasoning ?? isGeminiModelId(dyn.id),
        supportsImages: dyn.supportsImages ?? existing?.supportsImages ?? true,
        pool,
        tierAccess,
        isUpstreamAvailable: true,
        ...q?.remainingFraction !== void 0 ? { remainingFraction: q.remainingFraction } : {},
        ...q?.resetTime ? { resetTime: q.resetTime } : {},
        isDynamic: !existing
      });
    }
    const all = [...byId.values()];
    if (!hasDynamic) return all;
    return [
      ...all.filter((m) => m.isUpstreamAvailable),
      ...all.filter((m) => !m.isUpstreamAvailable)
    ];
  }
  async listModels(quota) {
    await this.ensureLoaded();
    const options = this.mergedCatalog(quota);
    const enabled = options.filter((o) => o.enabled);
    const finalExposed = enabled.length > 0 ? enabled : options.filter((o) => o.defaultEnabled);
    return finalExposed.map((opt) => {
      let badge;
      if (opt.remainingFraction !== void 0) {
        badge = {
          text: `${Math.round(opt.remainingFraction * 100)}%`,
          tone: opt.remainingFraction <= 0.1 ? "warning" : opt.remainingFraction >= 0.5 ? "success" : "neutral"
        };
      }
      const tierTag = tierTagLabel(opt.tierAccess ?? inferModelTierAccess(opt.id, opt.name));
      const suffix = tierTag ? `[${tierTag} \xB7 Antigravity Direct \xB7 Unofficial]` : `[Antigravity Direct \xB7 Unofficial]`;
      return {
        provider: PROVIDER_ID,
        id: opt.id,
        name: opt.name,
        description: `${opt.description} ${suffix}`,
        inputModalities: opt.supportsImages ? ["text", "image"] : ["text"],
        ...badge ? { badge } : {}
      };
    });
  }
  resolveModel(modelId) {
    const canonical = normalizeModelId(modelId);
    const option = this.mergedCatalog().find((m) => m.id === canonical || m.id === modelId) ?? STATIC_GEMINI_MODELS[0];
    const resolvedId = canonical || option.id;
    const defaultEffortId = this.config.defaultThinkingEffort !== "auto" ? ReasoningEffortId(this.config.defaultThinkingEffort) : option.id.endsWith("-high") || option.id.endsWith("-xhigh") || option.id.endsWith("-max") ? ReasoningEffortId("high") : option.id.endsWith("-low") ? ReasoningEffortId("low") : ReasoningEffortId("medium");
    return {
      provider: PROVIDER_ID,
      id: resolvedId,
      name: option.name,
      description: `${option.description} [Antigravity Direct \xB7 Unofficial]`,
      inputModalities: option.supportsImages ? ["text", "image"] : ["text"],
      context: { contextWindow: option.contextWindow },
      defaultMaxTokens: option.defaultMaxTokens,
      ...option.supportsReasoning ? {
        reasoning: {
          efforts: [...REASONING_EFFORTS],
          defaultEffort: defaultEffortId
        }
      } : {},
      // Freeze top-level systemInstruction and place mid-conversation updates in history.
      systemPromptUpdate: "in-history"
      // Omit toolUpdate so DSH resolves deferLoading tools cleanly on turn 0, keeping tools prefix constant.
    };
  }
};

// packages/dsh-antigravity/src/host/client.ts
import { LlmError, ProviderRequestId } from "@deepseek-ai/dsh-llm";
var DEFAULT_ENDPOINT_COOLDOWN_MS = 3e4;
var SANDBOX_ENDPOINT_COOLDOWN_MS = 6e4;
var SAME_ACCOUNT_MAX_TRANSIENT_429_RETRIES = 2;
var SAME_ACCOUNT_MAX_WAIT_MS = 8e3;
function isSandboxEndpoint(urlOrHost) {
  return urlOrHost.toLowerCase().includes("sandbox.googleapis.com");
}
function shouldTryNextEndpoint(status, endpointUrl) {
  if (status === 408 || status === 404 || status >= 500) {
    return true;
  }
  if (status === 400 && isSandboxEndpoint(endpointUrl)) {
    return true;
  }
  return false;
}
var DURATION_PART_RE = /([\d.]+)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)/gi;
function parseDurationMs(raw) {
  let totalMs = 0;
  let matched = false;
  DURATION_PART_RE.lastIndex = 0;
  for (const match of raw.matchAll(DURATION_PART_RE)) {
    matched = true;
    const val = Number(match[1]);
    if (!Number.isFinite(val)) return void 0;
    const unit = match[2].toLowerCase();
    if (unit === "ms" || unit.startsWith("millisecond")) {
      totalMs += val;
    } else if (unit === "s" || unit.startsWith("sec")) {
      totalMs += val * 1e3;
    } else if (unit === "m" || unit.startsWith("min")) {
      totalMs += val * 60 * 1e3;
    } else if (unit === "h" || unit.startsWith("hr") || unit.startsWith("hour")) {
      totalMs += val * 60 * 60 * 1e3;
    }
  }
  if (!matched || totalMs <= 0) return void 0;
  return Math.round(totalMs);
}
var TEXT_DELAY_PATTERNS = [
  /quota will reset after ([^.,;\]\n]+)/i,
  /quota will reset in ([^.,;\]\n]+)/i,
  /resets in ([^.,;\]\n]+)/i,
  /retry after ([^.,;\]\n]+)/i,
  /reset after ([^.,;\]\n]+)/i,
  /try again in ([^.,;\]\n]+)/i,
  /backoff for ([^.,;\]\n]+)/i
];
function extractStructuredRetryMs(obj, depth = 0) {
  if (depth > 8 || obj === null || typeof obj !== "object") return void 0;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractStructuredRetryMs(item, depth + 1);
      if (found !== void 0) return found;
    }
    return void 0;
  }
  const record = obj;
  for (const [k, v] of Object.entries(record)) {
    const norm = k.replaceAll("_", "").toLowerCase();
    if (norm === "retryafter" || norm === "retrydelay" || norm === "quotaresetdelay") {
      if (typeof v === "string") {
        const parsed = parseDurationMs(v);
        if (parsed !== void 0) return parsed;
        const asSec = Number(v);
        if (Number.isFinite(asSec) && asSec > 0) return Math.round(asSec * 1e3);
      } else if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        return Math.round(v * 1e3);
      }
    }
    const nested = extractStructuredRetryMs(v, depth + 1);
    if (nested !== void 0) return nested;
  }
  return void 0;
}
function parseRetryDelayMs(bodyText, retryAfterHeader) {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric * 1e3) + 200;
    }
    const parsedDur = parseDurationMs(trimmed);
    if (parsedDur !== void 0) return parsedDur + 200;
    const dateMs = Date.parse(trimmed);
    if (Number.isFinite(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) return diff + 200;
    }
  }
  try {
    const parsedJson = JSON.parse(bodyText);
    const structured = extractStructuredRetryMs(parsedJson);
    if (structured !== void 0) return structured + 200;
  } catch {
  }
  for (const re of TEXT_DELAY_PATTERNS) {
    const match = re.exec(bodyText);
    if (match?.[1]) {
      const parsed = parseDurationMs(match[1]);
      if (parsed !== void 0) return parsed + 1e3;
    }
  }
  return void 0;
}
function extractMessageFromBody(bodyText) {
  const trimmed = bodyText.trim();
  if (!trimmed) return "empty upstream response";
  try {
    const json = JSON.parse(trimmed);
    if (typeof json?.error?.message === "string" && json.error.message.trim()) {
      return json.error.message.trim();
    }
    if (typeof json?.message === "string" && json.message.trim()) {
      return json.message.trim();
    }
  } catch {
  }
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
}
function classifyUpstreamHttpError(status, bodyText, retryAfterHeader) {
  const message = extractMessageFromBody(bodyText);
  const lower = `${message}
${bodyText}`.toLowerCase();
  const isOneMillionContextError = lower.includes("maximum number of tokens allowed 1048576") || lower.includes("input token count exceeds the maximum");
  const isContextError = isOneMillionContextError || lower.includes("context_length_exceeded") || lower.includes("context length exceeded") || lower.includes("exceeds the maximum number of tokens") || lower.includes("prompt is too long") || lower.includes("input is too long for this model");
  const isSignatureError = status === 400 && (lower.includes("thoughtsignature") || lower.includes("thought_signature") || lower.includes("invalid signature") || lower.includes("thinking block"));
  const isModelNotFound = status === 404 || lower.includes("model not found") || lower.includes("unknown model") || lower.includes("not found for api version") || lower.includes("publisher model");
  if (status === 401 || lower.includes("unauthenticated") || lower.includes("invalid_grant")) {
    return {
      code: "AUTH",
      category: "AUTH",
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false
    };
  }
  if (status === 403) {
    const isQuotaWords = lower.includes("quota") || lower.includes("credit") || lower.includes("rate limit") || lower.includes("resource_exhausted");
    return {
      code: isQuotaWords ? "QUOTA" : "AUTH",
      category: isQuotaWords ? "QUOTA" : "AUTH",
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false
    };
  }
  if (status === 429 || status === 529) {
    const retryAfterMs = parseRetryDelayMs(bodyText, retryAfterHeader);
    const isExhaustedQuota = lower.includes("quota_exhausted") || lower.includes("exhausted your capacity") || lower.includes("quota exceeded") || retryAfterMs !== void 0 && retryAfterMs > 6e4;
    return {
      code: isExhaustedQuota ? "QUOTA" : "RATE_LIMIT",
      category: isExhaustedQuota ? "QUOTA" : "RATE_LIMIT",
      status,
      message,
      retryAfterMs,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false
    };
  }
  if (isContextError) {
    return {
      code: "CONTEXT_WINDOW_EXCEEDED",
      category: "INVALID_REQUEST",
      status,
      message,
      isOneMillionContextError,
      isSignatureError: false,
      isModelNotFound: false
    };
  }
  if (status === 400 || isModelNotFound || status === 422) {
    return {
      code: "INVALID_REQUEST",
      category: "INVALID_REQUEST",
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError,
      isModelNotFound
    };
  }
  if (status === 408 || status === 504) {
    return {
      code: "TIMEOUT",
      category: "SERVER",
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false
    };
  }
  if (status >= 500) {
    return {
      code: "SERVER",
      category: "SERVER",
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false
    };
  }
  return {
    code: "UNKNOWN",
    category: "UNKNOWN",
    status,
    message,
    isOneMillionContextError: false,
    isSignatureError: false,
    isModelNotFound: false
  };
}
var AntigravityUpstreamError = class extends LlmError {
  classified;
  constructor(classified, requestId, cause) {
    super(
      classified.status !== void 0 ? `Antigravity upstream HTTP ${classified.status}: ${classified.message}` : `Antigravity upstream error: ${classified.message}`,
      classified.code,
      {
        ...classified.status !== void 0 ? { status: classified.status } : {},
        ...classified.retryAfterMs !== void 0 ? { providerRetryAfterMs: classified.retryAfterMs } : {},
        ...requestId ? { requestId: ProviderRequestId(requestId) } : {},
        ...cause !== void 0 ? { cause } : {}
      }
    );
    this.classified = classified;
  }
};
var EndpointHealthTracker = class {
  cooldownUntil = /* @__PURE__ */ new Map();
  markFailure(endpoint) {
    const cooldownMs = isSandboxEndpoint(endpoint) ? SANDBOX_ENDPOINT_COOLDOWN_MS : DEFAULT_ENDPOINT_COOLDOWN_MS;
    this.cooldownUntil.set(endpoint, Date.now() + cooldownMs);
  }
  markHealthy(endpoint) {
    this.cooldownUntil.delete(endpoint);
  }
  isHealthy(endpoint, now = Date.now()) {
    const until = this.cooldownUntil.get(endpoint);
    if (until === void 0) return true;
    if (until <= now) {
      this.cooldownUntil.delete(endpoint);
      return true;
    }
    return false;
  }
  orderedEndpoints(endpoints) {
    const now = Date.now();
    const healthy = [];
    const cooling = [];
    for (const ep of endpoints) {
      if (this.isHealthy(ep, now)) healthy.push(ep);
      else cooling.push(ep);
    }
    return [...healthy, ...cooling];
  }
};
async function sleepWithAbort(ms, signal) {
  if (ms <= 0) return;
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function linkTimeoutSignal(outerSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new LlmError(`Antigravity request timed out after ${timeoutMs}ms`, "TIMEOUT"));
  }, timeoutMs);
  const onOuterAbort = () => {
    controller.abort(outerSignal?.reason);
  };
  if (outerSignal) {
    if (outerSignal.aborted) {
      clearTimeout(timer);
      controller.abort(outerSignal.reason);
    } else {
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
    }
  };
}
var AntigravityHttpClient = class {
  constructor(config) {
    this.config = config;
  }
  endpointHealth = new EndpointHealthTracker();
  async post(options) {
    const transient429Limit = options.allowSameAccount429Retry ? SAME_ACCOUNT_MAX_TRANSIENT_429_RETRIES : 0;
    let transientAttempts = 0;
    for (; ; ) {
      try {
        return await this.postAcrossEndpoints(options);
      } catch (error) {
        if (error instanceof AntigravityUpstreamError) {
          const isTransient429 = error.classified.status === 429 && error.classified.category === "RATE_LIMIT" && transientAttempts < transient429Limit;
          if (isTransient429) {
            const waitMs = Math.min(
              SAME_ACCOUNT_MAX_WAIT_MS,
              error.classified.retryAfterMs ?? (transientAttempts + 1) * 1200
            );
            transientAttempts += 1;
            await sleepWithAbort(waitMs, options.signal);
            continue;
          }
        }
        throw error;
      }
    }
  }
  async postAcrossEndpoints(options) {
    const candidates = this.endpointHealth.orderedEndpoints(this.config.endpoints);
    const headers = buildOutboundHeaders({
      accessToken: options.accessToken,
      userAgent: this.config.userAgent,
      projectId: options.projectId,
      isContentRequest: options.isContentRequest
    });
    const bodyJson = JSON.stringify(options.body);
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;
    let lastError;
    for (let i = 0; i < candidates.length; i++) {
      const endpoint = candidates[i];
      const hasNext = i + 1 < candidates.length;
      const query = options.queryString ? `?${options.queryString}` : "";
      const url = `${endpoint}/v1internal:${options.method}${query}`;
      const { signal, cleanup } = linkTimeoutSignal(options.signal, timeoutMs);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: bodyJson,
          signal
        });
        if (response.ok) {
          this.endpointHealth.markHealthy(endpoint);
          return { response, endpoint };
        }
        const errText = await response.text();
        const retryAfter = response.headers.get("retry-after");
        const classified = classifyUpstreamHttpError(response.status, errText, retryAfter);
        const upstreamError = new AntigravityUpstreamError(classified, options.requestId);
        if (hasNext && shouldTryNextEndpoint(response.status, endpoint)) {
          this.endpointHealth.markFailure(endpoint);
          lastError = upstreamError;
          continue;
        }
        throw upstreamError;
      } catch (error) {
        if (options.signal?.aborted) {
          throw new LlmError("Request aborted by caller", "ABORTED", {
            ...options.requestId ? { requestId: ProviderRequestId(options.requestId) } : {},
            cause: error
          });
        }
        if (error instanceof AntigravityUpstreamError) {
          throw error;
        }
        const isTimeout = error instanceof LlmError && error.code === "TIMEOUT";
        const message = error instanceof Error ? error.message : String(error);
        const transportErr = new AntigravityUpstreamError(
          {
            code: isTimeout ? "TIMEOUT" : "TRANSPORT",
            category: "TRANSPORT",
            message,
            isOneMillionContextError: false,
            isSignatureError: false,
            isModelNotFound: false
          },
          options.requestId,
          error
        );
        if (hasNext) {
          this.endpointHealth.markFailure(endpoint);
          lastError = transportErr;
          continue;
        }
        throw transportErr;
      } finally {
        cleanup();
      }
    }
    throw lastError ?? new AntigravityUpstreamError(
      {
        code: "TRANSPORT",
        category: "TRANSPORT",
        message: "No Cloud Code endpoints configured",
        isOneMillionContextError: false,
        isSignatureError: false,
        isModelNotFound: false
      },
      options.requestId
    );
  }
};

// packages/dsh-antigravity/src/host/translate.ts
import {
  ToolCallId,
  offloadedImageText,
  requestImageHandleText
} from "@deepseek-ai/dsh-llm";

// packages/dsh-antigravity/src/host/replay.ts
var GEMINI_SENTINEL_THOUGHT_SIGNATURE = "c2tpcF90aG91Z2h0X3NpZ25hdHVyZV92YWxpZGF0b3I=";
var ANTIGRAVITY_REPLAY_FORMAT = "antigravity-gemini-v1";
function isUsableSignature(sig) {
  return typeof sig === "string" && sig.trim().length > 0;
}
function buildReplayEnvelope(params) {
  const response = {
    format: ANTIGRAVITY_REPLAY_FORMAT,
    model: params.model,
    ...params.accountId ? { accountId: params.accountId } : {},
    ...params.responseId ? { responseId: params.responseId } : {}
  };
  return {
    response,
    blocks: params.blockStates.map((b) => ({ ...b }))
  };
}
function isAntigravityReplayResponse(value) {
  if (value === null || typeof value !== "object") return false;
  return value.format === ANTIGRAVITY_REPLAY_FORMAT;
}
function parseReplayBlockState(value) {
  if (value === null || typeof value !== "object") return void 0;
  const candidate = value;
  const kind = candidate.kind;
  if (kind !== "text" && kind !== "reasoning" && kind !== "tool-call") {
    return void 0;
  }
  const sig = isUsableSignature(candidate.thoughtSignature) ? candidate.thoughtSignature.trim() : void 0;
  return {
    kind,
    ...sig !== void 0 ? { thoughtSignature: sig } : {},
    ...typeof candidate.thought === "boolean" ? { thought: candidate.thought } : {},
    ...typeof candidate.toolCallId === "string" ? { toolCallId: candidate.toolCallId } : {},
    ...typeof candidate.toolName === "string" ? { toolName: candidate.toolName } : {}
  };
}
function extractAlignedReplayBlocks(content, replayState) {
  if (replayState === null || typeof replayState !== "object") {
    return content.map(() => void 0);
  }
  const envelope = replayState;
  if (!isAntigravityReplayResponse(envelope.response)) {
    return content.map(() => void 0);
  }
  if (!Array.isArray(envelope.blocks) || envelope.blocks.length !== content.length) {
    return content.map(() => void 0);
  }
  return envelope.blocks.map(parseReplayBlockState);
}

// packages/dsh-antigravity/src/host/usage.ts
function nonNegInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
}
function mergeUsageMetadata(prev, next) {
  if (!next) return prev;
  if (!prev) return { ...next };
  return {
    promptTokenCount: typeof next.promptTokenCount === "number" && Number.isFinite(next.promptTokenCount) ? next.promptTokenCount : prev.promptTokenCount,
    candidatesTokenCount: typeof next.candidatesTokenCount === "number" && Number.isFinite(next.candidatesTokenCount) ? next.candidatesTokenCount : prev.candidatesTokenCount,
    thoughtsTokenCount: typeof next.thoughtsTokenCount === "number" && Number.isFinite(next.thoughtsTokenCount) ? next.thoughtsTokenCount : prev.thoughtsTokenCount,
    cachedContentTokenCount: typeof next.cachedContentTokenCount === "number" && Number.isFinite(next.cachedContentTokenCount) ? next.cachedContentTokenCount : prev.cachedContentTokenCount,
    totalTokenCount: typeof next.totalTokenCount === "number" && Number.isFinite(next.totalTokenCount) ? next.totalTokenCount : prev.totalTokenCount,
    toolUsePromptTokenCount: typeof next.toolUsePromptTokenCount === "number" && Number.isFinite(next.toolUsePromptTokenCount) ? next.toolUsePromptTokenCount : prev.toolUsePromptTokenCount
  };
}
function mapUsage(usage) {
  const prompt = nonNegInt(usage?.promptTokenCount) + nonNegInt(usage?.toolUsePromptTokenCount);
  const cached = Math.min(prompt, nonNegInt(usage?.cachedContentTokenCount));
  const candidates = nonNegInt(usage?.candidatesTokenCount);
  const thoughts = nonNegInt(usage?.thoughtsTokenCount);
  const inputTokens = Math.max(0, prompt - cached);
  const reasoningTokens = thoughts;
  const outputTokens = candidates + reasoningTokens;
  const cacheReadTokens = cached;
  const totalTokens = inputTokens + cacheReadTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    reasoningTokens
  };
}
var MAX_RECENT_TURNS = 50;
var CacheTelemetryTracker = class {
  turnCount = 0;
  totalUncachedInputTokens = 0;
  totalCacheReadTokens = 0;
  totalOutputTokens = 0;
  totalReasoningTokens = 0;
  recent = [];
  record(entry) {
    const inputTokens = nonNegInt(entry.usage.inputTokens);
    const cacheReadTokens = nonNegInt(entry.usage.cacheReadTokens);
    const outputTokens = nonNegInt(entry.usage.outputTokens);
    const reasoningTokens = nonNegInt(entry.usage.reasoningTokens);
    const promptDenom = inputTokens + cacheReadTokens;
    const cacheHitRate = promptDenom > 0 ? cacheReadTokens / promptDenom : 0;
    this.turnCount += 1;
    this.totalUncachedInputTokens += inputTokens;
    this.totalCacheReadTokens += cacheReadTokens;
    this.totalOutputTokens += outputTokens;
    this.totalReasoningTokens += reasoningTokens;
    this.recent.unshift({
      at: entry.at ?? Date.now(),
      model: entry.model,
      accountEmail: entry.accountEmail,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      reasoningTokens,
      cacheHitRate
    });
    if (this.recent.length > MAX_RECENT_TURNS) {
      this.recent.length = MAX_RECENT_TURNS;
    }
  }
  summary() {
    const totalPrompt = this.totalUncachedInputTokens + this.totalCacheReadTokens;
    return {
      turnCount: this.turnCount,
      totalUncachedInputTokens: this.totalUncachedInputTokens,
      totalCacheReadTokens: this.totalCacheReadTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalReasoningTokens: this.totalReasoningTokens,
      aggregateCacheHitRate: totalPrompt > 0 ? this.totalCacheReadTokens / totalPrompt : 0,
      recentTurns: [...this.recent]
    };
  }
};

// packages/dsh-antigravity/src/host/translate.ts
function flattenTextBlocks(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    } else if (block.type === "tool-addition") {
      parts.push(`[tool-added: ${block.toolName}]`);
    } else if (block.type === "tool-removal") {
      parts.push(`[tool-removed: ${block.toolName}]`);
    }
  }
  return parts.join("\n");
}
function wrapInSystemReminder(text) {
  const escaped = text.replaceAll("</system-reminder>", "<\\/system-reminder>");
  return `<system-reminder>
${escaped}
</system-reminder>`;
}
function safeParseJsonObject(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}
var UPPERCASE_SCHEMA_TYPE = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
  null: "TYPE_UNSPECIFIED"
};
var STRIPPED_SCHEMA_KEYS = /* @__PURE__ */ new Set([
  "$schema",
  "$id",
  "$defs",
  "definitions",
  "additionalProperties",
  "default",
  "title",
  "examples",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "patternProperties",
  "unevaluatedProperties",
  "propertyNames"
]);
function resolveRef(ref, defs, seen) {
  if (!ref.startsWith("#/") || seen.has(ref)) return void 0;
  seen.add(ref);
  const parts = ref.slice(2).split("/");
  const leaf = parts[parts.length - 1];
  const candidate = defs[leaf];
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate;
  }
  return void 0;
}
function cleanJsonSchemaForGemini(schema, rootDefs, seenRefs = /* @__PURE__ */ new Set()) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "OBJECT" };
  }
  const obj = schema;
  const defs = rootDefs ?? (obj.$defs ?? obj.definitions ?? {});
  if (typeof obj.$ref === "string") {
    const resolved = resolveRef(obj.$ref, defs, new Set(seenRefs));
    if (resolved) {
      return cleanJsonSchemaForGemini(resolved, defs, seenRefs);
    }
    return { type: "STRING" };
  }
  const out = {};
  let nullable = obj.nullable === true;
  const branchArray = Array.isArray(obj.anyOf) ? obj.anyOf : Array.isArray(obj.oneOf) ? obj.oneOf : void 0;
  if (branchArray) {
    const nonNull = branchArray.filter((b) => {
      if (b && typeof b === "object" && b.type === "null") {
        nullable = true;
        return false;
      }
      return true;
    });
    if (nonNull.length > 0) {
      const firstCleaned = cleanJsonSchemaForGemini(nonNull[0], defs, seenRefs);
      if (nullable) firstCleaned.nullable = true;
      if (typeof obj.description === "string" && !firstCleaned.description) {
        firstCleaned.description = obj.description;
      }
      return firstCleaned;
    }
  }
  for (const [key, val] of Object.entries(obj)) {
    if (STRIPPED_SCHEMA_KEYS.has(key) || key === "anyOf" || key === "oneOf" || key === "$ref") {
      continue;
    }
    if (key === "const") {
      out.enum = [val];
      if (!out.type) {
        out.type = typeof val === "number" ? "NUMBER" : typeof val === "boolean" ? "BOOLEAN" : "STRING";
      }
      continue;
    }
    if (key === "type") {
      if (typeof val === "string") {
        const mapped = UPPERCASE_SCHEMA_TYPE[val.toLowerCase()];
        out.type = mapped ?? val.toUpperCase();
      } else if (Array.isArray(val)) {
        const nonNull = val.filter((t) => t !== "null");
        if (val.includes("null")) nullable = true;
        const primary = typeof nonNull[0] === "string" ? nonNull[0] : "string";
        out.type = UPPERCASE_SCHEMA_TYPE[primary.toLowerCase()] ?? primary.toUpperCase();
      }
      continue;
    }
    if (key === "properties" && val && typeof val === "object" && !Array.isArray(val)) {
      const cleanedProps = {};
      for (const [pKey, pSchema] of Object.entries(val)) {
        cleanedProps[pKey] = cleanJsonSchemaForGemini(pSchema, defs, seenRefs);
      }
      out.properties = cleanedProps;
      continue;
    }
    if (key === "items") {
      out.items = cleanJsonSchemaForGemini(val, defs, seenRefs);
      continue;
    }
    if (key === "required" && Array.isArray(val)) {
      out.required = val.filter((item) => typeof item === "string");
      continue;
    }
    if (key === "enum" && Array.isArray(val)) {
      out.enum = val.filter((item) => item !== null && item !== void 0);
      continue;
    }
    if (key === "description" && typeof val === "string") {
      out.description = val;
      continue;
    }
    out[key] = val;
  }
  if (out.properties && !out.type) {
    out.type = "OBJECT";
  }
  if (out.items && !out.type) {
    out.type = "ARRAY";
  }
  if (!out.type) {
    out.type = "STRING";
  }
  if (nullable) {
    out.nullable = true;
  }
  return out;
}
function normalizeTools(tools) {
  if (!tools || tools.length === 0) return void 0;
  const declarations = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: cleanJsonSchemaForGemini(tool.parameters)
  }));
  return [{ functionDeclarations: declarations }];
}
function buildThinkingConfig(params) {
  const model = params.model.toLowerCase();
  if (model.includes("lite")) return void 0;
  let chosen;
  if (params.effort === "low" || params.effort === "medium" || params.effort === "high") {
    chosen = params.effort;
  } else if (params.defaultEffort === "low" || params.defaultEffort === "medium" || params.defaultEffort === "high") {
    chosen = params.defaultEffort;
  } else if (model.endsWith("-high")) {
    chosen = "high";
  } else if (model.endsWith("-low")) {
    chosen = "low";
  } else if (model.includes("pro") || model.includes("gemini-3") || model.includes("gemini-2.5")) {
    chosen = "medium";
  }
  if (!chosen) return void 0;
  if (isGemini3SeriesModel(model)) {
    return {
      includeThoughts: true,
      thinkingLevel: chosen.toUpperCase()
    };
  }
  const budgetMap = {
    low: 1024,
    medium: 8192,
    high: 24576
  };
  return {
    includeThoughts: true,
    thinkingBudget: budgetMap[chosen]
  };
}
function pushTurn(contents, role, parts) {
  if (parts.length === 0) return;
  const prev = contents[contents.length - 1];
  if (prev && prev.role === role) {
    prev.parts.push(...parts);
    return;
  }
  contents.push({ role, parts: [...parts] });
}
function imageBlockToParts(block, images) {
  if (block.offloaded === true) {
    return [{ text: offloadedImageText(block.attachment) }];
  }
  const resolved = images?.get(block.attachment.attachmentId);
  if (!resolved) {
    return [{ text: offloadedImageText(block.attachment) }];
  }
  const parts = [];
  if (resolved.width !== void 0 && resolved.height !== void 0) {
    parts.push({
      text: requestImageHandleText(
        block.attachment,
        { width: resolved.width, height: resolved.height },
        resolved.access
      )
    });
  }
  parts.push({
    inlineData: {
      mimeType: resolved.mediaType,
      data: Buffer.from(resolved.data).toString("base64")
    }
  });
  return parts;
}
function buildAntigravityRequest(input) {
  const { options } = input;
  const canonicalModel = normalizeModelId(options.model);
  const { envelopeUserAgent } = resolveOfficialFingerprint(input.accountEmail);
  const leadingSystemChunks = [];
  if (options.system && options.system.trim() !== "") {
    leadingSystemChunks.push(options.system);
  }
  let historyStartIndex = 0;
  while (historyStartIndex < options.messages.length && options.messages[historyStartIndex].role === "system") {
    const text = flattenTextBlocks(options.messages[historyStartIndex].content);
    if (text.trim() !== "") leadingSystemChunks.push(text);
    historyStartIndex += 1;
  }
  const frozenSystemText = leadingSystemChunks.join("\n\n");
  const toolNames = /* @__PURE__ */ new Map();
  const contents = [];
  for (let i = historyStartIndex; i < options.messages.length; i++) {
    const message = options.messages[i];
    if (message.role === "system" || message.role === "developer") {
      const text = flattenTextBlocks(message.content);
      if (text.trim() !== "") {
        pushTurn(contents, "user", [{ text: wrapInSystemReminder(text) }]);
      }
      continue;
    }
    if (message.role === "user") {
      const parts = [];
      for (const block of message.content) {
        if (block.type === "text") {
          if (block.text !== "") parts.push({ text: block.text });
        } else if (block.type === "image") {
          parts.push(...imageBlockToParts(block, input.images));
        }
      }
      pushTurn(contents, "user", parts);
      continue;
    }
    if (message.role === "tool") {
      const textParts = [];
      const extraParts = [];
      for (const block of message.content) {
        if (block.type === "text" && block.text !== "") {
          textParts.push(block.text);
        } else if (block.type === "image") {
          extraParts.push(...imageBlockToParts(block, input.images));
        }
      }
      const output = textParts.join("\n") || "(no output)";
      const name2 = toolNames.get(message.toolCallId) ?? "tool";
      const responsePart = {
        functionResponse: {
          id: message.toolCallId,
          name: name2,
          response: message.isError ? { error: output } : { output }
        }
      };
      pushTurn(contents, "user", [responsePart, ...extraParts]);
      continue;
    }
    if (message.role === "assistant") {
      const replayStates = extractAlignedReplayBlocks(
        message.content,
        message.source?.replayState
      );
      const parts = [];
      let sawNonThinking = false;
      let turnHasRealSignature = false;
      for (let bIdx = 0; bIdx < message.content.length; bIdx++) {
        const block = message.content[bIdx];
        const replay = replayStates[bIdx];
        const sig = isUsableSignature(replay?.thoughtSignature) ? replay.thoughtSignature : void 0;
        if (sig) turnHasRealSignature = true;
        if (block.type === "reasoning") {
          if (!block.text.trim()) continue;
          if (!sawNonThinking) {
            parts.push({
              text: block.text,
              thought: true,
              ...sig ? { thoughtSignature: sig } : {}
            });
          } else {
            parts.push({ text: block.text });
          }
        } else if (block.type === "text") {
          if (block.text === "" && !sig) continue;
          sawNonThinking = true;
          parts.push({
            text: block.text,
            ...sig ? { thoughtSignature: sig } : {}
          });
        } else if (block.type === "tool-call") {
          sawNonThinking = true;
          toolNames.set(block.id, block.name);
          parts.push({
            functionCall: {
              id: block.id,
              name: block.name,
              args: safeParseJsonObject(block.arguments)
            },
            ...sig ? { thoughtSignature: sig } : {}
          });
        }
      }
      if (!turnHasRealSignature) {
        const firstFc = parts.find((p) => p.functionCall !== void 0);
        if (firstFc) {
          firstFc.thoughtSignature = GEMINI_SENTINEL_THOUGHT_SIGNATURE;
        }
      }
      pushTurn(contents, "model", parts);
    }
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "." }] });
  }
  const tools = normalizeTools(options.tools);
  const hasToolInteractions = contents.some(
    (c) => c.parts.some((p) => p.functionCall !== void 0 || p.functionResponse !== void 0)
  );
  const hasToolActivity = tools !== void 0 && tools.length > 0 || hasToolInteractions;
  const modelTurns = contents.filter((c) => c.role === "model").length;
  const requestId = buildOfficialRequestId(
    options.sessionId,
    contents.length,
    input.trajectoryId,
    input.nowMs
  );
  const trajId = extractTrajectoryId(requestId);
  const labels = {
    last_step_index: String(modelTurns),
    model_enum: canonicalModel,
    request_id: `${trajId}-${modelTurns}`,
    trajectory_id: trajId,
    used_claude: "false",
    used_claude_conservative: "false",
    used_non_gemini_model: "false"
  };
  const generationConfig = {};
  if (typeof options.maxTokens === "number" && Number.isFinite(options.maxTokens) && options.maxTokens > 0) {
    generationConfig.maxOutputTokens = Math.trunc(options.maxTokens);
  }
  const thinkingConfig = buildThinkingConfig({
    model: canonicalModel,
    effort: options.reasoningEffort,
    defaultEffort: input.defaultThinkingEffort
  });
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }
  if (typeof options.temperature === "number" && Number.isFinite(options.temperature)) {
    generationConfig.temperature = options.temperature;
  }
  if (options.stop && options.stop.length > 0) {
    generationConfig.stopSequences = [...options.stop];
  }
  const upstreamSessionId = deriveUpstreamSessionId(
    input.accountId,
    options.sessionId,
    input.sessionGeneration ?? 0
  );
  const innerRequest = {
    contents
  };
  if (frozenSystemText !== "") {
    innerRequest.systemInstruction = {
      role: "user",
      parts: [{ text: frozenSystemText }]
    };
  }
  if (tools) {
    innerRequest.tools = tools;
  }
  innerRequest.labels = labels;
  if (Object.keys(generationConfig).length > 0) {
    innerRequest.generationConfig = generationConfig;
  }
  innerRequest.sessionId = upstreamSessionId;
  const envelope = {
    project: input.projectId || "aicode-consumers",
    requestId,
    request: innerRequest,
    model: canonicalModel,
    userAgent: envelopeUserAgent
  };
  if (hasToolActivity) {
    envelope.requestType = "agent";
  }
  return { envelope, requestId, canonicalModel, hasToolActivity };
}
function buildCountTokensEnvelope(innerRequest) {
  const { safetySettings: _omit, ...rest } = innerRequest;
  return { request: rest };
}
function mapGeminiFinishReason(rawReason, sawToolCall) {
  if (sawToolCall) return { kind: "tool-calls" };
  const upper = (rawReason ?? "").toUpperCase();
  if (upper === "MAX_TOKENS") return { kind: "max-tokens" };
  return { kind: "stop" };
}
var GeminiSseStreamDecoder = class {
  constructor(model, accountId, requestId) {
    this.model = model;
    this.accountId = accountId;
    this.requestId = requestId;
  }
  utf8 = new TextDecoder("utf-8", { fatal: false });
  buffer = "";
  nextBlockIndex = 0;
  activeBlock;
  replayBlocks = [];
  usageMetadata;
  rawFinishReason;
  responseId;
  sawToolCall = false;
  toolCounter = 0;
  feed(chunkBytes) {
    this.buffer += this.utf8.decode(chunkBytes, { stream: true }).replaceAll("\r\n", "\n");
    return this.drainCompleteEvents();
  }
  finish() {
    this.buffer += this.utf8.decode().replaceAll("\r\n", "\n");
    const out = this.drainCompleteEvents();
    if (this.buffer.trim() !== "") {
      out.push(...this.processEventBlock(this.buffer));
      this.buffer = "";
    }
    this.closeActiveBlock(out);
    const usage = mapUsage(this.usageMetadata);
    out.push({ type: "usage", usage });
    const reason = mapGeminiFinishReason(this.rawFinishReason, this.sawToolCall);
    const replayState = buildReplayEnvelope({
      model: this.model,
      accountId: this.accountId,
      responseId: this.responseId,
      blockStates: this.replayBlocks
    });
    out.push({ type: "finish", reason, replayState });
    return {
      chunks: out,
      usage,
      hasOutput: this.replayBlocks.length > 0
    };
  }
  drainCompleteEvents() {
    const out = [];
    for (; ; ) {
      const sepIdx = this.buffer.indexOf("\n\n");
      if (sepIdx === -1) break;
      const rawEvent = this.buffer.slice(0, sepIdx);
      this.buffer = this.buffer.slice(sepIdx + 2);
      out.push(...this.processEventBlock(rawEvent));
    }
    return out;
  }
  processEventBlock(rawEvent) {
    const dataLines = [];
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return [];
    const dataPayload = dataLines.join("\n").trim();
    if (!dataPayload || dataPayload === "[DONE]") return [];
    let parsed;
    try {
      parsed = JSON.parse(dataPayload);
    } catch {
      return [];
    }
    if (parsed.error) {
      const code = typeof parsed.error.code === "number" ? parsed.error.code : 502;
      throw new AntigravityUpstreamError(
        classifyUpstreamHttpError(code, dataPayload),
        this.requestId
      );
    }
    const inner = parsed.response ?? parsed;
    if (typeof inner.responseId === "string" && !this.responseId) {
      this.responseId = inner.responseId;
    }
    if (inner.usageMetadata) {
      this.usageMetadata = mergeUsageMetadata(this.usageMetadata, inner.usageMetadata);
    }
    const out = [];
    const candidate = inner.candidates?.[0];
    if (!candidate) return out;
    const finish = candidate.finishReason ?? candidate.finish_reason;
    if (typeof finish === "string" && finish !== "") {
      this.rawFinishReason = finish;
    }
    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      const sig = part.thoughtSignature ?? part.thought_signature;
      if (part.functionCall) {
        this.closeActiveBlock(out);
        this.sawToolCall = true;
        this.toolCounter += 1;
        const callId = ToolCallId(
          part.functionCall.id?.trim() || `ag_call_${this.toolCounter}`
        );
        const name2 = part.functionCall.name?.trim() || "unknown_tool";
        const argsStr = JSON.stringify(part.functionCall.args ?? {});
        const index = this.nextBlockIndex++;
        out.push({ type: "block-start", index, blockType: "tool-call" });
        out.push({
          type: "tool-call-delta",
          index,
          id: callId,
          name: name2,
          argumentsDelta: argsStr
        });
        out.push({
          type: "block-end",
          index,
          block: {
            type: "tool-call",
            id: callId,
            name: name2,
            arguments: argsStr
          }
        });
        this.replayBlocks.push({
          kind: "tool-call",
          toolCallId: callId,
          toolName: name2,
          ...isUsableSignature(sig) ? { thoughtSignature: sig.trim() } : {}
        });
        continue;
      }
      if (typeof part.text === "string" && part.text !== "" || isUsableSignature(sig)) {
        const isThought = part.thought === true;
        const targetKind = isThought ? "reasoning" : "text";
        const text = part.text ?? "";
        if (this.activeBlock && this.activeBlock.kind !== targetKind) {
          this.closeActiveBlock(out);
        }
        if (!this.activeBlock) {
          const index = this.nextBlockIndex++;
          this.activeBlock = {
            index,
            kind: targetKind,
            text: "",
            ...isUsableSignature(sig) ? { thoughtSignature: sig.trim() } : {}
          };
          out.push({
            type: "block-start",
            index,
            blockType: targetKind
          });
        } else if (isUsableSignature(sig)) {
          this.activeBlock.thoughtSignature = sig.trim();
        }
        if (text !== "") {
          this.activeBlock.text += text;
          out.push({
            type: targetKind === "reasoning" ? "reasoning-delta" : "text-delta",
            index: this.activeBlock.index,
            text
          });
        }
      }
    }
    return out;
  }
  closeActiveBlock(out) {
    if (!this.activeBlock) return;
    const block = this.activeBlock;
    this.activeBlock = void 0;
    out.push({
      type: "block-end",
      index: block.index,
      block: block.kind === "reasoning" ? { type: "reasoning", text: block.text } : { type: "text", text: block.text }
    });
    this.replayBlocks.push({
      kind: block.kind,
      ...block.kind === "reasoning" ? { thought: true } : {},
      ...block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}
    });
  }
};

// packages/dsh-antigravity/src/host/adapter.ts
function computeTargetDimensions(width, height, maxPixels) {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const pixels = safeW * safeH;
  if (pixels <= maxPixels) {
    return { maxWidth: safeW, maxHeight: safeH };
  }
  const scale = Math.sqrt(maxPixels / pixels);
  return {
    maxWidth: Math.max(1, Math.floor(safeW * scale)),
    maxHeight: Math.max(1, Math.floor(safeH * scale))
  };
}
function unrefTimer2(timer) {
  if (timer && typeof timer === "object" && "unref" in timer) {
    const fn = timer.unref;
    if (typeof fn === "function") fn.call(timer);
  }
}
function createStreamIdleWatchdog(parentSignal, idleTimeoutMs) {
  const controller = new AbortController();
  let timer;
  const arm = () => {
    if (timer !== void 0) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(
        new LlmError2(
          `Antigravity stream idle timeout after ${idleTimeoutMs}ms`,
          "TIMEOUT"
        )
      );
    }, idleTimeoutMs);
    unrefTimer2(timer);
  };
  const onParentAbort = () => {
    if (timer) clearTimeout(timer);
    controller.abort(parentSignal?.reason);
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }
  if (!controller.signal.aborted) {
    arm();
  }
  return {
    signal: controller.signal,
    touch: () => {
      if (!controller.signal.aborted) arm();
    },
    cleanup: () => {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  };
}
var AntigravityService = class {
  constructor(config, deps) {
    this.config = config;
    this.resolveAttachments = deps?.resolveAttachments;
    this.resolveFsHostMapper = deps?.resolveFsHostMapper;
    this.onAdaptersUpdated = deps?.onAdaptersUpdated;
    this.accounts = new AntigravityAccountManager(config);
    this.catalog = new AntigravityCatalog(config);
    this.client = new AntigravityHttpClient(config);
    this.oauth = new AntigravityOAuthManager(config, async (creds) => {
      const account = await this.accounts.upsertAccountFromOAuth(creds);
      await this.refreshQuotaAndModelsForAccount(account.id).catch(() => void 0);
      this.notifyAdaptersUpdated();
    });
    this.adapter = new AntigravityAdapter(this);
  }
  accounts;
  catalog;
  client;
  oauth;
  telemetry = new CacheTelemetryTracker();
  adapter;
  resolveAttachments;
  resolveFsHostMapper;
  onAdaptersUpdated;
  notifyAdaptersUpdated() {
    this.onAdaptersUpdated?.();
  }
  async ensureAccountProjectId(account, signal) {
    if (account.projectId && account.projectId.trim() !== "") {
      return account.projectId;
    }
    try {
      const info = await loadCodeAssist({
        client: this.client,
        accessToken: account.accessToken,
        email: account.email,
        signal
      });
      if (info.projectId) {
        await this.accounts.updateAccountMeta(account.id, {
          projectId: info.projectId,
          tierLabel: info.tierLabel,
          tierId: info.tierId
        });
        return info.projectId;
      }
    } catch {
    }
    return "aicode-consumers";
  }
  async refreshQuotaAndModelsForAccount(accountId, signal) {
    await this.accounts.ensureLoaded();
    await this.catalog.ensureLoaded();
    const target = accountId ? this.accounts.getAccountById(accountId) : this.accounts.getActiveAccount();
    if (!target) return void 0;
    const fresh = await this.accounts.ensureFreshToken(target.id, signal);
    const result = await fetchAccountQuotaAndModels({
      client: this.client,
      config: this.config,
      accountId: fresh.id,
      email: fresh.email,
      accessToken: fresh.accessToken,
      projectIdHint: fresh.projectId,
      signal
    });
    this.accounts.setQuota(result.snapshot);
    if (result.models.length > 0) {
      await this.catalog.saveDynamicModels(result.models);
    }
    return result.snapshot;
  }
  async getStatusPayload() {
    await this.accounts.ensureLoaded();
    await this.catalog.ensureLoaded();
    const active = this.accounts.getActiveAccount();
    const quota = active ? this.accounts.getQuota(active.id) : void 0;
    const options = this.catalog.mergedCatalog(quota);
    return {
      providerId: PROVIDER_ID,
      providerName: PROVIDER_DISPLAY_NAME,
      unofficialChannel: true,
      accounts: this.accounts.listAccounts(),
      ...active ? { activeAccountId: active.id } : {},
      login: this.oauth.getStatus(),
      ...quota ? { quota } : {},
      ...this.accounts.getColdNotice() ? { coldNotice: this.accounts.getColdNotice() } : {},
      recentSwitches: this.accounts.getRecentSwitches(),
      telemetry: this.telemetry.summary(),
      models: {
        enabledModelIds: this.catalog.getEnabledModelIds(),
        options,
        source: this.catalog.getCatalogSource()
      }
    };
  }
  async runDoctor() {
    await this.accounts.ensureLoaded();
    await this.catalog.ensureLoaded();
    const checks = [];
    const userAgent = sanitizeUserAgent(this.config.userAgent) || buildHubUserAgent();
    const active = this.accounts.getActiveAccount();
    if (!active) {
      checks.push({
        name: "account",
        ok: false,
        detail: "No Google account connected yet."
      });
      return {
        ok: false,
        checkedAt: Date.now(),
        userAgent,
        checks
      };
    }
    let fresh;
    const t0 = Date.now();
    try {
      fresh = await this.accounts.ensureFreshToken(active.id);
      checks.push({
        name: "oauth-token",
        ok: true,
        detail: `Valid access token for ${fresh.email} (expires in ${Math.max(0, Math.round((fresh.expiresAt - Date.now()) / 1e3))}s)`,
        latencyMs: Date.now() - t0
      });
    } catch (error) {
      checks.push({
        name: "oauth-token",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - t0
      });
      return {
        ok: false,
        checkedAt: Date.now(),
        userAgent,
        checks
      };
    }
    const t1 = Date.now();
    let projectId = fresh.projectId;
    try {
      const assist = await loadCodeAssist({
        client: this.client,
        accessToken: fresh.accessToken,
        email: fresh.email,
        projectIdHint: projectId
      });
      projectId = assist.projectId ?? projectId ?? "aicode-consumers";
      await this.accounts.updateAccountMeta(fresh.id, {
        projectId,
        tierLabel: assist.tierLabel,
        tierId: assist.tierId
      });
      checks.push({
        name: "loadCodeAssist",
        ok: true,
        detail: `project=${projectId}, tier=${assist.tierLabel ?? assist.tierId ?? "unknown"}`,
        latencyMs: Date.now() - t1
      });
    } catch (error) {
      checks.push({
        name: "loadCodeAssist",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - t1
      });
    }
    const t2 = Date.now();
    try {
      const countBody = buildCountTokensEnvelope({
        model: `models/gemini-2.5-flash`,
        contents: [{ role: "user", parts: [{ text: "ping" }] }]
      });
      const { response, endpoint } = await this.client.post({
        method: "countTokens",
        body: countBody,
        accessToken: fresh.accessToken,
        projectId,
        isContentRequest: false
      });
      const data = await response.json();
      checks.push({
        name: "countTokens-probe",
        ok: true,
        detail: `endpoint=${endpoint}, totalTokens=${data.totalTokens ?? "ok"}`,
        latencyMs: Date.now() - t2
      });
    } catch (error) {
      checks.push({
        name: "countTokens-probe",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - t2
      });
    }
    const sampleHeaders = buildOutboundHeaders({
      accessToken: "redacted",
      userAgent,
      projectId,
      isContentRequest: true
    });
    const cleanHeadersOk = !("x-goog-user-project" in sampleHeaders) && !("x-session-id" in sampleHeaders) && sampleHeaders["User-Agent"] === userAgent;
    checks.push({
      name: "header-hygiene",
      ok: cleanHeadersOk,
      detail: cleanHeadersOk ? "Content requests omit x-goog-user-project and client spoof headers" : "Header hygiene check failed"
    });
    return {
      ok: checks.every((c) => c.ok),
      checkedAt: Date.now(),
      userAgent,
      checks
    };
  }
  async resolveImages(options, signal) {
    const refs = /* @__PURE__ */ new Map();
    for (const msg of options.messages) {
      for (const block of msg.content) {
        if (block.type === "image" && block.offloaded !== true) {
          refs.set(block.attachment.attachmentId, block.attachment);
        }
      }
    }
    if (refs.size === 0) return void 0;
    const attachments = this.resolveAttachments?.();
    if (!attachments || typeof attachments.readImageRequest !== "function") {
      throw new LlmError2(
        "Antigravity image input requires the DSH durable attachment service",
        "UNSUPPORTED_CONTENT"
      );
    }
    const hostMapper = this.resolveFsHostMapper?.();
    const resolved = /* @__PURE__ */ new Map();
    for (const [id, ref] of refs.entries()) {
      const target = {
        ...computeTargetDimensions(
          ref.width,
          ref.height,
          this.config.requestImagePixelBudget
        ),
        maxBytes: this.config.requestImageMaxBytes
      };
      const version = await attachments.readImageRequest(ref, target, signal);
      let access;
      if (hostMapper) {
        try {
          access = resolveImageAttachmentAccess(attachments, hostMapper, ref);
        } catch {
          access = void 0;
        }
      }
      resolved.set(id, {
        data: version.data,
        mediaType: version.mediaType,
        width: version.width,
        height: version.height,
        ...access ? { access } : {}
      });
    }
    return resolved;
  }
};
var AntigravityAdapter = class extends LlmAdapter {
  constructor(service) {
    super();
    this.service = service;
  }
  sessionTrajectoryIds = /* @__PURE__ */ new Map();
  registeredTrajectoryAcls = /* @__PURE__ */ new Set();
  getOrCreateTrajectoryId(accountId, sessionKey) {
    const key = `${accountId}|${sessionKey}`;
    const existing = this.sessionTrajectoryIds.get(key);
    if (existing) return existing;
    const created = deriveTrajectoryId();
    if (this.sessionTrajectoryIds.size >= 256) {
      const oldestKey = this.sessionTrajectoryIds.keys().next().value;
      if (oldestKey) this.sessionTrajectoryIds.delete(oldestKey);
    }
    this.sessionTrajectoryIds.set(key, created);
    return created;
  }
  async ensureTrajectoryAclRegistered(params) {
    const cacheKey = `${params.accountId}|${params.trajectoryId}`;
    if (this.registeredTrajectoryAcls.has(cacheKey)) return;
    if (params.signal?.aborted) return;
    try {
      await this.service.client.post({
        method: "writeTrajectoryAcls",
        body: { trajectoryId: params.trajectoryId },
        accessToken: params.accessToken,
        projectId: params.projectId,
        isContentRequest: false,
        signal: params.signal,
        timeoutMs: 2500
      });
      if (this.registeredTrajectoryAcls.size >= 256) {
        const oldest = this.registeredTrajectoryAcls.values().next().value;
        if (oldest) this.registeredTrajectoryAcls.delete(oldest);
      }
      this.registeredTrajectoryAcls.add(cacheKey);
    } catch {
    }
  }
  providerInfo(_provider) {
    return {
      id: PROVIDER_ID,
      name: PROVIDER_DISPLAY_NAME
    };
  }
  providerRetryPolicy(provider) {
    return resolveRetryPolicy(
      {
        mode: "normal",
        maxRetries: 2,
        retryableCodes: [
          "RATE_LIMIT",
          "SERVER",
          "TIMEOUT",
          "TRANSPORT",
          "EMPTY_RESPONSE"
        ],
        backoff: {
          initialDelayMs: 600,
          maxDelayMs: 8e3,
          jitterRatio: 0.1
        }
      },
      `antigravity:${provider}`
    );
  }
  async listModels(_provider) {
    await this.service.accounts.ensureLoaded();
    const active = this.service.accounts.getActiveAccount();
    const quota = active ? this.service.accounts.getQuota(active.id) : void 0;
    return this.service.catalog.listModels(quota);
  }
  async resolveModel(_provider, model, signal) {
    signal?.throwIfAborted();
    await this.service.catalog.ensureLoaded();
    signal?.throwIfAborted();
    return this.service.catalog.resolveModel(model);
  }
  async prepareCall(provider, model, signal) {
    signal?.throwIfAborted();
    await this.service.accounts.ensureLoaded();
    await this.service.catalog.ensureLoaded();
    signal?.throwIfAborted();
    const active = this.service.accounts.getActiveAccount();
    if (!active) {
      throw new LlmError2(
        "No Antigravity Google account is signed in. Open Settings -> Antigravity or run /antigravity-accounts to connect one.",
        "AUTH"
      );
    }
    try {
      const fresh = await this.service.accounts.ensureFreshToken(active.id, signal);
      await this.service.ensureAccountProjectId(fresh, signal);
    } catch (error) {
      if (error instanceof LlmError2) throw error;
      throw new LlmError2(
        `Antigravity credential refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        "AUTH",
        { cause: error }
      );
    }
    const resolvedModel = await this.resolveModel(provider, model, signal);
    return {
      model: resolvedModel,
      stream: (options) => this.stream(options)
    };
  }
  async *stream(options) {
    await this.service.accounts.ensureLoaded();
    await this.service.catalog.ensureLoaded();
    const canonicalModel = normalizeModelId(options.model);
    const pool = classifyPool(canonicalModel);
    const sessionKey = options.sessionId?.trim() || "default";
    const images = await this.service.resolveImages(options, options.signal);
    let failoverAttemptsRemaining = 1;
    let bumped1M = false;
    for (; ; ) {
      let selected;
      try {
        selected = this.service.accounts.selectAccountForSession(
          sessionKey,
          pool
        ).account;
      } catch (error) {
        throw new LlmError2(
          error instanceof Error ? error.message : String(error),
          "AUTH",
          { cause: error }
        );
      }
      let freshAccount;
      try {
        freshAccount = await this.service.accounts.ensureFreshToken(
          selected.id,
          options.signal
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const switched = this.service.accounts.recordFailure({
          accountId: selected.id,
          sessionKey,
          category: "AUTH",
          message: msg,
          pool
        });
        if (switched && failoverAttemptsRemaining > 0) {
          failoverAttemptsRemaining -= 1;
          continue;
        }
        throw new LlmError2(
          `Antigravity OAuth refresh failed (${selected.email}): ${msg}`,
          "AUTH",
          { cause: error }
        );
      }
      const projectId = await this.service.ensureAccountProjectId(
        freshAccount,
        options.signal
      );
      const sessionGeneration = this.service.accounts.getUpstreamSessionGeneration(
        freshAccount.id,
        sessionKey
      );
      const trajectoryId = this.getOrCreateTrajectoryId(freshAccount.id, sessionKey);
      const { envelope, requestId } = buildAntigravityRequest({
        options,
        accountId: freshAccount.id,
        accountEmail: freshAccount.email,
        projectId,
        sessionGeneration,
        trajectoryId,
        defaultThinkingEffort: this.service.config.defaultThinkingEffort,
        images
      });
      await this.ensureTrajectoryAclRegistered({
        accountId: freshAccount.id,
        accessToken: freshAccount.accessToken,
        projectId,
        trajectoryId: extractTrajectoryId(requestId),
        signal: options.signal
      });
      let response;
      try {
        const res = await this.service.client.post({
          method: "streamGenerateContent",
          queryString: "alt=sse",
          body: envelope,
          accessToken: freshAccount.accessToken,
          projectId,
          requestId,
          isContentRequest: true,
          signal: options.signal,
          allowSameAccount429Retry: true
        });
        response = res.response;
      } catch (error) {
        if (error instanceof AntigravityUpstreamError) {
          if (error.classified.isOneMillionContextError && !bumped1M) {
            bumped1M = true;
            this.service.accounts.bumpUpstreamSessionGeneration(
              freshAccount.id,
              sessionKey
            );
            continue;
          }
          const switched = this.service.accounts.recordFailure({
            accountId: freshAccount.id,
            sessionKey,
            category: error.classified.category,
            message: error.classified.message,
            retryAfterMs: error.classified.retryAfterMs,
            pool
          });
          if (switched && failoverAttemptsRemaining > 0) {
            failoverAttemptsRemaining -= 1;
            continue;
          }
        }
        throw error;
      }
      if (!response.body) {
        throw new LlmError2(
          "Antigravity stream response contained no body",
          "EMPTY_RESPONSE"
        );
      }
      const decoder = new GeminiSseStreamDecoder(
        canonicalModel,
        freshAccount.id,
        requestId
      );
      const watchdog = createStreamIdleWatchdog(
        options.signal,
        this.service.config.streamIdleTimeoutMs
      );
      const reader = response.body.getReader();
      let emittedAnyChunk = false;
      try {
        for (; ; ) {
          if (watchdog.signal.aborted) {
            throw watchdog.signal.reason instanceof Error ? watchdog.signal.reason : new LlmError2("Antigravity stream aborted", "ABORTED");
          }
          const readPromise = reader.read();
          const abortPromise = new Promise((_resolve, reject) => {
            if (watchdog.signal.aborted) {
              reject(watchdog.signal.reason);
              return;
            }
            const onAbort = () => reject(watchdog.signal.reason);
            watchdog.signal.addEventListener("abort", onAbort, { once: true });
            void readPromise.finally(
              () => watchdog.signal.removeEventListener("abort", onAbort)
            );
          });
          const step = await Promise.race([readPromise, abortPromise]);
          if (step.done) break;
          watchdog.touch();
          const chunks = decoder.feed(step.value);
          for (const chunk of chunks) {
            emittedAnyChunk = true;
            yield chunk;
          }
        }
        const finalized = decoder.finish();
        if (!finalized.hasOutput && !emittedAnyChunk) {
          throw new LlmError2(
            "Antigravity upstream stream completed with zero content blocks",
            "EMPTY_RESPONSE"
          );
        }
        this.service.accounts.recordSuccess(freshAccount.id, sessionKey);
        this.service.telemetry.record({
          model: canonicalModel,
          accountEmail: freshAccount.email,
          usage: finalized.usage
        });
        for (const chunk of finalized.chunks) {
          yield chunk;
        }
        return;
      } catch (error) {
        try {
          await reader.cancel();
        } catch {
        }
        if (options.signal?.aborted) {
          throw new LlmError2("Antigravity stream aborted by caller", "ABORTED", {
            cause: error
          });
        }
        if (error instanceof AntigravityUpstreamError) {
          this.service.accounts.recordFailure({
            accountId: freshAccount.id,
            sessionKey,
            category: error.classified.category,
            message: error.classified.message,
            retryAfterMs: error.classified.retryAfterMs,
            pool
          });
        }
        if (error instanceof LlmError2) throw error;
        throw new LlmError2(
          `Antigravity stream failed: ${error instanceof Error ? error.message : String(error)}`,
          "TRANSPORT",
          { cause: error }
        );
      } finally {
        watchdog.cleanup();
      }
    }
  }
};

// packages/dsh-antigravity/src/host/commands.ts
function tryRegisterCommand(cmdService, def) {
  try {
    return cmdService.register({
      ...def,
      recordInput: false
    });
  } catch (error) {
    console.warn(
      `[dsh-antigravity] command "/${def.name}" registration skipped:`,
      error instanceof Error ? error.message : error
    );
    return void 0;
  }
}
function formatPct(fraction) {
  return `${Math.round(fraction * 100)}%`;
}
function registerAntigravityCommands(ctx, service) {
  ctx.inject(["commands"], (cmdCtx) => {
    if (typeof cmdCtx?.commands?.register !== "function") return;
    cmdCtx.effect(() => {
      const disposers = [];
      const reg = (def) => {
        const d = tryRegisterCommand(cmdCtx.commands, def);
        if (d) disposers.push(d);
      };
      reg({
        name: "antigravity-status",
        description: "Show Antigravity active account, quota pools, cold-cache notice, and cache hit rate",
        handler: async () => {
          const status = await service.getStatusPayload();
          const active = status.accounts.find((a) => a.isActive);
          const lines = [
            `Antigravity (${status.providerName})`,
            `Accounts: ${status.accounts.length}${active ? ` | Active: ${active.email}${active.tierLabel ? ` [${active.tierLabel}]` : ""}` : " (not signed in)"}`
          ];
          if (status.coldNotice) {
            lines.push(
              `Notice: \u7F13\u5B58\u5DF2\u91CD\u5EFA\uFF08\u51B7\u7F13\u5B58\uFF09-> ${status.coldNotice.toEmail} (${status.coldNotice.reason})`
            );
          }
          if (status.quota && status.quota.groups.length > 0) {
            lines.push(
              "Quota: " + status.quota.groups.map((g) => `${g.label} ${formatPct(g.remainingFraction)}`).join(" | ")
            );
          }
          lines.push(
            `Telemetry: ${status.telemetry.turnCount} turns, cache hit ${formatPct(status.telemetry.aggregateCacheHitRate)} (${status.telemetry.totalCacheReadTokens} cached / ${status.telemetry.totalUncachedInputTokens} uncached input)`
          );
          return { kind: "success", text: lines.join("\n") };
        }
      });
      reg({
        name: "antigravity-accounts",
        description: "List configured Google accounts for Antigravity",
        handler: async () => {
          const status = await service.getStatusPayload();
          if (status.accounts.length === 0) {
            return {
              kind: "success",
              text: "No Google accounts connected. Open Settings -> Antigravity to sign in."
            };
          }
          const lines = status.accounts.map((a, idx) => {
            const flags = [
              a.isActive ? "ACTIVE" : void 0,
              a.tierLabel,
              a.needsReauth ? "NEEDS_REAUTH" : void 0,
              a.cooldownUntil ? "COOLDOWN" : void 0,
              a.lowestQuotaFraction !== void 0 ? `minQuota=${formatPct(a.lowestQuotaFraction)}` : void 0
            ].filter(Boolean).join(", ");
            return `${idx + 1}. ${a.email} (${a.id.slice(0, 8)}) [${flags}]`;
          });
          return { kind: "success", text: lines.join("\n") };
        }
      });
      reg({
        name: "antigravity-switch",
        description: "Switch sticky Antigravity account by email or account id prefix",
        input: { hint: "<email-or-id>" },
        handler: async (invocation) => {
          const query = String(invocation?.rawInput ?? "").trim();
          if (!query) {
            return { kind: "error", text: "Usage: /antigravity-switch <email-or-id>" };
          }
          await service.accounts.ensureLoaded();
          const match = service.accounts.findAccountByQuery(query);
          if (!match) {
            return { kind: "error", text: `No Antigravity account matches "${query}"` };
          }
          const sessionKey = invocation?.agent?.session?.id;
          const evt = await service.accounts.manualSwitchAccount(
            match.id,
            typeof sessionKey === "string" ? sessionKey : void 0
          );
          await service.refreshQuotaAndModelsForAccount(match.id).catch(() => void 0);
          service.notifyAdaptersUpdated();
          return {
            kind: "success",
            text: `Switched Antigravity account to ${evt.toEmail} (\u7F13\u5B58\u5DF2\u91CD\u5EFA / \u51B7\u7F13\u5B58).`
          };
        }
      });
      reg({
        name: "antigravity-quota",
        description: "Refresh and display live Antigravity quota pools",
        handler: async () => {
          const quota = await service.refreshQuotaAndModelsForAccount();
          if (!quota) {
            return {
              kind: "error",
              text: "No active Antigravity account signed in."
            };
          }
          if (quota.degraded && quota.groups.length === 0) {
            return {
              kind: "error",
              text: `Quota lookup failed (fail-open active): ${quota.error ?? "unknown error"}`
            };
          }
          const rows = quota.groups.map((g) => {
            const flag = g.isExhausted ? " [EXHAUSTED <=5%]" : g.isLow ? " [LOW <15%]" : "";
            const reset = g.resetTime ? ` (resets ${g.resetTime})` : "";
            return `- ${g.label}: ${formatPct(g.remainingFraction)}${flag}${reset}`;
          });
          return {
            kind: "success",
            text: [`Quota for ${quota.email}${quota.tierLabel ? ` (${quota.tierLabel})` : ""}:`, ...rows].join(
              "\n"
            )
          };
        }
      });
      reg({
        name: "antigravity-doctor",
        description: "Run Antigravity direct connection diagnostics (OAuth, loadCodeAssist, countTokens, header hygiene)",
        handler: async () => {
          const report = await service.runDoctor();
          const lines = report.checks.map(
            (c) => `${c.ok ? "[PASS]" : "[FAIL]"} ${c.name}: ${c.detail}${c.latencyMs !== void 0 ? ` (${c.latencyMs}ms)` : ""}`
          );
          return {
            kind: report.ok ? "success" : "error",
            text: [`User-Agent: ${report.userAgent}`, ...lines].join("\n")
          };
        }
      });
      return () => {
        for (const dispose of disposers) {
          dispose();
        }
      };
    }, "dsh-antigravity: commands");
  });
}

// packages/dsh-antigravity/src/host/server.ts
var API_PREFIX = "/antigravity/api";
var MAX_BODY_BYTES = 256 * 1024;
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}
function sendMethodNotAllowed(res) {
  sendJson(res, 405, { ok: false, error: "method not allowed" });
}
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request JSON body must be an object");
  }
  return parsed;
}
function registerAntigravityWebApi(ctx, service) {
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: "prefix",
        path: API_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url || "/", "http://dsh.local");
          const subpath = url.pathname.replace(/^\/antigravity\/api\/?/, "").replace(/\/+$/, "");
          try {
            if (subpath === "" || subpath === "status") {
              if (req.method !== "GET") return sendMethodNotAllowed(res);
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            if (subpath === "login") {
              if (req.method !== "POST") return sendMethodNotAllowed(res);
              const status = await service.oauth.beginLogin();
              return sendJson(res, 200, { ok: true, value: status });
            }
            if (subpath === "login/cancel") {
              if (req.method !== "POST") return sendMethodNotAllowed(res);
              service.oauth.cancelLogin();
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            if (subpath === "login/manual") {
              if (req.method !== "POST") return sendMethodNotAllowed(res);
              const body = await readJsonBody(req);
              const input = typeof body.input === "string" ? body.input : typeof body.code === "string" ? body.code : "";
              await service.oauth.completeManualCallback(input);
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            if (subpath === "accounts/switch") {
              if (req.method !== "POST") return sendMethodNotAllowed(res);
              const body = await readJsonBody(req);
              const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
              if (!accountId) {
                return sendJson(res, 400, {
                  ok: false,
                  error: "accountId is required"
                });
              }
              await service.accounts.manualSwitchAccount(accountId);
              await service.refreshQuotaAndModelsForAccount(accountId).catch(() => void 0);
              service.notifyAdaptersUpdated();
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            if (subpath === "accounts/remove") {
              if (req.method !== "POST") return sendMethodNotAllowed(res);
              const body = await readJsonBody(req);
              const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
              if (!accountId) {
                return sendJson(res, 400, {
                  ok: false,
                  error: "accountId is required"
                });
              }
              await service.accounts.removeAccount(accountId);
              service.notifyAdaptersUpdated();
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            if (subpath === "logout") {
              if (req.method !== "POST") return sendMethodNotAllowed(res);
              service.oauth.cancelLogin();
              await service.accounts.clearAll();
              service.notifyAdaptersUpdated();
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            if (subpath === "quota") {
              if (req.method !== "GET" && req.method !== "POST") {
                return sendMethodNotAllowed(res);
              }
              await service.refreshQuotaAndModelsForAccount();
              service.notifyAdaptersUpdated();
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            if (subpath === "models") {
              if (req.method === "GET") {
                const status = await service.getStatusPayload();
                return sendJson(res, 200, { ok: true, value: status.models });
              }
              if (req.method === "POST") {
                const body = await readJsonBody(req);
                if (!Array.isArray(body.enabledModelIds)) {
                  return sendJson(res, 400, {
                    ok: false,
                    error: "enabledModelIds must be an array"
                  });
                }
                await service.catalog.setEnabledModelIds(
                  body.enabledModelIds
                );
                service.notifyAdaptersUpdated();
                return sendJson(res, 200, {
                  ok: true,
                  value: await service.getStatusPayload()
                });
              }
              return sendMethodNotAllowed(res);
            }
            if (subpath === "doctor") {
              if (req.method !== "POST" && req.method !== "GET") {
                return sendMethodNotAllowed(res);
              }
              const report = await service.runDoctor();
              return sendJson(res, 200, { ok: true, value: report });
            }
            if (subpath === "dismiss-cold-notice") {
              if (req.method !== "POST") return sendMethodNotAllowed(res);
              service.accounts.dismissColdNotice();
              return sendJson(res, 200, {
                ok: true,
                value: await service.getStatusPayload()
              });
            }
            return sendJson(res, 404, { ok: false, error: "not found" });
          } catch (error) {
            return sendJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }),
      "dsh-antigravity: web api"
    );
  });
}

// packages/dsh-antigravity/src/host/index.ts
var name = "dsh-antigravity";
var inject = ["llm"];
function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const service = new AntigravityService(config, {
    resolveAttachments: () => {
      try {
        return ctx.get?.("attachments");
      } catch {
        return void 0;
      }
    },
    resolveFsHostMapper: () => {
      try {
        const fsService = ctx.get?.("fs");
        if (fsService && typeof fsService.processPathFromHostPath === "function") {
          return (hostPath) => fsService.processPathFromHostPath(hostPath);
        }
      } catch {
      }
      return void 0;
    },
    onAdaptersUpdated: () => {
      try {
        ctx.emit?.("llm/models-updated", PROVIDER_ID);
        ctx.emit?.("llm/adapters-updated");
      } catch {
      }
    }
  });
  ctx.effect(() => {
    const handle = ctx.llm.registerAdapter([PROVIDER_ID], service.adapter);
    return () => {
      if (typeof handle === "function") {
        handle();
      } else if (handle && typeof handle.dispose === "function") {
        handle.dispose();
      }
    };
  }, "dsh-antigravity: adapter");
  let disposed = false;
  void service.accounts.ensureLoaded().then(async () => {
    if (disposed) return;
    await service.catalog.ensureLoaded();
    if (disposed) return;
    const active = service.accounts.getActiveAccount();
    if (active && !active.needsReauth) {
      await service.refreshQuotaAndModelsForAccount(active.id).catch(() => void 0);
    }
    if (!disposed) {
      service.notifyAdaptersUpdated();
    }
  }).catch(() => void 0);
  ctx.effect(
    () => () => {
      disposed = true;
      service.oauth.cancelLogin();
    },
    "dsh-antigravity: cleanup"
  );
  registerAntigravityWebApi(ctx, service);
  registerAntigravityCommands(ctx, service);
}
export {
  Config,
  apply,
  inject,
  name
};

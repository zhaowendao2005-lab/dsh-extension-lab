// src/host/index.ts
import Schema from "@deepseek-ai/schemastery";

// src/shared/contract.ts
import { z } from "zod";

// src/shared/frames.ts
var PACKAGE_ID = "dsh-btw-side";
var SERVICE_KEY = "btwSide";
var WIRE_NAMESPACE = "btwSide";

// src/shared/contract.ts
var codec = (symbol, shape) => ({
  mode: "strict",
  typeSymbol: `${PACKAGE_ID}#${symbol}`,
  create: shape
});
var frameCodec = codec("BtwFrame", () => z.any());
var watchRequestCodec = codec(
  "WatchRequest",
  () => z.object({ sessionId: z.string(), afterSeq: z.number().optional() })
);
var stateRequestCodec = codec("StateRequest", () => z.object({ sessionId: z.string() }));
var closeRequestCodec = codec(
  "CloseRequest",
  () => z.object({ sessionId: z.string(), requestId: z.string() })
);
var clearRequestCodec = codec("ClearRequest", () => z.object({ sessionId: z.string() }));
var stateResultCodec = codec("StateResult", () => z.any());
var okCodec = codec("OkResult", () => z.object({ ok: z.boolean() }));
var requestParam = (name2, payload) => ({
  name: name2,
  wire: name2,
  source: "json",
  codec: payload
});
var endpoint = (method) => `${PACKAGE_ID}#${WIRE_NAMESPACE}/${method}`;
var DESCRIPTORS = [
  {
    id: endpoint("watch"),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: "watch",
    mode: "stream",
    invocation: { kind: "direct" },
    parameters: [requestParam("request", watchRequestCodec)],
    cancellation: { parameter: "signal" },
    result: frameCodec
  },
  {
    id: endpoint("state"),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: "state",
    invocation: { kind: "direct" },
    parameters: [requestParam("request", stateRequestCodec)],
    result: stateResultCodec
  },
  {
    id: endpoint("close"),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: "close",
    invocation: { kind: "direct" },
    parameters: [requestParam("request", closeRequestCodec)],
    result: okCodec
  },
  {
    id: endpoint("clear"),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: "clear",
    invocation: { kind: "direct" },
    parameters: [requestParam("request", clearRequestCodec)],
    result: okCodec
  }
];
var hostContribution = {
  package: PACKAGE_ID,
  face: "host",
  schemas: [],
  invocations: DESCRIPTORS,
  model: { symbols: [], exports: [], relations: [] }
};

// src/host/capture.ts
var SIDE_REQUESTS = /* @__PURE__ */ new WeakSet();
function markSideRequest(request) {
  SIDE_REQUESTS.add(request);
  return request;
}
function isSideRequest(request) {
  return SIDE_REQUESTS.has(request);
}
var CaptureStore = class {
  constructor(capacity = 8) {
    this.capacity = capacity;
  }
  snapshots = /* @__PURE__ */ new Map();
  order = [];
  get(sessionId) {
    return this.snapshots.get(sessionId);
  }
  set(snapshot) {
    this.snapshots.set(snapshot.sessionId, snapshot);
    this.order = this.order.filter((id) => id !== snapshot.sessionId);
    this.order.push(snapshot.sessionId);
    while (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== void 0) this.snapshots.delete(evicted);
    }
  }
  drop(sessionId) {
    if (sessionId === void 0) return;
    this.snapshots.delete(sessionId);
    this.order = this.order.filter((id) => id !== sessionId);
  }
};
function isAgentLoopRequestShape(options) {
  return options !== null && typeof options === "object" && typeof options.sessionId === "string" && Array.isArray(options.messages) && Object.prototype.hasOwnProperty.call(options, "toolHistory");
}
function installCapture(ctx, store) {
  ctx.on(
    "llm/stream",
    (options, next) => {
      try {
        if (!isSideRequest(options) && isAgentLoopRequestShape(options) && options.purpose === void 0) {
          const provider = typeof options.provider === "string" ? options.provider : "";
          const model = typeof options.model === "string" ? options.model : "";
          if (provider !== "" && model !== "") {
            store.set({
              sessionId: options.sessionId,
              capturedAt: Date.now(),
              provider,
              model,
              ...typeof options.reasoningEffort === "string" ? { reasoningEffort: options.reasoningEffort } : {},
              ...typeof options.temperature === "number" ? { temperature: options.temperature } : {},
              ...typeof options.maxTokens === "number" ? { maxTokens: options.maxTokens } : {},
              ...Array.isArray(options.tools) ? { tools: options.tools } : {},
              messageCount: options.messages.length
            });
          }
        }
      } catch {
      }
      return next();
    },
    { global: true, prepend: true }
  );
  try {
    ctx.on("session/disposed", (session) => {
      store.drop(typeof session?.id === "string" ? session.id : void 0);
    });
  } catch {
  }
}

// src/host/payload.ts
var SIDE_ANSWER_ONLY = "\u8FD9\u662F\u4E00\u6B21\u65C1\u8DEF\u63D0\u95EE\uFF1A\u53EA\u4F9D\u636E\u5F53\u524D\u5BF9\u8BDD\u5DF2\u6709\u7684\u4E0A\u4E0B\u6587\u76F4\u63A5\u56DE\u7B54\uFF0C\u4E0D\u8981\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\uFF0C\u4E5F\u4E0D\u8981\u8F93\u51FA\u6216\u63D0\u8BAE\u5DE5\u5177\u8C03\u7528\u3002";
var BtwError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "BtwError";
  }
};
function trimUnansweredAssistant(messages) {
  const last = messages[messages.length - 1];
  if (last === void 0 || last.role !== "assistant" || !Array.isArray(last.content)) return messages;
  const hasToolCall = last.content.some((block) => block?.type === "tool-call" || block?.type === "tool_call");
  return hasToolCall ? messages.slice(0, -1) : messages;
}
function buildSideRequest(args) {
  const { session, snapshot, config, question, requestId, signal } = args;
  const sessionId = typeof session?.id === "string" ? session.id : "";
  if (sessionId === "") throw new BtwError("unavailable", "\u5F53\u524D\u4F1A\u8BDD\u4E0D\u53EF\u7528");
  let provider = snapshot?.provider ?? "";
  let model = snapshot?.model ?? "";
  let reasoningEffort = snapshot?.reasoningEffort;
  let temperature = snapshot?.temperature;
  let tools = snapshot?.tools;
  let reason = "captured";
  let capturedAt = snapshot?.capturedAt ?? Date.now();
  if (snapshot === void 0) {
    reason = "reconstructed";
    capturedAt = Date.now();
    let header;
    try {
      header = session.requestHeader?.();
    } catch {
      header = void 0;
    }
    const callConfig = header?.config;
    if (callConfig === void 0) {
      throw new BtwError("no-context", "\u8FD9\u6761\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u4EFB\u4F55\u771F\u5B9E\u7684\u6A21\u578B\u8BF7\u6C42\uFF0C\u5148\u53D1\u4E00\u6761\u6D88\u606F\u518D\u65C1\u8DEF\u63D0\u95EE");
    }
    provider = typeof callConfig.provider === "string" ? callConfig.provider : "";
    model = typeof callConfig.model === "string" ? callConfig.model : "";
    reasoningEffort = typeof callConfig.reasoningEffort === "string" ? callConfig.reasoningEffort : void 0;
    temperature = typeof callConfig.temperature === "number" ? callConfig.temperature : void 0;
    tools = Array.isArray(header?.tools) ? header.tools : void 0;
  }
  if (provider === "" || model === "") {
    throw new BtwError("no-context", "\u8FD9\u6761\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u53EF\u590D\u7528\u7684\u771F\u5B9E\u8BF7\u6C42\u8BB0\u5F55\uFF0C\u5148\u53D1\u4E00\u6761\u6D88\u606F\u518D\u65C1\u8DEF\u63D0\u95EE");
  }
  let surface;
  try {
    surface = session.deriveMessages();
  } catch {
    surface = [];
  }
  if (!Array.isArray(surface)) surface = [];
  if (surface.length === 0) {
    throw new BtwError("no-context", "\u5F53\u524D\u8BF7\u6C42\u4E0A\u4E0B\u6587\u4E3A\u7A7A\uFF0C\u5148\u53D1\u4E00\u6761\u6D88\u606F\u518D\u65C1\u8DEF\u63D0\u95EE");
  }
  const messages = trimUnansweredAssistant([...surface]);
  const userMessage = {
    id: `btw-${requestId}`,
    role: "user",
    content: [{ type: "text", text: `${SIDE_ANSWER_ONLY}

${question}` }]
  };
  const request = {
    provider,
    model,
    messages: [...messages, userMessage],
    maxTokens: config.maxTokens,
    signal
  };
  if (reasoningEffort !== void 0) request.reasoningEffort = reasoningEffort;
  if (temperature !== void 0) request.temperature = temperature;
  if (Array.isArray(tools) && tools.length > 0) request.tools = tools;
  const compressionSessionId = config.compression === "inherit" ? sessionId : config.compression === "isolated" ? `btw:${sessionId}` : void 0;
  if (compressionSessionId !== void 0) request.sessionId = compressionSessionId;
  markSideRequest(request);
  return {
    request,
    sessionId,
    provenance: {
      reason,
      model,
      messageCount: messages.length,
      capturedAt,
      ...snapshot === void 0 ? { degraded: true } : {}
    }
  };
}

// src/host/run.ts
var RING_LIMIT = 512;
var MAX_QUESTION_LENGTH = 4e3;
var MAX_ANSWER_LENGTH = 64 * 1024;
var Subscription = class {
  buffer = [];
  waiter;
  closed = false;
  push(frame) {
    if (this.closed) return;
    this.buffer.push(frame);
    this.wake();
  }
  close() {
    this.closed = true;
    this.wake();
  }
  wake() {
    const waiter = this.waiter;
    this.waiter = void 0;
    waiter?.();
  }
  async *iterate() {
    while (!this.closed) {
      const frame = this.buffer.shift();
      if (frame !== void 0) {
        yield frame;
        continue;
      }
      await new Promise((resolve) => {
        this.waiter = resolve;
      });
    }
  }
};
var FrameBus = class {
  counters = /* @__PURE__ */ new Map();
  rings = /* @__PURE__ */ new Map();
  subscribers = /* @__PURE__ */ new Map();
  emit(sessionId, frame) {
    const seq = (this.counters.get(sessionId) ?? 0) + 1;
    this.counters.set(sessionId, seq);
    const full = { ...frame, seq };
    const ring = this.rings.get(sessionId) ?? [];
    ring.push(full);
    if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);
    this.rings.set(sessionId, ring);
    for (const subscriber of this.subscribers.get(sessionId) ?? []) subscriber.push(full);
    return seq;
  }
  cursor(sessionId) {
    return this.counters.get(sessionId) ?? 0;
  }
  replay(sessionId, after) {
    if (after === void 0) return [];
    return (this.rings.get(sessionId) ?? []).filter((frame) => frame.seq > after);
  }
  subscribe(sessionId) {
    let set = this.subscribers.get(sessionId);
    if (set === void 0) {
      set = /* @__PURE__ */ new Set();
      this.subscribers.set(sessionId, set);
    }
    const subscription = new Subscription();
    set.add(subscription);
    return {
      push: (frame) => subscription.push(frame),
      close: () => {
        subscription.close();
        set?.delete(subscription);
      },
      iterate: () => subscription.iterate()
    };
  }
  reset(sessionId) {
    this.counters.delete(sessionId);
    this.rings.delete(sessionId);
  }
};
var RunManager = class {
  constructor(ctx, config, capture, bus) {
    this.ctx = ctx;
    this.config = config;
    this.capture = capture;
    this.bus = bus;
  }
  commandName = "btw";
  runs = /* @__PURE__ */ new Map();
  active = 0;
  records(sessionId) {
    let map = this.runs.get(sessionId);
    if (map === void 0) {
      map = /* @__PURE__ */ new Map();
      this.runs.set(sessionId, map);
    }
    return map;
  }
  views(sessionId) {
    return [...this.records(sessionId).values()].map((record) => this.viewOf(record));
  }
  viewOf(record) {
    const view = record.view;
    return {
      requestId: view.requestId,
      question: view.question,
      phase: view.phase,
      answer: view.answer,
      ...view.error === void 0 ? {} : { error: { ...view.error } },
      startedAt: view.startedAt,
      ...view.finishedAt === void 0 ? {} : { finishedAt: view.finishedAt },
      ...view.provenance === void 0 ? {} : { provenance: { ...view.provenance } },
      ...view.usage === void 0 ? {} : { usage: { ...view.usage } }
    };
  }
  hasContext(session) {
    if (typeof session?.id !== "string") return false;
    if (this.capture.get(session.id) !== void 0) return true;
    try {
      return typeof session.requestHeader?.()?.config?.provider === "string";
    } catch {
      return false;
    }
  }
  start(session, question) {
    const trimmed = question.trim();
    if (trimmed === "") throw new BtwError("empty-question", "\u65C1\u8DEF\u63D0\u95EE\u5185\u5BB9\u4E3A\u7A7A");
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      throw new BtwError("too-long", `\u65C1\u8DEF\u63D0\u95EE\u5185\u5BB9\u8FC7\u957F\uFF08\u4E0A\u9650 ${MAX_QUESTION_LENGTH} \u5B57\uFF09`);
    }
    const sessionId = session?.id;
    if (typeof sessionId !== "string") throw new BtwError("unavailable", "\u5F53\u524D\u4F1A\u8BDD\u4E0D\u53EF\u7528");
    if (!this.hasContext(session)) {
      throw new BtwError("no-context", "\u8FD9\u6761\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u4EFB\u4F55\u771F\u5B9E\u7684\u6A21\u578B\u8BF7\u6C42\uFF0C\u5148\u53D1\u4E00\u6761\u6D88\u606F\u518D\u65C1\u8DEF\u63D0\u95EE");
    }
    if (this.active >= this.config.maxConcurrent) {
      throw new BtwError("busy", `\u540C\u65F6\u8FDB\u884C\u7684\u65C1\u8DEF\u63D0\u95EE\u5DF2\u8FBE\u4E0A\u9650\uFF08${this.config.maxConcurrent} \u4E2A\uFF09\uFF0C\u7A0D\u540E\u518D\u8BD5`);
    }
    const requestId = `btw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    let payload;
    try {
      payload = buildSideRequest({
        session,
        snapshot: this.capture.get(sessionId),
        config: this.config,
        question: trimmed,
        requestId,
        signal: controller.signal
      });
    } catch (error) {
      controller.abort();
      if (error instanceof BtwError) throw error;
      throw new BtwError("no-context", "\u5F53\u524D\u8BF7\u6C42\u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528\uFF0C\u5148\u53D1\u4E00\u6761\u6D88\u606F\u518D\u65C1\u8DEF\u63D0\u95EE");
    }
    const provenance = payload.provenance;
    const view = {
      requestId,
      question: trimmed,
      phase: "calling",
      answer: "",
      startedAt: Date.now(),
      provenance
    };
    this.bus.emit(sessionId, { type: "accepted", view: { ...view } });
    const record = {
      controller,
      view,
      request: payload.request,
      timedOut: false,
      timeout: setTimeout(() => {
        record.timedOut = true;
        controller.abort();
      }, this.config.timeoutMs)
    };
    const map = this.records(sessionId);
    map.set(requestId, record);
    this.trimHistory(sessionId);
    this.active += 1;
    void this.execute(session, sessionId, record);
    return requestId;
  }
  provenanceOf(session) {
    const snapshot = this.capture.get(session?.id);
    if (snapshot !== void 0) {
      return {
        reason: "captured",
        model: snapshot.model,
        messageCount: snapshot.messageCount,
        capturedAt: snapshot.capturedAt
      };
    }
    return { reason: "reconstructed", model: "\u672A\u77E5", messageCount: 0, capturedAt: Date.now(), degraded: true };
  }
  trimHistory(sessionId) {
    const map = this.records(sessionId);
    if (map.size <= this.config.maxPerSession) return;
    for (const [requestId, record] of map) {
      if (record.view.phase === "done" || record.view.phase === "error" || record.view.phase === "cancelled") {
        map.delete(requestId);
        if (map.size <= this.config.maxPerSession) return;
      }
    }
  }
  setPhase(sessionId, record, phase) {
    record.view.phase = phase;
    if (phase === "calling" || phase === "streaming") {
      this.bus.emit(sessionId, { type: "status", requestId: record.view.requestId, phase });
    }
  }
  async execute(session, sessionId, record) {
    const view = record.view;
    try {
      const llm = this.ctx.get("llm");
      if (llm === void 0 || typeof llm.stream !== "function") {
        throw new BtwError("unavailable", "\u5F53\u524D\u5BBF\u4E3B\u6CA1\u6709\u53EF\u7528\u7684 LLM \u670D\u52A1");
      }
      let reasoningStarted = false;
      let streaming = false;
      let usage;
      let answer = "";
      let aborted = false;
      const stream = llm.stream({ ...record.request, signal: record.controller.signal });
      for await (const chunk of stream) {
        if (record.controller.signal.aborted) {
          aborted = true;
          break;
        }
        switch (chunk?.type) {
          case "text-delta": {
            if (typeof chunk.text !== "string" || chunk.text === "") break;
            if (!streaming) {
              streaming = true;
              this.setPhase(sessionId, record, "streaming");
            }
            answer += chunk.text;
            if (answer.length > MAX_ANSWER_LENGTH) answer = answer.slice(0, MAX_ANSWER_LENGTH);
            this.bus.emit(sessionId, { type: "delta", requestId: view.requestId, text: chunk.text });
            break;
          }
          case "reasoning-delta": {
            if (!reasoningStarted) {
              reasoningStarted = true;
              this.bus.emit(sessionId, { type: "status", requestId: view.requestId, phase: "thinking" });
            }
            break;
          }
          case "usage": {
            const total = chunk?.usage?.totalTokens;
            if (typeof total === "number") usage = { totalTokens: total };
            break;
          }
          case "finish": {
            const reason = chunk?.reason;
            if (reason?.kind === "aborted") {
              aborted = true;
            } else if (reason?.kind === "tool-calls") {
              throw new BtwError("tools-attempted", "\u6A21\u578B\u60F3\u8C03\u7528\u5DE5\u5177\u6765\u5B8C\u6210\u8FD9\u4E2A\u95EE\u9898\uFF0C\u4F46\u65C1\u8DEF\u63D0\u95EE\u53EA\u57FA\u4E8E\u5DF2\u6709\u4E0A\u4E0B\u6587\u4F5C\u7B54\uFF1B\u6362\u4E2A\u95EE\u6CD5\uFF08\u4F8B\u5982\u300C\u6839\u636E\u5F53\u524D\u4E0A\u4E0B\u6587\u603B\u7ED3\u2026\u300D\uFF09\u518D\u8BD5");
            } else if (reason?.kind === "error") {
              const message = reason?.failure?.message ?? reason?.message ?? "\u6A21\u578B\u8BF7\u6C42\u5931\u8D25";
              throw new BtwError("model", String(message));
            }
            break;
          }
          default:
            break;
        }
      }
      if (aborted) {
        this.finishCancelled(sessionId, record);
        return;
      }
      view.answer = answer;
      view.phase = "done";
      view.finishedAt = Date.now();
      if (usage !== void 0) view.usage = usage;
      this.bus.emit(sessionId, {
        type: "done",
        requestId: view.requestId,
        answer,
        ...usage === void 0 ? {} : { usage },
        finishedAt: view.finishedAt
      });
    } catch (error) {
      if (record.timedOut) {
        this.finishError(sessionId, record, "timeout", `\u65C1\u8DEF\u63D0\u95EE\u8D85\u65F6\uFF08${Math.round(this.config.timeoutMs / 1e3)} \u79D2\uFF09\uFF0C\u8BF7\u91CD\u8BD5`);
      } else if (record.controller.signal.aborted) {
        this.finishCancelled(sessionId, record);
      } else if (error instanceof BtwError) {
        this.finishError(sessionId, record, error.code, error.message);
      } else {
        const message = error instanceof Error && error.message !== "" ? error.message : "\u65C1\u8DEF\u63D0\u95EE\u5931\u8D25";
        this.finishError(sessionId, record, "model", message);
      }
    } finally {
      clearTimeout(record.timeout);
      this.active = Math.max(0, this.active - 1);
    }
  }
  finishCancelled(sessionId, record) {
    record.view.phase = "cancelled";
    record.view.finishedAt = Date.now();
    this.bus.emit(sessionId, { type: "cancelled", requestId: record.view.requestId });
  }
  finishError(sessionId, record, code, message) {
    record.view.phase = "error";
    record.view.finishedAt = Date.now();
    record.view.error = { code, message };
    this.bus.emit(sessionId, { type: "error", requestId: record.view.requestId, code, message });
  }
  abort(sessionId, requestId) {
    const record = this.runs.get(sessionId)?.get(requestId);
    if (record === void 0) return false;
    if (record.view.phase === "done" || record.view.phase === "error" || record.view.phase === "cancelled") return false;
    record.controller.abort();
    return true;
  }
  clear(sessionId) {
    for (const record of this.runs.get(sessionId)?.values() ?? []) {
      if (record.view.phase !== "done" && record.view.phase !== "error" && record.view.phase !== "cancelled") {
        record.controller.abort();
      }
    }
    this.runs.delete(sessionId);
    this.bus.reset(sessionId);
  }
  abortAll() {
    for (const [sessionId, map] of this.runs) {
      for (const record of map.values()) {
        if (record.view.phase !== "done" && record.view.phase !== "error" && record.view.phase !== "cancelled") {
          record.controller.abort();
        }
      }
      this.bus.reset(sessionId);
    }
    this.runs.clear();
  }
};

// src/host/service.ts
import { Service } from "@deepseek-ai/cordis";
import { bindTypertRemote, Remote } from "@deepseek-ai/dsh-typert-protocol";
var remoteInitializers = [];
var BtwSideService = class extends Service {
  typertRemote;
  deps;
  constructor(ctx, deps) {
    super(ctx, "btwSide");
    this.deps = deps;
    this.typertRemote = bindTypertRemote(this, "btwSide");
    for (const init of remoteInitializers) init.call(this);
  }
  async *watch(request, signal) {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId : "";
    if (sessionId === "") return;
    const subscription = this.deps.bus.subscribe(sessionId);
    const onAbort = () => subscription.close();
    signal?.addEventListener?.("abort", onAbort);
    try {
      const questions = this.deps.runs.views(sessionId);
      const cursor = this.deps.bus.cursor(sessionId);
      yield {
        type: "baseline",
        sessionId,
        commandName: this.deps.runs.commandName,
        questions,
        cursor
      };
      for await (const frame of subscription.iterate()) {
        yield frame;
      }
    } finally {
      signal?.removeEventListener?.("abort", onAbort);
      subscription.close();
    }
  }
  async state(request) {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId : "";
    return {
      commandName: this.deps.runs.commandName,
      questions: this.deps.runs.views(sessionId),
      cursor: this.deps.bus.cursor(sessionId)
    };
  }
  async close(request) {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId : "";
    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    this.deps.runs.abort(sessionId, requestId);
    return { ok: true };
  }
  async clear(request) {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId : "";
    this.deps.runs.clear(sessionId);
    return { ok: true };
  }
};
function markRemoteMethod(name2, fn) {
  ;
  Remote(name2)(fn, {
    kind: "method",
    name: name2,
    static: false,
    private: false,
    addInitializer(init) {
      remoteInitializers.push(init);
    }
  });
}
markRemoteMethod("watch", BtwSideService.prototype.watch);
markRemoteMethod("state", BtwSideService.prototype.state);
markRemoteMethod("close", BtwSideService.prototype.close);
markRemoteMethod("clear", BtwSideService.prototype.clear);

// src/host/command.ts
function candidatesOf(base, onConflict) {
  const list = [base];
  if (onConflict === "rename") {
    list.push(`${base}2`, `${base}-side`);
  }
  return [...new Set(list.filter((name2) => name2.length > 0))];
}
function registerSideCommand(ctx, config, runs) {
  ctx.effect(() => {
    const candidates = candidatesOf(config.commandName, config.onConflict);
    let lastError;
    for (const name2 of candidates) {
      try {
        const dispose = ctx.commands.register({
          name: name2,
          description: "\u65C1\u8DEF\u63D0\u95EE\uFF1A\u57FA\u4E8E\u5F53\u524D\u6700\u65B0\u771F\u5B9E\u6A21\u578B\u8BF7\u6C42\u4E0A\u4E0B\u6587\u72EC\u7ACB\u56DE\u7B54\uFF0C\u4E0D\u6253\u65AD\u4E3B\u7EBF",
          input: { hint: "<\u95EE\u9898>" },
          recordInput: false,
          handler: async (invocation) => {
            try {
              runs.start(invocation?.agent?.session, String(invocation?.rawInput ?? ""));
              return { kind: "success", text: "" };
            } catch (error) {
              if (error instanceof BtwError) return { kind: "error", text: error.message };
              const message = error instanceof Error && error.message !== "" ? error.message : "\u65C1\u8DEF\u63D0\u95EE\u6682\u65F6\u4E0D\u53EF\u7528";
              return { kind: "error", text: message };
            }
          }
        });
        runs.commandName = name2;
        return dispose;
      } catch (error) {
        lastError = error;
      }
    }
    console.warn(
      "[dsh-btw-side] \u65E0\u6CD5\u6CE8\u518C\u65C1\u8DEF\u63D0\u95EE\u547D\u4EE4\uFF08\u53EF\u80FD\u662F\u547D\u4EE4\u540D\u51B2\u7A81\uFF09\uFF1A",
      lastError instanceof Error ? lastError.message : lastError
    );
    return () => {
    };
  }, "btw-side.command");
}

// src/host/types.ts
var DEFAULT_CONFIG = {
  commandName: "btw",
  onConflict: "rename",
  barForm: "dock",
  compression: "inherit",
  maxTokens: 8192,
  timeoutMs: 12e4,
  maxConcurrent: 3,
  maxPerSession: 20,
  showProvenance: true
};
function normalizeConfig(input) {
  const raw = input ?? {};
  const pick = (value, allowed, fallback) => typeof value === "string" && allowed.includes(value) ? value : fallback;
  const num = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    commandName: typeof raw.commandName === "string" && /^[A-Za-z][\w-]{0,31}$/.test(raw.commandName) ? raw.commandName : DEFAULT_CONFIG.commandName,
    onConflict: pick(raw.onConflict, ["rename", "disable"], "rename"),
    barForm: pick(raw.barForm, ["dock", "right-tab"], "dock"),
    compression: pick(raw.compression, ["inherit", "isolated", "direct"], "inherit"),
    maxTokens: Math.round(num(raw.maxTokens, DEFAULT_CONFIG.maxTokens, 64, 8192)),
    timeoutMs: Math.round(num(raw.timeoutMs, DEFAULT_CONFIG.timeoutMs, 1e3, 3e5)),
    maxConcurrent: Math.round(num(raw.maxConcurrent, DEFAULT_CONFIG.maxConcurrent, 1, 16)),
    maxPerSession: Math.round(num(raw.maxPerSession, DEFAULT_CONFIG.maxPerSession, 1, 20)),
    showProvenance: typeof raw.showProvenance === "boolean" ? raw.showProvenance : true
  };
}

// src/host/index.ts
var name = "dsh-btw-side";
var inject = ["commands", "typert"];
var stringEnum = (values, fallback) => {
  const schema = Schema.union(values);
  return schema.default(fallback);
};
var Config = Schema.object({
  commandName: Schema.string().default("btw").pattern(/^[A-Za-z][\w-]{0,31}$/).description("\u65C1\u8DEF\u63D0\u95EE\u547D\u4EE4\u540D\uFF1B\u4E0E\u5176\u5B83\u63D2\u4EF6\u51B2\u7A81\u65F6\u6309 onConflict \u5904\u7406").volatile(),
  onConflict: stringEnum(["rename", "disable"], "rename").description(
    "\u547D\u4EE4\u540D\u51B2\u7A81\u65F6\u7684\u884C\u4E3A\uFF1Arename=\u81EA\u52A8\u6539\u7528 btw2/btw-side\uFF0Cdisable=\u653E\u5F03\u6CE8\u518C"
  ).volatile(),
  barForm: stringEnum(["dock", "right-tab"], "dock").description(
    "\u65C1\u8DEF\u680F\u5F62\u6001\uFF1Adock=\u8F93\u5165\u6846\u4E0A\u65B9\u7684\u680F\uFF0Cright-tab=\u53F3\u4FA7\u680F\u9875\u7B7E\uFF08P2\uFF09"
  ).volatile(),
  compression: stringEnum(["inherit", "isolated", "direct"], "inherit").description(
    "\u4FA7\u95EE\u7684\u538B\u7F29\u5F52\u56E0\uFF1Ainherit=\u6CBF\u7528\u4E3B\u4F1A\u8BDD\uFF08\u4E0E\u538B\u7F29\u63D2\u4EF6\u7B49\u4EF7\uFF09\uFF0Cisolated=\u5B8C\u5168\u72EC\u7ACB\u7684\u5408\u6210\u4F1A\u8BDD id\uFF0Cdirect=\u65E0\u5F52\u56E0"
  ).volatile(),
  maxTokens: Schema.number().min(64).max(8192).default(8192).description("\u4FA7\u95EE\u6700\u5927\u8F93\u51FA tokens").volatile(),
  timeoutMs: Schema.number().min(1e3).max(3e5).default(12e4).description("\u4FA7\u95EE\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09").volatile(),
  maxConcurrent: Schema.number().min(1).max(16).default(3).description("\u5168\u5C40\u5E76\u53D1\u4FA7\u95EE\u4E0A\u9650").volatile(),
  maxPerSession: Schema.number().min(1).max(20).default(20).description("\u6BCF\u4E2A\u4F1A\u8BDD\u4FDD\u7559\u7684\u65C1\u95EE\u6761\u6570").volatile(),
  showProvenance: Schema.boolean().default(true).description("\u662F\u5426\u5728\u65C1\u95EE\u5361\u7247\u4E0A\u663E\u793A\u4E0A\u4E0B\u6587\u6765\u6E90").volatile()
});
function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  if (typeof ctx?.commands?.register !== "function" || typeof ctx?.typert?.register !== "function") {
    console.warn("[dsh-btw-side] \u7F3A\u5C11 commands/typert \u670D\u52A1\uFF0C\u63D2\u4EF6\u672A\u542F\u7528");
    return;
  }
  const bus = new FrameBus();
  const capture = new CaptureStore();
  const runs = new RunManager(ctx, cfg, capture, bus);
  new BtwSideService(ctx, { runs, bus });
  ctx.effect(() => ctx.typert.register(hostContribution), "btw-side.remote");
  installCapture(ctx, capture);
  registerSideCommand(ctx, cfg, runs);
  ctx.effect(
    () => ctx.on("session/disposed", (session) => {
      const sessionId = session?.id;
      if (typeof sessionId === "string") runs.clear(sessionId);
    }),
    "btw-side.session"
  );
  ctx.effect(() => () => runs.abortAll(), "btw-side.cleanup");
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map

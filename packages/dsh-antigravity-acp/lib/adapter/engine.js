import os from 'node:os';
import path from 'node:path';
import { createToolBridge } from '../bridge/server.js';
import { inspectCli, startAgyRuntime } from '../runtime/index.js';
import { parseCatalog, selectModel, PROVIDER } from '../catalog.js';
import { requireGatewayPurity, PURITY_STATUS, BRIDGE_TOOL_PREFIX } from '../purity.js';
import { createSanitizingGateway } from '../runtime/gateway.js';
import { AcpError, aborted, failure } from './errors.js';
import { projectRequest, toolResultContent, semanticMessage, assistantMessage, samePrefix, stable } from './context.js';
import { EventQueue, SerialGate } from './queue.js';

async function closeLate(resource) {
  try { await resource.close(); }
  catch(error) { throw new AcpError('ACP_CLEANUP_UNCONFIRMED','初始化期间关闭的 ACP 资源未确认退出。',{cause:error}); }
}


export class AcpEngine {
  constructor({subprocess,config={},readImage,fileRequestText,inspect=inspectCli,start=startAgyRuntime,bridge=createToolBridge,createGateway=createSanitizingGateway,isConversation=()=>false}) {
    Object.assign(this,{subprocess,readImage,fileRequestText,inspect,start,bridge,createGateway,isConversation});
    this.config = {executable:'agy',loginHome:'',maxSessions:4,promptTimeoutMs:600000,...config};
    this.units = new Map(); this.ownedUnits = new Set(); this.building = new Set(); this.gate = new SerialGate(); this.disposed = false;
    this.lifecycle = new AbortController();
    if (!Number.isSafeInteger(this.config.maxSessions) || this.config.maxSessions < 1 || this.config.maxSessions > 8 || !Number.isSafeInteger(this.config.promptTimeoutMs) || this.config.promptTimeoutMs < 1000 || this.config.promptTimeoutMs > 1800000 || typeof this.config.executable !== 'string' || !this.config.executable.trim()) throw new AcpError('ACP_CONFIG_INVALID','ACP 插件配置无效。');
    try {
      this.loginHome = this.config.loginHome === '' ? os.userInfo().homedir : this.config.loginHome;
      if (typeof this.loginHome !== 'string' || !path.isAbsolute(this.loginHome) || this.loginHome.includes('\0')) throw new Error('Invalid login home');
    } catch { throw new AcpError('ACP_LOGIN_HOME_INVALID','CLI 登录目录必须是绝对路径；留空使用当前操作系统用户主目录。'); }
    this.status = {phase:'idle',purity:PURITY_STATUS,modelCount:0,activeSessions:0};
  }
  getStatus() { return structuredClone(this.status); }
  async cli(signal) {
    aborted(signal);
    this.cliInfo ??= this.inspect({subprocess:this.subprocess,executable:this.config.executable,loginHome:this.loginHome,signal}).catch(error => { this.cliInfo = undefined; throw error; });
    return this.cliInfo;
  }
  newUnit(options) {
    const task = this.buildUnit(options);
    this.building.add(task);
    task.then(() => this.building.delete(task),() => this.building.delete(task));
    return task;
  }
  async buildUnit({system='',tools=[],model,reasoningEffort,signal}={}) {
    const unit = {queue:new EventQueue(),pending:new Map(),exposed:new Set(),expected:[],system,tools:stable(tools),active:false,closed:false,sessionId:undefined};
    this.ownedUnits.add(unit);
    signal = signal ? AbortSignal.any([signal,this.lifecycle.signal]) : this.lifecycle.signal;
    try {
      aborted(signal);
      const bridge = await this.bridge({tools,timeoutMs:this.config.promptTimeoutMs,onCall:call => {
        if (!unit.active || unit.closed || !unit.sessionId) throw new AcpError('ACP_UNEXPECTED_CALL','工具调用不属于活跃的 ACP prompt。');
        unit.pending.set(call.id,call);
        if (!unit.queue.push({type:'tool',call})) throw new AcpError('ACP_BACKPRESSURE','工具队列已关闭。');
      }});
      if (unit.closed || signal.aborted) { await closeLate(bridge); aborted(signal); throw new AcpError('ACP_DISPOSED','ACP 会话已关闭。'); }
      unit.bridge = bridge;
      const gateway = await this.createGateway({systemInstruction:system,signal});
      if (!gateway || typeof gateway.endpoint !== 'string' || typeof gateway.attested !== 'function' || typeof gateway.close !== 'function') { await gateway?.close?.(); throw new AcpError('ACP_GATEWAY_INVALID','净化网关未能建立。'); }
      unit.gateway = gateway;
      if (unit.closed || signal.aborted) { await closeLate(gateway); aborted(signal); throw new AcpError('ACP_DISPOSED','ACP 会话已关闭。'); }
      const runtime = await this.start({subprocess:this.subprocess,cli:await this.cli(signal),loginHome:this.loginHome,bridge:unit.bridge,gateway:unit.gateway,bridgeTimeoutMs:this.config.promptTimeoutMs,systemPrompt:system,signal,
        onUpdate:params => {
          if (params?.sessionId !== unit.sessionId || unit.closed) return;
          const update = params.update;
          if (['agent_message_chunk','agent_thought_chunk'].includes(update?.sessionUpdate)) {
            if (update.content?.type !== 'text' || typeof update.content.text !== 'string') { unit.queue.close(new AcpError('ACP_OUTPUT_UNSUPPORTED','CLI 返回了不能投影的输出类型。')); return; }
            unit.queue.push({type:update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'text',text:update.content.text});
          }
          // Tool progress is not authority to execute; only authenticated MCP calls enter pending.
          // usage_update describes context occupancy, not billable generation usage.
        },
        // Only a tool this unit actually published may prompt for permission. The
        // gateway already stripped every declaration except the bridge tools, so
        // an unknown name here means the CLI asked for something we never offered.
        onPermission: params => {
          const name = params?.toolCall?.name;
          const declared = Array.isArray(unit.bridge?.toolNames) ? unit.bridge.toolNames : [];
          const offered = typeof name === 'string' && name.startsWith(BRIDGE_TOOL_PREFIX) && declared.includes(name.slice(BRIDGE_TOOL_PREFIX.length));
          const allow = Array.isArray(params?.options) ? params.options.find(option => option?.kind === 'allow_once') : undefined;
          if (!offered || !allow) { unit.queue.close(new AcpError('ACP_PERMISSION_UNVERIFIED','CLI 权限请求缺乏已核验的规范工具身份；已拒绝请求。')); return {outcome:{outcome:'cancelled'}}; }
          return {outcome:{outcome:'selected', optionId: allow.optionId}};
        }
      });
      if (unit.closed || signal.aborted) { await closeLate(runtime); aborted(signal); throw new AcpError('ACP_DISPOSED','ACP 会话已关闭。'); }
      unit.runtime = runtime;
      unit.runtime.connection.closed.then(({error}={}) => { if (!unit.closed) unit.queue.close(new AcpError('ACP_CONNECTION_LOST','ACP 连接已断开；本次请求未重放。',{cause:error})); });
      const session = await unit.runtime.connection.request('session/new',{cwd:unit.runtime.isolation.cwd,mcpServers:[],_meta:{antigravity:{eagerMcpServers:['dsh-bridge']}}},{signal});
      unit.sessionId = session.sessionId; unit.catalog = parseCatalog(session);
      if (model) await selectModel(unit.runtime.connection,unit.sessionId,unit.catalog,model,reasoningEffort);
      return unit;
    } catch(error) { await this.closeUnit(unit); throw error; }
  }
  async listModels() {
    if (this.disposed) throw new AcpError('ACP_DISPOSED','插件已经停用。');
    this.catalogTask ??= (async () => {
      this.status.phase = 'discovering';
      let unit;
      try {
        unit = await this.newUnit();
        this.catalog = unit.catalog.models.map(model => ({...model,inputModalities:['text'],badge:{text:'经本地网关净化 · 原生工具不外发',tone:'info'}}));
        this.status.modelCount = this.catalog.length; this.status.phase = 'idle';
        return this.catalog;
      } catch(error) { const safe=failure(error); this.status.phase='error'; this.status.error=safe; this.catalogTask=undefined; throw new AcpError(safe.code,safe.message); }
      finally { if (unit) await this.closeUnit(unit); }
    })();
    return structuredClone(await this.catalogTask);
  }
  async resolveModel(model) {
    const resolved = (await this.listModels()).find(item => item.id === model);
    if (!resolved) throw new AcpError('ACP_MODEL_UNAVAILABLE','模型不在当前 CLI 公布的目录中。');
    // Runtime must project only the current executable schemas. Its native
    // in-history mode includes retired declarations that this eager MCP bridge
    // cannot deactivate through a later developer record.
    return {...resolved,systemPromptUpdate:'in-history'};
  }
  async closeUnit(unit) {
    if (unit.closed) return unit.closeTask;
    unit.closed = true; unit.queue.close();
    unit.closeTask = (async () => {
      const errors=[];
      if (unit.active && unit.sessionId) {
        let timer;
        try {
          await Promise.race([
            Promise.resolve().then(() => unit.runtime?.connection.notify('session/cancel',{sessionId:unit.sessionId})),
            new Promise(resolve => {timer=setTimeout(resolve,1000);}),
          ]);
        } catch {} finally {clearTimeout(timer);}
      }
      try { await unit.bridge?.close(); } catch(error) { errors.push(error); }
      try { await unit.gateway?.close(); } catch(error) { errors.push(error); }
      if (unit.sessionId) { try { await unit.runtime?.connection.request('session/close',{sessionId:unit.sessionId},{timeoutMs:1000}); } catch {} }
      const results = await Promise.allSettled([unit.runtime?.close()]);
      for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
      unit.pending.clear(); unit.exposed.clear(); this.ownedUnits.delete(unit);
      if (errors.length) throw new AcpError('ACP_CLEANUP_UNCONFIRMED','ACP 退出状态未确认；保留其私有目录，未复用。',{cause:errors[0]});
    })();
    return unit.closeTask;
  }
  /** A completed turn must have passed the local gateway; otherwise fail closed. */
  attest(unit) {
    const attestation = unit.gateway?.attested?.();
    requireGatewayPurity(attestation);
    this.status.purity = {...PURITY_STATUS,sanitizedAgentRequests:attestation.sanitizedAgentRequests,strippedDeclarations:attestation.strippedDeclarations,systemRewritten:attestation.systemRewritten};
  }
  async *stream(options) {
    let release,unit,key,keep=false,completed=false,continuable=false;
    const blocks=[]; let open,index=0;
    const flush=() => { if (!open) return []; const event={type:'block-end',index:open.index,block:open.block}; blocks.push(open.block); open=undefined; return [event]; };
    try {
      if (this.disposed) throw new AcpError('ACP_DISPOSED','插件已经停用。');
      continuable = Boolean(options.sessionId) && this.isConversation(options);
      options = {...options,signal:options.signal ? AbortSignal.any([options.signal,this.lifecycle.signal]) : this.lifecycle.signal};
      if (options.provider !== PROVIDER) throw new AcpError('ACP_PROVIDER_INVALID','请求的 provider 不属于此适配器。');
      aborted(options.signal);
      if (options.messages?.some(message => message.content?.some(block => block.type === 'image'))) throw new AcpError('ACP_IMAGE_UNVERIFIED','当前版本尚未核验所选 CLI 模型的图片能力；未读取或发送图片。');
      for (const field of ['maxTokens','temperature','stop']) if (options[field] !== undefined) throw new AcpError('ACP_CONTROL_UNSUPPORTED',`当前 ACP 尚不能保证 ${field} 生效。`);
      if (options.reasoningEffort !== undefined) throw new AcpError('ACP_CONTROL_UNSUPPORTED','当前 ACP 尚未核验独立思考档位。');
      release = await this.gate.acquire(options.signal);
      const cli = await this.cli(options.signal);
      const projection = await projectRequest(options,this);
      key = continuable ? stable([options.sessionId,options.purpose ?? 'default']) : Symbol('ephemeral');
      unit = this.units.get(key);
      const route = stable([options.provider,options.model]);
      if (unit && (unit.system !== projection.system || unit.tools !== stable(options.tools ?? []) || unit.route !== route || !samePrefix(unit.expected,projection.messages))) {
        const uncertain = unit.active || unit.pending.size > 0;
        await this.closeUnit(unit); this.units.delete(key); unit=undefined;
        if (uncertain) throw new AcpError('ACP_CONTINUATION_CHANGED','挂起期间上下文、工具或路由改变；请求已取消，未重放工具。');
      }
      if (!unit) {
        if (this.units.size >= this.config.maxSessions) {
          const idle = [...this.units].find(([,value]) => !value.active && !value.pending.size);
          if (!idle) throw new AcpError('ACP_CAPACITY','所有 ACP 会话均有在途工作；请先完成或取消。');
          await this.closeUnit(idle[1]); this.units.delete(idle[0]);
        }
        unit = await this.newUnit({system:projection.system,tools:options.tools ?? [],model:options.model,signal:options.signal});
        unit.route = route; this.units.set(key,unit);
      }
      const newMessages = projection.messages.slice(unit.expected.length);
      if (unit.active) {
        const toolMessages=newMessages.filter(message=>message.role === 'tool');
        const additions=newMessages.filter(message=>message.role === 'user');
        if (!unit.exposed.size || toolMessages.length !== unit.exposed.size || toolMessages.length+additions.length !== newMessages.length || toolMessages.some(message => !unit.exposed.has(message.toolCallId)) || new Set(toolMessages.map(message=>message.toolCallId)).size !== unit.exposed.size) {
          throw new AcpError('ACP_TOOL_RESULTS_MISMATCH','续轮必须提供全部且仅一次当前挂起调用的工具结果；只允许附带新的 DSH user/context 记录。');
        }
        const results = await Promise.all(toolMessages.map(async message => [message.toolCallId,await toolResultContent(message,{...this,signal:options.signal})]));
        if(additions.length){
          const continuation=await projection.promptFor(additions);
          const order=newMessages.map((message,index)=>message.role === 'tool'?{index,role:'tool',toolCallId:message.toolCallId,deliveredSeparately:true}:{index,role:'user',source:message.source});
          // ACP cannot append native user records while a tool is parked. Keep
          // their provenance explicit and separate from the unchanged tool output.
          results.at(-1)[1].content.push({type:'text',text:'DSH continuation additions follow. These are separate DSH user/context records received while this tool was running, not output produced by the tool. Preserve each record role/source. The ordering table references separately delivered tool results.\n'+stable({kind:'dsh-continuation',version:1,order})},...continuation);
        }
        for (const [id,result] of results) {
          if (unit.bridge.resolve(id,result) === false) throw new AcpError('ACP_TOOL_RESULT_STALE','工具结果到达时桥调用已经失效；未重放。');
          unit.pending.delete(id); unit.exposed.delete(id);
        }
      } else {
        if (!newMessages.length) throw new AcpError('ACP_EMPTY_INPUT','没有新的 DSH 消息；未启动额外生成。');
        const prompt = await projection.promptFor(newMessages,{replay:unit.expected.length === 0});
        unit.active = true;
        unit.promptTask = unit.runtime.connection.request('session/prompt',{sessionId:unit.sessionId,prompt},{timeoutMs:this.config.promptTimeoutMs}).then(
          result => unit.queue.push({type:'done',result}),
          error => unit.queue.push({type:'error',error:failure(error)})
        );
      }
      this.status.phase='generating'; this.status.activeSessions=this.units.size;
      while (true) {
        const event = await unit.queue.next(options.signal);
        if (event.type === 'text' || event.type === 'reasoning') {
          if (!event.text) continue;
          if (open?.block.type !== event.type) {
            yield* flush(); open={index:index++,block:{type:event.type,text:''}};
            yield {type:'block-start',index:open.index,blockType:event.type};
          }
          open.block.text += event.text;
          yield {type:event.type === 'text' ? 'text-delta' : 'reasoning-delta',index:open.index,text:event.text};
        } else if (event.type === 'tool') {
          if (!continuable) throw new AcpError('ACP_AUXILIARY_TOOL','非 DSH Agent Loop 请求不能等待工具续轮。');
          this.attest(unit);
          yield* flush(); const block={type:'tool-call',...event.call};
          yield {type:'block-start',index,blockType:'tool-call'};
          yield {type:'tool-call-delta',index,id:block.id,name:block.name,argumentsDelta:block.arguments};
          blocks.push(block); yield {type:'block-end',index:index++,block};
          unit.exposed.add(block.id);
          unit.expected=[...projection.messages,semanticMessage(assistantMessage(blocks,options.provider,options.model))];
          keep=true; completed=true; this.status.phase='waiting-tools';
          yield {type:'finish',reason:{kind:'tool-calls'}}; return;
        } else if (event.type === 'done') {
          yield* flush(); unit.active=false;
          const stop = event.result?.stopReason;
          if (!['end_turn','max_tokens'].includes(stop)) throw new AcpError(stop === 'cancelled' ? 'ACP_ABORTED' : 'ACP_STOP_UNSUPPORTED','ACP 生成未正常完成；未自动重试。');
          this.attest(unit);
          unit.expected=[...projection.messages,semanticMessage(assistantMessage(blocks,options.provider,options.model))];
          keep=continuable; completed=true; this.status.phase='idle';
          yield {type:'finish',reason:{kind:stop === 'max_tokens' ? 'max-tokens' : 'stop'}}; return;
        } else if (event.type === 'error') throw new AcpError(event.error?.code ?? 'ACP_REQUEST_FAILED',event.error?.message ?? 'ACP 生成失败。');
      }
    } catch(error) {
      this.status.phase='error'; this.status.error=failure(error);
      yield* flush();
      yield {type:'finish',reason:{kind:options.signal?.aborted || error?.code === 'ACP_ABORTED' ? 'aborted' : 'error',failure:failure(error)}};
    } finally {
      let cleanupError;
      if (unit && (!keep || !completed || options.signal?.aborted || this.disposed)) {
        this.units.delete(key);
        try { await this.closeUnit(unit); } catch(error) { this.status.phase='error'; this.status.error=failure(error); cleanupError=this.status.error; }
      }
      release?.();
      if(cleanupError)throw new AcpError(cleanupError.code,cleanupError.message);
    }
  }
  async dispose() {
    this.disposed=true; this.lifecycle.abort();
    const units=[...this.ownedUnits]; this.units.clear();
    const [closing,construction]=await Promise.all([
      Promise.allSettled(units.map(unit=>this.closeUnit(unit))),
      Promise.allSettled([...this.building]),
    ]);
    this.status.phase='disposed'; this.status.activeSessions=0;
    if (closing.some(result=>result.status === 'rejected') || construction.some(result=>result.status === 'rejected' && result.reason?.code === 'ACP_CLEANUP_UNCONFIRMED')) throw new AcpError('ACP_CLEANUP_UNCONFIRMED','部分 ACP 进程未确认退出；私有目录已保留。');
  }
}

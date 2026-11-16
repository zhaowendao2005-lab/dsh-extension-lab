import { AsyncLocalStorage } from 'node:async_hooks';
import { withinRequestScope } from '../adapter/scope.js';
import Schema from '@deepseek-ai/schemastery';
import { LlmAdapter,isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { AcpEngine } from '../adapter/engine.js';
import { PROVIDER } from '../catalog.js';

export const name = 'dsh-antigravity-acp';
export const inject = ['llm', 'subprocess'];
export const Config = Schema.object({
  executable: Schema.string().default('agy').description('本机官方 Antigravity CLI 可执行文件。使用 CLI 当前登录，不导入凭据。'),
  loginHome: Schema.string().default('').description('仅供 CLI 子进程复用登录的用户主目录，必须为绝对路径。留空使用当前操作系统用户主目录；不继承调试沙箱的独立 HOME，不修改 DSH 自身环境。'),
  maxSessions: Schema.number().min(1).max(8).default(4).description('最多保留的隔离 ACP 会话数。'),
  promptTimeoutMs: Schema.number().min(1000).max(1800000).default(600000).description('单次 ACP prompt 的总超时，包含等待 DSH 工具的时间（毫秒）。'),
});

const NO_RETRY = Object.freeze({mode:'normal',maxRetries:0,retryableCodes:[],initialDelayMs:1000,maxDelayMs:1000,jitterRatio:0});

export class AntigravityAcpAdapter extends LlmAdapter {
  constructor(engine) { super(); this.engine = engine; }
  providerInfo() { return {id:PROVIDER,name:'Antigravity ACP · 开发预览'}; }
  providerRetryPolicy() { return NO_RETRY; }
  listModels() { return this.engine.listModels(); }
  resolveModel(_provider, model) { return this.engine.resolveModel(model); }
  stream(options) { return this.engine.stream(options); }
}

export function apply(ctx, config) {
  const requestScope=new AsyncLocalStorage();
  const engine = new AcpEngine({
    subprocess:ctx.subprocess,
    isConversation:()=>requestScope.getStore() === true,
    config,
    readImage:async (ref, signal) => {
      const attachments = ctx.get('attachments');
      if (!attachments) throw new Error('Attachment service unavailable');
      return attachments.readImage(ref, signal);
    },
    fileRequestText:ref => ctx.llm.fileRequestText(ref),
  });
  ctx.on('llm/stream',(options,next)=>{
    if(options.provider !== PROVIDER)return next();
    // Inspect original content before Runtime's text-only placeholder projection.
    if(options.messages.some(message=>message.content.some(block=>block.type === 'image')))return {
      async *[Symbol.asyncIterator](){
        yield {type:'finish',reason:{kind:'error',failure:{code:'ACP_IMAGE_UNVERIFIED',message:'当前版本尚未核验所选 CLI 模型的图片能力；未读取或发送图片。'}}};
      },
    };
    return withinRequestScope(requestScope,isAgentLoopRequest(options) && options.purpose === undefined,next);
  });
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], new AntigravityAcpAdapter(engine)), 'antigravity-acp: adapter');
  ctx.effect(() => async () => {
    try { await engine.dispose(); } finally { requestScope.disable(); }
  }, 'antigravity-acp: cleanup');
  // No startup probe, credential reader, account selector, or hidden model generation.
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime,BlockAssembler,markAgentLoopRequest,isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { apply,Config } from '../src/host/index.js';
import { PROVIDER } from '../src/catalog.js';
import { fixture,request,user,system,result,collect,echo } from './helpers/engine.mjs';

// The real Cordis/DSH boundary runs here. Only the external CLI dependencies are
// replaced; no executable discovery, credentials, model calls or profile writes.
function host(t,{behavior,verified=true}={}) {
  const fake=fixture({behavior});
  let adapter;
  class CapturingRuntime extends LlmRuntime {
    registerAdapter(providers,next) { adapter=next;return super.registerAdapter(providers,next); }
  }
  const ctx=new Context();
  const llm=new CapturingRuntime(ctx);
  ctx.provide('subprocess',{});
  apply(ctx,Config({}));
  assert.ok(adapter);
  const engine=adapter.engine;
  for(const key of ['inspect','start','bridge'])engine[key]=fake.engine[key];
  if(verified)engine.verifyProfile=()=>{}; // test-only injection; production has no switch.
  const observed=[];
  const stream=engine.stream.bind(engine);
  engine.stream=options=>{
    observed.push({options,marked:isAgentLoopRequest(options),conversation:engine.isConversation(options)});
    return stream(options);
  };
  t.after(async()=>{
    try {
      await ctx.fiber.dispose();
      assert.equal(engine.disposed,true,'Host disposer must stop its actual engine');
      assert.equal(engine.units.size,0);
      assert.equal(engine.ownedUnits.size,0);
      assert.ok(fake.workers.every(worker=>worker.closed),'Host disposer must close every fake CLI worker');
    } finally { await fake.engine.dispose(); }
  });
  return {...fake,ctx,llm,engine,adapter,observed,actualEngine:engine};
}

function assembled(chunks) {
  const assembler=new BlockAssembler();
  for(const chunk of chunks)assembler.push(chunk);
  return assembler.message({provider:PROVIDER,model:'test-model'});
}

async function preparedStream(llm,messages,more={}) {
  const prepared=await llm.prepareCall({provider:PROVIDER,model:'test-model'});
  const options=markAgentLoopRequest(request(messages,{...prepared.config,...more}));
  return {prepared,options,chunks:await collect(prepared.stream(options))};
}

test('actual Host registration is lazy, exposes no defaults and keeps provider retries at zero',async t=>{
  const h=host(t);
  assert.equal(h.events.length,0);
  assert.deepEqual(h.llm.listProviders(),[{id:PROVIDER,name:'Antigravity ACP · 开发预览'}]);
  const prepared=await h.llm.prepareCall({provider:PROVIDER,model:'test-model'});
  assert.equal(prepared.retryPolicy.maxRetries,0);
  assert.deepEqual(prepared.adapterDefaults,{});
  assert.equal(prepared.config.maxTokens,undefined);
  assert.equal(prepared.context,undefined);
  assert.equal(prepared.toolUpdate,undefined);
  assert.equal(prepared.systemPromptUpdate,'in-history');
  assert.deepEqual(prepared.inputModalities,['text']);
  assert.equal(h.events.filter(([name])=>name==='session/prompt').length,0);
});

test('actual prepared Runtime projects current tools and keeps marked loop continuity across clones',async t=>{
  const h=host(t,{behavior:async worker=>{
    const received=await worker.call('runtime-tool',echo.name,{text:'one'});
    assert.equal(received.content[0].text,'tool output');
    assert.match(JSON.stringify(received),/skill loaded/);
    worker.update('finished');return {stopReason:'end_turn'};
  }});
  const retired={...echo,name:'retired_tool'};
  const update={id:'update-1',role:'developer',source:{kind:'tool-update'},content:[{type:'tool-removal',toolName:retired.name}]};
  const messages=[system('old'),system('current full system'),update,user('use current tool')];
  const more={tools:[{...echo,deferLoading:true}],toolHistory:{tools:[retired,echo],updates:[{messageId:update.id,additions:[]}]}};
  const first=await preparedStream(h.llm,messages,more);
  assert.equal(first.chunks.at(-1).reason.kind,'tool-calls');
  assert.equal(h.observed[0].conversation,true);
  assert.equal(h.observed[0].marked,false);
  assert.equal(isAgentLoopRequest(first.options),true);
  assert.deepEqual(h.observed[0].options.tools,[echo]);
  assert.equal(h.observed[0].options.messages.some(message=>message.role==='developer'),false);
  const worker=h.workers.find(item=>item.promptCount===1);
  assert.deepEqual(worker.tools,[echo]);
  const continuation=[...messages,assembled(first.chunks),result('runtime-tool','tool output'),user('skill loaded',{kind:'tool',callId:'runtime-tool'}),user('new runtime context',{kind:'runtime',name:'clock'})];
  const second=await preparedStream(h.llm,continuation,more);
  assert.equal(second.chunks.at(-1).reason.kind,'stop');
  assert.equal(h.events.filter(([name])=>name==='session/prompt').length,1);
  assert.equal(h.workers.length,2); // one catalog-only worker and one generation worker.
  assert.equal(h.observed[1].conversation,true);
  assert.equal(h.observed[1].marked,false);
  assert.equal(h.actualEngine.units.size,1);
});

test('actual Runtime does not give auxiliary or unmarked requests tool continuation authority',async t=>{
  for(const mode of ['unmarked','marked-auxiliary'])await t.test(mode,async t=>{
    const h=host(t,{behavior:async worker=>{await worker.call();return {stopReason:'end_turn'};}});
    const options=request([user('attempt tool')],{tools:[{...echo,deferLoading:true}],...(mode==='marked-auxiliary'?{purpose:'summary'}:{})});
    if(mode==='marked-auxiliary')markAgentLoopRequest(options);
    const chunks=await collect(h.llm.stream(options));
    assert.equal(chunks.at(-1).reason.failure.code,'ACP_AUXILIARY_TOOL');
    assert.equal(h.observed[0].conversation,false);
    assert.equal(h.actualEngine.units.size,0);
  });
});

test('Host blocks original image before actual text-model projection or attachment reads',async t=>{
  const h=host(t);let reads=0;
  h.ctx.provide('attachments',{readImage(){reads++;throw new Error('must not read');}});
  const message={role:'user',source:{kind:'user'},content:[{type:'image',attachment:{attachmentId:'sha256:abc',mediaType:'image/png',bytes:3,width:1,height:1,name:'image.png'}}]};
  const chunks=await collect(h.llm.stream(markAgentLoopRequest(request([message]))));
  assert.equal(chunks.at(-1).reason.failure.code,'ACP_IMAGE_UNVERIFIED');
  assert.equal(reads,0);assert.equal(h.observed.length,0);assert.equal(h.events.length,0);
});

test('actual Runtime passes file handles with provenance and never reads the file body',async t=>{
  const h=host(t,{behavior:async worker=>{worker.update('done');return {stopReason:'end_turn'};}});
  const paths=[];
  h.ctx.provide('attachments',{fileHostPath(ref){paths.push(ref);return '/stored/report.txt';}});
  h.ctx.provide('fs',{processPathFromHostPath(path){assert.equal(path,'/stored/report.txt');return '/execution/report.txt';}});
  const file={attachmentId:'sha256:abc12345',name:'report.txt',bytes:5};
  const message={role:'user',source:{kind:'user'},content:[{type:'file',attachment:file}]};
  const {chunks}=await preparedStream(h.llm,[message]);
  assert.equal(chunks.at(-1).reason.kind,'stop');
  assert.equal(paths.length,1);
  const projected=h.observed[0].options.messages[0];
  assert.deepEqual(projected.source,{kind:'user'});
  assert.equal(projected.content[0].type,'text');
  assert.match(projected.content[0].text,/verbatim read-only copy saved at/);
  assert.match(projected.content[0].text,/\/execution\/report.txt/);
});

test('actual Host generation gate stays active with the real Runtime error boundary',async t=>{
  const h=host(t,{verified:false});
  const chunks=await collect(h.llm.stream(markAgentLoopRequest(request([user('hello')]))));
  assert.equal(chunks.at(-1).reason.failure.code,'ACP_PURITY_UNVERIFIED');
  assert.equal(h.events.filter(([name])=>name==='session/prompt').length,0);
  assert.equal(h.workers.length,1); // catalog lookup is allowed, prompt is not.
});

test('Host middleware leaves an unrelated provider on its actual Runtime route',async t=>{
  const h=host(t);
  h.llm.registerAdapter(['other'],{
    providerInfo:()=>({id:'other',name:'Other'}),providerRetryPolicy:()=>undefined,
    prepareCall:async()=>({model:{provider:'other',id:'other-model',name:'Other model'},stream:async function*(){yield {type:'finish',reason:{kind:'stop'}};}}),
  });
  const chunks=await collect(h.llm.stream({provider:'other',model:'other-model',messages:[user('hello')]}));
  assert.equal(chunks.at(-1).reason.kind,'stop');
  assert.equal(h.events.length,0);assert.equal(h.observed.length,0);
});

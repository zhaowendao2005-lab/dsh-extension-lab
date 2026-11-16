import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,user,collect,request,echo,deferred } from './helpers/engine.mjs';
import { projectRequest } from '../src/adapter/context.js';
import { parseCatalog,selectModel } from '../src/catalog.js';

const last=chunks=>chunks.at(-1);

test('effective system is the newest nonempty full revision; clearing removes every revision',async()=>{
  const system=text=>({role:'system',content:[{type:'text',text}]});
  assert.equal((await projectRequest({messages:[system('old'),user('input'),system('new')]})).system,'new');
  assert.equal((await projectRequest({messages:[system('head'),system('')]})).system,'head');
  assert.equal((await projectRequest({messages:[system(''),user('input'),system('')]})).system,'');
  assert.equal((await projectRequest({system:'',messages:[system('old')]})).system,'');
});

test('DSH developer tool updates retain historical schema and removals',async()=>{
  const message={id:'update-1',role:'developer',content:[{type:'tool-addition',toolName:echo.name},{type:'tool-removal',toolName:'retired'}]};
  const projected=await projectRequest({messages:[message,user('work')],toolHistory:{tools:[echo],updates:[{messageId:'update-1',additions:[echo]}]}});
  assert.equal(projected.messages[0].role,'developer');assert.deepEqual(projected.messages[0].content[0].schema,echo);
});

test('model selection uses the same authoritative catalog source as its choices',async()=>{
  const catalog=parseCatalog({sessionId:'s',models:{currentModelId:'A'},configOptions:[{id:'model',type:'select',currentValue:'B',options:[{value:'A'},{value:'B'}]}]});
  const calls=[];await selectModel({request:async(method,params)=>{calls.push(params);return {configOptions:[{id:'model',currentValue:params.value}]};}},'s',catalog,'A');
  assert.equal(calls.length,1);
});

for(const boundary of ['bridge','runtime']) test(`dispose waits for a late ${boundary} and closes it`,async()=>{
  const {engine,events,workers}=fixture();const ready=deferred();const gate=deferred();const original=engine[boundary==='runtime'?'start':'bridge'];
  engine[boundary==='runtime'?'start':'bridge']=async options=>{const resource=await original(options);ready.resolve();await gate.promise;return resource;};
  const work=collect(engine.stream(request([user('go')])));await ready.promise;
  let disposed=false;const closing=engine.dispose().then(()=>{disposed=true;});await Promise.resolve();await Promise.resolve();assert.equal(disposed,false);
  gate.resolve();await closing;assert.equal(last(await work).reason.kind,'aborted');
  assert.equal(engine.ownedUnits.size,0);assert.ok(events.some(event=>event[0]==='bridge-close'));
  if(boundary==='runtime') assert.equal(workers[0].closed,true);
});

test('late cleanup failure is surfaced by disposal',async()=>{
  const {engine}=fixture();const ready=deferred();const gate=deferred();
  engine.bridge=async()=>{ready.resolve();await gate.promise;return {close:async()=>{throw new Error('private failure');}};};
  const work=collect(engine.stream(request([user('go')])));await ready.promise;
  const closing=engine.dispose();const checked=assert.rejects(closing,{code:'ACP_CLEANUP_UNCONFIRMED'});gate.resolve();await checked;
  assert.equal(JSON.stringify(await work).includes('private failure'),false);
});

test('asynchronous failed cancellation is handled; blocked cancellation cannot prevent cleanup',async t=>{
  for(const type of ['reject','blocked']) await t.test(type,async()=>{
    const ready=deferred();const {engine,workers}=fixture({behavior:async()=>{ready.resolve();return deferred().promise;}});
    const work=collect(engine.stream(request([user('go')])));await ready.promise;
    const unit=[...engine.ownedUnits][0];unit.runtime.connection.notify=()=>type==='reject'?Promise.reject(new Error('closed pipe')):deferred().promise;
    await engine.dispose();await work;assert.equal(workers[0].closed,true);
  });
});

test('background calls with a session id cannot park DSH tools',async()=>{
  const original=request([user('title')],{tools:[echo],purpose:'title'});let seen;
  const {engine,workers}=fixture({isConversation:options=>{seen=options;return false;},behavior:async worker=>{await worker.call();return {stopReason:'end_turn'};}});
  const chunks=await collect(engine.stream(original));assert.equal(seen,original);
  assert.equal(last(chunks).reason.failure.code,'ACP_AUXILIARY_TOOL');assert.equal(workers[0].closed,true);await engine.dispose();
});

test('images are rejected before any attachment read or runtime startup',async()=>{
  const {engine,workers}=fixture();let reads=0;engine.readImage=async()=>{reads++;return {data:Buffer.alloc(1)};};
  const chunks=await collect(engine.stream(request([{role:'user',content:[{type:'image',attachment:{}}]}])));
  assert.equal(last(chunks).reason.failure.code,'ACP_IMAGE_UNVERIFIED');assert.equal(reads,0);assert.equal(workers.length,0);await engine.dispose();
});

test('malformed CLI text never becomes a DSH delta',async()=>{
  const {engine}=fixture({behavior:async worker=>{worker.update(123);return {stopReason:'end_turn'};}});
  const chunks=await collect(engine.stream(request([user('go')])));
  assert.equal(last(chunks).reason.failure.code,'ACP_OUTPUT_UNSUPPORTED');assert.equal(chunks.some(chunk=>chunk.type==='text-delta'),false);await engine.dispose();
});

test('cleanup failures reject the stream visibly and release admission',async()=>{
  const {engine}=fixture({isConversation:()=>false});const start=engine.start;
  engine.start=async options=>{const runtime=await start(options);runtime.close=async()=>{throw new Error('private cleanup detail');};return runtime;};
  await assert.rejects(collect(engine.stream(request([user('utility')]))),error=>error.code==='ACP_CLEANUP_UNCONFIRMED'&&!error.message.includes('private cleanup detail'));
  const release=await engine.gate.acquire();release();await engine.dispose();
});

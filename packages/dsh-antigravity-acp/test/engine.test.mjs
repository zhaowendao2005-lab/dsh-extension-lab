import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,user,system,result,assistant,collect,request,echo,deferred } from './helpers/engine.mjs';
import { assertVerifiedProfile } from '../src/purity.js';

const last=chunks=>chunks.at(-1);

test('production purity gate prevents runtime and all session/prompt calls',async () => {
  const {engine,events,workers}=fixture({verifyProfile:assertVerifiedProfile});
  const chunks=await collect(engine.stream(request([user('hello')])));
  assert.equal(last(chunks).reason.failure.code,'ACP_PURITY_UNVERIFIED');
  assert.equal(workers.length,0); assert.equal(events.length,0); await engine.dispose();
});

test('catalog is lazy, shared, authoritative and creates zero prompts',async () => {
  const {engine,workers,events}=fixture(); assert.equal(workers.length,0);
  const [one,two]=await Promise.all([engine.listModels(),engine.listModels()]);
  assert.equal(workers.length,1); assert.deepEqual(one,two); assert.ok(workers[0].closed);
  one[0].name='changed'; assert.equal((await engine.listModels())[0].name,'Test model');
  const model=await engine.resolveModel('test-model'); assert.equal(model.defaultMaxTokens,undefined); assert.equal(model.context,undefined);
  assert.equal(events.filter(event=>event[0]==='session/prompt').length,0); await engine.dispose();
});

test('text and reasoning chunks have valid block framing without invented usage',async () => {
  const {engine}=fixture({behavior:async worker=>{worker.update('think','agent_thought_chunk');worker.update('Hel');worker.update('lo');return {stopReason:'end_turn'};}});
  const chunks=await collect(engine.stream(request([system('DSH'),user('hello')])));
  assert.deepEqual(chunks.filter(chunk=>chunk.type==='block-end').map(chunk=>chunk.block),[{type:'reasoning',text:'think'},{type:'text',text:'Hello'}]);
  assert.equal(last(chunks).reason.kind,'stop'); assert.equal(chunks.some(chunk=>chunk.type==='usage'),false); await engine.dispose();
});

test('parked MCP call resumes in same ACP prompt and duplicate user input remains distinct',async () => {
  const {engine,workers,events}=fixture({behavior:async worker=>{
    worker.update('Before'); const response=await worker.call();
    worker.update(`After:${response.content[0].text}`);return {stopReason:'end_turn'};
  }});
  const input=[system('DSH system'),user('same')];
  const first=await collect(engine.stream(request(input,{tools:[echo]})));
  assert.equal(last(first).reason.kind,'tool-calls');assert.equal(workers[0].closed,false);
  const secondInput=[...input,assistant(first),result('tool-1','DSH receipt')];
  const second=await collect(engine.stream(request(secondInput,{tools:[echo]})));
  assert.equal(last(second).reason.kind,'stop');assert.equal(workers[0].promptCount,1);
  assert.equal(second.find(chunk=>chunk.type==='block-end').block.text,'After:DSH receipt');
  assert.equal(events.filter(event=>event[0]==='resolve').length,1);
  const third=await collect(engine.stream(request([...secondInput,assistant(second),user('same')],{tools:[echo]})));
  assert.equal(last(third).reason.kind,'tool-calls'); assert.equal(workers[0].promptCount,2);await engine.dispose();
});

test('pending system/model/tool/prefix changes cancel and never replay an effect',async t => {
  for (const kind of ['system','model','tools','prefix']) await t.test(kind,async () => {
    const {engine,events,workers}=fixture({behavior:async worker=>{await worker.call();return {stopReason:'end_turn'};}});
    const input=[system('DSH'),user('do work')];
    const first=await collect(engine.stream(request(input,{tools:[echo]})));
    let messages=[...input,assistant(first),result('tool-1','done')]; const more={tools:[echo]};
    if (kind==='system') messages=[system('changed'),...messages.slice(1)];
    if (kind==='model') more.model='other-model';
    if (kind==='tools') more.tools=[];
    if (kind==='prefix') messages=[messages[0],user('edited'),...messages.slice(2)];
    const second=await collect(engine.stream(request(messages,more)));
    assert.equal(last(second).reason.failure.code,'ACP_CONTINUATION_CHANGED');assert.equal(workers[0].closed,true);
    assert.equal(events.filter(event=>event[0]==='resolve').length,0);assert.equal(workers.length,1);await engine.dispose();
  });
});

test('missing or duplicate results reject before delivering any tool result',async () => {
  const {engine,events}=fixture({behavior:async worker=>{await worker.call();return {stopReason:'end_turn'};}});
  const input=[user('work')]; const first=await collect(engine.stream(request(input,{tools:[echo]})));
  const chunks=await collect(engine.stream(request([...input,assistant(first),result('tool-1','x'),result('tool-1','x')],{tools:[echo]})));
  assert.equal(last(chunks).reason.failure.code,'ACP_TOOL_RESULTS_MISMATCH');assert.equal(events.filter(event=>event[0]==='resolve').length,0);await engine.dispose();
});

test('idle history compaction rebuilds generation without executing past calls',async () => {
  const {engine,workers,events}=fixture({behavior:async worker=>{worker.update('answer');return {stopReason:'end_turn'};}});
  await collect(engine.stream(request([user('old')])));
  await collect(engine.stream(request([user('compacted summary'),user('new')])));
  assert.equal(workers.length,2);assert.equal(workers[0].closed,true);
  assert.equal(events.filter(event=>event[0]==='session/prompt').length,2);assert.equal(events.some(event=>event[0]==='resolve'),false);await engine.dispose();
});

test('cancel, disconnect, denied permission and consumer return terminate owned worker',async t => {
  for(const kind of ['cancel','disconnect','permission','return']) await t.test(kind,async()=>{
    const running=deferred();const controller=new AbortController();
    const {engine,workers}=fixture({behavior:async worker=>{running.resolve(worker);worker.update('partial');return deferred().promise;}});
    const stream=engine.stream(request([user('go')],{signal:controller.signal}));
    await stream.next();const worker=await running.promise;
    if(kind==='return') await stream.return();
    else {
      if(kind==='cancel') controller.abort();
      if(kind==='disconnect') worker.disconnect();
      if(kind==='permission') assert.deepEqual(worker.permission(),{outcome:{outcome:'cancelled'}});
      const chunks=await collect(stream);assert.ok(['error','aborted'].includes(last(chunks).reason.kind));
      assert.equal(JSON.stringify(chunks).includes('PRIVATE RPC CONTENT'),false);
    }
    assert.equal(worker.closed,true);await engine.dispose();
  });
});

test('dispose closes parked and streaming workers and aborts queued admissions',async () => {
  const started=deferred();const {engine,workers}=fixture({behavior:async worker=>{started.resolve();return deferred().promise;}});
  const first=collect(engine.stream(request([user('go')])));await started.promise;
  const second=collect(engine.stream(request([user('next')],{sessionId:'second'})));
  await engine.dispose();
  assert.ok(['error','aborted'].includes(last(await first).reason.kind));assert.equal(last(await second).reason.kind,'aborted');
  assert.ok(workers.every(worker=>worker.closed));assert.equal(engine.ownedUnits.size,0);
});

test('unsupported request controls and stateless tools fail without retries',async () => {
  for(const controls of [{maxTokens:123},{temperature:0},{stop:['x']},{reasoningEffort:'high'}]) {
    const {engine,workers}=fixture();const chunks=await collect(engine.stream(request([user('go')],controls)));
    assert.equal(last(chunks).reason.failure.code,'ACP_CONTROL_UNSUPPORTED');assert.equal(workers.length,0);await engine.dispose();
  }
  const {engine,workers}=fixture({behavior:async worker=>{await worker.call();return {stopReason:'end_turn'};}});
  const chunks=await collect(engine.stream(request([user('go')],{sessionId:undefined,tools:[echo]})));
  assert.equal(last(chunks).reason.failure.code,'ACP_AUXILIARY_TOOL');assert.equal(workers[0].promptCount,1);assert.equal(workers[0].closed,true);await engine.dispose();
});

test('capacity evicts only idle workers, never a parked tool prompt',async () => {
  const {engine,workers}=fixture({maxSessions:1,behavior:async worker=>{await worker.call();return {stopReason:'end_turn'};}});
  await collect(engine.stream(request([user('go')],{tools:[echo]})));
  const chunks=await collect(engine.stream(request([user('go')],{sessionId:'other',tools:[echo]})));
  assert.equal(last(chunks).reason.failure.code,'ACP_CAPACITY');assert.equal(workers.length,1);assert.equal(workers[0].closed,false);await engine.dispose();
});

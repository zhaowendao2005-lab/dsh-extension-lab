import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withinRequestScope } from '../src/adapter/scope.js';
import { fixture,user,result,assistant,collect,request,echo } from './helpers/engine.mjs';

test('original request classification survives Runtime-like clones and concurrent async iteration',async()=>{
  const scope=new AsyncLocalStorage();const seen=[];
  const downstream=(name)=>async function*(){
    await Promise.resolve();seen.push([name,scope.getStore()]);yield name;
    await Promise.resolve();seen.push([name,scope.getStore()]);
  };
  const main=withinRequestScope(scope,true,()=>downstream('main')());
  const auxiliary=withinRequestScope(scope,false,()=>downstream('auxiliary')());
  await Promise.all([collect(main),collect(auxiliary)]);
  assert.deepEqual(seen.filter(row=>row[0]==='main').map(row=>row[1]),[true,true]);
  assert.deepEqual(seen.filter(row=>row[0]==='auxiliary').map(row=>row[1]),[false,false]);
  assert.equal(scope.getStore(),undefined);scope.disable();
});

test('consumer return and throw execute downstream cleanup inside the original scope',async()=>{
  const scope=new AsyncLocalStorage();const seen=[];
  const next=()=> (async function*(){try{yield 1;}finally{seen.push(scope.getStore());}})();
  const returned=withinRequestScope(scope,true,next)[Symbol.asyncIterator]();await returned.next();await returned.return();
  const thrown=withinRequestScope(scope,false,next)[Symbol.asyncIterator]();await thrown.next();await assert.rejects(thrown.throw(new Error('consumer')));
  assert.deepEqual(seen,[true,false]);scope.disable();
});

test('runtime and skill additions preserve provenance once while the original MCP prompt remains parked',async()=>{
  let received;const {engine,workers,events}=fixture({behavior:async worker=>{
    received=await worker.call();worker.update('continued');return {stopReason:'end_turn'};
  }});
  const original=[user('load skill')];const first=await collect(engine.stream(request(original,{tools:[echo]})));
  const skill='<skill_content>one copy of skill text</skill_content>';
  const messages=[...original,assistant(first),result('tool-1','loaded'),user(skill,{kind:'tool-skill',form:'instructions'}),user('new time snapshot',{kind:'runtime-context',form:'snapshot',sections:[{name:'time',text:'new time snapshot'}]})];
  const second=await collect(engine.stream(request(messages,{tools:[echo]})));
  assert.equal(second.at(-1).reason.kind,'stop');assert.equal(workers[0].promptCount,1);
  assert.equal(events.filter(event=>event[0]==='session/prompt').length,1);
  assert.equal(received.content[0].text,'loaded');assert.equal(received.isError,false);
  const serialized=JSON.stringify(received);
  assert.equal(serialized.split('<skill_content>').length-1,1);
  assert.match(serialized,/tool-skill/);assert.match(serialized,/runtime-context/);assert.match(serialized,/deliveredSeparately/);
  await engine.dispose();
});

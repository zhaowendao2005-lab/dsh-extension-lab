import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRequest,toolResultContent,stable } from '../src/adapter/context.js';
import { user,system,echo } from './helpers/engine.mjs';
import { parseCatalog,selectModel } from '../src/catalog.js';
import { SerialGate,EventQueue } from '../src/adapter/queue.js';

test('DSH system prompt, injected contexts, skill directory and explicit skill content retain provenance once',async () => {
  const context=user('<available_skills>skill catalog</available_skills>',{kind:'runtime',name:'skills'});
  const skill=user('<skill_content name="named">loaded once</skill_content>',{kind:'slash-command',name:'skill'});
  const projection=await projectRequest({system:'DSH system',messages:[system('DSH system'),context,skill,user('same'),user('same')]});
  assert.equal(projection.system,'DSH system');
  const prompt=await projection.promptFor(projection.messages,{replay:true});
  const serialized=JSON.stringify(prompt);
  assert.equal(serialized.split('<available_skills>').length-1,1);assert.equal(serialized.split('<skill_content').length-1,1);
  assert.deepEqual(projection.messages[0].source,context.source);assert.deepEqual(projection.messages[1].source,skill.source);
  assert.equal(projection.messages.filter(message=>message.content[0].text==='same').length,2);
});

test('image bytes and file handle use DSH attachment channels without reading local paths',async () => {
  const calls=[];const image={attachmentId:'img-1',mediaType:'image/png',bytes:3,width:1,height:1,name:'image.png'};
  const file={attachmentId:'file-1',name:'report.txt',bytes:5};
  const projection=await projectRequest({messages:[{role:'user',content:[{type:'text',text:'Before'},{type:'image',attachment:image},{type:'text',text:'After'},{type:'file',attachment:file}]}]}, {
    readImage:async ref=>{calls.push(ref);return {data:Buffer.from([1,2,3])};},fileRequestText:ref=>`DSH-FILE:${ref.attachmentId}`,
  });
  const prompt=await projection.promptFor(projection.messages);
  assert.equal(calls[0],image);assert.deepEqual(prompt[1],{type:'image',mimeType:'image/png',data:'AQID'});
  assert.match(prompt[0].text,/Before/);assert.match(prompt[2].text,/After/);assert.match(prompt[2].text,/DSH-FILE:file-1/);
  const result=await toolResultContent({role:'tool',isError:true,content:[{type:'text',text:'failed'},{type:'image',attachment:image}]},{readImage:async()=>({data:Buffer.from([1])})});
  assert.equal(result.isError,true);assert.equal(result.content[1].data,'AQ==');
});

test('historical tool schema additions are attached to their original record, never promoted to live tools',async () => {
  const addition={id:'historical',role:'user',content:[{type:'tool-addition',toolName:echo.name}]};
  const projection=await projectRequest({messages:[addition,user('current')],toolHistory:{tools:[],updates:[{messageId:'historical',additions:[echo]}]}});
  assert.deepEqual(projection.messages[0].content[0].schema,echo);
  assert.match((await projection.promptFor(projection.messages,{replay:true}))[0].text,/never execute them again/);
  await assert.rejects(projectRequest({messages:[addition]}),{code:'ACP_TOOL_HISTORY_UNAVAILABLE'});
});

test('unsupported roles, content and offloaded images fail explicitly',async () => {
  await assert.rejects(projectRequest({messages:[{role:'developer',content:[{type:'text',text:'unmapped instruction'}]}]}),{code:'ACP_ROLE_UNSUPPORTED'});
  const projected=await projectRequest({messages:[{role:'user',content:[{type:'image',attachment:{},offloaded:true}]}]});
  await assert.rejects(projected.promptFor(projected.messages),{code:'ACP_IMAGE_UNAVAILABLE'});
  const unknown=await projectRequest({messages:[{role:'user',content:[{type:'audio'}]}]});
  await assert.rejects(unknown.promptFor(unknown.messages),{code:'ACP_CONTENT_UNSUPPORTED'});
});

test('catalog reads exact grouped model ids, requires confirmed selection and never invents budgets',async () => {
  const catalog=parseCatalog({sessionId:'one',configOptions:[{id:'model',type:'select',currentValue:'a',options:[{group:'Gemini',options:[{value:'a',name:'A'},{value:'b',name:'B'}]}]}]});
  assert.deepEqual(catalog.models.map(model=>model.id),['a','b']);const calls=[];
  const connection={async request(method,params){calls.push([method,params]);return {configOptions:[{id:'model',currentValue:'b'}]};}};
  await selectModel(connection,'one',catalog,'b');assert.equal(catalog.currentModel,'b');assert.equal(calls[0][1].value,'b');
  await assert.rejects(selectModel(connection,'one',catalog,'missing'),{code:'ACP_MODEL_UNAVAILABLE'});
  await assert.rejects(selectModel(connection,'one',catalog,'a','high'),{code:'ACP_CONTROL_UNSUPPORTED'});
  await assert.rejects(selectModel({request:async()=>({})},'one',catalog,'a'),{code:'ACP_MODEL_UNCONFIRMED'});
  assert.throws(()=>parseCatalog({sessionId:'s',configOptions:[]}),{code:'ACP_CATALOG_EMPTY'});
});

test('admission is bounded and queued cancellation is immediate',async () => {
  const gate=new SerialGate(1);const release=await gate.acquire();const controller=new AbortController();
  const queued=gate.acquire(controller.signal);await assert.rejects(gate.acquire(),{code:'ACP_CAPACITY'});controller.abort();
  await assert.rejects(queued,{code:'ACP_ABORTED'});release();const done=await gate.acquire();done();done();
});

test('event backpressure and fatal close discard buffered authority',async () => {
  const queue=new EventQueue(60);assert.equal(queue.push({type:'text',text:'hello'}),true);
  assert.equal(queue.push({type:'text',text:'a'.repeat(100)}),false);
  await assert.rejects(queue.next(),{code:'ACP_BACKPRESSURE'});
  assert.equal(stable({b:1,a:2}),stable({a:2,b:1}));
});

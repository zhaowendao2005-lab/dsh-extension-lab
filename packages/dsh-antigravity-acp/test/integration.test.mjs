import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AcpEngine } from '../src/adapter/engine.js';
import { createToolBridge } from '../src/bridge/server.js';
import { user,request,echo,result,assistant,collect,deferred } from './helpers/engine.mjs';

test('engine and real MCP SDK resume parallel parked tools in one ACP prompt',async t=>{
  const workers=[];const bridges=[];let prompts=0,responses;
  const engine=new AcpEngine({
    subprocess:{},inspect:async()=>({path:'/fake/agy',version:'1.5.9',sha256:'offline'}),verifyProfile:()=>{},isConversation:()=>true,
    bridge:async options=>{const bridge=await createToolBridge(options);bridges.push(bridge);return bridge;},
    start:async({bridge,onUpdate})=>{
      const client=new Client({name:'offline-cli',version:'1.0.0'});const closed=deferred();
      await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url),{requestInit:{headers:{Authorization:`Bearer ${bridge.token}`}}}));
      const worker={closed:false};workers.push(worker);
      return {
        isolation:{cwd:'/empty-offline-workspace'},initializeResult:{agentCapabilities:{promptCapabilities:{}}},
        connection:{closed:closed.promise,notify:async()=>{},async request(method){
          if(method==='session/new')return {sessionId:'offline-acp-session',configOptions:[{id:'model',type:'select',currentValue:'test-model',options:[{value:'test-model',name:'Test model'}]}]};
          if(method==='session/prompt'){
            prompts++;const listed=await client.listTools();assert.equal(listed.tools.length,1);
            const results=await Promise.all(['first','second'].map(text=>client.callTool({name:listed.tools[0].name,arguments:{text}})));
            responses=results;
            assert.equal(results[0].isError,false);assert.equal(results[1].isError,true);
            onUpdate({sessionId:'offline-acp-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:results.map(value=>value.content[0].text).join('|')}}});
            return {stopReason:'end_turn'};
          }
          return {};
        }},
        async close(){worker.closed=true;await client.close();closed.resolve({});},
      };
    },
  });
  t.after(()=>engine.dispose());
  let messages=[user('<available_skills>DSH catalog</available_skills>',{kind:'runtime-context'}),user('Use both tools')];
  for(let step=0;step<2;step++){
    const chunks=await collect(engine.stream(request(messages,{tools:[echo]})));
    assert.equal(chunks.at(-1).reason.kind,'tool-calls');
    const call=chunks.find(chunk=>chunk.type==='block-end'&&chunk.block.type==='tool-call').block;
    assert.equal(call.name,echo.name);assert.equal(JSON.parse(call.arguments).text,['first','second'][step]);
    assert.match(call.id,/^dsh_/);messages=[...messages,assistant(chunks),result(call.id,step===0?'receipt-1':'failed-2',step===1)];
    if(step===0)messages.push(user('<skill_content>SDK skill once</skill_content>',{kind:'tool-skill',form:'instructions'}),user('updated snapshot',{kind:'runtime-context'}),user('new steering',{kind:'user'}));
  }
  const final=await collect(engine.stream(request(messages,{tools:[echo]})));
  assert.equal(final.at(-1).reason.kind,'stop');assert.equal(final.find(chunk=>chunk.type==='block-end').block.text,'receipt-1|failed-2');
  assert.equal(prompts,1);assert.equal(workers.length,1);assert.equal(bridges[0].pendingCount,0);
  const continuation=JSON.stringify(responses[0]);assert.equal(continuation.split('<skill_content>').length-1,1);
  assert.match(continuation,/runtime-context/);assert.match(continuation,/new steering/);assert.match(continuation,/dsh-continuation/);
  assert.equal(JSON.stringify(responses[1]).includes('<skill_content>'),false);
  await engine.dispose();assert.equal(workers[0].closed,true);
});

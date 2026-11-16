import { AcpEngine } from '../../src/adapter/engine.js';
import { PROVIDER } from '../../src/catalog.js';

export function deferred() { let resolve,reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; }
export const user = (text,source) => ({role:'user',...(source ? {source} : {}),content:[{type:'text',text}]});
export const system = text => ({role:'system',source:{kind:'system-prompt'},content:[{type:'text',text}]});
export const result = (id,text,isError=false) => ({role:'tool',source:{kind:'tool',callId:id},toolCallId:id,isError,content:[{type:'text',text}]});
export function assistant(chunks,model='test-model') { return {role:'assistant',source:{kind:'model',provider:PROVIDER,model},content:chunks.filter(chunk=>chunk.type==='block-end').map(chunk=>chunk.block)}; }
export async function collect(stream) { const chunks=[]; for await (const chunk of stream) chunks.push(chunk); return chunks; }
export function request(messages,more={}) { return {provider:PROVIDER,model:'test-model',sessionId:'dsh-session',messages,...more}; }
export const echo = {name:'dsh_echo',description:'Echo from DSH',parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}};

export function fixture({behavior,attestation={sanitizedAgentRequests:1,strippedDeclarations:0,systemRewritten:1,generationRequests:1},maxSessions=4,startGate,isConversation=()=>true}={}) {
  const events=[]; const workers=[]; const gateways=[];
  const engine = new AcpEngine({
    subprocess:{}, config:{maxSessions},
    inspect:async () => ({path:'/official/agy',version:'1.5.9',sha256:'fake-test-binary'}),
    isConversation,
    bridge:async ({tools,onCall}) => {
      const worker={onCall,tools,closed:false,promptCount:0,pending:new Map()}; workers.push(worker);
      const bridge={url:'http://127.0.0.1:1/mcp',token:'test',toolNames:tools.map(tool=>tool.name),
        resolve(id,value) { events.push(['resolve',id,value]); if (!worker.pending.has(id)) return false; worker.pending.get(id).resolve(value); worker.pending.delete(id); return true; },
        async close() {events.push(['bridge-close']); for(const item of worker.pending.values()) item.reject(new Error('closed')); worker.pending.clear();},
      };
      worker.bridge=bridge; return bridge;
    },
    createGateway:async ({systemInstruction}) => {
      const gateway={endpoint:'http://127.0.0.1:1/gateway-token',systemInstruction,closed:false,attested:()=>structuredClone(attestation),
        async close(){gateway.closed=true;events.push(['gateway-close']);}};
      gateways.push(gateway); return gateway;
    },
    start:async ({onUpdate,onPermission,signal,gateway}) => {
      const worker=workers.at(-1); worker.gateway=gateway; worker.update=(text,type='agent_message_chunk')=>onUpdate({sessionId:worker.sessionId,update:{sessionUpdate:type,content:{type:'text',text}}});
      worker.permission=onPermission; worker.signal=signal;
      worker.call=(id='tool-1',name='dsh_echo',args={text:'test'}) => {const held=deferred();worker.pending.set(id,held);worker.onCall({id,name,arguments:JSON.stringify(args)});return held.promise;};
      const closed=deferred(); worker.disconnect=()=>closed.resolve({error:new Error('PRIVATE RPC CONTENT')});
      const connection={closed:closed.promise,notify(method,params) {events.push([method,params]);},async request(method,params) {
        events.push([method,params]);
        if (method==='session/new') {worker.sessionId=`acp-${workers.indexOf(worker)}`;return {sessionId:worker.sessionId,configOptions:[{id:'model',type:'select',currentValue:'test-model',options:[{value:'test-model',name:'Test model'},{value:'other-model',name:'Other model'}]}]};}
        if (method==='session/set_config_option') return {configOptions:[{id:'model',currentValue:params.value}]};
        if (method==='session/prompt') {worker.promptCount++;return behavior ? behavior(worker,params,events) : {stopReason:'end_turn'};}
        return {};
      }};
      if (startGate) await startGate.promise;
      return {connection,isolation:{cwd:'/empty-test-workspace'},initializeResult:{agentCapabilities:{promptCapabilities:{image:true}}},async close(){worker.closed=true;events.push(['runtime-close']);closed.resolve({});}};
    },
  });
  return {engine,events,workers,gateways};
}

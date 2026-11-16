import { AcpError } from './adapter/errors.js';
export const PROVIDER = 'antigravity-acp';
function choices(options) {
  return (options ?? []).flatMap(option => Array.isArray(option.options) ? choices(option.options) : option && typeof option.value === 'string' ? [{id:option.value,name:option.name ?? option.value}] : []);
}
export function parseCatalog(session) {
  if (typeof session?.sessionId !== 'string' || !session.sessionId) throw new AcpError('ACP_SESSION_INVALID','ACP 没有返回有效会话标识。');
  const configs = Array.isArray(session.configOptions) ? session.configOptions : [];
  const modelConfig = configs.find(option => option.id === 'model' && option.type === 'select');
  const advertised = modelConfig ? choices(modelConfig.options) : (session.models?.availableModels ?? []).map(model => ({id:model.modelId,name:model.name ?? model.modelId,description:model.description}));
  const models = [...new Map(advertised.filter(model => typeof model.id === 'string' && model.id).map(model => [model.id,{provider:PROVIDER,...model}])).values()];
  if (!models.length) throw new AcpError('ACP_CATALOG_EMPTY','当前 CLI 会话没有公布可用模型。');
  const currentModel = modelConfig ? modelConfig.currentValue : session.models?.currentModelId;
  if (currentModel !== undefined && !models.some(model => model.id === currentModel)) throw new AcpError('ACP_MODEL_UNCONFIRMED','CLI 当前模型不在同一来源公布的目录中。');
  return {models,modelConfigId:modelConfig?.id,configs,currentModel};
}
export async function selectModel(connection,sessionId,catalog,model,reasoningEffort) {
  if (!catalog.models.some(item => item.id === model)) throw new AcpError('ACP_MODEL_UNAVAILABLE','模型不在当前 CLI 公布的目录中。');
  if (reasoningEffort !== undefined) throw new AcpError('ACP_CONTROL_UNSUPPORTED','当前版本未核验每个模型的独立思考档位；请选择 CLI 公布的精确模型变体。');
  if (catalog.currentModel === model) return;
  if (catalog.modelConfigId) {
    const result = await connection.request('session/set_config_option',{sessionId,configId:catalog.modelConfigId,value:model});
    const selected = result?.configOptions?.find(option => option.id === catalog.modelConfigId)?.currentValue;
    if (selected !== model) throw new AcpError('ACP_MODEL_UNCONFIRMED','CLI 未确认精确模型选择；已停止请求。');
  } else {
    // A void set_model response cannot confirm the selected identity.
    throw new AcpError('ACP_MODEL_UNCONFIRMED','CLI 只提供旧版模型切换，当前实现不能确认精确路由。');
  }
  catalog.currentModel = model;
}

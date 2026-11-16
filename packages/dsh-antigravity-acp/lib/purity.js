import { AcpError } from './adapter/errors.js';

// Deliberately empty: behavioral probes and model self-reports are not authoritative
// evidence of the complete upstream tools/system declaration. No config bypass.
export const VERIFIED_PROFILES = Object.freeze([]);
export const PURITY_STATUS = Object.freeze({verified:false,code:'ACP_PURITY_UNVERIFIED',nativeResiduals:['manage_task','list_resources','read_resource']});
export function assertVerifiedProfile(cli) {
  if (!VERIFIED_PROFILES.some(profile => profile.sha256 === cli.sha256 && profile.version === cli.version)) {
    throw new AcpError('ACP_PURITY_UNVERIFIED','原生工具可见性尚未通过权威核验；ACP 生成已阻断。可执行离线测试和不生成内容的协议检查。');
  }
}

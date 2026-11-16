import { PURITY_STATUS,VERIFIED_PROFILES } from '../src/purity.js';
import { SUPPORTED_CLI_VERSION } from '../src/runtime/cli.js';

if(process.argv.length>2){
  console.error('Usage: pnpm probe\nThis command reports offline implementation status only; it does not launch agy.');
  process.exitCode=2;
}else{
  console.log(JSON.stringify({
    package:'dsh-antigravity-acp',version:'0.1.0-dev.0',mode:'offline-status',
    cliVersionProfile:SUPPORTED_CLI_VERSION,verifiedProfiles:VERIFIED_PROFILES.length,
    purity:PURITY_STATUS,generatedRequests:0,
    note:'Version profile and SHA-256 checks detect binary changes; they do not certify model-visible tool purity.',
  },null,2));
}

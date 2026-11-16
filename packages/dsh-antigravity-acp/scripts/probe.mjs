import { PURITY_STATUS } from '../src/purity.js';
import { SUPPORTED_CLI_VERSION } from '../src/runtime/cli.js';

if(process.argv.length>2){
  console.error('Usage: pnpm probe\nThis command reports offline implementation status only; it does not launch agy.');
  process.exitCode=2;
}else{
  console.log(JSON.stringify({
    package:'dsh-antigravity-acp',version:'0.1.0-dev.0',mode:'offline-status',
    cliVersionProfile:SUPPORTED_CLI_VERSION,
    purity:PURITY_STATUS,generatedRequests:0,
    note:'Generation is routed through a loopback sanitizing gateway that removes every non-DSH tool declaration and replaces the vendor system prompt; a turn without gateway attestation fails closed.',
  },null,2));
}

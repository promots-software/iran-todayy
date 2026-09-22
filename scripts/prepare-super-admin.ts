import {mkdir,writeFile} from 'node:fs/promises';
import {hashPassword} from '../src/lib/dashboard-auth';
async function main(){
 if(process.stdin.isTTY)throw new Error('USE_HIDDEN_POWERSHELL_PROMPT');
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)throw new Error('INPUT_TOO_LONG');}
 const value=JSON.parse(input.replace(/^\uFEFF/,''));
 if(typeof value.password!=='string'||value.password!==value.confirmation)throw new Error('PASSWORDS_MUST_MATCH');
 const passwordHash=await hashPassword(value.password);
 const directory=new URL('../.test-tools/super-admin-setup/',import.meta.url);
 await mkdir(directory,{recursive:true,mode:0o700});
 // Exclusive creation avoids silently replacing an already prepared credential.
 await writeFile(new URL('credential.json',directory),JSON.stringify({username:'adel',role:'SUPER_ADMIN',passwordHash}),{flag:'wx',mode:0o600});
}
main().catch(error=>{const known=['USE_HIDDEN_POWERSHELL_PROMPT','PASSWORDS_MUST_MATCH','PASSWORD_LENGTH','INPUT_TOO_LONG'];console.error(known.includes(error?.message)?error.message:error?.code==='EEXIST'?'A credential is already prepared; nothing overwritten.':'Could not prepare credential. No secret details logged.');process.exitCode=1;});

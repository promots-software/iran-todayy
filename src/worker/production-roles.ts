import {spawn,type ChildProcess} from 'node:child_process';
/** Same Railway container, isolated roles: collection/processing can never send. */
export function processingEnvironment(env:NodeJS.ProcessEnv){return {...env,SHADOW_MODE:'true',AUTO_PUBLISH:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'false'};}
export function publishingEnvironment(env:NodeJS.ProcessEnv){const result={...env};for(const key of ['TELEGRAM_SESSION','TELEGRAM_API_ID','TELEGRAM_API_HASH','GEMINI_API_KEY','OPENAI_API_KEY','GROQ_API_KEY'])delete result[key];return result;}
export function startProductionRoles(){
 const children:ChildProcess[]=[];let stopping=false;
 const stop=(code=0)=>{if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)child.kill('SIGTERM');const timer=setTimeout(()=>process.exit(code),50000);timer.unref();};
 const start=(file:string,env:NodeJS.ProcessEnv)=>{const child=spawn(process.execPath,['--import','tsx',file],{env,stdio:'inherit',windowsHide:true});children.push(child);child.once('error',()=>stop(1));child.once('exit',code=>{if(!stopping)stop(code??1);});};
 process.once('SIGTERM',()=>stop());process.once('SIGINT',()=>stop());
 start('src/worker/production.ts',processingEnvironment(process.env));
 start('src/worker/telegram-publisher.ts',publishingEnvironment(process.env));
}

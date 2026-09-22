import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';const require=createRequire(path.resolve('package.json'));const {PrismaClient}=require('@prisma/client');
const base=new URL(process.env.TEST_DATABASE_URL||'');if(base.hostname!=='127.0.0.1')throw Error('LOCAL_ONLY');
const requested=process.argv.slice(2);const files=requested.length?requested:fs.readdirSync('tests').filter(f=>/\.test\.tsx?$/.test(f)).map(f=>'tests/'+f);if(files.some(f=>!/^tests\/[a-z0-9-]+\.test\.tsx?$/.test(f)))throw Error('TEST_PATH_REQUIRED');const results=[];fs.mkdirSync('.test-tools/regressions',{recursive:true});
for(let i=0;i<files.length;i++){
 const name='direct_'+Date.now()+'_'+i;const adminUrl=new URL(base);adminUrl.pathname='/postgres';const admin=new PrismaClient({datasourceUrl:adminUrl.toString()});
 try{await admin.$executeRawUnsafe('CREATE DATABASE '+name);}finally{await admin.$disconnect();}
 const url=new URL(base);url.pathname='/'+name;const env={...process.env,DATABASE_URL:url.toString(),TEST_DATABASE_URL:url.toString(),SHADOW_MODE:'true',REQUIRE_APPROVAL:'true',AUTO_PUBLISH:'false',TELEGRAM_PUBLISH_ENABLED:'false'};
 for(const key of ['DATABASE_URL_UNPOOLED','GEMINI_API_KEY','OPENAI_API_KEY','GROQ_API_KEY','TELEGRAM_API_ID','TELEGRAM_API_HASH','TELEGRAM_SESSION','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID'])delete env[key];
 const migration=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{env,encoding:'utf8'});if(migration.status){console.log('LOCAL_MIGRATION_FAILED',files[i]);process.exitCode=1;break;}
 const settings=new PrismaClient({datasourceUrl:url.toString()});try{await settings.appSettings.upsert({where:{id:1},create:{id:1},update:{}});}finally{await settings.$disconnect();}
 if(files[i]==='tests/seed.test.ts'){const seed=spawnSync(process.execPath,['--import','tsx','prisma/seed.ts'],{env,encoding:'utf8'});if(seed.status)throw Error('LOCAL_SEED_FAILED');}
 const run=spawnSync(process.execPath,['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1',files[i]],{env,encoding:'utf8',maxBuffer:20*1024*1024});
 const output=(run.stdout+run.stderr).replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[LOCAL_DATABASE_URL]');fs.writeFileSync('.test-tools/regressions/'+path.basename(files[i])+'.log',output);
 console.log(files[i],output.split('\n').filter(x=>/^# (tests|pass|fail|skipped)|^not ok/.test(x)).join(' | '));
 if(run.status)console.log(output.slice(-9000));results.push({file:files[i],status:run.status,database:name});
 if(run.status)process.exitCode=1;
}
fs.writeFileSync('.test-tools/regressions/results.json',JSON.stringify(results,null,2));




import {spawnSync} from 'node:child_process';

// CLI-only connection: runtime Prisma continues to use DATABASE_URL.
const commands={migrate:['migrate','deploy'],status:['migrate','status']};
const args=commands[process.argv[2]];
if(!args)throw new Error('Expected migrate or status');
let url;
try{url=new URL(process.env.DIRECT_URL??'');}catch{throw new Error('DIRECT_URL_REQUIRED');}
if(!['postgres:','postgresql:'].includes(url.protocol)||url.port==='6543')throw new Error('DIRECT_OR_SESSION_CONNECTION_REQUIRED');
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js',...args],{
  env:{...process.env,DATABASE_URL:url.href},encoding:'utf8',maxBuffer:10_000_000,
});
// Do not expose Prisma's datasource banner or connection error details.
if(result.status!==0){console.error('Prisma database operation failed. No connection details logged.');process.exitCode=1;}
else console.log(`Prisma ${process.argv[2]} completed successfully.`);

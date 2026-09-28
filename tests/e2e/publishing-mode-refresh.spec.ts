import {test,expect} from '@playwright/test';
import {PrismaClient,Prisma} from '@prisma/client';import {randomUUID} from 'node:crypto';
const url=process.env.TEST_DATABASE_URL!;if(new URL(url).hostname!=='127.0.0.1')throw Error('LOCAL_E2E_ONLY');const db=new PrismaClient({datasourceUrl:url});
let prior:Awaited<ReturnType<typeof db.appSettings.findUniqueOrThrow>>;let priorHeartbeat:Awaited<ReturnType<typeof db.workerHeartbeat.findUnique>>;
async function acknowledge(){const s=await db.appSettings.findUniqueOrThrow({where:{id:1}}),p=s.telegramAutoPolicy as {id:string;state:string};await db.workerHeartbeat.upsert({where:{id:'telegram-publisher-worker'},create:{id:'telegram-publisher-worker'},update:{}});await db.workerHeartbeat.update({where:{id:'telegram-publisher-worker'},data:{state:'IDLE',lastSeenAt:new Date(),lastError:null,metadata:{autoPublish:true,shadowMode:false,requireApproval:true,externalPublishingEnabled:true,destination:'-100123',policyId:p.id,policyState:p.state}}});}
test.beforeAll(async()=>{prior=await db.appSettings.findUniqueOrThrow({where:{id:1}});priorHeartbeat=await db.workerHeartbeat.findUnique({where:{id:'telegram-publisher-worker'}});await db.appSettings.update({where:{id:1},data:{publishingPaused:false,telegramAutoPolicy:{version:'telegram-auto-v1',id:randomUUID(),state:'CLOSED',destination:'-100123',notBefore:new Date().toISOString(),sourceIds:[],canaryCandidateId:null,authorizedBy:'offline-e2e',reason:'OPERATOR_DISABLED'}}});await acknowledge();});
test.afterAll(async()=>{if(prior)await db.appSettings.update({where:{id:1},data:{publishingPaused:prior.publishingPaused,telegramAutoPolicy:prior.telegramAutoPolicy??Prisma.DbNull}});if(priorHeartbeat)await db.workerHeartbeat.update({where:{id:priorHeartbeat.id},data:{...priorHeartbeat,metadata:priorHeartbeat.metadata??Prisma.DbNull}});else await db.workerHeartbeat.deleteMany({where:{id:'telegram-publisher-worker'}});await db.$disconnect();});
// The isolated E2E seed must provide a fresh authorized publisher heartbeat.
test('publishing mode persists and stays usable after submit and refresh',async({page})=>{
 await page.goto('/login');await page.getByLabel('اسم المستخدم',{exact:true}).fill('super_admin');await page.getByLabel('كلمة المرور',{exact:true}).fill(process.env.E2E_PASSWORD!);await page.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();await expect(page).not.toHaveURL(/login/);await page.goto('/settings');
 const panel=page.locator('section[aria-label="النشر التلقائي"]'),form=panel.locator('form').first();
 for(let cycle=0;cycle<2;cycle++)for(const on of [true,false]){
  const selected=form.locator('input[type=radio][value="'+String(on)+'"]');await selected.check();await form.locator('input[name=confirmed]').check();await form.getByRole('button',{name:'حفظ الإعدادات',exact:true}).click();
  await expect(form.locator('input[name=expected]')).toHaveValue(new RegExp(on?':ACTIVE$':':CLOSED$'));
  await expect(form.locator('fieldset')).toBeEnabled();await expect(selected).toBeChecked();
  await expect(form.locator('input[type=radio][value="'+String(!on)+'"]')).toBeEnabled();
  await acknowledge();await page.reload();await expect(selected).toBeChecked();await expect(form.locator('input[type=radio][value="'+String(!on)+'"]')).toBeEnabled();
 }
});

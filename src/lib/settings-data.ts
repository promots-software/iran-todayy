import type {PrismaClient} from '@prisma/client';
/** Independent reads run together; callers render nothing until all complete. */
export async function settingsData(db:PrismaClient,admin:boolean){
 const [heartbeat,settings,users]=await Promise.all([
  db.workerHeartbeat.findUnique({where:{id:'telegram-publisher-worker'}}),
  db.appSettings.findUnique({where:{id:1}}),
  admin?db.dashboardUser.findMany({select:{id:true,username:true,displayName:true,role:true,enabled:true},orderBy:{createdAt:'asc'}}):Promise.resolve([]),
 ]);
 return {heartbeat,settings,users};
}

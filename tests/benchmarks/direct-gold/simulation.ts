import type {CheckpointStore} from '../../../src/worker/checkpoints';
/** In-memory ports for the separately authorized future queue/recovery suite.
 * No production queue, publication adapter, timer, or live driver is imported. */
export interface SimulationPorts{now():number;checkpoint:CheckpointStore;persist(id:string,value:unknown):Promise<boolean>;schedule(id:string,availableAt:number):Promise<void>}
export function memorySimulation():SimulationPorts&{advance(ms:number):void;pending:Map<string,number>;records:Map<string,unknown>}{
 let time=0;const records=new Map<string,unknown>(),pending=new Map<string,number>(),stages=new Map<string,{pending:true}|{output:unknown}>();
 return {now:()=>time,advance:ms=>{if(ms<0)throw Error('CLOCK_REVERSED');time+=ms;},records,pending,
  persist:async(id,value)=>{if(records.has(id))return false;records.set(id,structuredClone(value));return true;},schedule:async(id,at)=>{pending.set(id,at);},
  checkpoint:{load:async k=>stages.get(k)??null,start:async k=>{if(stages.has(k))throw Error('DUPLICATE_STAGE');stages.set(k,{pending:true});},finish:async(k,output)=>{stages.set(k,{output:structuredClone(output)});},fail:async(k,_code,safe)=>{if(safe)stages.delete(k);}},
 };
}

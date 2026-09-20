/** Durable claims use three fresh slots, then one oldest-due slot. The cursor
 * advances in the same transaction as the claim; restart cannot reset fairness. */
export const processingConcurrency=2;
export function processingLanes(run:(lane:number)=>Promise<void>){return Array.from({length:processingConcurrency},(_,lane)=>run(lane));}
export function nextClaimSlot(previous:number){return (previous+1)%4;}
export function oldestSlot(slot:number){return slot===3;}

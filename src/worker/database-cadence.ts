/** Idle waits only: successful work immediately advances to the next claim. */
export const idleClaimMs=3000;
export function publisherDelay(status:string,dependencyFailures:number){
 if(dependencyFailures>0)return Math.min(60000,5000*2**Math.min(dependencyFailures,4));
 return ['DISABLED','PAUSED','NO_ELIGIBLE_STORY'].includes(status)?15000:5000;
}

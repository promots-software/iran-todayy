import {readEditorialState} from './processing/editorial-eligibility';
export function newsroomView(item:{validationResult:unknown;status:string;error?:string|null;humanDraft?:unknown},edit:boolean,role:string){
 const ready=readEditorialState(item.validationResult,item.status,item.error)==='READY_TO_PUBLISH';
 return {ready,showEditor:!ready||edit||!!item.humanDraft,showTechnical:role!=='EDITOR'};
}

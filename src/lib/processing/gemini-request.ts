import {coverageInstructions} from './editorial-scope';

// Local transport metadata only. Never sent as a header or provider payload.
export const checkpointAliases=Symbol('compatible-request-bodies');
export type CheckpointRequestInit=RequestInit&{[checkpointAliases]?:string[]};
export type GeminiRequest={systemInstruction:{parts:{text:string}[]};contents:{role:string;parts:{text:string}[]}[];generationConfig:{responseMimeType:string;responseJsonSchema:unknown;maxOutputTokens:number;candidateCount:number;thinkingConfig:{thinkingBudget:number}}};

/** Remove exact duplication only; every operative instruction and schema field
 * remains supplied. Keep the legacy body available for checkpoint lookup. */
export function compactGeminiRequest(original:GeminiRequest,stage:string):GeminiRequest{
 const result=structuredClone(original),schema=JSON.stringify(original.generationConfig.responseJsonSchema);
 const part=result.systemInstruction.parts[0];
 const duplicate='Return the complete structured object matching this schema: '+schema;
 if(part.text.includes(duplicate))part.text=part.text.replace(duplicate,'Return the complete structured object matching the supplied response schema.');
 const tail='\nCOVERAGE POLICY OVERRIDE:\n'+coverageInstructions;
 if(part.text.endsWith(tail)&&part.text.slice(0,-tail.length).includes(coverageInstructions))part.text=part.text.slice(0,-tail.length);
 if(stage==='iran_today_classify'){
  // This contract contains IDs/enums/booleans only. Allocate for every supplied
  // ID, longest legal labels, generous whitespace and framing; never truncate
  // source spans or translated prose to obtain a smaller budget.
  try{
   const input=JSON.parse(result.contents[0].parts[0].text);
   const refs=input.classificationReferences;
   const anchors:unknown=refs?.requiredAnchorIds,facts:unknown=refs?.requiredFactIds;
   if(Array.isArray(anchors)&&Array.isArray(facts)&&[...anchors,...facts].every(x=>typeof x==='string')){
    const ids=[...anchors,...facts] as string[];
    const longest=ids.reduce((a,b)=>Buffer.byteLength(a)>Buffer.byteLength(b)?a:b,'');
    const shape={anchorIds:anchors,factLabels:(facts as string[]).map(id=>({id,kind:'STATEMENT',material:false})),filterReason:'ADVERTISING',topic:'IRAN_DOMESTIC',topicEvidenceId:longest,priority:'P4',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:ids};
    // Include the entire enum catalogue as extra allowance for any longer label.
    const props=(original.generationConfig.responseJsonSchema as {properties?:Record<string,unknown>}).properties;
    const bytes=Buffer.byteLength(JSON.stringify(shape))+Buffer.byteLength(JSON.stringify(props?.topic??{}));
    result.generationConfig.maxOutputTokens=Math.min(original.generationConfig.maxOutputTokens,Math.max(1024,Math.ceil((bytes*2+256)/256)*256));
   }
  }catch{/* Unknown contract retains its original safe output allowance. */}
 }
 return result;
}

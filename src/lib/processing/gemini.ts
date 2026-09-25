import {geminiWireSchema} from './gemini-wire-schema';
import {GroqLanguageProvider} from './groq';
import {failurePolicy,retryAfter} from './failure-policy';
import {ProcessingError,type LanguageProvider} from './contracts';
import {compactGeminiRequest,checkpointAliases,type CheckpointRequestInit} from './gemini-request';
export {readLocalGeminiKey} from './gemini-key';
export type GeminiUsage={stage:string;attempt:number;httpStatus:number|null;inputTokens:number|null;outputTokens:number|null;thinkingTokens:number|null;estimatedCostUsd:number|null;replayed?:boolean;durationMs?:number};
/** Native Gemini transport, shared extraction/classification/atom validators. No fallback provider. */
export class GeminiLanguageProvider implements LanguageProvider{
 readonly id='gemini:gemini-3.1-flash-lite:semantic-integrity-v4.4';readonly live=true;readonly draftOnlyAccepted=true;readonly constrainedRewrite=true;
 private delegate:GroqLanguageProvider;
 constructor(key:string,transport:typeof fetch=fetch,log:(u:GeminiUsage)=>void|Promise<void>=()=>{}){
  if(!key)throw new ProcessingError('GEMINI_API_KEY_REQUIRED');
  this.delegate=new GroqLanguageProvider('injected-gemini-transport',async(_url,init)=>{
   const req=JSON.parse(String(init?.body));
   const proposition=/^iran_today_proposition_(source|candidate|assessor|comparator)$/.test(req.response_format.json_schema.name);
   const body={systemInstruction:{parts:[{text:req.messages[0].content}]},contents:[{role:'user',parts:[{text:req.messages[1].content}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:geminiWireSchema(req.response_format.json_schema.schema),maxOutputTokens:req.max_completion_tokens,candidateCount:1,thinkingConfig:proposition?{thinkingLevel:'high' as const}:{thinkingBudget:0}}};
   for(let attempt=1;attempt<=1;attempt++){
    const started=Date.now();
    const record:GeminiUsage={stage:req.response_format.json_schema.name,attempt,httpStatus:null,inputTokens:null,outputTokens:null,thinkingTokens:null,estimatedCostUsd:null};
    try{
     const optimized=compactGeminiRequest(body,req.response_format.json_schema.name);
     const request:CheckpointRequestInit={method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:init?.signal,body:JSON.stringify(optimized),[checkpointAliases]:[JSON.stringify(body)]};
     const response=await transport('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',request);
     record.httpStatus=response.status;
     record.replayed=response.headers.get('x-worker-checkpoint-replayed')==='true';
     if(!response.ok){const code=`GEMINI_HTTP_${response.status}`;throw new ProcessingError(code,failurePolicy(code,1).retryable,undefined,retryAfter(response.headers));}
     const envelope=await response.json();
     const usage=envelope.usageMetadata;
     if(record.replayed){record.inputTokens=0;record.outputTokens=0;record.thinkingTokens=0;record.estimatedCostUsd=0;}
     else if(Number.isSafeInteger(usage?.promptTokenCount)&&Number.isSafeInteger(usage?.candidatesTokenCount)){
      record.inputTokens=usage.promptTokenCount;record.outputTokens=usage.candidatesTokenCount;record.thinkingTokens=usage.thoughtsTokenCount??0;
      record.estimatedCostUsd=(record.inputTokens!*0.25+(record.outputTokens!+record.thinkingTokens!)*1.5)/1e6;
     }
     if(envelope.candidates?.length!==1||envelope.candidates[0].finishReason!=='STOP'||(!proposition&&(usage?.thoughtsTokenCount??0)>0))throw new ProcessingError('GEMINI_INCOMPLETE');
     const content=envelope.candidates[0].content?.parts?.filter((p:{text?:string;thought?:boolean})=>typeof p.text==='string'&&!p.thought).map((p:{text:string})=>p.text).join('');
     if(!content)throw new ProcessingError('GEMINI_INVALID_RESPONSE');
     return Response.json({choices:[{finish_reason:'stop',message:{content}}]},{headers:{'x-worker-checkpoint-replayed':record.replayed?'true':'false'}});
    }catch(error){if(error instanceof ProcessingError&&/^GEMINI_HTTP_\d{3}$/.test(error.code))record.httpStatus=Number(error.code.slice(-3));throw error instanceof ProcessingError?error:new ProcessingError('GEMINI_TRANSPORT_FAILED',true);}
    finally{record.durationMs=Date.now()-started;await log(record);}
   }
   throw new ProcessingError('GEMINI_HTTP_503');
  },()=>{});
 }
 understand(i:Parameters<LanguageProvider['understand']>[0],s:AbortSignal){return this.delegate.understand(i,s);}
 classifyExtracted(...args:Parameters<GroqLanguageProvider['classifyExtracted']>){return this.delegate.classifyExtracted(...args);}
 compare(i:Parameters<LanguageProvider['compare']>[0],s:AbortSignal){return this.delegate.compare(i,s);}
 draft(i:Parameters<LanguageProvider['draft']>[0],s:AbortSignal){return this.delegate.draft(i,s);}
}

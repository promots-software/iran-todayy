/* Explicit synthetic mock encoder. Never used on saved historical provider outputs. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import {indexedSpanCatalog} from '../../src/lib/processing/bookkeeping-contract';
import {sourceUnits} from '../../src/lib/processing/source-units';
export function bindingFixture(data:any,output:any):any {
 if(!data.bookkeeping||output.catalogId)return output;
 const source=String(data.content??data.originalSource??''),units=sourceUnits(source);
 const span=(text:string,excerpt:string,offset?:number)=>{const c=indexedSpanCatalog(text,'fixture'),start=offset??text.indexOf(excerpt),end=start+excerpt.length;assert(start>=0,'synthetic fixture excerpt must exist');const a=c.atoms.findIndex(a=>a.start===start),b=c.atoms.findIndex(a=>a.end===end);assert(a>=0&&b>=0,'synthetic fixture must use atom boundaries');return {first:a,last:b};};
 const evidence=(e:any)=>{if(!e)return null;const start=e.startOffset??source.indexOf(e.excerpt),end=start+e.excerpt.length;const containing=units.filter(u=>u.end>start&&u.start<end);assert(containing.length);return {span:span(source,e.excerpt,start),context:{firstUnit:containing[0].id,lastUnit:containing.at(-1)!.id}};};
 if(data.frozenArticle&&output.publication){return {catalogId:data.bookkeeping.catalogId,links:{title:output.publication.title.factIds.map((id:string)=>data.validatedFacts.facts.findIndex((f:any)=>f.id===id)),...(data.frozenArticle.body?{body:output.publication.body[0].factIds.map((id:string)=>data.validatedFacts.facts.findIndex((f:any)=>f.id===id))}:{})},coverage:Object.fromEntries(output.coverage.map((r:any)=>[r.unitId,{factIndices:r.factIds.map((id:string)=>data.validatedFacts.facts.findIndex((f:any)=>f.id===id)),nonFactual:r.nonFactual}]))};}
 const x=output.extraction??output;
 if(Array.isArray(x.statements)){
  const {coverage,...rest}=x;const result={...rest,actors:x.actors.map(evidence),action:evidence(x.action),object:evidence(x.object),location:evidence(x.location),event_time:evidence(x.event_time),contentTypeEvidence:evidence(x.contentTypeEvidence),statements:x.statements.map((s:any)=>({...s,evidence:evidence(s.evidence),speaker:evidence(s.speaker)})),unitCoverage:Object.fromEntries(coverage.map((r:any)=>[r.unitId,{statementIndices:r.factIds.map((id:string)=>Number(id.slice(1))-1),nonFactual:r.nonFactual}]))};
  if(data.frozenArticle){delete result.relevance;delete result.contentType;}
  return {catalogId:data.bookkeeping.catalogId,...(output.extraction?{extraction:result,...(output.article?{article:output.article}:{})}:result)};
 }
 if(output.fidelityLedger){
  const publication=data.publication as {id:string;text:string}[];
  return {...output,catalogId:data.bookkeeping.catalogId,review:Object.fromEntries(output.review.map(({id,...r}:any)=>[id,r])),fidelityLedger:{claims:Object.fromEntries(output.fidelityLedger.claims.map((c:any)=>[c.publicationId,{explanation:c.explanation,components:c.components.map(({id,excerpt,...v}:any)=>{void id;return {...v,span:span(publication.find(p=>p.id===c.publicationId)!.text,excerpt)};})}])),sourceCoverage:Object.fromEntries(output.fidelityLedger.sourceCoverage.map((r:any)=>[r.unitId,{disposition:r.disposition,explanation:r.explanation,comparisons:Object.fromEntries(publication.map(p=>[p.id,r.temporal.filter((t:any)=>t.publicationId===p.id).map(({publicationId,sourceExcerpt,candidateExcerpt,...v}:any)=>{void publicationId;return {...v,sourceSpan:span(source,sourceExcerpt,units.find(u=>u.id===r.unitId)!.start+units.find(u=>u.id===r.unitId)!.text.indexOf(sourceExcerpt)),candidateSpan:span(p.text,candidateExcerpt)};})]))}]))}};
 }
 return output;
}
export function bindingMock(mock:typeof fetch):typeof fetch {return async(url,init)=>{
 const response=await mock(url,init);if(!response.ok)return response;
 const request=JSON.parse(String(init?.body)),data=JSON.parse(request.contents[0].parts[0].text);
 if(!data.bookkeeping)return response;
 const body=await response.clone().json();if(!body.candidates?.[0]?.content?.parts?.[0]?.text)return response;
 body.candidates[0].content.parts[0].text=JSON.stringify(bindingFixture(data,JSON.parse(body.candidates[0].content.parts[0].text)));
 return Response.json(body,{status:response.status,headers:response.headers});
};}

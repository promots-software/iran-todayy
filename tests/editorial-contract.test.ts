import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {editorialContract,EDITORIAL_CONTRACT_SHA256,validateEditorialContract,isGroundedTerminologyQuote} from '../src/lib/processing/editorial-contract';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {validateDirectExtraction,adaptDirectExtraction} from '../src/lib/processing/direct';
import {prepareDirectBilingual,finalizeDirectBilingual} from '../src/lib/processing/direct-bilingual';
import {ruleSet} from '../src/lib/processing/rules';
import {unknownProfile} from '../src/lib/processing/contracts';
import {renderingChecks} from '../src/lib/processing/rendering-contract';
import {finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {preparePublication,acceptPublication,publicationDraft} from '../src/lib/processing/direct-publication';
import {bilingualFixture,passingReview,geminiEnvelope} from './fixtures/direct-bilingual';
const signal=()=>new AbortController().signal;
const source='افتتح المجلس 12 مدرسة جديدة في العاصمة.';
const e=(excerpt:string)=>({excerpt,context:source});
const raw={actors:[e('المجلس')],action:e('افتتح'),object:e('12 مدرسة جديدة'),location:e('العاصمة'),event_time:null,statements:[{evidence:e(source),speaker:null,kind:'FACT',material:false}],safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}};
const coverage=[{unitId:'u1',factIds:['f1'],nonFactual:false}];
function inspect(init?:RequestInit){
 const req=JSON.parse(String(init?.body)),text=req.systemInstruction.parts[0].text as string;
 assert.equal(text.split(editorialContract).length,2,'one complete file survives native wire compaction');
 const embedded=text.split('BEGIN_COMPLETE_EDITORIAL_CONTRACT\n')[1].split('\nEND_COMPLETE_EDITORIAL_CONTRACT')[0];
 assert.equal(createHash('sha256').update(embedded).digest('hex'),EDITORIAL_CONTRACT_SHA256);
 assert.equal(req.generationConfig.maxOutputTokens,4096);
 assert.equal(req.generationConfig.thinkingConfig.thinkingBudget,0);
 assert.ok(!text.includes('Do not include branding'));
 return req;
}
test('byte-exact canonical artifact has all 40 sections, final check and intact examples',()=>{
 const bytes=readFileSync('config/editorial/iran-now-contract.txt');assert.equal(validateEditorialContract(bytes),editorialContract);
 assert.deepEqual([...editorialContract.matchAll(/^(\d+)\. /gm)].map(m=>+m[1]),Array.from({length:40},(_,i)=>i+1));
 assert.throws(()=>validateEditorialContract(Buffer.from(editorialContract.trim())),/INTEGRITY/);
 assert.throws(()=>validateEditorialContract(Buffer.from(editorialContract.replace('40. FINAL QUALITY CHECK BEFORE OUTPUT',''))),/INTEGRITY/);
 for(const example of ['27 شهریور → 27 أيلول','Masoud Pezeshkian → مسعود بزشكيان','40. FINAL QUALITY CHECK BEFORE OUTPUT'])assert.ok(editorialContract.includes(example));
});
test('DIRECT Arabic actual generation and repair both receive entire contract',async()=>{
 process.env.SHADOW_MODE='true';process.env.REQUIRE_APPROVAL='true';let calls=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  inspect(init);calls++;return Response.json(geminiEnvelope({...raw,statements:calls===1?[]:raw.statements,coverage,publication:{title:{text:'إيران الآن | '+source.slice(0,-1),factIds:['f1']},body:[]}}));
 });
 const u=await provider.understand({content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet,processingMode:'DIRECT'},signal());
 const d=await provider.draft({content:source,understanding:u,rules:ruleSet,processingMode:'DIRECT'},signal());
 assert.equal(calls,2);assert.equal(d.title,'إيران الآن | '+source.slice(0,-1));assert.equal(u.publicationProposal?.editorialContractHash,EDITORIAL_CONTRACT_SHA256);
});
for(const language of ['ar','fa','en'] as const)for(const mode of ['NORMAL','DIRECT'] as const)test(`${mode} ${language} final generation uses actual contract; semantic review cannot be bypassed`,async()=>{
 process.env.SHADOW_MODE='true';process.env.REQUIRE_APPROVAL='true';
 const f=bilingualFixture(language==='ar'?'fa':language),p=prepareDirectBilingual(f.raw,f.source);
 const content=language==='ar'?source:f.source;
 const u=language==='ar'?adaptDirectExtraction(validateDirectExtraction(raw,source),source):adaptDirectExtraction(p.grounded,f.source,finalizeDirectBilingual(f.source,p,passingReview(f.source,p)));
 const facts=JSON.stringify(u.event);let calls=0;
 const publication={title:{text:'إيران الآن | افتتاح 12 مدرسة جديدة في العاصمة',factIds:['f1']},body:[{text:'افتتح المجلس 12 مدرسة جديدة في العاصمة.',factIds:['f1']}]};
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const req=inspect(init),data=JSON.parse(req.contents[0].parts[0].text);calls++;
  assert.equal(data.originalSource,content);
  if(calls===1){assert.ok(req.generationConfig.responseJsonSchema.properties.publication);assert.deepEqual(data.validatedFacts,u.event);return Response.json(geminiEnvelope({coverage,publication}));}
  assert.equal(calls,2);assert.equal(u.publicationProposal,undefined,'no trust receipt before independent review');
  return Response.json(geminiEnvelope({review:data.publication.map((s:{id:string})=>({id:s.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[]}));
 });
 const d=await provider.draft({content,understanding:u,rules:ruleSet,processingMode:mode},signal());
 assert.equal(calls,2);assert.equal(JSON.stringify(u.event),facts);assert.equal(d.title,publication.title.text);assert.equal(u.publicationProposal?.method,'INDEPENDENT');
 const final=finalizeConstrainedDraft(d,content,u,unknownProfile);assert.equal(final.title,d.title);assert.ok(!final.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));
});
test('terminology quotation exception cannot authorize invented words or literal claims',()=>{
 assert.equal(isGroundedTerminologyQuote('"إسرائيل"','إسرائيل'),true);
 assert.equal(isGroundedTerminologyQuote('"إسرائيل"','لبنان'),false);
 assert.equal(isGroundedTerminologyQuote('"إسرائيل انتصرت"','إسرائيل'),false);
});
test('final Persian rewrite preserves independently validated Arabic calendar labels and rejects changed date',()=>{
 const f=bilingualFixture();f.source+=' در ۱۲ مهر';
 for(const e of [...f.raw.actors,f.raw.action,f.raw.object,f.raw.location,f.raw.statements[0].evidence])e.context=f.source;
 f.raw.statements[0].evidence.excerpt=f.source;f.raw.statements[0].evidence.arabic+=' في 12 تشرين الأول بالتقويم الإيراني';
 const p=prepareDirectBilingual(f.raw,f.source),u=adaptDirectExtraction(p.grounded,f.source,finalizeDirectBilingual(f.source,p,passingReview(f.source,p)));
 const proposal={title:{text:'إيران الآن | '+f.raw.statements[0].evidence.arabic,factIds:['f1']},body:[]};
 assert.doesNotThrow(()=>preparePublication(f.source,u,proposal,coverage));
 assert.throws(()=>preparePublication(f.source,u,{...proposal,title:{...proposal.title,text:proposal.title.text.replace('12 تشرين','13 تشرين')}},coverage),/NUMBER_MISMATCH/);
 const missing=structuredClone(u);delete missing.rendering;assert.throws(()=>preparePublication(f.source,missing,proposal,coverage),/VALIDATED_ARABIC_RENDERING_REQUIRED/);
});
test('translated quoted speech needs the exact independently validated rendering; fabrication remains rejected',()=>{
 const f=bilingualFixture();f.source='«'+f.source+'»';
 for(const e of [...f.raw.actors,f.raw.action,f.raw.object,f.raw.location,f.raw.statements[0].evidence])e.context=f.source;
 f.raw.statements[0].evidence.excerpt=f.source;f.raw.statements[0].evidence.arabic='«'+f.raw.statements[0].evidence.arabic+'»';
 const p=prepareDirectBilingual(f.raw,f.source),u=adaptDirectExtraction(p.grounded,f.source,finalizeDirectBilingual(f.source,p,passingReview(f.source,p)));
 const proposal={title:{text:'إيران الآن | '+f.raw.statements[0].evidence.arabic,factIds:['f1']},body:[]};
 const prepared=preparePublication(f.source,u,proposal,coverage);u.publicationProposal=acceptPublication(f.source,u,prepared);
 const final=finalizeConstrainedDraft(publicationDraft(f.source,u),f.source,u,unknownProfile);
 assert.ok(!final.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));
 assert.throws(()=>preparePublication(f.source,u,{...proposal,title:{...proposal.title,text:proposal.title.text.replace('افتتح','أغلق')}},coverage),/QUOTE_MISMATCH/);
});
test('worker image and Vercel tracing package the exact artifact',()=>{
 assert.ok(readFileSync('Dockerfile.worker','utf8').includes('COPY config/editorial ./config/editorial'));
 assert.ok(readFileSync('next.config.ts','utf8').includes('./config/editorial/iran-now-contract.txt'));
 assert.ok(readFileSync('.gitattributes','utf8').includes('config/editorial/iran-now-contract.txt -text'));
});

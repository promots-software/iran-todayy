import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compactMatcherCandidate,matcherDocumentDefaults} from '../src/lib/processing/canonical-matcher-documents';
import {canonicalDigest} from '../src/lib/processing/canonical-flow';
import type {Candidate} from '../src/lib/processing/matcher';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/canonical-retrieval-v1/historical.json',import.meta.url),'utf8')) as {catalog:(Omit<Candidate,'publishedAt'>&{publishedAt:string})[]};
for(const [i,c]of corpus.catalog.entries())test(`historical candidate semantic fields preserved ${i}`,()=>{
 const original=structuredClone(c),wire=compactMatcherCandidate({...c,publishedAt:new Date(c.publishedAt)},i) as {documents:Record<string,unknown>[];summary?:string}&Record<string,unknown>;
 assert.equal(wire.documents.length,c.data.facts.length);
 for(const [j,f]of c.data.facts.entries()){const d=wire.documents[j];assert.equal(d.source,f.evidence.excerpt);assert.equal(d.arabic,f.arabic);assert.deepEqual(d.speaker??null,f.speaker);assert.equal(d.kind??matcherDocumentDefaults.kind,f.kind);assert.equal(d.material??matcherDocumentDefaults.material,f.material);assert.equal(d.verified??matcherDocumentDefaults.verified,f.verified);assert.equal(d.key??canonicalDigest(String(d.source)),f.key);}
 for(const [key,value]of Object.entries(c.data)){if(key==='facts')continue;if(key==='summary'&&value!==null&&!wire.summary)assert(wire.documents.some(d=>String(d.arabic).split('\n')[0]===value));else if(value!==null&&(!Array.isArray(value)||value.length))assert.deepEqual(wire[key],value);}
 assert.deepEqual(c,original);
});
test('nondefault facts, semantic keys, speaker provenance and nonempty event fields survive',()=>{
 const evidence={excerpt:'12 مايو في طهران',start:3,end:18,sourcePostId:'source-1'},supported={key:'meaningful actor key',arabic:'المتحدث',evidence};const c:Candidate={id:'event',revisionId:'revision',revision:1,publishedAt:new Date('2026-09-28T12:00:00Z'),published:false,data:{actors:[supported],action:supported,object:supported,location:supported,eventTime:{iso:'2026-05-12T00:00:00Z',evidence},summary:'Independent summary',facts:[{id:'fact',key:'material semantic key',arabic:'لم يقل «نعم»',evidence,kind:'CLAIM',material:false,verified:true,speaker:supported}]}};
 const wire=compactMatcherCandidate(c,0) as Record<string,unknown>;assert.deepEqual(wire.actors,c.data.actors);assert.deepEqual(wire.eventTime,c.data.eventTime);assert.deepEqual(wire.documents,[{source:evidence.excerpt,arabic:'لم يقل «نعم»',key:'material semantic key',speaker:supported,kind:'CLAIM',material:false,verified:true}]);for(const key of ['action','object','location','summary']as const)assert.deepEqual(wire[key],c.data[key]);
});

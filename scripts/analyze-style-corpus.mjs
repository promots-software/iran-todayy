import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Offline style evidence only. No source-to-final factual pairing is inferred.
const bytes=readFileSync(process.argv[2]);
const data=JSON.parse(bytes);
const texts=data.messages.map(m=>m.text).filter(t=>typeof t==='string'&&t.trim());
const quantiles=values=>{
 const a=values.sort((a,b)=>a-b);
 return Object.fromEntries([.25,.5,.75,.95].map(q=>[String(q),a[Math.floor((a.length-1)*q)]??null]));
};
const count=regex=>texts.filter(t=>regex.test(t)).length;
console.log(JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex'),records:data.messages.length,textual:texts.length,uniqueTexts:new Set(texts).size,
 branded:count(/^إيران الآن\s*\|/u),multiline:count(/\n/u),blankLine:count(/\n\s*\n/u),attributionHeading:count(/^[^\n]*[:：]\s*(?:\n|$)/u),bullets:count(/(?:^|\n)\s*[-•]/u),hashtags:count(/#\p{L}/u),emoji:count(/\p{Extended_Pictographic}/u),quotes:count(/[«»“”"]/u),
 headlineCharacters:quantiles(texts.map(t=>t.split('\n')[0].replace(/^إيران الآن\s*\|\s*/u,'').length)),
 bodyCharacters:quantiles(texts.filter(t=>t.includes('\n')).map(t=>t.slice(t.indexOf('\n')+1).trim().length)),
 dateRange:'UNVERIFIED: exported timestamps are malformed; no six-day inference',pairedSourceGold:0},null,2));

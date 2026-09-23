/** Display only allowlisted diagnostic structure, never model payloads or HTTP data. */
export function repairDiagnosticSummary(result:unknown){
 const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
 const code=(v:unknown)=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(v)?v:null;
 const diagnostic=object(object(result).diagnostic);
 const entry=(v:unknown)=>{
  const e=object(v),c=code(e.code);if(!c)return null;
  const paths=Array.isArray(e.issues)?e.issues.slice(0,20).flatMap(i=>{
   const p=object(i).path;
   return Array.isArray(p)&&p.every(k=>typeof k==='number'&&Number.isSafeInteger(k)||typeof k==='string'&&/^[A-Za-z_][A-Za-z0-9_:]{0,60}$/.test(k))?[p.join('.')]:[];
  }):[];
  return {code:c,paths};
 };
 return {initial:entry(diagnostic.initialFailure),repair:entry(diagnostic.repairFailure)??entry({code:diagnostic.causeCode,issues:diagnostic.issues})};
}

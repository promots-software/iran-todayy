/** Gemini-only compatibility projection; local schemas remain authoritative. */
export function geminiWireSchema(schema:unknown):unknown {
 const copy=structuredClone(schema);
 function visit(value:unknown):void {
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach(visit);return;}
  const node=value as Record<string,unknown>;
  if(node.type==='array'){delete node.minItems;delete node.maxItems;}
  if(node.properties&&typeof node.properties==='object')Object.values(node.properties).forEach(visit);
  for(const key of ['items','anyOf','oneOf','allOf','prefixItems','additionalProperties','not'])visit(node[key]);
  for(const key of ['$defs','definitions'])if(node[key]&&typeof node[key]==='object')Object.values(node[key]).forEach(visit);
 }
 visit(copy);return copy;
}

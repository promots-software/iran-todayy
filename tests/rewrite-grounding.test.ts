import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedRuleDecisions,constrainRewriteDecisions,rewriteInstructions,rewriteInput} from '../src/lib/processing/rewrite-contract';
import {groqSchema} from '../src/lib/processing/groq-context';
import {draftSchema} from '../src/lib/processing/contracts';
import {structuredSchema} from '../src/lib/processing/openai';
import {ruleSet} from '../src/lib/processing/rules';
import {fixture} from './fixtures/processing';
type RuleTuple=ReturnType<typeof allowedRuleDecisions>[number];
type RuleBranch={properties:Record<'ruleId'|'from'|'to',{enum:string[]}>;additionalProperties:boolean;required:string[]};

test('both provider schemas allow only exact engine tuples, without cross-rule combinations',()=>{
 const groq=groqSchema('draft',draftSchema);constrainRewriteDecisions(groq,allowedRuleDecisions());
 for(const schema of [groq,structuredSchema('draft',allowedRuleDecisions())]) {
  const branches=(schema as unknown as {properties:{decisions:{items:{anyOf:RuleBranch[]}}}}).properties.decisions.items.anyOf;
  const actual=branches.map(b=>({ruleId:b.properties.ruleId.enum[0],from:b.properties.from.enum[0],to:b.properties.to.enum[0]}));
  assert.deepEqual(actual,allowedRuleDecisions());
  for(const tuple of actual){const rule=ruleSet.terminology.find(r=>r.id===tuple.ruleId);assert.ok(rule?.from.includes(tuple.from));assert.ok(rule?.to.includes(tuple.to));}
  const accepts=(v:RuleTuple)=>actual.some(a=>a.ruleId===v.ruleId&&a.from===v.from&&a.to===v.to);
  assert.equal(accepts({ruleId:'invented-policy',from:'x',to:'y'}),false);
  assert.equal(accepts({...actual[0],from:actual[0].from+' invented suffix'}),false);
  assert.ok(branches.every(b=>b.additionalProperties===false&&b.required.includes('evidence')));
 }
});
test('fact-only payload provides exact choices; empty decisions remain available',()=>{
 const f=fixture('grounding','قال متحدث إن المنشأة تضررت.','ar','قال متحدث إن المنشأة تضررت.');
 const data=rewriteInput(f.content,f.understanding);
 assert.deepEqual(data.allowedRuleDecisions,[]);
 assert.ok(draftSchema.safeParse({...f.draft,decisions:[]}).success);
 assert.ok(rewriteInstructions.includes('otherwise omit it'));
});
test('semantic instructions prohibit attribute transfer and prefer narrow grounded wording',()=>{
 for(const attribute of ['nationality','affiliation','ownership','role','identity','location','time','motive','relationships'])assert.ok(rewriteInstructions.includes(attribute));
 assert.ok(rewriteInstructions.includes('unless the linked validated fact explicitly establishes'));
 assert.ok(rewriteInstructions.includes('An attribute of an object or institution does not establish the same attribute of its speaker'));
 assert.ok(rewriteInstructions.includes('prefer narrower wording over inference'));
 assert.ok(rewriteInstructions.includes('valid factIds alone do not prove semantic grounding'));
});

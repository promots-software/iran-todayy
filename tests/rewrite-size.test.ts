import test from 'node:test';
import assert from 'node:assert/strict';
import {ruleSet} from '../src/lib/processing/rules';
import {relevantRuleDecisions,rewriteInput,constrainRewriteDecisions} from '../src/lib/processing/rewrite-contract';
import {groqSchema} from '../src/lib/processing/groq-context';
import {draftSchema} from '../src/lib/processing/contracts';
import {fixture} from './fixtures/processing';
type DecisionSchema={properties:{decisions:{items:{anyOf:unknown[]};maxItems?:number;type:string}}};
const rules={...ruleSet,terminology:[
 {...ruleSet.terminology[0],id:'fixture-a',from:['تعبير قديم'],to:['تعبير جديد','تعبير بديل']},
 {...ruleSet.terminology[0],id:'fixture-b',from:['لفظ آخر'],to:['لفظ بديل']},
]};
test('choices come only from grounded fact/speaker terms and preserve exact engine pairs',()=>{
 const f=fixture('size','تعبير قديم','ar','تعبير قديم');
 assert.deepEqual(relevantRuleDecisions(f.understanding,rules),[
  {ruleId:'fixture-a',from:'تعبير قديم',to:'تعبير جديد'},
  {ruleId:'fixture-a',from:'تعبير قديم',to:'تعبير بديل'},
 ]);
 const input=rewriteInput(f.content+' لفظ آخر',f.understanding,rules);
 assert.equal(input.allowedRuleDecisions.length,2);
 assert.ok(!input.allowedRuleDecisions.some(c=>c.ruleId==='fixture-b'));
 const schema=groqSchema('draft',draftSchema) as unknown as DecisionSchema;
 constrainRewriteDecisions(schema,input.allowedRuleDecisions);
 assert.equal(schema.properties.decisions.items.anyOf.length,2);
 assert.ok(JSON.stringify(schema).length<12000);
});
test('no relevant choices forces an empty array; unrelated anchors and partial terms do not match',()=>{
 const f=fixture('size','تعبير قديمة','ar','تعبير قديمة');
 f.understanding.event.actors[0].arabic='لفظ آخر';
 const choices=relevantRuleDecisions(f.understanding,rules);
 assert.deepEqual(choices,[]);
 const schema=groqSchema('draft',draftSchema) as unknown as DecisionSchema;
 constrainRewriteDecisions(schema,choices);
 assert.equal(schema.properties.decisions.maxItems,0);
 assert.equal(schema.properties.decisions.type,'array');
});

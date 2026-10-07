import test from 'node:test';
import assert from 'node:assert/strict';
import { markRuntimePredictions, runtimePredictionPlan } from '../app/lib/runtime-annotations.ts';
import { createEditorState, editorReducer } from '../app/editor/state/editor-state.ts';
import { preannotationUndoPlan } from '../app/lib/preannotation-undo.ts';

const source='local model/image/whole';
const box=(id,x=10)=>({id,asset:'image',label:'dog',type:'box',x,y:20,width:50,height:60});
const marked=(id,key=source)=>markRuntimePredictions([box(id)],key)[0];

test('native rerun replaces only its own untouched results and remains repeatable after Undo',()=>{
  const original=marked('old'),other=marked('other','another model'),manual=box('sam-mask',100);
  const generated=marked('new');const initial=createEditorState([manual,original,other]);
  const plan=runtimePredictionPlan(new Map(),initial.annotations,[generated],source);
  assert.deepEqual(plan.remove,['old']);assert.deepEqual(plan.previous,[original]);
  const updated=editorReducer(initial,{type:'settle-drafts',plan:()=>plan});
  assert.deepEqual(updated.annotations,[manual,other,generated]);
  const restored=editorReducer(updated,{type:'replace-annotations-batch',...preannotationUndoPlan(updated.annotations,['new'],plan.previous)});
  const repeated=runtimePredictionPlan(new Map(),restored.annotations,[marked('next')],source);
  assert.deepEqual(repeated.remove,['old']);assert.equal(repeated.add.length,1);
});

test('native rerun preserves moved, reclassified and reviewed predictions without duplicating their original objects',()=>{
  for(const change of [{x:300},{label:'corrected'},{reviewScore:4}]){
    const original=marked('old'),edited={...original,...change};
    const plan=runtimePredictionPlan(new Map(),[edited],[marked('new')],source);
    assert.deepEqual(plan.remove,[]);assert.deepEqual(plan.add,[]);assert.deepEqual(plan.previous,[]);
  }
});

test('native empty success replaces old results; cancellation or failure only discards current drafts',()=>{
  const old=marked('old'),draft=marked('draft');const drafts=new Map([['draft',draft]]);
  const success=runtimePredictionPlan(drafts,[old,draft],[],source);
  assert.deepEqual(success.remove,['draft','old']);assert.deepEqual(success.previous,[old]);
  const canceled=runtimePredictionPlan(drafts,[old,draft],[],source,false);
  assert.deepEqual(canceled.remove,['draft']);assert.deepEqual(canceled.previous,[]);
  const edited={...draft,x:300};
  assert.deepEqual(runtimePredictionPlan(drafts,[old,edited],[],source,false).remove,[]);
});

test('native provenance survives JSON restart and malformed provenance cannot delete manual work',()=>{
  const original=JSON.parse(JSON.stringify(marked('old')));
  assert.deepEqual(runtimePredictionPlan(new Map(),[original],[marked('new')],source).remove,['old']);
  for(const bounds of [null,{}, {x:NaN,y:0,width:1,height:1},{x:0,y:0,width:-1,height:1}]){
    const invalid={...original,prediction:{...original.prediction,bounds}};
    assert.deepEqual(runtimePredictionPlan(new Map(),[invalid],[marked('new')],source).remove,[]);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { commandFromKeyboard } from '../app/editor/commands/editor-shortcuts.ts';

const key = (value, extra={}) => ({ key:value, ctrlKey:false, metaKey:false, shiftKey:false, ...extra });

test('tool shortcuts map to canonical tools', () => {
  assert.deepEqual(commandFromKeyboard(key('v')), {type:'tool',tool:'select'});
  assert.deepEqual(commandFromKeyboard(key('h')), {type:'tool',tool:'pan'});
  assert.deepEqual(commandFromKeyboard(key('b')), {type:'tool',tool:'box'});
  assert.deepEqual(commandFromKeyboard(key('p')), {type:'tool',tool:'polygon'});
  assert.deepEqual(commandFromKeyboard(key('f')), {type:'tool',tool:'freehand'});
  assert.deepEqual(commandFromKeyboard(key('l')), {type:'tool',tool:'line'});
  assert.deepEqual(commandFromKeyboard(key('k')), {type:'tool',tool:'point'});
});

test('advanced vector shortcuts are distinct from drawing tools', () => {
  assert.deepEqual(commandFromKeyboard(key('o')), {type:'vector-tool',tool:'hole'});
  assert.deepEqual(commandFromKeyboard(key('x')), {type:'vector-tool',tool:'split'});
  assert.deepEqual(commandFromKeyboard(key('r')), {type:'vector-tool',tool:'reshape'});
  assert.deepEqual(commandFromKeyboard(key('t')), {type:'vector-tool',tool:'transform'});
});

test('history, delete and draft controls map consistently', () => {
  assert.deepEqual(commandFromKeyboard(key('z',{ctrlKey:true})), {type:'undo'});
  assert.deepEqual(commandFromKeyboard(key('z',{metaKey:true,shiftKey:true})), {type:'redo'});
  assert.deepEqual(commandFromKeyboard(key('y',{ctrlKey:true})), {type:'redo'});
  assert.deepEqual(commandFromKeyboard(key('Delete')), {type:'delete'});
  assert.deepEqual(commandFromKeyboard(key('Enter')), {type:'finish-draft'});
  assert.deepEqual(commandFromKeyboard(key('Escape')), {type:'escape'});
});

test('unmodified one-character keys can activate label shortcuts', () => {
  assert.deepEqual(commandFromKeyboard(key('1')), {type:'label-key',key:'1'});
  assert.equal(commandFromKeyboard(key('1',{ctrlKey:true})), null);
});

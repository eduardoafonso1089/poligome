import test from 'node:test';
import assert from 'node:assert/strict';
import { translateErrorCode } from '../app/lib/error-message.ts';

const copy={ rasterInvalidTiff:'TIFF inválido', toastExportFailed:'Falha localizada' };

test('domain error codes are translated and unknown internal messages fall back',()=>{
  assert.equal(translateErrorCode(new Error('rasterInvalidTiff'), copy, 'fallback'), 'TIFF inválido');
  assert.equal(translateErrorCode(new Error('someInternalCode'), copy, 'fallback'), 'fallback');
  assert.equal(translateErrorCode('bad', copy, 'fallback'), 'fallback');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPointToImage, screenPixelsToImageUnits } from '../app/editor/viewport/svg-image-space.ts';

function fakeSvg(rect){
  return {
    getScreenCTM(){ return null; },
    getBoundingClientRect(){ return rect; },
  };
}

test('client points map directly to source-image pixels regardless of rendered canvas size',()=>{
  const image={width:4032,height:3024};
  const small=fakeSvg({left:10,top:20,width:504,height:378});
  const large=fakeSvg({left:10,top:20,width:1008,height:756});

  assert.deepEqual(clientPointToImage(small,262,209,image),{x:2016,y:1512});
  assert.deepEqual(clientPointToImage(large,514,398,image),{x:2016,y:1512});
});

test('client points clamp to source-image bounds',()=>{
  const image={width:1920,height:1080};
  const svg=fakeSvg({left:100,top:50,width:960,height:540});
  assert.deepEqual(clientPointToImage(svg,-100,2000,image),{x:0,y:1080});
});

test('screen-sized handles are converted to image units without changing annotation geometry',()=>{
  const image={width:4000,height:3000};
  assert.equal(screenPixelsToImageUnits(20,image,1000),80);
  assert.equal(screenPixelsToImageUnits(20,image,2000),40);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCocoRle, polygonRle } from '../app/editor/import/coco-rle.ts';
import { cocoAnnotationToEditor, cocoGeometryTypes } from '../app/editor/import/coco-import.ts';
import { annotationToCoco } from '../app/editor/export/annotation-export.ts';

const context = { assetId:'image', sourceWidth:10, sourceHeight:8, labelId:'mask', geometryTypes:new Set(['polygon']), annotationId:(()=>{let id=0;return()=>String(++id)})() };
const rings = [[{x:1,y:1},{x:7,y:1},{x:7,y:7},{x:1,y:7}], [{x:3,y:3},{x:5,y:3},{x:5,y:5},{x:3,y:5}]];
const rle = polygonRle(rings,10,8);
function pixels(mask) { const out=[]; mask.counts.forEach((run,index)=>{for(let i=0;i<run;i++)out.push(index%2)}); return out; }

test('RLE with a hole imports as an editable polygon and exports the same pixels',()=>{
  assert.deepEqual(cocoGeometryTypes({segmentation:rle}),['polygon']);
  const annotations=cocoAnnotationToEditor({segmentation:rle},context);
  assert.equal(annotations.length,1); assert.equal(annotations[0].holes.length,1);
  const exported=annotationToCoco(annotations[0],0,[{id:'image',width:10,height:8}],[{id:'mask'}]);
  assert.deepEqual(pixels(exported.segmentation),pixels(rle));
  assert.equal(exported.area,32); assert.equal(exported.iscrowd,0);
});
test('disconnected masks retain separate editable components',()=>{
  const mask=polygonRle([rings[0],[{x:8,y:1},{x:10,y:1},{x:10,y:3},{x:8,y:3}]],10,8);
  assert.equal(cocoAnnotationToEditor({segmentation:mask},context).length,2);
});
test('compressed COCO differential counts decode without 32-bit truncation',()=>{
  // COCO maskApi encoding: signed five-bit groups and a two-run delta after index 2.
  const encode=(counts)=>counts.map((n,i)=>{
    let value=n-(i>2?counts[i-2]:0), out='';
    do {let byte=value&31; value=Math.floor(value/32); const more=(byte&16)?value!==-1:value!==0;if(more)byte|=32;out+=String.fromCharCode(byte+48);if(!more)break;}while(true);
    return out;
  }).join('');
  assert.deepEqual(parseCocoRle({size:rle.size,counts:encode(rle.counts)}),rle);
});
test('malformed and oversized RLE are rejected before allocation',()=>{
  for(const mask of [{size:[1e9,1e9],counts:[1]},{size:[8,10],counts:[1,2]},{size:[8,10],counts:[-1,81]},{size:[8,10],counts:'P'},{size:[8,10],counts:'!'}]) assert.equal(parseCocoRle(mask),null);
  assert.equal(cocoAnnotationToEditor({segmentation:{size:[1,1],counts:[0,1]}},context).length,0);
});
test('invalid boxes and null polygon coordinates are not offered for import',()=>{
  for(const bbox of [[0,0,-5,1],[0,0,1,0],[null,0,1,1]]) assert.deepEqual(cocoGeometryTypes({bbox}),[]);
  assert.deepEqual(cocoGeometryTypes({segmentation:[[0,null,1,0,1,1]]}),[]);
});
test('RLE contours scale to the loaded image while preserving holes',()=>{
  const [annotation]=cocoAnnotationToEditor({segmentation:rle},{...context,targetWidth:20,targetHeight:16});
  const exported=annotationToCoco(annotation,0,[{id:'image',width:20,height:16}],[{id:'mask'}]);
  assert.equal(exported.area,128); assert.equal(annotation.holes.length,1);
});

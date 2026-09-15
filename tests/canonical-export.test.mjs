import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationToCoco, annotationToGeoJsonGeometry, annotationToYolo, boxCorners } from '../app/editor/export/annotation-export.ts';

const labels=[{id:'weed',name:'Weed',color:'#00ff00',key:'1'}];
const asset={id:'img',name:'image.png',src:'',width:2000,height:1300};
const assets=[asset];

test('canonical polygon export preserves source-image pixels and normalizes only for YOLO',()=>{
  const polygon={
    id:'p',asset:'img',label:'weed',type:'polygon',holes:[],
    vertices:[
      {id:'p:v0',x:100,y:100},
      {id:'p:v1',x:300,y:100},
      {id:'p:v2',x:300,y:300},
    ],
  };
  const coco=annotationToCoco(polygon,0,assets,labels);
  assert.deepEqual(coco.segmentation[0],[100,100,300,100,300,300]);
  assert.equal(coco.area,20000);
  assert.equal(annotationToYolo(polygon,labels,asset),'0 0.050000 0.076923 0.150000 0.076923 0.150000 0.230769');
});

test('rotated box export derives corners from canonical width and height',()=>{
  const box={id:'b',asset:'img',label:'weed',type:'box',x:100,y:100,width:200,height:100,rotation:Math.PI/2};
  const corners=boxCorners(box);
  assert.equal(corners.length,4);
  const coco=annotationToCoco(box,0,assets,labels);
  assert.equal(coco.segmentation.length,1);
  assert.equal(coco.rotation,Math.PI/2);
});

test('canonical geojson geometry preserves vertex identity internally but exports coordinates only',()=>{
  const line={id:'l',asset:'img',label:'weed',type:'line',vertices:[{id:'a',x:10,y:20},{id:'b',x:30,y:40}]};
  assert.deepEqual(annotationToGeoJsonGeometry(line,(x,y)=>[x+1,y+2]),{
    type:'LineString',coordinates:[[11,22],[31,42]],
  });
});

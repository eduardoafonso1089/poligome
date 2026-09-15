import test from 'node:test';
import assert from 'node:assert/strict';
import { importCocoDocument } from '../app/editor/import/coco-document-import.ts';

function ids(){let value=0;return prefix=>`${prefix}-${++value}`;}

const assets=[
  {id:'img-a',name:'folder/photo-a.jpg',src:'',width:1000,height:650},
  {id:'img-b',name:'photo-b.png',src:'',width:2000,height:1300},
];

test('COCO document resolves image names and maps geometry to loaded image pixels',()=>{
  const result=importCocoDocument({
    images:[
      {id:1,file_name:'photo-a.jpg',width:1000,height:650},
      {id:2,file_name:'/remote/photo-b.png',width:1000,height:650},
    ],
    categories:[{id:5,name:'Weed'}],
    annotations:[
      {image_id:1,category_id:5,bbox:[100,65,200,130]},
      {image_id:2,category_id:5,segmentation:[[100,65,200,65,200,130]]},
    ],
  },assets,[],ids());
  assert.equal(result.imported,2);
  assert.equal(result.unmatched,0);
  assert.equal(result.labels.length,1);
  assert.equal(result.labels[0].name,'Weed');
  assert.equal(result.annotations[0].type,'box');
  assert.deepEqual(
    {x:result.annotations[0].x,y:result.annotations[0].y,width:result.annotations[0].width,height:result.annotations[0].height},
    {x:100,y:65,width:200,height:130},
  );
  assert.equal(result.annotations[1].type,'polygon');
  assert.deepEqual(result.annotations[1].vertices.map(({x,y})=>[x,y]),[[200,130],[400,130],[400,260]]);
});

test('COCO keypoint labels reuse an existing class and unmatched images are counted',()=>{
  const result=importCocoDocument({
    images:[{id:1,file_name:'photo-a.jpg',width:1000,height:650}],
    categories:[{id:2,name:'Ceph',keypoints:['Nasion']}],
    annotations:[
      {image_id:1,category_id:2,keypoints:[100,100,2]},
      {image_id:999,category_id:2,bbox:[0,0,10,10]},
    ],
  },assets,[{id:'existing-nasion',name:'Nasion',color:'#fff',key:''}],ids());
  assert.equal(result.imported,1);
  assert.equal(result.unmatched,1);
  assert.equal(result.annotations[0].label,'existing-nasion');
});

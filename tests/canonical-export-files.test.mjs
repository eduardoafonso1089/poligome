import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCocoDocument, buildGeoJson } from '../app/editor/export/export-files.ts';
import { geoReference } from '../app/lib/georeference.ts';

const labels=[{id:'weed',name:'Weed',color:'#00ff00',key:'1'}];

test('canonical COCO document exports source-image pixel geometry',()=>{
  const assets=[{id:'img',name:'image.png',src:'',width:2000,height:1300}];
  const annotations=[{id:'p',asset:'img',label:'weed',type:'point',x:250,y:325}];
  const document=buildCocoDocument(assets,labels,annotations);
  assert.equal(document.info.version,'1.0');
  assert.equal(document.images[0].file_name,'image.png');
  assert.deepEqual(document.annotations[0].keypoints,[250,325,2]);
  assert.equal(document.annotations[0].num_keypoints,1);
});

test('canonical GeoJSON maps source-image pixels through raster georeference',()=>{
  const geo=geoReference('source.tif',1000,650,{transform:[1,0,500000,0,-1,7600000],crs:'EPSG:31983'});
  const assets=[{id:'img',name:'crop.png',src:'',width:1000,height:650,geo}];
  const annotations=[{
    id:'p',asset:'img',label:'weed',type:'polygon',holes:[],
    vertices:[{id:'a',x:0,y:0},{id:'b',x:100,y:0},{id:'c',x:100,y:100}],
  }];
  const document=buildGeoJson(assets,labels,annotations);
  assert.equal(document.type,'FeatureCollection');
  assert.equal(document.features.length,1);
  const ring=document.features[0].geometry.coordinates[0];
  assert.equal(ring.length,4);
  assert.deepEqual(ring[0],ring.at(-1));
  assert.ok(ring.flat().every(Number.isFinite));
});

test('GeoJSON rejects annotations whose asset has no georeference',()=>{
  const assets=[{id:'img',name:'image.png',src:'',width:1000,height:650}];
  const annotations=[{id:'p',asset:'img',label:'weed',type:'point',x:1,y:1}];
  assert.throws(()=>buildGeoJson(assets,labels,annotations),/rasterMissingReference/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { savePoligomeProjectV4, openPoligomeProjectV4 } from '../app/lib/project.ts';
import { getCopy } from '../app/lib/i18n.ts';
import { normalizeAnnotationLabels, UNLABELED_ID } from '../app/editor/panels/panel-model.ts';

function installDownloadCapture() {
  const originalDocument=globalThis.document;
  const originalWindow=globalThis.window;
  const originalCreate=URL.createObjectURL;
  const originalRevoke=URL.revokeObjectURL;
  let saved;
  URL.createObjectURL=blob=>{saved=blob;return 'blob:fixture';};
  URL.revokeObjectURL=()=>{};
  globalThis.document={createElement:()=>({style:{},click(){},remove(){}}),body:{appendChild(){}}};
  globalThis.window={setTimeout:callback=>{callback();return 1;}};
  return {
    saved:()=>saved,
    restore(){
      globalThis.document=originalDocument;
      globalThis.window=originalWindow;
      URL.createObjectURL=originalCreate;
      URL.revokeObjectURL=originalRevoke;
    },
  };
}

test('project V4 persists source-image pixel annotations with stable ids', async () => {
  const capture=installDownloadCapture();
  const assets=[{id:'a',name:'image.png',src:'data:image/png;base64,iVBORw0KGgo=',local:true,width:4032,height:3024}];
  const labels=[{id:'weed',name:'Weed',color:'#00ff00',key:'1'}];
  const annotations=[{
    id:'p',asset:'a',label:'weed',type:'polygon',holes:[],
    vertices:[
      {id:'v-a',x:1010.5,y:820.25},
      {id:'v-b',x:2031.75,y:910.5},
      {id:'v-c',x:1850.25,y:2200.75},
    ],
  }];
  try {
    await savePoligomeProjectV4('V4',assets,labels,annotations,getCopy('en'));
    const zip=await JSZip.loadAsync(await capture.saved().arrayBuffer());
    assert.deepEqual(Object.keys(zip.files),['project.json']);
    const manifest=JSON.parse(await zip.file('project.json').async('string'));
    assert.equal(manifest.version,4);
    assert.equal(manifest.coordinate_space,'image-pixels');
    assert.equal('pts' in manifest.annotations[0],false);
    assert.deepEqual(manifest.annotations[0].vertices,annotations[0].vertices);
    assert.equal(manifest.assets[0].missing,true);
    assert.equal('bundled_path' in manifest.assets[0],false);
    assert.equal('source' in manifest.assets[0],false);

    const loaded=await openPoligomeProjectV4(await capture.saved().arrayBuffer(),getCopy('en'));
    assert.deepEqual(loaded.annotations[0].vertices,annotations[0].vertices);
    assert.equal(loaded.missingImages,1);
  } finally { capture.restore(); }
});

test('project V4 loader rejects V3 normalized manifests instead of migrating them', async () => {
  const zip=new JSZip();
  zip.file('project.json',JSON.stringify({
    format:'poligome-project',version:3,project_name:'Old',saved_at:new Date().toISOString(),
    assets:[{id:'a',name:'image.png',missing:true,width:1000,height:650}],
    labels:[{id:'weed',name:'Weed',color:'#00ff00',key:'1'}],
    annotations:[{id:'p',asset:'a',label:'weed',type:'polygon',holes:[],vertices:[{id:'a',x:10,y:20},{id:'b',x:30,y:40},{id:'c',x:50,y:60}]}],
  }));
  const bytes=await zip.generateAsync({type:'uint8array'});
  await assert.rejects(()=>openPoligomeProjectV4(bytes,getCopy('en')));
});

const qaAsset={id:'a',name:'image.png',src:'data:image/png;base64,eA==',local:true,width:320,height:240};
const samPolygon={id:'sam-mask',asset:'a',label:'',type:'polygon',holes:[],vertices:[{id:'v1',x:10,y:20},{id:'v2',x:100,y:20},{id:'v3',x:60,y:100}]};

test('a SAM mask accepted without a class and saved in a fresh project reopens intact', async () => {
  const capture=installDownloadCapture();
  try {
    const accepted=normalizeAnnotationLabels([], [samPolygon], getCopy('en').unlabeled);
    assert.equal(accepted.annotations[0].label,UNLABELED_ID);
    await savePoligomeProjectV4('SAM', [qaAsset], accepted.labels, accepted.annotations, getCopy('en'));
    const loaded=await openPoligomeProjectV4(await capture.saved().arrayBuffer(),getCopy('en'));
    assert.deepEqual(loaded.annotations,accepted.annotations);
    assert.equal(loaded.labels[0].id,UNLABELED_ID);
    assert.equal(loaded.recoveredAnnotations,0);
    assert.equal(samPolygon.label,'');
  } finally { capture.restore(); }
});

test('saving repairs orphaned references without modifying live annotations or losing geometry', async () => {
  const capture=installDownloadCapture();
  try {
    await savePoligomeProjectV4('Legacy SAM', [qaAsset], [], [samPolygon], getCopy('pt'));
    const loaded=await openPoligomeProjectV4(await capture.saved().arrayBuffer(),getCopy('pt'));
    assert.equal(loaded.annotations.length,1);
    assert.deepEqual(loaded.annotations[0].vertices,samPolygon.vertices);
    assert.equal(loaded.annotations[0].label,UNLABELED_ID);
    assert.equal(loaded.labels[0].name,getCopy('pt').unlabeled);
    assert.equal(samPolygon.label,'');
  } finally { capture.restore(); }
});

test('legacy projects recover empty and deleted SAM classes while preserving valid BYOM classes', async () => {
  for (const labels of [[],[{id:'byom-class',name:'Region',color:'#00ff00',key:'1'}]]) {
    const annotations=[samPolygon,{...samPolygon,id:'orphan-mask',label:'deleted-class'}];
    if(labels.length)annotations.push({...samPolygon,id:'byom-mask',label:'byom-class'});
    const zip=new JSZip();
    zip.file('project.json',JSON.stringify({format:'poligome-project',version:4,coordinate_space:'image-pixels',project_name:'Legacy',assets:[{...qaAsset,missing:true}],labels,annotations}));
    const loaded=await openPoligomeProjectV4(await zip.generateAsync({type:'uint8array'}),getCopy('en'));
    assert.equal(loaded.annotations.length,annotations.length);
    assert.equal(loaded.recoveredAnnotations,2);
    assert.deepEqual(loaded.annotations.slice(0,2).map(a=>a.label),[UNLABELED_ID,UNLABELED_ID]);
    assert.deepEqual(loaded.annotations.map(a=>a.vertices),annotations.map(a=>a.vertices));
    if(labels.length)assert.equal(loaded.annotations[2].label,'byom-class');
    assert.ok(loaded.labels.some(l=>l.id===UNLABELED_ID));
  }
});

test('an image-only project without classes can be saved and reopened', async () => {
  const capture=installDownloadCapture();
  try {
    await savePoligomeProjectV4('Images', [qaAsset], [], [], getCopy('en'));
    const loaded=await openPoligomeProjectV4(await capture.saved().arrayBuffer(),getCopy('en'));
    assert.equal(loaded.assets.length,1);
    assert.equal(loaded.annotations.length,0);
    assert.equal(loaded.recoveredAnnotations,0);
  } finally { capture.restore(); }
});

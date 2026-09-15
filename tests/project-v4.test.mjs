import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { savePoligomeProjectV4, openPoligomeProjectV4 } from '../app/lib/project.ts';
import { getCopy } from '../app/lib/i18n.ts';

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
  const assets=[{id:'a',name:'image.png',src:'',missing:true,width:4032,height:3024}];
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
    await savePoligomeProjectV4('V4',assets,labels,annotations,'annotations',getCopy('en'));
    const zip=await JSZip.loadAsync(await capture.saved().arrayBuffer());
    const manifest=JSON.parse(await zip.file('project.json').async('string'));
    assert.equal(manifest.version,4);
    assert.equal(manifest.coordinate_space,'image-pixels');
    assert.equal('pts' in manifest.annotations[0],false);
    assert.deepEqual(manifest.annotations[0].vertices,annotations[0].vertices);

    const loaded=await openPoligomeProjectV4(await capture.saved().arrayBuffer(),getCopy('en'));
    assert.deepEqual(loaded.annotations[0].vertices,annotations[0].vertices);
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

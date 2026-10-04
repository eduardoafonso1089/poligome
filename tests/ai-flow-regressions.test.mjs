import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEventStream,runtimeInfer,fetchRuntimeHealth,fetchRuntimeManifest} from '../app/lib/runtime-client.ts';
import {sameGeometry,reconcileDrafts,toEditorAnnotations} from '../app/lib/runtime-annotations.ts';
import {createPolygon} from '../app/editor/models/annotation-factory.ts';
import {polygonRle} from '../app/editor/import/coco-rle.ts';
import {fetchByomModels} from '../app/lib/sam-connector.ts';

const final={type:'result',annotations:[],partial:false};
const stream=(...chunks)=>new ReadableStream({start(c){for(const bytes of chunks)c.enqueue(typeof bytes==='string'?new TextEncoder().encode(bytes):bytes);c.close()}});
async function collect(input,signal){const out=[];for await(const event of parseEventStream(input,signal))out.push(event);return out}
for(const ending of ['\n','\r\n','\r'])test(`SSE accepts ${JSON.stringify(ending)} and data without a space`,async()=>{
 const text=`data:${JSON.stringify(final)}${ending}${ending}`;
 assert.deepEqual(await collect(stream(...Array.from(text))),[final]);
});
test('SSE combines multiline JSON and ignores comments',async()=>{
 assert.deepEqual(await collect(stream(': heartbeat\r\ndata: {"type":"result",\r\ndata: "annotations":[],"partial":false}\r\n\r\n')),[final]);
});
test('SSE retains UTF-8 labels split between bytes',async()=>{
 const event={...final,annotations:[{kind:'keypoint',at:{x:1,y:2},label:'Árvore 🌳'}]};
 const bytes=new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
 assert.deepEqual(await collect(stream(...Array.from(bytes,b=>new Uint8Array([b])))),[event]);
});
test('canceling while waiting for a chunk releases the stream',async()=>{
 const controller=new AbortController();let canceled=false;
 const pending=collect(new ReadableStream({cancel(){canceled=true}}),controller.signal);
 controller.abort();assert.deepEqual(await pending,[]);assert.equal(canceled,true);
});
test('leaving a streaming iterator early cancels the reader',async()=>{
 let canceled=false;const source=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(`data:${JSON.stringify(final)}\n\n`))},cancel(){canceled=true}});
 for await(const event of parseEventStream(source)){assert.equal(event.type,'result');break}
 assert.equal(canceled,true);
});
test('runtime reports an interrupted response instead of accepting partial drafts',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(stream('data:{"type":"result","annotations":[],"partial":true}\n\n')));
 await assert.rejects(async()=>{for await(const event of runtimeInfer({endpoint:'http://localhost:7861',imageId:'image'}))void event},{code:'incomplete_stream'});
});
test('runtime accepts a completed empty result',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(stream(`data:${JSON.stringify(final)}\r\n\r\n`)));
 const out=[];for await(const event of runtimeInfer({endpoint:'http://localhost:7861',imageId:'image'}))out.push(event);
 assert.deepEqual(out,[final]);
});
test('runtime preserves model errors and HTTP error detail',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(stream('data:{"type":"error","error":{"code":"unsupported_prompt","message":"ROI unsupported"}}\n\n')));
 await assert.rejects(async()=>{for await(const event of runtimeInfer({endpoint:'http://localhost:7861',imageId:'image'}))void event},{code:'unsupported_prompt',message:'ROI unsupported'});
});
test('unhealthy and incompatible services are not announced as ready',async(t)=>{
 for(const body of [{service:'poligome-runtime',protocol:'1.0',status:'error'},{service:'other',protocol:'1.0',status:'ready'},{service:'poligome-runtime',protocol:'2.0',status:'ready'}]){
 t.mock.method(globalThis,'fetch',async()=>Response.json(body));assert.equal(await fetchRuntimeHealth('http://localhost:7861'),null);t.mock.restoreAll();
 }
 t.mock.method(globalThis,'fetch',async()=>Response.json({service:'poligome-runtime',protocol:'1.0',status:'ready'}));
 assert.equal((await fetchRuntimeHealth('http://localhost:7861')).status,'ready');
});
test('invalid manifests are rejected before rendering model controls',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({protocol:'1.0',id:'x'}));
 assert.equal(await fetchRuntimeManifest('http://localhost:7861'),null);
});
test('malformed BYOM catalog does not crash the AI hub',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:{bad:true}}));assert.deepEqual(await fetchByomModels('http://localhost:7860'),[]);
});
test('adding or changing a hole protects a draft from replacement',()=>{
 const original=createPolygon({id:'a',asset:'i',label:'u'},[[0,0],[10,0],[10,10],[0,10]]);
 const edited={...original,holes:[[{id:'h1',x:2,y:2},{id:'h2',x:4,y:2},{id:'h3',x:4,y:4}]]};
 assert.equal(sameGeometry(original,edited),false);
 assert.deepEqual(reconcileDrafts(new Map([['a',original]]),[edited]),{discard:[],keptOriginals:[original]});
 assert.equal(sameGeometry(edited,{...edited,holes:[edited.holes[0].map(v=>({...v,x:v.x+1}))]}),false);
});
test('runtime mask preserves disconnected components and holes in scaled coordinates',()=>{
 const width=12,height=12,pixels=new Uint8Array(width*height);
 for(let y=1;y<8;y++)for(let x=1;x<8;x++)if(!(x>=3&&x<5&&y>=3&&y<5))pixels[y*width+x]=1;
 for(let y=9;y<11;y++)for(let x=9;x<11;x++)pixels[y*width+x]=1;
 let bit=0,rle=[0];for(const value of pixels){if(bit!==value){rle.push(0);bit=value}rle[rle.length-1]++}
 let id=0;const shapes=toEditorAnnotations([{kind:'mask',mask:{width,height,rle,bounds:{x:0,y:0,width,height}}}],{asset:'i',fallbackLabelId:'u',makeId:()=>String(++id)});
 assert.equal(shapes.length,2);assert.equal(shapes.reduce((n,p)=>n+p.holes.length,0),1);
 const merged=new Uint8Array(width*height);
 for(const p of shapes){const mask=polygonRle([p.vertices,...p.holes],width,height);let cursor=0;mask.counts.forEach((run,index)=>{for(let i=0;i<run;i++,cursor++)if(index%2)merged[(cursor%height)*width+Math.floor(cursor/height)]=1})}
 assert.deepEqual(merged,pixels);
});

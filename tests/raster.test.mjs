import assert from 'node:assert/strict';
import test from 'node:test';
import { tiffFile, installFileReader, pyramidFile } from './helpers/raster-fixtures.mjs';
import { assinaturaTiff, clipWindow, dimensionaRecorte, leMetadados, prepareDisplay, readRgba, primeirosBytes, referenceFromImage, nivelPara, checkReadBudget, geraRecorte } from '../app/lib/cog.ts';
import { parseWorldFile, readRasterSidecars } from '../app/lib/georeference.ts';
const restoreReader = installFileReader();
test.after(restoreReader);

async function withRaster(file, fn, reference) {
  const meta = await leMetadados(file, reference);
  try { await prepareDisplay(meta); await fn(meta); } finally { meta.close(); }
}

test('recognizes both byte orders and BigTIFF; rejects other headers', () => {
  for (const bytes of [[73,73,42,0],[77,77,0,42]]) assert.equal(assinaturaTiff(new Uint8Array(bytes)), 'TIFF');
  for (const bytes of [[73,73,43,0],[77,77,0,43]]) assert.equal(assinaturaTiff(new Uint8Array(bytes)), 'BigTIFF');
  assert.equal(assinaturaTiff(new Uint8Array([1,2,3,4])), null);
});

test('plain TIFF decodes without inventing a georeference', async () => {
  await withRaster(tiffFile(new Uint8Array([0,64,128,255]), {}, [33550,33922,34735]), async meta => {
    assert.equal(meta.transform, undefined);
    assert.equal(meta.crs, 'sem CRS');
    assert.deepEqual([...await readRgba(meta, {x:0,y:0,w:2,h:2},2,2)], [0,0,0,255,64,64,64,255,128,128,128,255,255,255,255,255]);
  });
});

test('over-budget crops split reads without changing pixel centres or RGBA values', async () => {
  let bytesPerPixel = 1;
  const reads = [];
  const image = {
    getWidth: () => 9, getHeight: () => 7,
    getTileWidth: () => 1, getTileHeight: () => 1,
    getBytesPerPixel: () => bytesPerPixel,
    getSamplesPerPixel: () => 1,
    getFileDirectory: () => ({ getValue: name => ({ PhotometricInterpretation: 1, BitsPerSample: [8] })[name] }),
    readRasters: async ({ window }) => {
      checkReadBudget(image, window);
      reads.push(window);
      const values = [];
      for (let y = window[1]; y < window[3]; y++) for (let x = window[0]; x < window[2]; x++) values.push(y * 9 + x);
      return Uint8Array.from(values);
    },
  };
  const meta = { tiff: { getImage: async () => image }, niveis: [0], masks: [], largura: 9, altura: 7, bandas: 1,
    semDado: 0, signal: new AbortController().signal };
  for (const [window, width, height] of [[{ x: 0, y: 0, w: 9, h: 7 }, 9, 7], [{ x: .25, y: .5, w: 8.5, h: 6 }, 5, 3]]) {
    bytesPerPixel = 1;
    const expected = await readRgba(meta, window, width, height);
    bytesPerPixel = 4 * 1024 * 1024;
    reads.length = 0;
    assert.deepEqual(await readRgba(meta, window, width, height), expected);
    assert.ok(reads.length > 1);
  }
  bytesPerPixel = 128 * 1024 * 1024;
  await assert.rejects(readRgba(meta, { x: 0, y: 0, w: 1, h: 1 }, 1, 1), /rasterReadTooLarge/);
});

test('reads nonzero tiepoint offsets, signed scales and EPSG from a real TIFF', async () => {
  await withRaster(tiffFile(new Uint8Array([10,20,30,40]), { ModelPixelScale:[2,3,0], ModelTiepoint:[5,7,0,100,200,0], ProjectedCSTypeGeoKey:31983 }), meta => {
    assert.deepEqual(meta.transform, [2,0,90,0,-3,221]);
    assert.equal(meta.crs, 'EPSG:31983');
  });
});

test('model matrix rotation and PixelIsPoint use pixel edges', () => {
  const image = { getGeoKeys: () => ({GTRasterTypeGeoKey:2}), getFileDirectory: () => ({getValue: name => name === 'ModelTransformation' ? [2,1,0,100,3,-4,0,200,0,0,1,0,0,0,0,1] : undefined}) };
  assert.deepEqual(referenceFromImage(image).transform, [2,1,98.5,3,-4,200.5]);
});

test('normalizes 16-bit RGB rather than clipping to white', async () => {
  const data = new Uint16Array([1000,2000,3000, 2000,4000,6000, 3000,6000,9000, 4000,8000,12000]);
  await withRaster(tiffFile(data, {SamplesPerPixel:3, BitsPerSample:[16,16,16], PhotometricInterpretation:2}), async meta => {
    const rgba = await readRgba(meta,{x:0,y:0,w:2,h:2},2,2);
    assert.deepEqual([...rgba.slice(4,8)], [85,85,85,255]);
  });
});

test('NoData and RGBA alpha remain transparent', async () => {
  await withRaster(tiffFile(new Uint8Array([0,10,20,30]), {GDAL_NODATA:'0\0'}), async meta => {
    assert.equal((await readRgba(meta,{x:0,y:0,w:2,h:2},2,2))[3], 0);
  });
  await withRaster(tiffFile(new Uint8Array([10,20,30,0, 40,50,60,128, 70,80,90,255, 10,20,30,255]), {SamplesPerPixel:4,BitsPerSample:[8,8,8,8],PhotometricInterpretation:2,ExtraSamples:[2]}), async meta => {
    const rgba = await readRgba(meta,{x:0,y:0,w:2,h:2},2,2);
    assert.equal(rgba[3],0); assert.equal(rgba[7],128);
  });
});

test('world files handle rotation, CRLF, BOM and pixel-centre convention', () => {
  assert.deepEqual(parseWorldFile('\uFEFF2\r\n3\r\n1\r\n-4\r\n100\r\n200'), [2,1,98.5,3,-4,200.5]);
  assert.throws(() => parseWorldFile('0 0 0 0 1 2'), /rasterInvalidReference/);
  assert.throws(() => parseWorldFile('2 0 0 -2 NaN 1'), /rasterInvalidReference/);
});

test('sidecars match the exact image stem case-insensitively and plain TIFF uses them', async () => {
  const file = new File([await tiffFile(new Uint8Array([1,2,3,4]), {}, [33550,33922,34735]).arrayBuffer()], 'Survey.TIF');
  const reference = await readRasterSidecars(file,[new File(['2\n0\n0\n-2\n101\n199'],'survey.TFW'),new File(['EPSG:31983'],'Survey.PRJ'),new File(['bad'],'other.tfw')]);
  assert.deepEqual(reference.transform,[2,0,100,0,-2,200]);
  await withRaster(file, meta => { assert.deepEqual(meta.transform,reference.transform); assert.equal(meta.crs,'EPSG:31983'); }, reference);
});

test('crop dimensions and windows reject nonfinite/empty input and respect both caps', () => {
  assert.throws(() => dimensionaRecorte(NaN,10));
  assert.throws(() => dimensionaRecorte(0,10));
  const size = dimensionaRecorte(100000,100000);
  assert.ok(size.largura <= 4096 && size.largura * size.altura <= 12e6);
  assert.deepEqual(clipWindow({x:-10,y:2,w:15,h:100},20,20),{x:0,y:2,w:5,h:18});
  assert.throws(() => clipWindow({x:21,y:2,w:5,h:5},20,20));
});

test('overview selection respects both axes and read budget counts whole strips', async () => {
  const images = [{getWidth:()=>100,getHeight:()=>80},{getWidth:()=>25,getHeight:()=>20},{getWidth:()=>50,getHeight:()=>40}];
  const meta = {largura:100,altura:80,niveis:[0,1,2],tiff:{getImage:async i=>images[i]}};
  assert.equal((await nivelPara(meta,3,3)).image,images[2]);
  assert.equal((await nivelPara(meta,4,2)).image,images[2]);
  assert.throws(() => checkReadBudget({getTileWidth:()=>100000,getTileHeight:()=>1000,getBytesPerPixel:()=>4,getSamplesPerPixel:()=>4},[0,0,1,1]), /rasterReadTooLarge/);
});

test('rejects servers ignoring Range without consuming their body', async () => {
  const original = globalThis.fetch; let cancelled = false;
  globalThis.fetch = async () => ({status:200,body:{cancel:async()=>{cancelled=true;}},arrayBuffer:()=>{throw new Error('whole file read');}});
  try { await assert.rejects(primeirosBytes('https://example.test/raster.tif'), /rasterRangeRequired/); assert.ok(cancelled); }
  finally { globalThis.fetch = original; }
});

test('cancelled sessions reject further reads', async () => {
  const meta = await leMetadados(tiffFile(new Uint8Array([1,2,3,4])));
  meta.close();
  await assert.rejects(readRgba(meta,{x:0,y:0,w:2,h:2},2,2), /abort/i);
});

test('crop generation reuses the open reader and preserves its source window', async () => {
  const originalDocument = globalThis.document, originalImageData = globalThis.ImageData;
  globalThis.ImageData = class { constructor(data) { this.data=data; } };
  globalThis.document = {createElement:()=>({getContext:()=>({putImageData(){}}),toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))})};
  try {
    await withRaster(tiffFile(new Uint8Array([1,2,3,4])), async meta => {
      const crop = await geraRecorte(meta,'survey.tif',{x:1,y:0,w:1,h:2});
      assert.deepEqual(crop.geo.window,{x:1,y:0,w:1,h:2});
      assert.equal(crop.geo.cropWidth,1); assert.equal(crop.geo.cropHeight,2);
    });
  } finally { globalThis.document=originalDocument; globalThis.ImageData=originalImageData; }
});


test('real pyramid skips unrelated pages and applies internal transparency masks', async () => {
  await withRaster(pyramidFile(), async meta => {
    assert.deepEqual(meta.niveis,[0,3]); assert.deepEqual(meta.masks,[1,2]);
    const rgba = await readRgba(meta,{x:0,y:0,w:8,h:8},4,4);
    assert.equal(rgba[3],0); assert.deepEqual([...rgba.slice(4,8)],[100,100,100,255]);
    // Unaligned origin remains in source coordinates; nearest pixel centre chooses column 1.
    const crop = await readRgba(meta,{x:1,y:1,w:6,h:6},3,3);
    assert.deepEqual([...crop.slice(0,4)],[100,100,100,255]);
  });
});

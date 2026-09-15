import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDemoProject } from "../app/lib/demo.ts";

test("canonical aerial demo uses source-image pixel geometry", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Blob(["demo-image"], { type: "image/jpeg" }), { status: 200 });

  try {
    const demo = await createCanonicalDemoProject("pt");
    assert.equal(demo.annotations.length, 18);
    assert.equal(demo.assets[0].width,1200);
    assert.equal(demo.assets[0].height,780);

    const a1=demo.annotations.find((item)=>item.id==="demo-a1");
    assert.equal(a1?.type,'polygon');
    assert.ok(Math.abs(a1.vertices.at(-1).x - 111.45246880007056*1.2) < 1e-9);
    assert.ok(Math.abs(a1.vertices.at(-1).y - 303.83214980324755*1.2) < 1e-9);

    const b4=demo.annotations.find((item)=>item.id==="demo-b4");
    assert.equal(b4?.type,'box');
    assert.equal(b4.rotation,0.4132347145292916);
    assert.ok(Math.abs(b4.x - 387.2961237119464*1.2) < 1e-9);

    const c6=demo.annotations.find((item)=>item.id==="demo-c6");
    assert.equal(c6?.type,'line');
    assert.ok(Math.abs(c6.vertices[0].x - 2.3225389172264768*1.2) < 1e-9);
    assert.ok(Math.abs(c6.vertices[0].y - 286.89786964584556*1.2) < 1e-9);

    demo.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

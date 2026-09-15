/**
 * Component layer: what the annotation layers actually render.
 *
 * Replaces the source-text assertions in the old editor-layers and
 * basic-annotation-layers suites. Those checked that a file contained
 * `data-annotation-id={annotation.id}`; these check that the element comes out
 * of the renderer carrying the id, which is the thing the rest of the editor
 * and the Playwright audits depend on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, handlers, attributeValues, uniqueAttributeValues, text, countAttribute } from "./helpers/render.mjs";
import { LAYER_HANDLER_NAMES, layerProps, polygon, box, line, point } from "./helpers/editor-fixtures.mjs";
import { PolygonLayer } from "../app/editor/layers/polygon-layer.tsx";
import { PolylineLayer } from "../app/editor/layers/polyline-layer.tsx";
import { BoxLayer } from "../app/editor/layers/box-layer.tsx";
import { PointLayer } from "../app/editor/layers/point-layer.tsx";
import { AnnotationLayer } from "../app/editor/layers/annotation-layer.tsx";
import { VertexHandles } from "../app/editor/layers/vertex-handles.tsx";

const layerHandlers = handlers(LAYER_HANDLER_NAMES);

test("every annotation type renders an element tagged with its own id", () => {
  const cases = [
    [PolygonLayer, polygon()],
    [PolylineLayer, line()],
    [BoxLayer, box()],
    [PointLayer, point()],
  ];
  for (const [Component, annotation] of cases) {
    const markup = render(Component, { ...layerProps(), ...layerHandlers, annotation });
    assert.deepEqual(
      attributeValues(markup, "data-annotation-id"),
      [annotation.id],
      `${annotation.type} lost its data-annotation-id`,
    );
  }
});

test("polygon geometry reaches the path as canonical source-image pixels", () => {
  const markup = render(PolygonLayer, { ...layerProps(), ...layerHandlers, annotation: polygon() });
  const [path] = attributeValues(markup, "d");
  assert.equal(path, "M 10 10 L 200 10 L 200 160 L 10 160 Z");
});

test("polygon holes render as extra rings under the even-odd fill rule", () => {
  const withHole = polygon({
    holes: [[{ id: "h0", x: 60, y: 60 }, { id: "h1", x: 120, y: 60 }, { id: "h2", x: 120, y: 120 }]],
  });
  const markup = render(PolygonLayer, { ...layerProps(), ...layerHandlers, annotation: withHole });
  const [path] = attributeValues(markup, "d");
  assert.match(path, /^M 10 10 .* Z M 60 60 L 120 60 L 120 120 Z$/);
  assert.equal(countAttribute(markup, "fill-rule", "evenodd"), 1);
});

test("a polyline stays open while a polygon closes", () => {
  const polyMarkup = render(PolygonLayer, { ...layerProps(), ...layerHandlers, annotation: polygon() });
  const lineMarkup = render(PolylineLayer, { ...layerProps(), ...layerHandlers, annotation: line() });
  // A closed ring ends in Z; the polyline is drawn as points, with no closing command.
  assert.match(attributeValues(polyMarkup, "d")[0], /Z$/);
  assert.equal(attributeValues(lineMarkup, "d").length, 0);
  assert.deepEqual(uniqueAttributeValues(lineMarkup, "points"), ["0,0 90,40 180,0"]);
});

test("vertex handles only appear for the primary selection under the select tool", () => {
  const base = { ...layerProps(), ...layerHandlers, annotation: polygon() };
  const hidden = render(PolygonLayer, base);
  const shown = render(PolygonLayer, { ...base, selected: true, primarySelected: true });
  const otherTool = render(PolygonLayer, { ...base, selected: true, primarySelected: true, tool: "box" });

  assert.equal(attributeValues(hidden, "data-vertex-id").length, 0);
  assert.deepEqual(uniqueAttributeValues(shown, "data-vertex-id"), ["v0", "v1", "v2", "v3"]);
  assert.equal(attributeValues(otherTool, "data-vertex-id").length, 0);
});

test("handles address vertices by stable id, never by position", () => {
  const markup = render(VertexHandles, {
    ...layerHandlers,
    annotationId: "poly",
    vertices: polygon().vertices,
    selectedVertex: null,
    touchMode: false,
    touchRadius: 20,
    markerRadius: 5,
    markerAspect: 1,
    color: "#44c995",
  });
  assert.deepEqual(uniqueAttributeValues(markup, "data-vertex-id"), ["v0", "v1", "v2", "v3"]);
  // Edge handles name the vertex they follow, so insertion survives reordering.
  assert.deepEqual(uniqueAttributeValues(markup, "data-edge-after-vertex-id"), ["v0", "v1", "v2", "v3"]);
});

test("the selected vertex is the only one marked selected", () => {
  const markup = render(VertexHandles, {
    ...layerHandlers,
    annotationId: "poly",
    vertices: polygon().vertices,
    selectedVertex: { annotationId: "poly", vertexId: "v2" },
    touchMode: false,
    touchRadius: 20,
    markerRadius: 5,
    markerAspect: 1,
    color: "#44c995",
  });
  const selected = [...markup.matchAll(/<ellipse class="vertex-handle selected"[^>]*data-vertex-id="([^"]*)"/g)];
  assert.deepEqual(selected.map((match) => match[1]), ["v2"]);
});

test("touch mode adds a larger hit target without adding a second visible handle", () => {
  const props = {
    ...layerHandlers,
    annotationId: "poly",
    vertices: polygon().vertices,
    selectedVertex: null,
    touchRadius: 22,
    markerRadius: 5,
    markerAspect: 1,
    color: "#44c995",
  };
  const mouse = render(VertexHandles, { ...props, touchMode: false });
  const touch = render(VertexHandles, { ...props, touchMode: true });
  assert.equal(countAttribute(mouse, "class", "touch-handle-hit"), 0);
  assert.ok(countAttribute(touch, "class", "touch-handle-hit") > 0);
  assert.equal(
    countAttribute(mouse, "class", "vertex-handle"),
    countAttribute(touch, "class", "vertex-handle"),
    "touch mode must not duplicate the visible handle",
  );
});

test("selection thickens the stroke instead of redrawing the shape", () => {
  const base = { ...layerProps(), ...layerHandlers, annotation: polygon(), lineThickness: 3 };
  const plain = render(PolygonLayer, base);
  const selected = render(PolygonLayer, { ...base, selected: true });
  assert.equal(attributeValues(plain, "stroke-width")[0], "3");
  assert.equal(attributeValues(selected, "stroke-width")[0], "5");
  assert.equal(attributeValues(plain, "d")[0], attributeValues(selected, "d")[0]);
});

test("the class colour reaches both fill and stroke", () => {
  const markup = render(PolygonLayer, { ...layerProps(), ...layerHandlers, annotation: polygon(), color: "#ff8a65" });
  assert.equal(attributeValues(markup, "fill")[0], "#ff8a6530");
  assert.equal(attributeValues(markup, "stroke")[0], "#ff8a65");
});

test("AnnotationLayer routes each annotation type to its own layer", () => {
  const cases = [
    [polygon(), /fill-rule="evenodd"/],
    [line(), /<polyline[^>]*points="0,0 90,40 180,0"/],
    [box(), /<rect[^>]*width="120"[^>]*height="80"/],
    [point(), /<ellipse[^>]*cx="70"[^>]*cy="90"/],
  ];
  for (const [annotation, expected] of cases) {
    const markup = render(AnnotationLayer, { ...layerProps(), ...layerHandlers, annotation });
    assert.match(markup, expected, `${annotation.type} did not reach its layer`);
  }
});

test("layers stop receiving pointer events when the tool is not select", () => {
  const base = { ...layerProps(), ...layerHandlers, annotation: polygon() };
  assert.doesNotMatch(render(PolygonLayer, base), /pointer-events="none"/);
  assert.match(render(PolygonLayer, { ...base, tool: "box" }), /pointer-events="none"/);
});

test("a rotated box is drawn rotated around its own centre", () => {
  const angleOf = (markup) => {
    const match = markup.match(/rotate\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)/);
    assert.ok(match, "box layer should carry a rotate transform");
    return { angle: Number(match[1]), cx: Number(match[2]), cy: Number(match[3]) };
  };
  const upright = angleOf(render(BoxLayer, { ...layerProps(), ...layerHandlers, annotation: box() }));
  const rotated = angleOf(render(BoxLayer, { ...layerProps(), ...layerHandlers, annotation: box({ rotation: Math.PI / 6 }) }));

  assert.equal(upright.angle, 0);
  assert.ok(Math.abs(rotated.angle - 30) < 1e-6, `angle=${rotated.angle}`);
  // A 120x80 box at (40,50) has its centre at (100,90); both must pivot there.
  assert.deepEqual([upright.cx, upright.cy], [100, 90]);
  assert.deepEqual([rotated.cx, rotated.cy], [100, 90]);
  // Rotation is a transform, never a rewrite of the stored geometry.
  const markup = render(BoxLayer, { ...layerProps(), ...layerHandlers, annotation: box({ rotation: Math.PI / 6 }) });
  assert.equal(attributeValues(markup, "x")[0], "40");
  assert.equal(attributeValues(markup, "y")[0], "50");
});

test("layers render no interactive text of their own", () => {
  for (const [Component, annotation] of [[PolygonLayer, polygon()], [PolylineLayer, line()]]) {
    const markup = render(Component, { ...layerProps(), ...layerHandlers, annotation });
    assert.equal(text(markup), "", `${annotation.type} layer should stay purely geometric`);
  }
});

"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { edgeMidpoints } from "../geometry/annotation-geometry";
import type { Vertex } from "../models/vertex-model";

export type SelectedVertex = { annotationId: string; vertexId: string } | null;
type Direction = { x: number; y: number };

function unit(vector: Direction): Direction | null {
  const length = Math.hypot(vector.x, vector.y);
  return length ? { x: vector.x / length, y: vector.y / length } : null;
}

function number(value: number) {
  return Number(value.toFixed(2));
}

function arrowPath(direction: Direction) {
  const center = 16;
  const tip = { x: center + direction.x * 11, y: center + direction.y * 11 };
  const base = { x: tip.x - direction.x * 4, y: tip.y - direction.y * 4 };
  const side = { x: -direction.y * 3, y: direction.x * 3 };
  return `M${center} ${center}L${number(tip.x)} ${number(tip.y)}M${number(tip.x)} ${number(tip.y)}L${number(base.x + side.x)} ${number(base.y + side.y)}M${number(tip.x)} ${number(tip.y)}L${number(base.x - side.x)} ${number(base.y - side.y)}`;
}

function cursorSvg(directions: Direction[]) {
  const path = directions.map(arrowPath).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="${path}" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, move`;
}

/**
 * Uses both neighboring segments. A straight run yields its normal; a corner
 * yields the line that bisects the angle between its two rays.
 */
export function vertexCursorDirections(vertices: Vertex[], index: number, open = false): Direction[] {
  const vertex = vertices[index];
  if (!vertex) return [{ x: 0, y: -1 }, { x: 0, y: 1 }];
  const previous = index > 0 ? vertices[index - 1] : open ? undefined : vertices.at(-1);
  const next = index < vertices.length - 1 ? vertices[index + 1] : open ? undefined : vertices[0];

  if (previous && next) {
    const incoming = { x: vertex.x - previous.x, y: vertex.y - previous.y };
    const outgoing = { x: next.x - vertex.x, y: next.y - vertex.y };
    const cross = Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x);
    const scale = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    const towardPrevious = unit({ x: previous.x - vertex.x, y: previous.y - vertex.y });
    const towardNext = unit({ x: next.x - vertex.x, y: next.y - vertex.y });
    if (towardPrevious && towardNext && scale > 0 && cross / scale > 0.01) {
      const bisector = unit({ x: towardPrevious.x + towardNext.x, y: towardPrevious.y + towardNext.y });
      return bisector
        ? [bisector, { x: -bisector.x, y: -bisector.y }]
        : [{ x: -incoming.y, y: incoming.x }, { x: incoming.y, y: -incoming.x }].map(unit).filter((item): item is Direction => item !== null);
    }
    const tangent = unit({ x: next.x - previous.x, y: next.y - previous.y });
    return tangent ? [{ x: -tangent.y, y: tangent.x }, { x: tangent.y, y: -tangent.x }] : [];
  }

  const segment = next
    ? unit({ x: next.x - vertex.x, y: next.y - vertex.y })
    : previous ? unit({ x: vertex.x - previous.x, y: vertex.y - previous.y }) : null;
  return segment ? [{ x: -segment.y, y: segment.x }, { x: segment.y, y: -segment.x }] : [];
}

export function vertexMoveCursor(vertices: Vertex[], index: number, open = false) {
  return cursorSvg(vertexCursorDirections(vertices, index, open));
}

export type VertexHandlesProps = {
  annotationId: string;
  vertices: Vertex[];
  open?: boolean;
  selectedVertex: SelectedVertex;
  touchMode: boolean;
  touchRadius: number;
  markerRadius: number;
  markerAspect: number;
  color: string;
  onBeginVertexDrag: (event: ReactPointerEvent<SVGElement>, vertexId: string) => void;
  onMoveVertex: (event: ReactPointerEvent<SVGElement>) => void;
  onFinishVertex: (event: ReactPointerEvent<SVGElement>) => void;
  onCancel: () => void;
  onInsertVertex: (event: ReactPointerEvent<SVGElement>, afterVertexId: string, x: number, y: number) => void;
};

/** Rendering-only vertex controls shared by polygons and polylines. */
export function VertexHandles({
  annotationId,
  vertices,
  open = false,
  selectedVertex,
  touchMode,
  touchRadius,
  markerRadius,
  markerAspect,
  color,
  onBeginVertexDrag,
  onMoveVertex,
  onFinishVertex,
  onCancel,
  onInsertVertex,
}: VertexHandlesProps) {
  const midpoints = edgeMidpoints(vertices, open);

  return <>
    {midpoints.map((midpoint) => <g key={`${annotationId}:${midpoint.afterVertexId}`}>
      {touchMode && <ellipse
        className="touch-handle-hit"
        style={{ cursor: "copy" }}
        data-edge-after-vertex-id={midpoint.afterVertexId}
        onPointerDown={(event) => onInsertVertex(event, midpoint.afterVertexId, midpoint.x, midpoint.y)}
        onPointerMove={onMoveVertex}
        onPointerUp={onFinishVertex}
        onPointerCancel={onCancel}
        cx={midpoint.x}
        cy={midpoint.y}
        rx={touchRadius}
        ry={touchRadius * markerAspect}
        strokeWidth={0}
        fill="transparent"
      />}
      <ellipse
        className="edge-handle"
        style={{ cursor: "copy" }}
        data-edge-after-vertex-id={midpoint.afterVertexId}
        onPointerDown={(event) => onInsertVertex(event, midpoint.afterVertexId, midpoint.x, midpoint.y)}
        onPointerMove={onMoveVertex}
        onPointerUp={onFinishVertex}
        onPointerCancel={onCancel}
        cx={midpoint.x}
        cy={midpoint.y}
        rx={markerRadius * .5}
        ry={markerRadius * .5 * markerAspect}
        strokeWidth={markerRadius * .22}
      />
    </g>)}
    {vertices.map((vertex, index) => {
      const isSelected = selectedVertex?.annotationId === annotationId && selectedVertex.vertexId === vertex.id;
      const cursor = vertexMoveCursor(vertices, index, open);
      return <g key={vertex.id} data-vertex-id={vertex.id}>
        {touchMode && <ellipse
          className="touch-handle-hit"
          style={{ cursor }}
          data-vertex-id={vertex.id}
          onPointerDown={(event) => onBeginVertexDrag(event, vertex.id)}
          onPointerMove={onMoveVertex}
          onPointerUp={onFinishVertex}
          onPointerCancel={onCancel}
          cx={vertex.x}
          cy={vertex.y}
          rx={touchRadius}
          ry={touchRadius * markerAspect}
          strokeWidth={0}
          fill="transparent"
        />}
        <ellipse
          className={`vertex-handle ${isSelected ? "selected" : ""}`}
          style={{ cursor }}
          data-vertex-id={vertex.id}
          onPointerDown={(event) => onBeginVertexDrag(event, vertex.id)}
          onPointerMove={onMoveVertex}
          onPointerUp={onFinishVertex}
          onPointerCancel={onCancel}
          cx={vertex.x}
          cy={vertex.y}
          rx={markerRadius}
          ry={markerRadius * markerAspect}
          fill="#fff"
          stroke={color}
          strokeWidth={markerRadius * .42}
        />
      </g>;
    })}
  </>;
}

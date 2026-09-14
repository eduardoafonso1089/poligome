"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { edgeMidpoints } from "../geometry/annotation-geometry";
import type { Vertex } from "../models/vertex-model";

export type SelectedVertex = { annotationId: string; vertexId: string } | null;
type VertexCursor = "ns-resize" | "ew-resize" | "nesw-resize" | "nwse-resize";

function perpendicularCursor(dx: number, dy: number): VertexCursor {
  const horizontalLimit = 0.41421356237; // tan(22.5°): nearest available CSS cursor direction.
  if (Math.abs(dy) <= Math.abs(dx) * horizontalLimit) return "ns-resize";
  if (Math.abs(dx) <= Math.abs(dy) * horizontalLimit) return "ew-resize";
  // The cursor follows the normal, not the segment itself.
  return dx * dy >= 0 ? "nesw-resize" : "nwse-resize";
}

/** Chooses the resize cursor normal to a straight segment; corners retain a diagonal cue. */
export function vertexMoveCursor(vertices: Vertex[], index: number, open = false): VertexCursor {
  const vertex = vertices[index];
  if (!vertex) return "nwse-resize";
  const previous = index > 0 ? vertices[index - 1] : open ? undefined : vertices.at(-1);
  const next = index < vertices.length - 1 ? vertices[index + 1] : open ? undefined : vertices[0];

  if (previous && next) {
    const incoming = { x: vertex.x - previous.x, y: vertex.y - previous.y };
    const outgoing = { x: next.x - vertex.x, y: next.y - vertex.y };
    const cross = Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x);
    const scale = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    if (scale > 0 && cross / scale > 0.1) return "nwse-resize";
    return perpendicularCursor(next.x - previous.x, next.y - previous.y);
  }

  if (next) return perpendicularCursor(next.x - vertex.x, next.y - vertex.y);
  if (previous) return perpendicularCursor(vertex.x - previous.x, vertex.y - previous.y);
  return "nwse-resize";
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

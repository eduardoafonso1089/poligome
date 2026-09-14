"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { edgeMidpoints } from "../geometry/annotation-geometry";
import type { Vertex } from "../models/vertex-model";

export type SelectedVertex = { annotationId: string; vertexId: string } | null;

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
    {vertices.map((vertex) => {
      const isSelected = selectedVertex?.annotationId === annotationId && selectedVertex.vertexId === vertex.id;
      return <g key={vertex.id} data-vertex-id={vertex.id}>
        {touchMode && <ellipse
          className="touch-handle-hit"
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
          style={{ cursor: "nwse-resize" }}
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

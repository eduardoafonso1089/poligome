"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { PolygonAnnotation } from "../models/annotation-model";
import type { Vertex } from "../models/vertex-model";
import { VertexHandles, type SelectedVertex } from "./vertex-handles";

function ringPath(vertices: Vertex[]) {
  if (vertices.length < 3) return "";
  const [first, ...rest] = vertices;
  return `M ${first.x} ${first.y}${rest.map((vertex) => ` L ${vertex.x} ${vertex.y}`).join("")} Z`;
}

function polygonPath(annotation: PolygonAnnotation) {
  return [annotation.vertices, ...annotation.holes].map(ringPath).filter(Boolean).join(" ");
}

export type PolygonLayerProps = {
  annotation: PolygonAnnotation;
  color: string;
  tool: string;
  selected: boolean;
  primarySelected: boolean;
  selectedVertex: SelectedVertex;
  lineThickness: number;
  touchMode: boolean;
  touchRadius: number;
  markerRadius: number;
  markerAspect: number;
  onBeginAnnotationDrag: (event: ReactPointerEvent<SVGElement>) => void;
  onMoveAnnotation: (event: ReactPointerEvent<SVGElement>) => void;
  onFinishAnnotation: (event: ReactPointerEvent<SVGElement>) => void;
  onCancel: () => void;
  onBeginVertexDrag: (event: ReactPointerEvent<SVGElement>, vertexId: string) => void;
  onMoveVertex: (event: ReactPointerEvent<SVGElement>) => void;
  onFinishVertex: (event: ReactPointerEvent<SVGElement>) => void;
  onInsertVertex: (event: ReactPointerEvent<SVGElement>, afterVertexId: string, x: number, y: number) => void;
};

/** Presentational polygon layer over the canonical vertex-based annotation model. */
export function PolygonLayer({
  annotation,
  color,
  tool,
  selected,
  primarySelected,
  selectedVertex,
  lineThickness,
  touchMode,
  touchRadius,
  markerRadius,
  markerAspect,
  onBeginAnnotationDrag,
  onMoveAnnotation,
  onFinishAnnotation,
  onCancel,
  onBeginVertexDrag,
  onMoveVertex,
  onFinishVertex,
  onInsertVertex,
}: PolygonLayerProps) {
  const selecting = tool === "select";
  const showHandles = selecting && selected && primarySelected;

  return <g data-annotation-id={annotation.id} pointerEvents={selecting ? undefined : "none"}>
    <path
      fillRule="evenodd"
      className={`${selecting ? "movable-annotation" : ""} ${tool === "reshape" && primarySelected ? "reshape-target" : ""}`.trim()}
      onPointerDown={onBeginAnnotationDrag}
      onPointerMove={onMoveAnnotation}
      onPointerUp={onFinishAnnotation}
      onPointerCancel={onCancel}
      d={polygonPath(annotation)}
      fill={`${color}30`}
      stroke={color}
      strokeWidth={selected ? lineThickness + 2 : lineThickness}
    />
    {showHandles && <VertexHandles
      annotationId={annotation.id}
      vertices={annotation.vertices}
      selectedVertex={selectedVertex}
      touchMode={touchMode}
      touchRadius={touchRadius}
      markerRadius={markerRadius}
      markerAspect={markerAspect}
      color={color}
      onBeginVertexDrag={onBeginVertexDrag}
      onMoveVertex={onMoveVertex}
      onFinishVertex={onFinishVertex}
      onCancel={onCancel}
      onInsertVertex={onInsertVertex}
    />}
  </g>;
}

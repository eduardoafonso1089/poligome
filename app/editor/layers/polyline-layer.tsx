"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { PolylineAnnotation } from "../models/annotation-model";
import { VertexHandles, type SelectedVertex } from "./vertex-handles";

function verticesToSvg(annotation: PolylineAnnotation) {
  return annotation.vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(" ");
}

export type PolylineLayerProps = {
  annotation: PolylineAnnotation;
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

/** Presentational open-polyline layer over the canonical vertex-based model. */
export function PolylineLayer({
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
}: PolylineLayerProps) {
  const points = verticesToSvg(annotation);
  const selecting = tool === "select";
  const showHandles = selecting && selected && primarySelected;

  return <g data-annotation-id={annotation.id} pointerEvents={selecting ? undefined : "none"}>
    <polyline
      className={`line-hit ${selecting ? "movable-annotation" : ""}`}
      onPointerDown={onBeginAnnotationDrag}
      onPointerMove={onMoveAnnotation}
      onPointerUp={onFinishAnnotation}
      onPointerCancel={onCancel}
      points={points}
      strokeWidth={Math.max(14, lineThickness + 12)}
    />
    <polyline
      className="line-shape"
      points={points}
      stroke={color}
      strokeWidth={selected ? lineThickness + 2 : lineThickness}
    />
    {showHandles && <VertexHandles
      annotationId={annotation.id}
      vertices={annotation.vertices}
      open
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

"use client";

import { memo, type PointerEvent as ReactPointerEvent } from "react";
import type { EditorAnnotation } from "../models/annotation-model";
import type { SelectedVertex } from "../state/editor-state";
import { BoxLayer, type BoxCorner } from "./box-layer";
import { PointLayer } from "./point-layer";
import { PolygonLayer } from "./polygon-layer";
import { PolylineLayer } from "./polyline-layer";

export type AnnotationLayerProps = {
  annotation: EditorAnnotation;
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
  boxTouchRadius: number;
  boxRotationTouchRadius: number;
  onBeginAnnotationDrag: (event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation) => void;
  onMoveAnnotation: (event: ReactPointerEvent<SVGElement>) => void;
  onFinishAnnotation: (event: ReactPointerEvent<SVGElement>) => void;
  onCancel: () => void;
  onBeginVertexDrag: (event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, vertexId: string) => void;
  onMoveVertex: (event: ReactPointerEvent<SVGElement>) => void;
  onFinishVertex: (event: ReactPointerEvent<SVGElement>) => void;
  onInsertVertex: (event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, afterVertexId: string, x: number, y: number) => void;
  onResizeStart: (event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, corner: BoxCorner) => void;
  onResizeMove: (event: ReactPointerEvent<SVGElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<SVGElement>) => void;
  onRotateStart: (event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation) => void;
  onTransformMove: (event: ReactPointerEvent<SVGElement>) => void;
  onTransformEnd: (event: ReactPointerEvent<SVGElement>) => void;
};

export const AnnotationLayer = memo(function AnnotationLayer(props: AnnotationLayerProps) {
  const { annotation } = props;

  if (annotation.type === "polygon") {
    return <PolygonLayer
      annotation={annotation}
      color={props.color}
      tool={props.tool}
      selected={props.selected}
      primarySelected={props.primarySelected}
      selectedVertex={props.selectedVertex}
      lineThickness={props.lineThickness}
      touchMode={props.touchMode}
      touchRadius={props.touchRadius}
      markerRadius={props.markerRadius}
      markerAspect={props.markerAspect}
      onBeginAnnotationDrag={(event) => props.onBeginAnnotationDrag(event, annotation)}
      onMoveAnnotation={props.onMoveAnnotation}
      onFinishAnnotation={props.onFinishAnnotation}
      onCancel={props.onCancel}
      onBeginVertexDrag={(event, vertexId) => props.onBeginVertexDrag(event, annotation, vertexId)}
      onMoveVertex={props.onMoveVertex}
      onFinishVertex={props.onFinishVertex}
      onInsertVertex={(event, afterVertexId, x, y) => props.onInsertVertex(event, annotation, afterVertexId, x, y)}
    />;
  }

  if (annotation.type === "line") {
    return <PolylineLayer
      annotation={annotation}
      color={props.color}
      tool={props.tool}
      selected={props.selected}
      primarySelected={props.primarySelected}
      selectedVertex={props.selectedVertex}
      lineThickness={props.lineThickness}
      touchMode={props.touchMode}
      touchRadius={props.touchRadius}
      markerRadius={props.markerRadius}
      markerAspect={props.markerAspect}
      onBeginAnnotationDrag={(event) => props.onBeginAnnotationDrag(event, annotation)}
      onMoveAnnotation={props.onMoveAnnotation}
      onFinishAnnotation={props.onFinishAnnotation}
      onCancel={props.onCancel}
      onBeginVertexDrag={(event, vertexId) => props.onBeginVertexDrag(event, annotation, vertexId)}
      onMoveVertex={props.onMoveVertex}
      onFinishVertex={props.onFinishVertex}
      onInsertVertex={(event, afterVertexId, x, y) => props.onInsertVertex(event, annotation, afterVertexId, x, y)}
    />;
  }

  if (annotation.type === "box") {
    return <BoxLayer
      annotation={annotation}
      color={props.color}
      selected={props.selected}
      active={props.primarySelected}
      selecting={props.tool === "select"}
      touchMode={props.touchMode}
      markerRadius={props.markerRadius}
      markerAspect={props.markerAspect}
      touchRadius={props.boxTouchRadius}
      rotationTouchRadius={props.boxRotationTouchRadius}
      lineThickness={props.lineThickness}
      onPointerDown={props.onBeginAnnotationDrag}
      onPointerMove={props.onMoveAnnotation}
      onPointerUp={props.onFinishAnnotation}
      onPointerCancel={props.onCancel}
      onResizeStart={props.onResizeStart}
      onResizeMove={props.onResizeMove}
      onResizeEnd={props.onResizeEnd}
      onRotateStart={props.onRotateStart}
      onTransformMove={props.onTransformMove}
      onTransformEnd={props.onTransformEnd}
    />;
  }

  return <PointLayer
    annotation={annotation}
    color={props.color}
    selected={props.selected}
    selecting={props.tool === "select"}
    markerRadius={props.markerRadius}
    markerAspect={props.markerAspect}
    onPointerDown={props.onBeginAnnotationDrag}
    onPointerMove={props.onMoveAnnotation}
    onPointerUp={props.onFinishAnnotation}
    onPointerCancel={props.onCancel}
  />;
});

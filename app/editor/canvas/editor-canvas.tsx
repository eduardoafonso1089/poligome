"use client";

import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, Ref } from "react";
import type { EditorAnnotation } from "../models/annotation-model";
import type { Label } from "../../lib/types";
import type { Size2D } from "../../lib/editor-viewport";
import type { SelectedVertex } from "../state/editor-state";
import { AnnotationLayer } from "../layers/annotation-layer";
import { SelectionLayer } from "../selection/selection-layer";
import type { SelectionMarquee } from "../selection/selection-model";
import type { BoxCorner } from "../layers/box-layer";

export type EditorCanvasProps = {
  imageSize: Size2D;
  annotations: EditorAnnotation[];
  labels: Label[];
  tool: string;
  selectedId: string | null;
  selectedIds: string[];
  selectedVertex: SelectedVertex;
  selectionMarquee: SelectionMarquee | null;
  overlay?: ReactNode;
  lineThickness: number;
  touchMode: boolean;
  touchRadius: number;
  markerRadius: number;
  markerAspect: number;
  boxTouchRadius: number;
  boxRotationTouchRadius: number;
  svgRef?: Ref<SVGSVGElement>;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  onPointerDownCapture?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMoveCapture?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUpCapture?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancelCapture?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel: () => void;
  onPointerLeave?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onDoubleClick?: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onBeginAnnotationDrag: (event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation) => void;
  onMoveAnnotation: (event: ReactPointerEvent<SVGElement>) => void;
  onFinishAnnotation: (event: ReactPointerEvent<SVGElement>) => void;
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

export function EditorCanvas(props: EditorCanvasProps) {
  const labelById = new Map(props.labels.map((label) => [label.id, label]));
  const selected = new Set(props.selectedIds);
  const width = Math.max(1, props.imageSize.width);
  const height = Math.max(1, props.imageSize.height);

  return <svg
    ref={props.svgRef}
    className={props.className}
    style={props.style}
    aria-label={props.ariaLabel}
    viewBox={`0 0 ${width} ${height}`}
    preserveAspectRatio="none"
    onPointerDownCapture={props.onPointerDownCapture}
    onPointerMoveCapture={props.onPointerMoveCapture}
    onPointerUpCapture={props.onPointerUpCapture}
    onPointerCancelCapture={props.onPointerCancelCapture}
    onPointerDown={props.onPointerDown}
    onPointerMove={props.onPointerMove}
    onPointerUp={props.onPointerUp}
    onPointerCancel={props.onPointerCancel}
    onPointerLeave={props.onPointerLeave}
    onContextMenu={props.onContextMenu}
    onDoubleClick={props.onDoubleClick}
  >
    {props.annotations.map((annotation) => {
      const label = labelById.get(annotation.label);
      return <AnnotationLayer
        key={annotation.id}
        annotation={annotation}
        color={label?.color ?? "#929a95"}
        tool={props.tool}
        selected={selected.has(annotation.id)}
        primarySelected={props.selectedId === annotation.id && props.selectedIds.length === 1}
        selectedVertex={props.selectedVertex}
        lineThickness={props.lineThickness}
        touchMode={props.touchMode}
        touchRadius={props.touchRadius}
        markerRadius={props.markerRadius}
        markerAspect={props.markerAspect}
        boxTouchRadius={props.boxTouchRadius}
        boxRotationTouchRadius={props.boxRotationTouchRadius}
        onBeginAnnotationDrag={props.onBeginAnnotationDrag}
        onMoveAnnotation={props.onMoveAnnotation}
        onFinishAnnotation={props.onFinishAnnotation}
        onCancel={props.onPointerCancel}
        onBeginVertexDrag={props.onBeginVertexDrag}
        onMoveVertex={props.onMoveVertex}
        onFinishVertex={props.onFinishVertex}
        onInsertVertex={props.onInsertVertex}
        onResizeStart={props.onResizeStart}
        onResizeMove={props.onResizeMove}
        onResizeEnd={props.onResizeEnd}
        onRotateStart={props.onRotateStart}
        onTransformMove={props.onTransformMove}
        onTransformEnd={props.onTransformEnd}
      />;
    })}
    {props.overlay}
    {props.selectionMarquee && <SelectionLayer marquee={props.selectionMarquee} />}
  </svg>;
}

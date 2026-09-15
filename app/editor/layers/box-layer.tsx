"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { boxCornerPoints } from "../geometry/annotation-geometry";
import type { BoxAnnotation } from "../models/annotation-model";
import { vertexMoveCursor } from "./vertex-handles";

export type BoxCorner = "nw" | "ne" | "se" | "sw";

export function boxCornerCursors(annotation: BoxAnnotation) {
  const vertices = boxCornerPoints(annotation).map((point, index) => ({ ...point, id: `${annotation.id}:corner:${index}` }));
  return vertices.map((_vertex, index) => vertexMoveCursor(vertices, index));
}

type Props = {
  annotation: BoxAnnotation;
  color: string;
  selected: boolean;
  active: boolean;
  selecting: boolean;
  touchMode: boolean;
  markerRadius: number;
  markerAspect: number;
  touchRadius: number;
  rotationTouchRadius: number;
  lineThickness: number;
  onPointerDown: (event: ReactPointerEvent<SVGElement>, annotation: BoxAnnotation) => void;
  onPointerMove: (event: ReactPointerEvent<SVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGElement>) => void;
  onPointerCancel: () => void;
  onResizeStart: (event: ReactPointerEvent<SVGElement>, annotation: BoxAnnotation, corner: BoxCorner) => void;
  onResizeMove: (event: ReactPointerEvent<SVGElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<SVGElement>) => void;
  onRotateStart: (event: ReactPointerEvent<SVGElement>, annotation: BoxAnnotation) => void;
  onTransformMove: (event: ReactPointerEvent<SVGElement>) => void;
  onTransformEnd: (event: ReactPointerEvent<SVGElement>) => void;
};

export function BoxLayer({
  annotation, color, selected, active, selecting, touchMode, markerRadius, markerAspect,
  touchRadius, rotationTouchRadius, lineThickness, onPointerDown, onPointerMove, onPointerUp,
  onPointerCancel, onResizeStart, onResizeMove, onResizeEnd, onRotateStart, onTransformMove, onTransformEnd,
}: Props) {
  const { x, y, width, height } = annotation;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const degrees = (annotation.rotation ?? 0) * 180 / Math.PI;
  const rotationAbove = y > markerRadius * 7;
  const rotationAnchorY = rotationAbove ? y : y + height;
  const rotationStemEndY = rotationAnchorY + (rotationAbove ? -1 : 1) * markerRadius * 7;
  const rotationHandleY = rotationAnchorY + (rotationAbove ? -1 : 1) * markerRadius * 8.4;
  const corners: Array<[BoxCorner, number, number]> = [
    ["nw", x, y], ["ne", x + width, y], ["se", x + width, y + height], ["sw", x, y + height],
  ];
  const cornerCursors = boxCornerCursors(annotation);
  const showHandles = selecting && selected && active;

  return (
    <g
      data-annotation-id={annotation.id}
      className={selecting ? "movable-annotation" : ""}
      pointerEvents={selecting ? undefined : "none"}
      onPointerDown={(event) => onPointerDown(event, annotation)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <g transform={`rotate(${degrees} ${centerX} ${centerY})`}>
        <rect x={x} y={y} width={width} height={height} fill={`${color}28`} stroke={color} strokeWidth={selected ? lineThickness + 2 : lineThickness} vectorEffect="non-scaling-stroke" />
        {showHandles && <>
          <line className="box-rotation-stem" x1={centerX} y1={rotationAnchorY} x2={centerX} y2={rotationStemEndY} />
          <g>
            {touchMode && <ellipse className="touch-handle-hit box-touch-handle-hit" cx={centerX} cy={rotationHandleY} rx={rotationTouchRadius} ry={rotationTouchRadius * markerAspect} fill="transparent" strokeWidth={0} onPointerDown={(event) => onRotateStart(event, annotation)} onPointerMove={onTransformMove} onPointerUp={onTransformEnd} onPointerCancel={onPointerCancel} />}
            <ellipse className="box-rotation-handle" cx={centerX} cy={rotationHandleY} rx={markerRadius * 1.25} ry={markerRadius * 1.25 * markerAspect} strokeWidth={markerRadius * .42} onPointerDown={(event) => onRotateStart(event, annotation)} onPointerMove={onTransformMove} onPointerUp={onTransformEnd} onPointerCancel={onPointerCancel} />
          </g>
          {corners.map(([corner, handleX, handleY], index) => <g key={corner}>
            {touchMode && <ellipse className="touch-handle-hit box-touch-handle-hit" cx={handleX} cy={handleY} rx={touchRadius} ry={touchRadius * markerAspect} fill="transparent" strokeWidth={0} onPointerDown={(event) => onResizeStart(event, annotation, corner)} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onPointerCancel} />}
            <ellipse className={`box-resize-handle ${corner}`} style={touchMode ? undefined : { cursor: cornerCursors[index] }} cx={handleX} cy={handleY} rx={markerRadius} ry={markerRadius * markerAspect} strokeWidth={markerRadius * .42} onPointerDown={(event) => onResizeStart(event, annotation, corner)} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onPointerCancel} />
          </g>)}
        </>}
      </g>
    </g>
  );
}

"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { PointAnnotation } from "../models/annotation-model";

type Props = {
  annotation: PointAnnotation;
  color: string;
  selected: boolean;
  selecting: boolean;
  markerRadius: number;
  markerAspect: number;
  onPointerDown: (event: ReactPointerEvent<SVGElement>, annotation: PointAnnotation) => void;
  onPointerMove: (event: ReactPointerEvent<SVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGElement>) => void;
  onPointerCancel: () => void;
};

export function PointLayer({ annotation, color, selected, selecting, markerRadius, markerAspect, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: Props) {
  const radius = markerRadius * (selected ? 1.32 : 1);
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
      <ellipse cx={annotation.x} cy={annotation.y} rx={radius} ry={radius * markerAspect} fill="#fff" stroke={color} strokeWidth={radius * .42} />
      <ellipse cx={annotation.x} cy={annotation.y} rx={radius * .34} ry={radius * .34 * markerAspect} fill={color} />
    </g>
  );
}

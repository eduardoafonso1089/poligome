"use client";

import type { DrawingDraft } from "./use-drawing-interactions";

function points(points: number[]) {
  const result: string[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) result.push(`${points[index]},${points[index + 1]}`);
  return result.join(" ");
}

export function DrawingDraftLayer({ draft, color = "#ffffff", lineThickness = 3 }: {
  draft: DrawingDraft;
  color?: string;
  lineThickness?: number;
}) {
  if (!draft) return null;

  if (draft.type === "box") {
    return <rect
      className="drawing-draft box-draft"
      x={draft.box.x}
      y={draft.box.y}
      width={draft.box.w}
      height={draft.box.h}
      fill={`${color}20`}
      stroke={color}
      strokeWidth={lineThickness}
      strokeDasharray="8 5"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />;
  }

  const coordinateString = points(draft.points);
  if (draft.type === "polygon") {
    return <polyline
      className="drawing-draft polygon-draft"
      points={coordinateString}
      fill="none"
      stroke={color}
      strokeWidth={lineThickness}
      strokeDasharray="8 5"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />;
  }

  return <polyline
    className={`drawing-draft ${draft.type}-draft`}
    points={coordinateString}
    fill="none"
    stroke={color}
    strokeWidth={lineThickness}
    strokeDasharray={draft.type === "line" ? "8 5" : undefined}
    vectorEffect="non-scaling-stroke"
    pointerEvents="none"
  />;
}

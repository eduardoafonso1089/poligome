"use client";

import type { AdvancedVectorDraft } from "../interactions/use-advanced-vector-interactions";

function points(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function AdvancedVectorDraftLayer({ draft, color = "#ffffff", lineThickness = 3 }: {
  draft: AdvancedVectorDraft;
  color?: string;
  lineThickness?: number;
}) {
  if (!draft) return null;
  if (draft.type === "split") {
    return <line
      x1={draft.start.x}
      y1={draft.start.y}
      x2={draft.end.x}
      y2={draft.end.y}
      stroke={color}
      strokeWidth={lineThickness}
      strokeDasharray="8 5"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />;
  }
  return <polyline
    points={points(draft.points)}
    fill="none"
    stroke={color}
    strokeWidth={lineThickness}
    strokeDasharray={draft.type === "hole" ? "6 5" : undefined}
    vectorEffect="non-scaling-stroke"
    pointerEvents="none"
  />;
}

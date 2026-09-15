"use client";

import type { SelectionMarquee } from "./selection-model";
import { normalizedSelectionRect } from "./selection-model";

export function SelectionLayer({ marquee }: { marquee: SelectionMarquee | null }) {
  if (!marquee) return null;
  const rect = normalizedSelectionRect(marquee);
  return (
    <rect
      className="selection-marquee"
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      pointerEvents="none"
    />
  );
}

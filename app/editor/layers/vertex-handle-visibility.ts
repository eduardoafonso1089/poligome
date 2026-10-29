import type { Vertex } from "../models/vertex-model";

/** Cull overlapping edit controls, never the underlying polygon/polyline geometry. */
export function visibleVertexIndices(vertices: Vertex[], radius: number, aspect: number, selectedId?: string, open = false) {
  if (vertices.length <= 1000) return vertices.map((_, index) => index);
  const spacing = Math.max(radius * 3, Number.EPSILON);
  const verticalSpacing = spacing * (aspect > 0 ? aspect : 1);
  const cells = new Map<string, number[]>();
  const result: number[] = [];
  for (let index = 0; index < vertices.length; index++) {
    const p = vertices[index];
    const x = Math.floor(p.x / spacing), y = Math.floor(p.y / verticalSpacing);
    let overlaps = false;
    for (let dx = -1; dx <= 1 && !overlaps; dx++) {
      for (let dy = -1; dy <= 1 && !overlaps; dy++) {
        overlaps = (cells.get(`${x + dx}:${y + dy}`) ?? []).some(other => {
          const q = vertices[other];
          return ((p.x - q.x) / spacing) ** 2 + ((p.y - q.y) / verticalSpacing) ** 2 < 1;
        });
      }
    }
    const forced = p.id === selectedId || (open && (index === 0 || index === vertices.length - 1));
    if (overlaps && !forced) continue;
    result.push(index);
    const key = `${x}:${y}`;
    const bucket = cells.get(key) ?? [];
    bucket.push(index); cells.set(key, bucket);
  }
  return result;
}

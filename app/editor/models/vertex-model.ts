export type VertexId = string;

export type Vertex = {
  id: VertexId;
  x: number;
  y: number;
};

export type VertexFactory = (index: number, x: number, y: number) => VertexId;

function defaultVertexId(index: number, x: number, y: number) {
  return `v-${index}-${Number(x.toFixed(4))}-${Number(y.toFixed(4))}`;
}

/** Convert persisted [x1,y1,x2,y2,...] coordinates into an editable vertex model. */
export function verticesFromFlatPoints(points: number[] = [], idFactory: VertexFactory = defaultVertexId): Vertex[] {
  const vertices: Vertex[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const vertexIndex = index / 2;
    const x = points[index];
    const y = points[index + 1];
    vertices.push({ id: idFactory(vertexIndex, x, y), x, y });
  }
  return vertices;
}

/** Convert the richer editor model back to the existing .plgm-compatible representation. */
export function flatPointsFromVertices(vertices: Vertex[] = []): number[] {
  return vertices.flatMap((vertex) => [vertex.x, vertex.y]);
}

export function updateVertex(vertices: Vertex[], vertexId: VertexId, point: { x: number; y: number }): Vertex[] {
  return vertices.map((vertex) => vertex.id === vertexId ? { ...vertex, ...point } : vertex);
}

export function insertVertex(
  vertices: Vertex[],
  afterVertexId: VertexId,
  point: { x: number; y: number },
  idFactory: VertexFactory = defaultVertexId,
): Vertex[] {
  const index = vertices.findIndex((vertex) => vertex.id === afterVertexId);
  if (index < 0) return vertices;
  const next = [...vertices];
  next.splice(index + 1, 0, {
    id: idFactory(index + 1, point.x, point.y),
    x: point.x,
    y: point.y,
  });
  return next;
}

export function deleteVertex(vertices: Vertex[], vertexId: VertexId, minimumVertices = 3): Vertex[] {
  if (vertices.length <= minimumVertices) return vertices;
  return vertices.filter((vertex) => vertex.id !== vertexId);
}

export function moveVertices(vertices: Vertex[], dx: number, dy: number): Vertex[] {
  return vertices.map((vertex) => ({ ...vertex, x: vertex.x + dx, y: vertex.y + dy }));
}

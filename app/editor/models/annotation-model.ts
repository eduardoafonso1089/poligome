import type { Vertex } from "./vertex-model";

export type AnnotationBase = {
  id: string;
  asset: string;
  label: string;
  reviewScore?: number;
};

export type BoxAnnotation = AnnotationBase & {
  type: "box";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

export type PolygonAnnotation = AnnotationBase & {
  type: "polygon";
  vertices: Vertex[];
  holes: Vertex[][];
};

export type PolylineAnnotation = AnnotationBase & {
  type: "line";
  vertices: Vertex[];
};

export type PointAnnotation = AnnotationBase & {
  type: "point";
  x: number;
  y: number;
};

export type EditorAnnotation =
  | BoxAnnotation
  | PolygonAnnotation
  | PolylineAnnotation
  | PointAnnotation;

"use client";

/**
 * Traduz o que o runtime devolve para o que o editor guarda.
 *
 * O contrato tem cinco geometrias; o editor tem quatro, e máscara não é uma
 * delas. Então máscara vira polígono aqui, uma vez, em vez de cada chamador
 * inventar sua própria conversão — é a mesma razão pela qual o runtime traduz
 * coordenadas em vez de deixar isso com o autor do modelo.
 */

import { contours } from "d3-contour";
import type { EditorAnnotation, AnnotationBase } from "../editor/models/annotation-model";
import {
  createBox,
  createPoint,
  createPolygonFromFlat,
  createPolylineFromFlat,
} from "../editor/models/annotation-factory";
import { decodeRle, type RuntimeAnnotation, type RuntimeMask } from "./runtime-client";

/** Abaixo disto o polígono não fecha e não há o que desenhar. */
const MIN_POLYGON_POINTS = 3;

function area(points: number[]): number {
  let total = 0;
  for (let index = 0; index + 3 < points.length; index += 2) {
    total += points[index] * points[index + 3] - points[index + 2] * points[index + 1];
  }
  if (points.length >= 6) total += points.at(-2)! * points[1] - points[0] * points.at(-1)!;
  return Math.abs(total) / 2;
}

/**
 * Contorno externo de maior área de uma máscara, já no espaço canônico.
 *
 * A grade do RLE pode ser menor que `bounds` quando o runtime reduziu o
 * recorte, então os vértices são escalados de volta ao tamanho que a máscara
 * ocupa na imagem original. Sem isso a máscara sairia encolhida no canto.
 */
export function maskToPolygon(mask: RuntimeMask): number[] | null {
  if (!mask.width || !mask.height || !mask.rle.length) return null;

  const grid = decodeRle(mask.rle, mask.width, mask.height);
  const geometry = contours().size([mask.width, mask.height]).thresholds([0.5])(Array.from(grid))[0];
  if (!geometry?.coordinates.length) return null;

  const rings = geometry.coordinates.flatMap((polygon) => polygon);
  const flattened = rings.map((ring) => ring.flatMap(([x, y]) => [x, y]));
  const largest = flattened.sort((a, b) => area(b) - area(a))[0];
  if (!largest || largest.length < MIN_POLYGON_POINTS * 2) return null;

  const scaleX = mask.bounds.width / mask.width;
  const scaleY = mask.bounds.height / mask.height;
  return largest.map((value, index) =>
    index % 2 === 0
      ? mask.bounds.x + value * scaleX
      : mask.bounds.y + value * scaleY,
  );
}

function flatten(vertices: ReadonlyArray<{ x: number; y: number }>): number[] {
  return vertices.flatMap((vertex) => [vertex.x, vertex.y]);
}

/**
 * Uma anotação do runtime como o editor a guarda, ou `null` quando não há
 * geometria que sobreviva à conversão.
 *
 * O rótulo do modelo vira a classe. Quando o modelo não rotula, cai no rótulo
 * ativo em vez de inventar um nome.
 */
export function toEditorAnnotation(
  annotation: RuntimeAnnotation,
  base: AnnotationBase,
): EditorAnnotation | null {
  switch (annotation.kind) {
    case "box":
      return createBox(base, {
        x: annotation.box.x,
        y: annotation.box.y,
        width: annotation.box.width,
        height: annotation.box.height,
        ...(annotation.rotation === undefined ? {} : { rotation: annotation.rotation }),
      });
    case "polygon": {
      const points = flatten(annotation.vertices);
      return points.length >= MIN_POLYGON_POINTS * 2 ? createPolygonFromFlat(base, points) : null;
    }
    case "polyline": {
      const points = flatten(annotation.vertices);
      return points.length >= 4 ? createPolylineFromFlat(base, points) : null;
    }
    case "keypoint":
      return createPoint(base, { x: annotation.at.x, y: annotation.at.y });
    case "mask": {
      const points = maskToPolygon(annotation.mask);
      return points ? createPolygonFromFlat(base, points) : null;
    }
    default:
      return null;
  }
}

/**
 * Converte um lote, descartando o que não vira geometria.
 *
 * `makeId` vem de fora porque o id precisa ser rastreável: um resultado parcial
 * é rascunho, e o editor tem de saber quais anotações remover quando o
 * resultado final, já passado pela junção, chega no lugar delas.
 */
export function toEditorAnnotations(
  annotations: readonly RuntimeAnnotation[],
  options: { asset: string; fallbackLabel: string; makeId: () => string },
): EditorAnnotation[] {
  const converted: EditorAnnotation[] = [];
  for (const annotation of annotations) {
    const editorAnnotation = toEditorAnnotation(annotation, {
      id: options.makeId(),
      asset: options.asset,
      label: annotation.label ?? options.fallbackLabel,
    });
    if (editorAnnotation) converted.push(editorAnnotation);
  }
  return converted;
}

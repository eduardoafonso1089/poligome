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
import { IMPORT_COLORS } from "../editor/import/coco-document-import";
import type { Label } from "./types";
import {
  createBox,
  createPoint,
  createPolygonFromFlat,
  createPolylineFromFlat,
} from "../editor/models/annotation-factory";
import { decodeRle, type RuntimeAnnotation, type RuntimeMask } from "./runtime-client";

/** Abaixo disto o polígono não fecha e não há o que desenhar. */
const MIN_POLYGON_POINTS = 3;

/**
 * Quanto se pega em volta da região pedida, por lado, em fração do lado dela.
 *
 * Um recorte colado no objeto chega ao modelo sem nada em volta, e um
 * classificador redimensiona esse recorte para 224 px: sem contexto ele decide
 * pela textura. A margem devolve o entorno sem alargar a resposta, porque o que
 * sai é recortado de volta na região que a pessoa desenhou.
 */
export const CONTEXT_MARGIN = 0.25;

/** Margem mínima, para que uma caixa pequena não fique com contexto nenhum. */
const MIN_CONTEXT_PX = 32;

export type Bounds = { x: number; y: number; width: number; height: number };

/**
 * A região a inferir: a caixa pedida mais contexto, contida na imagem.
 */
export function withContext(region: Bounds, imageWidth: number, imageHeight: number): Bounds {
  const padX = Math.max(region.width * CONTEXT_MARGIN, MIN_CONTEXT_PX);
  const padY = Math.max(region.height * CONTEXT_MARGIN, MIN_CONTEXT_PX);
  const left = Math.max(0, region.x - padX);
  const top = Math.max(0, region.y - padY);
  const right = Math.min(imageWidth, region.x + region.width + padX);
  const bottom = Math.min(imageHeight, region.y + region.height + padY);
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function envelope(annotation: RuntimeAnnotation): Bounds {
  switch (annotation.kind) {
    case "box": return annotation.box;
    case "mask": return annotation.mask.bounds;
    case "keypoint": return { x: annotation.at.x, y: annotation.at.y, width: 0, height: 0 };
    default: {
      const xs = annotation.vertices.map((v) => v.x);
      const ys = annotation.vertices.map((v) => v.y);
      return { x: Math.min(...xs), y: Math.min(...ys),
               width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
  }
}

/**
 * Restringe o resultado à região pedida, descartando o que veio só da margem.
 *
 * O critério é o centro, e não a interseção: um objeto que a margem revelou pela
 * metade tem o centro fora e não é o que a pessoa pediu. Caixa que passa é ainda
 * recortada na região — geometria que traça contorno não, porque cortá-la
 * mutilaria um objeto que o modelo viu inteiro, e ajustar isso é do canvas.
 */
export function clipToRegion(
  annotation: RuntimeAnnotation,
  region: Bounds,
): RuntimeAnnotation | null {
  const box = envelope(annotation);
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const inside =
    centreX >= region.x && centreX <= region.x + region.width &&
    centreY >= region.y && centreY <= region.y + region.height;
  if (!inside) return null;

  if (annotation.kind !== "box") return annotation;

  const left = Math.max(box.x, region.x);
  const top = Math.max(box.y, region.y);
  const right = Math.min(box.x + box.width, region.x + region.width);
  const bottom = Math.min(box.y + box.height, region.y + region.height);
  if (right <= left || bottom <= top) return null;
  return { ...annotation, box: { x: left, y: top, width: right - left, height: bottom - top } };
}

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

/**
 * Garante uma classe para cada nome que o modelo devolveu.
 *
 * O canvas resolve a cor por `labelById.get(annotation.label)`, então a
 * anotação precisa guardar o **id** da classe, não o nome dela. Guardar o nome
 * faz toda anotação cair no cinza padrão — que é o mesmo que não ter classe.
 *
 * Reusa a paleta da importação de propósito: uma anotação vinda do modelo tem
 * de parecer com uma anotação feita à mão, e duas paletas diferentes na mesma
 * tela seriam duas linguagens para a mesma coisa.
 */
export function ensureLabels(
  names: readonly string[],
  existing: readonly Label[],
  makeId: (prefix: string) => string,
): { labels: Label[]; byName: Map<string, Label> } {
  const labels = [...existing];
  const byName = new Map<string, Label>();

  for (const raw of names) {
    const name = raw.trim();
    if (!name || byName.has(name)) continue;
    const found = labels.find((label) => label.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (found) { byName.set(name, found); continue; }
    const created: Label = {
      id: makeId("label"),
      name,
      color: IMPORT_COLORS[labels.length % IMPORT_COLORS.length],
      key: "",
    };
    labels.push(created);
    byName.set(name, created);
  }
  return { labels, byName };
}

/**
 * O que um resultado parcial deixou no canvas, e o que fazer com isso quando o
 * final chega.
 *
 * O parcial é rascunho: o final vem com tudo já passado pela junção entre
 * tiles, e trocar um pelo outro é o que evita ver o mesmo objeto duas vezes.
 * Só que entre um e outro a pessoa pode ter mexido — é para isso que o
 * streaming existe, para ela começar antes do fim. Apagar o que ela editou
 * seria desfazer trabalho sem avisar.
 *
 * Então o rascunho intocado sai, e o editado fica. O que o modelo diria sobre
 * aquele mesmo objeto é descartado do conjunto final, porque a versão da pessoa
 * já está lá e duas cópias do mesmo objeto é o problema que a junção resolve.
 */
export function reconcileDrafts(
  drafted: ReadonlyMap<string, EditorAnnotation>,
  onCanvas: readonly EditorAnnotation[],
): { discard: string[]; keptOriginals: EditorAnnotation[] } {
  const byId = new Map(onCanvas.map((annotation) => [annotation.id, annotation]));
  const discard: string[] = [];
  const keptOriginals: EditorAnnotation[] = [];

  for (const [id, original] of drafted) {
    const current = byId.get(id);
    // Já apagado pela pessoa: nada a remover, e nada a preservar.
    if (!current) continue;
    if (sameGeometry(current, original)) discard.push(id);
    else keptOriginals.push(original);
  }
  return { discard, keptOriginals };
}

/** Igualdade estrutural do que a pessoa consegue mexer: forma e classe. */
export function sameGeometry(a: EditorAnnotation, b: EditorAnnotation): boolean {
  if (a.type !== b.type || a.label !== b.label) return false;
  switch (a.type) {
    case "box": {
      const other = b as typeof a;
      return a.x === other.x && a.y === other.y
        && a.width === other.width && a.height === other.height
        && (a.rotation ?? 0) === (other.rotation ?? 0);
    }
    case "point": {
      const other = b as typeof a;
      return a.x === other.x && a.y === other.y;
    }
    default: {
      const other = b as { vertices: ReadonlyArray<{ x: number; y: number }> };
      if (a.vertices.length !== other.vertices.length) return false;
      return a.vertices.every((v, i) => v.x === other.vertices[i].x && v.y === other.vertices[i].y);
    }
  }
}

/** Caixa envolvente de uma anotação do editor. */
export function editorEnvelope(annotation: EditorAnnotation): Bounds {
  switch (annotation.type) {
    case "box":
      return { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height };
    case "point":
      return { x: annotation.x, y: annotation.y, width: 0, height: 0 };
    default: {
      const xs = annotation.vertices.map((v) => v.x);
      const ys = annotation.vertices.map((v) => v.y);
      return { x: Math.min(...xs), y: Math.min(...ys),
               width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
  }
}

function iou(a: Bounds, b: Bounds): number {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const overlap = (right - left) * (bottom - top);
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

/**
 * Tira do conjunto final o que já está no canvas como edição da pessoa.
 *
 * A comparação é com a geometria **original** do rascunho, não com a editada:
 * é ela que o modelo devolveria de novo, e é por ela que dá para reconhecer que
 * se trata do mesmo objeto depois de a pessoa tê-lo arrastado.
 */
export function withoutEdited(
  annotations: readonly EditorAnnotation[],
  keptOriginals: readonly EditorAnnotation[],
  threshold = 0.5,
): EditorAnnotation[] {
  if (!keptOriginals.length) return [...annotations];
  const originals = keptOriginals.map(editorEnvelope);
  return annotations.filter((annotation) => {
    const box = editorEnvelope(annotation);
    return !originals.some((original) => iou(box, original) >= threshold);
  });
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
  options: {
    asset: string;
    /** Classe usada quando o modelo não rotula. Já é um id, não um nome. */
    fallbackLabelId: string;
    makeId: () => string;
    /** Nome da classe -> classe do editor. O id dela é o que a anotação guarda. */
    labelByName?: Map<string, Label>;
    /** Pixel do arquivo enviado -> pixel do asset. 1 quando coincidem. */
    scaleX?: number;
    scaleY?: number;
    /** Região pedida, em pixel do asset. O que veio só da margem é descartado. */
    clipTo?: Bounds;
  },
): EditorAnnotation[] {
  const scaleX = options.scaleX ?? 1;
  const scaleY = options.scaleY ?? 1;
  const converted: EditorAnnotation[] = [];

  for (const annotation of annotations) {
    const positioned = scaleX === 1 && scaleY === 1
      ? annotation
      : scaleAnnotation(annotation, scaleX, scaleY);
    const scaled = options.clipTo ? clipToRegion(positioned, options.clipTo) : positioned;
    if (!scaled) continue;
    const named = annotation.label ? options.labelByName?.get(annotation.label.trim()) : undefined;
    const editorAnnotation = toEditorAnnotation(scaled, {
      id: options.makeId(),
      asset: options.asset,
      label: named?.id ?? options.fallbackLabelId,
    });
    if (editorAnnotation) converted.push(editorAnnotation);
  }
  return converted;
}

/**
 * Leva uma anotação do pixel do arquivo enviado para o pixel do asset.
 *
 * Os dois coincidem no caso comum, mas não quando o editor guarda a imagem numa
 * resolução diferente da do arquivo — um recorte de raster, por exemplo. Escalar
 * a partir do que o runtime informou no upload é o que torna isso indiferente,
 * em vez de depender de os dois baterem por sorte.
 */
function scaleAnnotation(
  annotation: RuntimeAnnotation,
  scaleX: number,
  scaleY: number,
): RuntimeAnnotation {
  const point = (p: { x: number; y: number }) => ({ x: p.x * scaleX, y: p.y * scaleY });
  const rect = (r: { x: number; y: number; width: number; height: number }) => ({
    x: r.x * scaleX, y: r.y * scaleY, width: r.width * scaleX, height: r.height * scaleY,
  });

  switch (annotation.kind) {
    case "box":
      return { ...annotation, box: rect(annotation.box) };
    case "polygon":
    case "polyline":
      return { ...annotation, vertices: annotation.vertices.map(point) };
    case "keypoint":
      return { ...annotation, at: point(annotation.at) };
    case "mask":
      // A grade do RLE não muda; o que muda é a área que ela cobre.
      return { ...annotation, mask: { ...annotation.mask, bounds: rect(annotation.mask.bounds) } };
    default:
      return annotation;
  }
}

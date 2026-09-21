import type { Asset, SamBoxPrompt, SamPrompt } from "../../lib/types";
import type { Copy } from "../../lib/i18n";
import { requestSamPredictions } from "../../lib/sam";
import type { PolygonAnnotation } from "./annotation-model";
import { createPolygonFromFlat } from "./annotation-factory";

/**
 * Canonical boundary for segmentation-model output.
 *
 * The transport speaks three prompt kinds — points, a box, and text for the
 * families that accept it — and answers with one prediction per object found.
 * Flat coordinates stop here: consumers receive PolygonAnnotations with stable
 * vertex IDs. A text prompt is the only one that routinely returns several, so
 * the list is the shape everything uses; points and a box simply return one.
 */
/** Área pelo teorema do shoelace, em coordenadas achatadas [x, y, x, y, …]. */
function polygonArea(points: number[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 2) {
    const nextIndex = (index + 2) % points.length;
    total += points[index] * points[nextIndex + 1] - points[nextIndex] * points[index + 1];
  }
  return Math.abs(total) / 2;
}

export async function requestSamAnnotations({
  makeId,
  asset,
  label,
  endpoint,
  prompts,
  box,
  text,
  threshold,
  copy,
}: {
  makeId: (prefix: string) => string;
  asset: Asset;
  label: string;
  endpoint: string;
  prompts?: SamPrompt[];
  box?: SamBoxPrompt | null;
  text?: string;
  threshold?: number;
  copy: Copy;
}): Promise<PolygonAnnotation[]> {
  const query = text?.trim() ?? "";
  const result = await requestSamPredictions({
    endpoint,
    asset,
    copy,
    prompts,
    box: box ?? null,
    text: query || undefined,
    // The threshold only means anything to a text query, where it decides how
    // sure the model has to be before it calls something a match.
    threshold: query ? threshold : undefined,
    // A point or a box means "this object here", so one mask answers it. A text
    // query means "every one of these", and asking for a single mask would throw
    // away the instances that make the query worth typing.
    multimaskOutput: Boolean(query),
  });
  // One annotation per prediction, carrying that prediction's largest contour.
  // A mask routinely comes back in pieces — a box around one roof answered with
  // eleven of them here — and handing the editor eleven shapes for the single
  // object the user pointed at is not a proposal, it is cleanup work. A text
  // query still yields one shape per object, because each object is its own
  // prediction.
  return result.predictions
    .map((prediction) => prediction.polygons
      .filter((points) => Array.isArray(points) && points.length >= 6)
      .reduce<number[] | null>((largest, points) =>
        largest === null || polygonArea(points) > polygonArea(largest) ? points : largest, null))
    .filter((points): points is number[] => points !== null)
    .map((points) => createPolygonFromFlat({ id: makeId("sam"), asset: asset.id, label }, points));
}

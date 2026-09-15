import type { Asset, SamPrompt } from "../../lib/types";
import type { Copy } from "../../lib/i18n";
import { requestSamMask } from "../../lib/sam";
import type { PolygonAnnotation } from "./annotation-model";
import { createPolygonFromFlat } from "./annotation-factory";

/**
 * Canonical boundary for segmentation-model output.
 * The current SAM transport still returns a numeric contour, but flat coordinates stop here:
 * consumers receive a PolygonAnnotation with stable vertex IDs.
 */
export async function requestSamAnnotation({
  id,
  asset,
  label,
  endpoint,
  prompts,
  copy,
}: {
  id: string;
  asset: Asset;
  label: string;
  endpoint: string;
  prompts: SamPrompt[];
  copy: Copy;
}): Promise<PolygonAnnotation> {
  const points = await requestSamMask({ endpoint, asset, prompts, copy });
  return createPolygonFromFlat(
    { id, asset: asset.id, label },
    points,
  );
}

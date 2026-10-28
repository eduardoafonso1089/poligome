import type { Asset } from "../../lib/types";

export type ImageMatchIssue = {
  reference: string;
  reason: "missing" | "ambiguous" | "invalid";
};

export type ImageMatchResult = { asset: Asset } | { issue: ImageMatchIssue };

function normalizedPath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/").toLocaleLowerCase();
}

function basename(value: string) {
  return normalizedPath(value).split("/").pop() ?? "";
}

function stem(value: string) {
  const name = basename(value);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function uniqueMatch(reference: string, candidates: Asset[]): ImageMatchResult | null {
  if (candidates.length === 1) return { asset: candidates[0] };
  if (candidates.length > 1) return { issue: { reference, reason: "ambiguous" } };
  return null;
}

export function matchImageReference(
  reference: string,
  assets: Asset[],
  options: { allowStem?: boolean } = {},
): ImageMatchResult {
  const normalized = normalizedPath(reference);
  if (!normalized) return { issue: { reference, reason: "invalid" } };

  const exact = uniqueMatch(reference, assets.filter((asset) => normalizedPath(asset.name) === normalized));
  if (exact) return exact;

  // Folder pickers include their outer directory; a COCO reference often starts
  // one level below it. Keep the rest of the path to distinguish repeated names.
  const byPath = uniqueMatch(reference, assets.filter((asset) => normalizedPath(asset.name).endsWith(`/${normalized}`)));
  if (byPath) return byPath;

  if (options.allowStem) {
    const byPathStem = uniqueMatch(reference, assets.filter((asset) => {
      const path = normalizedPath(asset.name).replace(/\.[^/.]+$/, "");
      return path === normalized || path.endsWith(`/${normalized}`);
    }));
    if (byPathStem) return byPathStem;
  }

  const fileName = basename(normalized);
  const byBasename = uniqueMatch(reference, assets.filter((asset) => basename(asset.name) === fileName));
  if (byBasename) return byBasename;

  if (options.allowStem) {
    const fileStem = stem(normalized);
    const byStem = uniqueMatch(reference, assets.filter((asset) => stem(asset.name) === fileStem));
    if (byStem) return byStem;
  }

  return { issue: { reference, reason: "missing" } };
}

import type { Asset } from "../../lib/types";
import type { EditorAnnotation } from "../models/annotation-model";

export type DatasetSplit = "train" | "val" | "test";

export type ExportSplitOptions = {
  splitDataset?: boolean;
  train: number;
  val: number;
  test: number;
  includeTest: boolean;
  strategy: "random" | "balanced";
};

export type DatasetSplitAssignment = Map<string, DatasetSplit>;

function activeSplits(options: ExportSplitOptions): DatasetSplit[] {
  return options.includeTest ? ["train", "val", "test"] : ["train", "val"];
}

function normalizedWeights(options: ExportSplitOptions, splits: DatasetSplit[]) {
  const weights = splits.map((split) => Math.max(0, Number(options[split]) || 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? weights.map((weight) => weight / total) : weights.map((_, index) => index === 0 ? 1 : 0);
}

function targetCounts(total: number, weights: number[]) {
  const raw = weights.map((weight) => weight * total);
  const counts = raw.map(Math.floor);
  const remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const remainderOrder = raw.map((value, index) => ({ index, remainder: value - counts[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) counts[remainderOrder[index].index] += 1;
  return counts;
}

function shuffled<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function assignDatasetSplits(
  assets: Asset[],
  annotations: EditorAnnotation[],
  options: ExportSplitOptions,
  random: () => number = Math.random,
): DatasetSplitAssignment {
  const splits = activeSplits(options);
  const weights = normalizedWeights(options, splits);
  const imageTargets = targetCounts(assets.length, weights);
  const assignment: DatasetSplitAssignment = new Map();

  if (options.strategy === "random") {
    const ordered = shuffled(assets, random);
    let offset = 0;
    for (const [splitIndex, split] of splits.entries()) {
      for (const asset of ordered.slice(offset, offset + imageTargets[splitIndex])) assignment.set(asset.id, split);
      offset += imageTargets[splitIndex];
    }
    return assignment;
  }

  const instancesByAsset = new Map<string, number>();
  for (const annotation of annotations) instancesByAsset.set(annotation.asset, (instancesByAsset.get(annotation.asset) ?? 0) + 1);
  const totalInstances = annotations.length;
  const instanceTargets = weights.map((weight) => weight * totalInstances);
  const imageCounts = splits.map(() => 0);
  const instanceCounts = splits.map(() => 0);
  const ordered = [...assets].sort((left, right) =>
    (instancesByAsset.get(right.id) ?? 0) - (instancesByAsset.get(left.id) ?? 0) || left.id.localeCompare(right.id));

  for (const asset of ordered) {
    const instanceCount = instancesByAsset.get(asset.id) ?? 0;
    const candidates = splits.map((_, index) => index).filter((index) => imageCounts[index] < imageTargets[index]);
    const selected = candidates.reduce((best, candidate) => {
      const bestInstanceDeficit = instanceTargets[best] - instanceCounts[best];
      const candidateInstanceDeficit = instanceTargets[candidate] - instanceCounts[candidate];
      if (candidateInstanceDeficit !== bestInstanceDeficit) return candidateInstanceDeficit > bestInstanceDeficit ? candidate : best;
      const bestImageDeficit = imageTargets[best] - imageCounts[best];
      const candidateImageDeficit = imageTargets[candidate] - imageCounts[candidate];
      return candidateImageDeficit > bestImageDeficit ? candidate : best;
    }, candidates[0]);
    assignment.set(asset.id, splits[selected]);
    imageCounts[selected] += 1;
    instanceCounts[selected] += instanceCount;
  }
  return assignment;
}

export function splitAssets(assignment: DatasetSplitAssignment, assets: Asset[]) {
  const result: Partial<Record<DatasetSplit, Asset[]>> = {};
  for (const asset of assets) {
    const split = assignment.get(asset.id);
    if (!split) continue;
    (result[split] ??= []).push(asset);
  }
  return result;
}

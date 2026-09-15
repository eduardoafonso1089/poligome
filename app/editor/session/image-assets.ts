import type { Asset } from "../../lib/types";
import { createTiledRasterAsset } from "../raster/tiled-raster-asset";

export type LoadedImageAssets = {
  assets: Asset[];
  objectUrls: string[];
  rejected: File[];
};

export type RelinkMissingAssetsResult = {
  assets: Asset[];
  objectUrls: string[];
  restoredIds: string[];
  rejected: File[];
};

function imageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Unsupported or unreadable image"));
    image.src = src;
  });
}

function acceptedImage(file: File) {
  return file.type.startsWith("image/") && !/tiff?/i.test(file.type);
}

function normalizedName(name: string) {
  return name.split(/[\\/]/).pop()?.trim().toLocaleLowerCase() ?? "";
}

function expectedDimensionsMatch(asset: Asset, width: number, height: number) {
  const expectedWidth = Number(asset.width);
  const expectedHeight = Number(asset.height);
  const widthKnown = Number.isFinite(expectedWidth) && expectedWidth > 0;
  const heightKnown = Number.isFinite(expectedHeight) && expectedHeight > 0;
  return (!widthKnown || expectedWidth === width) && (!heightKnown || expectedHeight === height);
}

async function relinkStandardImage(asset: Asset, file: File) {
  if (!acceptedImage(file)) return null;
  const src = URL.createObjectURL(file);
  try {
    const dimensions = await imageDimensions(src);
    if (!expectedDimensionsMatch(asset, dimensions.width, dimensions.height)) {
      URL.revokeObjectURL(src);
      return null;
    }
    return {
      asset: {
        ...asset,
        src,
        local: true,
        missing: false,
        byteSize: file.size,
        width: dimensions.width,
        height: dimensions.height,
      } satisfies Asset,
      objectUrl: src,
    };
  } catch {
    URL.revokeObjectURL(src);
    return null;
  }
}

async function relinkTiledRaster(asset: Asset, file: File) {
  try {
    const hydrated = await createTiledRasterAsset({
      origin: file,
      name: asset.name,
      reference: asset.raster?.reference ?? {},
      makeId: () => asset.id,
    });
    if (!expectedDimensionsMatch(asset, Number(hydrated.width), Number(hydrated.height))) {
      if (hydrated.src.startsWith("blob:")) URL.revokeObjectURL(hydrated.src);
      return null;
    }
    return {
      asset: {
        ...asset,
        ...hydrated,
        id: asset.id,
        name: asset.name,
        missing: false,
      } satisfies Asset,
      objectUrl: hydrated.src.startsWith("blob:") ? hydrated.src : null,
    };
  } catch {
    return null;
  }
}

export async function loadLocalImageAssets(
  files: File[],
  makeId: (prefix: string) => string,
): Promise<LoadedImageAssets> {
  const assets: Asset[] = [];
  const objectUrls: string[] = [];
  const rejected: File[] = [];

  for (const file of files) {
    if (!acceptedImage(file)) {
      rejected.push(file);
      continue;
    }
    const src = URL.createObjectURL(file);
    try {
      const dimensions = await imageDimensions(src);
      objectUrls.push(src);
      assets.push({
        id: makeId("image"),
        name: file.name,
        src,
        local: true,
        byteSize: file.size,
        width: dimensions.width,
        height: dimensions.height,
      });
    } catch {
      URL.revokeObjectURL(src);
      rejected.push(file);
    }
  }

  return { assets, objectUrls, rejected };
}

export async function relinkMissingAssets(assets: Asset[], files: File[]): Promise<RelinkMissingAssetsResult> {
  const nextAssets = [...assets];
  const objectUrls: string[] = [];
  const restoredIds: string[] = [];
  const rejected: File[] = [];
  const filesByName = new Map<string, File[]>();

  files.forEach((file) => {
    const key = normalizedName(file.name);
    const group = filesByName.get(key) ?? [];
    group.push(file);
    filesByName.set(key, group);
  });

  for (const [name, namedFiles] of filesByName) {
    const targetIndexes = nextAssets.reduce<number[]>((indexes, asset, index) => {
      if (asset.missing && normalizedName(asset.name) === name) indexes.push(index);
      return indexes;
    }, []);

    // When multiple missing assets have the same basename, only an equally sized file group
    // is deterministic. Never guess which annotation set belongs to a same-named image.
    if (!targetIndexes.length || (targetIndexes.length > 1 && targetIndexes.length !== namedFiles.length)) {
      rejected.push(...namedFiles);
      continue;
    }

    const pairCount = Math.min(targetIndexes.length, namedFiles.length);
    for (let index = 0; index < pairCount; index += 1) {
      const targetIndex = targetIndexes[index];
      const target = nextAssets[targetIndex];
      const file = namedFiles[index];
      const relinked = target.raster?.mode === "tiled"
        ? await relinkTiledRaster(target, file)
        : await relinkStandardImage(target, file);

      if (!relinked) {
        rejected.push(file);
        continue;
      }
      nextAssets[targetIndex] = relinked.asset;
      restoredIds.push(target.id);
      if (relinked.objectUrl) objectUrls.push(relinked.objectUrl);
    }
    if (namedFiles.length > pairCount) rejected.push(...namedFiles.slice(pairCount));
  }

  return { assets: nextAssets, objectUrls, restoredIds, rejected };
}

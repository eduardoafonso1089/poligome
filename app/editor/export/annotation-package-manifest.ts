import type { Asset } from "../../lib/types";
import type { DatasetSplit, DatasetSplitAssignment } from "./dataset-split";

export type AnnotationPackageManifest = {
  format: "poligome-annotation-package";
  version: 1;
  annotation_format: "coco" | "yolo";
  geometry_mode: "mixed" | "bbox" | "polygon";
  images: Array<{
    asset_id: string;
    file_name: string;
    width: number;
    height: number;
    split: DatasetSplit;
  }>;
};

export function buildAnnotationPackageManifest(
  assets: Asset[],
  assignment: DatasetSplitAssignment,
  annotationFormat: AnnotationPackageManifest["annotation_format"],
  geometryMode: AnnotationPackageManifest["geometry_mode"],
): AnnotationPackageManifest {
  return {
    format: "poligome-annotation-package",
    version: 1,
    annotation_format: annotationFormat,
    geometry_mode: geometryMode,
    images: assets.flatMap((asset) => {
      const split = assignment.get(asset.id);
      return split ? [{
        asset_id: asset.id,
        file_name: asset.name,
        width: Number(asset.width) || 0,
        height: Number(asset.height) || 0,
        split,
      }] : [];
    }),
  };
}

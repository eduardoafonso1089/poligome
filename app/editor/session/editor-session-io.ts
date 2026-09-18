import type { Asset, Label } from "../../lib/types";
import type { Copy, Language } from "../../lib/i18n";
import type { ProjectLayout } from "../../lib/project";
import { openPoligomeProjectV4, savePoligomeProjectV4 } from "../../lib/project";
import type { EditorAnnotation } from "../models/annotation-model";
import { createCanonicalDemoProject } from "../../lib/demo";

export type CanonicalProject = {
  projectName: string;
  assets: Asset[];
  labels: Label[];
  annotations: EditorAnnotation[];
  layout?: ProjectLayout;
  objectUrls: string[];
  missingImages: number;
};

export async function openEditorProject(file: File, copy: Copy): Promise<CanonicalProject> {
  return openPoligomeProjectV4(file, copy);
}

export async function saveEditorProject(projectName: string, assets: Asset[], labels: Label[], annotations: EditorAnnotation[], copy: Copy, layout?: ProjectLayout) {
  return savePoligomeProjectV4(projectName, assets, labels, annotations, copy, layout);
}

export async function createEditorDemo(language: Language) {
  return createCanonicalDemoProject(language);
}

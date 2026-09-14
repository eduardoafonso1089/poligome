import type { Asset, Label } from "../../lib/types";
import type { EditorAnnotation } from "../models/annotation-model";
import {
  importCocoDocument,
  type CocoDocumentImportOptions,
  type CocoDocumentInput,
} from "./coco-document-import";

type WorkerAsset = Pick<Asset, "id" | "name" | "width" | "height">;

export type CocoImportWorkerRequest = {
  taskId: string;
  document: CocoDocumentInput;
  assets: WorkerAsset[];
  labels: Label[];
  options: CocoDocumentImportOptions;
};

export type CocoImportWorkerResponse = {
  taskId: string;
  labels: Label[];
  annotations: EditorAnnotation[];
  unmatched: number;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CocoImportWorkerRequest>) => void) | null;
  postMessage: (message: CocoImportWorkerResponse) => void;
};

scope.onmessage = ({ data }) => {
  let nextId = 0;
  const result = importCocoDocument(
    data.document,
    data.assets.map((asset) => ({ ...asset, src: "" }) as Asset),
    data.labels,
    (prefix) => `${data.taskId}:${prefix}:${nextId++}`,
    data.options,
  );
  scope.postMessage({
    taskId: data.taskId,
    labels: result.labels,
    annotations: result.annotations,
    unmatched: result.unmatched,
  });
};

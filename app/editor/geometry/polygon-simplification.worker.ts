import { simplifyPolygonBatch, type SimplificationJob } from "./polygon-simplification";
import type { PolygonAnnotation } from "../models/annotation-model";

export type SimplificationResponse = { annotations?: PolygonAnnotation[]; error?: string };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimplificationJob[]>) => void) | null;
  postMessage: (message: SimplificationResponse) => void;
};

scope.onmessage = ({ data }) => {
  try { scope.postMessage({ annotations: simplifyPolygonBatch(data) }); }
  catch { scope.postMessage({ error: "simplification-failed" }); }
};

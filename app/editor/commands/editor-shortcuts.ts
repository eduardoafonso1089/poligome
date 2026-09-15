import type { DrawingTool } from "../drawing/use-drawing-interactions";

export type VectorTool = "hole" | "split" | "reshape" | "transform" | null;
export type ShortcutCommand =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "finish-draft" }
  | { type: "escape" }
  | { type: "tool"; tool: DrawingTool }
  | { type: "vector-tool"; tool: Exclude<VectorTool, null> }
  | { type: "label-key"; key: string };

export function isEditableShortcutTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function commandFromKeyboard(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">): ShortcutCommand | null {
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && key === "z") return { type: event.shiftKey ? "redo" : "undo" };
  if (modifier && key === "y") return { type: "redo" };
  if (event.key === "Delete" || event.key === "Backspace") return { type: "delete" };
  if (event.key === "Enter") return { type: "finish-draft" };
  if (event.key === "Escape") return { type: "escape" };

  const drawingTools: Record<string, DrawingTool> = {
    v: "select",
    h: "pan",
    b: "box",
    p: "polygon",
    f: "freehand",
    l: "line",
    k: "point",
  };
  if (drawingTools[key]) return { type: "tool", tool: drawingTools[key] };
  if (key === "o") return { type: "vector-tool", tool: "hole" };
  if (key === "x") return { type: "vector-tool", tool: "split" };
  if (key === "r") return { type: "vector-tool", tool: "reshape" };
  if (key === "t") return { type: "vector-tool", tool: "transform" };
  if (!modifier && event.key.length === 1) return { type: "label-key", key: event.key };
  return null;
}

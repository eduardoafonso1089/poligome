"use client";

import type { ReactNode } from "react";
import { CircleMinus, Combine, Copy, ListRestart, Magnet, Maximize2, PenTool, Scissors } from "lucide-react";
import { getCopy } from "../../lib/i18n";
import type { VectorTool } from "../commands/editor-shortcuts";
import ui from "../editor-interface.module.css";
import legacy from "../legacy-controls.module.css";

type CopyType = ReturnType<typeof getCopy>;

export function VectorToolbar({
  copy,
  snapEnabled,
  vectorTool,
  canSimplify,
  canDuplicate,
  canMerge,
  canEditPolygon,
  onToggleSnap,
  onSimplify,
  onDuplicate,
  onMerge,
  onVectorTool,
}: {
  copy: CopyType;
  snapEnabled: boolean;
  vectorTool: VectorTool;
  canSimplify: boolean;
  canDuplicate: boolean;
  canMerge: boolean;
  canEditPolygon: boolean;
  onToggleSnap: () => void;
  onSimplify: () => void;
  onDuplicate: () => void;
  onMerge: () => void;
  onVectorTool: (tool: VectorTool) => void;
}) {
  const toolButton = (
    id: Exclude<VectorTool, null>,
    label: string,
    icon: ReactNode,
    disabled = false,
    title = label,
  ) => <button
    type="button"
    className={legacy.iconToolButton}
    aria-label={label}
    aria-pressed={vectorTool === id}
    disabled={disabled}
    title={title}
    onClick={() => onVectorTool(vectorTool === id ? null : id)}
  >{icon}</button>;

  return <div className={ui.vectorBar} aria-label="Ferramentas de edição vetorial">
    <button className={legacy.iconToolButton} type="button" aria-label={snapEnabled ? copy.snapOn : copy.snapOff} aria-pressed={snapEnabled} title={snapEnabled ? copy.snapOn : copy.snapOff} onClick={onToggleSnap}><Magnet size={17} /></button>
    <button className={legacy.iconToolButton} type="button" aria-label={copy.simplify} title={copy.simplify} disabled={!canSimplify} onClick={onSimplify}><ListRestart size={18} /></button>
    <button className={legacy.iconToolButton} type="button" aria-label={copy.duplicate} title={copy.duplicate} disabled={!canDuplicate} onClick={onDuplicate}><Copy size={17} /></button>
    <button className={legacy.iconToolButton} type="button" aria-label={copy.merge} title={copy.merge} disabled={!canMerge} onClick={onMerge}><Combine size={18} /></button>
    {toolButton("hole", "Buraco (O)", <CircleMinus size={17} />, !canEditPolygon)}
    {toolButton("split", `${copy.split} (X)`, <Scissors size={17} />, !canEditPolygon)}
    {toolButton("transform", `${copy.transform} (T)`, <Maximize2 size={17} />, !canEditPolygon, copy.transformTip)}
    {toolButton("reshape", `${copy.reshape} (R)`, <PenTool size={17} />, !canEditPolygon)}
  </div>;
}

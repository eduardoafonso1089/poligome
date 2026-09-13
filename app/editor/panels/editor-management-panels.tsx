"use client";

import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import {
  BarChart3, Check, ClipboardCheck, Eye, EyeOff, FileText, GripVertical,
  ImagePlus, LoaderCircle, Menu, MoreHorizontal, Palette, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Plus, Search, ShieldCheck, Tags, Trash2, WandSparkles, X,
} from "lucide-react";
import type { Asset, Label } from "../../lib/types";
import { getCopy } from "../../lib/i18n";
import type { EditorAnnotation } from "../models/annotation-model";
import type { SelectionState } from "../selection/selection-model";
import { UNLABELED_ID } from "./panel-model";
import ui from "../editor-interface.module.css";
import premerge from "./premerge-panel-refinement.module.css";

type Copy = ReturnType<typeof getCopy>;
type RightTab = "annotations" | "quality" | "review";

type Props = {
  assets: Asset[];
  currentAssetId: string;
  annotations: EditorAnnotation[];
  activeAssetAnnotations: EditorAnnotation[];
  labels: Label[];
  activeLabelId: string;
  selection: SelectionState;
  hiddenAnnotationIds: ReadonlySet<string>;
  hiddenLabelIds: ReadonlySet<string>;
  copy: Copy;
  loading?: boolean;
  onImportImages?: () => void;
  onLoadDemo?: () => void;
  onSelectAsset: (id: string) => void;
  onMoveAsset: (id: string, delta: -1 | 1) => void;
  onDeleteAsset: (id: string) => void;
  onSelectAnnotation: (id: string, modifiers: { shift: boolean; additive: boolean }) => void;
  onMoveAnnotation: (id: string, delta: -1 | 1) => void;
  onDeleteAnnotations: (ids: string[]) => void;
  onToggleAnnotationVisibility: (id: string) => void;
  onToggleLabelVisibility: (id: string) => void;
  onSelectAllAnnotations: () => void;
  onClearAnnotationSelection: () => void;
  onActiveLabelChange: (id: string) => void;
  onBatchReclassify: (ids: string[], labelId: string) => void;
  onCreateLabel: (name: string, color: string) => void;
  onRenameLabel: (id: string, name: string) => void;
  onRecolorLabel: (id: string, color: string) => void;
  onDeleteLabel: (id: string) => void;
};

function stop(event: MouseEvent) { event.stopPropagation(); }
function classes(...items: Array<string | false | null | undefined>) { return items.filter(Boolean).join(" "); }

export function EditorManagementPanels(props: Props) {
  const {
    assets, currentAssetId, annotations, activeAssetAnnotations, labels, activeLabelId, selection,
    hiddenAnnotationIds, hiddenLabelIds, copy,
  } = props;
  const [imageSearch, setImageSearch] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6c8cff");
  const [batchLabel, setBatchLabel] = useState(activeLabelId);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("annotations");
  const [classManagerOpen, setClassManagerOpen] = useState(false);

  useEffect(() => {
    const openImages = () => { setLeftPanelCollapsed(false); setLeftOpen(true); setRightOpen(false); };
    const openRight = () => { setRightPanelCollapsed(false); setRightOpen(true); setLeftOpen(false); };
    window.addEventListener("poligome:open-images", openImages);
    window.addEventListener("poligome:open-right", openRight);
    return () => {
      window.removeEventListener("poligome:open-images", openImages);
      window.removeEventListener("poligome:open-right", openRight);
    };
  }, []);

  useEffect(() => {
    if (!labels.some((label) => label.id === batchLabel)) {
      setBatchLabel(labels.some((label) => label.id === activeLabelId) ? activeLabelId : labels[0]?.id ?? UNLABELED_ID);
    }
  }, [activeLabelId, batchLabel, labels]);

  const filteredAssets = useMemo(() => {
    const query = imageSearch.trim().toLocaleLowerCase();
    return query ? assets.filter((asset) => asset.name.toLocaleLowerCase().includes(query)) : assets;
  }, [assets, imageSearch]);
  const selectedIds = selection.multiSelected.length ? selection.multiSelected : selection.selected ? [selection.selected] : [];
  const activeSelectedIds = selectedIds.filter((id) => activeAssetAnnotations.some((annotation) => annotation.id === id));
  const completed = assets.filter((item) => annotations.some((annotation) => annotation.asset === item.id)).length;
  const currentAsset = assets.find((item) => item.id === currentAssetId) ?? null;
  const allHidden = activeAssetAnnotations.length > 0 && activeAssetAnnotations.every((annotation) => hiddenAnnotationIds.has(annotation.id));
  const labelName = (label: Label) => label.id === UNLABELED_ID ? copy.unlabeled : label.name;

  function createClass() {
    if (!newLabelName.trim()) return;
    props.onCreateLabel(newLabelName, newLabelColor);
    setNewLabelName("");
  }

  function confirmAnnotationDelete(ids: string[]) {
    if (!ids.length) return;
    if (!window.confirm(`${copy.confirmDeleteAnnotations}\n${copy.deleteAnnotationsWarning}`)) return;
    props.onDeleteAnnotations(ids);
  }

  function confirmAssetDelete(item: Asset, annotationCount: number) {
    const annotationWarning = annotationCount ? `\n${annotationCount} ${copy.annotations.toLocaleLowerCase()}. ${copy.deleteAnnotationsWarning}` : "";
    if (!window.confirm(`${copy.deleteSelectedAnnotations}: ${item.name}?${annotationWarning}`)) return;
    props.onDeleteAsset(item.id);
  }

  function confirmLabelDelete(label: Label) {
    if (label.id === UNLABELED_ID) return;
    if (!window.confirm(`${copy.confirmDeleteClass}\n${copy.deleteClassWarning} ${copy.unlabeled}.`)) return;
    props.onDeleteLabel(label.id);
  }

  function toggleAllAnnotations() {
    activeAssetAnnotations.forEach((annotation) => {
      const hidden = hiddenAnnotationIds.has(annotation.id);
      if (allHidden ? hidden : !hidden) props.onToggleAnnotationVisibility(annotation.id);
    });
  }

  return <section aria-label={`${copy.appTitle} · ${copy.images} · ${copy.annotations}`} className={`${ui.managementGrid} canonical-management-panels`}>
    <button data-mobile-toggle="images" aria-label={copy.openImages} onClick={() => { setLeftPanelCollapsed(false); setLeftOpen(true); setRightOpen(false); }}><Menu size={19} /></button>
    <button data-mobile-toggle="right" aria-label={copy.annotations} onClick={() => { setRightPanelCollapsed(false); setRightOpen(true); setLeftOpen(false); }}><MoreHorizontal size={19} /></button>
    {(leftOpen || rightOpen) && <button data-mobile-backdrop="true" aria-label={copy.closePanel} onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}

    <aside data-panel="images" data-open={leftOpen ? "true" : "false"} className={classes("assets", leftOpen && "open", leftPanelCollapsed && "collapsed")}>
      <button className="sidebar-restore sidebar-restore-left" title={copy.openImages} aria-label={copy.openImages} onClick={() => setLeftPanelCollapsed(false)}><PanelLeftOpen size={17} /></button>
      <button className="panel-collapse panel-collapse-left" title={copy.openImages} aria-label={copy.openImages} onClick={() => { setLeftPanelCollapsed(true); setLeftOpen(false); }}><PanelLeftClose size={16} /></button>
      <div data-drawer-header="true" className="drawer-head"><b>{copy.images}</b><button aria-label={copy.closePanel} onClick={() => setLeftOpen(false)}><X size={19} /></button></div>
      <div className="aside-title">
        <span>{copy.images} <b>{assets.length}</b></span>
        <div>
          <button title={copy.importImages} aria-label={copy.importImages} disabled={props.loading} onClick={props.onImportImages}><Plus size={16} /></button>
          <button title={copy.selectAllAnnotations} aria-label={copy.selectAllAnnotations} disabled={!assets.length} onClick={props.onSelectAllAnnotations}><Check size={16} /></button>
          <button title="COCO JSON" aria-label="COCO JSON" disabled={!assets.length}><FileText size={16} /></button>
          <button title={copy.deleteSelectedAnnotations} aria-label={copy.deleteSelectedAnnotations} disabled={!currentAsset} onClick={() => currentAsset && confirmAssetDelete(currentAsset, annotations.filter((a) => a.asset === currentAsset.id).length)}><Trash2 size={16} /></button>
        </div>
      </div>
      {props.onImportImages && <button type="button" className="import" disabled={props.loading} onClick={props.onImportImages}><ImagePlus size={16} />{copy.importImages}</button>}
      {props.onLoadDemo && <button type="button" className="demo-import" disabled={props.loading} onClick={props.onLoadDemo}>{props.loading ? <LoaderCircle className="spin" size={15} /> : <WandSparkles size={15} />}{copy.tryDemo}</button>}
      <label className="search"><Search size={14} /><input aria-label={copy.searchImage} value={imageSearch} onChange={(event) => setImageSearch(event.target.value)} placeholder={copy.searchImage} /></label>
      <div className="progress"><div><span>{copy.progress}</span><b>{completed} {copy.of} {assets.length}</b></div><i><em style={{ width: `${assets.length ? completed / assets.length * 100 : 0}%` }} /></i></div>
      <div className="asset-list">
        {filteredAssets.map((item) => {
          const index = assets.findIndex((asset) => asset.id === item.id);
          const count = annotations.filter((annotation) => annotation.asset === item.id).length;
          const details = item.width && item.height ? `${item.width} × ${item.height}` : `${count} ${copy.projectAnnotations}`;
          const active = item.id === currentAssetId;
          return <div key={item.id} className={classes("asset-row", active && "active")}>
            <button className="reorder-handle" title={copy.reorderImage} aria-label={`${copy.reorderImage}: ${item.name}`} disabled={assets.length < 2} onClick={() => props.onMoveAsset(item.id, index === 0 ? 1 : -1)}><GripVertical size={13} /></button>
            <span className={classes("asset-selector", active && "selected")} aria-hidden="true">{active ? <Check size={11} /> : null}</span>
            <button className="asset-main" onClick={() => { props.onSelectAsset(item.id); setLeftOpen(false); }} title={item.name}>
              <div className="thumb" style={{ backgroundImage: item.src ? `url(${item.src})` : "none" }}><span>{String(index + 1).padStart(2, "0")}</span></div>
              <div><strong>{item.name}</strong><small>{details}</small></div>
              <i className={count > 0 ? "checked" : ""}>{count > 0 ? <Check size={9} /> : null}</i>
            </button>
          </div>;
        })}
      </div>
      <div className="privacy"><ShieldCheck size={11} /><span>{copy.privacy}</span></div>
    </aside>

    <aside data-panel="right" data-open={rightOpen ? "true" : "false"} className={classes("labels", rightOpen && "open", rightPanelCollapsed && "collapsed")}>
      <button className="sidebar-restore sidebar-restore-right" title={copy.annotations} aria-label={copy.annotations} onClick={() => setRightPanelCollapsed(false)}><PanelRightOpen size={17} /></button>
      <button className="panel-collapse panel-collapse-right" title={copy.annotations} aria-label={copy.annotations} onClick={() => { setRightPanelCollapsed(true); setRightOpen(false); }}><PanelRightClose size={16} /></button>
      <div data-drawer-header="true" className="drawer-head"><b>{copy.annotations}</b><button aria-label={copy.closePanel} onClick={() => setRightOpen(false)}><X size={19} /></button></div>
      <div className="tabs dataset-tabs" role="tablist" aria-label={copy.annotations}>
        <button className={rightTab === "annotations" ? "active" : ""} role="tab" aria-selected={rightTab === "annotations"} onClick={() => setRightTab("annotations")}>{copy.annotations}</button>
        <button className={rightTab === "quality" ? "active" : ""} role="tab" aria-selected={rightTab === "quality"} onClick={() => setRightTab("quality")}><BarChart3 size={14} />{copy.quality}</button>
        <button className={rightTab === "review" ? "active" : ""} role="tab" aria-selected={rightTab === "review"} onClick={() => setRightTab("review")}><ClipboardCheck size={14} />{copy.reviewTab}</button>
      </div>

      {rightTab === "annotations" && <div className="annotation-editor">
        <section className="annotation-panel-head">
          <div><b>{copy.annotations} · {activeAssetAnnotations.length}</b><span>{copy.annotationPanelHint}</span></div>
          <div className="annotation-panel-actions">
            <button disabled={!activeAssetAnnotations.length} title={allHidden ? copy.showAllAnnotations : copy.hideAllAnnotations} onClick={toggleAllAnnotations}>{allHidden ? <EyeOff size={14} /> : <Eye size={14} />}{allHidden ? copy.showAllAnnotations : copy.hideAllAnnotations}</button>
            <button onClick={() => setClassManagerOpen(true)}><Palette size={14} />{copy.manageClasses}</button>
          </div>
        </section>
        {activeSelectedIds.length > 0 && <section className="batch-class">
          <div><Tags size={14} /><span><b>{activeSelectedIds.length} {copy.batchSelection}</b><small>{copy.changeClass}</small></span></div>
          <div>
            <select value={batchLabel} onChange={(event) => setBatchLabel(event.target.value)} aria-label={copy.changeClass}>{labels.map((label) => <option key={label.id} value={label.id}>{labelName(label)}</option>)}</select>
            <button onClick={() => props.onBatchReclassify(activeSelectedIds, batchLabel)}>{copy.applyClass}</button>
            <button className="batch-delete" onClick={() => confirmAnnotationDelete(activeSelectedIds)}><Trash2 size={13} />{copy.deleteSelectedAnnotations}</button>
          </div>
        </section>}
        <div className="instances">
          {activeAssetAnnotations.map((annotation, index) => {
            const label = labels.find((item) => item.id === annotation.label);
            const selected = selectedIds.includes(annotation.id);
            const hidden = hiddenAnnotationIds.has(annotation.id) || hiddenLabelIds.has(annotation.label);
            const dotStyle = { borderColor: label?.color ?? "#929a95" } as CSSProperties;
            const displayLabel = label ? labelName(label) : annotation.label;
            return <div key={annotation.id} className={classes("instance-row", selected && "active", hidden && "hidden")}>
              <button className="reorder-handle" aria-label={`${copy.reorderAnnotation}: ${displayLabel} #${index + 1}`} title={copy.reorderAnnotation} disabled={activeAssetAnnotations.length < 2} onClick={() => props.onMoveAnnotation(annotation.id, index === 0 ? 1 : -1)}><GripVertical size={14} /></button>
              <button className={classes("annotation-selector", selected && "selected")} aria-label={`${copy.selectAnnotation}: ${displayLabel} #${index + 1}`} aria-pressed={selected} onClick={(event) => props.onSelectAnnotation(annotation.id, { shift: event.shiftKey, additive: true })}>{selected && <Check size={11} />}</button>
              <button className="instance-main" onClick={(event) => props.onSelectAnnotation(annotation.id, { shift: event.shiftKey, additive: event.ctrlKey || event.metaKey })}><i style={dotStyle}>{annotation.type === "point" ? "•" : annotation.type === "line" ? "╱" : ""}</i><span>{displayLabel} <small>#{index + 1}</small></span></button>
              <button className="visibility-toggle" title={hidden ? copy.showAnnotation : copy.hideAnnotation} aria-label={`${hidden ? copy.showAnnotation : copy.hideAnnotation}: ${displayLabel} #${index + 1}`} onClick={(event) => { stop(event); props.onToggleAnnotationVisibility(annotation.id); }}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              <button className="delete-annotation" title={copy.deleteShape} aria-label={`${copy.deleteShape}: ${displayLabel} #${index + 1}`} onClick={(event) => { stop(event); confirmAnnotationDelete([annotation.id]); }}><Trash2 size={13} /></button>
            </div>;
          })}
        </div>
      </div>}

      {rightTab === "quality" && <div className="canonical-placeholder"><BarChart3 size={20} /><b>{copy.quality}</b><span>{copy.annotationPanelHint}</span></div>}
      {rightTab === "review" && <div className="canonical-placeholder"><ClipboardCheck size={20} /><b>{copy.reviewTab}</b><span>{copy.annotationPanelHint}</span></div>}
      <div className="hint"><b>{copy.quickTip}</b><p>{copy.shortcutHint}</p></div>
    </aside>

    {classManagerOpen && <div className="canonical-class-manager-backdrop" role="presentation" onMouseDown={() => setClassManagerOpen(false)}>
      <section className="canonical-class-manager" role="dialog" aria-modal="true" aria-label={copy.manageClasses} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><Palette size={18} /><div><b>{copy.classManagerTitle}</b><small>{copy.classManagerHint}</small></div></div><button aria-label={copy.closePanel} onClick={() => setClassManagerOpen(false)}><X size={18} /></button></header>
        <section className={premerge.quickLabelCard}><div className={premerge.cardHeading}><Palette size={14} /><span><strong>{copy.labelStudio}</strong><small>{copy.labelStudioHint}</small></span></div><div className={premerge.createRow}><input aria-label={copy.className} value={newLabelName} onChange={(event) => setNewLabelName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createClass(); }} placeholder={copy.className} /><input className={ui.colorInput} aria-label={copy.labelColor} type="color" value={newLabelColor} onChange={(event) => setNewLabelColor(event.target.value)} /><button className={premerge.createButton} onClick={createClass} disabled={!newLabelName.trim()}><Plus size={15} /></button></div></section>
        <div className="canonical-class-list">
          {labels.map((label) => {
            const protectedLabel = label.id === UNLABELED_ID;
            const hidden = hiddenLabelIds.has(label.id);
            const count = annotations.filter((annotation) => annotation.label === label.id).length;
            return <div key={label.id}>
              <input type="color" value={label.color} disabled={protectedLabel} onChange={(event) => props.onRecolorLabel(label.id, event.target.value)} />
              <input defaultValue={labelName(label)} disabled={protectedLabel} onFocus={() => props.onActiveLabelChange(label.id)} onBlur={(event) => props.onRenameLabel(label.id, event.target.value)} />
              <small>{count}</small>
              <button onClick={() => props.onToggleLabelVisibility(label.id)}>{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              <button disabled={protectedLabel} onClick={() => confirmLabelDelete(label)}><Trash2 size={13} /></button>
            </div>;
          })}
        </div>
      </section>
    </div>}
  </section>;
}

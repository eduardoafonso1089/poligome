"use client";

import { useRef, useState, type DragEvent } from "react";
import { FolderOpen, Upload, LoaderCircle } from "lucide-react";
import type { Language } from "../../lib/i18n";
import { filesFromDrop } from "./dropped-files";
import { fileDropCopy } from "./file-drop-copy";
import styles from "./file-drop-zone.module.css";

type Props = { language: Language; disabled?: boolean; onImport: (files: File[]) => Promise<string> };

export function FileDropZone({ language, disabled = false, onImport }: Props) {
  const copy = fileDropCopy(language);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const busyRef = useRef(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const locked = disabled || busy;

  async function receive(read: () => Promise<File[]>) {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(false); setStatus(copy.busy);
    try { setStatus(await onImport(await read())); }
    catch (reason) { setError(true); setStatus(reason instanceof Error ? reason.message : copy.failed); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const isFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  return <section
    className={`${styles.zone} ${active ? styles.active : ""}`}
    aria-label={copy.title} aria-busy={busy}
    onDragEnter={event => {
      if (!isFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      depth.current += 1;
      if (!locked) setActive(true);
    }}
    onDragOver={event => {
      if (!isFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = locked ? "none" : "copy";
    }}
    onDragLeave={event => {
      if (!isFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setActive(false);
    }}
    onDrop={event => {
      if (!isFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      depth.current = 0; setActive(false);
      // read() runs synchronously until its first await, capturing the native
      // entries before this event returns.
      void receive(() => filesFromDrop(event.dataTransfer));
    }}
  >
    {busy ? <LoaderCircle size={21} className={styles.spinner} aria-hidden="true" /> : <Upload size={21} aria-hidden="true" />}
    <strong>{active ? copy.release : copy.title}</strong>
    <p>{copy.hint}</p>
    <small>{copy.formats}</small>
    <div className={styles.actions}>
      <button type="button" disabled={locked} onClick={() => filesInput.current?.click()}>{copy.files}</button>
      <button type="button" disabled={locked} onClick={() => folderInput.current?.click()}><FolderOpen size={13} aria-hidden="true" />{copy.folder}</button>
    </div>
    <input ref={filesInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,.json,.zip,.txt,.names,.yaml,.yml,.plgm" onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length) void receive(async () => files);
    }} />
    <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "", directory: "" }} onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length) void receive(async () => files);
    }} />
    {status && <p className={`${styles.status} ${error ? styles.error : ""}`} role={error ? "alert" : "status"}>{status}</p>}
  </section>;
}

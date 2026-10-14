"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { fill, type Language } from "../lib/i18n";
import { getSamCopy } from "../lib/sam-copy";
import { getInstallationCopy, type InstallationCopy } from "../lib/installation-copy";
import { INSTALL_PLATFORMS, type InstallPlatform } from "../lib/installation-commands";

export function CommandCode({ text, language, title }: { text: string; language: Language; title?: string }) {
  const copy = getSamCopy(language);
  const guide = getInstallationCopy(language);
  const [status, setStatus] = useState<"idle" | "copied" | "selected">("idle");
  const codeRef = useRef<HTMLElement>(null);
  const statusId = useId();
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), status === "copied" ? 2_000 : 8_000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const selectCommand = () => {
    const code = codeRef.current;
    const selection = window.getSelection();
    if (!code || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(range);
    try { if (document.execCommand("copy")) { setStatus("copied"); return; } } catch { /* The selected command can still be copied manually. */ }
    setStatus("selected");
  };
  const copyCommand = () => {
    if (!navigator.clipboard) { selectCommand(); return; }
    navigator.clipboard.writeText(text).then(() => setStatus("copied"), selectCommand);
  };
  const label = status === "copied" ? copy.copiedCommand : copy.copyCommand;
  return <div className="command-copy">
    <code ref={codeRef}>{text}</code>
    <button type="button" onClick={copyCommand} aria-label={title ? fill(guide.copyFor, { action: label, step: title }) : label} aria-describedby={status === "selected" ? statusId : undefined}>
      {status === "copied" ? <Check size={15} /> : <Copy size={15} />}<span>{label}</span>
    </button>
    <span className={status === "selected" ? "command-copy-feedback" : "sr-only"} id={statusId} role="status">
      {status === "selected" ? guide.copyFallback : status === "copied" ? copy.copiedCommand : ""}
    </span>
  </div>;
}

export function InstallationPlatformPicker({ copy, platform, onChange }: { copy: InstallationCopy; platform: InstallPlatform; onChange: (value: InstallPlatform) => void }) {
  return <div className="install-platform-picker" role="group" aria-label={copy.platform}>
    <p>{copy.platform}</p>
    {INSTALL_PLATFORMS.map((value) => <button key={value} type="button" aria-pressed={platform === value} className={platform === value ? "active" : ""} onClick={() => onChange(value)}>{copy[value]}</button>)}
  </div>;
}

export function terminalInstructions(copy: InstallationCopy, platform: InstallPlatform): string {
  return platform === "windows" ? copy.terminalWindows : platform === "wsl" ? copy.terminalWsl : platform === "macos" ? copy.terminalMacos : copy.terminalLinux;
}

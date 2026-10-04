"use client";

import { Check, LoaderCircle, ScanSearch, Undo2, X } from "lucide-react";
import { fill, type Language } from "../../lib/i18n";
import { countAnnotations, getAiCopy } from "../../lib/ai-copy";

export type PreannotateProgress = {
  model: string;
  imageName: string;
  imageIndex: number;
  imageCount: number;
  tilesDone: number;
  tilesTotal: number;
};

/**
 * O que a pré-anotação está fazendo, visível de qualquer imagem.
 *
 * Fica fora do fluxo do editor de propósito: um lote passa por imagens que não
 * estão abertas, e a pessoa precisa saber que algo corre mesmo olhando outra
 * foto. A barra de estado não serve para isso — ela some sob a mensagem
 * seguinte.
 *
 * A fração soma as duas escalas: quantas imagens já saíram, mais o quanto da
 * atual já foi. Sem as partes, uma imagem grande ficaria parada em 0% por
 * dezenas de segundos. Um Contêiner não manda partes, então ali a barra anda
 * de imagem em imagem.
 */
export function PreannotateProgressBar({ progress, language, onCancel }: { progress: PreannotateProgress; language: Language; onCancel: () => void }) {
  const copy = getAiCopy(language);
  const withinImage = progress.tilesTotal > 0 ? progress.tilesDone / progress.tilesTotal : 0;
  const fraction = Math.min(1, (progress.imageIndex - 1 + withinImage) / Math.max(1, progress.imageCount));
  const label = fill(copy.progressLabel, { model: progress.model });
  const detail = [
    progress.imageCount > 1 ? fill(copy.progressImage, { i: progress.imageIndex, n: progress.imageCount }) : null,
    progress.imageName,
    progress.tilesTotal > 0 ? fill(copy.progressTiles, { done: progress.tilesDone, total: progress.tilesTotal }) : null,
  ].filter(Boolean).join(" · ");

  return <div className="ai-run-card" role="status" aria-live="polite">
    <div className="ai-run-head">
      <LoaderCircle className="spin" size={15} />
      <span><b>{label}</b><small>{detail}</small></span>
      <button onClick={onCancel}><X size={14} />{copy.progressCancel}</button>
    </div>
    <div
      className="ai-run-track"
      role="progressbar"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    ><i style={{ width: `${Math.max(2, fraction * 100)}%` }} /></div>
  </div>;
}

export type PreannotateSummary = {
  model: string;
  /** As anotações que esta execução deixou no projeto — é o que "Desfazer" remove. */
  ids: string[];
  images: number;
  failed: string[];
  canceled: boolean;
  replaced: number;
};

/**
 * O fim de cada execução: quanto veio, onde falhou, e a saída de emergência.
 *
 * Desfazer existe aqui porque o Ctrl+Z não serve: uma execução sobre trinta
 * imagens chega em dezenas de passos, e voltar um a um apagaria também o que a
 * pessoa fez entre eles.
 */
export function PreannotateSummaryCard({ summary, language, onKeep, onUndo }: { summary: PreannotateSummary; language: Language; onKeep: () => void; onUndo: () => void }) {
  const copy = getAiCopy(language);
  const count = countAnnotations(copy, summary.ids.length);
  const title = summary.ids.length === 0 && !summary.canceled
    ? fill(copy.sumNone, { model: summary.model })
    : summary.canceled
      ? fill(copy.sumCanceled, { count })
      : summary.images > 1
        ? fill(copy.sumDoneImages, { count, images: summary.images })
        : fill(copy.sumDone, { count });
  const notes = [
    summary.failed.length ? fill(copy.sumFailed, { names: summary.failed.join(", ") }) : null,
    summary.replaced ? fill(copy.sumReplaced, { n: summary.replaced }) : null,
    summary.ids.length ? copy.sumReview : null,
  ].filter(Boolean).join(" ");

  return <div className="ai-run-card done" role="status" aria-live="polite">
    <div className="ai-run-head">
      <ScanSearch size={15} />
      <span><b>{title}</b>{notes && <small>{notes}</small>}</span>
    </div>
    <div className="ai-run-actions">
      {summary.ids.length > 0 && <button onClick={onUndo}><Undo2 size={14} />{copy.sumUndo}</button>}
      <button className="primary" onClick={onKeep}><Check size={14} />{summary.ids.length ? copy.sumKeep : copy.close}</button>
    </div>
  </div>;
}

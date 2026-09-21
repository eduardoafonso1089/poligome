"use client";

import type { Copy } from "../../lib/i18n";

export type RuntimeProgress = {
  imageName: string;
  imageIndex: number;
  imageCount: number;
  tilesDone: number;
  tilesTotal: number;
};

/**
 * O que o runtime está fazendo, visível em cima de tudo.
 *
 * Fica fora do fluxo do editor de propósito: um lote passa por imagens que não
 * estão abertas, e a pessoa precisa saber que algo corre mesmo olhando outra
 * foto. A barra de estado não serve para isso — ela some sob a mensagem
 * seguinte.
 *
 * A fração soma as duas escalas: quantas imagens já saíram, mais o quanto da
 * atual já foi. Sem os tiles, uma imagem grande ficaria parada em 0% por
 * dezenas de segundos.
 */
export function RuntimeProgressBar({ progress, copy }: { progress: RuntimeProgress; copy: Copy }) {
  const withinImage = progress.tilesTotal > 0 ? progress.tilesDone / progress.tilesTotal : 0;
  const fraction = Math.min(1, (progress.imageIndex - 1 + withinImage) / Math.max(1, progress.imageCount));

  const tiles = progress.tilesTotal > 0 ? ` · ${progress.tilesDone}/${progress.tilesTotal}` : "";
  const images = progress.imageCount > 1 ? ` ${progress.imageIndex}/${progress.imageCount}` : "";

  return <div
    className="runtime-progress"
    role="progressbar"
    aria-valuenow={Math.round(fraction * 100)}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={copy.runtimeStream}
  >
    <div className="runtime-progress-fill" style={{ width: `${Math.max(2, fraction * 100)}%` }} />
    <span className="runtime-progress-text">
      {copy.runtimeStream}{images} · {progress.imageName}{tiles}
    </span>
  </div>;
}

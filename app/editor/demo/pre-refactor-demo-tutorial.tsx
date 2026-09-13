"use client";

import { useEffect } from "react";
import { ChevronRight, WandSparkles } from "lucide-react";
import { getCopy, type Language } from "../../lib/i18n";
import type { EditorAnnotation } from "../models/annotation-model";

export type DemoTutorialStep = 0 | 1 | 2 | 3 | 4 | 5;
export type DemoTutorialToolPrompt = "box" | "select" | null;

const tutorialCopy = {
  pt: [
    ["Desenhe uma caixa", "A ferramenta Caixa está destacada acima. Use-a para marcar o telhado iluminado."],
    ["Muito bem!", "Seu polígono foi criado. Quando quiser, avance para ver como editar uma caixa."],
    ["Edite uma caixa", "Arraste um vértice ou o controle de rotação da caixa destacada."],
    ["Próxima imagem", "A caixa foi ajustada. Avance para experimentar uma sugestão de modelo."],
    ["Experimente um modelo local", "Clique na área destacada para simular uma sugestão automática de polígono."],
  ],
  en: [["Draw a box", "The Box tool is highlighted above. Use it to mark the illuminated roof."], ["Great!", "Your box was created. Move on when you are ready to edit a box."], ["Edit a box", "Drag a corner or the rotation control of the highlighted box."], ["Next image", "The box is adjusted. Move on to try a model suggestion."], ["Try a local model", "Click the highlighted area to simulate an automatic polygon suggestion."]],
  fr: [["Dessinez une boîte", "L’outil Boîte est mis en évidence. Utilisez-le sur le toit éclairé."], ["Très bien !", "Votre boîte est créée. Passez à l’image suivante lorsque vous êtes prêt."], ["Modifiez une boîte", "Faites glisser un sommet ou le contrôle de rotation de la boîte."], ["Image suivante", "La boîte est ajustée. Passez à la suggestion du modèle."], ["Essayez un modèle local", "Cliquez sur la zone mise en évidence pour simuler une suggestion automatique."]],
  es: [["Dibuja una caja", "La herramienta Caja está resaltada arriba. Úsala sobre el tejado iluminado."], ["¡Muy bien!", "Tu caja fue creada. Avanza cuando quieras editar una caja."], ["Edita una caja", "Arrastra un vértice o el control de rotación de la caja resaltada."], ["Siguiente imagen", "La caja está ajustada. Avanza para probar una sugerencia."], ["Prueba un modelo local", "Haz clic en el área resaltada para simular una sugerencia automática."]],
} as const;

const tutorialNext = { pt: "Próximo", en: "Next", fr: "Suivant", es: "Siguiente" } as const;
const tutorialModels = { pt: "Conhecer modelos locais", en: "Explore local models", fr: "Découvrir les modèles locaux", es: "Conocer modelos locales" } as const;
const tutorialClickHere = { pt: "Clique aqui", en: "Click here", fr: "Cliquez ici", es: "Haz clic aquí" } as const;
const tutorialDrawHere = { pt: "Desenhe aqui", en: "Draw here", fr: "Dessinez ici", es: "Dibuja aquí" } as const;
const tutorialModifyHere = { pt: "Modifique aqui", en: "Edit here", fr: "Modifiez ici", es: "Modifica aquí" } as const;
const tutorialClickPoint = { pt: "Clique no ponto", en: "Click the point", fr: "Cliquez sur le point", es: "Haz clic en el punto" } as const;
const tutorialToolCopy = {
  pt: { box: ["Selecione a ferramenta Caixa", "Clique na ferramenta destacada para começar."], select: ["Selecione a ferramenta de movimentação", "Clique na ferramenta Selecionar destacada para editar a caixa."] },
  en: { box: ["Select the Box tool", "Click the highlighted tool to begin."], select: ["Select the move tool", "Click the highlighted Select tool to edit the box."] },
  fr: { box: ["Sélectionnez l’outil Boîte", "Cliquez sur l’outil mis en évidence pour commencer."], select: ["Sélectionnez l’outil de déplacement", "Cliquez sur l’outil Sélection mis en évidence pour modifier la boîte."] },
  es: { box: ["Selecciona la herramienta Caja", "Haz clic en la herramienta resaltada para empezar."], select: ["Selecciona la herramienta de movimiento", "Haz clic en la herramienta Seleccionar resaltada para editar la caja."] },
} as const;

export const tutorialWrongDraw = {
  pt: "A anotação ficou fora do telhado destacado. Tente novamente.",
  en: "The annotation is outside the highlighted roof. Try again.",
  fr: "L’annotation est hors du toit mis en évidence. Réessayez.",
  es: "La anotación está fuera del tejado resaltado. Inténtalo de nuevo.",
} as const;

function scales(imageSize: { width: number; height: number }) {
  return { sx: imageSize.width / 1000, sy: imageSize.height / 650 };
}

function boxCorners(annotation: Extract<EditorAnnotation, { type: "box" }>) {
  const rotation = annotation.rotation ?? 0;
  const centerX = annotation.x + annotation.width / 2;
  const centerY = annotation.y + annotation.height / 2;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return [
    [annotation.x, annotation.y],
    [annotation.x + annotation.width, annotation.y],
    [annotation.x + annotation.width, annotation.y + annotation.height],
    [annotation.x, annotation.y + annotation.height],
  ].map(([x, y]) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return { x: centerX + dx * cosine - dy * sine, y: centerY + dx * sine + dy * cosine };
  });
}

function annotationBounds(annotation: EditorAnnotation) {
  if (annotation.type === "box") {
    const corners = boxCorners(annotation);
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  if (annotation.type === "polygon" || annotation.type === "line") {
    const xs = annotation.vertices.map((vertex) => vertex.x);
    const ys = annotation.vertices.map((vertex) => vertex.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  return { x: Math.max(0, annotation.x - 4), y: Math.max(0, annotation.y - 4), width: 8, height: 8 };
}

export function annotationIntersectsDemoRoof(annotation: EditorAnnotation, imageSize: { width: number; height: number }) {
  const { sx, sy } = scales(imageSize);
  const rect = { x: 357 * sx, y: 68 * sy, width: 211 * sx, height: 214 * sy };
  const bounds = annotationBounds(annotation);
  return bounds.x <= rect.x + rect.width && bounds.x + bounds.width >= rect.x &&
    bounds.y <= rect.y + rect.height && bounds.y + bounds.height >= rect.y;
}

export function tutorialEditBox(reference: EditorAnnotation | undefined, imageSize: { width: number; height: number }) {
  if (!reference || reference.type !== "box") return null;
  const { sx, sy } = scales(imageSize);
  return { ...reference, x: 112 * sx, y: 414 * sy, width: 120 * sx, height: 112 * sy, rotation: 0.42 } satisfies EditorAnnotation;
}

export function tutorialEditBoxChanged(annotation: EditorAnnotation | undefined, imageSize: { width: number; height: number }) {
  if (!annotation || annotation.type !== "box") return false;
  const { sx, sy } = scales(imageSize);
  return annotation.x !== 112 * sx || annotation.y !== 414 * sy || annotation.width !== 120 * sx || annotation.height !== 112 * sy || (annotation.rotation ?? 0) !== 0.42;
}

export function tutorialModelSuggestion(reference: EditorAnnotation | undefined, id: string): EditorAnnotation | null {
  if (!reference || reference.type !== "polygon") return null;
  return {
    ...reference,
    id,
    vertices: reference.vertices.map((vertex, index) => ({ ...vertex, id: `${id}:outer:v${index}` })),
    holes: reference.holes.map((hole, holeIndex) => hole.map((vertex, vertexIndex) => ({ ...vertex, id: `${id}:hole-${holeIndex}:v${vertexIndex}` }))),
  };
}

export function isTutorialModelPoint(point: { x: number; y: number }, imageSize: { width: number; height: number }) {
  const { sx, sy } = scales(imageSize);
  return point.x >= 460 * sx && point.x <= 580 * sx && point.y >= 340 * sy && point.y <= 515 * sy;
}

export function DemoTutorialOverlay({ step, toolPrompt, imageSize }: {
  step: DemoTutorialStep | null;
  toolPrompt: DemoTutorialToolPrompt;
  imageSize: { width: number; height: number };
}) {
  if (step === null) return null;
  const { sx, sy } = scales(imageSize);
  const fontScale = Math.min(sx, sy);
  const hint = step === 0 ? { x: 405, y: 112, text: tutorialDrawHere } : step === 2 ? { x: 112, y: 438, text: tutorialModifyHere } : { x: 460, y: 365, text: tutorialClickPoint };
  const showTarget = (((step === 0 || step === 2) && toolPrompt === null) || step === 4);
  return <>
    {showTarget && <>
      <mask id="demo-tutorial-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
        <rect width={imageSize.width} height={imageSize.height} fill="white" />
        {step === 0 && <polygon points={`${357 * sx},${68 * sy} ${568 * sx},${72 * sy} ${567 * sx},${282 * sy} ${357 * sx},${277 * sy}`} fill="black" />}
        {step === 2 && <rect x={92 * sx} y={394 * sy} width={160 * sx} height={152 * sy} rx={12 * fontScale} fill="black" />}
        {step === 4 && <rect x={460 * sx} y={340 * sy} width={120 * sx} height={175 * sy} rx={10 * fontScale} fill="black" />}
      </mask>
      <rect className="demo-tutorial-image-dim" width={imageSize.width} height={imageSize.height} mask="url(#demo-tutorial-mask)" />
      {step === 0 && <polygon className="demo-tutorial-target" points={`${357 * sx},${68 * sy} ${568 * sx},${72 * sy} ${567 * sx},${282 * sy} ${357 * sx},${277 * sy}`} />}
      {step === 2 && <rect className="demo-tutorial-target" x={92 * sx} y={394 * sy} width={160 * sx} height={152 * sy} rx={12 * fontScale} />}
      {step === 4 && <><rect className="demo-tutorial-model-region" x={460 * sx} y={340 * sy} width={120 * sx} height={175 * sy} rx={10 * fontScale} /><circle className="demo-tutorial-model-point" cx={525 * sx} cy={422 * sy} r={10 * fontScale} /></>}
      <g className="demo-tutorial-click-hint" transform={`translate(${hint.x * sx} ${hint.y * sy})`}>
        <rect x="0" y="0" width={120 * sx} height={30 * sy} rx={15 * fontScale} />
        <text x={60 * sx} y={20 * sy} textAnchor="middle" fontSize={12 * fontScale}>{hint.text.pt}</text>
      </g>
    </>}
  </>;
}

export function DemoTutorialChrome({ step, toolPrompt, language, onNextToEdit, onNextToModel, onExploreModels, onClose }: {
  step: DemoTutorialStep | null;
  toolPrompt: DemoTutorialToolPrompt;
  language: Language;
  onNextToEdit: () => void;
  onNextToModel: () => void;
  onExploreModels: () => void;
  onClose: () => void;
}) {
  const copy = getCopy(language);

  useEffect(() => {
    if (!toolPrompt || step === null) return;
    const label = toolPrompt === "box" ? copy.box : copy.select;
    const target = Array.from(document.querySelectorAll<HTMLElement>(".tools .tool-btn")).find((element) => element.getAttribute("aria-label") === label) ?? null;
    if (!target) return;
    target.classList.add("demo-tutorial-tool-target");
    const root = document.documentElement;
    const updatePosition = () => {
      const bounds = target.getBoundingClientRect();
      root.style.setProperty("--demo-tutorial-tool-x", `${Math.round(bounds.left + bounds.width / 2)}px`);
      root.style.setProperty("--demo-tutorial-tool-y", `${Math.round(bounds.bottom + 12)}px`);
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(target);
    window.addEventListener("resize", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      target.classList.remove("demo-tutorial-tool-target");
      root.style.removeProperty("--demo-tutorial-tool-x");
      root.style.removeProperty("--demo-tutorial-tool-y");
    };
  }, [copy.box, copy.select, step, toolPrompt]);

  useEffect(() => {
    const root = document.documentElement;
    if (step === null || step < 2) {
      delete root.dataset.demoTutorialCard;
      root.style.removeProperty("--demo-tutorial-card-top");
      return;
    }
    root.dataset.demoTutorialCard = "top";
    const controls = document.querySelector<HTMLElement>(".editor-controls");
    const updatePosition = () => root.style.setProperty("--demo-tutorial-card-top", `${Math.ceil((controls?.getBoundingClientRect().bottom ?? 118) + 8)}px`);
    updatePosition();
    const observer = controls ? new ResizeObserver(updatePosition) : null;
    if (controls) observer?.observe(controls);
    window.addEventListener("resize", updatePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      delete root.dataset.demoTutorialCard;
      root.style.removeProperty("--demo-tutorial-card-top");
    };
  }, [step]);

  if (step === null) return null;
  const title = toolPrompt ? tutorialToolCopy[language][toolPrompt][0] : tutorialCopy[language][Math.min(step, 4)][0];
  const detail = toolPrompt ? tutorialToolCopy[language][toolPrompt][1] : step < 5 ? tutorialCopy[language][step][1] : copy.sam;
  return <>
    {toolPrompt && <div className="demo-tutorial-tool-hint" aria-hidden="true"><span>{tutorialClickHere[language]}</span></div>}
    <section className="demo-tutorial-card" role="dialog" aria-live="polite" data-demo-tutorial-step={step}>
      <span>{step < 2 ? "1 / 3" : step < 4 ? "2 / 3" : "3 / 3"}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {step === 1 && <button onClick={onNextToEdit}><ChevronRight size={15} />{tutorialNext[language]}</button>}
      {step === 3 && <button onClick={onNextToModel}><ChevronRight size={15} />{tutorialNext[language]}</button>}
      {step === 5 && <button onClick={onExploreModels}><WandSparkles size={15} />{tutorialModels[language]}</button>}
      {step !== 5 && <button className="demo-tutorial-skip" aria-label={copy.close} onClick={onClose}>{copy.close}</button>}
    </section>
  </>;
}

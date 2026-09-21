"use client";

/**
 * Cliente do poligome-runtime.
 *
 * Diferente do BYOM, que devolve um documento COCO inteiro no fim, aqui o
 * resultado chega em pedaços: cada tile que o runtime termina vira um evento,
 * e o canvas pode desenhar antes da varredura acabar.
 *
 * O contrato é `protocol/src/index.ts` do poligome-runtime. Os tipos abaixo são
 * uma cópia mínima do que o editor consome — quando os dois discordarem, o
 * contrato é quem está certo.
 *
 * Nada aqui inicia processo: o runtime é um programa na máquina de quem anota,
 * e a página só conversa com ele em 127.0.0.1.
 */

export const DEFAULT_RUNTIME_ENDPOINT = "http://127.0.0.1:7861";

export type RuntimePoint = { x: number; y: number };
export type RuntimeRect = { x: number; y: number; width: number; height: number };

export type RuntimeMask = {
  bounds: RuntimeRect;
  /** Grade do RLE. Menor que `bounds` quando o runtime reduziu o recorte. */
  width: number;
  height: number;
  /** Runs alternando fundo e frente, começando sempre pelo fundo. */
  rle: number[];
};

export type RuntimeAnnotation =
  | { kind: "box"; box: RuntimeRect; rotation?: number; label?: string; score?: number }
  | { kind: "polygon"; vertices: RuntimePoint[]; label?: string; score?: number }
  | { kind: "polyline"; vertices: RuntimePoint[]; label?: string; score?: number }
  | { kind: "keypoint"; at: RuntimePoint; label?: string; score?: number }
  | { kind: "mask"; mask: RuntimeMask; label?: string; score?: number };

export type RuntimeEvent =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; annotations: RuntimeAnnotation[]; partial: boolean }
  | { type: "error"; error: { code: string; message: string } };

export type RuntimeParamSpec =
  | { key: string; label: string; type: "number"; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: "boolean"; default: boolean }
  | { key: string; label: string; type: "enum"; options: string[]; default: string };

export type RuntimeManifest = {
  protocol: string;
  id: string;
  name: string;
  version: string;
  license?: string;
  produces: string[];
  accepts: string[];
  stateful: boolean;
  tiling: string;
  maxEdge: number;
  params?: RuntimeParamSpec[];
};

export type RuntimePrompt =
  | { kind: "points"; points: Array<{ at: RuntimePoint; positive: boolean }> }
  | { kind: "box"; box: RuntimeRect }
  | { kind: "text"; text: string };

export type RuntimeHealth = { service: string; protocol: string; status: string; images: number };

/** Erro do runtime, com o código do contrato preservado para a interface decidir. */
export class RuntimeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

function base(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

async function detailOf(response: Response): Promise<RuntimeError> {
  const body = await response.json().catch(() => null) as
    | { error?: { code?: unknown; message?: unknown } }
    | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "internal";
  const message = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
  return new RuntimeError(code, message);
}

/**
 * Confere que há um runtime do outro lado, e não outro serviço na mesma porta.
 * Sem esta checagem o editor anunciaria "pronto" para qualquer coisa que atenda.
 */
export async function fetchRuntimeHealth(
  endpoint: string,
  timeoutMs = 4_000,
): Promise<RuntimeHealth | null> {
  try {
    const response = await fetch(`${base(endpoint)}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = await response.json() as RuntimeHealth;
    return body?.service === "poligome-runtime" ? body : null;
  } catch {
    return null;
  }
}

export async function fetchRuntimeManifest(
  endpoint: string,
  timeoutMs = 6_000,
): Promise<RuntimeManifest | null> {
  try {
    const response = await fetch(`${base(endpoint)}/describe`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json() as RuntimeManifest;
  } catch {
    return null;
  }
}

/**
 * Sobe os bytes da imagem uma vez. Toda inferência seguinte cita o `id`.
 *
 * É a diferença que paga o transporte: o caminho SAM atual reenvia a imagem
 * inteira em base64 a cada clique, e um recorte no limite de 12 MP vira 34 MB
 * por chamada.
 */
export async function registerRuntimeImage(
  endpoint: string,
  imageId: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<{ id: string; width: number; height: number }> {
  const response = await fetch(`${base(endpoint)}/images/${encodeURIComponent(imageId)}`, {
    method: "PUT",
    body: blob,
    signal,
  });
  if (!response.ok) throw await detailOf(response);
  return await response.json() as { id: string; width: number; height: number };
}

export async function dropRuntimeImage(endpoint: string, imageId: string): Promise<void> {
  await fetch(`${base(endpoint)}/images/${encodeURIComponent(imageId)}`, { method: "DELETE" })
    .catch(() => undefined);
}

/**
 * Divide um fluxo SSE em eventos.
 *
 * Um frame só está completo na linha em branco, e um chunk da rede corta em
 * qualquer lugar — inclusive no meio de um número. Guardar o resto entre chunks
 * é o que impede um JSON.parse em metade de um evento.
 */
export async function* parseEventStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<RuntimeEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const line = frame.split("\n").find((candidate) => candidate.startsWith("data: "));
        if (line) yield JSON.parse(line.slice(6)) as RuntimeEvent;
        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export type InferOptions = {
  endpoint: string;
  imageId: string;
  region?: RuntimeRect;
  prompt?: RuntimePrompt;
  params?: Record<string, number | boolean | string>;
  signal?: AbortSignal;
};

/**
 * A inferência, como o contrato a define: um verbo, eventos saindo.
 *
 * Usa fetch e não EventSource porque a requisição leva corpo e EventSource só
 * faz GET. A troca é boa: o `signal` cancela de verdade, e o runtime para de
 * trabalhar quando a conexão cai.
 */
export async function* runtimeInfer(options: InferOptions): AsyncGenerator<RuntimeEvent> {
  const response = await fetch(`${base(options.endpoint)}/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: { id: options.imageId },
      region: options.region,
      prompt: options.prompt,
      params: options.params,
    }),
    signal: options.signal,
  });

  if (!response.ok) throw await detailOf(response);
  if (!response.body) throw new RuntimeError("internal", "o runtime respondeu sem corpo");

  yield* parseEventStream(response.body, options.signal);
}

/** Decodifica o RLE do contrato: runs alternando fundo e frente, fundo primeiro. */
export function decodeRle(rle: readonly number[], width: number, height: number): Uint8Array {
  const flat = new Uint8Array(width * height);
  let cursor = 0;
  let foreground = false;
  for (const run of rle) {
    if (foreground) flat.fill(1, cursor, cursor + run);
    cursor += run;
    foreground = !foreground;
  }
  return flat;
}

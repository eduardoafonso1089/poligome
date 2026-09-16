"use client";

import type { ByomModel } from "./sam-models";

/**
 * Cliente do conector local. Tudo aqui fala com 127.0.0.1 e com mais nada: o
 * conector é um processo na máquina do usuário, e é ele — nunca esta página —
 * que carrega o modelo e conversa com o Docker.
 *
 * Nenhuma função aqui inicia coisa alguma. Uma página web não cria processo
 * local nem sobe contêiner, então o máximo que se pode fazer é procurar o que já
 * está no ar e pedir a ele que troque de modelo.
 */

export const DEFAULT_SAM_ENDPOINT = "http://127.0.0.1:7860/predict";

export type ConnectorStatus = "loading" | "ready" | "error";

export type ConnectorHealth = {
  service?: string;
  api_version?: number;
  status?: ConnectorStatus;
  model_id?: string | null;
  family?: string | null;
  device?: string | null;
  error?: string | null;
};

export type ModelAvailability = {
  model_id: string;
  family: string;
  installed: boolean;
  unavailable_reason?: string | null;
};

export type ModelsResponse = {
  loaded_model_id?: string | null;
  status?: ConnectorStatus;
  switching_to?: string | null;
  models?: ModelAvailability[];
};

/**
 * O modal guarda o endereço de /predict porque é ele que a inferência usa; as
 * rotas de catálogo moram na mesma origem, uma pasta acima.
 */
export function connectorBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function fetchHealth(base: string, timeoutMs = 4_000): Promise<ConnectorHealth | null> {
  if (!base) return null;
  const payload = await getJson<ConnectorHealth>(`${base}/health`, timeoutMs);
  // Um 200 de outro serviço na mesma porta não vale como conector: sem essa
  // conferência o editor anunciaria "pronto" para qualquer coisa que atenda.
  if (!payload || payload.service !== "Poligome SAM local" || payload.api_version !== 2) return null;
  return payload;
}

export async function fetchModels(base: string, timeoutMs = 6_000): Promise<ModelsResponse | null> {
  if (!base) return null;
  return getJson<ModelsResponse>(`${base}/models`, timeoutMs);
}

export async function fetchByomModels(base: string, timeoutMs = 8_000): Promise<readonly ByomModel[]> {
  if (!base) return [];
  const payload = await getJson<{ models?: ByomModel[] }>(`${base}/byom/models`, timeoutMs);
  return (payload?.models ?? []).filter((entry) => typeof entry.model_id === "string");
}

/** Detalhe de erro do conector, que é escrito para o usuário e sai como está. */
async function detailOf(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: unknown } | null;
  return typeof body?.detail === "string" ? body.detail : `HTTP ${response.status}`;
}

export type LoadOutcome = { ok: true; switching: boolean } | { ok: false; detail: string };

export async function requestModelLoad(base: string, modelId: string): Promise<LoadOutcome> {
  if (!base) return { ok: false, detail: "conector não encontrado." };
  try {
    const response = await fetch(`${base}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: modelId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, detail: await detailOf(response) };
    const body = await response.json() as { switching?: boolean };
    return { ok: true, switching: Boolean(body.switching) };
  } catch {
    return { ok: false, detail: "o conector não respondeu ao pedido de troca." };
  }
}

/**
 * A troca derruba e recarrega o processo do conector, então a porta fica
 * indisponível por instantes: sumir do ar faz parte do caminho feliz e só vira
 * falha quando o prazo acaba.
 */
export async function waitForModel(
  base: string,
  modelId: string,
  { timeoutMs = 180_000, gaveUpAfterMs = 45_000, onTick }: {
    timeoutMs?: number;
    gaveUpAfterMs?: number;
    onTick?: (health: ConnectorHealth | null) => void;
  } = {},
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const deadline = Date.now() + timeoutMs;
  let downSince: number | null = null;
  while (Date.now() < deadline) {
    const health = await fetchHealth(base, 3_000);
    onTick?.(health);
    if (health) {
      downSince = null;
      if (health.model_id === modelId) {
        if (health.status === "ready") return { ok: true };
        if (health.status === "error") return { ok: false, detail: health.error || "o modelo falhou ao carregar." };
      }
    } else {
      // Sumir por instantes é o caminho feliz: o conector está se recarregando.
      // Sumir e não voltar é outra coisa, e esperar o prazo inteiro por isso deixa
      // o usuário olhando um spinner sem saber que ninguém vai atender.
      downSince ??= Date.now();
      if (Date.now() - downSince > gaveUpAfterMs) {
        return {
          ok: false,
          detail: "o conector saiu para trocar de modelo e não voltou. Quem o relança é a janela que o iniciou: confira se ela continua aberta.",
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
  return { ok: false, detail: "a troca de modelo excedeu o tempo de espera." };
}

export type ByomRegisterEntry = { modelId: string; name: string; port: number; notes?: string };

export async function registerByomModel(base: string, entry: ByomRegisterEntry): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!base) return { ok: false, detail: "conector não encontrado." };
  try {
    const response = await fetch(`${base}/byom/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // O conector proíbe campos extras neste corpo, e a porta vai como número:
      // é ele quem monta o endpoint, sempre preso a 127.0.0.1.
      body: JSON.stringify({
        model_id: entry.modelId,
        name: entry.name || entry.modelId,
        port: entry.port,
        notes: entry.notes ?? "",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, detail: await detailOf(response) };
    return { ok: true };
  } catch {
    return { ok: false, detail: "o conector não respondeu ao registro." };
  }
}

export async function removeByomModel(base: string, modelId: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!base) return { ok: false, detail: "conector não encontrado." };
  try {
    const response = await fetch(`${base}/byom/models/${encodeURIComponent(modelId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, detail: await detailOf(response) };
    return { ok: true };
  } catch {
    return { ok: false, detail: "o conector não respondeu à remoção." };
  }
}

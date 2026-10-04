"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_RUNTIME_ENDPOINT,
  RUNTIME_ENDPOINT_KEY,
  fetchRuntimeHealth,
  fetchRuntimeManifest,
  type RuntimeManifest,
} from "../../lib/runtime-client";

export type RuntimeState = "checking" | "ready" | "offline";

export function storedRuntimeEndpoint(): string {
  try {
    return localStorage.getItem(RUNTIME_ENDPOINT_KEY) || DEFAULT_RUNTIME_ENDPOINT;
  } catch {
    return DEFAULT_RUNTIME_ENDPOINT;
  }
}

/**
 * O Poligome Runtime visto da página: onde ele atende, se respondeu e qual
 * modelo serve.
 *
 * O runtime serve um modelo por vez, descrito pelo manifest de `/describe`. É
 * esse manifest que diz o que oferecer na tela — região, ajustes, tiles — em
 * vez de a interface prometer o que o modelo carregado não faz.
 *
 * Como o catálogo do conector, a sondagem se repete quando a aba volta ao foco:
 * é o momento em que alguém acabou de iniciar o runtime em outra janela.
 */
export function useRuntimeStatus(active: boolean) {
  // Lido na criação pelo mesmo motivo do catálogo do conector: trocar o
  // endereço num efeito faria duas sondagens disputarem quem escreve por último.
  const [endpoint, setEndpointState] = useState(() => typeof window === "undefined" ? DEFAULT_RUNTIME_ENDPOINT : storedRuntimeEndpoint());
  const [state, setState] = useState<RuntimeState>("checking");
  const [manifest, setManifest] = useState<RuntimeManifest | null>(null);

  const setEndpoint = useCallback((value: string) => {
    setEndpointState(value);
    try { localStorage.setItem(RUNTIME_ENDPOINT_KEY, value); } catch { /* vale só para esta aba */ }
  }, []);

  // Só a sondagem mais recente escreve: uma antiga, ainda pendurada no
  // endereço anterior, não pode sobrescrever o que a nova encontrou.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    setState((current) => (current === "ready" ? current : "checking"));
    const health = await fetchRuntimeHealth(endpoint);
    if (mine !== latest.current) return;
    if (!health) { setState("offline"); setManifest(null); return; }
    const described = await fetchRuntimeManifest(endpoint);
    if (mine !== latest.current) return;
    setManifest(described);
    setState("ready");
  }, [endpoint]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active, refresh]);

  return { endpoint, setEndpoint, state, manifest, refresh };
}

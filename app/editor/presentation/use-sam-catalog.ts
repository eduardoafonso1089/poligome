"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SAM_ENDPOINT,
  connectorBaseUrl,
  fetchByomModels,
  fetchHealth,
  fetchModels,
  registerByomModel,
  removeByomModel,
  requestModelLoad,
  waitForModel,
  type ByomRegisterEntry,
  type ConnectorHealth,
} from "../../lib/sam-connector";
import { DEFAULT_SAM_MODEL_ID, isByomModelId, isSamModelId } from "../../lib/sam-models";
import type { ByomModel } from "../../lib/sam-models";

export type ConnectionState = "idle" | "checking" | "loading" | "ready" | "error" | "offline";

const MODEL_KEY = "poligome-sam-model";
const BYOM_KEY = "poligome-byom-model";
const ENDPOINT_KEY = "poligome-sam-endpoint";

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Janela anônima, ou armazenamento bloqueado: a escolha vale para esta aba.
  }
}

function describeRuntime(health: ConnectorHealth | null): string {
  if (!health) return "";
  if (health.status === "error") return health.error || "o modelo falhou ao carregar";
  const parts = [health.model_id, health.family, health.device].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Estado do catálogo de modelos: o que o conector tem instalado, o que está
 * carregado agora e quais contêineres BYOM estão registrados.
 *
 * A sondagem se repete quando a aba volta ao foco, porque é aí que algo pode ter
 * mudado do lado de fora — o caso típico é sair da aba para iniciar o conector e
 * voltar. Nessa segunda passada uma aba já conectada não readota o modelo nem
 * reativa a seleção, o que desfaria um "desselecionar todos": ela só reconfere a
 * saúde e atualiza a lista de contêineres.
 */
export function useSamCatalog(active: boolean) {
  const [endpoint, setEndpointState] = useState(DEFAULT_SAM_ENDPOINT);
  const [selectedModelId, setSelectedModelIdState] = useState<string>(DEFAULT_SAM_MODEL_ID);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [runtimeLabel, setRuntimeLabel] = useState("");
  const [byomModels, setByomModels] = useState<readonly ByomModel[]>([]);
  const [byomModelId, setByomModelIdState] = useState<string | null>(null);
  const [byomBusy, setByomBusy] = useState(false);
  const [samActive, setSamActive] = useState(false);
  // Uma troca em andamento não pode ser atropelada por uma sondagem de rotina,
  // que veria a porta fora do ar e declararia offline no meio do caminho.
  const switching = useRef(false);

  useEffect(() => {
    const storedEndpoint = readStored(ENDPOINT_KEY);
    if (storedEndpoint) setEndpointState(storedEndpoint);
    const storedModel = readStored(MODEL_KEY);
    if (isSamModelId(storedModel)) setSelectedModelIdState(storedModel);
    const storedByom = readStored(BYOM_KEY);
    if (isByomModelId(storedByom)) setByomModelIdState(storedByom);
  }, []);

  const setEndpoint = useCallback((value: string) => {
    setEndpointState(value);
    writeStored(ENDPOINT_KEY, value);
  }, []);

  const setSelectedModelId = useCallback((value: string) => {
    setSelectedModelIdState(value);
    writeStored(MODEL_KEY, value);
  }, []);

  const setByomModelId = useCallback((value: string | null) => {
    setByomModelIdState(value);
    writeStored(BYOM_KEY, value);
  }, []);

  const refresh = useCallback(async (adopt: boolean) => {
    if (switching.current) return;
    const base = connectorBaseUrl(endpoint);
    const health = await fetchHealth(base);
    if (!health) {
      setConnectionState("offline");
      setLoadedModelId(null);
      setRuntimeLabel("");
      setByomModels([]);
      return;
    }
    setLoadedModelId(health.model_id ?? null);
    setRuntimeLabel(describeRuntime(health));
    setConnectionState(health.status === "ready" ? "ready" : health.status === "loading" ? "loading" : "error");
    // Adotar o modelo que já está carregado evita uma troca de três a nove
    // segundos que ninguém pediu; só vale na primeira passada.
    if (adopt && health.status === "ready" && isSamModelId(health.model_id)) {
      setSelectedModelId(health.model_id);
      setSamActive(true);
    }

    const [, containers] = await Promise.all([fetchModels(base), fetchByomModels(base)]);
    setByomModels(containers);
    if (adopt) {
      setByomModelIdState((current) => {
        if (current && containers.some((entry) => entry.model_id === current && entry.ready)) return current;
        // Com um único contêiner disponível e nenhuma escolha anterior, adotá-lo
        // é óbvio; com vários, escolher por conta seria chutar.
        const ready = containers.filter((entry) => entry.ready);
        return ready.length === 1 && !current ? ready[0].model_id : current;
      });
    }
  }, [endpoint, setSelectedModelId]);

  useEffect(() => {
    if (!active) return;
    setConnectionState((current) => (current === "idle" || current === "offline" ? "checking" : current));
    void refresh(true);
  }, [active, refresh]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(false); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  /** Carrega no conector o modelo escolhido, ou apenas o adota se já for o dele. */
  const connect = useCallback(async () => {
    const base = connectorBaseUrl(endpoint);
    setConnectionState("checking");
    const health = await fetchHealth(base);
    if (!health) {
      setConnectionState("offline");
      setRuntimeLabel("");
      return;
    }
    if (health.model_id === selectedModelId && health.status === "ready") {
      setLoadedModelId(health.model_id ?? null);
      setRuntimeLabel(describeRuntime(health));
      setConnectionState("ready");
      setSamActive(true);
      return;
    }

    switching.current = true;
    setConnectionState("loading");
    setRuntimeLabel(`carregando ${selectedModelId}…`);
    const outcome = await requestModelLoad(base, selectedModelId);
    if (!outcome.ok) {
      switching.current = false;
      setConnectionState("error");
      setRuntimeLabel(outcome.detail);
      return;
    }
    const settled = await waitForModel(base, selectedModelId, {
      onTick: (tick) => { if (tick) setRuntimeLabel(describeRuntime(tick)); },
    });
    switching.current = false;
    if (!settled.ok) {
      setConnectionState("error");
      setRuntimeLabel(settled.detail);
      return;
    }
    setLoadedModelId(selectedModelId);
    setConnectionState("ready");
    setSamActive(true);
    await refresh(false);
  }, [endpoint, refresh, selectedModelId]);

  const registerByom = useCallback(async (entry: ByomRegisterEntry) => {
    const base = connectorBaseUrl(endpoint);
    setByomBusy(true);
    const outcome = await registerByomModel(base, entry);
    setByomBusy(false);
    if (!outcome.ok) {
      setConnectionState("error");
      setRuntimeLabel(outcome.detail);
      return;
    }
    await refresh(false);
  }, [endpoint, refresh]);

  const removeByom = useCallback(async (modelId: string) => {
    const base = connectorBaseUrl(endpoint);
    setByomBusy(true);
    const outcome = await removeByomModel(base, modelId);
    setByomBusy(false);
    if (!outcome.ok) {
      setConnectionState("error");
      setRuntimeLabel(outcome.detail);
      return;
    }
    if (byomModelId === modelId) setByomModelId(null);
    await refresh(false);
  }, [byomModelId, endpoint, refresh, setByomModelId]);

  /** Deixa de usar SAM e BYOM para anotar; nada é desinstalado nem desconectado. */
  const unselectAll = useCallback(() => {
    setSamActive(false);
    setByomModelId(null);
  }, [setByomModelId]);

  const activeByomModel = byomModels.find((candidate) => candidate.model_id === byomModelId) ?? null;

  return {
    endpoint, setEndpoint,
    selectedModelId, setSelectedModelId,
    loadedModelId, connectionState, runtimeLabel,
    byomModels, byomModelId, setByomModelId, byomBusy, activeByomModel,
    // Carregado no conector e em uso para anotar sao coisas diferentes: depois de
    // "desselecionar todos" o modelo continua carregado, e so deixa de ser usado.
    samActive,
    connect, registerByom, removeByom, unselectAll,
    anyModelSelected: (samActive && connectionState === "ready") || activeByomModel !== null,
  };
}

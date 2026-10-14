"use client";

import { useEffect, useState } from "react";

/**
 * A permissão de "acesso à rede local" do Chrome para esta página.
 *
 * Uma página pública que chama 127.0.0.1 faz o Chrome abrir um aviso pedindo
 * permissão. Enquanto ninguém responde, o fetch fica pendurado até o prazo da
 * sondagem e a tela dizia "Conector desligado" com o conector no ar; depois de
 * "Permitir", nada voltava a sondar. Saber o estado da permissão é o que deixa a
 * tela dizer o que falta e voltar a sondar no instante em que ela é concedida.
 *
 * "unsupported" cobre navegadores sem essa permissão (Firefox, Safari, Chrome
 * antigo): neles nada muda.
 */
export type LocalNetworkAccess = "granted" | "prompt" | "denied" | "unsupported";

export function useLocalNetworkAccess(active: boolean): LocalNetworkAccess {
  const [state, setState] = useState<LocalNetworkAccess>("unsupported");

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let disposed = false;
    const sync = () => { if (status && !disposed) setState(status.state as LocalNetworkAccess); };
    navigator.permissions
      // O nome ainda não está nos tipos do DOM.
      .query({ name: "local-network-access" as PermissionName })
      .then((result) => {
        if (disposed) return;
        status = result;
        sync();
        result.addEventListener("change", sync);
      })
      .catch(() => { /* Navegador sem essa permissão: segue "unsupported". */ });
    return () => {
      disposed = true;
      status?.removeEventListener("change", sync);
    };
  }, [active]);

  return state;
}

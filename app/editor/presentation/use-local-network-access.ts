"use client";

import { useEffect, useState } from "react";
import { queryLocalNetworkPermission } from "../../lib/local-network-access";

/**
 * A permissão de acesso ao conector local para esta página.
 *
 * Uma página pública que chama 127.0.0.1 pode abrir um aviso no navegador pedindo
 * permissão. Enquanto ninguém responde, o fetch fica pendurado até o prazo da
 * sondagem e a tela dizia "Conector desligado" com o conector no ar; depois de
 * "Permitir", nada voltava a sondar. Saber o estado da permissão é o que deixa a
 * tela dizer o que falta e voltar a sondar no instante em que ela é concedida.
 *
 * Firefox e Chromium recentes separam loopback de rede local. "unsupported"
 * cobre navegadores que não expõem nenhum dos nomes conhecidos.
 */
export type LocalNetworkAccess = "granted" | "prompt" | "denied" | "unsupported";

export function useLocalNetworkAccess(active: boolean): LocalNetworkAccess {
  const [state, setState] = useState<LocalNetworkAccess>("unsupported");

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let disposed = false;
    const sync = () => { if (status && !disposed) setState(status.state as LocalNetworkAccess); };
    queryLocalNetworkPermission(navigator.permissions)
      .then((result) => {
        if (disposed) return;
        if (!result) {
          setState("unsupported");
          return;
        }
        status = result;
        sync();
        result.addEventListener("change", sync);
      });
    return () => {
      disposed = true;
      status?.removeEventListener("change", sync);
    };
  }, [active]);

  return state;
}

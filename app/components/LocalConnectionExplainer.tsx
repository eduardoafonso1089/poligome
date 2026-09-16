"use client";

import type { Copy } from "../lib/i18n";

/**
 * A pergunta que todo mundo faz antes de instalar é para onde vai a imagem. O desenho
 * responde antes do texto: quatro caixas dentro de uma moldura que é a própria máquina, e
 * nenhuma seta atravessando essa moldura. O texto ao lado explica o que cada seta carrega.
 *
 * Fica em componente próprio porque o mesmo desenho serve ao modal do SAM e ao painel do
 * BYOM: são os dois lados da mesma conexão, e explicá-la duas vezes convidaria a divergir.
 */
export function LocalConnectionExplainer({ copy }: { copy: Copy }) {
  return <section className="local-connection">
    <b>{copy.samHowTitle}</b>

    <svg viewBox="0 0 560 210" role="img" aria-label={`${copy.samHowBrowser} → ${copy.samHowConnector} → ${copy.samHowModelBox} / ${copy.samHowContainerBox}`}>
      <defs>
        <marker id="poligome-conn-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--muted)" />
        </marker>
      </defs>

      {/* A moldura é o argumento inteiro: nada cruza para fora dela. */}
      <rect x="8" y="26" width="544" height="176" rx="12" fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="5 4" />
      <text x="22" y="19" fontSize="10" fill="var(--muted)">{copy.samHowMachine}</text>

      <rect x="26" y="46" width="120" height="56" rx="9" fill="var(--surface)" stroke="var(--line)" />
      <text x="86" y="70" fontSize="11" fontWeight="700" fill="var(--ink)" textAnchor="middle">{copy.samHowBrowser}</text>
      <text x="86" y="85" fontSize="9" fill="var(--muted)" textAnchor="middle">poligome.com</text>

      <rect x="220" y="46" width="140" height="56" rx="9" fill="var(--surface)" stroke="var(--green)" strokeWidth="1.5" />
      <text x="290" y="70" fontSize="11" fontWeight="700" fill="var(--ink)" textAnchor="middle">{copy.samHowConnector}</text>
      <text x="290" y="85" fontSize="9" fill="var(--muted)" textAnchor="middle">127.0.0.1:7860</text>

      <rect x="424" y="46" width="112" height="56" rx="9" fill="var(--surface)" stroke="var(--line)" />
      <text x="480" y="70" fontSize="11" fontWeight="700" fill="var(--ink)" textAnchor="middle">{copy.samHowModelBox}</text>
      <text x="480" y="85" fontSize="9" fill="var(--muted)" textAnchor="middle">PyTorch</text>

      <rect x="424" y="130" width="112" height="56" rx="9" fill="var(--surface)" stroke="var(--line)" />
      <text x="480" y="154" fontSize="11" fontWeight="700" fill="var(--ink)" textAnchor="middle">{copy.samHowContainerBox}</text>
      <text x="480" y="169" fontSize="9" fill="var(--muted)" textAnchor="middle">127.0.0.1:8080</text>

      <line x1="148" y1="74" x2="216" y2="74" stroke="var(--muted)" strokeWidth="1.2" markerEnd="url(#poligome-conn-arrow)" />
      <text x="182" y="67" fontSize="8.5" fill="var(--muted)" textAnchor="middle">HTTP</text>

      <line x1="362" y1="74" x2="420" y2="74" stroke="var(--muted)" strokeWidth="1.2" markerEnd="url(#poligome-conn-arrow)" />
      <text x="391" y="67" fontSize="8.5" fill="var(--muted)" textAnchor="middle">RAM / GPU</text>

      <path d="M290 104 L290 158 L418 158" fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#poligome-conn-arrow)" />
      <text x="356" y="151" fontSize="8.5" fill="var(--muted)" textAnchor="middle">HTTP</text>
    </svg>

    <p>{copy.samHowServer}</p>
    <p>{copy.samHowRoles}</p>
    <ul>
      <li>{copy.samHowSam}</li>
      <li>{copy.samHowByom}</li>
    </ul>
    <p className="local-connection-manual">{copy.samHowWindows}</p>
    <p className="local-connection-manual">{copy.samHowManual}</p>
  </section>;
}

export default LocalConnectionExplainer;

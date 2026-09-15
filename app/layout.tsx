import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--mono", subsets: ["latin"] });

// localStorage is the source of truth for this anonymous, local-first app. Running this
// before the body is painted prevents the default palette from flashing while React
// hydrates. The try/catch also covers browsers that deny storage access.
const initialThemeScript = `
  try {
    var savedTheme = localStorage.getItem("poligome-theme");
    document.documentElement.dataset.theme =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system";
  } catch (error) {
    document.documentElement.dataset.theme = "system";
  }
`;

export const metadata: Metadata = {
  title: "Poligome — Anotação de Imagens",
  description: "Anote imagens para treinar modelos de visão computacional e exporte em COCO ou YOLO.",
  other: { "codex-preview": "development" },
  icons: { icon: "/poligome-favicon.svg" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: initialThemeScript }} />
    </head>
    <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
  </html>;
}

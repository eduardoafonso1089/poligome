"use client";

import { ArrowRight, Box, Check, CodeXml, Download, FileArchive, Languages, Monitor, Moon, Pentagon, ShieldCheck, Spline, Sun, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { SOURCE_URL, getCopy, storedLanguage, storedTheme } from "./lib/i18n";
import type { Language, ThemeMode } from "./lib/i18n";

// Geometric symbol native to the brand; the text follows the font the app already loads.
function BrandLockup({ height = 34 }: { height?: number }) {
  return <span className="brand-lockup" role="img" aria-label="Poligome">
    <svg viewBox="0 0 40 40" height={height} aria-hidden="true">
      <path d="M20 2 35 11v18L20 38 5 29V11z" fill="currentColor" />
      <path d="m14 13 12 7-12 7z" fill="var(--surface)" />
    </svg>
    <strong>Poligome</strong>
  </span>;
}

const LANGUAGES: Array<{ id: Language; name: string; code: string }> = [
  { id: "pt", name: "Português", code: "PT-BR" },
  { id: "en", name: "English", code: "EN" },
  { id: "fr", name: "Français", code: "FR" },
  { id: "es", name: "Español", code: "ES" },
];

export default function Landing() {
  // Starts in the same language the server rendered, so hydration matches, and adopts the
  // saved preference one frame later. The content goes whole into the HTML: the landing has
  // to be readable by search engines and without JavaScript.
  const [language, setLanguage] = useState<Language>("pt");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const copy = getCopy(language);

  useEffect(() => {
    const theme = storedTheme();
    document.documentElement.dataset.theme = theme;
    const stored = storedLanguage();
    if (stored === "pt" && theme === "system") return;
    const frame = window.requestAnimationFrame(() => {
      setThemeMode(theme);
      if (stored !== "pt") setLanguage(stored);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "pt" ? "pt-BR" : language;
    document.title = copy.appTitle;
  }, [copy.appTitle, language]);

  // Only the user's explicit choice is stored; the effect above must not overwrite an
  // existing preference with the "pt" of the first render.
  function chooseLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem("poligome-language", next);
  }

  function chooseTheme(next: ThemeMode) {
    setThemeMode(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("poligome-theme", next);
  }

  const features = [
    { icon: <Box size={19} />, title: copy.landingFeatShapesTitle, text: copy.landingFeatShapesText },
    { icon: <WandSparkles size={19} />, title: copy.landingFeatSamTitle, text: copy.landingFeatSamText },
    { icon: <Download size={19} />, title: copy.landingFeatExportTitle, text: copy.landingFeatExportText },
    { icon: <FileArchive size={19} />, title: copy.landingFeatProjectTitle, text: copy.landingFeatProjectText },
    { icon: <Spline size={19} />, title: copy.landingFeatWorkspaceTitle, text: copy.landingFeatWorkspaceText },
  ];

  return <main className="landing">
    <header className="landing-top">
      <BrandLockup height={30} />
      <div className="landing-controls">
        <nav className="landing-theme" aria-label={copy.appearance}>
          <button className={themeMode === "system" ? "active" : ""} aria-pressed={themeMode === "system"} title={copy.system} onClick={() => chooseTheme("system")}><Monitor size={14} /><span>{copy.system}</span></button>
          <button className={themeMode === "light" ? "active" : ""} aria-pressed={themeMode === "light"} title={copy.light} onClick={() => chooseTheme("light")}><Sun size={14} /><span>{copy.light}</span></button>
          <button className={themeMode === "dark" ? "active" : ""} aria-pressed={themeMode === "dark"} title={copy.dark} onClick={() => chooseTheme("dark")}><Moon size={14} /><span>{copy.dark}</span></button>
        </nav>
        <nav className="landing-langs" aria-label={copy.landingLanguageLabel}>
          <Languages size={15} aria-hidden="true" />
          {LANGUAGES.map((item) => <button
            key={item.id}
            className={language === item.id ? "active" : ""}
            aria-pressed={language === item.id}
            title={item.code}
            onClick={() => chooseLanguage(item.id)}
          >{item.name}</button>)}
        </nav>
      </div>
    </header>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <p className="landing-eyebrow"><Pentagon size={13} aria-hidden="true" />{copy.landingEyebrow}</p>
        <h1>{copy.landingHeadline}</h1>
        <p className="landing-intro">{copy.landingVisionText}</p>
        <div className="landing-actions">
          <a className="landing-cta" href="/annotate?demo=1"><WandSparkles size={17} />{copy.tryDemo}</a>
          <span className="landing-free-badge"><Check size={13} aria-hidden="true" />{copy.landingBadgeFree}</span>
          <span className="landing-cta-note">{copy.landingCtaNote}</span>
        </div>
      </div>
      <div className="landing-identity" aria-hidden="true">
        <span className="landing-identity-shape"><Pentagon size={42} strokeWidth={1.4} /></span>
        <span className="landing-identity-core"><BrandLockup height={24} /></span>
        <span className="landing-identity-text"><Spline size={42} strokeWidth={1.4} /></span>
        <i />
      </div>
    </section>

    <section className="landing-projects" aria-label={copy.landingProjectsLabel}>
      <a href="/annotate">
        <span className="landing-project-icon"><Box size={22} /></span>
        <div><small>{copy.landingVisionEyebrow}</small><b>{copy.landingVisionTitle}</b><span>{copy.landingVisionText}</span></div>
        <ArrowRight size={18} />
      </a>
    </section>

    <section className="landing-claims">
      <article>
        <span className="landing-claim-mark"><Check size={17} aria-hidden="true" /></span>
        <div><h2>{copy.landingFreeTitle}</h2><p>{copy.landingFreeText}</p></div>
      </article>
      <article>
        <span className="landing-claim-mark"><ShieldCheck size={17} aria-hidden="true" /></span>
        <div><h2>{copy.landingPrivacyTitle}</h2><p>{copy.landingPrivacyText}</p></div>
      </article>
      <article>
        <span className="landing-claim-mark"><WandSparkles size={17} aria-hidden="true" /></span>
        <div><h2>{copy.landingAiTitle}</h2><p>{copy.landingAiText}</p></div>
      </article>
    </section>

    <section className="landing-features">
      <p className="landing-eyebrow"><Pentagon size={13} aria-hidden="true" />{copy.landingFeaturesEyebrow}</p>
      <div className="landing-grid">
        {features.map((feature) => <article key={feature.title}>
          <span>{feature.icon}</span>
          <h3>{feature.title}</h3>
          <p>{feature.text}</p>
        </article>)}
      </div>
    </section>

    <section className="landing-closing">
      <BrandLockup height={26} />
      <div className="landing-closing-actions">
        <a className="landing-cta" href="/annotate">{copy.landingVisionCta}</a>
      </div>
      <p>{copy.landingCtaNote}</p>
    </section>

    <footer className="landing-foot">
      <span className="landing-free-badge"><Check size={12} aria-hidden="true" />{copy.landingBadgeFree}</span>
      <p>{copy.privacy}</p>
      <a className="source-link" href={SOURCE_URL} target="_blank" rel="noreferrer"><CodeXml size={13} aria-hidden="true" />{copy.sourceCode}</a>
    </footer>
  </main>;
}

// Actual product components and CSS, with controlled project props. Backend
// responses are supplied by Playwright; this harness measures UI behaviour only.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import SamSetupModal from "../../app/components/SamSetupModal.tsx";
import { planAdaptiveCandidates, planAdaptiveDataset } from "../../app/lib/adaptive-dataset.ts";
import { polygon } from "../helpers/editor-fixtures.mjs";
import "../../app/globals.css";

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 64;
const context = canvas.getContext("2d");
context.fillStyle = "#eee"; context.fillRect(0, 0, 64, 64);
context.fillStyle = "#684184"; context.fillRect(8, 8, 24, 24);
const assets = [1, 2].map(i => ({ id: `ui-image-${i}`, name: `slide0${i}_field_001.png`, src: canvas.toDataURL(), local: true, width: 64, height: 64 }));
const annotations = [polygon({ asset: assets[0].id, vertices: [{ id: "a", x: 8, y: 8 }, { id: "b", x: 32, y: 8 }, { id: "c", x: 32, y: 32 }, { id: "d", x: 8, y: 32 }] })];
const initial = { id: "p-ui-project-00001", name: "Browser regression", assets, labels: [], annotations };

function Harness() {
  const [language, setLanguage] = useState("en");
  const [project, setProject] = useState(initial);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("adaptive");
  const [model, setModel] = useState("sam2.1-hiera-tiny");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:7860/predict");
  useEffect(() => { window.adaptiveUiQa = {
    project,
    plan: planAdaptiveDataset(project.assets, project.labels, project.annotations, { groupSequences: true }),
    candidates: planAdaptiveCandidates(project.assets, planAdaptiveDataset(project.assets, project.labels, project.annotations, { groupSequences: true })),
    setLanguage, setProject, setModel, setEndpoint,
    removeAnnotations: () => setProject({ ...project, annotations: [] }),
    changeAnnotation: () => setProject({ ...project, annotations: project.annotations.map(a => ({ ...a, vertices: a.vertices.map(v => ({ ...v, x: v.x + 1 })) })) }),
  }; }, [project]);
  return <>
    <button id="qa-reopen" onClick={() => setOpen(true)}>Reopen AI hub</button>
    {open && <SamSetupModal language={language} tab={tab} onTabChange={setTab}
      selectedModelId={model} loadedModelId={model} connectionState="ready" samActive={true}
      runtimeLabel="" loadError={null} availability={[]} connectorHost="linux" endpoint={endpoint}
      byomModels={[]} byomBusy={false}
      runtime={{ state: "offline", endpoint: "http://127.0.0.1:7861", manifest: null, setEndpoint() {}, refresh() {} }}
      onSelectModel={setModel} onPreannotate={() => {}} onRegisterByomModel={async () => ({ ok: true })}
      onRemoveByomModel={() => {}} onUnselectAll={() => {}} onEndpointChange={setEndpoint}
      onRecheckConnector={() => {}} onConnect={() => {}} onClose={() => setOpen(false)} adaptiveProject={project} />}
  </>;
}

createRoot(document.getElementById("root")).render(<Harness />);

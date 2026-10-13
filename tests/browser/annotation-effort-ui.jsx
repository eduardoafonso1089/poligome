// The actual editor; the optional real SAM3 browser check supplies the connector.
import React from "react";
import { createRoot } from "react-dom/client";
import { CanonicalEditorWorkbench } from "../../app/editor/workbench/canonical-editor-workbench.tsx";
import "../../app/globals.css";
createRoot(document.getElementById("root")).render(<CanonicalEditorWorkbench />);

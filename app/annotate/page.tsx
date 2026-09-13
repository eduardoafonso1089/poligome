import { CanonicalEditorWorkbench } from "../editor/workbench/canonical-editor-workbench";
import styles from "./exact-pre-refactor-refinements.module.css";
import final from "./exact-pre-refactor-final.module.css";
import routing from "./functional-interaction-routing.module.css";
import demo from "./demo-tutorial-parity.module.css";

export default function AnnotatePage() {
  return <div className={`${styles.contract} ${final.contract} ${routing.contract} ${demo.contract}`}><CanonicalEditorWorkbench /></div>;
}

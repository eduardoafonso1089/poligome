/** Registers the CSS-module hooks so component tests can render real components. */
import { register } from "node:module";

register("./css-modules-hooks.mjs", import.meta.url);

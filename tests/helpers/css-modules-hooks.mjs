/**
 * Module hooks that let component tests import CSS modules.
 *
 * Vite turns `import ui from "./x.module.css"` into an object of generated class
 * names. Node has no idea what a .css file is, so any component importing one
 * could not be rendered in a test at all — which is part of why those components
 * were only ever checked with a regex over their source.
 *
 * The stub returns the key itself, so `ui.managementGrid` renders as
 * "managementGrid". That keeps class assertions readable and stable, since the
 * real hashed name is a build detail no test should depend on.
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_target, key) => typeof key === 'string' ? key : undefined });",
    };
  }
  return nextLoad(url, context);
}

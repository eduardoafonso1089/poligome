/** A local model address must never silently send images to another machine. */
export function localEndpointError(value: string): "invalid" | "remote" | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "invalid";
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return "remote";
    return null;
  } catch {
    return "invalid";
  }
}

/** A connector origin is sufficient input; SAM inference lives at /predict. */
export function normalizeSamEndpoint(value: string): string {
  const trimmed = value.trim();
  if (localEndpointError(trimmed)) return trimmed;
  const url = new URL(trimmed);
  if (url.pathname === "/") url.pathname = "/predict";
  return url.toString();
}

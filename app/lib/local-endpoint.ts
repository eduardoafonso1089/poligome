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

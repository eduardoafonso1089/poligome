/** Resolve and consume the landing-page demo query without discarding other URL state. */
export function demoRouteTarget(href: string) {
  const url = new URL(href, "http://localhost");
  if (url.searchParams.get("demo") !== "1") return null;
  url.searchParams.delete("demo");
  return `${url.pathname}${url.search}${url.hash}`;
}

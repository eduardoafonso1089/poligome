import type { Copy } from "./i18n";

/**
 * Translate domain error codes thrown by the project/raster/export layers without
 * leaking internal identifiers such as `rasterInvalidTiff` into the interface.
 * Unknown errors intentionally collapse to the localized caller fallback.
 */
export function translateErrorCode(error: unknown, copy: Copy, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const key = error.message as keyof Copy;
  const translated = copy[key];
  return typeof translated === "string" && translated.trim() ? translated : fallback;
}

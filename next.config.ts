import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Poligome is local-first and does not require a server runtime. Keep the app
  // exportable as plain HTML/CSS/JS so it can be hosted on Cloudflare Pages.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace TS packages need transpilation by Next (no pre-built dist).
  transpilePackages: ["@pointer/shared"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? "http://localhost:3333"
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.imoview.com.br" },
      { protocol: "https", hostname: "www.pointerimoveis.net.br" },
      { protocol: "https", hostname: "pointerimoveis.net.br" }
    ]
  },
  // The shared package uses ESM-style `.js` extensions in its TS imports
  // (required by Node's nodenext resolution). Webpack/turbopack don't know
  // about that mapping — so we tell them: when you see a `.js` import in
  // a `.ts` file, also try `.ts` and `.tsx`.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"]
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"]
  }
};

export default nextConfig;

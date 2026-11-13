import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança estáticos. A Content-Security-Policy (que depende de
 * um nonce por requisição) é aplicada em `src/proxy.ts`.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const projectRoot = process.cwd();

const nextConfig: NextConfig = {
  // Fixa a raiz do projeto (evita que lockfiles em pastas acima alterem o caminho do build standalone).
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },
  // Gera .next/standalone: servidor Node mínimo, usado pela imagem Docker.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;

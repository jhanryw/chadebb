#!/usr/bin/env node
/**
 * Roda localmente o build "standalone" (o mesmo servidor usado na imagem Docker).
 * Copia public/ e .next/static para dentro de .next/standalone, como o Dockerfile faz.
 */
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next/standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("Build standalone não encontrado. Rode `npm run build` primeiro.");
  process.exit(1);
}
cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });

const child = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

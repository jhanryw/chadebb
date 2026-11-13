#!/usr/bin/env node
/**
 * Teste ponta a ponta contra um site JÁ em execução e um webhook n8n REAL.
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-test.mjs
 *   BASE_URL=https://seu-dominio.com node scripts/smoke-test.mjs --race
 *
 * ATENÇÃO: grava linhas REAIS na aba Confirmacoes (nome "Teste Automatizado ...").
 * O sistema nunca apaga registros: remova essas linhas manualmente depois.
 * `--race` dispara 5 envios simultâneos do mesmo nome e exige exatamente 1 gravação:
 * é o teste que comprova que a serialização (concorrência = 1 no n8n) está ativa.
 * Cada execução consome parte do limite de requisições por IP (padrão 10 / 10 min).
 */
import { randomUUID } from "node:crypto";

const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const race = process.argv.includes("--race");

const letters = "abcdefghijklmnopqrstuvwxyz";
const suffix = Array.from({ length: 8 }, () => letters[Math.floor(Math.random() * 26)]).join("");
const nome = `Teste Automatizado ${suffix}`;

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "OK  " : "FALHA"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

async function post(body, key = randomUUID()) {
  const response = await fetch(`${base}/api/rsvp`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null), key };
}

const health = await fetch(`${base}/api/health`).then((r) => r.json()).catch(() => null);
check("GET /api/health", health?.status === "ok", JSON.stringify(health));
check("configuração completa (configured = true)", health?.configured === true);

const invalid = await post({ nome: "x", presenca: "SIM", adultos: -1, criancas: 0 });
check("dados inválidos → 422", invalid.status === 422, String(invalid.status));

if (race) {
  const results = await Promise.all(
    Array.from({ length: 5 }, () => post({ nome: `${nome} race`, presenca: "SIM", adultos: 1, criancas: 0 })),
  );
  const statuses = results.map((r) => r.status).sort();
  const created = statuses.filter((s) => s === 201).length;
  check("5 envios simultâneos do mesmo nome → exatamente 1 gravação (201)", created === 1, statuses.join(","));
  check("os demais → 409", statuses.filter((s) => s === 409).length === 4, statuses.join(","));
} else {
  const first = await post({ nome, presenca: "SIM", adultos: 2, criancas: 1 });
  check("confirmação positiva → 201 (gravada no Sheets)", first.status === 201 && first.json?.ok === true, String(first.status));

  const replay = await post({ nome, presenca: "SIM", adultos: 2, criancas: 1 }, first.key);
  check("reenvio com a mesma chave → 200 (idempotente)", replay.status === 200 && replay.json?.code === "ALREADY_RECORDED", String(replay.status));

  const dup = await post({ nome: nome.toUpperCase(), presenca: "NAO" });
  check("mesmo nome (outra caixa) com nova chave → 409", dup.status === 409, String(dup.status));
  check("409 não revela a resposta anterior", !JSON.stringify(dup.json).match(/SIM|NAO|adultos/), JSON.stringify(dup.json));

  const absent = await post({ nome: `${nome} ausente`, presenca: "NAO" });
  check("confirmação negativa → 201", absent.status === 201 && absent.json?.presenca === "NAO", String(absent.status));
}

console.log(failures === 0 ? "\nTodos os testes passaram." : `\n${failures} verificação(ões) falharam.`);
console.log(`Linhas de teste gravadas começam com "${nome}" — remova-as da planilha.`);
process.exit(failures === 0 ? 0 : 1);

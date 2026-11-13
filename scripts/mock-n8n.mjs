#!/usr/bin/env node
/**
 * n8n SIMULADO para desenvolvimento local (sem Google Sheets).
 * Executa o MESMO código dos nós Code de n8n/chatbb-workflow.json contra uma
 * planilha em memória, com execuções serializadas (como N8N_CONCURRENCY_PRODUCTION_LIMIT=1).
 *
 *   node scripts/mock-n8n.mjs            # http://localhost:5678/webhook/chatbb-rsvp
 *   N8N_WEBHOOK_URL=http://localhost:5678/webhook/chatbb-rsvp
 *   N8N_WEBHOOK_SECRET=<o mesmo valor de MOCK_SECRET>
 *
 * NÃO é o n8n real: serve para testar o site. Teste com o n8n de verdade antes de publicar.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = JSON.parse(readFileSync(path.join(root, "n8n/chatbb-workflow.json"), "utf8"));
const secret = process.env.MOCK_SECRET ?? "segredo-local-de-desenvolvimento-123";
const header = (process.env.MOCK_SECRET_HEADER ?? "x-chatbb-secret").toLowerCase();
const port = Number(process.env.MOCK_PORT ?? 5678);
const sheet = [];

function runNode(name, input, outputs = {}) {
  const code = workflow.nodes.find((n) => n.name === name).parameters.jsCode;
  const $input = { first: () => ({ json: input[0] ?? {} }), all: () => input.map((json) => ({ json })) };
  const $ = (n) => ({ first: () => ({ json: outputs[n] ?? {} }) });
  return new Function("$input", "$", `return (function(){\n${code}\n})();`)($input, $).map((i) => i.json);
}

function execute(payload) {
  const validated = runNode("Validar e normalizar", [{ body: payload }])[0];
  if (!validated.valid) return { status: validated.status, body: validated.response };
  const decision = runNode("Decidir", sheet.length ? sheet.map((r) => ({ ...r })) : [{}], {
    "Validar e normalizar": validated,
  })[0];
  if (decision.action !== "write") return { status: decision.status, body: decision.response };
  sheet.push({ ...decision.row });
  console.log(`[mock-n8n] linha gravada (${sheet.length} no total)`);
  const created = runNode("Resposta 201", [{}], { Decidir: decision })[0];
  return { status: created.status, body: created.response };
}

let tail = Promise.resolve();
http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/webhook/chatbb-rsvp")) {
      res.writeHead(404).end();
      return;
    }
    if (req.headers[header] !== secret) {
      res.writeHead(403).end("Authorization data is wrong!");
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      tail = tail.then(async () => {
        await new Promise((r) => setTimeout(r, 150)); // latência simulada do Sheets
        let result;
        try {
          result = execute(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          result = { status: 422, body: { ok: false, code: "INVALID_DATA" } };
        }
        res.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify(result.body));
      });
    });
  })
  .listen(port, () => console.log(`[mock-n8n] http://localhost:${port}/webhook/chatbb-rsvp (segredo: MOCK_SECRET)`));

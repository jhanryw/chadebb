#!/usr/bin/env node
/**
 * Gera n8n/chatbb-workflow.json a partir dos arquivos em n8n/code/*.js.
 *
 *   node scripts/build-workflow.mjs          # escreve o JSON
 *   node scripts/build-workflow.mjs --check  # falha se o JSON estiver desatualizado
 *
 * Os nós Code do n8n não compartilham módulos, então `_shared.js` é inserido no
 * início dos nós que precisam dele.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, "n8n/code", file), "utf8").trimEnd() + "\n";

export function composeCode(file, withShared) {
  return withShared ? `${read("_shared.js")}\n${read(file)}` : read(file);
}

const SPREADSHEET = { __rl: true, value: "COLE_AQUI_O_ID_DA_PLANILHA", mode: "id" };
const SHEET = { __rl: true, value: "Confirmacoes", mode: "name" };

const columnNames = [
  "id",
  "data_hora",
  "nome",
  "nome_normalizado",
  "presenca",
  "adultos",
  "criancas",
  "total_pessoas",
  "chave_idempotencia",
  "origem",
];

const columnSchema = columnNames.map((id) => ({
  id,
  displayName: id,
  required: false,
  defaultMatch: false,
  display: true,
  type: "string",
  canBeUsedToMatch: true,
}));

const columnValues = Object.fromEntries(columnNames.map((id) => [id, `={{ $json.row.${id} }}`]));

const ifOptions = { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 };

const codeNode = (id, name, file, withShared, position) => ({
  parameters: { mode: "runOnceForAllItems", language: "javaScript", jsCode: composeCode(file, withShared) },
  id,
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
});

export function buildWorkflow() {
  return {
    name: "ChatBB - Confirmação de presença",
    nodes: [
      {
        parameters: {
          content:
            "## ChatBB — Confirmação de presença\n\n**Antes de ativar:**\n1. Crie a credencial *Header Auth* (nome do cabeçalho `X-ChatBB-Secret`, valor = N8N_WEBHOOK_SECRET do site) e selecione-a no nó **Webhook**.\n2. Crie/selecione a credencial **Google Sheets** nos nós *Ler confirmações* e *Gravar confirmação* e escolha a planilha/aba **Confirmacoes**.\n3. Revise a constante `CONFIG` no nó *Validar e normalizar* (deve ser igual ao .env do site).\n4. **Concorrência:** defina `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` no n8n (ou worker com `--concurrency=1`). Sem isso, duas requisições simultâneas podem gravar o mesmo nome. Veja n8n/README.md.\n5. Ative o workflow e use a URL **Production** (`/webhook/chatbb-rsvp`).",
          height: 420,
          width: 520,
        },
        id: "6c1e1c0e-0d6a-4f7e-9a53-000000000001",
        name: "Instruções",
        type: "n8n-nodes-base.stickyNote",
        typeVersion: 1,
        position: [-160, -120],
      },
      {
        parameters: {
          httpMethod: "POST",
          path: "chatbb-rsvp",
          authentication: "headerAuth",
          responseMode: "responseNode",
          options: {},
        },
        id: "6c1e1c0e-0d6a-4f7e-9a53-000000000002",
        name: "Webhook ChatBB",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [480, 300],
        webhookId: "0d3b6c0e-5d1f-4c1a-8f0e-0000c4a7bb01",
        credentials: { httpHeaderAuth: { id: "CONFIGURE", name: "ChatBB Webhook Secret" } },
      },
      codeNode(
        "6c1e1c0e-0d6a-4f7e-9a53-000000000003",
        "Validar e normalizar",
        "validate-normalize.js",
        true,
        [720, 300],
      ),
      {
        parameters: {
          conditions: {
            options: ifOptions,
            conditions: [
              {
                id: "a1f3c1d2-0000-4000-8000-000000000001",
                leftValue: "={{ $json.valid }}",
                rightValue: "",
                operator: { type: "boolean", operation: "true", singleValue: true },
              },
            ],
            combinator: "and",
          },
          options: {},
        },
        id: "6c1e1c0e-0d6a-4f7e-9a53-000000000004",
        name: "Dados válidos?",
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [960, 300],
      },
      {
        parameters: {
          resource: "sheet",
          operation: "read",
          documentId: SPREADSHEET,
          sheetName: SHEET,
          options: {},
        },
        id: "6c1e1c0e-0d6a-4f7e-9a53-000000000005",
        name: "Ler confirmações",
        type: "n8n-nodes-base.googleSheets",
        typeVersion: 4.5,
        position: [1200, 220],
        alwaysOutputData: true,
        onError: "continueErrorOutput",
        credentials: { googleSheetsOAuth2Api: { id: "CONFIGURE", name: "Google Sheets account" } },
      },
      codeNode(
        "6c1e1c0e-0d6a-4f7e-9a53-000000000006",
        "Decidir",
        "decide.js",
        true,
        [1440, 200],
      ),
      {
        parameters: {
          conditions: {
            options: ifOptions,
            conditions: [
              {
                id: "a1f3c1d2-0000-4000-8000-000000000002",
                leftValue: "={{ $json.action }}",
                rightValue: "write",
                operator: { type: "string", operation: "equals" },
              },
            ],
            combinator: "and",
          },
          options: {},
        },
        id: "6c1e1c0e-0d6a-4f7e-9a53-000000000007",
        name: "Gravar?",
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [1680, 200],
      },
      {
        parameters: {
          resource: "sheet",
          operation: "append",
          documentId: SPREADSHEET,
          sheetName: SHEET,
          columns: {
            mappingMode: "defineBelow",
            value: columnValues,
            matchingColumns: [],
            schema: columnSchema,
            attemptToConvertTypes: false,
            convertFieldsToString: false,
          },
          options: { cellFormat: "RAW" },
        },
        id: "6c1e1c0e-0d6a-4f7e-9a53-000000000008",
        name: "Gravar confirmação",
        type: "n8n-nodes-base.googleSheets",
        typeVersion: 4.5,
        position: [1920, 120],
        onError: "continueErrorOutput",
        credentials: { googleSheetsOAuth2Api: { id: "CONFIGURE", name: "Google Sheets account" } },
      },
      codeNode(
        "6c1e1c0e-0d6a-4f7e-9a53-000000000009",
        "Resposta 201",
        "response-created.js",
        false,
        [2160, 100],
      ),
      codeNode(
        "6c1e1c0e-0d6a-4f7e-9a53-000000000010",
        "Resposta 503",
        "response-unavailable.js",
        false,
        [2160, 420],
      ),
      {
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json.response }}",
          options: { responseCode: "={{ $json.status }}" },
        },
        id: "6c1e1c0e-0d6a-4f7e-9a53-000000000011",
        name: "Responder ao site",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.1,
        position: [2400, 300],
      },
    ],
    pinData: {},
    connections: {
      "Webhook ChatBB": { main: [[{ node: "Validar e normalizar", type: "main", index: 0 }]] },
      "Validar e normalizar": { main: [[{ node: "Dados válidos?", type: "main", index: 0 }]] },
      "Dados válidos?": {
        main: [
          [{ node: "Ler confirmações", type: "main", index: 0 }],
          [{ node: "Responder ao site", type: "main", index: 0 }],
        ],
      },
      "Ler confirmações": {
        main: [
          [{ node: "Decidir", type: "main", index: 0 }],
          [{ node: "Resposta 503", type: "main", index: 0 }],
        ],
      },
      Decidir: { main: [[{ node: "Gravar?", type: "main", index: 0 }]] },
      "Gravar?": {
        main: [
          [{ node: "Gravar confirmação", type: "main", index: 0 }],
          [{ node: "Responder ao site", type: "main", index: 0 }],
        ],
      },
      "Gravar confirmação": {
        main: [
          [{ node: "Resposta 201", type: "main", index: 0 }],
          [{ node: "Resposta 503", type: "main", index: 0 }],
        ],
      },
      "Resposta 201": { main: [[{ node: "Responder ao site", type: "main", index: 0 }]] },
      "Resposta 503": { main: [[{ node: "Responder ao site", type: "main", index: 0 }]] },
    },
    active: false,
    settings: {
      executionOrder: "v1",
      timezone: "America/Fortaleza",
      executionTimeout: 60,
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "all",
      saveManualExecutions: true,
    },
    meta: { templateCredsSetupCompleted: false },
    tags: [],
  };
}

const outFile = path.join(root, "n8n/chatbb-workflow.json");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = JSON.stringify(buildWorkflow(), null, 2) + "\n";
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(outFile, "utf8");
    } catch {
      /* ausente */
    }
    if (current !== json) {
      console.error("n8n/chatbb-workflow.json está desatualizado. Rode: npm run workflow:build");
      process.exit(1);
    }
    console.log("n8n/chatbb-workflow.json está em dia.");
  } else {
    writeFileSync(outFile, json);
    console.log(`Gerado ${path.relative(root, outFile)}`);
  }
}

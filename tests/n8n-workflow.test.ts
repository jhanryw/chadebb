import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeName } from "@/lib/normalization";
import { FakeN8n, loadWorkflow, runCodeNode } from "./helpers/fake-n8n";
// @ts-expect-error — módulo .mjs sem tipos
import { buildWorkflow } from "../scripts/build-workflow.mjs";

const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";
const KEY_C = "33333333-3333-4333-8333-333333333333";

const valid = { idempotencyKey: KEY_A, nome: "João da Silva", presenca: "SIM", adultos: 2, criancas: 1, origem: "site" };

async function post(n8n: FakeN8n, body: unknown) {
  const response = await n8n.fetch("http://n8n/webhook/chatbb-rsvp", { method: "POST", body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T13:50:07Z")); // 10:50:07 em Fortaleza
});
afterEach(() => vi.useRealTimers());

describe("workflow JSON", () => {
  it("está sincronizado com n8n/code/*.js (rode `npm run workflow:build`)", () => {
    const onDisk = readFileSync(path.resolve(__dirname, "../n8n/chatbb-workflow.json"), "utf8");
    expect(onDisk).toBe(JSON.stringify(buildWorkflow(), null, 2) + "\n");
  });

  it("não contém segredos e usa credenciais do n8n", () => {
    const text = JSON.stringify(loadWorkflow());
    expect(text).not.toMatch(/secret"\s*:\s*"[^"]{8,}/i);
    const webhook = loadWorkflow().nodes.find((node) => node.type === "n8n-nodes-base.webhook") as unknown as {
      parameters: { authentication: string; responseMode: string; httpMethod: string };
    };
    expect(webhook.parameters).toMatchObject({ authentication: "headerAuth", responseMode: "responseNode", httpMethod: "POST" });
  });

  it("todas as conexões apontam para nós existentes e o Responder só vem depois da gravação", () => {
    const workflow = loadWorkflow() as unknown as {
      nodes: Array<{ name: string }>;
      connections: Record<string, { main: Array<Array<{ node: string }>> }>;
    };
    const names = new Set(workflow.nodes.map((node) => node.name));
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      expect(names.has(from), from).toBe(true);
      for (const output of main) for (const target of output) expect(names.has(target.node), target.node).toBe(true);
    }
    // "Resposta 201" só é alcançada pelo caminho de sucesso do nó que grava no Sheets.
    const incoming201 = Object.entries(workflow.connections).filter(([, { main }]) =>
      main.some((out) => out.some((t) => t.node === "Resposta 201")),
    );
    expect(incoming201.map(([from]) => from)).toEqual(["Gravar confirmação"]);
    expect(workflow.connections["Gravar confirmação"]!.main[0]![0]!.node).toBe("Resposta 201");
    expect(workflow.connections["Gravar confirmação"]!.main[1]![0]!.node).toBe("Resposta 503");
  });
});

describe("validação e normalização no n8n", () => {
  it("gera a linha com data/hora de America/Fortaleza e total sem duplicar o titular", () => {
    const [out] = runCodeNode("Validar e normalizar", [{ body: valid }]);
    const data = out!.data as { row: Record<string, unknown>; nomeNormalizado: string };
    expect(out!.valid).toBe(true);
    expect(data.row).toMatchObject({
      data_hora: "2026-11-13 10:50:07",
      nome: "João da Silva",
      nome_normalizado: "joao da silva",
      presenca: "SIM",
      adultos: 2,
      criancas: 1,
      total_pessoas: 3,
      chave_idempotencia: KEY_A,
      origem: "site",
    });
    expect(String(data.row.id)).toMatch(/^rsvp_/);
  });

  it("NAO grava adultos = 0 e crianças = 0", () => {
    const [out] = runCodeNode("Validar e normalizar", [{ body: { ...valid, presenca: "NAO", adultos: 5, criancas: 5 } }]);
    expect((out!.data as { row: Record<string, unknown> }).row).toMatchObject({ presenca: "NAO", adultos: 0, criancas: 0, total_pessoas: 0 });
  });

  it.each([
    ["nome vazio", { nome: "" }],
    ["nome com fórmula", { nome: "=cmd|' /C calc'!A0 Silva" }],
    ["adultos negativos", { adultos: -1 }],
    ["adultos decimais", { adultos: 1.5 }],
    ["adultos como texto", { adultos: "2" }],
    ["adultos acima do limite", { adultos: 999 }],
    ["crianças acima do limite", { criancas: 999 }],
    ["presença inválida", { presenca: "TALVEZ" }],
    ["sem adultos nem crianças", { adultos: 0, criancas: 0 }],
    ["chave inválida", { idempotencyKey: "curta" }],
  ])("responde 422 para %s", (_label, override) => {
    const [out] = runCodeNode("Validar e normalizar", [{ body: { ...valid, ...override } }]);
    expect(out).toMatchObject({ valid: false, status: 422 });
    expect((out!.response as { code: string }).code).toBe("INVALID_DATA");
  });

  it("responde 422 se o corpo não for um objeto", () => {
    for (const body of [null, "x", [], undefined]) {
      const [out] = runCodeNode("Validar e normalizar", [{ body } as never]);
      expect(out).toMatchObject({ valid: false, status: 422 });
    }
  });

  it("bloqueia após o prazo (RSVP_CLOSED), usando o início do evento quando não há prazo explícito", () => {
    vi.setSystemTime(new Date("2026-11-22T11:00:00Z")); // 08:00 em Fortaleza
    const [out] = runCodeNode("Validar e normalizar", [{ body: valid }]);
    expect(out).toMatchObject({ valid: false, status: 422, response: { code: "RSVP_CLOSED" } });
  });

  it("a normalização é idêntica à do site (paridade)", () => {
    const names = ["João da Silva", "JOÃO  DA SILVA", "João da Silva", "Ana D’Ávila", "Ñandú Pérez", "Maria de​ Fátima", "Çağlar Öztürk"];
    for (const nome of names) {
      const [out] = runCodeNode("Validar e normalizar", [{ body: { ...valid, nome } }]);
      if (out!.valid === true) {
        expect((out!.data as { nomeNormalizado: string }).nomeNormalizado, nome).toBe(normalizeName(nome));
      }
    }
  });
});

describe("fluxo completo (n8n simulado + planilha em memória)", () => {
  it("201: grava a confirmação", async () => {
    const n8n = new FakeN8n();
    const result = await post(n8n, valid);
    expect(result).toEqual({ status: 201, json: { ok: true, code: "CREATED", presenca: "SIM" } });
    expect(n8n.sheet).toHaveLength(1);
    expect(n8n.sheet[0]).toMatchObject({ nome: "João da Silva", total_pessoas: 3 });
  });

  it("200: mesma chave de idempotência não grava de novo e devolve a presença original", async () => {
    const n8n = new FakeN8n();
    await post(n8n, valid);
    const again = await post(n8n, { ...valid, presenca: "NAO", adultos: 0, criancas: 0 });
    expect(again).toEqual({ status: 200, json: { ok: true, code: "ALREADY_RECORDED", presenca: "SIM" } });
    expect(n8n.sheet).toHaveLength(1);
  });

  it("409: nome equivalente (acentos/caixa/espaços) com outra chave", async () => {
    const n8n = new FakeN8n();
    await post(n8n, valid);
    const dup = await post(n8n, { ...valid, idempotencyKey: KEY_B, nome: "  joao   DA silva " });
    expect(dup.status).toBe(409);
    expect(dup.json).toEqual({ ok: false, code: "DUPLICATE_NAME" }); // sem revelar a resposta anterior
    expect(n8n.sheet).toHaveLength(1);
  });

  it("409: mesma chave reutilizada com outro nome", async () => {
    const n8n = new FakeN8n();
    await post(n8n, valid);
    const conflict = await post(n8n, { ...valid, nome: "Outra Pessoa" });
    expect(conflict).toEqual({ status: 409, json: { ok: false, code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("nomes parecidos mas diferentes não são bloqueados", async () => {
    const n8n = new FakeN8n();
    await post(n8n, valid);
    const other = await post(n8n, { ...valid, idempotencyKey: KEY_B, nome: "João da Silva Júnior" });
    expect(other.status).toBe(201);
    expect(n8n.sheet).toHaveLength(2);
  });

  it("detecta duplicidade pelo campo `nome` mesmo se `nome_normalizado` da linha antiga estiver vazio", async () => {
    const n8n = new FakeN8n();
    n8n.sheet.push({ id: "x", nome: "João da Silva", nome_normalizado: "", chave_idempotencia: "legacy", presenca: "SIM" });
    const dup = await post(n8n, valid);
    expect(dup.status).toBe(409);
  });

  it("422 para dados inválidos, sem gravar nada", async () => {
    const n8n = new FakeN8n();
    const bad = await post(n8n, { ...valid, adultos: -3 });
    expect(bad.status).toBe(422);
    expect(n8n.sheet).toHaveLength(0);
  });

  it("503 (e nenhuma gravação) se a leitura do Sheets falhar", async () => {
    const n8n = new FakeN8n({ failRead: true });
    expect((await post(n8n, valid)).status).toBe(503);
    expect(n8n.sheet).toHaveLength(0);
  });

  it("503 — nunca 201 — se a gravação falhar; uma nova tentativa com a mesma chave grava normalmente", async () => {
    const failing = new FakeN8n({ failAppend: true });
    const first = await post(failing, valid);
    expect(first.status).toBe(503);
    expect(failing.sheet).toHaveLength(0);

    const healthy = new FakeN8n();
    expect((await post(healthy, valid)).status).toBe(201);
  });

  it("autenticação do webhook: sem o segredo correto, nada é processado", async () => {
    const n8n = new FakeN8n({ secret: "segredo-super-secreto-123" });
    const denied = await n8n.fetch("http://n8n/x", { method: "POST", body: JSON.stringify(valid), headers: { "X-ChatBB-Secret": "errado" } });
    expect(denied.status).toBe(403);
    expect(n8n.sheet).toHaveLength(0);
  });

  it("DEMONSTRAÇÃO: sem serialização, duas execuções concorrentes gravam o mesmo nome (por isso é preciso concorrência 1)", async () => {
    const n8n = new FakeN8n({ ioDelay: () => new Promise((resolve) => setTimeout(resolve, 5)) });
    vi.useRealTimers();
    const [a, b] = await Promise.all([post(n8n, valid), post(n8n, { ...valid, idempotencyKey: KEY_C })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(n8n.sheet).toHaveLength(2); // corrida: exatamente o que a configuração do n8n/EasyPanel precisa evitar
    expect(n8n.maxConcurrent).toBe(2);
  });
});

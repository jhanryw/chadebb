import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rsvp/route";
import { FakeN8n } from "./helpers/fake-n8n";

const URL_N8N = "https://n8n.example.com/webhook/chatbb-rsvp";
const SECRET = "segredo-de-teste-com-mais-de-16-chars";
const KEY_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const validBody = { nome: "Maria da Silva", presenca: "SIM", adultos: 2, criancas: 1, website: "" };

function request(body: unknown, init: { headers?: Record<string, string>; raw?: string; ip?: string } = {}): Request {
  return new Request("http://localhost:3000/api/rsvp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": KEY_1,
      "x-forwarded-for": init.ip ?? "203.0.113.10",
      ...init.headers,
    },
    body: init.raw ?? JSON.stringify(body),
  });
}

async function call(req: Request) {
  const response = await POST(req);
  return { status: response.status, json: (await response.json()) as Record<string, unknown>, headers: response.headers };
}

let n8n: FakeN8n;

function useN8n(instance: FakeN8n) {
  n8n = instance;
  vi.stubGlobal("fetch", n8n.fetch);
}

beforeEach(() => {
  vi.stubEnv("N8N_WEBHOOK_URL", URL_N8N);
  vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("EVENT_DATE", "2026-11-22T08:00:00-03:00");
  vi.stubEnv("RSVP_DEADLINE", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T13:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useN8n(new FakeN8n({ secret: SECRET }));
});
afterEach(() => vi.useRealTimers());

describe("POST /api/rsvp — sucesso", () => {
  it("201: confirmação positiva é gravada e só então o sucesso é devolvido", async () => {
    const { status, json } = await call(request(validBody));
    expect(status).toBe(201);
    expect(json).toEqual({ ok: true, code: "CREATED", presenca: "SIM" });
    expect(n8n.sheet).toHaveLength(1);
    expect(n8n.sheet[0]).toMatchObject({ nome: "Maria da Silva", adultos: 2, criancas: 1, total_pessoas: 3, presenca: "SIM", origem: "site" });
  });

  it("201: confirmação negativa grava 0/0", async () => {
    const { status, json } = await call(request({ nome: "Carlos Souza", presenca: "NAO" }));
    expect(status).toBe(201);
    expect(json).toMatchObject({ presenca: "NAO" });
    expect(n8n.sheet[0]).toMatchObject({ presenca: "NAO", adultos: 0, criancas: 0, total_pessoas: 0 });
  });

  it("repassa a chave de idempotência e o segredo ao n8n (segredo nunca volta ao navegador)", async () => {
    const spy = vi.fn(n8n.fetch);
    vi.stubGlobal("fetch", spy);
    const { json, headers } = await call(request(validBody));
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(URL_N8N);
    const sentHeaders = new Headers(init?.headers);
    expect(sentHeaders.get("x-chatbb-secret")).toBe(SECRET);
    expect(JSON.parse(String(init?.body))).toMatchObject({ idempotencyKey: KEY_1, nome: "Maria da Silva", origem: "site" });
    expect(JSON.stringify(json)).not.toContain(SECRET);
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("200: reenvio com a mesma chave (falha de rede) é idempotente e não duplica o registro", async () => {
    await call(request(validBody));
    const retry = await call(request(validBody));
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual({ ok: true, code: "ALREADY_RECORDED", presenca: "SIM" });
    expect(n8n.sheet).toHaveLength(1);
  });

  it("gera uma chave no servidor se o cliente não enviar", async () => {
    const req = new Request("http://localhost/api/rsvp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect((await call(req)).status).toBe(201);
    expect(String(n8n.sheet[0]!.chave_idempotencia)).toHaveLength(36);
  });
});

describe("POST /api/rsvp — duplicidade", () => {
  it("409 com mensagem genérica, sem revelar a resposta anterior", async () => {
    await call(request(validBody));
    const dup = await call(request({ ...validBody, nome: "MARIA DA SILVA", presenca: "NAO" }, { headers: { "idempotency-key": KEY_2 } }));
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe("DUPLICATE_NAME");
    expect(JSON.stringify(dup.json)).not.toMatch(/SIM|NAO|Maria|adultos/i);
    expect(n8n.sheet).toHaveLength(1);
  });

  it("requisições simultâneas com o mesmo nome: apenas uma é gravada (envios são serializados)", async () => {
    vi.useRealTimers();
    useN8n(new FakeN8n({ secret: SECRET, ioDelay: () => new Promise((resolve) => setTimeout(resolve, 10)) }));
    const results = await Promise.all([
      call(request(validBody, { headers: { "idempotency-key": KEY_1 }, ip: "198.51.100.1" })),
      call(request(validBody, { headers: { "idempotency-key": KEY_2 }, ip: "198.51.100.2" })),
      call(request({ ...validBody, nome: "maria da silva" }, { headers: { "idempotency-key": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, ip: "198.51.100.3" })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(n8n.sheet).toHaveLength(1);
    expect(n8n.maxConcurrent).toBe(1);
  });
});

describe("POST /api/rsvp — validação", () => {
  it.each([
    ["nome vazio", { nome: "" }, "nome"],
    ["nome sem sobrenome", { nome: "Maria" }, "nome"],
    ["adultos negativos", { adultos: -1 }, "adultos"],
    ["adultos decimais", { adultos: 1.5 }, "adultos"],
    ["adultos acima do limite", { adultos: 11 }, "adultos"],
    ["crianças acima do limite", { criancas: 99 }, "criancas"],
    ["zero adultos", { adultos: 0 }, "adultos"],
    ["presença ausente", { presenca: undefined }, "presenca"],
  ])("422: %s", async (_label, override, field) => {
    const { status, json } = await call(request({ ...validBody, ...override }));
    expect(status).toBe(422);
    expect(json.code).toBe("INVALID_DATA");
    expect((json.fieldErrors as Record<string, string>)[field]).toBeTruthy();
    expect(n8n.calls).toHaveLength(0);
  });

  it("422 para campos desconhecidos", async () => {
    expect((await call(request({ ...validBody, isAdmin: true }))).status).toBe(422);
  });

  it("422 para chave de idempotência malformada", async () => {
    expect((await call(request(validBody, { headers: { "idempotency-key": "x" } }))).status).toBe(422);
  });

  it("honeypot preenchido: rejeitado sem contatar o n8n", async () => {
    const { status } = await call(request({ ...validBody, website: "http://spam.example" }));
    expect(status).toBe(422);
    expect(n8n.calls).toHaveLength(0);
  });

  it("400 para JSON inválido, 415 para content-type errado, 413 para corpo grande", async () => {
    expect((await call(request(null, { raw: "{nao-json" }))).status).toBe(400);
    expect((await call(request(validBody, { headers: { "content-type": "text/plain" } }))).status).toBe(415);
    const big = await call(request({ ...validBody, nome: "A".repeat(10_000) }));
    expect(big.status).toBe(413);
    expect(n8n.calls).toHaveLength(0);
  });

  it("403 para Origin de outro site", async () => {
    const { status, json } = await call(request(validBody, { headers: { origin: "https://evil.example" } }));
    expect(status).toBe(403);
    expect(json.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("aceita Origin igual ao host da requisição", async () => {
    const { status } = await call(request(validBody, { headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
    expect(status).toBe(201);
  });
});

describe("POST /api/rsvp — prazo", () => {
  it("403 RSVP_CLOSED depois do prazo configurado, sem contatar o n8n", async () => {
    vi.stubEnv("RSVP_DEADLINE", "2026-11-15T23:59:59-03:00");
    vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
    const { status, json } = await call(request(validBody));
    expect(status).toBe(403);
    expect(json.code).toBe("RSVP_CLOSED");
    expect(n8n.calls).toHaveLength(0);
  });

  it("aceita no último segundo do prazo e bloqueia logo depois", async () => {
    vi.stubEnv("RSVP_DEADLINE", "2026-11-15T23:59:59-03:00");
    vi.setSystemTime(new Date("2026-11-16T02:59:58Z")); // 23:59:58 em Fortaleza (ainda aberto)
    expect((await call(request(validBody))).status).toBe(201);
    vi.setSystemTime(new Date("2026-11-16T02:59:59Z"));
    expect((await call(request(validBody, { headers: { "idempotency-key": KEY_2 } }))).status).toBe(403);
  });

  it("sem RSVP_DEADLINE, fecha no início do evento", async () => {
    vi.setSystemTime(new Date("2026-11-22T11:00:00Z"));
    expect((await call(request(validBody))).status).toBe(403);
  });

  it("o prazo é interpretado no fuso informado, não no do servidor", async () => {
    vi.stubEnv("RSVP_DEADLINE", "2026-11-15T23:59:59-03:00");
    vi.setSystemTime(new Date("2026-11-16T00:30:00Z")); // 21:30 em Fortaleza: ainda aberto, mesmo já sendo dia 16 em UTC
    expect((await call(request(validBody))).status).toBe(201);
  });
});

describe("POST /api/rsvp — falhas do n8n", () => {
  const stubFetch = (impl: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(impl));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("503 quando o n8n está fora do ar (erro de rede)", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const res = await call(request(validBody));
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it.each([500, 502, 503, 504, 404, 401, 403, 418])("503 para status %s do n8n (sem vazar detalhes)", async (status) => {
    stubFetch(() => Promise.resolve(new Response("erro interno: planilha 1AbC... token=xyz", { status })));
    const res = await call(request(validBody));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.json)).not.toMatch(/planilha|token|xyz/);
  });

  it("503 para 2xx com corpo inválido ou incoerente — nunca declara sucesso sem confirmação válida", async () => {
    for (const response of [
      () => new Response("<html>ok</html>", { status: 200 }),
      () => json(201, { ok: true }),
      () => json(201, { ok: true, code: "CREATED" }),
      () => json(201, { ok: true, code: "CREATED", presenca: "NAO" }), // presença divergente da enviada
      () => json(201, { ok: false, code: "CREATED", presenca: "SIM" }),
      () => json(200, { ok: true, code: "CREATED", presenca: "SIM" }),
      () => new Response("", { status: 201 }),
    ]) {
      stubFetch(() => Promise.resolve(response()));
      expect((await call(request(validBody))).status).toBe(503);
    }
  });

  it("503 em timeout (n8n não responde dentro de N8N_TIMEOUT_MS)", async () => {
    vi.useRealTimers();
    vi.stubEnv("N8N_TIMEOUT_MS", "1000");
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    const res = await call(request(validBody));
    expect(res.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);

  it("mapeia 409/422/429 do n8n", async () => {
    stubFetch(() => Promise.resolve(json(409, { ok: false, code: "DUPLICATE_NAME" })));
    expect((await call(request(validBody))).status).toBe(409);
    stubFetch(() => Promise.resolve(json(422, { ok: false, code: "INVALID_DATA" })));
    expect((await call(request(validBody))).status).toBe(422);
    stubFetch(() => Promise.resolve(json(422, { ok: false, code: "RSVP_CLOSED" })));
    expect((await call(request(validBody))).status).toBe(403);
    stubFetch(() => Promise.resolve(json(429, { ok: false })));
    expect((await call(request(validBody))).status).toBe(429);
  });

  it("503 se o servidor não estiver configurado (sem expor o motivo)", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "");
    const res = await call(request(validBody));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.json)).not.toMatch(/N8N_/);
  });

  it("não registra nome, segredo ou URL nos logs", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(String(line)));
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    await call(request(validBody));
    await call(request(validBody, { headers: { "idempotency-key": KEY_2 } }));
    const all = logs.join("\n");
    expect(all).toContain("rsvp.result");
    expect(all).not.toContain("Maria");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("n8n.example.com");
    expect(all).not.toContain("203.0.113.10");
  });
});

describe("POST /api/rsvp — rate limiting", () => {
  it("429 com Retry-After após exceder o limite por IP; outro IP não é afetado", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "3");
    for (let i = 0; i < 3; i++) {
      const res = await call(request({ nome: "x" }, { ip: "198.51.100.77" }));
      expect(res.status).toBe(422);
    }
    const blocked = await call(request(validBody, { ip: "198.51.100.77" }));
    expect(blocked.status).toBe(429);
    expect(blocked.json.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call(request(validBody, { ip: "198.51.100.78" }))).status).toBe(201);
  });

  it("não deixa o cliente forjar o IP com X-Forwarded-For (usa a entrada do proxy confiável)", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const forged = (spoof: string) => request({ nome: "x" }, { headers: { "x-forwarded-for": `${spoof}, 198.51.100.50` } });
    await call(forged("1.1.1.1"));
    await call(forged("2.2.2.2"));
    expect((await call(forged("3.3.3.3"))).status).toBe(429);
  });

  it("limite global protege contra ataques distribuídos", async () => {
    vi.stubEnv("RATE_LIMIT_GLOBAL_PER_MINUTE", "2");
    await call(request({ nome: "x" }, { ip: "192.0.2.1" }));
    await call(request({ nome: "x" }, { ip: "192.0.2.2" }));
    expect((await call(request({ nome: "x" }, { ip: "192.0.2.3" }))).status).toBe(429);
  });
});

describe("GET /api/rsvp", () => {
  it("não aceita GET", async () => {
    const { GET } = await import("@/app/api/rsvp/route");
    expect(GET().status).toBe(405);
  });
});

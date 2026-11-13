import { describe, expect, it, vi } from "vitest";
import { interpretResponse, resetQueue, submitToN8n } from "@/lib/n8n";

const submission = { idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nome: "Maria da Silva", presenca: "SIM" as const, adultos: 1, criancas: 0 };
const config = {
  n8nWebhookUrl: "https://n8n.example.com/webhook/chatbb-rsvp",
  n8nWebhookSecret: "segredo-de-teste-com-mais-de-16-chars",
  n8nSecretHeader: "X-ChatBB-Secret",
  n8nTimeoutMs: 1000,
  maxQueuedSubmissions: 3,
};

describe("interpretResponse", () => {
  const body = (value: unknown) => JSON.stringify(value);

  it("traduz 201/200 válidos", () => {
    expect(interpretResponse(201, body({ ok: true, code: "CREATED", presenca: "SIM" }), submission)).toEqual({ kind: "created", presenca: "SIM" });
    expect(interpretResponse(200, body({ ok: true, code: "ALREADY_RECORDED", presenca: "NAO" }), submission)).toEqual({ kind: "replayed", presenca: "NAO" });
  });

  it("traduz 409, 422 e 429", () => {
    expect(interpretResponse(409, body({ ok: false, code: "DUPLICATE_NAME" }), submission).kind).toBe("duplicate");
    expect(interpretResponse(409, "", submission).kind).toBe("duplicate");
    expect(interpretResponse(422, body({ ok: false, code: "INVALID_DATA" }), submission).kind).toBe("invalid");
    expect(interpretResponse(422, body({ ok: false, code: "RSVP_CLOSED" }), submission).kind).toBe("closed");
    expect(interpretResponse(422, "não-json", submission).kind).toBe("invalid");
    expect(interpretResponse(429, "", submission).kind).toBe("rate_limited");
  });

  it("distingue falhas de autenticação, rota inexistente e erros do servidor (todas = indisponível)", () => {
    expect(interpretResponse(403, "Authorization data is wrong!", submission)).toMatchObject({ kind: "unavailable", reason: "auth" });
    expect(interpretResponse(401, "", submission)).toMatchObject({ kind: "unavailable", reason: "auth" });
    expect(interpretResponse(404, "", submission)).toMatchObject({ kind: "unavailable", reason: "not_found" });
    expect(interpretResponse(500, "", submission)).toMatchObject({ kind: "unavailable", reason: "upstream_error" });
    expect(interpretResponse(503, body({ ok: false, code: "SERVICE_UNAVAILABLE" }), submission)).toMatchObject({ kind: "unavailable" });
    expect(interpretResponse(302, "", submission)).toMatchObject({ kind: "unavailable", reason: "bad_status" });
  });

  it("não confia em 2xx com corpo inválido", () => {
    expect(interpretResponse(201, "", submission)).toMatchObject({ reason: "bad_response" });
    expect(interpretResponse(201, "x".repeat(30_000), submission)).toMatchObject({ reason: "bad_response" });
    expect(interpretResponse(201, body({ ok: true, code: "CREATED", presenca: "NAO" }), submission)).toMatchObject({ reason: "bad_response" });
  });
});

describe("submitToN8n", () => {
  it("envia POST JSON com segredo no cabeçalho, sem redirecionamentos e com timeout", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, code: "CREATED", presenca: "SIM" }), { status: 201 }));
    const outcome = await submitToN8n(submission, config, fetchMock as unknown as typeof fetch);
    expect(outcome).toEqual({ kind: "created", presenca: "SIM" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(config.n8nWebhookUrl);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)["X-ChatBB-Secret"]).toBe(config.n8nWebhookSecret);
  });

  it("classifica timeout e erro de rede", async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await submitToN8n(submission, config, timeout as unknown as typeof fetch)).toMatchObject({ kind: "unavailable", reason: "timeout" });
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await submitToN8n(submission, config, network as unknown as typeof fetch)).toMatchObject({ kind: "unavailable", reason: "network" });
  });

  it("envia um de cada vez e recusa quando a fila está cheia", async () => {
    resetQueue();
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const slow = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          release.push(() => {
            active -= 1;
            resolve(new Response(JSON.stringify({ ok: true, code: "CREATED", presenca: "SIM" }), { status: 201 }));
          });
        }),
    ) as unknown as typeof fetch;

    const pending = [1, 2, 3].map(() => submitToN8n(submission, config, slow));
    const rejected = await submitToN8n(submission, config, slow); // 4ª: fila (3) cheia
    expect(rejected).toMatchObject({ kind: "unavailable", reason: "queue_full" });

    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(release.length).toBeGreaterThan(i));
      release[i]!();
    }
    expect((await Promise.all(pending)).map((o) => o.kind)).toEqual(["created", "created", "created"]);
    expect(peak).toBe(1);
  });

  it("desiste (sem enviar) se esperou na fila mais que o timeout", async () => {
    resetQueue();
    let clock = 0;
    const now = () => clock;
    let releaseFirst!: () => void;
    const first = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(new Response(JSON.stringify({ ok: true, code: "CREATED", presenca: "SIM" }), { status: 201 }));
    });
    const fetchMock = vi.fn().mockReturnValueOnce(first) as unknown as typeof fetch;

    const p1 = submitToN8n(submission, config, fetchMock, now);
    const p2 = submitToN8n(submission, config, fetchMock, now);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // p1 já está em andamento
    clock = 5000; // passou do timeout de 1000 ms enquanto aguardava
    releaseFirst();
    expect((await p1).kind).toBe("created");
    expect(await p2).toMatchObject({ kind: "unavailable", reason: "queue_timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

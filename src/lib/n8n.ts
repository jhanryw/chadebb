import { z } from "zod";
import type { ServerConfig } from "./server-config";

/**
 * Cliente do webhook n8n (servidor → servidor).
 *
 * Contrato n8n → site (idêntico ao implementado em n8n/chatbb-workflow.json):
 *   201 {ok:true,  code:"CREATED",          presenca}   gravado no Sheets
 *   200 {ok:true,  code:"ALREADY_RECORDED", presenca}   mesma chave de idempotência já gravada
 *   409 {ok:false, code:"DUPLICATE_NAME" | "IDEMPOTENCY_CONFLICT"}
 *   422 {ok:false, code:"INVALID_DATA" | "RSVP_CLOSED"}
 *   503 {ok:false, code:"SERVICE_UNAVAILABLE"}
 * Qualquer outra coisa (401/403 do auth do webhook, 404, 5xx, timeout, corpo
 * inválido) é tratada como indisponibilidade → 503 para o navegador.
 */

export interface N8nSubmission {
  idempotencyKey: string;
  nome: string;
  presenca: "SIM" | "NAO";
  adultos: number;
  criancas: number;
}

export type UnavailableReason =
  | "timeout"
  | "network"
  | "auth"
  | "not_found"
  | "upstream_error"
  | "bad_status"
  | "bad_response"
  | "queue_full"
  | "queue_timeout";

export type N8nOutcome =
  | { kind: "created" | "replayed"; presenca: "SIM" | "NAO" }
  | { kind: "duplicate" }
  | { kind: "closed" }
  | { kind: "invalid" }
  | { kind: "rate_limited" }
  | { kind: "unavailable"; reason: UnavailableReason; httpStatus?: number };

const MAX_RESPONSE_CHARS = 20_000;

const n8nBodySchema = z.looseObject({
  ok: z.boolean(),
  code: z.string().max(64),
  presenca: z.enum(["SIM", "NAO"]).optional(),
});

// ---------------------------------------------------------------------------
// Serialização de envios dentro do processo.
//
// O trecho crítico "buscar duplicidade → gravar" roda no n8n. Para reduzir a
// chance de duas execuções concorrentes, o site enfileira os envios e só envia
// o próximo quando o anterior terminou. Vale para UMA réplica do site; a
// garantia forte é o limite de concorrência do n8n (ver README).
// ---------------------------------------------------------------------------

class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  get size(): number {
    return this.pending;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1;
    const result = this.tail.then(task);
    this.tail = result
      .catch(() => undefined)
      .finally(() => {
        this.pending -= 1;
      });
    return result;
  }
}

const QUEUE_KEY = Symbol.for("chatbb.n8n-queue");

function getQueue(): SerialQueue {
  const store = globalThis as unknown as Record<symbol, SerialQueue | undefined>;
  store[QUEUE_KEY] ??= new SerialQueue();
  return store[QUEUE_KEY];
}

export function resetQueue(): void {
  (globalThis as unknown as Record<symbol, unknown>)[QUEUE_KEY] = undefined;
}

// ---------------------------------------------------------------------------

export async function submitToN8n(
  submission: N8nSubmission,
  config: Pick<
    ServerConfig,
    "n8nWebhookUrl" | "n8nWebhookSecret" | "n8nSecretHeader" | "n8nTimeoutMs" | "maxQueuedSubmissions"
  >,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<N8nOutcome> {
  const queue = getQueue();
  if (queue.size >= config.maxQueuedSubmissions) {
    return { kind: "unavailable", reason: "queue_full" };
  }

  const enqueuedAt = now();
  return queue.run(async () => {
    // Se esperou demais na fila, nada foi enviado ainda: seguro falhar e deixar o cliente tentar de novo.
    if (now() - enqueuedAt > config.n8nTimeoutMs) {
      return { kind: "unavailable", reason: "queue_timeout" } as N8nOutcome;
    }
    return callWebhook(submission, config, fetchImpl);
  });
}

async function callWebhook(
  submission: N8nSubmission,
  config: Pick<ServerConfig, "n8nWebhookUrl" | "n8nWebhookSecret" | "n8nSecretHeader" | "n8nTimeoutMs">,
  fetchImpl: typeof fetch,
): Promise<N8nOutcome> {
  const payload = {
    idempotencyKey: submission.idempotencyKey,
    nome: submission.nome,
    presenca: submission.presenca,
    adultos: submission.adultos,
    criancas: submission.criancas,
    origem: "site",
    enviadoEm: new Date().toISOString(),
  };

  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(config.n8nWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [config.n8nSecretHeader]: config.n8nWebhookSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.n8nTimeoutMs),
      redirect: "error",
      cache: "no-store",
    });
    text = await response.text();
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { kind: "unavailable", reason: "timeout" };
    }
    return { kind: "unavailable", reason: "network" };
  }

  return interpretResponse(response.status, text, submission);
}

/** Exportada para testes: traduz (status, corpo) do n8n em um resultado de domínio. */
export function interpretResponse(
  status: number,
  text: string,
  submission: Pick<N8nSubmission, "presenca">,
): N8nOutcome {
  if (text.length > MAX_RESPONSE_CHARS) {
    return { kind: "unavailable", reason: "bad_response", httpStatus: status };
  }

  let body: z.infer<typeof n8nBodySchema> | null = null;
  try {
    const parsed = n8nBodySchema.safeParse(JSON.parse(text));
    body = parsed.success ? parsed.data : null;
  } catch {
    body = null;
  }

  switch (status) {
    case 201:
    case 200: {
      const expectedCode = status === 201 ? "CREATED" : "ALREADY_RECORDED";
      if (!body || !body.ok || body.code !== expectedCode || !body.presenca) {
        return { kind: "unavailable", reason: "bad_response", httpStatus: status };
      }
      // No 201 o registro acabou de ser criado: a presença gravada tem de ser a enviada.
      if (status === 201 && body.presenca !== submission.presenca) {
        return { kind: "unavailable", reason: "bad_response", httpStatus: status };
      }
      return { kind: status === 201 ? "created" : "replayed", presenca: body.presenca };
    }
    case 409:
      return { kind: "duplicate" };
    case 422:
      return body?.code === "RSVP_CLOSED" ? { kind: "closed" } : { kind: "invalid" };
    case 429:
      return { kind: "rate_limited" };
    case 401:
    case 403:
      return { kind: "unavailable", reason: "auth", httpStatus: status };
    case 404:
      return { kind: "unavailable", reason: "not_found", httpStatus: status };
    default:
      return status >= 500
        ? { kind: "unavailable", reason: "upstream_error", httpStatus: status }
        : { kind: "unavailable", reason: "bad_status", httpStatus: status };
  }
}

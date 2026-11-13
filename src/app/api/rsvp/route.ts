import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ConfigError,
  getEventConfig,
  isRsvpOpen,
  type EventConfig,
} from "@/lib/event-config";
import {
  ERROR_STATUS,
  errorBody,
  type ApiBody,
  type ApiErrorCode,
} from "@/lib/errors";
import { logEvent } from "@/lib/logger";
import { submitToN8n, type N8nOutcome } from "@/lib/n8n";
import {
  getClientIp,
  getLimiters,
  isAllowedOrigin,
  readBodyLimited,
} from "@/lib/security";
import { parseServerConfig, type ServerConfig } from "@/lib/server-config";
import { buildRsvpSchema, isIdempotencyKey, toFieldErrors } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Corpo máximo aceito (o payload legítimo tem menos de 400 bytes). */
const MAX_BODY_BYTES = 4 * 1024;

function respond(
  body: ApiBody,
  status: number,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...extraHeaders,
    },
  });
}

function fail(
  code: ApiErrorCode,
  requestId: string,
  options: { fieldErrors?: Record<string, string>; headers?: Record<string, string> } = {},
): NextResponse {
  return respond(
    errorBody(code, options.fieldErrors ? { fieldErrors: options.fieldErrors } : undefined),
    ERROR_STATUS[code],
    requestId,
    options.headers,
  );
}

function mapOutcome(outcome: N8nOutcome, requestId: string): NextResponse {
  switch (outcome.kind) {
    case "created":
      return respond({ ok: true, code: "CREATED", presenca: outcome.presenca }, 201, requestId);
    case "replayed":
      return respond({ ok: true, code: "ALREADY_RECORDED", presenca: outcome.presenca }, 200, requestId);
    case "duplicate":
      return fail("DUPLICATE_NAME", requestId);
    case "closed":
      return fail("RSVP_CLOSED", requestId);
    case "invalid":
      // O Next já validou: se o n8n discorda, é divergência de configuração. Mensagem genérica.
      return fail("INVALID_DATA", requestId);
    case "rate_limited":
      return fail("RATE_LIMITED", requestId, { headers: { "Retry-After": "30" } });
    case "unavailable":
      return fail("SERVICE_UNAVAILABLE", requestId, { headers: { "Retry-After": "10" } });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let eventConfig: EventConfig;
  let serverConfig: ServerConfig;
  try {
    eventConfig = getEventConfig();
    serverConfig = parseServerConfig();
  } catch (error) {
    // Mensagem do ConfigError cita só nomes de variáveis, nunca valores.
    logEvent("rsvp.error", {
      requestId,
      reason: "config",
      detail: error instanceof ConfigError ? error.message : "unknown",
    });
    return fail("SERVICE_UNAVAILABLE", requestId);
  }

  const finish = (response: NextResponse, extra: Record<string, string | number | undefined> = {}) => {
    logEvent("rsvp.result", {
      requestId,
      status: response.status,
      ms: Date.now() - startedAt,
      ...extra,
    });
    return response;
  };

  // 1. Origem
  if (!isAllowedOrigin(request.headers, eventConfig.siteUrl)) {
    return finish(fail("FORBIDDEN_ORIGIN", requestId), { reason: "origin" });
  }

  // 2. Rate limiting (antes de qualquer trabalho caro)
  const limiters = getLimiters(serverConfig);
  const global = limiters.global.check("global");
  const perIp = limiters.perIp.check(getClientIp(request.headers, serverConfig.trustedProxyHops));
  if (!global.allowed || !perIp.allowed) {
    const retryAfter = Math.max(global.retryAfterSeconds, perIp.retryAfterSeconds, 1);
    return finish(fail("RATE_LIMITED", requestId, { headers: { "Retry-After": String(retryAfter) } }));
  }

  // 3. Prazo
  if (!isRsvpOpen(eventConfig)) {
    return finish(fail("RSVP_CLOSED", requestId));
  }

  // 4. Content-Type
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return finish(fail("UNSUPPORTED_MEDIA_TYPE", requestId));
  }

  // 5. Corpo limitado
  const body = await readBodyLimited(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return finish(fail(body.reason === "too_large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", requestId));
  }

  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return finish(fail("INVALID_JSON", requestId));
  }

  // 6. Validação (Zod)
  const parsed = buildRsvpSchema(eventConfig.limits).safeParse(json);
  if (!parsed.success) {
    return finish(fail("INVALID_DATA", requestId, { fieldErrors: toFieldErrors(parsed.error) }));
  }
  const data = parsed.data;
  if (data.honeypot !== "") {
    // Robô: resposta genérica de dados inválidos, sem enviar nada ao n8n.
    return finish(fail("INVALID_DATA", requestId), { reason: "honeypot" });
  }

  // 7. Chave de idempotência (recebida do navegador; se ausente/ inválida, gera uma nova)
  const headerKey = request.headers.get("idempotency-key");
  if (headerKey !== null && !isIdempotencyKey(headerKey)) {
    return finish(fail("INVALID_DATA", requestId), { reason: "idempotency-key" });
  }
  const idempotencyKey = headerKey ?? randomUUID();

  // 8. n8n
  const outcome = await submitToN8n(
    {
      idempotencyKey,
      nome: data.nome,
      presenca: data.presenca,
      adultos: data.adultos,
      criancas: data.criancas,
    },
    serverConfig,
  );

  if (outcome.kind === "unavailable") {
    logEvent("rsvp.warn", {
      requestId,
      reason: outcome.reason,
      upstreamStatus: outcome.httpStatus,
    });
  }

  return finish(mapOutcome(outcome, requestId), {
    outcome: outcome.kind,
    presenca: data.presenca,
  });
}

/** Qualquer outro método → 405 sem corpo útil. */
export function GET(): NextResponse {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

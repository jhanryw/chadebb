import type { ApiErrorCode } from "./errors";
import type { FieldErrors } from "./validations";

export interface RsvpRequest {
  nome: string;
  presenca: "SIM" | "NAO";
  adultos: number;
  criancas: number;
  /** Honeypot (sempre vazio para pessoas). */
  website: string;
}

export type RsvpClientResult =
  | { kind: "success"; presenca: "SIM" | "NAO"; replayed: boolean }
  | { kind: "closed"; message: string }
  | { kind: "field-errors"; message: string; fieldErrors: FieldErrors }
  | { kind: "error"; code: ApiErrorCode | "NETWORK"; message: string };

export const NETWORK_ERROR_MESSAGE =
  "Não conseguimos nos conectar. Verifique sua internet e tente novamente — sua resposta só é registrada quando você vê a confirmação.";

const GENERIC_ERROR_MESSAGE = "Não foi possível registrar sua resposta agora. Por favor, tente novamente em instantes.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Chave de idempotência por tentativa (UUID v4). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Envia a confirmação para POST /api/rsvp (nunca diretamente ao n8n).
 * Só retorna `success` quando o backend confirma a gravação (HTTP 200/201 + ok:true).
 */
export async function submitRsvp(
  request: RsvpRequest,
  idempotencyKey: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<RsvpClientResult> {
  const { timeoutMs = 30_000, fetchImpl = fetch } = options;

  let response: Response;
  try {
    response = await fetchImpl("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return { kind: "error", code: "NETWORK", message: NETWORK_ERROR_MESSAGE };
  }

  const body = asRecord(await response.json().catch(() => null));
  const message = typeof body?.message === "string" ? body.message : GENERIC_ERROR_MESSAGE;
  const code = typeof body?.code === "string" ? body.code : "";

  if ((response.status === 201 || response.status === 200) && body?.ok === true) {
    if (body.presenca === "SIM" || body.presenca === "NAO") {
      return { kind: "success", presenca: body.presenca, replayed: response.status === 200 };
    }
    return { kind: "error", code: "SERVICE_UNAVAILABLE", message: GENERIC_ERROR_MESSAGE };
  }

  if (response.status === 403 && code === "RSVP_CLOSED") {
    return { kind: "closed", message };
  }

  if (response.status === 422) {
    const raw = asRecord(body?.fieldErrors);
    const fieldErrors: FieldErrors = {};
    if (raw) {
      for (const key of ["nome", "presenca", "adultos", "criancas"] as const) {
        const value = raw[key];
        if (typeof value === "string") fieldErrors[key] = value;
      }
    }
    return { kind: "field-errors", message, fieldErrors };
  }

  return { kind: "error", code: (code || "SERVICE_UNAVAILABLE") as ApiErrorCode, message };
}

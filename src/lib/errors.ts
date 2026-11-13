/**
 * Contrato HTTP/JSON do ChatBB.
 *
 * Site → navegador (POST /api/rsvp):
 *   201 CREATED              confirmação gravada
 *   200 ALREADY_RECORDED     reenvio idempotente de operação já concluída
 *   400 INVALID_JSON         corpo não é JSON
 *   403 RSVP_CLOSED          prazo encerrado
 *   403 FORBIDDEN_ORIGIN     requisição de outra origem
 *   409 DUPLICATE_NAME       nome já utilizado em outra confirmação
 *   413 PAYLOAD_TOO_LARGE    corpo acima do limite
 *   415 UNSUPPORTED_MEDIA_TYPE
 *   422 INVALID_DATA         dados inválidos (com `fieldErrors`)
 *   429 RATE_LIMITED         excesso de solicitações (cabeçalho Retry-After)
 *   503 SERVICE_UNAVAILABLE  n8n/Sheets indisponível, timeout ou resposta inválida
 *
 * n8n → site (webhook): 201, 200, 409, 422 (INVALID_DATA | RSVP_CLOSED), 503.
 * Detalhes completos em README.md ("Contrato da API").
 */

export type ApiErrorCode =
  | "INVALID_JSON"
  | "RSVP_CLOSED"
  | "FORBIDDEN_ORIGIN"
  | "DUPLICATE_NAME"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INVALID_DATA"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE";

export type ApiSuccessCode = "CREATED" | "ALREADY_RECORDED";

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  INVALID_JSON: 400,
  RSVP_CLOSED: 403,
  FORBIDDEN_ORIGIN: 403,
  DUPLICATE_NAME: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_DATA: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
};

/** Mensagens genéricas (nunca revelam dados de outros convidados nem detalhes internos). */
export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  INVALID_JSON: "Não foi possível ler os dados enviados. Atualize a página e tente novamente.",
  RSVP_CLOSED: "O prazo para confirmação de presença já foi encerrado.",
  FORBIDDEN_ORIGIN: "Não foi possível processar a solicitação.",
  DUPLICATE_NAME:
    "Não foi possível registrar esta confirmação. Se você já respondeu, não é necessário enviar novamente. Em caso de dúvida, fale com os anfitriões.",
  PAYLOAD_TOO_LARGE: "Os dados enviados são grandes demais.",
  UNSUPPORTED_MEDIA_TYPE: "Formato de envio não suportado.",
  INVALID_DATA: "Verifique os campos destacados e tente novamente.",
  RATE_LIMITED: "Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.",
  SERVICE_UNAVAILABLE:
    "Não foi possível registrar sua resposta agora. Por favor, tente novamente em instantes.",
};

export interface ApiSuccessBody {
  ok: true;
  code: ApiSuccessCode;
  presenca: "SIM" | "NAO";
}

export interface ApiErrorBody {
  ok: false;
  code: ApiErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
}

export type ApiBody = ApiSuccessBody | ApiErrorBody;

export function errorBody(
  code: ApiErrorCode,
  extra?: { fieldErrors?: Record<string, string> },
): ApiErrorBody {
  return {
    ok: false,
    code,
    message: ERROR_MESSAGES[code],
    ...(extra?.fieldErrors ? { fieldErrors: extra.fieldErrors } : {}),
  };
}

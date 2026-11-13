import { z } from "zod";
import { ConfigError, readEnv } from "./event-config";

/**
 * Configuração PRIVADA do servidor (segredos e ajustes operacionais).
 * Nunca importar este módulo em componentes cliente.
 */

export interface ServerConfig {
  n8nWebhookUrl: string;
  n8nWebhookSecret: string;
  n8nSecretHeader: string;
  n8nTimeoutMs: number;
  /** Máx. de requisições por IP na janela. */
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  /** Máx. de requisições (todas as origens) por minuto neste processo. */
  rateLimitGlobalPerMinute: number;
  /** Quantos proxies confiáveis existem à frente do app (EasyPanel/Traefik = 1). */
  trustedProxyHops: number;
  /** Máx. de envios aguardando a vez para o n8n antes de responder 503. */
  maxQueuedSubmissions: number;
}

const schema = z.object({
  N8N_WEBHOOK_URL: z
    .string({ error: "N8N_WEBHOOK_URL não configurada" })
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    }, "N8N_WEBHOOK_URL deve ser uma URL http(s) válida"),
  N8N_WEBHOOK_SECRET: z
    .string({ error: "N8N_WEBHOOK_SECRET não configurada" })
    .min(16, "N8N_WEBHOOK_SECRET deve ter pelo menos 16 caracteres"),
  N8N_WEBHOOK_SECRET_HEADER: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "Nome de cabeçalho inválido")
    .default("X-ChatBB-Secret"),
  N8N_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(86400).default(600),
  RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(60),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  MAX_QUEUED_SUBMISSIONS: z.coerce.number().int().min(1).max(500).default(30),
});

export function parseServerConfig(
  source: Record<string, string | undefined> = process.env,
): ServerConfig {
  const raw: Record<string, string | undefined> = {};
  for (const name of Object.keys(schema.shape)) raw[name] = readEnv(source, name);

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Mensagens citam apenas NOMES de variáveis, nunca valores (podem ser segredos).
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Configuração do servidor inválida — ${problems}`);
  }
  const env = parsed.data;
  return {
    n8nWebhookUrl: env.N8N_WEBHOOK_URL,
    n8nWebhookSecret: env.N8N_WEBHOOK_SECRET,
    n8nSecretHeader: env.N8N_WEBHOOK_SECRET_HEADER,
    n8nTimeoutMs: env.N8N_TIMEOUT_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    rateLimitGlobalPerMinute: env.RATE_LIMIT_GLOBAL_PER_MINUTE,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    maxQueuedSubmissions: env.MAX_QUEUED_SUBMISSIONS,
  };
}

export function isServerConfigured(
  source: Record<string, string | undefined> = process.env,
): boolean {
  try {
    parseServerConfig(source);
    return true;
  } catch {
    return false;
  }
}

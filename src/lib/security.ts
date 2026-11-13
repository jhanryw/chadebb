/**
 * Utilitários de segurança: leitura limitada do corpo, identificação do IP,
 * verificação de origem e limitação de taxa (rate limiting).
 *
 * LIMITAÇÃO IMPORTANTE (rate limiting): o estado fica na memória do processo.
 * Isso é suficiente para conter abuso básico com UMA réplica. Com várias
 * réplicas cada uma conta separadamente (o limite efetivo vira N × limite).
 * Rate limiting aqui é antiabuso, NÃO garantia de unicidade — a unicidade de
 * nomes é verificada pelo workflow n8n (ver README).
 */

export type BodyResult = { ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" };

export async function readBodyLimited(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return { ok: false, reason: "unreadable" };
    if (length > maxBytes) return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(buffer) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * IP do cliente atrás de proxies confiáveis. Com `hops` proxies à frente do app,
 * o IP real é a entrada `hops`-ésima a partir do FIM de X-Forwarded-For
 * (entradas à esquerda podem ser forjadas pelo cliente).
 */
export function getClientIp(headers: Headers, hops: number): string {
  if (hops > 0) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const candidate = parts[Math.max(0, parts.length - hops)];
      if (candidate) return candidate.slice(0, 64);
    }
    const real = headers.get("x-real-ip");
    if (real) return real.trim().slice(0, 64);
  }
  return "unknown";
}

/**
 * Rejeita POSTs de navegador originados em outro site. Requisições sem
 * cabeçalho Origin (curl, servidores) passam: não há como diferenciá-las e
 * a proteção real é validação + rate limiting.
 */
export function isAllowedOrigin(headers: Headers, siteUrl: string | null): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  if (siteUrl) {
    try {
      allowed.add(new URL(siteUrl).host.toLowerCase());
    } catch {
      /* ignorado */
    }
  }
  for (const name of ["x-forwarded-host", "host"]) {
    const value = headers.get(name);
    if (value) allowed.add(value.split(",")[0]!.trim().toLowerCase());
  }
  return allowed.has(originHost);
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Limitador de janela fixa, em memória, com poda de chaves antigas. */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string, now: number = Date.now()): RateLimitResult {
    if (this.hits.size >= this.maxKeys) this.prune(now);

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      // Se o mapa continua cheio mesmo após a poda, falha fechado para chaves novas.
      if (!entry && this.hits.size >= this.maxKeys) {
        return { allowed: false, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
      }
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (entry.count >= this.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

interface LimiterSet {
  signature: string;
  perIp: FixedWindowLimiter;
  global: FixedWindowLimiter;
}

const LIMITERS_KEY = Symbol.for("chatbb.rate-limiters");

/** Singleton por processo (sobrevive a recarregamentos de módulo em dev). */
export function getLimiters(config: {
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  rateLimitGlobalPerMinute: number;
}): LimiterSet {
  const store = globalThis as unknown as Record<symbol, LimiterSet | undefined>;
  const signature = `${config.rateLimitMax}/${config.rateLimitWindowSeconds}/${config.rateLimitGlobalPerMinute}`;
  const current = store[LIMITERS_KEY];
  if (current && current.signature === signature) return current;
  const created: LimiterSet = {
    signature,
    perIp: new FixedWindowLimiter(config.rateLimitMax, config.rateLimitWindowSeconds * 1000),
    global: new FixedWindowLimiter(config.rateLimitGlobalPerMinute, 60_000, 1),
  };
  store[LIMITERS_KEY] = created;
  return created;
}

/** Apenas para testes. */
export function resetLimiters(): void {
  (globalThis as unknown as Record<symbol, unknown>)[LIMITERS_KEY] = undefined;
}

import { z } from "zod";

/**
 * Configuração tipada do evento.
 *
 * - Textos fixos do convite ficam em `EVENT_CONTENT`.
 * - Valores que mudam por ambiente (data, prazo, endereço, mapa, limites) vêm
 *   de variáveis de ambiente lidas **em tempo de execução** no servidor. Assim o
 *   mesmo build/imagem Docker funciona em qualquer ambiente, sem depender de
 *   variáveis `NEXT_PUBLIC_*` embutidas no build.
 * - Nada aqui é segredo: o resultado de `getPublicEventConfig()` é enviado ao
 *   navegador.
 */

export const EVENT_CONTENT = {
  title: "Luiza ou Augusto?",
  subtitle: "Uma celebração de fé, amor e gratidão.",
  eventName:
    "Celebração de fé e gratidão com revelação do sexo do bebê",
  venueName: "Capela do Colégio Nossa Senhora das Neves",
  city: "Natal/RN",
  afterCelebration: "Após a celebração, compartilharemos um café da manhã especial.",
  dressCode: "Pedimos carinhosamente que venham com roupas em tons claros.",
  invitationParagraphs: [
    "Há graças que chegam como resposta a muitas orações.",
    "A nossa veio pelas mãos de Deus, sob a intercessão e o manto de Nossa Senhora das Graças.",
    "Depois de tantos terços rezados e de tanta fé depositada no Senhor, hoje temos a alegria de agradecer pela vida que nos foi confiada.",
    "E não haveria lugar mais especial para viver esse momento do que na presença de Deus, junto às pessoas que amamos.",
    "Convidamos você para uma celebração de fé e gratidão, na qual também descobriremos juntos quem é o nosso tão esperado pinguinho.",
  ],
  successAttending:
    "Que alegria! Sua presença foi confirmada. Esperamos você para compartilhar esse momento tão especial.",
  successNotAttending:
    "Sentiremos sua falta, mas agradecemos por nos responder e pelo carinho.",
} as const;

export const DEFAULTS = {
  eventDate: "2026-11-22T08:00:00-03:00",
  timezone: "America/Fortaleza",
  maxAdults: 10,
  maxChildren: 10,
} as const;

/** Teto absoluto (também aplicado no workflow n8n). */
export const HARD_LIMIT = 50;

const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const isoWithOffset = (name: string) =>
  z
    .string()
    .regex(
      ISO_WITH_OFFSET,
      `${name} deve ser uma data ISO 8601 COM fuso, ex.: 2026-11-22T08:00:00-03:00`,
    )
    .refine((value) => !Number.isNaN(Date.parse(value)), `${name} é uma data inválida`);

const httpsUrl = (name: string) =>
  z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, `${name} deve ser uma URL https válida`);

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const eventEnvSchema = z.object({
  EVENT_DATE: isoWithOffset("EVENT_DATE").default(DEFAULTS.eventDate),
  EVENT_TIMEZONE: z
    .string()
    .default(DEFAULTS.timezone)
    .refine(isValidTimeZone, "EVENT_TIMEZONE não é um fuso IANA válido"),
  RSVP_DEADLINE: isoWithOffset("RSVP_DEADLINE").optional(),
  EVENT_ADDRESS: z.string().max(300).optional(),
  EVENT_MAP_URL: httpsUrl("EVENT_MAP_URL").optional(),
  EVENT_MAP_EMBED_URL: httpsUrl("EVENT_MAP_EMBED_URL").optional(),
  NEXT_PUBLIC_SITE_URL: httpsUrl("NEXT_PUBLIC_SITE_URL")
    .or(z.string().regex(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/))
    .optional(),
  RSVP_MAX_ADULTS: z.coerce.number().int().min(1).max(HARD_LIMIT).default(DEFAULTS.maxAdults),
  RSVP_MAX_CHILDREN: z.coerce.number().int().min(0).max(HARD_LIMIT).default(DEFAULTS.maxChildren),
  RSVP_ALLOW_CHILD_HOLDER: booleanFlag.default(false),
});

export interface EventConfig {
  title: string;
  subtitle: string;
  eventName: string;
  venueName: string;
  city: string;
  address: string | null;
  /** Instante absoluto do início (ISO com offset). */
  eventDateISO: string;
  timeZone: string;
  /** Instante absoluto em que as confirmações são bloqueadas. */
  rsvpClosesAtISO: string;
  /** `true` se RSVP_DEADLINE foi configurado explicitamente. */
  hasExplicitDeadline: boolean;
  mapUrl: string;
  mapEmbedUrl: string;
  siteUrl: string | null;
  limits: RsvpLimits;
}

export interface RsvpLimits {
  maxAdults: number;
  maxChildren: number;
  /** Permite que o titular seja uma criança (adultos = 0, crianças ≥ 1). */
  allowChildHolder: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Lê variável por nome dinâmico (evita inlining de NEXT_PUBLIC_* no build). */
export function readEnv(
  source: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseEventConfig(
  source: Record<string, string | undefined> = process.env,
): EventConfig {
  const names = Object.keys(eventEnvSchema.shape);
  const raw: Record<string, string | undefined> = {};
  for (const name of names) raw[name] = readEnv(source, name);

  const parsed = eventEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Configuração do evento inválida — ${problems}`);
  }
  const env = parsed.data;

  const { venueName, city } = EVENT_CONTENT;
  const mapQuery = env.EVENT_ADDRESS ?? `${venueName}, ${city}`;
  const encodedQuery = encodeURIComponent(mapQuery);

  return {
    title: EVENT_CONTENT.title,
    subtitle: EVENT_CONTENT.subtitle,
    eventName: EVENT_CONTENT.eventName,
    venueName,
    city,
    address: env.EVENT_ADDRESS ?? null,
    eventDateISO: env.EVENT_DATE,
    timeZone: env.EVENT_TIMEZONE,
    rsvpClosesAtISO: env.RSVP_DEADLINE ?? env.EVENT_DATE,
    hasExplicitDeadline: env.RSVP_DEADLINE !== undefined,
    mapUrl:
      env.EVENT_MAP_URL ??
      `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`,
    mapEmbedUrl:
      env.EVENT_MAP_EMBED_URL ??
      `https://www.google.com/maps?q=${encodedQuery}&output=embed`,
    siteUrl: env.NEXT_PUBLIC_SITE_URL ?? null,
    limits: {
      maxAdults: env.RSVP_MAX_ADULTS,
      maxChildren: env.RSVP_MAX_CHILDREN,
      allowChildHolder: env.RSVP_ALLOW_CHILD_HOLDER,
    },
  };
}

/** Verdadeiro enquanto ainda é permitido confirmar presença. */
export function isRsvpOpen(config: Pick<EventConfig, "rsvpClosesAtISO">, now: Date = new Date()): boolean {
  return now.getTime() < Date.parse(config.rsvpClosesAtISO);
}

// ---------------------------------------------------------------------------
// Formatação (sempre no fuso do evento, independente do fuso do servidor).
// ---------------------------------------------------------------------------

export function formatEventDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long" }).format(date);
  return `${day}, ${weekday}`;
}

export function formatEventTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "0";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return minute === "00" ? `${Number(hour)}h` : `${Number(hour)}h${minute}`;
}

export function formatLongDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Visão pública (serializável) usada pelos componentes.
// ---------------------------------------------------------------------------

export interface PublicEventConfig {
  title: string;
  subtitle: string;
  venueName: string;
  city: string;
  address: string | null;
  eventDateISO: string;
  timeZone: string;
  dateLabel: string;
  weekdayLabel: string;
  longDateLabel: string;
  timeLabel: string;
  fullDateLabel: string;
  mapUrl: string;
  mapEmbedUrl: string;
  rsvp: {
    open: boolean;
    deadlineLabel: string | null;
    limits: RsvpLimits;
  };
}

export function toPublicEventConfig(
  config: EventConfig,
  now: Date = new Date(),
): PublicEventConfig {
  const { eventDateISO, timeZone } = config;
  const dateLabel = formatEventDate(eventDateISO, timeZone);
  const timeLabel = formatEventTime(eventDateISO, timeZone);
  const longDateLabel = formatLongDate(eventDateISO, timeZone);
  const weekdayLabel = dateLabel.slice(longDateLabel.length + 2);

  return {
    title: config.title,
    subtitle: config.subtitle,
    venueName: config.venueName,
    city: config.city,
    address: config.address,
    eventDateISO,
    timeZone,
    dateLabel,
    weekdayLabel,
    longDateLabel,
    timeLabel,
    fullDateLabel: `${longDateLabel}, ${weekdayLabel}, às ${timeLabel}`,
    mapUrl: config.mapUrl,
    mapEmbedUrl: config.mapEmbedUrl,
    rsvp: {
      open: isRsvpOpen(config, now),
      deadlineLabel: config.hasExplicitDeadline
        ? formatLongDate(config.rsvpClosesAtISO, timeZone)
        : null,
      limits: config.limits,
    },
  };
}

/** Configuração do evento a partir do ambiente do processo (leitura barata, sem cache). */
export function getEventConfig(): EventConfig {
  return parseEventConfig(process.env);
}

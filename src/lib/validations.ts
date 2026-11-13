import { z } from "zod";
import { cleanName, computeTotalPeople } from "./normalization";
import type { RsvpLimits } from "./event-config";

export const NAME_MIN_LENGTH = 5;
export const NAME_MAX_LENGTH = 100;
export const NAME_MIN_WORDS = 2;

/**
 * Letras (qualquer idioma, com acentos), espaço, apóstrofo, hífen e ponto.
 * Precisa COMEÇAR com letra: isso, além de proteger o nome, impede valores
 * iniciados por `=`, `+`, `-`, `@` (injeção de fórmulas em planilhas).
 */
export const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .\-\u2019]*$/u;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const presencaSchema = z.enum(["SIM", "NAO"], {
  error: "Informe se você estará presente.",
});
export type Presenca = z.infer<typeof presencaSchema>;

function nameSchema() {
  return z
    .string({ error: "Informe seu nome completo." })
    .transform(cleanName)
    .pipe(
      z
        .string()
        .min(1, "Informe seu nome completo.")
        .min(NAME_MIN_LENGTH, "Informe seu nome completo.")
        .max(NAME_MAX_LENGTH, `Use no máximo ${NAME_MAX_LENGTH} caracteres.`)
        .regex(
          NAME_PATTERN,
          "Use apenas letras, espaços, hífen, apóstrofo e ponto.",
        )
        .refine(
          (value) => value.split(" ").filter(Boolean).length >= NAME_MIN_WORDS,
          "Informe nome e sobrenome.",
        ),
    );
}

function countSchema(label: string, max: number) {
  return z
    .number({ error: `Informe a quantidade de ${label}.` })
    .int(`A quantidade de ${label} deve ser um número inteiro.`)
    .min(0, `A quantidade de ${label} não pode ser negativa.`)
    .max(max, `O máximo de ${label} é ${max}.`);
}

/**
 * Esquema ÚNICO do payload de RSVP, usado no navegador e na API.
 * Saída já normalizada: nome limpo, quantidades zeradas para "NAO" e
 * `totalPessoas` calculado.
 */
export function buildRsvpSchema(limits: RsvpLimits) {
  return z
    .strictObject({
      nome: nameSchema(),
      presenca: presencaSchema,
      adultos: countSchema("adultos", limits.maxAdults).default(0),
      criancas: countSchema("crianças", limits.maxChildren).default(0),
      /** Honeypot: pessoas não preenchem; bots sim. */
      website: z.string().max(200).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.presenca !== "SIM") return;
      const minAdults = limits.allowChildHolder ? 0 : 1;
      if (value.adultos < minAdults) {
        ctx.addIssue({
          code: "custom",
          path: ["adultos"],
          message: "Inclua pelo menos 1 adulto (você).",
        });
      }
      if (value.adultos + value.criancas < 1) {
        ctx.addIssue({
          code: "custom",
          path: ["criancas"],
          message: "Informe pelo menos 1 pessoa presente.",
        });
      }
    })
    .transform(({ website, ...value }) => {
      const adultos = value.presenca === "SIM" ? value.adultos : 0;
      const criancas = value.presenca === "SIM" ? value.criancas : 0;
      return {
        nome: value.nome,
        presenca: value.presenca,
        adultos,
        criancas,
        totalPessoas: computeTotalPeople(value.presenca, adultos, criancas),
        honeypot: website ?? "",
      };
    });
}

export type RsvpInput = z.input<ReturnType<typeof buildRsvpSchema>>;
export type RsvpData = z.output<ReturnType<typeof buildRsvpSchema>>;

export type FieldErrors = Partial<Record<"nome" | "presenca" | "adultos" | "criancas", string>>;

/** Converte issues do Zod em mensagens por campo (primeira mensagem de cada campo). */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (
      (key === "nome" || key === "presenca" || key === "adultos" || key === "criancas") &&
      !result[key]
    ) {
      result[key] = issue.message;
    }
  }
  return result;
}

/** Valida o formato da chave de idempotência (UUID ou token url-safe de 16–64 caracteres). */
export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

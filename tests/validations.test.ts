import { describe, expect, it } from "vitest";
import { buildRsvpSchema, isIdempotencyKey, toFieldErrors } from "@/lib/validations";

const limits = { maxAdults: 10, maxChildren: 10, allowChildHolder: false };
const schema = buildRsvpSchema(limits);

const base = { nome: "Maria da Silva", presenca: "SIM", adultos: 2, criancas: 1 } as const;

function errorsOf(input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? null : toFieldErrors(result.error);
}

describe("nome", () => {
  it("aceita acentos e nomes compostos", () => {
    for (const nome of ["João da Silva", "Ana Beatriz D’Ávila", "José-Maria Ñandú", "Maria de Fátima O'Neil Jr."]) {
      expect(schema.safeParse({ ...base, nome }).success, nome).toBe(true);
    }
  });

  it("remove espaços desnecessários", () => {
    const result = schema.parse({ ...base, nome: "   João    da   Silva  " });
    expect(result.nome).toBe("João da Silva");
  });

  it("exige preenchimento, nome e sobrenome", () => {
    expect(errorsOf({ ...base, nome: "" })?.nome).toBeTruthy();
    expect(errorsOf({ ...base, nome: "     " })?.nome).toBeTruthy();
    expect(errorsOf({ ...base, nome: "Maria" })?.nome).toMatch(/sobrenome/i);
    expect(errorsOf({ ...base, nome: undefined })?.nome).toBeTruthy();
    expect(errorsOf({ ...base, nome: 123 })?.nome).toBeTruthy();
  });

  it("impõe limite de tamanho", () => {
    expect(errorsOf({ ...base, nome: `Maria ${"a".repeat(100)}` })?.nome).toMatch(/máximo/i);
  });

  it("rejeita caracteres fora do padrão, incluindo prefixos de fórmula de planilha", () => {
    for (const nome of ["=HYPERLINK(\"http://x\") Silva", "+55 Silva Souza", "-1 Silva", "@SUM(A1) Souza", "Maria <b>Silva</b>", "Maria 2 Silva"]) {
      expect(errorsOf({ ...base, nome })?.nome, nome).toBeTruthy();
    }
  });
});

describe("presença e quantidades", () => {
  it("confirmação positiva: calcula o total sem duplicar o titular", () => {
    const result = schema.parse({ ...base, adultos: 2, criancas: 3 });
    expect(result).toMatchObject({ presenca: "SIM", adultos: 2, criancas: 3, totalPessoas: 5 });
  });

  it("titular sozinho: 1 adulto, 0 crianças → total 1", () => {
    expect(schema.parse({ ...base, adultos: 1, criancas: 0 }).totalPessoas).toBe(1);
  });

  it('confirmação negativa: grava 0 adultos e 0 crianças, mesmo se o cliente enviar outros valores', () => {
    const result = schema.parse({ ...base, presenca: "NAO", adultos: 4, criancas: 2 });
    expect(result).toMatchObject({ presenca: "NAO", adultos: 0, criancas: 0, totalPessoas: 0 });
  });

  it('"Não vou" não exige quantidades', () => {
    const result = schema.parse({ nome: "Maria da Silva", presenca: "NAO" });
    expect(result).toMatchObject({ adultos: 0, criancas: 0, totalPessoas: 0 });
  });

  it("exige informar a presença", () => {
    expect(errorsOf({ nome: "Maria da Silva" })?.presenca).toBeTruthy();
    expect(errorsOf({ ...base, presenca: "TALVEZ" })?.presenca).toBeTruthy();
    expect(errorsOf({ ...base, presenca: "sim" })?.presenca).toBeTruthy();
  });

  it("rejeita quantidades negativas, decimais, texto e acima do limite", () => {
    expect(errorsOf({ ...base, adultos: -1 })?.adultos).toBeTruthy();
    expect(errorsOf({ ...base, adultos: 1.5 })?.adultos).toBeTruthy();
    expect(errorsOf({ ...base, adultos: "2" })?.adultos).toBeTruthy();
    expect(errorsOf({ ...base, adultos: 11 })?.adultos).toBeTruthy();
    expect(errorsOf({ ...base, criancas: -1 })?.criancas).toBeTruthy();
    expect(errorsOf({ ...base, criancas: 0.1 })?.criancas).toBeTruthy();
    expect(errorsOf({ ...base, criancas: 11 })?.criancas).toBeTruthy();
    expect(errorsOf({ ...base, adultos: Number.NaN })?.adultos).toBeTruthy();
    expect(errorsOf({ ...base, adultos: Infinity })?.adultos).toBeTruthy();
  });

  it("respeita limites configuráveis", () => {
    const small = buildRsvpSchema({ maxAdults: 2, maxChildren: 1, allowChildHolder: false });
    expect(small.safeParse({ ...base, adultos: 2, criancas: 1 }).success).toBe(true);
    expect(small.safeParse({ ...base, adultos: 3, criancas: 0 }).success).toBe(false);
    expect(small.safeParse({ ...base, adultos: 1, criancas: 2 }).success).toBe(false);
  });

  it("exige ao menos 1 adulto (o titular) quando vai", () => {
    expect(errorsOf({ ...base, adultos: 0, criancas: 2 })?.adultos).toBeTruthy();
    expect(errorsOf({ ...base, adultos: 0, criancas: 0 })?.adultos).toBeTruthy();
  });

  it("titular criança (configurável): permite 0 adultos com 1+ criança, sem exigir adulto fictício", () => {
    const childHolder = buildRsvpSchema({ ...limits, allowChildHolder: true });
    expect(childHolder.parse({ ...base, adultos: 0, criancas: 1 })).toMatchObject({ adultos: 0, criancas: 1, totalPessoas: 1 });
    expect(childHolder.safeParse({ ...base, adultos: 0, criancas: 0 }).success).toBe(false);
  });
});

describe("payload inválido", () => {
  it("rejeita campos desconhecidos e tipos errados", () => {
    expect(schema.safeParse({ ...base, admin: true }).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse("texto").success).toBe(false);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("expõe o honeypot", () => {
    expect(schema.parse({ ...base, website: "http://spam" }).honeypot).toBe("http://spam");
    expect(schema.parse(base).honeypot).toBe("");
  });
});

describe("isIdempotencyKey", () => {
  it("aceita UUID e tokens url-safe de 16–64 caracteres", () => {
    expect(isIdempotencyKey("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isIdempotencyKey("a".repeat(16))).toBe(true);
  });
  it("rejeita curtas, longas, com símbolos ou não-string", () => {
    for (const bad of ["abc", "a".repeat(65), "chave com espaço!!!!", "a'b;drop table--", 42, null, undefined]) {
      expect(isIdempotencyKey(bad), String(bad)).toBe(false);
    }
  });
});

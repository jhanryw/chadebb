import { describe, expect, it } from "vitest";
import { cleanName, computeTotalPeople, normalizeName } from "@/lib/normalization";

describe("cleanName", () => {
  it("remove espaços nas pontas e duplicados, preservando acentos e maiúsculas", () => {
    expect(cleanName("  João   da \t Silva  ")).toBe("João da Silva");
  });

  it("remove caracteres invisíveis e converte NBSP em espaço", () => {
    expect(cleanName("Maria\u200B\u00A0Clara\u200D Souza")).toBe("Maria Clara Souza");
  });

  it("compõe caracteres Unicode (NFC)", () => {
    const decomposed = "João Silva"; // o + til combinante
    expect(cleanName(decomposed)).toBe("João Silva");
  });
});

describe("normalizeName", () => {
  it('considera "João da Silva" e "joao da silva" equivalentes', () => {
    expect(normalizeName("João da Silva")).toBe(normalizeName("joao da silva"));
    expect(normalizeName("João da Silva")).toBe("joao da silva");
  });

  it("ignora caixa, acentos, espaços duplicados e formas Unicode distintas", () => {
    const variants = ["JOÃO  DA SILVA", "João da Silva", " joão da  silva ", "João\u00A0da\u200B Silva"];
    for (const variant of variants) expect(normalizeName(variant)).toBe("joao da silva");
  });

  it("unifica variações de apóstrofo", () => {
    expect(normalizeName("Ana D’Ávila")).toBe(normalizeName("Ana D'Avila"));
  });

  it("NÃO faz comparação aproximada: nomes parecidos continuam diferentes", () => {
    expect(normalizeName("João da Silva")).not.toBe(normalizeName("João da Silva Júnior"));
    expect(normalizeName("Maria Souza")).not.toBe(normalizeName("Mariana Souza"));
    expect(normalizeName("Ana-Maria Lima")).not.toBe(normalizeName("Ana Maria Lima"));
  });

  it("é idempotente", () => {
    const once = normalizeName("  ÁLVARO   Müller ");
    expect(normalizeName(once)).toBe(once);
  });
});

describe("computeTotalPeople", () => {
  it("soma adultos + crianças (titular já incluído, sem duplicar)", () => {
    expect(computeTotalPeople("SIM", 1, 0)).toBe(1);
    expect(computeTotalPeople("SIM", 2, 3)).toBe(5);
  });

  it("é zero para quem não vai", () => {
    expect(computeTotalPeople("NAO", 3, 2)).toBe(0);
  });
});

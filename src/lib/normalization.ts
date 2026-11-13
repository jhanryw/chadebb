/**
 * Normalização de nomes.
 *
 * ATENÇÃO: o workflow n8n (`n8n/code/validate-normalize.js`) implementa a MESMA
 * lógica. Qualquer alteração aqui deve ser replicada lá — há um teste de
 * paridade em `tests/n8n-workflow.test.ts`.
 */

// Caracteres invisíveis / de controle / espaços "exóticos".
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/gu;
const ANY_SPACE = /[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/gu;
const APOSTROPHES = /[\u2018\u2019\u02BC`\u00B4]/gu;

/**
 * Limpeza para EXIBIÇÃO/GRAVAÇÃO: NFC, sem caracteres invisíveis, espaços
 * colapsados e aparados. Mantém acentos e maiúsculas originais.
 */
export function cleanName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(ANY_SPACE, " ")
    .trim();
}

/**
 * Forma canônica para detectar duplicidade: sem acentos, minúsculas, espaços
 * colapsados, apóstrofos unificados. NÃO faz comparação aproximada: nomes
 * parecidos mas diferentes continuam distintos.
 *
 *   "João  da Silva" → "joao da silva"
 *   "JOAO DA SILVA"  → "joao da silva"
 */
export function normalizeName(raw: string): string {
  return cleanName(raw)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .replace(ANY_SPACE, " ")
    .trim();
}

/** Total de pessoas = adultos + crianças (o titular já está incluído em um deles). */
export function computeTotalPeople(
  presenca: "SIM" | "NAO",
  adultos: number,
  criancas: number,
): number {
  return presenca === "SIM" ? adultos + criancas : 0;
}

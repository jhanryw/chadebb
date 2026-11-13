// ChatBB — funções compartilhadas pelos nós Code (inseridas no início de cada nó pelo build).
// Mantenha a lógica idêntica a src/lib/normalization.ts (há teste de paridade).

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/gu;
const ANY_SPACE = /[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/gu;
const APOSTROPHES = /[\u2018\u2019\u02BC`\u00B4]/gu;

// Limpeza para gravação/exibição: NFC, sem caracteres invisíveis, espaços colapsados.
function cleanName(raw) {
  return String(raw)
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(ANY_SPACE, ' ')
    .trim();
}

// Forma canônica para detectar duplicidade (sem acentos, minúsculas). Sem comparação aproximada.
function normalizeName(raw) {
  return cleanName(raw)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .replace(ANY_SPACE, ' ')
    .trim();
}

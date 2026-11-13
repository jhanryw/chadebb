// ChatBB — Nó "Validar e normalizar" (Code · Run Once for All Items)
//
// Revalida TUDO no n8n: não confiamos apenas na validação do Next.js.
// Saída: { valid: true, data: {...} } ou { valid: false, status: 422, response: {...} }

// ====== CONFIGURAÇÃO — mantenha igual ao .env do site ======================
const CONFIG = {
  MAX_ADULTS: 10,               // = RSVP_MAX_ADULTS
  MAX_CHILDREN: 10,             // = RSVP_MAX_CHILDREN
  ALLOW_CHILD_HOLDER: false,    // = RSVP_ALLOW_CHILD_HOLDER
  EVENT_DATE: '2026-11-22T08:00:00-03:00', // = EVENT_DATE
  RSVP_DEADLINE: '',            // = RSVP_DEADLINE (vazio = fecha no início do evento)
  TIMEZONE: 'America/Fortaleza',// = EVENT_TIMEZONE
};
// ===========================================================================

const NAME_MIN = 5;
const NAME_MAX = 100;
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .\-\u2019]*$/u;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function invalid(code, fields) {
  return [{ json: { valid: false, status: 422, response: { ok: false, code, fields: fields || [] } } }];
}

function isCount(value, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function localDateTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function newId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return 'rsvp_' + globalThis.crypto.randomUUID();
    }
  } catch (e) { /* usa o fallback */ }
  return 'rsvp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

const input = $input.first().json || {};
const body = input.body;

if (!body || typeof body !== 'object' || Array.isArray(body)) {
  return invalid('INVALID_DATA', ['body']);
}

// 1. Prazo (mesma regra do site: RSVP_DEADLINE, ou o início do evento)
const closesAt = Date.parse(CONFIG.RSVP_DEADLINE || CONFIG.EVENT_DATE);
if (!Number.isNaN(closesAt) && Date.now() >= closesAt) {
  return [{ json: { valid: false, status: 422, response: { ok: false, code: 'RSVP_CLOSED', fields: [] } } }];
}

// 2. Campos
const errors = [];

const chave = body.idempotencyKey;
if (typeof chave !== 'string' || !KEY_PATTERN.test(chave)) errors.push('idempotencyKey');

let nome = '';
if (typeof body.nome !== 'string') {
  errors.push('nome');
} else {
  nome = cleanName(body.nome);
  const words = nome.split(' ').filter(Boolean).length;
  if (nome.length < NAME_MIN || nome.length > NAME_MAX || !NAME_PATTERN.test(nome) || words < 2) {
    errors.push('nome');
  }
}

const presenca = body.presenca;
if (presenca !== 'SIM' && presenca !== 'NAO') errors.push('presenca');

const rawAdults = body.adultos === undefined || body.adultos === null ? 0 : body.adultos;
const rawChildren = body.criancas === undefined || body.criancas === null ? 0 : body.criancas;
if (!isCount(rawAdults, CONFIG.MAX_ADULTS)) errors.push('adultos');
if (!isCount(rawChildren, CONFIG.MAX_CHILDREN)) errors.push('criancas');

if (errors.length === 0 && presenca === 'SIM') {
  const minAdults = CONFIG.ALLOW_CHILD_HOLDER ? 0 : 1;
  if (rawAdults < minAdults) errors.push('adultos');
  if (rawAdults + rawChildren < 1) errors.push('criancas');
}

if (errors.length > 0) return invalid('INVALID_DATA', errors);

// 3. Normalização e montagem da linha
const adultos = presenca === 'SIM' ? rawAdults : 0;
const criancas = presenca === 'SIM' ? rawChildren : 0;
const nomeNormalizado = normalizeName(nome);

return [{
  json: {
    valid: true,
    data: {
      chaveIdempotencia: chave,
      nomeNormalizado,
      presenca,
      row: {
        id: newId(),
        data_hora: localDateTime(new Date(), CONFIG.TIMEZONE),
        nome,
        nome_normalizado: nomeNormalizado,
        presenca,
        adultos,
        criancas,
        total_pessoas: adultos + criancas, // titular já incluído em adultos/crianças
        chave_idempotencia: chave,
        origem: 'site',
      },
    },
  },
}];

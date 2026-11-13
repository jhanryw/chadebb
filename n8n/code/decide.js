// ChatBB — Nó "Decidir" (Code · Run Once for All Items)
//
// Recebe TODAS as linhas da aba Confirmacoes e decide:
//   • mesma chave de idempotência + mesmo nome  → 200 ALREADY_RECORDED (não grava de novo)
//   • mesma chave com outro nome                → 409 IDEMPOTENCY_CONFLICT
//   • nome (normalizado) já existente           → 409 DUPLICATE_NAME (sem revelar a resposta anterior)
//   • caso contrário                            → action "write"
// Esta decisão só é segura se as execuções forem SERIALIZADAS (ver README: concorrência).

const data = $('Validar e normalizar').first().json.data;

const text = (row, key) => String(row[key] === undefined || row[key] === null ? '' : row[key]).trim();
const rows = $input.all()
  .map((item) => item.json || {})
  .filter((row) => ['id', 'nome', 'nome_normalizado', 'chave_idempotencia'].some((key) => text(row, key) !== ''));

const rowName = (row) => text(row, 'nome_normalizado') || normalizeName(text(row, 'nome'));
const sameName = (row) => rowName(row) === data.nomeNormalizado || normalizeName(text(row, 'nome')) === data.nomeNormalizado;

const byKey = rows.find((row) => text(row, 'chave_idempotencia') === data.chaveIdempotencia);
if (byKey) {
  if (sameName(byKey)) {
    const stored = text(byKey, 'presenca').toUpperCase() === 'SIM' ? 'SIM' : 'NAO';
    return [{ json: { action: 'respond', status: 200, response: { ok: true, code: 'ALREADY_RECORDED', presenca: stored } } }];
  }
  return [{ json: { action: 'respond', status: 409, response: { ok: false, code: 'IDEMPOTENCY_CONFLICT' } } }];
}

if (rows.some(sameName)) {
  return [{ json: { action: 'respond', status: 409, response: { ok: false, code: 'DUPLICATE_NAME' } } }];
}

return [{ json: { action: 'write', row: data.row, presenca: data.presenca } }];

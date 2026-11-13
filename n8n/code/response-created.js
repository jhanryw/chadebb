// ChatBB — Nó "Resposta 201" (Code · Run Once for All Items)
// Só é alcançado DEPOIS que o nó Google Sheets concluiu a gravação com sucesso.
const decision = $('Decidir').first().json;
return [{ json: { status: 201, response: { ok: true, code: 'CREATED', presenca: decision.presenca } } }];

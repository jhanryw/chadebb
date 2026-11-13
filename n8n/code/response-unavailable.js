// ChatBB — Nó "Resposta 503" (Code · Run Once for All Items)
// Alcançado quando a leitura ou a gravação no Google Sheets falhou. Nunca devolve detalhes do erro.
return [{ json: { status: 503, response: { ok: false, code: 'SERVICE_UNAVAILABLE' } } }];

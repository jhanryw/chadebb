# Workflow n8n — ChatBB

Arquivo: [`chatbb-workflow.json`](./chatbb-workflow.json) (gerado a partir de [`code/`](./code); veja "Manutenção" no fim).

## O que o workflow faz

```
Webhook (POST, Header Auth)
  → Validar e normalizar     (Code: revalida tudo; normaliza; monta a linha; prazo)
  → Dados válidos?           (IF)   não → 422
  → Ler confirmações         (Google Sheets: lê a aba Confirmacoes)   falha → 503
  → Decidir                  (Code: idempotência + duplicidade)
  → Gravar?                  (IF)   não → 200 (replay) ou 409
  → Gravar confirmação       (Google Sheets: append, cellFormat RAW)  falha → 503
  → Resposta 201             (só é alcançada DEPOIS da gravação)
  → Responder ao site        (Respond to Webhook: usa status/JSON do item)
```

O webhook usa `Respond: Using 'Respond to Webhook' Node`, ou seja, **execução síncrona**: o site só recebe `201` depois que o nó Google Sheets terminou com sucesso.

## Contrato (idêntico ao implementado em `src/lib/n8n.ts`)

Requisição do site → n8n (`POST /webhook/chatbb-rsvp`, cabeçalho `X-ChatBB-Secret: <segredo>`):

```json
{
  "idempotencyKey": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "nome": "João da Silva",
  "presenca": "SIM",
  "adultos": 2,
  "criancas": 1,
  "origem": "site",
  "enviadoEm": "2026-11-13T13:50:07.000Z"
}
```

| HTTP | Corpo | Significado |
|---|---|---|
| **201** | `{"ok":true,"code":"CREATED","presenca":"SIM"}` | Gravado no Sheets |
| **200** | `{"ok":true,"code":"ALREADY_RECORDED","presenca":"SIM"}` | Mesma `idempotencyKey` + mesmo nome já gravados: **nada é gravado de novo** |
| **409** | `{"ok":false,"code":"DUPLICATE_NAME"}` | Nome (normalizado) já usado em outra confirmação |
| **409** | `{"ok":false,"code":"IDEMPOTENCY_CONFLICT"}` | Mesma chave reutilizada com outro nome |
| **422** | `{"ok":false,"code":"INVALID_DATA","fields":["nome"]}` | Payload inválido (revalidado no n8n) |
| **422** | `{"ok":false,"code":"RSVP_CLOSED","fields":[]}` | Prazo encerrado |
| **503** | `{"ok":false,"code":"SERVICE_UNAVAILABLE"}` | Falha ao ler/gravar no Sheets |
| 403 (texto) | `Authorization data is wrong!` | Segredo ausente/incorreto (resposta nativa do n8n; o site trata como 503 e **não** mostra detalhes ao convidado) |

`429` é emitido pelo **site** (rate limiting). O n8n não faz rate limiting; se algum proxy à frente dele devolver 429, o site repassa 429.

O site traduz para o navegador: `201`, `200`, `409`→409, `422`→422 (`RSVP_CLOSED`→403), `429`→429, qualquer outra coisa/timeouts/corpo inválido→**503**.

## Passo a passo de configuração

### 1. Importar
1. No n8n: **Workflows → ⋯ (ou Add workflow) → Import from file** → selecione `n8n/chatbb-workflow.json`.
2. O workflow entra **inativo**. Os nós de credencial aparecerão com um aviso — é esperado.

### 2. Credencial do webhook (segredo)
1. **Credentials → Create → Header Auth**.
2. *Name* = `X-ChatBB-Secret` · *Value* = o mesmo valor de `N8N_WEBHOOK_SECRET` do site (gere com `openssl rand -hex 32`).
3. Nome sugerido da credencial: `ChatBB Webhook Secret`.
4. Abra o nó **Webhook ChatBB** → *Credential for Header Auth* → selecione-a.

> O segredo vive só no cofre de credenciais do n8n e nas variáveis do EasyPanel — nunca no código nem no JSON.

### 3. Google Sheets
1. Prepare a planilha conforme [`docs/google-sheets.md`](../docs/google-sheets.md).
2. Crie a credencial **Google Sheets OAuth2 API** (ou Service Account) e dê acesso de **editor** à planilha.
3. Nos nós **Ler confirmações** e **Gravar confirmação**: escolha a credencial, o documento (planilha) e a aba **Confirmacoes**.
4. No nó **Gravar confirmação**, confira em *Columns* que as 10 colunas estão mapeadas (`id`, `data_hora`, …, `origem`) — o n8n recarrega as colunas da aba ao selecionar a planilha. *Options → Cell Format = Let n8n format* (valor `RAW`) já vem configurado: impede que o Sheets interprete textos como fórmulas.

### 4. Revisar a constante `CONFIG`
No nó **Validar e normalizar**, o bloco `CONFIG` deve refletir o `.env` do site (o n8n não lê variáveis de ambiente do site nem do próprio n8n — `$env` fica bloqueado por padrão nas versões atuais):

| `CONFIG` | Variável do site |
|---|---|
| `MAX_ADULTS` / `MAX_CHILDREN` | `RSVP_MAX_ADULTS` / `RSVP_MAX_CHILDREN` |
| `ALLOW_CHILD_HOLDER` | `RSVP_ALLOW_CHILD_HOLDER` |
| `EVENT_DATE` | `EVENT_DATE` |
| `RSVP_DEADLINE` | `RSVP_DEADLINE` (preencha com a mesma data, ou deixe vazio se o site também não tiver prazo) |
| `TIMEZONE` | `EVENT_TIMEZONE` |

Se você alterar o código, edite **`n8n/code/*.js`** no repositório e rode `npm run workflow:build` (veja "Manutenção"); alterações feitas só na tela do n8n não voltam para o repositório.

### 5. Concorrência (OBRIGATÓRIO para garantir unicidade)

**O problema.** O Google Sheets não tem restrição UNIQUE nem transações. O workflow faz "ler tudo → decidir → gravar". Se duas execuções rodarem ao mesmo tempo, ambas leem a planilha antes de qualquer uma gravar, ambas concluem que o nome é novo e **ambas gravam** (o teste `DEMONSTRAÇÃO` em `tests/n8n-workflow.test.ts` reproduz exatamente isso). Sem serialização, a unicidade **não é garantida**.

**O que não dá para importar no JSON.** O n8n não tem, nas configurações do workflow, um mutex/limite de concorrência por workflow. O controle é por **instância**, via variável de ambiente.

**Solução mínima e confiável — serialize as execuções de produção do n8n:**

- **n8n em modo regular (padrão, e o do template do EasyPanel):** defina na aplicação n8n do EasyPanel (aba *Environment*) `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` e **reinicie** o n8n. Segundo a documentação do n8n (*Concurrency control*), execuções de produção (disparadas por webhook/trigger) além do limite ficam em **fila FIFO**; com limite 1, uma execução só começa quando a anterior termina — o trecho "ler → decidir → gravar" passa a ser exclusivo.
- **n8n em modo fila (queue mode):** a mesma variável define a concorrência do *worker*; use `1` (ou rode um único worker com `--concurrency=1`).
- **Efeito colateral:** o limite vale para a instância inteira (todos os workflows de produção disparados por webhook/trigger). Se esse n8n atende outros fluxos importantes, **use uma instância n8n dedicada ao ChatBB** (um segundo app "n8n" no EasyPanel, com sua própria credencial Google) — é pouco custo, e é a forma mais simples de não afetar nada mais.
- Volume esperado (centenas de convidados, cada execução < 2 s) torna a fila irrelevante na prática.

**Defesa adicional já incluída no site.** O Next.js envia as confirmações ao n8n **uma de cada vez** (fila em memória por processo; `src/lib/n8n.ts`). Com **uma única réplica** do site e um único n8n, isso já serializa todo o tráfego legítimo (o webhook só é conhecido pelo site). Limites desta defesa: (a) vale por processo — com várias réplicas do site não serializa entre elas; (b) se uma chamada estourar o timeout do site enquanto o n8n ainda a processa, a próxima pode sobrepor-se a ela. Por isso ela **complementa**, não substitui, o `N8N_CONCURRENCY_PRODUCTION_LIMIT=1`.

**Se a sua plataforma não permitir nenhuma das duas** (por exemplo, n8n Cloud sem acesso a variáveis de ambiente): não há garantia forte de unicidade com Google Sheets. A solução mínima confiável é manter o site em **1 réplica** (defesa do site acima) e conferir periodicamente a coluna `nome_normalizado` com a formatação condicional descrita em `docs/google-sheets.md`. Alternativas se isso não bastar: trocar o armazenamento por um que tenha restrição UNIQUE (por exemplo, uma *Data table* do próprio n8n com chave única, ou um banco) — não incluído aqui por exigência do escopo ("sem infraestrutura adicional silenciosa").

**Como comprovar que a serialização está ativa** (após o deploy):

```bash
BASE_URL=https://seu-dominio.com node scripts/smoke-test.mjs --race
```

Dispara 5 envios simultâneos do mesmo nome e exige **exatamente 1** resposta `201` (as outras, `409`). Apague depois as linhas "Teste Automatizado…" da planilha.

### 6. Ativar e testar
1. Salve e **ative** o workflow (toggle *Active*). O n8n mostra duas URLs no nó Webhook: **Test** (`/webhook-test/...`, funciona só durante "Listen for test event") e **Production** (`/webhook/chatbb-rsvp`, só após ativar).
2. Use a **Production URL** em `N8N_WEBHOOK_URL` do site.
3. Teste manual (substitua URL e segredo):

```bash
curl -i -X POST "https://SEU-N8N/webhook/chatbb-rsvp" \
  -H "Content-Type: application/json" \
  -H "X-ChatBB-Secret: SEU_SEGREDO" \
  -d '{"idempotencyKey":"11111111-1111-4111-8111-111111111111","nome":"Teste Webhook Silva","presenca":"SIM","adultos":2,"criancas":0,"origem":"site"}'
# esperado: HTTP 201 {"ok":true,"code":"CREATED","presenca":"SIM"} e uma nova linha na planilha

# repetir o MESMO comando: HTTP 200 ALREADY_RECORDED (sem nova linha)
# mudar a idempotencyKey mantendo o nome: HTTP 409 DUPLICATE_NAME
# trocar o segredo: HTTP 403
```

4. Teste completo pelo site: `BASE_URL=https://seu-dominio.com node scripts/smoke-test.mjs`.

### Privacidade das execuções
O workflow vem com `saveDataSuccessExecution: none` (execuções bem-sucedidas **não** guardam dados no n8n — a planilha é o registro) e `saveDataErrorExecution: all` (para depurar falhas; contém nomes — limpe periodicamente em *Settings → Executions* ou ajuste conforme sua preferência). Para depurar um problema, troque temporariamente o sucesso para `all`.

## Segurança do workflow

- Autenticação por **Header Auth** no próprio Webhook.
- Revalida todo o corpo (tipos, inteiros, limites, nome, chave, prazo) — não confia no Next.js.
- A origem (`origem`) é sempre `site`; campos extras do corpo são ignorados.
- Nomes só podem começar com **letra** e conter letras, espaço, `'`, `-`, `.`; combinado com `cellFormat: RAW`, isso impede injeção de fórmulas (`=`, `+`, `-`, `@`) na planilha.
- Erros do Sheets viram `503` genérico; detalhes nunca voltam ao site.
- Nunca apaga linhas.

## Manutenção

Os nós Code são mantidos em `n8n/code/*.js` e `_shared.js` (inserido no início dos nós que o usam). Para regenerar o JSON depois de editar:

```bash
npm run workflow:build   # regrava n8n/chatbb-workflow.json
npm run workflow:check   # falha se estiver desatualizado (o teste também verifica)
npm test                 # executa o MESMO código dos nós contra uma planilha simulada
```

A normalização de nomes (`n8n/code/_shared.js`) deve permanecer idêntica a `src/lib/normalization.ts` (há teste de paridade).

**Limitação de verificação:** o workflow foi validado por testes que executam o código de cada nó Code e emulam os nós de Sheets/IF/Respond; os parâmetros dos nós nativos foram conferidos contra a definição do pacote `n8n-nodes-base`. A execução num n8n real com Google Sheets real depende das suas credenciais — faça o teste da seção 6 antes de divulgar o link.

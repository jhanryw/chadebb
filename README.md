# ChatBB — “Luiza ou Augusto?”

Site de confirmação de presença (RSVP) para a celebração de fé e gratidão com revelação do sexo do bebê.
**Um único link público** para todos os convidados; as respostas são gravadas em uma **planilha Google Sheets** por meio de um **webhook do n8n**. Sem banco de dados, sem login, sem painel administrativo.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · Zod 4 · Lucide · Docker
- **Evento:** 22/11/2026 (domingo), 8h, Capela do Colégio Nossa Senhora das Neves, Natal/RN (fuso `America/Fortaleza`)

```
Navegador ──POST /api/rsvp──▶ Next.js ──POST (segredo)──▶ n8n ──▶ Google Sheets
    ▲                            │  validação · prazo · rate limit      │
    └────── 201/200/409/… ◀──────┴──────────── 201/200/409/… ◀──────────┘
```

O navegador **nunca** conhece nem chama o webhook do n8n. O segredo só existe no servidor.

---

## Sumário
1. [Rodar localmente](#1-rodar-localmente)
2. [Variáveis de ambiente](#2-variáveis-de-ambiente)
3. [Contrato da API](#3-contrato-da-api)
4. [Regras de negócio e limitações honestas](#4-regras-de-negócio-e-limitações-honestas)
5. [Google Sheets e n8n](#5-google-sheets-e-n8n)
6. [Segurança](#6-segurança)
7. [Docker](#7-docker)
8. [Passo a passo GitHub → EasyPanel](#8-passo-a-passo-github--easypanel)
9. [Testes](#9-testes)
10. [Estrutura do repositório](#10-estrutura-do-repositório)
11. [O que você ainda precisa preencher](#11-o-que-você-ainda-precisa-preencher)

---

## 1. Rodar localmente

Requisitos: Node.js ≥ 22.12 e npm. (No build, as fontes do Google são baixadas e embutidas por `next/font`: é preciso internet.)

```bash
npm install
cp .env.example .env.local      # preencha N8N_WEBHOOK_URL e N8N_WEBHOOK_SECRET
npm run dev                     # http://localhost:3000
```

Sem n8n real, use o **n8n simulado** (executa o mesmo código do workflow contra uma planilha em memória):

```bash
npm run mock:n8n                # http://localhost:5678/webhook/chatbb-rsvp
```

```env
# .env.local
N8N_WEBHOOK_URL=http://localhost:5678/webhook/chatbb-rsvp
N8N_WEBHOOK_SECRET=segredo-local-de-desenvolvimento-123
```

Build de produção local (mesmo servidor “standalone” da imagem Docker):

```bash
npm run build
npm run start:standalone
```

## 2. Variáveis de ambiente

Documentadas em [`.env.example`](./.env.example). **Todas são lidas em tempo de execução no servidor** (a página é renderizada a cada requisição). Por isso:
- o mesmo build/imagem funciona em qualquer ambiente, **sem build args**;
- alterar uma variável no EasyPanel exige apenas **reiniciar/redeploy**, não reconstruir a lógica;
- **nenhum segredo usa `NEXT_PUBLIC_`**. (`NEXT_PUBLIC_SITE_URL` é uma URL pública e também é lida em runtime.)

| Variável | Obrig. | Tipo | Descrição |
|---|---|---|---|
| `N8N_WEBHOOK_URL` | ✔ | privada | URL **de produção** do webhook (`…/webhook/chatbb-rsvp`) |
| `N8N_WEBHOOK_SECRET` | ✔ | **segredo** | ≥ 16 caracteres; igual ao da credencial *Header Auth* do n8n |
| `N8N_WEBHOOK_SECRET_HEADER` | | privada | Padrão `X-ChatBB-Secret` |
| `N8N_TIMEOUT_MS` | | privada | Padrão 15000 |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS` | | privada | Padrão 10 envios por IP a cada 600 s |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | | privada | Padrão 60 |
| `TRUSTED_PROXY_HOPS` | | privada | Padrão 1 (EasyPanel/Traefik) |
| `MAX_QUEUED_SUBMISSIONS` | | privada | Padrão 30 |
| `EVENT_DATE` | | pública | Padrão `2026-11-22T08:00:00-03:00` (**com fuso**) |
| `EVENT_TIMEZONE` | | pública | Padrão `America/Fortaleza` |
| `RSVP_DEADLINE` | ⚠ | pública | Data-limite (ISO com fuso). **Vazio = fecha no início do evento** |
| `EVENT_ADDRESS` | ⚠ | pública | Endereço completo (não inventamos endereço) |
| `EVENT_MAP_URL` | ⚠ | pública | Link do botão “Como chegar” |
| `EVENT_MAP_EMBED_URL` | | pública | URL de incorporação (`https://www.google.com/maps/…`) |
| `NEXT_PUBLIC_SITE_URL` | ⚠ | pública | `https://seu-dominio.com` |
| `RSVP_MAX_ADULTS` / `RSVP_MAX_CHILDREN` | | pública | Padrão 10 / 10 (teto absoluto 50) |
| `RSVP_ALLOW_CHILD_HOLDER` | | pública | `true` permite titular criança (0 adultos + ≥1 criança) |
| `PORT` | | — | Padrão 3000 |

⚠ = recomendado preencher. Valores inválidos (ex.: data sem fuso) fazem o site exibir “Estamos ajustando alguns detalhes” e registrar o **nome** da variável problemática no log (nunca o valor).

**Mapa sem chave paga:** sem `EVENT_MAP_EMBED_URL`, o site incorpora `https://www.google.com/maps?q=<endereço ou nome do local>&output=embed`. Sem `EVENT_MAP_URL`, o botão abre a busca do Google Maps. Nenhuma coordenada é inventada; **confira no site se o pino caiu no lugar certo** e, se necessário, preencha endereço/links. Se o iframe não carregar, aparece um aviso e o botão “Como chegar” continua funcionando.

**Titular criança:** por padrão o titular é adulto (mínimo 1 adulto, o próprio titular, já incluído na contagem). Para permitir que a resposta seja “em nome de uma criança” sem exigir um adulto fictício, use `RSVP_ALLOW_CHILD_HOLDER=true` **e** `ALLOW_CHILD_HOLDER: true` na `CONFIG` do nó *Validar e normalizar* do n8n; o formulário passa a aceitar 0 adultos com ≥ 1 criança.

## 3. Contrato da API

### `POST /api/rsvp` (navegador → site)
Cabeçalhos: `Content-Type: application/json` · `Idempotency-Key: <uuid>` (o formulário gera um por tentativa e o **reutiliza em reenvios** do mesmo conteúdo).

```json
{ "nome": "João da Silva", "presenca": "SIM", "adultos": 2, "criancas": 1, "website": "" }
```
`website` é um *honeypot* (sempre vazio para pessoas). Para `presenca: "NAO"`, adultos e crianças são gravados como `0`.

| HTTP | `code` | Quando |
|---|---|---|
| **201** | `CREATED` | Gravado (confirmado pelo n8n/Sheets) → `{ok:true, code, presenca}` |
| **200** | `ALREADY_RECORDED` | Reenvio idempotente de operação já concluída |
| 400 | `INVALID_JSON` | Corpo ilegível |
| 403 | `RSVP_CLOSED` | Prazo encerrado |
| 403 | `FORBIDDEN_ORIGIN` | `Origin` de outro site |
| **409** | `DUPLICATE_NAME` | Nome já utilizado (mensagem genérica, **sem revelar** a resposta anterior) |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | Corpo > 4 KB / não é JSON |
| **422** | `INVALID_DATA` | Dados inválidos → `fieldErrors` por campo |
| **429** | `RATE_LIMITED` | Excesso de solicitações (cabeçalho `Retry-After`) |
| **503** | `SERVICE_UNAVAILABLE` | n8n/Sheets indisponível, timeout, 401/403/404/5xx do n8n ou resposta inválida |

Erros: `{ "ok": false, "code": "…", "message": "texto em pt-BR sem detalhes internos", "fieldErrors"?: {…} }`.

### n8n ↔ site
Contrato do webhook (201/200/409/422/503) em [`n8n/README.md`](./n8n/README.md#contrato-idêntico-ao-implementado-em-srclibn8nts). A mesma tabela está implementada em `src/lib/n8n.ts` (site) e em `n8n/chatbb-workflow.json` (n8n) e é exercitada pelos testes com o código real do workflow.

### `GET /api/health`
`{"status":"ok","configured":true|false}` — sem segredos nem valores. Usado pelo `HEALTHCHECK` do Docker.

## 4. Regras de negócio e limitações honestas

- **Uma confirmação por titular.** Identidade = nome normalizado (minúsculas, sem acentos, espaços colapsados, Unicode NFKD). `"João da Silva"` ≡ `"joao  DA silva"`. Sem comparação aproximada: nomes parecidos mas diferentes são aceitos.
- **Nome completo:** exigimos nome **e** sobrenome (≥ 2 palavras, 5–100 caracteres; letras, espaço, `'`, `-`, `.`). Isso reduz colisões do tipo “Maria”.
- **Resposta não editável pelo site.** Correções são feitas manualmente na planilha.
- **Prazo** bloqueado no frontend (mensagem) e no backend (API e n8n).
- **O link é público e o nome é livre → não há como impedir confirmações fraudulentas** (alguém pode usar o nome de outra pessoa). O sistema mitiga abuso (rate limit, honeypot, validação), mas **não promete proteção contra fraude**. O texto do formulário diz isso aos convidados de forma gentil.
- **Unicidade e concorrência:** o Google Sheets não tem UNIQUE nem transações. A garantia vem de **serializar** a seção “ler → decidir → gravar” (`N8N_CONCURRENCY_PRODUCTION_LIMIT=1` no n8n) + fila de envios no site. Sem essa configuração **não há garantia** — veja [`n8n/README.md` § Concorrência](./n8n/README.md#5-concorrência-obrigatório-para-garantir-unicidade) (inclui a alternativa mínima se a plataforma não permitir) e use `npm run smoke -- --race` para comprovar.
- **Idempotência:** cada tentativa carrega uma chave; se a resposta se perder (rede), o reenvio com a mesma chave devolve `200 ALREADY_RECORDED` sem gravar de novo. Um novo clique com a mesma chave após um **timeout** nunca duplica; já uma tentativa com **outro** conteúdo e o mesmo nome recebe `409`.
- **Rate limiting em memória:** vale por processo. Com **1 réplica** (recomendado) protege bem; com N réplicas o limite efetivo é N× (cada uma conta separadamente). Ele é antiabuso, **não** garantia de unicidade (essa vem do n8n). Para limite global entre réplicas seria necessário um armazenamento compartilhado (não adicionado por exigência do escopo).
- **Fila de envios em memória:** idem — mantenha **1 réplica** do site no EasyPanel.

## 5. Google Sheets e n8n

- Estrutura da planilha, abas `Confirmacoes` e `Resumo` e fórmulas pt-BR: [`docs/google-sheets.md`](./docs/google-sheets.md)
- Workflow importável, credenciais, concorrência e testes: [`n8n/README.md`](./n8n/README.md) · arquivo [`n8n/chatbb-workflow.json`](./n8n/chatbb-workflow.json)

## 6. Segurança

- HTTPS pelo EasyPanel (Traefik + Let’s Encrypt) + HSTS.
- Segredos só em variáveis de ambiente; webhook autenticado por *Header Auth*; o navegador nunca vê o webhook.
- Validação com Zod no site **e** revalidação no n8n; quantidades negativas/decimais/acima do limite rejeitadas; corpo limitado a 4 KB; JSON obrigatório; campos desconhecidos recusados.
- **Injeção de fórmulas:** nomes precisam começar com letra e usar apenas caracteres seguros; gravação com `cellFormat: RAW`.
- Rate limiting por IP (com IP derivado do proxy confiável, não de cabeçalho forjável) e global; verificação de `Origin`; honeypot.
- Cabeçalhos: CSP com nonce por requisição (`src/proxy.ts`), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS. `frame-src` permite apenas `https://www.google.com` (mapa).
- Sem analytics/trackers. O mapa do Google só é carregado quando a seção entra na tela (`loading="lazy"`), sem referrer.
- Logs em JSON **sem nome, IP, segredo ou URL do webhook** (somente `requestId`, status, tempos e motivo técnico).
- Mensagens de erro genéricas ao convidado; página `noindex` e `robots.txt` bloqueando buscadores.
- Execução em Docker como usuário não root.

## 7. Docker

```bash
docker build -t chatbb .
docker run --rm -p 3000:3000 \
  -e N8N_WEBHOOK_URL="https://SEU-N8N/webhook/chatbb-rsvp" \
  -e N8N_WEBHOOK_SECRET="seu-segredo" \
  -e NEXT_PUBLIC_SITE_URL="http://localhost:3000" \
  chatbb
curl http://localhost:3000/api/health
```

Dockerfile multi-stage (`deps` → `build` → `runner`), imagem `node:22-alpine`, `output: "standalone"`, usuário `nextjs` (uid 1001), `HEALTHCHECK` em `/api/health`, porta via `PORT` (padrão 3000). Não há `ARG`s de build.

## 8. Passo a passo GitHub → EasyPanel

> Os nomes de menus do EasyPanel podem variar um pouco entre versões.

1. **Criar o repositório no GitHub** (de preferência **privado**): em github.com → *New repository* → nome `chatbb` → sem README/.gitignore (já existem aqui).
2. **Enviar o código** (na pasta do projeto):
   ```bash
   git init -b main
   git add .
   git commit -m "ChatBB: site de confirmação de presença"
   git remote add origin git@github.com:SEU-USUARIO/chatbb.git
   git push -u origin main
   ```
   Confira antes: `git status` não deve listar `.env*` (o `.gitignore` já os exclui; só `.env.example` é versionado).
3. **Preparar planilha e n8n** conforme a seção 5 (e `N8N_CONCURRENCY_PRODUCTION_LIMIT=1`). Anote a **Production URL** do webhook e o segredo.
4. **No EasyPanel:** *Projects* → seu projeto → **+ Service → App**, nome `chatbb`.
5. **Vincular o repositório:** aba *Source* → **GitHub** → conecte a conta/instalação do GitHub App do EasyPanel (ou use URL Git + *deploy key* para repositório privado) → repositório `SEU-USUARIO/chatbb` → branch **`main`** → *Build Path* `/`.
6. **Selecionar o build com Dockerfile:** aba *Build* → **Dockerfile** → arquivo `Dockerfile` (não use Nixpacks/Buildpacks).
7. **Porta e domínio:** aba *Domains & Proxy* → adicione o domínio (ex.: `convite.seudominio.com.br`) → **Port = 3000** (ou o valor de `PORT`). Aponte o DNS do domínio (registro A/CNAME) para o servidor do EasyPanel.
8. **Variáveis de ambiente:** aba *Environment* → cole (ajustando) o conteúdo de `.env.example`: no mínimo `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `NEXT_PUBLIC_SITE_URL=https://convite.seudominio.com.br`, `RSVP_DEADLINE`, `EVENT_ADDRESS`, `EVENT_MAP_URL`. **Não marque nada como build arg** — não é necessário.
9. **HTTPS:** no domínio, deixe **HTTPS ativado** (certificado Let’s Encrypt automático; o DNS precisa estar apontando).
10. **Réplicas:** mantenha **1** (*Advanced/Resources → Replicas = 1*), por causa do rate limiting e da fila em memória.
11. **Publicar:** botão **Deploy**. Acompanhe os *logs* de build; ao terminar, o healthcheck deve ficar verde e `https://SEU-DOMINIO/api/health` retornar `{"status":"ok","configured":true}`.
12. **Teste de confirmação:**
    - pelo navegador, no celular: preencha uma resposta de teste e veja a mensagem de sucesso **e a linha na planilha**;
    - ou `BASE_URL=https://SEU-DOMINIO node scripts/smoke-test.mjs` e depois `… --race` (apague as linhas “Teste Automatizado …” da planilha).
13. **Deploy automático a partir da `main`:** na aba *Source* do app, habilite **Auto Deploy** (com o GitHub App do EasyPanel isso cria o gatilho sozinho). Alternativa: copie a **Deploy Webhook URL** do app e cadastre em GitHub → repositório → *Settings → Webhooks* → *Push events*. A cada `git push` na `main`, o EasyPanel reconstrói e publica.

Reinicializações e novos deploys não perdem nada: os dados ficam no Google Sheets, não no container.

## 9. Testes

```bash
npm test                # 146 testes (Vitest)
npm run typecheck       # tsc --noEmit (strict)
npm run build           # build de produção
npm run workflow:check  # JSON do n8n em dia com n8n/code/*.js
```

Cobrem: validação do formulário e do payload, normalização de nomes (incl. `"João da Silva"` ≡ `"joao da silva"`), total de pessoas (titular incluído), confirmação positiva e negativa, bloqueio após o prazo (incl. fuso), duplicidades (inclusive requisições **simultâneas**), reenvios idempotentes, respostas de erro do n8n (4xx/5xx/corpo inválido/sem sucesso falso), **timeouts**, payloads inválidos, rate limiting, spoofing de IP, tamanho de corpo, logs sem dados pessoais, hidratação da contagem regressiva e independência de fuso, comportamento do formulário (botão desabilitado, sucesso só após o backend, reuso da chave) e **o código real dos nós Code do workflow** contra uma planilha simulada.

**Teste ponta a ponta com webhook real** (após configurar n8n + planilha + `.env.local`):

```bash
npm run dev                                   # em um terminal
BASE_URL=http://localhost:3000 npm run smoke           # fluxo completo: 201, 200, 409, 422
BASE_URL=http://localhost:3000 npm run smoke -- --race # comprova a serialização (exatamente 1 gravação)
```
(Cada execução consome parte do limite de 10 envios/10 min por IP; aguarde ou aumente `RATE_LIMIT_MAX` temporariamente.)

## 10. Estrutura do repositório

```
src/
  app/
    page.tsx · layout.tsx · globals.css · icon.svg · robots.ts
    api/rsvp/route.ts           POST /api/rsvp
    api/health/route.ts         GET /api/health
  components/
    invitation/ (Hero, InvitationMessage, EventDetails)
    countdown/  location/  rsvp/ (RsvpSection, RsvpForm)  ui/
  lib/
    event-config.ts  server-config.ts   configuração tipada (evento / privada)
    validations.ts   normalization.ts   Zod e normalização de nomes
    n8n.ts  errors.ts  security.ts  logger.ts  rsvp-client.ts
  proxy.ts                      CSP com nonce (middleware do Next 16)
n8n/  chatbb-workflow.json · code/*.js · README.md
docs/ google-sheets.md
scripts/ build-workflow.mjs · mock-n8n.mjs · smoke-test.mjs · start-standalone.mjs
tests/  (Vitest)
Dockerfile · .dockerignore · .env.example · next.config.ts
```

## 11. O que você ainda precisa preencher

- [ ] **`RSVP_DEADLINE`** — data-limite de confirmação (e a mesma em `CONFIG.RSVP_DEADLINE` no n8n).
- [ ] **`EVENT_ADDRESS`** — endereço completo da capela.
- [ ] **`EVENT_MAP_URL`** — link “Como chegar” (e, se o pino do mapa não ficar certo, `EVENT_MAP_EMBED_URL`).
- [ ] **`NEXT_PUBLIC_SITE_URL`** — domínio final com HTTPS.
- [ ] **`N8N_WEBHOOK_URL`** e **`N8N_WEBHOOK_SECRET`** (gere o segredo com `openssl rand -hex 32`).
- [ ] **Google Sheets:** criar a planilha (abas `Confirmacoes` e `Resumo`) e o ID dela no n8n.
- [ ] **n8n:** importar o workflow, criar as credenciais (Header Auth e Google Sheets), conferir a `CONFIG`, **definir `N8N_CONCURRENCY_PRODUCTION_LIMIT=1`**, ativar.
- [ ] **Limites** `RSVP_MAX_ADULTS` / `RSVP_MAX_CHILDREN` (e `CONFIG` no n8n) se 10 não servir.
- [ ] Repositório GitHub, serviço no EasyPanel, domínio/DNS.
- [ ] **Identidade visual:** o convite de referência não estava na pasta do projeto; a paleta (marfim/bege/cinza quente), as listras e as fontes (*Pinyon Script*, *Cormorant Garamond*, *Jost*) seguem a descrição. Se quiser fidelidade exata, envie o convite e ajuste `src/app/globals.css` e `src/app/layout.tsx`. Coloque eventuais imagens em `public/images/`.

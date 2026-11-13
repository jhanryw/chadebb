# Planilha Google Sheets — estrutura e fórmulas

A planilha é o **único armazenamento** do ChatBB. Ela não deve ser pública: o acesso é feito pela credencial Google do n8n e pelas pessoas que você convidar.

## 1. Criar e proteger

1. Em <https://sheets.google.com> crie uma planilha chamada **ChatBB – Confirmações**.
2. **Configurações da planilha** (Arquivo → Configurações): *Localidade* = **Brasil**, *Fuso horário* = **(GMT-03:00) Fortaleza**. Isso faz as fórmulas abaixo usarem `;` como separador.
3. **Compartilhar**: deixe como **Restrito** (somente pessoas adicionadas). Nunca use "Qualquer pessoa com o link". Não use "Publicar na Web".
4. Anote o **ID da planilha** (trecho entre `/d/` e `/edit` na URL) — será usado no n8n.

## 2. Aba `Confirmacoes`

Renomeie a primeira aba para exatamente **`Confirmacoes`** (sem acento) e preencha a **linha 1** com os cabeçalhos, nesta ordem (A→J), em minúsculas:

| Coluna | Cabeçalho | Conteúdo |
|---|---|---|
| A | `id` | ID único gerado pelo n8n (`rsvp_<uuid>`) |
| B | `data_hora` | `AAAA-MM-DD HH:mm:ss` no fuso America/Fortaleza |
| C | `nome` | Nome como a pessoa digitou (limpo) |
| D | `nome_normalizado` | Minúsculas, sem acentos, espaços colapsados — base da checagem de duplicidade |
| E | `presenca` | `SIM` ou `NAO` |
| F | `adultos` | Inteiro (titular incluído quando for adulto); `0` se `NAO` |
| G | `criancas` | Inteiro; `0` se `NAO` |
| H | `total_pessoas` | `adultos + criancas` (o titular **não** é somado duas vezes); `0` se `NAO` |
| I | `chave_idempotencia` | Chave da tentativa (garante que reenvios não dupliquem) |
| J | `origem` | Sempre `site` |

Recomendações (opcionais, não afetam o funcionamento):

- **Dados → Proteger páginas e intervalos**: proteja a linha 1 para ninguém renomear cabeçalhos por acidente (o n8n localiza as colunas pelo nome).
- **Formatar colunas B, C, D, I como "Texto simples"** (Formatar → Número → Texto simples). O n8n grava com `RAW`, mas isso evita que edições manuais convertam valores.
- Congelar a linha 1 (Visualizar → Congelar → 1 linha).
- **Detectar duplicidades manualmente** (formatação condicional em D2:D): *Formatar → Formatação condicional → Fórmula personalizada*  
  `=CONT.SE($D$2:$D; $D2) > 1` → cor de fundo de alerta. Se duas linhas aparecerem destacadas, houve uma corrida (veja `n8n/README.md`, "Concorrência"). **O sistema nunca apaga linhas**: resolva manualmente.

> Não apague, reordene nem edite linhas já gravadas se puder evitar. Para corrigir uma resposta (o site não permite edição), altere a linha manualmente.

## 3. Aba `Resumo`

Crie uma segunda aba chamada **`Resumo`**. Com a localidade **Brasil**, cole as fórmulas abaixo (separador `;`). Se sua planilha estiver em outra localidade, troque `;` por `,`.

| A | B |
|---|---|
| Total de respostas | `=CONT.VALORES(Confirmacoes!A2:A)` |
| Titulares que confirmaram | `=CONT.SE(Confirmacoes!E2:E; "SIM")` |
| Titulares que recusaram | `=CONT.SE(Confirmacoes!E2:E; "NAO")` |
| Adultos confirmados | `=SOMASE(Confirmacoes!E2:E; "SIM"; Confirmacoes!F2:F)` |
| Crianças confirmadas | `=SOMASE(Confirmacoes!E2:E; "SIM"; Confirmacoes!G2:G)` |
| Total de pessoas confirmadas | `=SOMASE(Confirmacoes!E2:E; "SIM"; Confirmacoes!H2:H)` |

Conferência: *Total de pessoas confirmadas* deve ser igual a *Adultos confirmados + Crianças confirmadas*. Se não for, alguma linha foi editada manualmente.

Opcional — checagem de consistência (linha 8; com as seis linhas acima em A1:B6, o total está em `B6`, adultos em `B4` e crianças em `B5`):

```
A8: Conferência
B8: =SE(B6=B4+B5; "OK"; "Conferir: total ≠ adultos + crianças")
```

## 4. Acesso do n8n

O n8n acessa a planilha por uma credencial **Google Sheets (OAuth2)** ou **Service Account**:

- **OAuth2** (mais simples): no n8n, *Credentials → New → Google Sheets OAuth2 API*, siga o assistente do n8n (requer um projeto no Google Cloud com a API do Google Sheets ativada e a tela de consentimento configurada). A conta usada precisa ter permissão de **editor** na planilha.
- **Service Account**: crie a conta de serviço, gere a chave JSON, cadastre-a no n8n e **compartilhe a planilha com o e-mail da conta de serviço** como editor.

Em qualquer caso, a planilha continua restrita: apenas as contas explicitamente adicionadas têm acesso.

## 5. Privacidade

A planilha contém nomes de convidados. Compartilhe-a só com quem organiza o evento, e considere arquivá-la (ou apagá-la) após o evento.

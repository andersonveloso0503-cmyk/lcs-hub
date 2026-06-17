# 🧩 LCS Hub

Plataforma única que unifica os três projetos da LCS Terceirização:
- **CRM** (contatos, pipeline, WhatsApp, follow-up) — antes em `lcscrm`
- **Instagram** (legendas, imagens, Buffer) — antes em `lcsi-nstagram`
- **Google Ads** (otimização com IA) — antes em `lcs-optimizer`

## Status: Fase 2 concluída ✅

### Fase 1 (anterior)
- Login, navegação por sidebar, conexão real com Firebase (`lcscrm`)

### Fase 2 (esta entrega)
- **CRM completo com visual moderno**: pipeline em Kanban arrastável (Lead → Proposta → Contrato → Inativo)
- **WhatsApp integrado de verdade**: envia e recebe mensagens em tempo real, via Evolution API (instância `lcscrm`, número 55 51 99889-3033)
  - Aba **Inbox** — todas as conversas em um só lugar, tipo caixa de entrada
  - Chat **embutido dentro de cada contato** também
- **Follow-up automático**: alerta visual no painel quando um lead fica parado (regras configuráveis por status) + botão de disparo automático de mensagem de follow-up

## ⚠️ Configuração necessária antes do deploy

### 1. Variáveis de ambiente na Vercel
Vá em **Project Settings → Environment Variables** no painel da Vercel e adicione:

```
VITE_EVOLUTION_BASE_URL = https://evolution-api-production-7c15.up.railway.app
VITE_EVOLUTION_INSTANCE = lcscrm
VITE_EVOLUTION_TOKEN    = (o token da instância, gerado no Evolution Manager)
```

Sem isso, o envio de mensagens pelo CRM não vai funcionar em produção (localmente, use o arquivo `.env` — veja `.env.example`).

### 2. Configurar o Webhook na Evolution API
Para o CRM **receber** mensagens em tempo real, a Evolution API precisa avisar nosso sistema sempre que chegar uma mensagem nova.

No Evolution Manager (`/manager`), abra a instância `lcscrm` → **Webhook** → configure:
- **URL**: `https://SEU-DOMINIO-VERCEL.vercel.app/api/whatsapp-webhook`
- **Eventos**: marque `MESSAGES_UPSERT` (ou "Messages Upsert")
- Salve

Troque `SEU-DOMINIO-VERCEL` pela URL real do seu projeto depois do primeiro deploy.

### 3. Regras do Firestore
As mensagens de WhatsApp são salvas na coleção `whatsapp_messages`. Garanta que as regras do Firestore (projeto `lcscrm`) permitem leitura/escrita nessa coleção — mesmo padrão de regras já usado para `contacts`.

## Rodar localmente

```bash
npm install
cp .env.example .env   # depois edite com os valores reais
npm run dev
```

Senha de acesso: `invictos2015`.

## Deploy na Vercel
Mesmo fluxo de sempre — push para o GitHub, a Vercel builda automaticamente. Não esqueça do passo 1 (variáveis de ambiente) antes do primeiro deploy funcionar de verdade.

## Estrutura

```
api/
└── whatsapp-webhook.js     # recebe mensagens da Evolution API e salva no Firestore

src/
├── firebase/config.js      # conexão com o Firebase "lcscrm"
├── services/
│   └── evolutionApi.js     # envio de mensagens via Evolution API
├── crm/
│   ├── useContacts.js      # hook Firestore para contatos (tempo real)
│   ├── useWhatsAppMessages.js  # hook Firestore para mensagens (tempo real)
│   ├── followUp.js         # regras de follow-up por status
│   ├── KanbanBoard.jsx     # pipeline arrastável
│   ├── Inbox.jsx           # caixa de entrada de WhatsApp
│   ├── WhatsAppChat.jsx    # componente de chat (reutilizado)
│   ├── FollowUpPanel.jsx   # painel de alertas de follow-up
│   └── ContactModal.jsx    # modal de criar/editar contato + chat embutido
├── pages/
│   ├── Dashboard.jsx       # visão geral com dados reais do CRM
│   ├── CRM.jsx             # página principal do CRM (junta tudo)
│   ├── InstagramModule.jsx # placeholder — Fase 3
│   └── GoogleAdsModule.jsx # placeholder — Fase 4
└── App.jsx
```

## Coleções no Firestore

- `contacts` — contatos do CRM (name, company, whatsapp, email, service, type, employees, value, status, notes, createdAt, lastContactAt)
- `whatsapp_messages` — todas as mensagens trocadas (phone, fromMe, text, messageTimestamp, pushName)

## Próximas fases

- **Fase 3** — Módulo Instagram: geração de legendas/imagens com IA, calendário, integração Buffer
- **Fase 4** — Módulo Google Ads: conexão real com a Google Ads API, LCS Score, otimizações com IA
- **Futuro** — Agente de IA para atender o WhatsApp automaticamente (combinado para depois)

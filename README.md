# 🧩 LCS Hub

Plataforma única que unifica os três projetos da LCS Terceirização:
- **CRM** (contatos, pipeline, WhatsApp, follow-up) — antes em `lcscrm`
- **Instagram** (legendas, fotos reais, agendamento) — antes em `lcsi-nstagram`
- **Google Ads** (otimização com IA) — antes em `lcs-optimizer`

## Status: Fase 3 concluída ✅

### Fase 1 — Esqueleto
Login, navegação por sidebar, conexão real com Firebase (`lcscrm`)

### Fase 2 — CRM completo
Pipeline em Kanban, WhatsApp integrado (envia e recebe via Evolution API), follow-up automático

### Fase 3 — Instagram (esta entrega)
- **Gerador de Post**: legenda com IA (Claude/Anthropic), escolhendo serviço, tom e objetivo
- **Editor de Fotos**: upload de fotos reais (drag-and-drop), aplicação de estilo visual da marca (6 temas de cor, 3 formatos: post/stories/reels) via Canvas — sem depender de IA de imagem
- **Banco de Temas**: fotos processadas ficam salvas no Firestore, reutilizáveis em qualquer post, em qualquer dispositivo
- **Agendamento via Buffer**: publica ou agenda o post (foto + legenda) direto no Instagram

## ⚠️ Configuração necessária antes do deploy

### Variáveis de ambiente na Vercel
Além das já configuradas na Fase 2 (Evolution API), adicione:

```
ANTHROPIC_API_KEY = (gerar em console.anthropic.com → API Keys)
BUFFER_API_KEY    = 7bapnxk-EY4t_nyw8veZ4x7Gv2j1oWQsiemb8kELYbj
BLOB_READ_WRITE_TOKEN = (gerar em vercel.com → projeto → Storage → Blob → criar/usar store existente)
```

**Importante**: essas três variáveis **não** têm prefixo `VITE_` de propósito — elas só devem ser acessíveis dentro das Vercel Functions (pasta `api/`), nunca expostas no código que roda no navegador. Não renomeie.

Sobre o `BLOB_READ_WRITE_TOKEN`: você já tinha um store configurado no projeto antigo (`store_DKcbwe8je1bSBabU`). Se quiser reaproveitar o mesmo, acesse esse store no painel da Vercel e copie o token de leitura/escrita; senão, a Vercel cria um novo automaticamente ao conectar Storage → Blob no projeto `lcs-hub`.

Depois de adicionar as variáveis, faça um **Redeploy** (mesmo processo das fases anteriores).

### ⚠️ Atenção: a integração com Buffer pode precisar de ajuste fino
O código em `api/buffer-schedule.js` reaproduz o fluxo que foi descoberto e validado no app anterior (organizations → channels com campo `service` → mutation `createPost`), usando os IDs já conhecidos (organização e canal do Instagram). Mas como a documentação do Buffer GraphQL não é pública/estável, é possível que apareça algum erro de campo na primeira tentativa real — assim como aconteceu com a Evolution API na Fase 2. Se isso ocorrer, me mande a mensagem de erro exata que aparecer na tela e ajustamos juntos.

## Rodar localmente

```bash
npm install
cp .env.example .env   # depois edite com os valores reais
npm run dev
```

Senha de acesso: `invictos2015`.

## Deploy na Vercel
Push para o GitHub → a Vercel builda automaticamente. Lembre-se das variáveis de ambiente antes do primeiro deploy funcionar de verdade.

## Estrutura

```
api/
├── whatsapp-webhook.js     # recebe mensagens da Evolution API (Fase 2)
├── generate-caption.js     # gera legenda de Instagram via Claude API
├── upload-image.js         # upload de imagem para Vercel Blob
└── buffer-schedule.js      # agenda/publica post no Instagram via Buffer

src/
├── firebase/config.js      # conexão com o Firebase "lcscrm"
├── services/
│   └── evolutionApi.js     # envio de mensagens via Evolution API
├── crm/                    # módulo CRM (Fase 2)
├── instagram/
│   ├── api.js               # chamadas às functions do Instagram
│   ├── photoStyle.js         # estilização de fotos via Canvas (6 temas, 3 formatos)
│   ├── usePosts.js            # hook Firestore para posts (tempo real)
│   ├── useThemeBank.js        # hook Firestore para banco de temas (tempo real)
│   ├── PhotoEditor.jsx         # upload + aplicação de estilo
│   ├── ThemeBank.jsx           # galeria de fotos processadas
│   └── PostGenerator.jsx       # legenda com IA + seleção de foto + envio ao Buffer
├── pages/
│   ├── Dashboard.jsx        # visão geral com dados reais do CRM
│   ├── CRM.jsx              # página principal do CRM
│   ├── InstagramModule.jsx  # página principal do Instagram (junta tudo)
│   └── GoogleAdsModule.jsx  # placeholder — Fase 4
└── App.jsx
```

## Coleções no Firestore

- `contacts` — contatos do CRM
- `whatsapp_messages` — mensagens trocadas via WhatsApp
- `posts` — posts do Instagram (legenda, imagem, status: rascunho/agendado/publicado)
- `theme_bank` — fotos processadas no Editor de Fotos, reutilizáveis

## Próximas fases

- **Fase 4** — Módulo Google Ads: conexão real com a Google Ads API, LCS Score, otimizações com IA
- **Futuro** — Agente de IA para atender o WhatsApp automaticamente

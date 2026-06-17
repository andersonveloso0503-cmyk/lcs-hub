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

### Fase 3 — Instagram
- **Gerador de Post**: legenda com IA (Claude/Anthropic), escolhendo serviço, tom e objetivo
- **Editor de Fotos**: upload de fotos reais (drag-and-drop), aplicação de estilo visual da marca (6 temas de cor, 3 formatos: post/stories/reels) via Canvas — sem depender de IA de imagem
- **Banco de Temas**: fotos processadas ficam salvas no Firestore, reutilizáveis em qualquer post, em qualquer dispositivo
- **Agendamento via Buffer**: publica ou agenda o post (foto + legenda) direto no Instagram

### Melhoria — Áudio no WhatsApp
- **Enviar áudio**: botão de microfone no chat grava nota de voz (MediaRecorder do navegador) e envia via Evolution API
- **Receber áudio**: o webhook detecta mensagens de áudio e busca o conteúdo decodificado direto da Evolution API, salvando no Firestore para reprodução imediata no chat (player com play/pause e barra de progresso)

### Melhoria — Classificar conversas direto na Inbox
- Nova coluna no pipeline: **Funcionário** (ao lado de Lead, Proposta, Contrato, Inativo) — para separar conversas internas de leads de venda
- Cada conversa na Inbox agora tem um seletor de status visível direto na lista — sem precisar abrir o CRM
- Ao classificar uma conversa de um número que ainda não tem contato cadastrado, o **contato é criado automaticamente** (usando o nome do WhatsApp quando disponível), já no status escolhido

### Melhoria — Planejamento Semanal Automático (Instagram)
- Nova aba **Semana Automática**, primeira do módulo Instagram
- Um clique gera os 7 posts da semana de uma vez: a IA escreve as 7 legendas (variando serviço, tom e objetivo dia a dia), escolhe uma foto do Banco de Temas para cada uma (evitando repetir foto quando há fotos suficientes), e sugere o dia/horário de publicação
- Você revisa visualmente todos os 7 cards (pode editar a legenda de cada um, ou trocar a foto sugerida)
- Um clique final ("Aprovar e agendar") envia todos os 7 posts para o Buffer, já agendados nos respectivos dias/horários — sem precisar publicar manualmente todo dia
- O agendamento sempre aponta para a próxima segunda-feira em diante (semana cheia, de segunda a domingo)

## ⚠️ Configuração necessária antes do deploy

### Variáveis de ambiente na Vercel
Importante: como o webhook (`api/whatsapp-webhook.js`) agora também faz chamadas à Evolution API (para buscar áudio), são necessárias as MESMAS credenciais em duas versões — uma com prefixo `VITE_` (usada pelo frontend) e uma sem prefixo (usada pelo servidor):

```
VITE_EVOLUTION_BASE_URL = https://evolution-api-production-7c15.up.railway.app
VITE_EVOLUTION_INSTANCE = lcs_crm
VITE_EVOLUTION_TOKEN    = 251EAE7F1D35-423F-BD4A-5E79555F1521

EVOLUTION_BASE_URL = https://evolution-api-production-7c15.up.railway.app
EVOLUTION_INSTANCE = lcs_crm
EVOLUTION_TOKEN     = 251EAE7F1D35-423F-BD4A-5E79555F1521
```

Além disso (configuradas anteriormente):
```
ANTHROPIC_API_KEY = (gerar em console.anthropic.com → API Keys)
BUFFER_API_KEY    = 7bapnxk-EY4t_nyw8veZ4x7Gv2j1oWQsiemb8kELYbj
BLOB_READ_WRITE_TOKEN = (gerado automaticamente ao conectar o Blob Store ao projeto)
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

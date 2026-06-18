# 🧩 LCS Hub

Plataforma única que unifica os três projetos da LCS Terceirização:
- **CRM** (contatos, pipeline, WhatsApp, follow-up) — antes em `lcscrm`
- **Instagram** (legendas, fotos reais, agendamento) — antes em `lcsi-nstagram`
- **Google Ads** (otimização com IA) — antes em `lcs-optimizer`

## Status: Fase 5 em andamento 🟡

### Melhoria — Classificação automática de contatos por palavra-chave
O webhook do WhatsApp (`api/whatsapp-webhook.js`) agora classifica contatos automaticamente
com base no conteúdo de mensagens recebidas, usando `api/lib/classifyMessage.js`:
- Menções a vaga, currículo, emprego, RH, etc (ou um documento PDF/imagem com nome sugestivo de
  currículo) → status **Currículo**.
- Menções a orçamento, preço, valor, cotação, etc → status **Lead**.

Se o número ainda não tiver um contato no CRM, um novo é criado automaticamente já com o status
certo. Se já existir, o status é atualizado — **exceto** quando o contato já está em **Contrato**
ou **Funcionário** (relações já consolidadas, nunca sobrescritas automaticamente). Mensagens
enviadas pela própria LCS (`fromMe: true`) não disparam classificação.

### Fase 5 — Google Ads (estrutura real, métricas pendentes)
Módulo Google Ads reconstruído (`src/pages/GoogleAdsModule.jsx`), substituindo o placeholder
anterior. Mostra dados reais de estrutura das campanhas (32 campanhas, conta `3371725537`):
nome, status, tipo, orçamento diário, estratégia de lance e data de início — com destaque para
campanhas ativas no topo e uma lista colapsável "Todas as campanhas" com filtro por status.

**Limitação importante, avisada na interface**: o developer token oficial do Google Ads API
ainda está em status "Test Account" (Basic Access rejeitado por inconsistência de domínio —
reenviado em junho/2026, aprovação pendente). Por isso, ainda não há métricas de performance
(cliques, custo, conversões), e o LCS Score e as sugestões de otimização por IA estão propositalmente
desativados até que esses dados existam — a interface deixa isso explícito, em vez de simular um
score fictício baseado só em estrutura.

**Arquitetura provisória**: como o Supermetrics (usado para ler a estrutura via Claude) não é uma
API que o código do app possa chamar diretamente, os dados de campanha são gravados manualmente
no Firestore (`google_ads_snapshot/current`, via `api/google-ads-update-snapshot.js`, protegido
por `UPDATE_SECRET`) sempre que precisam ser atualizados, e o app lê esse snapshot em tempo real
via `useGoogleAdsSnapshot()`. Quando a Basic Access for aprovada, essa fonte pode ser trocada por
uma chamada direta à API oficial, sem alterar os componentes visuais.

Novas variáveis de ambiente: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
(credenciais do Firebase Admin SDK, para escrita server-side no Firestore) e `UPDATE_SECRET`
(chave simples para proteger o endpoint de atualização do snapshot).

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
- A IA também decide o **formato de cada dia** (post ou stories) — a maioria fica como post de feed, e 1-2 dias na semana viram stories, pensados para conteúdo mais leve. Fotos quadradas existentes são automaticamente adaptadas ao formato vertical de stories sem precisar reprocessar a foto original
- Você revisa visualmente todos os 7 cards (pode editar a legenda de cada um, ou trocar a foto sugerida)
- Um clique final ("Aprovar e agendar") envia todos os 7 posts para o Buffer, já agendados nos respectivos dias/horários — sem precisar publicar manualmente todo dia
- O agendamento sempre aponta para a próxima segunda-feira em diante (semana cheia, de segunda a domingo)

### Melhoria — Publicação simultânea no Facebook
- Tanto o Gerador de Post quanto a Semana Automática agora publicam automaticamente em **Instagram E Facebook** ao mesmo tempo, mesmo conteúdo
- Requer conectar a página do Facebook da LCS como canal no Buffer e configurar `FACEBOOK_CHANNEL_ID` (veja abaixo)
- Caso o Facebook ainda não esteja configurado, o sistema publica normalmente no Instagram e avisa que o Facebook ficou pendente, sem travar o fluxo

### Melhoria — App instalável no celular (PWA)
- O LCS Hub agora pode ser instalado como app no celular, com ícone na tela inicial e abertura em tela cheia (sem barra de endereço do navegador) — igual aos outros apps da LCS (Invictos FC, Volei Tche)
- Nova barra de navegação inferior fixa, visível só em telas pequenas, com acesso direto a Dashboard, CRM, Instagram e Google Ads
- **Como instalar**: abra `lcs-hub.vercel.app` no navegador do celular → no Android (Chrome), toque no menu (⋮) → "Adicionar à tela inicial" ou "Instalar app"; no iPhone (Safari), toque no ícone de compartilhar → "Adicionar à Tela de Início"

### Melhoria — Cards do Dashboard clicáveis
- Os cards de estatística da Visão Geral (Contatos no CRM, Follow-up Pendente, Conversas no WhatsApp, Instagram) agora são clicáveis, levando direto para a tela relevante
- Atualizado o card "Próximos módulos" para refletir o estado real do projeto (CRM e Instagram já disponíveis, Google Ads em construção)

### Melhoria — Status "Currículo" + suporte a documentos e imagens no WhatsApp
- Nova coluna no pipeline: **Currículo**, ao lado de Funcionário — para separar candidatos de leads de venda
- O sistema agora reconhece e exibe **imagens** e **documentos/PDFs** recebidos pelo WhatsApp (antes só texto e áudio eram tratados; documentos apareciam como "mensagem sem texto/mídia")
- Imagens aparecem como miniatura clicável no chat; documentos aparecem como um card com nome do arquivo, clicável para abrir/baixar
- Toda mídia recebida (áudio, imagem, documento) é enviada para o Vercel Blob e só a URL é salva no Firestore — evita o mesmo problema de limite de 1MB por documento que já corrigimos no Banco de Temas (currículos em PDF frequentemente passam desse limite)
- Classifique a conversa como "Currículo" direto na Inbox, do mesmo jeito que já funciona para os outros status

### Ajuste — Publicação só no Instagram (plano Buffer atual permite 1 canal)
O plano Essentials do Buffer inclui apenas 1 canal social conectado por vez. Como Instagram e Facebook não podem ficar ativos simultaneamente sem adicionar um segundo canal pago (~$5-6/mês extra), o agendamento foi ajustado para publicar **só no Instagram** por padrão. O código de integração com Facebook continua no projeto, desativado — pode ser reativado facilmente caso decida adicionar o segundo canal no futuro.

### Melhoria — Cards clicáveis no Instagram + nova aba "Meus Posts"
- Os 3 cards de estatística no topo do Instagram (Posts criados, Fotos no banco, Agendados) agora são clicáveis
- Nova aba **Meus Posts**, com filtro por status (Todos, Rascunho, Agendado, Publicado) e contador em cada filtro
- Cada post na lista mostra a foto, serviço, legenda, data de agendamento (quando houver), com opções de ver a foto em tamanho real ou remover o post

### Melhoria — Criativos do Instagram com cards flutuantes sobre a foto
Depois de revisar a primeira versão (bloco de marca inferior), o design foi refeito para um estilo modular: a foto real agora cobre todo o canvas, com uma leve vinheta escura para garantir contraste. Por cima, três cards sólidos flutuantes nas cores da marca — um card dourado no canto superior esquerdo com ícone + nome do serviço, um card grande azul royal (ou bordô, dependendo do tema) com o título de destaque, e um card pequeno bordô com o telefone de contato — além da logo real da LCS flutuando direto sobre a foto, sem caixa própria. Layout testado e calibrado para não cortar nem sobrepor nada, tanto em post (quadrado) quanto stories (vertical).

### Melhoria — Excluir e trocar foto de posts agendados, sincronizado com o Buffer
Na aba "Meus Posts", agora é possível excluir um post ou trocar sua foto, e isso reflete automaticamente no Buffer também (não só aqui no app). Ao agendar um post novo, o ID que o Buffer retorna é salvo junto com o registro no Firestore — isso permite usar as mutations `deletePost` e `editPost` da API do Buffer para excluir o agendamento real ou substituir a imagem sem precisar recriar o post do zero. Posts criados antes desta atualização não têm esse ID salvo, então excluir/trocar a foto deles só afeta o registro aqui no app — para esses, é necessário ajustar manualmente direto no painel do Buffer também.

## ⚠️ Correção crítica — Agendamento no Buffer falhando ("Access token is not valid")

### Melhoria — Banco de Temas mostrando poucas fotos no Gerador de Post
O Gerador de Post filtra automaticamente as fotos do Banco de Temas pelo serviço selecionado (ex: só mostra fotos de "Limpeza" quando o serviço escolhido é Limpeza). Esse filtro continua, mas agora aparece um botão "Ver todas (N)" sempre que existirem fotos escondidas pelo filtro — permitindo alternar entre ver só as fotos do serviço atual ou o Banco de Temas completo.

### Melhoria — Sugestão de título de destaque com IA
No Editor de Fotos, o campo de título de destaque (headline que é desenhado na imagem) agora tem um botão "Sugerir com IA" que gera um título curto e criativo baseado no serviço selecionado, sem precisar analisar a foto. Endpoint dedicado e leve (`/api/generate-headline`, Claude Haiku, sem hashtags/emoji/pontuação).

### Melhoria — Criativo completo gerado por IA (sem precisar de foto própria)
Nova seção no Editor de Fotos: "Criativo pronto com IA". Em vez do fluxo normal (foto real + cards desenhados com precisão via Canvas), essa opção usa o modelo `gpt-image-1.5` da OpenAI (qualidade "medium") para gerar a imagem inteira do zero (foto + textos + cards, tudo junto), a partir de um prompt detalhado com o serviço, título de destaque e as cores da marca. Variável de ambiente nova: `OPENAI_API_KEY`. **Esse recurso tem custo real, cobrado direto na conta OpenAI** — aproximadamente $0.03–0.04 por imagem quadrada (post) e $0.05–0.06 por imagem vertical (stories), não é gratuito. **Limitação importante e avisada na interface**: modelos de geração de imagem podem errar a escrita de texto dentro da imagem (nome, telefone, etc.) — o resultado deve sempre ser revisado visualmente antes de salvar ou publicar.
Investigação completa revelou duas causas combinadas: (1) a variável `BUFFER_API_KEY` nunca tinha sido configurada no projeto `lcs-hub` na Vercel (existia apenas no projeto antigo do Instagram), fazendo a chave chegar como `undefined`; (2) a mutation de criar post estava faltando o bloco `metadata: { instagram: { type, shouldShareToFeed } }`, exigido pelo Instagram — sem ele, o Buffer rejeita a postagem com um erro de autenticação que, na prática, mascarava o problema real de validação. Ambos corrigidos: a chave nova foi configurada na Vercel, e o bloco de metadata foi restaurado na mutation. Testado e confirmado funcionando via chamada direta à API antes de aplicar no código.

## ⚠️ Correção crítica — Barra de navegação não aparecia no celular
Havia duas regras CSS conflitantes para `.bottom-nav`: uma dentro do media query mobile (`display: flex`) e outra fora dele (`display: none`), declarada depois — a segunda sempre vencia, escondendo a barra em qualquer tela. Corrigida a ordem das regras. Também corrigido o logo "LCS Hub" sobrepondo os ícones de status do celular (hora/wifi/bateria) quando instalado como PWA — adicionado respeito à área segura do topo (`safe-area-inset-top`).

## ⚠️ Correção crítica — Fotos do Banco de Temas não salvavam
As fotos estilizadas no Editor de Fotos eram salvas como base64 (texto longo, geralmente 1-3MB) direto no Firestore — que tem um limite rígido de 1MB por documento. A escrita falhava silenciosamente, sem nenhum erro visível, dando a impressão de que a foto "desaparecia" ao trocar de aba. Corrigido fazendo upload da imagem para o Vercel Blob primeiro (mesmo serviço já usado para o agendamento no Buffer) e salvando só a URL no Firestore — leve e sem limite de tamanho problemático. Também adicionamos feedback visual real no botão de salvar (carregando / sucesso / erro), que antes não existia.

## ⚠️ Correção crítica — Buffer API (endpoint e sintaxe estavam errados)
Durante os testes reais, descobrimos que o endpoint usado até aqui (`graph.buffer.com`) estava incorreto — a documentação oficial atual confirma que o endpoint correto é **`api.buffer.com`**, com uma sintaxe de mutation diferente (union type `PostActionSuccess`/`MutationError`, imagem via `assets: [{ image: { url } }]`, agendamento via `mode: customScheduled` + `dueAt`). O `api/buffer-schedule.js` foi totalmente reescrito seguindo a documentação oficial confirmada em `developers.buffer.com`. Também corrigimos um erro de digitação no Channel ID do Instagram (era `c487`, o correto é `c687`), confirmado consultando a API em tempo real.

**Recomendação**: teste um post simples primeiro (Gerador de Post, sem agendamento, "Publicar agora") antes de usar a Semana Automática, para confirmar que a integração está funcionando de ponta a ponta.

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
OPENAI_API_KEY    = (gerar em platform.openai.com/api-keys — usado só pelo "Criativo pronto com IA")
```

### Configurar o Facebook como segundo canal
1. No Buffer, conecte a página do Facebook da LCS como um novo canal
2. Descubra o Channel ID dela consultando a API do Buffer (mesmo processo usado para o Instagram)
3. Adicione na Vercel: `FACEBOOK_CHANNEL_ID = (o ID encontrado)`
4. Redeploy

Sem esse passo, os posts continuam indo normalmente só para o Instagram — nada quebra, só o Facebook fica pendente até ser configurado.

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
├── whatsapp-webhook.js     # recebe mensagens da Evolution API (Fase 2) + classificação automática
├── lib/
│   └── classifyMessage.js  # regras de palavra-chave para classificação automática de contatos
├── generate-caption.js     # gera legenda de Instagram via Claude API
├── upload-image.js         # upload de imagem para Vercel Blob
├── buffer-schedule.js      # agenda/publica post no Instagram via Buffer
├── firebaseAdmin.js        # inicializa Firebase Admin SDK (escrita server-side)
└── google-ads-update-snapshot.js  # grava snapshot de campanhas no Firestore (Fase 5)

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
├── googleads/
│   └── useGoogleAdsSnapshot.js  # hook Firestore para o snapshot de campanhas (tempo real)
├── pages/
│   ├── Dashboard.jsx        # visão geral com dados reais do CRM
│   ├── CRM.jsx              # página principal do CRM
│   ├── InstagramModule.jsx  # página principal do Instagram (junta tudo)
│   └── GoogleAdsModule.jsx  # dashboard de campanhas (Fase 5 — estrutura real, métricas pendentes)
└── App.jsx
```

## Coleções no Firestore

- `contacts` — contatos do CRM
- `whatsapp_messages` — mensagens trocadas via WhatsApp
- `posts` — posts do Instagram (legenda, imagem, status: rascunho/agendado/publicado)
- `theme_bank` — fotos processadas no Editor de Fotos, reutilizáveis
- `google_ads_snapshot` — snapshot manual da estrutura de campanhas do Google Ads (documento único: `current`)

## Próximas fases

- **Fase 5 (continuação)** — quando a Basic Access da Google Ads API for aprovada: trocar a
  fonte de dados do snapshot manual para chamada direta à API oficial; ativar LCS Score e
  sugestões de otimização por IA; adicionar ações aplicáveis pelo app (pausar/ativar campanha,
  ajustar orçamento, negative keywords)
- **Futuro** — Agente de IA para atender o WhatsApp automaticamente

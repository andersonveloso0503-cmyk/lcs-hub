# 🧩 LCS Hub

Plataforma única que unifica os três projetos da LCS Terceirização:
- **CRM** (contatos, pipeline, propostas) — antes em `lcscrm`
- **Instagram** (legendas, imagens, Buffer) — antes em `lcsi-nstagram`
- **Google Ads** (otimização com IA) — antes em `lcs-optimizer`

## Status: Fase 1 concluída ✅

Esta fase entrega o **esqueleto funcional** do app:
- Login com senha admin
- Navegação por sidebar entre os 4 módulos (Dashboard, CRM, Instagram, Google Ads)
- Conexão **real** com o Firebase do projeto `lcscrm` (mesmo banco já usado)
- Dashboard já lendo dados reais do Firestore (contagem de contatos, oportunidades, posts)
- Módulos CRM / Instagram / Google Ads como placeholders, prontos para receber o conteúdo nas próximas fases

## Stack
- React 19 + Vite
- React Router (navegação entre módulos)
- Firebase Firestore (banco de dados, projeto `lcscrm`)
- lucide-react (ícones)
- jsPDF (já instalado, para propostas em PDF na Fase 2)

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`. Senha de acesso: `invictos2015` (mesma dos outros apps LCS — pode trocar em `src/context/AuthContext.jsx`).

## Deploy na Vercel

### 1. Subir para o GitHub
```bash
git init
git add .
git commit -m "feat: LCS Hub - Fase 1 (esqueleto + Firebase real)"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/lcs-hub.git
git push -u origin main
```

### 2. Importar na Vercel
- Acesse [vercel.com/new](https://vercel.com/new)
- Importe o repositório `lcs-hub`
- Framework preset: **Vite** (detecta automaticamente)
- Build command: `npm run build` (padrão)
- Output directory: `dist` (padrão)
- Deploy

Não há variáveis de ambiente obrigatórias nesta fase — as chaves do Firebase estão em `src/firebase/config.js` (são chaves públicas do client-side, isso é seguro e é o padrão do Firebase Web SDK; a segurança real vem das **regras do Firestore**, não do segredo da chave).

## Estrutura

```
src/
├── firebase/
│   └── config.js          # conexão com o projeto Firebase "lcscrm"
├── context/
│   └── AuthContext.jsx    # login com senha admin
├── layout/
│   └── AppLayout.jsx      # sidebar + navegação
├── pages/
│   ├── LoginScreen.jsx
│   ├── Dashboard.jsx      # já lê dados reais do Firestore
│   ├── CRM.jsx            # placeholder — Fase 2
│   ├── InstagramModule.jsx # placeholder — Fase 3
│   └── GoogleAdsModule.jsx # placeholder — Fase 4
└── App.jsx                # rotas
```

## Próximas fases

- **Fase 2** — Módulo CRM completo: contatos, funil de vendas, atividades, propostas em PDF (migrado de `lcscrm`)
- **Fase 3** — Módulo Instagram: geração de legendas/imagens com IA, calendário, integração Buffer (migrado de `lcsi-nstagram`)
- **Fase 4** — Módulo Google Ads: conexão real com a Google Ads API (conta 3371725537), LCS Score, otimizações com IA (migrado de `lcs-optimizer`)
- **Fase 5** — Dashboard cruzando dados dos três módulos

// Service worker mínimo do LCS Hub.
// Propositalmente simples: o app depende de dados em tempo real (Firestore,
// WhatsApp), então não fazemos cache agressivo de conteúdo dinâmico — isso
// evitaria o usuário ver dados desatualizados (CRM, mensagens, posts).
// O único papel deste arquivo é tornar o site instalável como PWA.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Sem listener de "fetch" — todas as requisições passam direto para a rede,
// sem interceptação. Isso garante que o app sempre mostra dados atuais.

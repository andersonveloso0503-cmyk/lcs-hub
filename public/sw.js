// O papel deste arquivo é tornar o site instalável como PWA
// e gerenciar notificações push + badge no ícone do app.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Sem listener de "fetch" — todas as requisições passam direto para a rede,
// sem interceptação. Isso garante que o app sempre mostra dados atuais.

// ===================== PUSH NOTIFICATIONS =====================
// Recebe o push disparado pelo backend (whatsapp-webhook.js) via FCM.
// Formato esperado do payload (data-only message):
// { title, body, unreadCount, phone }
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "LCS Hub", body: "Você tem uma nova mensagem." };
  }

  const title = payload.title || "Nova mensagem no WhatsApp";
  const body = payload.body || "Você recebeu uma nova mensagem de um cliente.";
  const unreadCount = Number(payload.unreadCount) || 0;

  const notificationOptions = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "whatsapp-msg",
    renotify: true,
    data: {
      url: "/?tab=whatsapp",
      phone: payload.phone || null,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, notificationOptions),
      unreadCount > 0 && "setAppBadge" in

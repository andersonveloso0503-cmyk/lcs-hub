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
      unreadCount > 0 && "setAppBadge" in self.navigator
        ? self.navigator.setAppBadge(unreadCount).catch(() => {})
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.postMessage({ type: "NAVIGATE_WHATSAPP", url: targetUrl });
        return;
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_BADGE") {
    if ("clearAppBadge" in self.navigator) {
      self.navigator.clearAppBadge().catch(() => {});
    }
  }
  if (event.data && event.data.type === "SET_BADGE") {
    const count = Number(event.data.count) || 0;
    if ("setAppBadge" in self.navigator) {
      if (count > 0) self.navigator.setAppBadge(count).catch(() => {});
      else self.navigator.clearAppBadge().catch(() => {});
    }
  }
});

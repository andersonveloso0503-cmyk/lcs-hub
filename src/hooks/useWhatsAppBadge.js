// src/hooks/useWhatsAppBadge.js
//
// Gerencia: permissão de notificação, registro do token FCM no Firestore,
// contador de mensagens não lidas do WhatsApp, e sincronização do badge
// no ícone do app (Android via push automático, iOS via Badging API).
//
// Uso dentro de um componente (ex: AppLayout.jsx ou WhatsAppInbox.jsx):
//
//   import { useWhatsAppBadge } from "../hooks/useWhatsAppBadge";
//   const { unreadCount, permission, ativarNotificacoes, marcarComoLidas } = useWhatsAppBadge();

import { useEffect, useState, useCallback } from "react";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import {
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { app, db } from "../firebase/config";

// ⚠️ Chave VAPID pública gerada em:
// Firebase Console → lcscrm → Configurações do projeto → Cloud Messaging
// → Configuração da Web Push → Certificados push da Web
const VAPID_KEY =
  "BJUmAcGlOOfDipfaeaiUYf8TQge1R7eCHKTX4j0S2Ycuf3rX4QrLeE6HmGLge7u7WXoXmp2D_IZoLpcdkEIpUqM";

// Documento único no Firestore que guarda o contador de não lidas.
// Simples de propósito: um único usuário/dispositivo administrador.
const UNREAD_DOC_REF = ["whatsapp_status", "unread"];

export function useWhatsAppBadge() {
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [tokenSalvo, setTokenSalvo] = useState(false);

  // Escuta em tempo real o contador de não lidas (atualizado pelo backend
  // no whatsapp-webhook.js sempre que chega mensagem nova do cliente).
  useEffect(() => {
    const ref = doc(db, ...UNREAD_DOC_REF);
    const unsub = onSnapshot(ref, (snap) => {
      const count = snap.exists() ? Number(snap.data().count) || 0 : 0;
      setUnreadCount(count);
      syncBadge(count);
    });
    return unsub;
  }, []);

  // Atualiza o badge do ícone (Service Worker, fora do React)
  const syncBadge = useCallback((count) => {
    if ("setAppBadge" in navigator) {
      if (count > 0) navigator.setAppBadge(count).catch(() => {});
      else navigator.clearAppBadge().catch(() => {});
    }
    // fallback: manda mensagem pro SW também, caso a API não esteja
    // disponível direto no frame principal (alguns navegadores exigem isso)
    navigator.serviceWorker?.ready.then((reg) => {
      reg.active?.postMessage({ type: "SET_BADGE", count });
    });
  }, []);

  // Pede permissão de notificação e registra o token FCM no Firestore
  const ativarNotificacoes = useCallback(async () => {
    if (typeof Notification === "undefined") {
      return { ok: false, error: "Notificações não suportadas neste navegador." };
    }

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        return { ok: false, error: "Permissão de notificação não concedida." };
      }

      const registration = await navigator.serviceWorker.ready;
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (!token) {
        return { ok: false, error: "Não foi possível gerar o token de notificação." };
      }

      // Salva o token no Firestore — o backend lê todos os tokens
      // ativos em fcm_tokens/ para disparar o push.
      await setDoc(doc(db, "fcm_tokens", token), {
        token,
        criadoEm: serverTimestamp(),
        userAgent: navigator.userAgent,
        plataforma: /iPhone|iPad|iPod/.test(navigator.userAgent) ? "ios" : "android-ou-desktop",
      });

      setTokenSalvo(true);
      return { ok: true };
    } catch (err) {
      console.error("Erro ao ativar notificações:", err);
      return { ok: false, error: err.message || "Erro desconhecido." };
    }
  }, []);

  // Zera o contador (Firestore + badge) quando o usuário abre/lê o WhatsApp
  const marcarComoLidas = useCallback(async () => {
    try {
      await setDoc(doc(db, ...UNREAD_DOC_REF), {
        count: 0,
        atualizadoEm: serverTimestamp(),
      });
      syncBadge(0);
      navigator.serviceWorker?.ready.then((reg) => {
        reg.active?.postMessage({ type: "CLEAR_BADGE" });
      });
    } catch (err) {
      console.error("Erro ao zerar contador de não lidas:", err);
    }
  }, [syncBadge]);

  // Notificação em foreground (app aberto na tela) — o evento "push" do SW
  // só dispara com app em background/fechado, então tratamos aqui também.
  useEffect(() => {
    let unsub;
    try {
      const messaging = getMessaging(app);
      unsub = onMessage(messaging, (payload) => {
        const count = Number(payload?.data?.unreadCount) || unreadCount + 1;
        setUnreadCount(count);
        syncBadge(count);
      });
    } catch (e) {
      // getMessaging pode falhar se o navegador não suportar (ex: alguns
      // contextos no iOS antes de instalar como PWA). Falha silenciosa.
    }
    return () => unsub && unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    permission,
    unreadCount,
    tokenSalvo,
    ativarNotificacoes,
    marcarComoLidas,
  };
}

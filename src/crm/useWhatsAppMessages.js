import { useEffect, useState, useMemo } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  addDoc,
  getDocs,
  doc,
  writeBatch,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { normalizePhone } from "../services/evolutionApi";

const COLLECTION = "whatsapp_messages";

/**
 * Escuta todas as mensagens de WhatsApp em tempo real e organiza por
 * conversa (telefone). Usado tanto na Inbox geral quanto no chat de um contato.
 */
export function useWhatsAppMessages() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(collection(db, COLLECTION), orderBy("messageTimestamp", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Agrupa mensagens por número de telefone, com a última mensagem de cada
  const conversations = useMemo(() => {
    const map = new Map();
    for (const msg of messages) {
      const phone = msg.phone;
      if (!map.has(phone)) map.set(phone, []);
      map.get(phone).push(msg);
    }
    return Array.from(map.entries())
      .map(([phone, msgs]) => ({
        phone,
        messages: msgs,
        lastMessage: msgs[msgs.length - 1],
        // Conta quantas mensagens dessa conversa ainda não foram lidas
        // (lida === false). Mensagens antigas sem o campo "lida" são
        // tratadas como já lidas, pra não aparecer contador retroativo.
        unreadCount: msgs.filter((m) => m.lida === false).length,
      }))
      .sort(
        (a, b) =>
          (b.lastMessage?.messageTimestamp || 0) -
          (a.lastMessage?.messageTimestamp || 0)
      );
  }, [messages]);

  function getMessagesForPhone(rawPhone) {
    const phone = normalizePhone(rawPhone);
    return messages.filter((m) => m.phone === phone);
  }

  /**
   * Registra localmente uma mensagem enviada (para feedback imediato na UI,
   * sem esperar o webhook de confirmação).
   */
  async function logOutgoingMessage(rawPhone, text) {
    const phone = normalizePhone(rawPhone);
    return addDoc(collection(db, COLLECTION), {
      phone,
      fromMe: true,
      text,
      type: "text",
      pushName: "",
      messageTimestamp: Date.now(),
      createdAt: serverTimestamp(),
      sentFromCRM: true,
      lida: true,
    });
  }

  /**
   * Registra localmente um áudio enviado, salvando o data URL para reprodução
   * imediata (sem esperar o webhook).
   */
  async function logOutgoingAudio(rawPhone, audioDataUrl, durationSeconds) {
    const phone = normalizePhone(rawPhone);
    return addDoc(collection(db, COLLECTION), {
      phone,
      fromMe: true,
      text: "🎤 Mensagem de voz",
      type: "audio",
      audioUrl: audioDataUrl,
      durationSeconds: durationSeconds || 0,
      pushName: "",
      messageTimestamp: Date.now(),
      createdAt: serverTimestamp(),
      sentFromCRM: true,
      lida: true,
    });
  }

  /**
   * Marca como lidas todas as mensagens não lidas de um telefone específico,
   * e decrementa o contador global de não lidas (usado no badge do ícone do
   * app) pela quantidade exata de mensagens que foram marcadas — não zera
   * tudo, só o que pertence a essa conversa.
   */
  async function marcarConversaComoLida(rawPhone) {
    const phone = normalizePhone(rawPhone);
    const q = query(
      collection(db, COLLECTION),
      where("phone", "==", phone),
      where("lida", "==", false)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    snap.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, { lida: true });
    });

    const unreadRef = doc(db, "whatsapp_status", "unread");
    batch.set(
      unreadRef,
      { count: increment(-snap.size), atualizadoEm: serverTimestamp() },
      { merge: true }
    );

    await batch.commit();
  }

  return {
    messages,
    conversations,
    loading,
    error,
    getMessagesForPhone,
    logOutgoingMessage,
    logOutgoingAudio,
    marcarConversaComoLida,
  };
}

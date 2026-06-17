// /api/whatsapp-webhook.js
// Endpoint que a Evolution API chama quando uma mensagem é recebida (ou enviada).
// Configurar no Evolution Manager: Instância "lcs_crm" → Webhook → URL desta function.
//
// Salva a mensagem em Firestore na coleção "whatsapp_messages", usando o número
// de telefone (sem o sufixo @s.whatsapp.net) como chave de agrupamento da conversa.

import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAHOwdtTpZXVr_BNwG5x54gfEfD3PHSCVk",
  authDomain: "lcscrm.firebaseapp.com",
  projectId: "lcscrm",
  storageBucket: "lcscrm.firebasestorage.app",
  messagingSenderId: "539374293432",
  appId: "1:539374293432:web:a83bf9e10d22440c93bf4d",
};

const EVOLUTION_BASE_URL =
  process.env.EVOLUTION_BASE_URL ||
  "https://evolution-api-production-7c15.up.railway.app";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "lcs_crm";
const EVOLUTION_TOKEN = process.env.EVOLUTION_TOKEN || "251EAE7F1D35-423F-BD4A-5E79555F1521";

function getDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

/**
 * Busca a mídia de uma mensagem (áudio, imagem, etc.) já decodificada em base64,
 * direto da Evolution API, usando o ID da mensagem original.
 */
async function fetchMediaBase64(messageId) {
  try {
    const res = await fetch(
      `${EVOLUTION_BASE_URL}/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_TOKEN,
        },
        body: JSON.stringify({
          message: { key: { id: messageId } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.base64) return null;
    return { base64: data.base64, mimetype: data.mimetype || "audio/ogg" };
  } catch (err) {
    console.error("Erro ao buscar mídia base64:", err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;
    const event = body?.event;

    // A Evolution API envia diferentes eventos; só nos interessa MESSAGES_UPSERT
    if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const data = Array.isArray(body?.data) ? body.data[0] : body?.data;
    if (!data) {
      return res.status(200).json({ ok: true, skipped: true, reason: "no data" });
    }

    const remoteJid = data.key?.remoteJid || "";
    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    const fromMe = data.key?.fromMe === true;
    const pushName = data.pushName || "";
    const messageTimestamp = data.messageTimestamp
      ? Number(data.messageTimestamp) * 1000
      : Date.now();

    if (!phone) {
      return res.status(200).json({ ok: true, skipped: true, reason: "no phone" });
    }

    const isAudio = Boolean(data.message?.audioMessage);
    let messageDoc;

    if (isAudio) {
      const media = await fetchMediaBase64(data.key?.id);
      messageDoc = {
        phone,
        fromMe,
        type: "audio",
        text: "🎤 Mensagem de voz",
        audioUrl: media ? `data:${media.mimetype};base64,${media.base64}` : null,
        durationSeconds: data.message.audioMessage?.seconds || 0,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
      };
    } else {
      const text =
        data.message?.conversation ||
        data.message?.extendedTextMessage?.text ||
        data.message?.imageMessage?.caption ||
        "(mensagem sem texto / mídia)";
      messageDoc = {
        phone,
        fromMe,
        type: "text",
        text,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
      };
    }

    const db = getDb();
    await addDoc(collection(db, "whatsapp_messages"), messageDoc);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Erro no webhook do WhatsApp:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

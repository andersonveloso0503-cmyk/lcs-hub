// /api/whatsapp-webhook.js
// Endpoint que a Evolution API chama quando uma mensagem é recebida (ou enviada).
// Configurar no Evolution Manager: Instância "lcscrm" → Webhook → URL desta function.
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

function getDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
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
    const text =
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text ||
      data.message?.imageMessage?.caption ||
      "(mensagem sem texto / mídia)";
    const pushName = data.pushName || "";
    const messageTimestamp = data.messageTimestamp
      ? Number(data.messageTimestamp) * 1000
      : Date.now();

    if (!phone) {
      return res.status(200).json({ ok: true, skipped: true, reason: "no phone" });
    }

    const db = getDb();
    await addDoc(collection(db, "whatsapp_messages"), {
      phone,
      fromMe,
      text,
      pushName,
      messageTimestamp,
      createdAt: serverTimestamp(),
      raw: data,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Erro no webhook do WhatsApp:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

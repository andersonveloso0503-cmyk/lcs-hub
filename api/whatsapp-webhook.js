// /api/whatsapp-webhook.js
// Endpoint que a Evolution API chama quando uma mensagem é recebida (ou enviada).
// Configurar no Evolution Manager: Instância "lcs_crm" → Webhook → URL desta function.
//
// Salva a mensagem em Firestore na coleção "whatsapp_messages", usando o número
// de telefone (sem o sufixo @s.whatsapp.net) como chave de agrupamento da conversa.
//
// Mídia (áudio, imagem, documento/PDF) é enviada para o Vercel Blob e só a URL
// é salva no Firestore — documentos do Firestore têm limite de 1MB, e arquivos
// de mídia (especialmente PDFs de currículo) costumam passar disso facilmente.

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";
import { put } from "@vercel/blob";
import { detectStatusFromMessage, canAutoReclassify } from "./lib/classifyMessage.js";

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
 * Aplica a classificação automática de status a partir do conteúdo de uma
 * mensagem recebida. Cria o contato se ele ainda não existir, ou atualiza o
 * status de um contato existente — respeitando os status protegidos
 * (contrato, funcionario), que nunca são sobrescritos automaticamente.
 */
async function applyAutoClassification({ db, phone, pushName, text, type, fileName }) {
  const newStatus = detectStatusFromMessage({ text, type, fileName });
  if (!newStatus) return;

  const contactsRef = collection(db, "contacts");
  const q = query(contactsRef, where("whatsapp", "==", phone));
  const snap = await getDocs(q);

  if (snap.empty) {
    // Nenhum contato ainda para esse número — cria um novo já classificado.
    await addDoc(contactsRef, {
      name: pushName || "",
      whatsapp: phone,
      status: newStatus,
      service: "Limpeza",
      type: "Empresa",
      createdAt: serverTimestamp(),
      lastContactAt: serverTimestamp(),
      autoClassified: true,
    });
    return;
  }

  const existing = snap.docs[0];
  const currentStatus = existing.data().status || "";

  if (!canAutoReclassify(currentStatus)) {
    // Status protegido (contrato/funcionario) — não sobrescreve.
    return;
  }

  if (currentStatus === newStatus) return;

  await updateDoc(doc(db, "contacts", existing.id), {
    status: newStatus,
    lastContactAt: serverTimestamp(),
  });
}

/**
 * Busca a mídia de uma mensagem (áudio, imagem, documento, etc.) já decodificada
 * em base64, direto da Evolution API, usando o ID da mensagem original.
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
    return { base64: data.base64, mimetype: data.mimetype || "application/octet-stream" };
  } catch (err) {
    console.error("Erro ao buscar mídia base64:", err);
    return null;
  }
}

/**
 * Envia o conteúdo de mídia (base64) para o Vercel Blob e retorna a URL pública.
 * Usado para áudio, imagem e documentos — nunca salvamos base64 grande direto
 * no Firestore.
 */
async function uploadMediaToBlob(base64, mimetype, extensionHint) {
  try {
    const buffer = Buffer.from(base64, "base64");
    const ext = extensionHint || mimetype.split("/")[1] || "bin";
    const filename = `whatsapp-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const blob = await put(filename, buffer, {
      access: "public",
      contentType: mimetype,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  } catch (err) {
    console.error("Erro ao enviar mídia para o Blob:", err);
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

    const messageContent = data.message || {};
    const isAudio = Boolean(messageContent.audioMessage);
    const isImage = Boolean(messageContent.imageMessage);
    const isDocument = Boolean(messageContent.documentMessage);

    let messageDoc;

    if (isAudio) {
      const media = await fetchMediaBase64(data.key?.id);
      const mediaUrl = media
        ? await uploadMediaToBlob(media.base64, media.mimetype, "ogg")
        : null;
      messageDoc = {
        phone,
        fromMe,
        type: "audio",
        text: "🎤 Mensagem de voz",
        audioUrl: mediaUrl,
        durationSeconds: messageContent.audioMessage?.seconds || 0,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
      };
    } else if (isImage) {
      const media = await fetchMediaBase64(data.key?.id);
      const mediaUrl = media
        ? await uploadMediaToBlob(media.base64, media.mimetype, "jpg")
        : null;
      messageDoc = {
        phone,
        fromMe,
        type: "image",
        text: messageContent.imageMessage?.caption || "📷 Imagem",
        fileUrl: mediaUrl,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
      };
    } else if (isDocument) {
      const media = await fetchMediaBase64(data.key?.id);
      const fileName = messageContent.documentMessage?.fileName || "documento";
      const mimetype = messageContent.documentMessage?.mimetype || "application/octet-stream";
      const extFromName = fileName.includes(".") ? fileName.split(".").pop() : null;
      const mediaUrl = media
        ? await uploadMediaToBlob(media.base64, mimetype, extFromName)
        : null;
      messageDoc = {
        phone,
        fromMe,
        type: "document",
        text: `📄 ${fileName}`,
        fileUrl: mediaUrl,
        fileName,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
      };
    } else {
      const text =
        messageContent.conversation ||
        messageContent.extendedTextMessage?.text ||
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

    // Classificação automática de status (lead/curriculo) só para mensagens
    // recebidas (não para as que a própria LCS envia).
    if (!fromMe) {
      try {
        await applyAutoClassification({
          db,
          phone,
          pushName,
          text: messageDoc.text,
          type: messageDoc.type,
          fileName: messageDoc.fileName,
        });
      } catch (classifyErr) {
        // Erro na classificação não deve impedir o webhook de responder OK
        // (a mensagem já foi salva com sucesso).
        console.error("Erro na classificação automática:", classifyErr);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Erro no webhook do WhatsApp:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

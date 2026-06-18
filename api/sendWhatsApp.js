// /api/lib/sendWhatsApp.js
//
// Envio de mensagens via Evolution API a partir do servidor (Vercel Functions).
// Diferente de src/services/evolutionApi.js (que roda no navegador e usa as
// variáveis VITE_*), este arquivo roda dentro de api/whatsapp-webhook.js e usa
// as variáveis SEM prefixo VITE_ — mesmo padrão já usado em fetchMediaBase64.

const EVOLUTION_BASE_URL =
  process.env.EVOLUTION_BASE_URL || "https://evolution-api-production-7c15.up.railway.app";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "lcs_crm";
const EVOLUTION_TOKEN = process.env.EVOLUTION_TOKEN || "";

function normalizePhone(raw) {
  if (!raw) return "";
  let digits = raw.toString().replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

/**
 * Envia uma mensagem de texto simples.
 */
export async function sendText(toPhone, text) {
  const number = normalizePhone(toPhone);
  if (!number || !text) return { ok: false, error: "Número ou texto vazio" };

  try {
    const res = await fetch(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
      body: JSON.stringify({ number, text }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || "Erro ao enviar mensagem" };
    return { ok: true, data };
  } catch (err) {
    console.error("Erro ao enviar texto via Evolution API:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Envia várias mensagens de texto em sequência, com uma pequena pausa entre
 * elas (evita que cheguem fora de ordem ou sejam tratadas como spam).
 */
export async function sendTextSequence(toPhone, texts) {
  const results = [];
  for (const text of texts) {
    results.push(await sendText(toPhone, text));
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return results;
}

/**
 * Envia um documento (PDF, imagem, etc) a partir de uma URL pública
 * (ex: arquivo hospedado no Vercel Blob).
 */
export async function sendDocumentFromUrl(toPhone, url, fileName, caption) {
  const number = normalizePhone(toPhone);
  if (!number || !url) return { ok: false, error: "Número ou URL vazio" };

  try {
    const res = await fetch(`${EVOLUTION_BASE_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
      body: JSON.stringify({
        number,
        mediatype: "document",
        media: url,
        fileName: fileName || "documento.pdf",
        caption: caption || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || "Erro ao enviar documento" };
    return { ok: true, data };
  } catch (err) {
    console.error("Erro ao enviar documento via Evolution API:", err);
    return { ok: false, error: err.message };
  }
}

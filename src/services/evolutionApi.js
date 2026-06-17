// Camada de comunicação com a Evolution API (WhatsApp)
// Instância: lcscrm | Número: 5551998893033

const EVOLUTION_BASE_URL = import.meta.env.VITE_EVOLUTION_BASE_URL ||
  "https://evolution-api-production-7c15.up.railway.app";
const EVOLUTION_INSTANCE = import.meta.env.VITE_EVOLUTION_INSTANCE || "lcs_crm";
const EVOLUTION_TOKEN = import.meta.env.VITE_EVOLUTION_TOKEN || "";

/**
 * Normaliza um número de telefone brasileiro para o formato esperado
 * pela Evolution API: DDI + DDD + número, só dígitos.
 */
export function normalizePhone(raw) {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  // remove zero inicial de DDD se vier tipo 051...
  if (digits.startsWith("0")) digits = digits.slice(1);
  // se não tem código do país, assume Brasil
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

/**
 * Envia uma mensagem de texto via Evolution API.
 * Retorna { ok, data } ou { ok: false, error }.
 */
export async function sendWhatsAppMessage(toPhone, text) {
  const number = normalizePhone(toPhone);
  if (!number || !text) {
    return { ok: false, error: "Número ou texto vazio" };
  }

  try {
    const res = await fetch(
      `${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_TOKEN,
        },
        body: JSON.stringify({
          number,
          text,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, error: data?.message || "Erro ao enviar mensagem" };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Envia um áudio (nota de voz) via Evolution API.
 * audioBase64 deve ser o base64 puro, sem o prefixo "data:audio/...;base64,".
 */
export async function sendWhatsAppAudio(toPhone, audioBase64) {
  const number = normalizePhone(toPhone);
  if (!number || !audioBase64) {
    return { ok: false, error: "Número ou áudio vazio" };
  }

  try {
    const res = await fetch(
      `${EVOLUTION_BASE_URL}/message/sendWhatsAppAudio/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_TOKEN,
        },
        body: JSON.stringify({
          number,
          audio: audioBase64,
          encoding: true,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, error: data?.message || "Erro ao enviar áudio" };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Verifica o status de conexão da instância (útil para diagnóstico).
 */
export async function getInstanceStatus() {
  try {
    const res = await fetch(
      `${EVOLUTION_BASE_URL}/instance/connectionState/${EVOLUTION_INSTANCE}`,
      {
        headers: { apikey: EVOLUTION_TOKEN },
      }
    );
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

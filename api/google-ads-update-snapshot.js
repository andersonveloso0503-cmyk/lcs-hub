// /api/google-ads-update-snapshot.js
// Recebe uma lista de campanhas (buscada via Supermetrics MCP, fora deste
// código, já que o developer token oficial do Google Ads ainda está em
// status "Test Account" e não retorna dados reais) e grava como snapshot
// no Firestore, em google_ads_snapshot/current. O app lê esse documento
// via useGoogleAdsSnapshot.js.
//
// NOVO: antes de sobrescrever, compara com o snapshot anterior e detecta:
//   - campanhas que mudaram de status (ativa ↔ pausada)
//   - campanhas novas ou removidas
//   - orçamento total ativo passando de um limite (GOOGLE_ADS_BUDGET_THRESHOLD,
//     opcional — se não configurado, esse alerta específico é ignorado)
// Se algo for detectado, manda um WhatsApp pro número configurado em
// GOOGLE_ADS_ALERT_WHATSAPP, e também salva os alertas no próprio snapshot
// (campo "alerts") pra aparecer na Home e na tela de Google Ads do site.
//
// Protegido por uma chave simples (UPDATE_SECRET) para evitar que qualquer
// pessoa na internet escreva nesse documento.
//
// Quando a Basic Access da API oficial for aprovada, este endpoint pode ser
// substituído por um que busca direto da Google Ads API e grava da mesma
// forma — os componentes que leem o snapshot não precisam mudar, e os
// alertas de status/orçamento continuam funcionando do mesmo jeito (alertas
// de gasto/conversão real podem ser adicionados quando esses dados existirem).

import { getAdminDb } from "./firebaseAdmin.js";

const EVOLUTION_BASE_URL =
  process.env.EVOLUTION_BASE_URL ||
  "https://evolution-api-production-7c15.up.railway.app";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "lcs_crm";
const EVOLUTION_TOKEN = process.env.EVOLUTION_TOKEN || "";
const GOOGLE_ADS_ALERT_WHATSAPP = process.env.GOOGLE_ADS_ALERT_WHATSAPP || "5551998893033";
const BUDGET_THRESHOLD = process.env.GOOGLE_ADS_BUDGET_THRESHOLD
  ? parseFloat(process.env.GOOGLE_ADS_BUDGET_THRESHOLD)
  : null;

function normalizePhone(raw) {
  let digits = (raw || "").toString().replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

async function sendWhatsAppAlert(text) {
  try {
    await fetch(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
      body: JSON.stringify({ number: normalizePhone(GOOGLE_ADS_ALERT_WHATSAPP), text }),
    });
  } catch (err) {
    console.error("Erro ao enviar alerta do Google Ads via WhatsApp:", err);
  }
}

/**
 * Compara o snapshot antigo com o novo e devolve uma lista de strings com
 * os alertas detectados (vazia se nada relevante mudou).
 */
function detectAlerts(oldCampaigns, newCampaigns) {
  const alerts = [];
  const oldById = new Map((oldCampaigns || []).map((c) => [c.campaign_id, c]));
  const newIds = new Set(newCampaigns.map((c) => c.campaign_id));

  // Mudança de status numa campanha que já existia
  for (const c of newCampaigns) {
    const old = oldById.get(c.campaign_id);
    if (old && old.status !== c.status) {
      alerts.push(
        `📢 Campanha "${c.name}" mudou de status: ${old.status} → ${c.status}`
      );
    }
  }

  // Campanhas novas
  for (const c of newCampaigns) {
    if (!oldById.has(c.campaign_id)) {
      alerts.push(`🆕 Nova campanha detectada: "${c.name}" (${c.status})`);
    }
  }

  // Campanhas que desapareceram
  for (const c of oldCampaigns || []) {
    if (!newIds.has(c.campaign_id)) {
      alerts.push(`🗑️ Campanha não aparece mais no snapshot: "${c.name}"`);
    }
  }

  // Orçamento total ativo passando do limite (só se configurado)
  if (BUDGET_THRESHOLD) {
    const activeBudget = newCampaigns
      .filter((c) => c.status === "ENABLED")
      .reduce((sum, c) => sum + (c.budget_amount || 0), 0);

    if (activeBudget > BUDGET_THRESHOLD) {
      alerts.push(
        `💰 Orçamento ativo total (R$ ${activeBudget.toFixed(2)}/dia) passou do limite de R$ ${BUDGET_THRESHOLD.toFixed(2)}/dia`
      );
    }
  }

  return alerts;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { secret, campaigns, hasMetrics } = req.body || {};

    if (!process.env.UPDATE_SECRET || secret !== process.env.UPDATE_SECRET) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    if (!Array.isArray(campaigns)) {
      return res.status(400).json({ error: "Campo 'campaigns' deve ser um array" });
    }

    const db = getAdminDb();
    const docRef = db.collection("google_ads_snapshot").doc("current");

    // Lê o snapshot anterior pra poder comparar
    const previousSnap = await docRef.get();
    const previousData = previousSnap.exists ? previousSnap.data() : null;
    const alerts = detectAlerts(previousData?.campaigns, campaigns);

    await docRef.set({
      campaigns,
      hasMetrics: Boolean(hasMetrics),
      updatedAt: new Date().toISOString(),
      alerts,
      alertsCheckedAt: new Date().toISOString(),
    });

    if (alerts.length > 0) {
      const message =
        `⚠️ *Alertas do Google Ads — LCS Hub*\n\n` +
        alerts.join("\n") +
        `\n\nVerifique no painel: lcs-hub.vercel.app/google-ads`;
      await sendWhatsAppAlert(message);
    }

    return res.status(200).json({ ok: true, count: campaigns.length, alerts });
  } catch (err) {
    console.error("Erro ao salvar snapshot do Google Ads:", err);
    return res.status(500).json({ error: err.message });
  }
}

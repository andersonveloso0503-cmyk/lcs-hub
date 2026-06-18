// /api/google-ads-update-snapshot.js
// Recebe uma lista de campanhas (buscada via Supermetrics MCP, fora deste
// código, já que o developer token oficial do Google Ads ainda está em
// status "Test Account" e não retorna dados reais) e grava como snapshot
// no Firestore, em google_ads_snapshot/current. O app lê esse documento
// via useGoogleAdsSnapshot.js.
//
// Protegido por uma chave simples (UPDATE_SECRET) para evitar que qualquer
// pessoa na internet escreva nesse documento.
//
// Quando a Basic Access da API oficial for aprovada, este endpoint pode ser
// substituído por um que busca direto da Google Ads API e grava da mesma
// forma — os componentes que leem o snapshot não precisam mudar.

import { getAdminDb } from "./firebaseAdmin.js";

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
    await db.collection("google_ads_snapshot").doc("current").set({
      campaigns,
      hasMetrics: Boolean(hasMetrics),
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true, count: campaigns.length });
  } catch (err) {
    console.error("Erro ao salvar snapshot do Google Ads:", err);
    return res.status(500).json({ error: err.message });
  }
}

// /api/google-ads-fetch-real.js
//
// Busca dados REAIS de campanhas direto da Google Ads API (agora que a
// Basic Access foi aprovada) e grava no Firestore no MESMO formato que
// api/google-ads-update-snapshot.js já usava com dados via Supermetrics —
// ou seja, useGoogleAdsSnapshot.js e GoogleAdsModule.jsx não precisam mudar
// nada, continuam lendo de google_ads_snapshot/current normalmente.
//
// Reaproveita a mesma lógica de detecção de alertas (mudança de status,
// campanha nova/removida, orçamento total) que já existia no endpoint mock.
//
// Disparo: chamada manual (botão no painel) ou cron job da Vercel
// (vercel.json -> crons), apontando pra essa rota com GET ou POST.
//
// Autenticação OAuth: usa Refresh Token de uma conta com acesso à MCC
// (gerado uma única vez via OAuth Playground), trocado por um Access Token
// de curta duração a cada execução — não precisa de login manual depois
// de configurado.

import { getAdminDb } from "./firebaseAdmin.js";

const GOOGLE_ADS_API_VERSION = "v24";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
// MCC (conta gerenciadora) — necessária no header login-customer-id mesmo
// quando consultamos uma conta-cliente específica.
const MCC_CUSTOMER_ID = (process.env.GOOGLE_ADS_MCC_ID || "3086452974").replace(/-/g, "");
// Conta-cliente cujas campanhas serão lidas (a conta real de anúncios da LCS).
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3371725537").replace(/-/g, "");

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

/** Troca o refresh token por um access token de curta duração (~1h). */
async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Falha ao renovar access token: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

/**
 * Consulta a Google Ads API (GAQL) pedindo as campanhas, seus atributos
 * estruturais (nome, status, tipo, orçamento, estratégia de lance) e
 * métricas de performance dos últimos 30 dias (cliques, impressões, custo,
 * conversões, CTR, CPC médio). Cada linha do resultado já vem segmentada
 * pelo período pedido em DURING LAST_30_DAYS, então não precisamos somar
 * manualmente — a própria API agrega.
 */
async function fetchCampaigns(accessToken) {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date_time,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
    ORDER BY campaign.name
  `;

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER_ID}/googleAds:searchStream`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": DEVELOPER_TOKEN,
      "login-customer-id": MCC_CUSTOMER_ID,
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads API retornou erro ${res.status}: ${text.slice(0, 500)}`);
  }

  // searchStream retorna um array de "batches"; cada batch tem results[].
  const batches = JSON.parse(text);
  const rows = [];
  for (const batch of batches) {
    if (batch.results) rows.push(...batch.results);
  }

  return rows.map((row) => {
    const c = row.campaign || {};
    const m = row.metrics || {};
    const budgetMicros = row.campaignBudget?.amountMicros;
    // v24 renomeou start_date -> start_date_time; o valor vem como
    // "YYYY-MM-DD HH:MM:SS" (com hora), então pegamos só a parte da data
    // pra manter compatibilidade com o formato que o frontend já espera
    // (new Date(campaign.start_date) / toLocaleDateString).
    const startDateTime = c.startDateTime || null;
    const startDate = startDateTime ? startDateTime.split(" ")[0] : null;

    const clicks = Number(m.clicks || 0);
    const impressions = Number(m.impressions || 0);
    const costMicros = Number(m.costMicros || 0);
    const conversions = Number(m.conversions || 0);
    const conversionsValue = Number(m.conversionsValue || 0);
    // ctr e average_cpc vêm como fração/micros prontos da própria API, mas
    // recalculamos a partir dos brutos pra evitar inconsistência de
    // arredondamento quando clicks/impressions for 0.
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cost = costMicros / 1_000_000;
    const avgCpc = clicks > 0 ? cost / clicks : 0;
    const convRate = clicks > 0 ? conversions / clicks : 0;
    const cpa = conversions > 0 ? cost / conversions : null;

    const campaign = {
      campaign_id: c.id,
      name: c.name,
      status: c.status, // "ENABLED" | "PAUSED" | "REMOVED"
      campaign_type: c.advertisingChannelType, // "SEARCH" | "DISPLAY" | etc.
      bidding_strategy: c.biddingStrategyType,
      start_date: startDate,
      budget_amount: budgetMicros ? Number(budgetMicros) / 1_000_000 : 0,
      metrics: {
        impressions,
        clicks,
        cost,
        conversions,
        conversions_value: conversionsValue,
        ctr, // fração 0-1 (ex.: 0.042 = 4.2%)
        avg_cpc: avgCpc,
        conv_rate: convRate,
        cpa, // null quando não há conversões (evita divisão por zero confusa no frontend)
      },
    };

    campaign.lcs_score = calculateLcsScore(campaign);
    return campaign;
  });
}

/**
 * LCS Score — nota de 0 a 10 que resume a saúde da campanha num único
 * número, inspirada em ferramentas como o GIO Score. Pondera 3 dimensões:
 *
 *   - Performance (peso 5): CTR e taxa de conversão, normalizados contra
 *     benchmarks de mercado para o setor de serviços locais B2B/B2C no
 *     Brasil (fontes variam, mas CTR médio em Search costuma girar entre
 *     2-5% e taxa de conversão entre 3-8% — usamos esses intervalos como
 *     "bom" e escalamos linearmente fora deles).
 *   - Eficiência de custo (peso 3): CPA mais baixo é melhor; sem
 *     conversões no período, não há como avaliar eficiência de custo
 *     então essa dimensão fica neutra (nota 5) em vez de penalizar.
 *   - Estrutura (peso 2): campanha ativa com orçamento definido pontua
 *     melhor que campanha pausada ou sem orçamento configurado — é um
 *     proxy simples de "está configurada para rodar" até termos mais
 *     sinais estruturais (extensões, qualidade de anúncio, etc.).
 *
 * Pesos e benchmarks são uma primeira aproximação deliberadamente simples;
 * ajustar conforme os dados reais da conta forem se acumulando ao longo
 * das semanas (ex.: comparar contra a média histórica da própria conta em
 * vez de benchmarks genéricos de mercado).
 */
function calculateLcsScore(campaign) {
  const { status, budget_amount, metrics } = campaign;
  const { ctr, conv_rate, conversions, clicks } = metrics;

  // Sem cliques suficientes no período, não há sinal de performance
  // confiável — pontuação neutra em vez de 0 (que pareceria "campanha
  // ruim" quando na verdade é só "sem dados ainda").
  const hasEnoughData = clicks >= 10;

  // Performance: CTR contra benchmark "bom" de 3% (escala 0-10, capado).
  const ctrScore = hasEnoughData ? Math.min(10, (ctr / 0.03) * 10) : 5;
  // Performance: taxa de conversão contra benchmark "bom" de 5%.
  const convScore = hasEnoughData ? Math.min(10, (conv_rate / 0.05) * 10) : 5;
  const performanceScore = (ctrScore + convScore) / 2;

  // Eficiência de custo: só avaliável havendo conversões; sem isso, fica
  // neutra (não penaliza nem beneficia) até haver dado suficiente.
  const costEfficiencyScore = conversions > 0 ? 7 : 5; // placeholder neutro-positivo; refinar com CPA real por segmento depois

  // Estrutura: ativa + orçamento configurado = pontuação máxima nessa
  // dimensão; qualquer um dos dois faltando reduz a nota.
  let structureScore = 0;
  if (status === "ENABLED") structureScore += 6;
  if (budget_amount > 0) structureScore += 4;

  const weighted =
    performanceScore * 0.5 + costEfficiencyScore * 0.3 + structureScore * 0.2;

  return Math.round(weighted * 10) / 10; // 1 casa decimal
}

/** Mesma lógica de comparação de snapshots usada no endpoint mock anterior. */
function detectAlerts(oldCampaigns, newCampaigns) {
  const alerts = [];
  const oldById = new Map((oldCampaigns || []).map((c) => [c.campaign_id, c]));
  const newIds = new Set(newCampaigns.map((c) => c.campaign_id));

  for (const c of newCampaigns) {
    const old = oldById.get(c.campaign_id);
    if (old && old.status !== c.status) {
      alerts.push(`📢 Campanha "${c.name}" mudou de status: ${old.status} → ${c.status}`);
    }
    // Queda relevante de LCS Score em relação à última sincronização —
    // limiar de 1.5 pontos evita ruído de pequenas flutuações naturais.
    if (old && typeof old.lcs_score === "number" && typeof c.lcs_score === "number") {
      const drop = old.lcs_score - c.lcs_score;
      if (drop >= 1.5) {
        alerts.push(
          `📉 LCS Score da campanha "${c.name}" caiu de ${old.lcs_score} para ${c.lcs_score}`
        );
      }
    }
  }
  for (const c of newCampaigns) {
    if (!oldById.has(c.campaign_id)) {
      alerts.push(`🆕 Nova campanha detectada: "${c.name}" (${c.status})`);
    }
  }
  for (const c of oldCampaigns || []) {
    if (!newIds.has(c.campaign_id)) {
      alerts.push(`🗑️ Campanha não aparece mais no snapshot: "${c.name}"`);
    }
  }
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
  // Aceita GET (cron job da Vercel) e POST (botão manual no painel).
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Proteção simples: cron jobs da Vercel enviam um header de autorização
  // automático quando CRON_SECRET está configurado; chamadas manuais do
  // painel usam a mesma chave UPDATE_SECRET já usada no endpoint mock.
  const providedSecret = req.headers["x-update-secret"] || req.body?.secret || req.query?.secret;
  const isCron = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && providedSecret !== process.env.UPDATE_SECRET) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !DEVELOPER_TOKEN) {
    return res.status(500).json({
      error:
        "Credenciais da Google Ads API incompletas. Configure GOOGLE_ADS_CLIENT_ID, " +
        "GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN e GOOGLE_ADS_DEVELOPER_TOKEN no Vercel.",
    });
  }

  try {
    const accessToken = await getAccessToken();
    const campaigns = await fetchCampaigns(accessToken);

    const db = getAdminDb();
    const docRef = db.collection("google_ads_snapshot").doc("current");

    const previousSnap = await docRef.get();
    const previousData = previousSnap.exists ? previousSnap.data() : null;
    const alerts = detectAlerts(previousData?.campaigns, campaigns);

    await docRef.set({
      campaigns,
      hasMetrics: false, // ainda sem custo/cliques/conversões — só estrutura
      source: "google_ads_api", // diferencia do antigo "supermetrics" no histórico, se quiser checar depois
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
    console.error("Erro ao buscar dados reais do Google Ads:", err);
    return res.status(500).json({ error: err.message });
  }
}

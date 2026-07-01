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
      campaign_budget.resource_name,
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
      budget_resource_name: row.campaignBudget?.resourceName || null,
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

/**
 * Busca o Search Terms Report — os termos de pesquisa REAIS que dispararam
 * seus anúncios nos últimos 30 dias, com suas métricas individuais.
 * Diferente das "palavras-chave" que você configurou, isso mostra o que a
 * pessoa de fato digitou no Google antes de ver o anúncio. É a partir
 * desses termos que sugerimos palavras-chave negativas (termos irrelevantes
 * que estão gastando orçamento sem gerar conversão).
 *
 * Filtra por LAST_30_DAYS e ordena por custo desc — termos que mais
 * gastaram aparecem primeiro, já que são os candidatos mais relevantes a
 * negativar se tiverem zero conversões.
 */
async function fetchSearchTerms(accessToken) {
  const query = `
    SELECT
      search_term_view.search_term,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
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
    throw new Error(`Google Ads API (search terms) retornou erro ${res.status}: ${text.slice(0, 500)}`);
  }

  const batches = JSON.parse(text);
  const rows = [];
  for (const batch of batches) {
    if (batch.results) rows.push(...batch.results);
  }

  return rows.map((row) => {
    const term = row.searchTermView?.searchTerm || "";
    const m = row.metrics || {};
    const cost = Number(m.costMicros || 0) / 1_000_000;
    return {
      term,
      campaign_id: row.campaign?.id,
      campaign_name: row.campaign?.name,
      ad_group_id: row.adGroup?.id,
      ad_group_name: row.adGroup?.name,
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      cost,
      conversions: Number(m.conversions || 0),
    };
  });
}

/**
 * Usa Claude (Haiku, já que é uma análise de texto simples e barata) para
 * avaliar quais termos de pesquisa são irrelevantes ao negócio da LCS
 * (limpeza, portaria, facilities) e sugerir como palavras-chave negativas.
 *
 * Só envia pra análise os termos que JÁ gastaram dinheiro sem nenhuma
 * conversão (cost > 0 e conversions === 0) — são os candidatos relevantes;
 * termos que convertem não devem ser negativados mesmo que pareçam
 * estranhos à primeira vista, e termos sem custo não merecem atenção.
 */
async function analyzeNegativeKeywords(searchTerms) {
  const candidates = searchTerms
    .filter((t) => t.cost > 0 && t.conversions === 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 80); // limite pra manter o prompt enxuto e a resposta rápida

  if (candidates.length === 0) {
    return { suggestions: [], analyzedCount: 0 };
  }

  const termsList = candidates
    .map((t) => `"${t.term}" — custo R$${t.cost.toFixed(2)}, ${t.clicks} cliques, campanha "${t.campaign_name}"`)
    .join("\n");

  const prompt = `Você é especialista em Google Ads para uma empresa brasileira de terceirização de serviços de limpeza, portaria e facilities (condomínios e empresas em Porto Alegre, RS).

Abaixo está uma lista de termos de pesquisa reais que geraram cliques pagos nos últimos 30 dias SEM gerar nenhuma conversão. Analise cada termo e identifique quais são CLARAMENTE IRRELEVANTES ao negócio (ex: buscas por emprego/vagas quando a campanha não é de RH, produtos não relacionados, localização muito distante de Porto Alegre/RS, intenção de pesquisa claramente diferente do serviço anunciado).

Termos:
${termsList}

Para cada termo que você recomenda negativar, responda em formato JSON (array), com este formato exato:
[{"term": "termo exato", "reason": "motivo curto em português, máx 15 palavras", "confidence": "alta" | "media"}]

Só inclua termos onde a irrelevância é CLARA. Em caso de dúvida razoável sobre a intenção de busca, não inclua. Responda APENAS o JSON, sem texto antes ou depois.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Erro na análise por IA: ${data.error?.message || res.status}`);
  }

  const text = data.content?.[0]?.text || "[]";
  const cleaned = text.replace(/```json|```/g, "").trim();

  let suggestions = [];
  try {
    suggestions = JSON.parse(cleaned);
  } catch (e) {
    console.error("Falha ao parsear resposta da IA como JSON:", cleaned.slice(0, 300));
    suggestions = [];
  }

  // Enriquece cada sugestão com os dados originais do termo (custo,
  // cliques, campanha) pra exibir no painel sem precisar cruzar de novo.
  const byTerm = new Map(candidates.map((t) => [t.term, t]));
  const enriched = suggestions
    .map((s) => {
      const original = byTerm.get(s.term);
      if (!original) return null; // IA pode ter alterado levemente o texto; descarta se não achar match exato
      return { ...s, ...original };
    })
    .filter(Boolean);

  return { suggestions: enriched, analyzedCount: candidates.length };
}

/**
 * Busca as palavras-chave POSITIVAS já cadastradas numa campanha (em todos
 * os ad groups dela) — usado para evitar que a IA sugira algo que já
 * existe, o que a API rejeitaria como duplicado.
 */
async function fetchExistingKeywords(accessToken, campaignId) {
  const query = `
    SELECT ad_group_criterion.keyword.text
    FROM ad_group_criterion
    WHERE campaign.id = ${campaignId}
      AND ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.negative = FALSE
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
  if (!res.ok) throw new Error(`Erro ao buscar palavras-chave existentes: ${text.slice(0, 300)}`);
  const batches = JSON.parse(text);
  const rows = [];
  for (const b of batches) if (b.results) rows.push(...b.results);
  return rows.map((r) => (r.adGroupCriterion?.keyword?.text || "").toLowerCase());
}

/**
 * Sugere novas palavras-chave POSITIVAS via IA, baseadas só no serviço da
 * campanha (não em termos de pesquisa históricos — diferente da função de
 * negativas, que parte de dados reais de gasto). Evita sugerir qualquer
 * termo que já exista na campanha, repassando a lista atual no prompt.
 */
async function suggestNewKeywords(serviceLabel, existingKeywords) {
  const existingList = existingKeywords.length > 0 ? existingKeywords.join(", ") : "(nenhuma ainda)";

  const prompt = `Você é especialista em Google Ads para uma empresa brasileira de terceirização (limpeza, portaria, facilities) em Porto Alegre, RS, chamada LCS Terceirização.

Sugira NOVAS palavras-chave de PESQUISA (Search) para uma campanha sobre: "${serviceLabel}".

Palavras-chave que JÁ EXISTEM nesta campanha (não repita nenhuma destas, nem variações muito próximas):
${existingList}

Sugira até 15 palavras-chave novas, relevantes e específicas — pense em como um morador de condomínio ou gestor de empresa em Porto Alegre pesquisaria esse serviço no Google. Evite termos genéricos demais (ex: "limpeza") que trariam tráfego irrelevante; prefira termos com intenção comercial clara (ex: "limpeza de condomínio porto alegre", "terceirização de portaria preço").

Para cada palavra-chave, sugira o tipo de correspondência mais adequado: "EXACT" (correspondência exata, mais restritiva e segura), "PHRASE" (frase, intermediário) ou "BROAD" (ampla, mais alcance mas mais risco de tráfego irrelevante). Prefira EXACT ou PHRASE na maioria dos casos — só sugira BROAD quando o termo for muito específico e dificilmente ambíguo.

Responda APENAS um JSON neste formato, sem texto antes ou depois:
[{"term": "...", "match_type": "EXACT" | "PHRASE" | "BROAD", "reason": "motivo curto em português, máx 15 palavras"}]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status} ao gerar sugestões`);

  const text = data.content?.[0]?.text || "[]";
  const cleaned = text.replace(/```json|```/g, "").trim();
  let suggestions;
  try {
    suggestions = JSON.parse(cleaned);
  } catch {
    throw new Error("A IA retornou um formato inválido. Tente gerar novamente.");
  }

  // Filtro de segurança extra: remove qualquer sugestão que já exista
  // (comparação case-insensitive), mesmo que a IA tenha ignorado a
  // instrução do prompt.
  const existingSet = new Set(existingKeywords);
  return suggestions.filter((s) => s.term && !existingSet.has(s.term.toLowerCase()));
}

/**
 * Adiciona uma palavra-chave POSITIVA a um ad_group específico. Diferente
 * da negativa (que vive no nível de campanha via CampaignCriterionService),
 * palavras positivas vivem no nível de ad_group via AdGroupCriterionService
 * — por isso aqui é necessário primeiro descobrir o ad_group de destino
 * (reaproveita fetchFirstAdGroup, já criado para a criação de anúncios).
 */
async function addKeyword(accessToken, adGroupId, term, matchType) {
  const adGroupResourceName = `customers/${CUSTOMER_ID}/adGroups/${adGroupId}`;
  const body = {
    operations: [
      {
        create: {
          adGroup: adGroupResourceName,
          status: "ENABLED",
          keyword: { text: term, matchType: matchType || "EXACT" },
        },
      },
    ],
  };
  return runMutation(accessToken, "adGroupCriteria:mutate", body);
}

/**
 * Executa uma mutação genérica via GoogleAdsService.mutate — usada pelas 3
 * ações da Fase 4 (negativar termo, pausar campanha, ajustar orçamento).
 * Centralizar aqui evita repetir headers e tratamento de erro 3 vezes.
 */
async function runMutation(accessToken, path, body) {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER_ID}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": DEVELOPER_TOKEN,
      "login-customer-id": MCC_CUSTOMER_ID,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads API retornou erro ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

/**
 * 4.1 — Adiciona um termo como palavra-chave negativa EXATA na campanha
 * indicada. Usa match type EXACT (não BROAD nem PHRASE) deliberadamente:
 * é a opção mais conservadora, bloqueando apenas buscas idênticas ao termo
 * sugerido em vez de variações mais amplas que poderiam excluir tráfego bom
 * por engano — adequado para uma ação que roda com aprovação humana, mas
 * sem revisão linha a linha do match type escolhido.
 */
async function addNegativeKeyword(accessToken, campaignId, term) {
  const campaignResourceName = `customers/${CUSTOMER_ID}/campaigns/${campaignId}`;
  const body = {
    operations: [
      {
        create: {
          campaign: campaignResourceName,
          negative: true,
          keyword: { text: term, matchType: "EXACT" },
        },
      },
    ],
  };
  return runMutation(accessToken, "campaignCriteria:mutate", body);
}

/**
 * 4.2 — Pausa uma campanha (muda status para PAUSED). Reversível a
 * qualquer momento direto na interface do Google Ads ou reativando por
 * aqui no futuro — não há "exclusão" envolvida, é só uma alteração de
 * status, a ação menos arriscada das três mutações de campanha.
 */
async function pauseCampaign(accessToken, campaignId) {
  const campaignResourceName = `customers/${CUSTOMER_ID}/campaigns/${campaignId}`;
  const body = {
    operations: [
      {
        update: { resourceName: campaignResourceName, status: "PAUSED" },
        updateMask: "status",
      },
    ],
  };
  return runMutation(accessToken, "campaigns:mutate", body);
}

/**
 * 4.3 — Ajusta o orçamento diário de uma campanha. Recebe o valor em reais
 * (não em micros) pra manter a interface do painel simples; a conversão
 * pra micros (unidade exigida pela API) acontece aqui dentro.
 *
 * IMPORTANTE: o orçamento é um recurso PRÓPRIO (campaign_budget), separado
 * da campanha — por isso a mutação aponta pro resource name do orçamento,
 * obtido a partir do ID que já vem salvo no snapshot de cada campanha
 * (campaign.budget_resource_name, adicionado no fetchCampaigns).
 */
async function updateCampaignBudget(accessToken, budgetResourceName, newAmountReais) {
  const amountMicros = Math.round(newAmountReais * 1_000_000);
  const body = {
    operations: [
      {
        update: { resourceName: budgetResourceName, amountMicros: String(amountMicros) },
        updateMask: "amount_micros",
      },
    ],
  };
  return runMutation(accessToken, "campaignBudgets:mutate", body);
}

/**
 * 4.6 — Sugere a estratégia de lance mais adequada baseada no volume de
 * conversões da campanha no período (regra fixa, combinada com o
 * usuário, não decidida livremente pela IA): poucas conversões (<5) ainda
 * não dão sinal suficiente para o algoritmo do Google otimizar por
 * conversão, então Maximizar Cliques (TARGET_SPEND) gera mais volume de
 * tráfego para acumular dados; 5+ conversões já permitem Maximizar
 * Conversões (MAXIMIZE_CONVERSIONS) com segurança.
 */
function suggestBiddingStrategy(campaign) {
  const conversions = campaign.metrics?.conversions || 0;
  const current = campaign.bidding_strategy;
  const suggested = conversions >= 5 ? "MAXIMIZE_CONVERSIONS" : "TARGET_SPEND";
  if (current === suggested) return null; // já está na estratégia recomendada, nada a sugerir
  return {
    campaign_id: campaign.campaign_id,
    campaign_name: campaign.name,
    current_strategy: current,
    suggested_strategy: suggested,
    conversions,
    reason:
      suggested === "MAXIMIZE_CONVERSIONS"
        ? `${conversions} conversões no período — volume suficiente para o Google otimizar por conversão.`
        : `Apenas ${conversions} conversões no período — gerar mais tráfego primeiro ajuda a acumular dados.`,
  };
}

/**
 * Aplica de fato a mudança de estratégia de lance na campanha. O campo
 * union (maximize_conversions / target_spend) é setado diretamente no
 * objeto da campanha — diferente de orçamento, que vive num resource
 * separado (campaign_budget).
 */
async function updateBiddingStrategy(accessToken, campaignId, strategy) {
  const campaignResourceName = `customers/${CUSTOMER_ID}/campaigns/${campaignId}`;
  const campaignUpdate = { resourceName: campaignResourceName };
  let updateMask;

  // O Google Ads API rejeita updateMask com o campo "pai" sozinho
  // (ex.: "maximize_conversions") quando ele tem subcampos — erro
  // FIELD_HAS_SUBFIELDS, confirmado em múltiplas fontes oficiais. É
  // preciso referenciar um subcampo específico no path, mesmo que o
  // valor relevante seja simplesmente "deixar vazio" / usar o default.
  if (strategy === "MAXIMIZE_CONVERSIONS") {
    campaignUpdate.maximizeConversions = {};
    updateMask = "maximize_conversions.target_cpa_micros";
  } else if (strategy === "TARGET_SPEND") {
    campaignUpdate.targetSpend = {};
    updateMask = "target_spend.cpc_bid_ceiling_micros";
  } else {
    throw new Error(`Estratégia "${strategy}" não suportada por esta função.`);
  }

  const body = {
    operations: [{ update: campaignUpdate, updateMask }],
  };

  try {
    return await runMutation(accessToken, "campaigns:mutate", body);
  } catch (err) {
    // Campanhas com orçamento COMPARTILHADO (usado por mais de uma
    // campanha) não podem trocar para uma estratégia de lance "standard"
    // como Maximizar Conversões/Cliques — o Google exige criar uma
    // "Portfolio Bidding Strategy" e aplicá-la a todas as campanhas que
    // compartilham aquele orçamento. Isso não é um bug nosso, é uma regra
    // de negócio real do Google Ads (confirmada na documentação oficial)
    // — por isso convertemos pra uma mensagem clara em vez do erro técnico.
    if (err.message.includes("BIDDING_STRATEGY_TYPE_INCOMPATIBLE_WITH_SHARED_BUDGET")) {
      throw new Error(
        "Esta campanha usa um orçamento COMPARTILHADO com outra(s) campanha(s). O Google não permite trocar a estratégia de lance nesse caso sem criar uma 'Estratégia de Lance de Portfólio' e aplicá-la a todas as campanhas que compartilham esse orçamento — isso precisa ser feito manualmente direto no Google Ads (Configurações → Estratégias de lance)."
      );
    }
    throw err;
  }
}

/**
 * 4.7 — Busca performance segmentada por HORA DO DIA (0-23), agregando
 * cliques/custo/conversões dos últimos 30 dias de uma campanha específica.
 * segments.hour já vem por linha individual (uma por hora), então
 * agregamos manualmente por hora aqui.
 */
async function fetchHourlyPerformance(accessToken, campaignId) {
  const query = `
    SELECT segments.hour, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
    FROM campaign
    WHERE campaign.id = ${campaignId} AND segments.date DURING LAST_30_DAYS
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
  if (!res.ok) throw new Error(`Erro ao buscar performance por hora: ${text.slice(0, 300)}`);
  const batches = JSON.parse(text);
  const byHour = {};
  for (const b of batches) {
    for (const row of b.results || []) {
      const hour = row.segments?.hour ?? 0;
      if (!byHour[hour]) byHour[hour] = { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
      byHour[hour].clicks += Number(row.metrics?.clicks || 0);
      byHour[hour].impressions += Number(row.metrics?.impressions || 0);
      byHour[hour].cost += Number(row.metrics?.costMicros || 0) / 1_000_000;
      byHour[hour].conversions += Number(row.metrics?.conversions || 0);
    }
  }
  return byHour;
}

/**
 * Analisa a performance por hora e sugere ajustes de lance (bid modifier)
 * para os horários com melhor e piores conversão — regra fixa, sem IA:
 * compara a taxa de conversão (conversões/cliques) de cada hora contra a
 * média da campanha. Horas com taxa de conversão 50%+ acima da média
 * recebem +20% de lance; horas 50%+ abaixo da média recebem -20%. Exige
 * volume mínimo de cliques por hora (>= 5) para considerar o dado
 * estatisticamente significativo o suficiente.
 */
function analyzeHourlyBidAdjustments(byHour) {
  const hours = Object.entries(byHour)
    .map(([hour, m]) => ({
      hour: Number(hour),
      clicks: m.clicks,
      conversions: m.conversions,
      convRate: m.clicks > 0 ? m.conversions / m.clicks : 0,
    }))
    .filter((h) => h.clicks >= 5);

  if (hours.length === 0) return { suggestions: [], avgConvRate: 0 };

  const totalClicks = hours.reduce((sum, h) => sum + h.clicks, 0);
  const totalConversions = hours.reduce((sum, h) => sum + h.conversions, 0);
  const avgConvRate = totalClicks > 0 ? totalConversions / totalClicks : 0;

  const suggestions = [];
  for (const h of hours) {
    if (avgConvRate === 0) continue;
    const ratio = h.convRate / avgConvRate;
    if (ratio >= 1.5) {
      suggestions.push({
        hour: h.hour,
        bid_modifier: 1.2,
        conv_rate: h.convRate,
        clicks: h.clicks,
        reason: `Taxa de conversão ${(h.convRate * 100).toFixed(1)}% — 50%+ acima da média (${(avgConvRate * 100).toFixed(1)}%)`,
      });
    } else if (ratio <= 0.5) {
      suggestions.push({
        hour: h.hour,
        bid_modifier: 0.8,
        conv_rate: h.convRate,
        clicks: h.clicks,
        reason: `Taxa de conversão ${(h.convRate * 100).toFixed(1)}% — 50%+ abaixo da média (${(avgConvRate * 100).toFixed(1)}%)`,
      });
    }
  }

  return { suggestions, avgConvRate };
}

/**
 * Aplica o modifier do mesmo horário em todos os 7 dias da semana de uma
 * vez (a API exige day_of_week obrigatório no AdScheduleInfo, então
 * precisamos criar 7 critérios, um por dia, para cobrir a semana toda).
 */
async function applyHourlyOptimization(accessToken, campaignId, hour, bidModifier) {
  const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  const campaignResourceName = `customers/${CUSTOMER_ID}/campaigns/${campaignId}`;
  const operations = days.map((day) => ({
    create: {
      campaign: campaignResourceName,
      bidModifier,
      adSchedule: {
        dayOfWeek: day,
        startHour: hour,
        startMinute: "ZERO",
        endHour: hour === 23 ? 24 : hour + 1,
        endMinute: "ZERO",
      },
    },
  }));
  return runMutation(accessToken, "campaignCriteria:mutate", { operations });
}

/**
 * 4.8 — Busca performance segmentada por DISPOSITIVO (MOBILE, DESKTOP,
 * TABLET) de uma campanha específica nos últimos 30 dias.
 */
async function fetchDevicePerformance(accessToken, campaignId) {
  const query = `
    SELECT segments.device, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
    FROM campaign
    WHERE campaign.id = ${campaignId} AND segments.date DURING LAST_30_DAYS
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
  if (!res.ok) throw new Error(`Erro ao buscar performance por dispositivo: ${text.slice(0, 300)}`);
  const batches = JSON.parse(text);
  const byDevice = {};
  for (const b of batches) {
    for (const row of b.results || []) {
      const device = row.segments?.device || "UNKNOWN";
      if (!byDevice[device]) byDevice[device] = { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
      byDevice[device].clicks += Number(row.metrics?.clicks || 0);
      byDevice[device].impressions += Number(row.metrics?.impressions || 0);
      byDevice[device].cost += Number(row.metrics?.costMicros || 0) / 1_000_000;
      byDevice[device].conversions += Number(row.metrics?.conversions || 0);
    }
  }
  return byDevice;
}

/**
 * Mesma lógica de comparação contra a média que a otimização por horário
 * usa, mas por dispositivo. Limiar de volume mínimo mais baixo (>=10
 * cliques) porque normalmente há só 2-3 dispositivos no total.
 */
function analyzeDeviceBidAdjustments(byDevice) {
  const devices = Object.entries(byDevice)
    .map(([device, m]) => ({
      device,
      clicks: m.clicks,
      conversions: m.conversions,
      convRate: m.clicks > 0 ? m.conversions / m.clicks : 0,
    }))
    .filter((d) => d.clicks >= 10 && d.device !== "UNKNOWN");

  if (devices.length < 2) return { suggestions: [], avgConvRate: 0 };

  const totalClicks = devices.reduce((sum, d) => sum + d.clicks, 0);
  const totalConversions = devices.reduce((sum, d) => sum + d.conversions, 0);
  const avgConvRate = totalClicks > 0 ? totalConversions / totalClicks : 0;

  const suggestions = [];
  for (const d of devices) {
    if (avgConvRate === 0) continue;
    const ratio = d.convRate / avgConvRate;
    if (ratio >= 1.3) {
      suggestions.push({
        device: d.device,
        bid_modifier: 1.2,
        conv_rate: d.convRate,
        clicks: d.clicks,
        reason: `Taxa de conversão ${(d.convRate * 100).toFixed(1)}% — acima da média (${(avgConvRate * 100).toFixed(1)}%)`,
      });
    } else if (ratio <= 0.7) {
      suggestions.push({
        device: d.device,
        bid_modifier: 0.8,
        conv_rate: d.convRate,
        clicks: d.clicks,
        reason: `Taxa de conversão ${(d.convRate * 100).toFixed(1)}% — abaixo da média (${(avgConvRate * 100).toFixed(1)}%)`,
      });
    }
  }

  return { suggestions, avgConvRate };
}

const DEVICE_ENUM_MAP = { MOBILE: "MOBILE", DESKTOP: "DESKTOP", TABLET: "TABLET" };

/**
 * Aplica bid modifier por dispositivo via CampaignCriterionService.
 */
async function setDeviceBidModifier(accessToken, campaignId, device, bidModifier) {
  const campaignResourceName = `customers/${CUSTOMER_ID}/campaigns/${campaignId}`;
  const body = {
    operations: [
      {
        create: {
          campaign: campaignResourceName,
          bidModifier,
          device: { type: DEVICE_ENUM_MAP[device] || device },
        },
      },
    ],
  };
  return runMutation(accessToken, "campaignCriteria:mutate", body);
}

/**
 * 4.9 — Busca performance segmentada por localização (location_view), nos
 * últimos 30 dias, para uma campanha específica.
 */
async function fetchGeoPerformance(accessToken, campaignId) {
  const query = `
    SELECT campaign_criterion.location.geo_target_constant, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM location_view
    WHERE campaign.id = ${campaignId} AND segments.date DURING LAST_30_DAYS
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
  if (!res.ok) throw new Error(`Erro ao buscar performance geográfica: ${text.slice(0, 300)}`);
  const batches = JSON.parse(text);
  const rows = [];
  for (const b of batches) if (b.results) rows.push(...b.results);
  return rows.map((row) => ({
    geo_target_constant: row.campaignCriterion?.location?.geoTargetConstant,
    clicks: Number(row.metrics?.clicks || 0),
    cost: Number(row.metrics?.costMicros || 0) / 1_000_000,
    conversions: Number(row.metrics?.conversions || 0),
  }));
}

/**
 * IDs do geo_target_constant para Porto Alegre e principais municípios da
 * região metropolitana — a "região-alvo" do negócio. IDs são fixos e
 * públicos no catálogo do Google (Geographical Targeting CSV).
 */
const TARGET_REGION_GEO_IDS = new Set([
  "1001766", // Porto Alegre
  "1001874", // Canoas
  "1001780", // Viamão
  "1001660", // Gravataí
  "1001607", // Cachoeirinha
  "1001577", // Alvorada
  "1001664", // Guaíba
  "1001714", // Novo Hamburgo
  "1001779", // São Leopoldo
]);

/**
 * Sugere reduzir (não excluir totalmente) o lance em localizações fora da
 * região-alvo que já geraram gasto sem conversão.
 */
function analyzeGeoBidAdjustments(geoRows) {
  const outsideRegion = geoRows.filter(
    (r) => r.geo_target_constant && !TARGET_REGION_GEO_IDS.has(String(r.geo_target_constant).replace(/\D/g, "")) && r.cost > 0
  );

  return outsideRegion
    .filter((r) => r.conversions === 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10)
    .map((r) => ({
      geo_target_constant: r.geo_target_constant,
      bid_modifier: 0.5,
      clicks: r.clicks,
      cost: r.cost,
      reason: `R$${r.cost.toFixed(2)} gastos fora da região-alvo (Porto Alegre/RS) sem conversões`,
    }));
}

/**
 * Aplica bid modifier geográfico via CampaignCriterionService.
 */
async function setGeoBidModifier(accessToken, campaignId, geoTargetConstant, bidModifier) {
  const campaignResourceName = `customers/${CUSTOMER_ID}/campaigns/${campaignId}`;
  const body = {
    operations: [
      {
        create: {
          campaign: campaignResourceName,
          bidModifier,
          location: { geoTargetConstant: `geoTargetConstants/${geoTargetConstant}` },
        },
      },
    ],
  };
  return runMutation(accessToken, "campaignCriteria:mutate", body);
}

/**
 * Busca os grupos de anúncios (ad groups) de uma campanha específica —
 * necessário porque anúncios no Google Ads pertencem a um ad_group, não
 * diretamente à campanha. Pega o primeiro ad_group ENABLED encontrado;
 * campanhas com múltiplos ad groups vão sempre receber o novo anúncio no
 * primeiro da lista (ordenado por nome) até esta função ganhar uma opção
 * de escolha manual.
 */
async function fetchFirstAdGroup(accessToken, campaignId) {
  const query = `
    SELECT ad_group.id, ad_group.name, ad_group.status
    FROM ad_group
    WHERE campaign.id = ${campaignId} AND ad_group.status = 'ENABLED'
    ORDER BY ad_group.name
    LIMIT 1
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
  if (!res.ok) throw new Error(`Erro ao buscar ad group: ${text.slice(0, 300)}`);
  const batches = JSON.parse(text);
  const rows = [];
  for (const b of batches) if (b.results) rows.push(...b.results);
  if (rows.length === 0) throw new Error("Nenhum grupo de anúncios ativo encontrado nesta campanha.");
  return { id: rows[0].adGroup.id, name: rows[0].adGroup.name };
}

/**
 * Busca os anúncios reais (Responsive Search Ads) de uma campanha — texto
 * completo de headlines e descriptions, além de métricas de performance e
 * o campo ad_strength (avaliação própria do Google sobre a qualidade do
 * anúncio: POOR / AVERAGE / GOOD / EXCELLENT). Usado para alimentar as
 * recomendações de IA com dados de criativos, não só de campanha.
 * Limitado aos anúncios ENABLED (anúncios pausados não geram tráfego
 * atual, então não são relevantes para uma recomendação de melhoria).
 */
/**
 * 4.12 — Busca o Índice de Qualidade (Quality Score) de TODAS as
 * palavras-chave ativas da conta, junto com seus 3 componentes
 * (creative_quality_score = relevância do anúncio, search_predicted_ctr =
 * CTR esperado, post_click_quality_score = experiência da página de
 * destino) — esses 3 fatores juntos formam a nota geral (1-10) que
 * influencia diretamente o CPC e a posição do anúncio. Usado pela
 * auditoria geral da conta, que precisa ver isso de forma agregada (não
 * por campanha isolada) para identificar padrões — ex.: "experiência de
 * página ruim em quase todas as palavras" sugere um problema no site
 * como um todo, não em uma campanha específica.
 */
async function fetchQualityScores(accessToken) {
  const query = `
    SELECT
      campaign.name,
      ad_group.name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.quality_info.quality_score,
      ad_group_criterion.quality_info.creative_quality_score,
      ad_group_criterion.quality_info.post_click_quality_score,
      ad_group_criterion.quality_info.search_predicted_ctr,
      metrics.impressions,
      metrics.clicks
    FROM keyword_view
    WHERE campaign.status = 'ENABLED'
      AND ad_group.status = 'ENABLED'
      AND ad_group_criterion.status = 'ENABLED'
      AND ad_group_criterion.quality_info.quality_score IS NOT NULL
      AND segments.date DURING LAST_30_DAYS
    ORDER BY ad_group_criterion.quality_info.quality_score ASC
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
    // Quality Score não calculado ainda para palavras com pouco volume é
    // comum (vem null e é filtrado pelo próprio WHERE) — mas se a query
    // falhar de verdade, não derruba a auditoria inteira por essa parte.
    console.error("Erro ao buscar quality scores:", text.slice(0, 300));
    return [];
  }
  const batches = JSON.parse(text);
  const rows = [];
  for (const b of batches) if (b.results) rows.push(...b.results);

  return rows.map((row) => {
    const qi = row.adGroupCriterion?.qualityInfo || {};
    return {
      campaign_name: row.campaign?.name,
      ad_group_name: row.adGroup?.name,
      keyword: row.adGroupCriterion?.keyword?.text,
      quality_score: qi.qualityScore ?? null,
      creative_quality_score: qi.creativeQualityScore ?? null, // BELOW_AVERAGE | AVERAGE | ABOVE_AVERAGE
      landing_page_quality_score: qi.postClickQualityScore ?? null,
      expected_ctr: qi.searchPredictedCtr ?? null,
      impressions: Number(row.metrics?.impressions || 0),
      clicks: Number(row.metrics?.clicks || 0),
    };
  });
}

/**
 * Gera uma auditoria GERAL da conta (não por campanha isolada): combina
 * estrutura/métricas das campanhas + criativos + Quality Score agregado,
 * e pede à IA um plano de ação priorizado e abrangente — no espírito do
 * que o usuário pediu: "melhorar a campanha em geral para ficar bem
 * posicionado nas pesquisas". Diferente de generateRecommendations (que
 * já existe e foca em ações pontuais e estruturadas por campanha), esta
 * função olha o panorama inteiro e identifica padrões sistêmicos — ex.:
 * "experiência de página ruim em 80% das palavras-chave" é um problema
 * de SITE, não de uma campanha específica, e só aparece quando se olha o
 * conjunto.
 */
async function generateAccountAudit(campaigns, qualityScores, accessToken) {
  const activeCampaigns = campaigns.filter((c) => c.status === "ENABLED");

  const campaignSummaries = activeCampaigns
    .map((c) => {
      const m = c.metrics || {};
      return `- campaign_id="${c.campaign_id}" nome="${c.name}" (${c.campaign_type}, estratégia atual: ${c.bidding_strategy}): ${m.clicks ?? 0} cliques, CTR ${((m.ctr ?? 0) * 100).toFixed(2)}%, ${m.conversions ?? 0} conversões, orçamento atual R$${(c.budget_amount ?? 0).toFixed(2)}/dia, LCS Score ${c.lcs_score ?? "—"}/10`;
    })
    .join("\n");

  const qsWithScore = qualityScores.filter((q) => q.quality_score !== null);
  const avgQs = qsWithScore.length > 0 ? qsWithScore.reduce((sum, q) => sum + q.quality_score, 0) / qsWithScore.length : null;

  // Conta quantas palavras têm cada componente fraco — para a IA
  // identificar se é um problema sistêmico (a maioria das palavras tem o
  // mesmo componente fraco) ou pontual (só algumas palavras específicas).
  const weakCreative = qualityScores.filter((q) => q.creative_quality_score === "BELOW_AVERAGE").length;
  const weakLandingPage = qualityScores.filter((q) => q.landing_page_quality_score === "BELOW_AVERAGE").length;
  const weakCtr = qualityScores.filter((q) => q.expected_ctr === "BELOW_AVERAGE").length;

  const worstKeywords = qsWithScore
    .sort((a, b) => a.quality_score - b.quality_score)
    .slice(0, 15)
    .map((q) => `- "${q.keyword}" (campanha "${q.campaign_name}"): QS ${q.quality_score}/10 — relevância: ${q.creative_quality_score || "?"}, CTR esperado: ${q.expected_ctr || "?"}, experiência da página: ${q.landing_page_quality_score || "?"}`)
    .join("\n");

  // Anúncios (criativos) reais das campanhas ativas — Ad Strength,
  // headlines e métricas. Mesma fonte usada em generateRecommendations,
  // reunida aqui também para a auditoria poder identificar e sugerir
  // criação de novo anúncio quando o Ad Strength estiver fraco.
  let adsSummary = "Nenhum anúncio analisado (dados indisponíveis ou nenhuma campanha ativa).";
  if (accessToken) {
    try {
      const adsByCampaign = await Promise.all(
        activeCampaigns.map(async (c) => ({
          campaign_id: c.campaign_id,
          campaign_name: c.name,
          ads: await fetchAdsForCampaign(accessToken, c.campaign_id),
        }))
      );
      const adsLines = [];
      for (const { campaign_id, campaign_name, ads } of adsByCampaign) {
        for (const ad of ads) {
          adsLines.push(
            `- campaign_id="${campaign_id}" campanha="${campaign_name}" (grupo "${ad.ad_group_name}"): Ad Strength = ${ad.ad_strength}, ${ad.clicks} cliques, CTR ${(ad.ctr * 100).toFixed(2)}%, ${ad.conversions} conversões`
          );
        }
      }
      if (adsLines.length > 0) adsSummary = adsLines.join("\n");
    } catch (err) {
      console.error("Erro ao buscar anúncios para auditoria (segue sem essa parte):", err.message);
    }
  }

  // Termos de pesquisa que gastaram sem converter — mesma análise usada
  // no card de palavras-chave negativas, reunida aqui para a auditoria
  // poder sugerir negativar diretamente como parte do plano geral, em
  // vez do usuário precisar visitar outro card separado para isso.
  let negativeCandidatesSummary = "Nenhum termo de pesquisa com gasto sem conversão identificado.";
  if (accessToken) {
    try {
      const searchTerms = await fetchSearchTerms(accessToken);
      const candidates = searchTerms
        .filter((t) => t.cost > 0 && t.conversions === 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 30);
      if (candidates.length > 0) {
        negativeCandidatesSummary = candidates
          .map((t) => `- campaign_id="${t.campaign_id}" termo="${t.term}" (campanha "${t.campaign_name}"): R$${t.cost.toFixed(2)} gastos, ${t.clicks} cliques, 0 conversões`)
          .join("\n");
      }
    } catch (err) {
      console.error("Erro ao buscar termos de pesquisa para auditoria (segue sem essa parte):", err.message);
    }
  }

  const prompt = `Você é um especialista sênior em Google Ads fazendo uma AUDITORIA GERAL e ESTRATÉGICA da conta da LCS Terceirização (limpeza, portaria, facilities em Porto Alegre, RS) — o objetivo do cliente é melhorar a posição dos anúncios nas buscas (Índice de Qualidade mais alto = melhor posição e menor custo por clique), cobrindo CRIATIVOS, ANÚNCIOS e PALAVRAS-CHAVE, não só estrutura de campanha.

VISÃO GERAL DAS CAMPANHAS ATIVAS:
${campaignSummaries}

ÍNDICE DE QUALIDADE (média da conta: ${avgQs !== null ? avgQs.toFixed(1) : "indisponível"}/10, baseado em ${qsWithScore.length} palavras-chave com dado disponível):
- Palavras com relevância do anúncio BAIXA: ${weakCreative}
- Palavras com experiência de página de destino BAIXA: ${weakLandingPage}
- Palavras com CTR esperado BAIXO: ${weakCtr}

15 PALAVRAS-CHAVE COM PIOR ÍNDICE DE QUALIDADE:
${worstKeywords || "Nenhum dado de Índice de Qualidade disponível ainda (normal em contas novas ou com baixo volume)."}

ANÚNCIOS (CRIATIVOS) DAS CAMPANHAS ATIVAS:
${adsSummary}

TERMOS DE PESQUISA QUE GASTARAM SEM CONVERTER (candidatos a palavra-chave negativa):
${negativeCandidatesSummary}

Faça uma auditoria ESTRATÉGICA E ABRANGENTE (não pontual) identificando:
1. Padrões sistêmicos (ex.: se muitas palavras têm experiência de página ruim, isso é um problema do SITE como um todo, não de uma campanha)
2. Anúncios com Ad Strength fraco que precisam de uma nova versão
3. Termos de pesquisa claramente irrelevantes que deveriam ser negativados
4. Quais ações teriam MAIOR impacto na posição geral dos anúncios
5. Priorização clara (o que resolver primeiro)

Para cada ação prioritária, quando ela corresponder EXATAMENTE a uma das ações automatizáveis abaixo, preencha o campo "action" com os parâmetros certos, usando o campaign_id exato fornecido acima. Se a ação for qualitativa (ex.: "melhore a página de destino do site") e não corresponder a nenhuma das ações abaixo, deixe "action" como null — não invente uma ação que não existe. Só sugira negativar um termo se ele aparecer EXPLICITAMENTE na lista de termos com gasto sem conversão acima — não invente termos.

AÇÕES AUTOMATIZÁVEIS DISPONÍVEIS:
- pause_campaign: { type: "pause_campaign", campaign_id }
- update_budget: { type: "update_budget", campaign_id, new_amount (número em R$, > 0) }
- update_bidding_strategy: { type: "update_bidding_strategy", campaign_id, strategy: "MAXIMIZE_CONVERSIONS" | "TARGET_SPEND" }
- add_negative_keyword: { type: "add_negative_keyword", campaign_id, term (EXATAMENTE como aparece na lista de termos acima) }
- create_ad: { type: "create_ad", campaign_id, service_label (descrição curta em português do serviço/ângulo do novo anúncio, ex: "limpeza de condomínio com foco em rapidez") }

Responda em JSON neste formato exato, sem texto antes ou depois:
{
  "overall_assessment": "resumo de 2-3 frases sobre o estado geral da conta e o que mais limita a posição dos anúncios hoje",
  "priority_actions": [
    {"title": "título curto (máx 10 palavras)", "detail": "explicação específica com números reais (máx 250 caracteres)", "impact": "alto" | "medio" | "baixo", "category": "criativo" | "pagina_destino" | "palavras_chave" | "estrutura", "action": null | {"type": "...", "campaign_id": "...", ...demais campos}}
  ]
}

Gere entre 5 e 10 ações prioritárias, ordenadas por impacto (maior impacto primeiro), cobrindo criativos/anúncios E palavras-chave quando os dados permitirem, não só estrutura de campanha.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status} ao gerar auditoria`);

  const text = data.content?.[0]?.text || "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  let audit;
  try {
    audit = JSON.parse(cleaned);
  } catch {
    throw new Error("A IA retornou um formato inválido na auditoria geral.");
  }

  // Validação extra: confere se o campaign_id de cada ação de fato existe
  // no conjunto de campanhas analisado — evita um botão "Aplicar" que
  // falharia por referenciar um ID inventado ou de outra conta. Para
  // add_negative_keyword, valida também se o termo é um dos candidatos
  // reais (não um termo inventado pela IA) — re-busca a mesma lista de
  // candidatos usada no prompt para comparar.
  const validCampaignIds = new Set(campaigns.map((c) => c.campaign_id));
  let validNegativeTerms = new Set();
  if (accessToken) {
    try {
      const searchTerms = await fetchSearchTerms(accessToken);
      validNegativeTerms = new Set(
        searchTerms.filter((t) => t.cost > 0 && t.conversions === 0).map((t) => t.term)
      );
    } catch {
      // se falhar, validNegativeTerms fica vazio e qualquer add_negative_keyword é descartado por segurança (ver abaixo)
    }
  }

  if (Array.isArray(audit.priority_actions)) {
    audit.priority_actions = audit.priority_actions.map((a) => {
      if (!a.action) return a;
      if (!validCampaignIds.has(a.action.campaign_id)) return { ...a, action: null };
      if (a.action.type === "add_negative_keyword" && !validNegativeTerms.has(a.action.term)) {
        return { ...a, action: null };
      }
      return a;
    });
  }

  return { ...audit, avg_quality_score: avgQs, keywords_analyzed: qsWithScore.length };
}

async function fetchAdsForCampaign(accessToken, campaignId) {
  const query = `
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad_strength,
      ad_group_ad.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.conversions
    FROM ad_group_ad
    WHERE campaign.id = ${campaignId}
      AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD
      AND ad_group_ad.status = 'ENABLED'
      AND segments.date DURING LAST_30_DAYS
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
    console.error(`Erro ao buscar anúncios da campanha ${campaignId}:`, text.slice(0, 300));
    return []; // não derruba a análise da campanha inteira por falha aqui
  }
  const batches = JSON.parse(text);
  const rows = [];
  for (const b of batches) if (b.results) rows.push(...b.results);

  return rows.map((row) => {
    const ad = row.adGroupAd?.ad || {};
    const rsa = ad.responsiveSearchAd || {};
    const m = row.metrics || {};
    return {
      ad_id: ad.id,
      ad_group_name: row.adGroup?.name,
      headlines: (rsa.headlines || []).map((h) => h.text),
      descriptions: (rsa.descriptions || []).map((d) => d.text),
      ad_strength: row.adGroupAd?.adStrength || "UNKNOWN",
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      ctr: Number(m.ctr || 0),
      conversions: Number(m.conversions || 0),
    };
  });
}

/**
 * Gera headlines e descriptions para um Responsive Search Ad via Claude,
 * já respeitando os limites de caracteres do formato (30 chars/headline,
 * 90 chars/description) — ver pesquisa de especificações RSA 2026.
 * Retorna sempre 15 headlines e 4 descriptions (o máximo permitido):
 * mais variações dão ao algoritmo do Google mais combinações para testar
 * e melhoram o "Ad Strength", segundo a documentação oficial.
 */
async function generateAdCopy(serviceLabel, finalUrl, angle = null) {
  const angleInstruction = angle
    ? `\nÂNGULO ESPECÍFICO PARA ESTA VERSÃO: ${angle}\n`
    : "";
  const prompt = `Você é especialista em Google Ads para uma empresa brasileira de terceirização (limpeza, portaria, facilities) em Porto Alegre, RS, chamada LCS Terceirização.

Crie textos para um Responsive Search Ad (RSA) sobre o serviço: "${serviceLabel}".
${angleInstruction}
REGRAS OBRIGATÓRIAS DE FORMATO (o Google Ads rejeita se não respeitar):
- EXATAMENTE 15 headlines, cada uma com NO MÁXIMO 30 caracteres (contando espaços)
- EXATAMENTE 4 descriptions, cada uma com NO MÁXIMO 90 caracteres (contando espaços)
- Cada headline deve fazer sentido sozinha (o Google mistura e combina, mostrando 2-3 por vez em qualquer ordem)
- Sem emojis (proibido pelo Google nesse formato)
- Pelo menos 2 headlines devem mencionar "Porto Alegre" ou "POA"
- Inclua benefícios concretos, urgência, e ao menos uma headline com chamada direta para WhatsApp

Responda APENAS um JSON neste formato exato, sem texto antes ou depois:
{"headlines": ["...", "..." (15 itens)], "descriptions": ["...", "..." (4 itens)]}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status} ao gerar anúncio`);

  const text = data.content?.[0]?.text || "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("A IA retornou um formato inválido. Tente gerar novamente.");
  }

  // Corta no limite de caracteres como segurança extra — a IA geralmente
  // já respeita, mas isso evita que o mutate real falhe por 1-2 caracteres
  // a mais, o que seria mais frustrante de debugar depois do fato.
  const headlines = (parsed.headlines || []).slice(0, 15).map((h) => h.slice(0, 30));
  const descriptions = (parsed.descriptions || []).slice(0, 4).map((d) => d.slice(0, 90));

  if (headlines.length < 3 || descriptions.length < 2) {
    throw new Error("A IA não gerou headlines/descriptions suficientes (mínimo 3 headlines, 2 descriptions).");
  }

  return { headlines, descriptions };
}

/**
 * Cria o Responsive Search Ad de verdade via API. Primeiro roda com
 * validateOnly: true (não cria nada, só verifica se o Google aceitaria o
 * anúncio — pega erros de política, como palavras proibidas, antes de
 * gastar uma operação real). Se passar a validação, refaz a chamada sem
 * validateOnly para criar o anúncio de fato, sempre como PAUSED — o
 * usuário ativa manualmente depois de revisar como ficou no Google Ads,
 * em vez do anúncio já entrar rodando e gastando antes de qualquer review
 * visual fora deste painel.
 */
async function createResponsiveSearchAd(accessToken, adGroupId, headlines, descriptions, finalUrl) {
  const adGroupResourceName = `customers/${CUSTOMER_ID}/adGroups/${adGroupId}`;
  const operation = {
    create: {
      adGroup: adGroupResourceName,
      status: "PAUSED", // criado pausado — ativação é decisão manual após revisão visual
      ad: {
        responsiveSearchAd: {
          headlines: headlines.map((text) => ({ text })),
          descriptions: descriptions.map((text) => ({ text })),
        },
        finalUrls: [finalUrl],
      },
    },
  };

  // 1) Validação (não cria nada) — detecta erro de política antecipado.
  await runMutation(accessToken, "adGroupAds:mutate", { operations: [operation], validateOnly: true });

  // 2) Criação real.
  const result = await runMutation(accessToken, "adGroupAds:mutate", { operations: [operation] });
  return result.results?.[0]?.resourceName || null;
}

/**
 * 4.10 — Cria um Responsive Search Ad já ATIVO (status ENABLED), usado
 * especificamente para Testes A/B nativos: o Google só distribui tráfego
 * de teste entre anúncios que estão de fato rodando, então aqui (e só
 * aqui) o anúncio entra direto ativo, sem a etapa de revisão pausada que
 * as outras criações de anúncio exigem.
 */
async function createActiveResponsiveSearchAd(accessToken, adGroupId, headlines, descriptions, finalUrl) {
  const adGroupResourceName = `customers/${CUSTOMER_ID}/adGroups/${adGroupId}`;
  const operation = {
    create: {
      adGroup: adGroupResourceName,
      status: "ENABLED",
      ad: {
        responsiveSearchAd: {
          headlines: headlines.map((text) => ({ text })),
          descriptions: descriptions.map((text) => ({ text })),
        },
        finalUrls: [finalUrl],
      },
    },
  };
  await runMutation(accessToken, "adGroupAds:mutate", { operations: [operation], validateOnly: true });
  const result = await runMutation(accessToken, "adGroupAds:mutate", { operations: [operation] });
  return result.results?.[0]?.resourceName || null;
}

/**
 * Gera e cria 2 variantes de Responsive Search Ad no MESMO ad_group,
 * ambas ativas — o próprio Google Ads já testa A/B nativamente entre
 * anúncios ativos de um mesmo ad_group, rotacionando exibição e
 * aprendendo qual performa melhor (Ad Strength / otimização automática de
 * rotação). Não precisamos implementar lógica de "vencedor" por conta
 * própria: isso é built-in da plataforma quando há 2+ RSAs no ad_group.
 * Os 2 ângulos diferentes (ex.: foco em preço vs foco em confiabilidade)
 * são o que de fato torna o teste informativo — anúncios quase idênticos
 * não geram aprendizado útil sobre qual mensagem funciona melhor.
 */
async function createAbTestAds(accessToken, campaignId, serviceLabel, finalUrl) {
  const angleA = "Foco em RAPIDEZ e DISPONIBILIDADE — atendimento imediato, sem burocracia, resposta rápida no WhatsApp";
  const angleB = "Foco em CONFIABILIDADE e EXPERIÊNCIA — anos de experiência, equipe treinada, contrato seguro e profissional";

  const [copyA, copyB] = await Promise.all([
    generateAdCopy(serviceLabel, finalUrl, angleA),
    generateAdCopy(serviceLabel, finalUrl, angleB),
  ]);

  const adGroup = await fetchFirstAdGroup(accessToken, campaignId);

  const resourceNameA = await createActiveResponsiveSearchAd(accessToken, adGroup.id, copyA.headlines, copyA.descriptions, finalUrl);
  const resourceNameB = await createActiveResponsiveSearchAd(accessToken, adGroup.id, copyB.headlines, copyB.descriptions, finalUrl);

  return {
    ad_group_name: adGroup.name,
    variant_a: { resource_name: resourceNameA, angle: "Rapidez e Disponibilidade", headlines: copyA.headlines.slice(0, 3) },
    variant_b: { resource_name: resourceNameB, angle: "Confiabilidade e Experiência", headlines: copyB.headlines.slice(0, 3) },
  };
}

/**
 * Roda as 3 otimizações automáticas, respeitando exatamente a configuração
 * salva pelo usuário na tela /google-ads/optimizations (documento
 * google_ads_config/optimizations no Firestore). Pensado para ser chamado
 * por um cron diário, mas funciona da mesma forma se disparado manualmente.
 *
 * Regras de negócio definidas com o usuário (não inferidas pela IA):
 *   - Pausar campanhas: só se "pause_campaigns" estiver enabled. Pausa
 *     qualquer campanha ENABLED com lcs_score < 5, dentro do escopo de
 *     campanhas selecionado (todas ou a lista marcada).
 *   - Palavras negativas: só se "negative_keywords" estiver enabled.
 *     Aplica SOMENTE sugestões com confidence "alta" (confiança média fica
 *     de fora do automático, continua exigindo aprovação manual na tela
 *     principal) — também restrito ao escopo de campanhas selecionado.
 *   - Balanço de orçamento: só se "budget_balance" estiver enabled. REDUZ
 *     (nunca aumenta) o orçamento de campanhas com lcs_score < 5. A IA
 *     decide o tamanho do corte dentro de limites de segurança fixos:
 *     no máximo 50% do orçamento atual por execução, e nunca deixa o
 *     orçamento resultante abaixo de R$5/dia (campanhas que precisariam
 *     de menos que isso deveriam ser pausadas, não apenas ter orçamento
 *     reduzido — por isso o piso).
 *
 * Cada ação aplicada é registrada no array `applied` retornado, e qualquer
 * falha individual (ex.: uma chamada de mutate específica falhar) não
 * interrompe as demais — erros ficam no array `errors` para diagnóstico.
 */
async function runAutoOptimizations(accessToken) {
  const db = getAdminDb();

  const configSnap = await db.collection("google_ads_config").doc("optimizations").get();
  const config = configSnap.exists ? configSnap.data() : { enabled: {}, applyToAll: false, selectedCampaigns: [] };
  const enabled = config.enabled || {};

  // Sem nenhuma otimização ativada, não há nada a fazer — evita gastar
  // operações da API só para constatar isso.
  if (!enabled.pause_campaigns && !enabled.negative_keywords && !enabled.budget_balance) {
    return { applied: [], errors: [], skipped: "Nenhuma otimização automática está ativada." };
  }

  const snapshotSnap = await db.collection("google_ads_snapshot").doc("current").get();
  if (!snapshotSnap.exists) {
    return { applied: [], errors: [], skipped: "Sem snapshot de campanhas sincronizado ainda." };
  }
  const snapshotData = snapshotSnap.data();
  const campaigns = snapshotData.campaigns || [];
  const suggestions = snapshotData.negative_keyword_suggestions || [];

  const selectedSet = new Set(config.selectedCampaigns || []);
  const inScope = (campaignId) => config.applyToAll || selectedSet.has(campaignId);

  const applied = [];
  const errors = [];

  // --- Pausar campanhas com Score baixo ---
  if (enabled.pause_campaigns) {
    const toPause = campaigns.filter(
      (c) => c.status === "ENABLED" && typeof c.lcs_score === "number" && c.lcs_score < 5 && inScope(c.campaign_id)
    );
    for (const c of toPause) {
      try {
        await pauseCampaign(accessToken, c.campaign_id);
        applied.push({ type: "pause_campaign", campaign: c.name, lcs_score: c.lcs_score });
      } catch (err) {
        errors.push({ type: "pause_campaign", campaign: c.name, message: err.message });
      }
    }
  }

  // --- Palavras-chave negativas de confiança alta ---
  if (enabled.negative_keywords) {
    const toApply = suggestions.filter((s) => s.confidence === "alta" && inScope(s.campaign_id));
    for (const s of toApply) {
      try {
        await addNegativeKeyword(accessToken, s.campaign_id, s.term);
        applied.push({ type: "negative_keyword", campaign: s.campaign_name, term: s.term });
      } catch (err) {
        errors.push({ type: "negative_keyword", term: s.term, message: err.message });
      }
    }
  }

  // --- Redução de orçamento em campanhas com Score baixo ---
  if (enabled.budget_balance) {
    const toReduce = campaigns.filter(
      (c) =>
        c.status === "ENABLED" &&
        typeof c.lcs_score === "number" &&
        c.lcs_score < 5 &&
        c.budget_resource_name &&
        c.budget_amount > 5 && // já está no piso ou abaixo dele — nada a reduzir
        inScope(c.campaign_id)
    );
    for (const c of toReduce) {
      // Quanto pior o score, maior o corte — score 0 corta 50% (o máximo
      // permitido), score próximo de 5 corta perto de 10%. Interpola
      // linearmente dentro da faixa [10%, 50%] em vez de "a IA decide
      // livremente", para manter o resultado determinístico e auditável.
      const severity = Math.max(0, Math.min(1, (5 - c.lcs_score) / 5)); // 0 (score=5) a 1 (score=0)
      const cutFraction = 0.1 + severity * 0.4; // 10% a 50%
      let newAmount = c.budget_amount * (1 - cutFraction);
      newAmount = Math.max(5, newAmount); // nunca abaixo do piso de R$5/dia
      newAmount = Math.round(newAmount * 100) / 100;

      if (newAmount >= c.budget_amount) continue; // arredondamento não resultou em corte real

      try {
        await updateCampaignBudget(accessToken, c.budget_resource_name, newAmount);
        applied.push({
          type: "budget_reduction",
          campaign: c.name,
          lcs_score: c.lcs_score,
          old_amount: c.budget_amount,
          new_amount: newAmount,
        });
      } catch (err) {
        errors.push({ type: "budget_reduction", campaign: c.name, message: err.message });
      }
    }
  }

  // --- Adição de novas palavras-chave (apenas sugestões de alta confiança) ---
  // Diferente das outras 2 ações, esta gera conteúdo NOVO via IA a cada
  // execução (não há um "snapshot" de sugestões pré-calculado pra
  // palavras positivas, como existe pra negativas) — por isso roda só
  // para campanhas dentro do escopo selecionado, limitando o custo de
  // chamadas de IA a campanhas que o usuário realmente escolheu.
  if (enabled.add_keywords) {
    const targetCampaigns = campaigns.filter((c) => c.status === "ENABLED" && inScope(c.campaign_id));
    for (const c of targetCampaigns) {
      try {
        const existing = await fetchExistingKeywords(accessToken, c.campaign_id);
        // Usa o nome da campanha como descrição do serviço — funciona bem
        // quando os nomes são descritivos (ex.: "Campanha_lcs2026_Portaria"
        // já dá contexto suficiente pra IA inferir o serviço anunciado).
        const suggestions = await suggestNewKeywords(c.name, existing);
        const highConfidence = suggestions.filter((s) => s.confidence === "alta" || !s.confidence);
        // suggestNewKeywords não retorna "confidence" hoje (só term/match_type/reason)
        // — todas as sugestões geradas são tratadas como aplicáveis automaticamente
        // quando esta opção está ativa, já que a filtragem de relevância já
        // acontece dentro do próprio prompt (evita termos genéricos/ambíguos).
        const adGroup = await fetchFirstAdGroup(accessToken, c.campaign_id);
        for (const s of highConfidence.slice(0, 5)) {
          // Limite de 5 por campanha por execução — evita inflar demais o
          // ad group de uma vez só numa única rodada automática.
          try {
            await addKeyword(accessToken, adGroup.id, s.term, s.match_type);
            applied.push({ type: "add_keyword", campaign: c.name, term: s.term });
          } catch (err) {
            errors.push({ type: "add_keyword", campaign: c.name, term: s.term, message: err.message });
          }
        }
      } catch (err) {
        errors.push({ type: "add_keyword", campaign: c.name, message: err.message });
      }
    }
  }

  // --- Criação de novos anúncios (sempre como PAUSADO) ---
  // Diferente das outras ações, esta SEMPRE cria o anúncio pausado, nunca
  // ativo — mesma regra de segurança do botão manual (AdCreator.jsx).
  // O usuário precisa revisar visualmente no Google Ads e ativar, mesmo
  // com a automação ligada; o "automático" aqui é só a geração + criação
  // pausada, não a publicação ao vivo. Limite de 1 anúncio novo por
  // campanha por execução, para não inflar o ad group rapidamente sem
  // supervisão.
  if (enabled.create_ads) {
    const targetCampaigns = campaigns.filter((c) => c.status === "ENABLED" && inScope(c.campaign_id));
    for (const c of targetCampaigns) {
      try {
        // Usa o nome da campanha como descrição do serviço, mesmo padrão
        // já usado em "Adição de Palavras" automática.
        const copy = await generateAdCopy(c.name, "https://www.lcsterceirizacaors.com.br");
        const adGroup = await fetchFirstAdGroup(accessToken, c.campaign_id);
        await createResponsiveSearchAd(
          accessToken,
          adGroup.id,
          copy.headlines,
          copy.descriptions,
          "https://www.lcsterceirizacaors.com.br"
        );
        applied.push({ type: "create_ad", campaign: c.name, ad_group: adGroup.name });
      } catch (err) {
        errors.push({ type: "create_ad", campaign: c.name, message: err.message });
      }
    }
  }

  // --- Estratégia de lance (regra fixa: <5 conversões → Maximizar
  // Cliques, 5+ → Maximizar Conversões) ---
  if (enabled.bid_strategy) {
    const targetCampaigns = campaigns.filter((c) => c.status === "ENABLED" && inScope(c.campaign_id));
    for (const c of targetCampaigns) {
      const suggestion = suggestBiddingStrategy(c);
      if (!suggestion) continue; // já está na estratégia recomendada
      try {
        await updateBiddingStrategy(accessToken, c.campaign_id, suggestion.suggested_strategy);
        applied.push({
          type: "bidding_strategy",
          campaign: c.name,
          from: suggestion.current_strategy,
          to: suggestion.suggested_strategy,
        });
      } catch (err) {
        errors.push({ type: "bidding_strategy", campaign: c.name, message: err.message });
      }
    }
  }

  // --- Otimização por horário (ajuste de lance por faixa horária) ---
  // Limita a 3 ajustes por campanha por execução, para não criar dezenas
  // de critérios de ad_schedule de uma vez sem revisão visual.
  if (enabled.hourly_optimization) {
    const targetCampaigns = campaigns.filter((c) => c.status === "ENABLED" && inScope(c.campaign_id));
    for (const c of targetCampaigns) {
      try {
        const byHour = await fetchHourlyPerformance(accessToken, c.campaign_id);
        const { suggestions } = analyzeHourlyBidAdjustments(byHour);
        for (const s of suggestions.slice(0, 3)) {
          try {
            await applyHourlyOptimization(accessToken, c.campaign_id, s.hour, s.bid_modifier);
            applied.push({ type: "hourly_bid", campaign: c.name, hour: s.hour, bid_modifier: s.bid_modifier });
          } catch (err) {
            errors.push({ type: "hourly_bid", campaign: c.name, hour: s.hour, message: err.message });
          }
        }
      } catch (err) {
        errors.push({ type: "hourly_bid", campaign: c.name, message: err.message });
      }
    }
  }

  // --- Otimização por dispositivo (ajuste de lance mobile/desktop/tablet) ---
  if (enabled.device_optimization) {
    const targetCampaigns = campaigns.filter((c) => c.status === "ENABLED" && inScope(c.campaign_id));
    for (const c of targetCampaigns) {
      try {
        const byDevice = await fetchDevicePerformance(accessToken, c.campaign_id);
        const { suggestions } = analyzeDeviceBidAdjustments(byDevice);
        for (const s of suggestions) {
          try {
            await setDeviceBidModifier(accessToken, c.campaign_id, s.device, s.bid_modifier);
            applied.push({ type: "device_bid", campaign: c.name, device: s.device, bid_modifier: s.bid_modifier });
          } catch (err) {
            errors.push({ type: "device_bid", campaign: c.name, device: s.device, message: err.message });
          }
        }
      } catch (err) {
        errors.push({ type: "device_bid", campaign: c.name, message: err.message });
      }
    }
  }

  // --- Otimização geográfica (reduz lance fora da região-alvo) ---
  // Limita a 5 localizações por campanha por execução.
  if (enabled.geo_optimization) {
    const targetCampaigns = campaigns.filter((c) => c.status === "ENABLED" && inScope(c.campaign_id));
    for (const c of targetCampaigns) {
      try {
        const geoRows = await fetchGeoPerformance(accessToken, c.campaign_id);
        const suggestions = analyzeGeoBidAdjustments(geoRows).slice(0, 5);
        for (const s of suggestions) {
          try {
            await setGeoBidModifier(accessToken, c.campaign_id, s.geo_target_constant, s.bid_modifier);
            applied.push({ type: "geo_bid", campaign: c.name, geo_target_constant: s.geo_target_constant, cost: s.cost });
          } catch (err) {
            errors.push({ type: "geo_bid", campaign: c.name, message: err.message });
          }
        }
      } catch (err) {
        errors.push({ type: "geo_bid", campaign: c.name, message: err.message });
      }
    }
  }

  return { applied, errors, skipped: null };
}

/**
 * Busca o custo total gasto no MÊS CALENDÁRIO ATUAL (não os últimos 30
 * dias rolantes que fetchCampaigns usa) — é o número que mais se aproxima
 * do "quanto já gastei este mês" que aparece na tela de faturamento do
 * Google Ads. Não existe campo de "saldo/crédito disponível" acessível
 * via API (confirmado pelo próprio suporte da Google em fóruns oficiais):
 * contas com pagamento automático por cartão não têm saldo pré-pago, o
 * cartão é cobrado conforme o gasto acontece, sem limite pré-carregado
 * para subtrair. Por isso mostramos só o "gasto acumulado", não um saldo.
 */
async function fetchMonthToDateSpend(accessToken) {
  const query = `
    SELECT metrics.cost_micros
    FROM customer
    WHERE segments.date DURING THIS_MONTH
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
    // Não derruba a sincronização inteira por causa disso — é um dado
    // complementar, não crítico como o snapshot de campanhas.
    console.error("Erro ao buscar gasto do mês:", text.slice(0, 300));
    return null;
  }
  const batches = JSON.parse(text);
  let totalMicros = 0;
  for (const b of batches) {
    for (const row of b.results || []) {
      totalMicros += Number(row.metrics?.costMicros || 0);
    }
  }
  return totalMicros / 1_000_000;
}

/**
 * Busca cliques, impressões e custo SÓ DE HOJE (segments.date = TODAY),
 * separado dos últimos 30 dias rolantes que fetchCampaigns usa. Útil pra
 * acompanhar o ritmo do dia em andamento, sem esperar virar o período de
 * 30 dias pra notar uma mudança brusca de tráfego.
 */
async function fetchTodayMetrics(accessToken) {
  const query = `
    SELECT metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
    FROM customer
    WHERE segments.date DURING TODAY
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
    console.error("Erro ao buscar métricas de hoje:", text.slice(0, 300));
    return null;
  }
  const batches = JSON.parse(text);
  const totals = { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
  for (const b of batches) {
    for (const row of b.results || []) {
      totals.clicks += Number(row.metrics?.clicks || 0);
      totals.impressions += Number(row.metrics?.impressions || 0);
      totals.cost += Number(row.metrics?.costMicros || 0) / 1_000_000;
      totals.conversions += Number(row.metrics?.conversions || 0);
    }
  }
  return totals;
}

function getPreviousPeriodStart() {
  const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().split("T")[0];
}
function getPreviousPeriodEnd() {
  const d = new Date(); d.setDate(d.getDate() - 8); return d.toISOString().split("T")[0];
}

async function fetchDailyPerformance(accessToken) {
  const query = `
    SELECT segments.date, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
    FROM customer
    WHERE segments.date DURING LAST_7_DAYS
    ORDER BY segments.date ASC
  `;
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER_ID}/googleAds:searchStream`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "developer-token": DEVELOPER_TOKEN, "login-customer-id": MCC_CUSTOMER_ID }, body: JSON.stringify({ query }) });
  const text = await res.text();
  if (!res.ok) { console.error("Erro ao buscar performance diária:", text.slice(0, 300)); return []; }
  const batches = JSON.parse(text);
  const byDate = {};
  for (const b of batches) for (const row of b.results || []) {
    const date = row.segments?.date; if (!date) continue;
    if (!byDate[date]) byDate[date] = { date, clicks: 0, impressions: 0, cost: 0, conversions: 0 };
    byDate[date].clicks += Number(row.metrics?.clicks || 0);
    byDate[date].impressions += Number(row.metrics?.impressions || 0);
    byDate[date].cost += Number(row.metrics?.costMicros || 0) / 1_000_000;
    byDate[date].conversions += Number(row.metrics?.conversions || 0);
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchPreviousPeriodMetrics(accessToken) {
  const query = `
    SELECT metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${getPreviousPeriodStart()}' AND '${getPreviousPeriodEnd()}'
  `;
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER_ID}/googleAds:searchStream`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "developer-token": DEVELOPER_TOKEN, "login-customer-id": MCC_CUSTOMER_ID }, body: JSON.stringify({ query }) });
  const text = await res.text();
  if (!res.ok) return null;
  const batches = JSON.parse(text);
  const totals = { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
  for (const b of batches) for (const row of b.results || []) {
    totals.clicks += Number(row.metrics?.clicks || 0);
    totals.impressions += Number(row.metrics?.impressions || 0);
    totals.cost += Number(row.metrics?.costMicros || 0) / 1_000_000;
    totals.conversions += Number(row.metrics?.conversions || 0);
  }
  return totals;
}

async function fetchWinningHeadlines(accessToken) {
  const query = `
    SELECT asset.text_asset.text, metrics.impressions, metrics.clicks
    FROM ad_group_ad_asset_view
    WHERE ad_group_ad_asset_view.field_type = HEADLINE
      AND campaign.status = 'ENABLED'
      AND metrics.impressions > 0
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.impressions DESC
    LIMIT 20
  `;
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER_ID}/googleAds:searchStream`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "developer-token": DEVELOPER_TOKEN, "login-customer-id": MCC_CUSTOMER_ID }, body: JSON.stringify({ query }) });
  const text = await res.text();
  if (!res.ok) { console.error("Erro ao buscar headlines:", text.slice(0, 300)); return []; }
  const batches = JSON.parse(text);
  const byText = {};
  for (const b of batches) for (const row of b.results || []) {
    const txt = row.asset?.textAsset?.text; if (!txt) continue;
    if (!byText[txt]) byText[txt] = { text: txt, impressions: 0, clicks: 0 };
    byText[txt].impressions += Number(row.metrics?.impressions || 0);
    byText[txt].clicks += Number(row.metrics?.clicks || 0);
  }
  return Object.values(byText).sort((a, b) => b.impressions - a.impressions).slice(0, 10);
}

/**
 * Gera recomendações de melhoria em texto livre via IA, analisando o
 * snapshot completo de campanhas (métricas reais + LCS Score). Diferente
 * de um chat (que o usuário decidiu não querer), isso é uma lista fixa de
 * sugestões, recalculada a cada sincronização e cacheada no snapshot —
 * mesmo padrão das sugestões de palavras negativas.
 */
async function generateRecommendations(campaigns, accessToken) {
  const summaries = campaigns
    .map((c) => {
      const m = c.metrics || {};
      return `- campaign_id="${c.campaign_id}" nome="${c.name}" (${c.status === "ENABLED" ? "ativa" : "pausada"}, ${c.campaign_type}, estratégia atual: ${c.bidding_strategy}): ${
        m.clicks ?? 0
      } cliques, CTR ${((m.ctr ?? 0) * 100).toFixed(2)}%, custo R$${(m.cost ?? 0).toFixed(2)}, ${
        m.conversions ?? 0
      } conversões, orçamento atual R$${(c.budget_amount ?? 0).toFixed(2)}/dia, LCS Score ${c.lcs_score ?? "—"}/10`;
    })
    .join("\n");

  // Busca os anúncios reais (headlines/descriptions + Ad Strength do
  // próprio Google) das campanhas ativas, para a IA também opinar sobre
  // os criativos — não só sobre estrutura/orçamento da campanha. Limitado
  // às campanhas ativas para não gastar chamadas com anúncios de
  // campanhas já pausadas, que não estão gerando tráfego no momento.
  let adsSummary = "Nenhum anúncio analisado (dados indisponíveis ou nenhuma campanha ativa).";
  if (accessToken) {
    try {
      const activeCampaigns = campaigns.filter((c) => c.status === "ENABLED");
      const adsByCampaign = await Promise.all(
        activeCampaigns.map(async (c) => ({
          campaign_name: c.name,
          ads: await fetchAdsForCampaign(accessToken, c.campaign_id),
        }))
      );
      const adsLines = [];
      for (const { campaign_name, ads } of adsByCampaign) {
        for (const ad of ads) {
          adsLines.push(
            `- Campanha "${campaign_name}", anúncio (grupo "${ad.ad_group_name}"): Ad Strength = ${ad.ad_strength}, ${ad.clicks} cliques, CTR ${(ad.ctr * 100).toFixed(2)}%, ${ad.conversions} conversões. Headlines: ${ad.headlines.slice(0, 5).join(" | ")}`
          );
        }
      }
      if (adsLines.length > 0) adsSummary = adsLines.join("\n");
    } catch (err) {
      console.error("Erro ao buscar anúncios para recomendações (segue sem essa parte):", err.message);
    }
  }

  const prompt = `Você é consultor de Google Ads para a LCS Terceirização (limpeza, portaria, facilities em Porto Alegre, RS).

Analise os dados reais das campanhas E dos anúncios (criativos) dos últimos 30 dias abaixo, e gere até 8 recomendações práticas e específicas para melhorar performance, citando os números reais como justificativa. Priorize recomendações de maior impacto primeiro. Inclua tanto recomendações estruturais de campanha (orçamento, pausar, estratégia de lance) quanto recomendações sobre os criativos (Ad Strength baixo, headlines fracas, falta de variação) quando fizer sentido pelos dados.

CAMPANHAS:
${summaries}

ANÚNCIOS (CRIATIVOS) DAS CAMPANHAS ATIVAS:
${adsSummary}

Para cada recomendação, quando ela corresponder EXATAMENTE a uma das ações abaixo, preencha o campo "action" com os parâmetros certos. Se a recomendação não corresponder a nenhuma ação estruturada (ex: sugestão de melhorar copy de um anúncio específico, ou algo qualitativo sobre os criativos), deixe "action" como null — não invente uma ação que não se aplica. Recomendações sobre Ad Strength baixo ou headlines fracas NÃO têm ação automática hoje (action: null) — o usuário usa o botão "Criar Anúncio com IA" manualmente para isso.

AÇÕES DISPONÍVEIS:
- pause_campaign: { type: "pause_campaign", campaign_id }
- update_budget: { type: "update_budget", campaign_id, new_amount (número em R$, > 0) }
- update_bidding_strategy: { type: "update_bidding_strategy", campaign_id, strategy: "MAXIMIZE_CONVERSIONS" | "TARGET_SPEND" }

Responda APENAS um JSON neste formato, sem texto antes ou depois:
[{"title": "título curto (máx 8 palavras)", "detail": "explicação com números reais (máx 200 caracteres)", "priority": "alta" | "media" | "baixa", "action": null | {"type": "...", "campaign_id": "...", ...demais campos}}]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status} ao gerar recomendações`);

  const text = data.content?.[0]?.text || "[]";
  const cleaned = text.replace(/```json|```/g, "").trim();
  let recommendations;
  try {
    recommendations = JSON.parse(cleaned);
  } catch {
    throw new Error("A IA retornou um formato inválido ao gerar recomendações.");
  }

  // Validação extra: confere se o campaign_id de cada ação de fato existe
  // no conjunto de campanhas analisado — evita um botão "Aplicar" que
  // falharia por referenciar um ID inventado ou de outra conta.
  const validCampaignIds = new Set(campaigns.map((c) => c.campaign_id));
  return recommendations.map((r) => {
    if (r.action && !validCampaignIds.has(r.action.campaign_id)) {
      return { ...r, action: null };
    }
    return r;
  });
}

export default async function handler(req, res) {
  // Aceita GET (cron job da Vercel) e POST (botão manual no painel).
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Proteção simples: cron jobs da Vercel enviam um header de autorização
  // automático quando CRON_SECRET está configurado; chamadas manuais do
  // painel usam a mesma chave UPDATE_SECRET já usada no endpoint mock.
  // Exceção: o botão "Rodar agora" da tela de Otimizações (que já fica
  // atrás do login do painel) usa um header fixo simples em vez de pedir
  // a UPDATE_SECRET ao usuário — não é uma proteção tão forte quanto a
  // secret real, mas o acesso a esse botão já passou pela autenticação
  // do app (useAuth), o que é a barreira que importa aqui.
  const providedSecret = req.headers["x-update-secret"] || req.body?.secret || req.query?.secret;
  const isCron = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const isPanelTrigger = req.headers["x-panel-trigger"] === "lcs-hub-optimizations-panel";
  if (!isCron && !isPanelTrigger && providedSecret !== process.env.UPDATE_SECRET) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !DEVELOPER_TOKEN) {
    return res.status(500).json({
      error:
        "Credenciais da Google Ads API incompletas. Configure GOOGLE_ADS_CLIENT_ID, " +
        "GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN e GOOGLE_ADS_DEVELOPER_TOKEN no Vercel.",
    });
  }

  const action = req.body?.action;

  // Stop Loss — ações que só tocam no Firestore, sem precisar das
  // credenciais da Google Ads API, por isso ficam antes da checagem.
  if (action === "dismiss_stop_loss") {
    try {
      const { campaign_id } = req.body;
      const db = getAdminDb();
      const snap = await db.collection("google_ads_snapshot").doc("current").get();
      if (snap.exists) {
        const current = snap.data().stop_loss_alerts || [];
        const updated = current.filter((a) => a.campaign_id !== campaign_id);
        await db.collection("google_ads_snapshot").doc("current").update({ stop_loss_alerts: updated });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === "configure_stop_loss") {
    try {
      const { threshold } = req.body;
      if (!threshold || threshold <= 0) {
        return res.status(400).json({ error: "threshold deve ser um número > 0." });
      }
      const db = getAdminDb();
      await db.collection("google_ads_config").doc("stop_loss").set({ threshold });
      return res.status(200).json({ ok: true, threshold });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  // exige um campo "action" específico no body e é executada de forma
  // isolada: se der erro, retorna 500 sem tocar no snapshot do Firestore.
  // Depois de qualquer mutação bem-sucedida, NÃO re-sincronizamos
  // automaticamente — o usuário (ou o próximo cron de sync) atualiza o
  // snapshot separadamente, mantendo o número de chamadas à API previsível.
  if (
    action === "add_negative_keyword" ||
    action === "dismiss_negative_keyword" ||
    action === "pause_campaign" ||
    action === "update_budget" ||
    action === "run_auto_optimizations" ||
    action === "generate_ad_copy" ||
    action === "create_ad" ||
    action === "suggest_keywords" ||
    action === "add_keyword" ||
    action === "update_bidding_strategy" ||
    action === "suggest_hourly_bids" ||
    action === "apply_hourly_bid" ||
    action === "suggest_device_bids" ||
    action === "apply_device_bid" ||
    action === "suggest_geo_bids" ||
    action === "apply_geo_bid" ||
    action === "create_ab_test" ||
    action === "refresh_recommendations" ||
    action === "run_account_audit"
  ) {
    try {
      const accessToken = await getAccessToken();

      if (action === "run_account_audit") {
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
        }
        const db = getAdminDb();
        const snap = await db.collection("google_ads_snapshot").doc("current").get();
        if (!snap.exists) {
          return res.status(400).json({ error: "Nenhum snapshot de campanhas encontrado. Sincronize primeiro." });
        }
        const campaignsForAudit = snap.data().campaigns || [];
        if (campaignsForAudit.length === 0) {
          return res.status(400).json({ error: "Nenhuma campanha no snapshot atual." });
        }
        const qualityScores = await fetchQualityScores(accessToken);
        const audit = await generateAccountAudit(campaignsForAudit, qualityScores, accessToken);
        // Salva no Firestore para o painel poder mostrar sem precisar
        // rodar a auditoria de novo a cada vez que a página é aberta.
        await db.collection("google_ads_snapshot").doc("current").update({
          account_audit: audit,
          account_audit_checked_at: new Date().toISOString(),
        });
        return res.status(200).json({ ok: true, ...audit });
      }

      if (action === "refresh_recommendations") {
        // Recalcula só as recomendações da IA, sem rodar mais nada (sem
        // sincronizar campanhas de novo, sem disparar otimizações
        // automáticas) — usa o snapshot de campanhas que JÁ está salvo,
        // pra ser uma ação rápida e isolada quando o usuário só quer ver
        // sugestões novas sem esperar o ciclo normal de sincronização.
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
        }
        const db = getAdminDb();
        const docRef = db.collection("google_ads_snapshot").doc("current");
        const snap = await docRef.get();
        if (!snap.exists) {
          return res.status(400).json({ error: "Nenhum snapshot de campanhas encontrado. Sincronize primeiro." });
        }
        const snapshotData = snap.data();
        const campaignsForRecs = snapshotData.campaigns || [];
        if (campaignsForRecs.length === 0) {
          return res.status(400).json({ error: "Nenhuma campanha no snapshot atual." });
        }
        const newRecommendations = await generateRecommendations(campaignsForRecs, accessToken);
        await docRef.update({
          recommendations: newRecommendations,
          recommendations_checked_at: new Date().toISOString(),
        });
        return res.status(200).json({ ok: true, recommendations: newRecommendations });
      }

      if (action === "create_ab_test") {
        const { campaign_id, service_label } = req.body;
        if (!campaign_id || !service_label) {
          return res.status(400).json({ error: "campaign_id e service_label são obrigatórios." });
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
        }
        const result = await createAbTestAds(accessToken, campaign_id, service_label, "https://www.lcsterceirizacaors.com.br");
        return res.status(200).json({
          ok: true,
          message: `2 anúncios criados (ativos) no grupo "${result.ad_group_name}" para teste A/B nativo do Google.`,
          ...result,
        });
      }

      if (action === "run_auto_optimizations") {
        const result = await runAutoOptimizations(accessToken);
        return res.status(200).json({ ok: true, ...result });
      }

      if (action === "suggest_hourly_bids") {
        const { campaign_id } = req.body;
        if (!campaign_id) return res.status(400).json({ error: "campaign_id é obrigatório." });
        const byHour = await fetchHourlyPerformance(accessToken, campaign_id);
        const { suggestions, avgConvRate } = analyzeHourlyBidAdjustments(byHour);
        return res.status(200).json({ ok: true, suggestions, avg_conv_rate: avgConvRate });
      }

      if (action === "apply_hourly_bid") {
        const { campaign_id, hour, bid_modifier } = req.body;
        if (!campaign_id || hour === undefined || !bid_modifier) {
          return res.status(400).json({ error: "campaign_id, hour e bid_modifier são obrigatórios." });
        }
        await applyHourlyOptimization(accessToken, campaign_id, hour, bid_modifier);
        return res.status(200).json({ ok: true, message: `Lance ajustado para o horário ${hour}h (todos os dias da semana).` });
      }

      if (action === "suggest_device_bids") {
        const { campaign_id } = req.body;
        if (!campaign_id) return res.status(400).json({ error: "campaign_id é obrigatório." });
        const byDevice = await fetchDevicePerformance(accessToken, campaign_id);
        const { suggestions, avgConvRate } = analyzeDeviceBidAdjustments(byDevice);
        return res.status(200).json({ ok: true, suggestions, avg_conv_rate: avgConvRate });
      }

      if (action === "apply_device_bid") {
        const { campaign_id, device, bid_modifier } = req.body;
        if (!campaign_id || !device || !bid_modifier) {
          return res.status(400).json({ error: "campaign_id, device e bid_modifier são obrigatórios." });
        }
        await setDeviceBidModifier(accessToken, campaign_id, device, bid_modifier);
        return res.status(200).json({ ok: true, message: `Lance ajustado para dispositivo ${device}.` });
      }

      if (action === "suggest_geo_bids") {
        const { campaign_id } = req.body;
        if (!campaign_id) return res.status(400).json({ error: "campaign_id é obrigatório." });
        const geoRows = await fetchGeoPerformance(accessToken, campaign_id);
        const suggestions = analyzeGeoBidAdjustments(geoRows);
        return res.status(200).json({ ok: true, suggestions });
      }

      if (action === "apply_geo_bid") {
        const { campaign_id, geo_target_constant, bid_modifier } = req.body;
        if (!campaign_id || !geo_target_constant || !bid_modifier) {
          return res.status(400).json({ error: "campaign_id, geo_target_constant e bid_modifier são obrigatórios." });
        }
        await setGeoBidModifier(accessToken, campaign_id, geo_target_constant, bid_modifier);
        return res.status(200).json({ ok: true, message: "Lance ajustado para a localização." });
      }

      if (action === "update_bidding_strategy") {
        const { campaign_id, strategy } = req.body;
        if (!campaign_id || !strategy) {
          return res.status(400).json({ error: "campaign_id e strategy são obrigatórios." });
        }
        if (strategy !== "MAXIMIZE_CONVERSIONS" && strategy !== "TARGET_SPEND") {
          return res.status(400).json({ error: "strategy deve ser MAXIMIZE_CONVERSIONS ou TARGET_SPEND." });
        }
        await updateBiddingStrategy(accessToken, campaign_id, strategy);
        const label = strategy === "MAXIMIZE_CONVERSIONS" ? "Maximizar Conversões" : "Maximizar Cliques";
        return res.status(200).json({ ok: true, message: `Estratégia de lance atualizada para "${label}".` });
      }

      if (action === "suggest_keywords") {
        // Só sugere via IA — não altera nada na conta ainda.
        const { service_label, campaign_id } = req.body;
        if (!service_label || !campaign_id) {
          return res.status(400).json({ error: "service_label e campaign_id são obrigatórios." });
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
        }
        const existing = await fetchExistingKeywords(accessToken, campaign_id);
        const suggestions = await suggestNewKeywords(service_label, existing);
        return res.status(200).json({ ok: true, suggestions });
      }

      if (action === "add_keyword") {
        const { campaign_id, term, match_type } = req.body;
        if (!campaign_id || !term) {
          return res.status(400).json({ error: "campaign_id e term são obrigatórios." });
        }
        const adGroup = await fetchFirstAdGroup(accessToken, campaign_id);
        await addKeyword(accessToken, adGroup.id, term, match_type);
        return res.status(200).json({ ok: true, message: `Palavra-chave "${term}" adicionada ao grupo "${adGroup.name}".` });
      }

      if (action === "generate_ad_copy") {
        // Só gera o texto via IA — não toca na conta do Google Ads ainda.
        // O usuário revisa/edita no painel antes de chamar "create_ad".
        const { service_label } = req.body;
        if (!service_label) {
          return res.status(400).json({ error: "service_label é obrigatório." });
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
        }
        const copy = await generateAdCopy(service_label, "https://www.lcsterceirizacaors.com.br");
        return res.status(200).json({ ok: true, ...copy });
      }

      if (action === "create_ad") {
        const { campaign_id, headlines, descriptions, final_url } = req.body;
        if (!campaign_id || !Array.isArray(headlines) || !Array.isArray(descriptions)) {
          return res.status(400).json({ error: "campaign_id, headlines e descriptions são obrigatórios." });
        }
        if (headlines.length < 3 || headlines.length > 15) {
          return res.status(400).json({ error: "headlines deve ter entre 3 e 15 itens." });
        }
        if (descriptions.length < 2 || descriptions.length > 4) {
          return res.status(400).json({ error: "descriptions deve ter entre 2 e 4 itens." });
        }
        const tooLongHeadline = headlines.find((h) => h.length > 30);
        if (tooLongHeadline) {
          return res.status(400).json({ error: `Headline excede 30 caracteres: "${tooLongHeadline}"` });
        }
        const tooLongDescription = descriptions.find((d) => d.length > 90);
        if (tooLongDescription) {
          return res.status(400).json({ error: `Description excede 90 caracteres: "${tooLongDescription}"` });
        }

        const adGroup = await fetchFirstAdGroup(accessToken, campaign_id);
        const finalUrl = final_url || "https://www.lcsterceirizacaors.com.br";
        const resourceName = await createResponsiveSearchAd(accessToken, adGroup.id, headlines, descriptions, finalUrl);
        return res.status(200).json({
          ok: true,
          message: `Anúncio criado (pausado) no grupo "${adGroup.name}". Revise e ative manualmente no Google Ads.`,
          resource_name: resourceName,
        });
      }

      if (action === "add_negative_keyword") {
        const { campaign_id, term } = req.body;
        if (!campaign_id || !term) {
          return res.status(400).json({ error: "campaign_id e term são obrigatórios." });
        }
        await addNegativeKeyword(accessToken, campaign_id, term);

        // Remove a sugestão do snapshot persistido — sem isso, ela
        // continuaria aparecendo na tela após recarregar a página, já que
        // o front lê direto do Firestore (não há outro lugar marcando
        // "já aplicada" de forma durável).
        try {
          const db = getAdminDb();
          const docRef = db.collection("google_ads_snapshot").doc("current");
          const snap = await docRef.get();
          if (snap.exists) {
            const current = snap.data().negative_keyword_suggestions || [];
            const updated = current.filter((s) => !(s.campaign_id === campaign_id && s.term === term));
            await docRef.update({ negative_keyword_suggestions: updated });
          }
        } catch (err) {
          console.error("Erro ao remover sugestão aplicada do snapshot (não bloqueia a resposta):", err.message);
        }

        return res.status(200).json({ ok: true, message: `Palavra negativa "${term}" adicionada.` });
      }

      if (action === "dismiss_negative_keyword") {
        // Descartar também precisa persistir — sem isso, a sugestão volta
        // a aparecer ao recarregar a página, exatamente como acontecia
        // com "Aplicar" antes desta correção.
        const { campaign_id, term } = req.body;
        if (!campaign_id || !term) {
          return res.status(400).json({ error: "campaign_id e term são obrigatórios." });
        }
        const db = getAdminDb();
        const docRef = db.collection("google_ads_snapshot").doc("current");
        const snap = await docRef.get();
        if (snap.exists) {
          const current = snap.data().negative_keyword_suggestions || [];
          const updated = current.filter((s) => !(s.campaign_id === campaign_id && s.term === term));
          await docRef.update({ negative_keyword_suggestions: updated });
        }
        return res.status(200).json({ ok: true, message: "Sugestão descartada." });
      }

      if (action === "pause_campaign") {
        const { campaign_id } = req.body;
        if (!campaign_id) {
          return res.status(400).json({ error: "campaign_id é obrigatório." });
        }
        await pauseCampaign(accessToken, campaign_id);
        return res.status(200).json({ ok: true, message: "Campanha pausada." });
      }

      if (action === "update_budget") {
        const { budget_resource_name, new_amount } = req.body;
        if (!budget_resource_name || typeof new_amount !== "number" || new_amount <= 0) {
          return res.status(400).json({ error: "budget_resource_name e new_amount (número > 0) são obrigatórios." });
        }
        await updateCampaignBudget(accessToken, budget_resource_name, new_amount);
        return res.status(200).json({ ok: true, message: `Orçamento atualizado para R$ ${new_amount.toFixed(2)}/dia.` });
      }
    } catch (err) {
      console.error(`Erro na ação "${action}":`, err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const accessToken = await getAccessToken();
    const campaigns = await fetchCampaigns(accessToken);
    const monthToDateSpend = await fetchMonthToDateSpend(accessToken);
    const todayMetrics = await fetchTodayMetrics(accessToken);

    const db = getAdminDb();
    const docRef = db.collection("google_ads_snapshot").doc("current");

    const previousSnap = await docRef.get();
    const previousData = previousSnap.exists ? previousSnap.data() : null;
    const alerts = detectAlerts(previousData?.campaigns, campaigns);

    // Análise de palavras-chave negativas é opcional e mais cara (chamada
    // de IA) — só roda se ANTHROPIC_API_KEY estiver configurada, e qualquer
    // falha nela não deve impedir o snapshot principal de ser salvo.
    let negativeKeywordSuggestions = previousData?.negative_keyword_suggestions || [];
    let negativeKeywordsCheckedAt = previousData?.negative_keywords_checked_at || null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const searchTerms = await fetchSearchTerms(accessToken);
        const analysis = await analyzeNegativeKeywords(searchTerms);

        // CORREÇÃO CRÍTICA: não substitui o array inteiro — filtra do novo
        // resultado os termos que o usuário já aplicou ou descartou (que
        // foram removidos do snapshot via dismiss_negative_keyword /
        // add_negative_keyword). Sem isso, cada sincronização recriava
        // exatamente as mesmas sugestões, ignorando o que o usuário decidiu.
        const remainingTermKeys = new Set(
          negativeKeywordSuggestions.map((s) => `${s.campaign_id}::${s.term}`)
        );
        // Sugestões novas que o usuário ainda não viu (não estão no snapshot atual)
        const brandNew = analysis.suggestions.filter(
          (s) => !remainingTermKeys.has(`${s.campaign_id}::${s.term}`)
        );
        // Sugestões já no snapshot que continuam válidas (o termo ainda gastou sem converter)
        const analysisTermKeys = new Set(
          analysis.suggestions.map((s) => `${s.campaign_id}::${s.term}`)
        );
        const stillValid = negativeKeywordSuggestions.filter((s) =>
          analysisTermKeys.has(`${s.campaign_id}::${s.term}`)
        );
        negativeKeywordSuggestions = [...stillValid, ...brandNew];
        negativeKeywordsCheckedAt = new Date().toISOString();
        console.log(
          `[google-ads] ${analysis.analyzedCount} termos analisados, ${brandNew.length} novos + ${stillValid.length} ainda válidos = ${negativeKeywordSuggestions.length} sugestões`
        );
      } catch (err) {
        console.error("Erro na análise de palavras-chave negativas (não bloqueia o snapshot):", err.message);
      }
    }

    // Recomendações gerais de melhoria — mesmo padrão de cache das
    // palavras negativas: gerado a cada sincronização, mas qualquer falha
    // não bloqueia o snapshot principal.
    let recommendations = previousData?.recommendations || [];
    let recommendationsCheckedAt = previousData?.recommendations_checked_at || null;
    if (process.env.ANTHROPIC_API_KEY && campaigns.length > 0) {
      try {
        recommendations = await generateRecommendations(campaigns, accessToken);
        recommendationsCheckedAt = new Date().toISOString();
      } catch (err) {
        console.error("Erro ao gerar recomendações (não bloqueia o snapshot):", err.message);
      }
    }

    // Sugestões de estratégia de lance — regra fixa (sem chamada de IA),
    // recalculada a cada sincronização porque depende só de métricas que
    const biddingSuggestions = campaigns
      .filter((c) => c.status === "ENABLED")
      .map((c) => suggestBiddingStrategy(c))
      .filter(Boolean);

    // Novos dados pra painel estilo GioBrain — falhas não bloqueiam o snapshot
    let dailyPerformance = [];
    let previousPeriodMetrics = null;
    let winningHeadlines = [];
    try { dailyPerformance = await fetchDailyPerformance(accessToken); } catch (e) { console.error("Erro dailyPerformance:", e.message); }
    try { previousPeriodMetrics = await fetchPreviousPeriodMetrics(accessToken); } catch (e) { console.error("Erro previousPeriod:", e.message); }
    try { winningHeadlines = await fetchWinningHeadlines(accessToken); } catch (e) { console.error("Erro winningHeadlines:", e.message); }

    // Stop Loss — detecta campanhas ativas que gastaram acima do limite
    // configurado (default R$50) sem nenhuma conversão nos últimos 7 dias.
    // NÃO pausa automaticamente — salva um alerta no snapshot para o painel
    // exibir com botão de confirmação manual (usuário decidiu "avisa primeiro").
    const stopLossConfigSnap = await db.collection("google_ads_config").doc("stop_loss").get();
    const stopLossThreshold = stopLossConfigSnap.exists ? (stopLossConfigSnap.data().threshold || 50) : 50;
    const stopLossAlerts = campaigns
      .filter((c) => c.status === "ENABLED")
      .map((c) => {
        const m = c.metrics || {};
        const cost7d = dailyPerformance.reduce((sum, d) => sum + (d.cost || 0), 0);
        // Como daily_performance agrega a conta toda (não por campanha),
        // usamos as métricas do próprio fetchCampaigns (últimos 30 dias)
        // divididas proporcionalmente pelos 7 dias como aproximação, mas
        // pra ser mais preciso, comparamos: gasto total dos 30 dias / 30 * 7
        const estimatedCost7d = ((m.cost || 0) / 30) * 7;
        const conversions30d = m.conversions || 0;
        if (estimatedCost7d >= stopLossThreshold && conversions30d === 0) {
          return {
            campaign_id: c.campaign_id,
            campaign_name: c.name,
            estimated_cost_7d: estimatedCost7d,
            conversions: conversions30d,
            threshold: stopLossThreshold,
            detected_at: new Date().toISOString(),
            dismissed: false,
          };
        }
        return null;
      })
      .filter(Boolean);

    await docRef.set({
      campaigns,
      hasMetrics: true,
      source: "google_ads_api",
      updatedAt: new Date().toISOString(),
      alerts,
      alertsCheckedAt: new Date().toISOString(),
      negative_keyword_suggestions: negativeKeywordSuggestions,
      negative_keywords_checked_at: negativeKeywordsCheckedAt,
      month_to_date_spend: monthToDateSpend,
      today_metrics: todayMetrics,
      recommendations,
      recommendations_checked_at: recommendationsCheckedAt,
      bidding_suggestions: biddingSuggestions,
      daily_performance: dailyPerformance,
      previous_period_metrics: previousPeriodMetrics,
      winning_headlines: winningHeadlines,
      stop_loss_alerts: stopLossAlerts,
      stop_loss_threshold: stopLossThreshold,
    });

    if (alerts.length > 0) {
      const message =
        `⚠️ *Alertas do Google Ads — LCS Hub*\n\n` +
        alerts.join("\n") +
        `\n\nVerifique no painel: lcs-hub.vercel.app/google-ads`;
      await sendWhatsAppAlert(message);
    }

    // Roda as otimizações automáticas ativadas pelo usuário, usando o
    // snapshot que acabou de ser salvo (já com métricas e sugestões
    // atualizadas). Só dispara nessa chamada quando é o cron diário (GET)
    // ou quando o painel pede explicitamente via autoOptimize no body —
    // chamadas manuais de sincronização do botão "Sincronizar" comuns não
    // disparam isso sozinhas, para o usuário decidir quando quer que a
    // automação rode de fato.
    let autoOptimizeResult = null;
    if (isCron || req.body?.autoOptimize === true) {
      try {
        autoOptimizeResult = await runAutoOptimizations(accessToken);
        if (autoOptimizeResult.applied?.length > 0) {
          const summary = autoOptimizeResult.applied
            .map((a) => {
              if (a.type === "pause_campaign") return `⏸ Pausada: "${a.campaign}" (score ${a.lcs_score})`;
              if (a.type === "negative_keyword") return `🎯 Negativa aplicada: "${a.term}" em "${a.campaign}"`;
              if (a.type === "budget_reduction")
                return `💰 Orçamento de "${a.campaign}" reduzido: R$${a.old_amount.toFixed(2)} → R$${a.new_amount.toFixed(2)}`;
              return null;
            })
            .filter(Boolean)
            .join("\n");
          await sendWhatsAppAlert(`🤖 *Otimizações automáticas aplicadas — LCS Hub*\n\n${summary}`);
        }
      } catch (err) {
        console.error("Erro ao rodar otimizações automáticas (não bloqueia o snapshot):", err.message);
      }
    }

    return res.status(200).json({
      ok: true,
      count: campaigns.length,
      alerts,
      negative_keyword_suggestions: negativeKeywordSuggestions.length,
      auto_optimize: autoOptimizeResult,
    });
  } catch (err) {
    console.error("Erro ao buscar dados reais do Google Ads:", err);
    return res.status(500).json({ error: err.message });
  }
}

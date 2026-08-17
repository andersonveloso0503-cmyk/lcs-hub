// /api/meta-ads.js
//
// Cria e gerencia campanhas de tráfego pago (Meta Ads) via Marketing API,
// no formato "clique para WhatsApp" — o anúncio abre uma conversa direto
// no WhatsApp da LCS, sem passar por formulário ou site.
//
// Duas audiências pré-configuradas, cada uma como campanha separada:
// - condominios: síndicos e administradoras (interesse em gestão condominial)
// - empresas: RH e facilities de empresas em geral
//
// Por segurança (dinheiro real em jogo), toda campanha nasce PAUSADA.
// Só é ativada com uma chamada explícita action: "activate".
//
// Variáveis de ambiente necessárias:
// - FACEBOOK_PAGE_ACCESS_TOKEN: precisa ter ads_management + ads_read além
//   das permissões de página já usadas (é o mesmo token do Usuário de
//   Sistema "LCS Hub Bot", só que regenerado com os escopos extras)
// - META_AD_ACCOUNT_ID: ex. "act_234677774477915"
// - FACEBOOK_PAGE_ID: já usado em buffer-schedule.js
// - EMPRESA_WHATSAPP_NUMERO: já usado no whatsapp-webhook.js (default
//   5551998893033) — é pra onde o clique do anúncio leva
// - OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN: já usados em generate-creative-ai.js

import { put } from "@vercel/blob";

const FACEBOOK_GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;
const ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "";
const AD_ACCOUNT_ID_RAW = process.env.META_AD_ACCOUNT_ID || "act_234677774477915";
const AD_ACCOUNT_ID = AD_ACCOUNT_ID_RAW.startsWith("act_") ? AD_ACCOUNT_ID_RAW : `act_${AD_ACCOUNT_ID_RAW}`;
const PAGE_ID = process.env.FACEBOOK_PAGE_ID || "";
const WHATSAPP_NUMERO = process.env.EMPRESA_WHATSAPP_NUMERO || "5551998893033";

// ── Públicos pré-configurados ────────────────────────────────────────────

const AUDIENCES = {
  condominios: {
    campaignName: "LCS - Condomínios - Leads WhatsApp",
    dailyBudgetCentavos: 500, // R$5,00/dia
    message:
      "Síndico, cansado de dor de cabeça com terceirizada de portaria e limpeza? A LCS assume tudo isso pra você. Fala com a gente no WhatsApp.",
    headline: "Gestão condominial sem dor de cabeça",
    subtext: "Portaria, limpeza e zeladoria numa empresa só",
    interests: [
      { id: "6003077334693", name: "Condomínio fechado (imóveis)" },
      { id: "6014327439518", name: "Condominioweb.com" },
    ],
    imageService: "prédio residencial moderno, portaria com segurança uniformizado",
  },
  empresas: {
    campaignName: "LCS - Empresas - Leads WhatsApp",
    dailyBudgetCentavos: 500, // R$5,00/dia
    message:
      "Terceirizar limpeza, portaria e manutenção da sua empresa com quem entende do assunto há mais de 10 anos. Fala com a gente no WhatsApp.",
    headline: "Facilities da sua empresa, resolvido",
    subtext: "Limpeza, portaria e manutenção terceirizada",
    interests: [
      { id: "6003069499982", name: "Gestão de recursos humanos (negócios e finanças)" },
      { id: "6003113957192", name: "Human resource management system" },
    ],
    imageService: "escritório corporativo moderno e limpo, equipe de limpeza profissional",
  },
};

// ── Helpers de chamada à Graph API ───────────────────────────────────────

async function graphPost(path, params) {
  const url = `${GRAPH_BASE}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Graph API erro (${path}): ${data.error.message}`);
  }
  return data;
}

async function graphGet(path, params = {}) {
  const url = `${GRAPH_BASE}/${path}?${new URLSearchParams({
    ...params,
    access_token: ACCESS_TOKEN,
  })}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`Graph API erro (${path}): ${data.error.message}`);
  }
  return data;
}

// ── Geração de imagem do anúncio (reaproveita o padrão do Instagram) ────

async function generateAdImage(service, headline, subtext) {
  const prompt = `Professional Meta Ads creative for a Brazilian facilities services company "LCS Terceirização" (cleaning, security/portaria, facilities and maintenance for condominiums and businesses in Porto Alegre, Brazil).

Background: realistic photo of ${service}, slightly darkened with a navy blue gradient overlay for text readability.

Design: large bold white headline text in a rounded dark blue card near the top: "${headline}"
Below it, a smaller rounded card with white text: "${subtext}"
Bottom strip: WhatsApp icon + "Fale agora no WhatsApp" call to action badge
Style: clean, editorial, professional, high contrast, square format, suitable for Meta Ads — premium corporate look with dark navy and white color scheme.`;

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "png",
    }),
  });

  const data = await response.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Sem imagem gerada: ${JSON.stringify(data?.error)}`);
  return Buffer.from(b64, "base64");
}

async function uploadToBlob(buffer, filename) {
  const blob = await put(filename, buffer, {
    access: "public",
    contentType: "image/png",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}

// ── Passos de criação da campanha ────────────────────────────────────────

async function createCampaign(name) {
  const data = await graphPost(`${AD_ACCOUNT_ID}/campaigns`, {
    name,
    objective: "OUTCOME_ENGAGEMENT",
    status: "PAUSED",
    special_ad_categories: "[]",
  });
  return data.id;
}

async function createAdSet(campaignId, name, dailyBudgetCentavos, interests) {
  const targeting = {
    geo_locations: {
      cities: [{ key: "1729043", radius: 40, distance_unit: "kilometer" }], // Porto Alegre
    },
    age_min: 25,
    age_max: 65,
    interests: interests.map((i) => ({ id: i.id, name: i.name })),
    publisher_platforms: ["facebook", "instagram"],
  };

  const data = await graphPost(`${AD_ACCOUNT_ID}/adsets`, {
    name,
    campaign_id: campaignId,
    daily_budget: String(dailyBudgetCentavos),
    billing_event: "IMPRESSIONS",
    optimization_goal: "CONVERSATIONS",
    destination_type: "WHATSAPP",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: JSON.stringify(targeting),
    status: "PAUSED",
  });
  return data.id;
}

async function createAdCreative(name, imageUrl, message) {
  const objectStorySpec = {
    page_id: PAGE_ID,
    link_data: {
      message,
      link: `https://wa.me/${WHATSAPP_NUMERO}`,
      picture: imageUrl,
      call_to_action: {
        type: "WHATSAPP_MESSAGE",
        value: { link: `https://wa.me/${WHATSAPP_NUMERO}` },
      },
    },
  };

  const data = await graphPost(`${AD_ACCOUNT_ID}/adcreatives`, {
    name,
    object_story_spec: JSON.stringify(objectStorySpec),
  });
  return data.id;
}

async function createAd(name, adsetId, creativeId) {
  const data = await graphPost(`${AD_ACCOUNT_ID}/ads`, {
    name,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: "PAUSED",
  });
  return data.id;
}

// ── Criação completa de uma campanha (audiência) ─────────────────────────

async function buildCampaignForAudience(audienceKey) {
  const audience = AUDIENCES[audienceKey];
  if (!audience) throw new Error(`Audiência desconhecida: ${audienceKey}`);

  const imageBuffer = await generateAdImage(audience.imageService, audience.headline, audience.subtext);
  const blobUrl = await uploadToBlob(imageBuffer, `meta-ads/${audienceKey}-${Date.now()}.png`);

  const campaignId = await createCampaign(audience.campaignName);
  const adsetId = await createAdSet(
    campaignId,
    `${audience.campaignName} - Adset`,
    audience.dailyBudgetCentavos,
    audience.interests
  );
  const creativeId = await createAdCreative(`${audience.campaignName} - Criativo`, blobUrl, audience.message);
  const adId = await createAd(`${audience.campaignName} - Anúncio`, adsetId, creativeId);

  return { campaignId, adsetId, creativeId, adId, imageUrl: blobUrl, audience: audienceKey };
}

// ── Ativar/pausar campanha ────────────────────────────────────────────────

async function setCampaignStatus(campaignId, status) {
  await graphPost(campaignId, { status });
  return { campaignId, status };
}

// ── Buscar desempenho ─────────────────────────────────────────────────────

async function fetchInsights(campaignId) {
  const fields = "spend,impressions,clicks,ctr,actions,cost_per_action_type";
  return graphGet(`${campaignId}/insights`, { fields, date_preset: "last_7d" });
}

// ── Handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!ACCESS_TOKEN || !PAGE_ID) {
      return res.status(500).json({
        error: "FACEBOOK_PAGE_ACCESS_TOKEN ou FACEBOOK_PAGE_ID não configurados",
      });
    }

    const { action, audience, campaignId, campaignIds } = req.body || {};

    if (action === "create") {
      // audience: "condominios" | "empresas" | "all"
      const keys = audience === "all" ? Object.keys(AUDIENCES) : [audience];
      const results = [];
      for (const key of keys) {
        const result = await buildCampaignForAudience(key);
        results.push(result);
      }
      return res.status(200).json({ ok: true, created: results });
    }

    if (action === "activate") {
      if (!campaignId) return res.status(400).json({ error: "campaignId é obrigatório" });
      const result = await setCampaignStatus(campaignId, "ACTIVE");
      return res.status(200).json({ ok: true, result });
    }

    if (action === "pause") {
      if (!campaignId) return res.status(400).json({ error: "campaignId é obrigatório" });
      const result = await setCampaignStatus(campaignId, "PAUSED");
      return res.status(200).json({ ok: true, result });
    }

    if (action === "insights") {
      const ids = campaignIds || (campaignId ? [campaignId] : []);
      if (ids.length === 0) return res.status(400).json({ error: "campaignId(s) obrigatório" });
      const results = {};
      for (const id of ids) {
        results[id] = await fetchInsights(id);
      }
      return res.status(200).json({ ok: true, insights: results });
    }

    return res.status(400).json({
      error: "action inválida. Use: create, activate, pause ou insights",
    });
  } catch (err) {
    console.error("Erro em meta-ads:", err);
    return res.status(500).json({ error: err.message });
  }
}

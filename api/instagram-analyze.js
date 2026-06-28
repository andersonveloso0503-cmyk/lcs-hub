// /api/instagram-analyze.js
//
// Dois recursos novos para o módulo Instagram do LCS Hub:
//
//   1. Análise de perfil (action: "analyze_profile") — busca dados reais
//      do perfil do Instagram (@lcs_terceirizacao) via Graph API,
//      reaproveitando o mesmo FACEBOOK_PAGE_ACCESS_TOKEN/FACEBOOK_PAGE_ID
//      já configurados para publicação (api/buffer-schedule.js), e passa
//      isso pro Claude avaliar — no mesmo espírito do relatório do
//      Ravia.app que o usuário usou como referência: o que está faltando
//      no perfil (categoria, bio, contato, etc.) e o que já está bem
//      configurado.
//
//   2. Geração de criativo "estilo card escuro" (action: "generate_dark_card")
//      — variação visual do gerador de imagem já existente
//      (generate-creative-ai.js), com uma estética mais próxima dos
//      exemplos que o usuário mandou como referência: fundo escuro/navy,
//      texto grande em destaque, foto de contexto ao fundo, faixa de
//      contato (WhatsApp) visível. Usa o mesmo provider de imagem
//      (gpt-image-1.5) mas com um prompt visual mais específico.
//
// Ambos ficam neste único arquivo (em vez de 2 novos) para não estourar o
// limite de 12 funções serverless do plano Hobby da Vercel.

const FACEBOOK_GRAPH_VERSION = "v21.0";
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "";
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID || "";

/**
 * Descobre o Instagram Business Account ID vinculado à página do
 * Facebook configurada — necessário para consultar o perfil, já que o
 * Instagram Graph API funciona "através" da página vinculada, não com um
 * ID de conta isolado.
 */
async function getInstagramAccountId() {
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${FACEBOOK_PAGE_ID}?fields=instagram_business_account&access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Erro ao buscar conta do Instagram vinculada: ${data.error.message}`);
  const igId = data.instagram_business_account?.id;
  if (!igId) throw new Error("Nenhuma conta do Instagram Business vinculada a esta página do Facebook.");
  return igId;
}

/**
 * Busca os dados reais do perfil — biografia, categoria, website,
 * seguidores, contagem de posts. category_name e website costumam ser os
 * pontos que o usuário quer conferir (exatamente como no relatório do
 * Ravia que ele usou de referência: "categoria não definida", "sem
 * contato visível").
 */
async function fetchInstagramProfile(igAccountId) {
  const fields = "username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,category_name";
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${igAccountId}?fields=${fields}&access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Erro ao buscar perfil do Instagram: ${data.error.message}`);
  return data;
}

/**
 * Busca os últimos posts (até 12) com métricas básicas de engajamento —
 * usado pra IA avaliar se o conteúdo recente está variado (foto vs
 * carrossel vs reels) e se está gerando interação real (comentários),
 * não só pra olhar o perfil isoladamente.
 */
async function fetchRecentMedia(igAccountId) {
  const fields = "caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink";
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${igAccountId}/media?fields=${fields}&limit=12&access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    console.error("Erro ao buscar posts recentes (segue sem essa parte):", data.error.message);
    return [];
  }
  return data.data || [];
}

/**
 * Envia o perfil + posts recentes pro Claude avaliar, no mesmo formato
 * do relatório do Ravia.app usado como referência pelo usuário: lista de
 * pontos faltando (❌) e pontos já corretos (✅), seguidos de um resumo
 * com a recomendação de prioridade. Diferente das recomendações do
 * Google Ads (que têm "action" estruturada pra aplicar com 1 clique),
 * aqui a maioria dos itens depende de ação manual do usuário no próprio
 * app do Instagram (trocar categoria, completar bio) — então o campo
 * "action" só existe para os 2 itens que o LCS Hub pode mesmo resolver:
 * gerar legenda/criativo melhor.
 */
async function analyzeProfileWithAI(profile, recentMedia) {
  const mediaTypesCount = recentMedia.reduce((acc, m) => {
    const type = m.media_product_type || m.media_type || "OUTRO";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  const mediaTypesSummary = Object.entries(mediaTypesCount)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");

  const avgLikes =
    recentMedia.length > 0
      ? recentMedia.reduce((sum, m) => sum + (m.like_count || 0), 0) / recentMedia.length
      : 0;
  const avgComments =
    recentMedia.length > 0
      ? recentMedia.reduce((sum, m) => sum + (m.comments_count || 0), 0) / recentMedia.length
      : 0;

  const prompt = `Você é consultor de Instagram para pequenos negócios B2B no Brasil, no mesmo estilo direto e prático de ferramentas como o Ravia.app — que avalia o perfil apontando o que falta (com ❌) e o que já está certo (com ✅), seguido de uma explicação de impacto real no negócio.

Analise o perfil do Instagram da LCS Terceirização (limpeza, portaria e facilities, Porto Alegre RS) abaixo:

PERFIL:
- Username: @${profile.username || "desconhecido"}
- Nome: ${profile.name || "(não definido)"}
- Categoria: ${profile.category_name || "(NÃO DEFINIDA)"}
- Biografia: "${profile.biography || "(vazia)"}"
- Website na bio: ${profile.website || "(não configurado)"}
- Seguidores: ${profile.followers_count ?? "?"}
- Posts totais: ${profile.media_count ?? "?"}

ATIVIDADE RECENTE (últimos ${recentMedia.length} posts):
- Tipos de conteúdo: ${mediaTypesSummary || "nenhum post encontrado"}
- Média de curtidas por post: ${avgLikes.toFixed(1)}
- Média de comentários por post: ${avgComments.toFixed(1)}

Gere uma análise no formato JSON abaixo, com até 8 itens no total (misturando ❌ problemas e ✅ pontos positivos, como o Ravia faz), e termine com um resumo de 1-2 frases sobre a prioridade número 1.

Responda APENAS este JSON, sem texto antes ou depois:
{
  "items": [
    {"status": "problema" | "ok", "title": "título curto (máx 8 palavras)", "detail": "explicação com impacto real no negócio (máx 200 caracteres)"}
  ],
  "summary": "resumo de 1-2 frases sobre a prioridade número 1 a resolver"
}`;

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
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status} ao gerar análise`);

  const text = data.content?.[0]?.text || "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("A IA retornou um formato inválido na análise do perfil.");
  }
}

/**
 * Gera um criativo "card escuro" via DALL-E (gpt-image-1.5), com
 * estética próxima dos exemplos de referência do usuário: fundo
 * navy/escuro com leve gradiente, título grande em destaque dentro de um
 * card arredondado mais claro, foto de contexto ao fundo (profissional
 * trabalhando), e uma faixa inferior com ícone de WhatsApp + número de
 * contato. Diferente do generate-creative-ai.js (cards em azul royal /
 * bordô / dourado, estilo "badge modular"), este é mais parecido com o
 * visual "editorial escuro" das referências.
 */
async function generateDarkCardCreative(service, headline, subtext) {
  const prompt = `Professional, modern Instagram marketing card for a Brazilian facilities services company "LCS Terceirização" (cleaning, security/portaria, facilities and maintenance services for condominiums and businesses in Porto Alegre, Brazil).

Background: realistic photo of ${service}, slightly darkened with a navy blue gradient overlay for text readability.

Design: large bold white headline text in a rounded dark blue card near the top: "${headline}"
Below it, a smaller rounded card with white text: "${subtext}"
Bottom strip: WhatsApp icon + contact number badge "(51) 99889-3033"
Style: clean, editorial, professional, high contrast, suitable for a B2B services company social media — similar to premium corporate Instagram templates with dark navy and white color scheme.`;

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
      output_format: "b64_json",
    }),
  });

  const data = await response.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Sem imagem gerada: ${JSON.stringify(data?.error)}`);
  return `data:image/png;base64,${b64}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.body?.action;

  try {
    if (action === "analyze_profile") {
      if (!FACEBOOK_PAGE_ACCESS_TOKEN || !FACEBOOK_PAGE_ID) {
        return res.status(500).json({ error: "FACEBOOK_PAGE_ACCESS_TOKEN ou FACEBOOK_PAGE_ID não configurados." });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
      }

      const igAccountId = await getInstagramAccountId();
      const profile = await fetchInstagramProfile(igAccountId);
      const recentMedia = await fetchRecentMedia(igAccountId);
      const analysis = await analyzeProfileWithAI(profile, recentMedia);

      return res.status(200).json({ ok: true, profile, recent_media_count: recentMedia.length, ...analysis });
    }

    if (action === "generate_dark_card") {
      const { service, headline, subtext } = req.body;
      if (!service || !headline) {
        return res.status(400).json({ error: "service e headline são obrigatórios." });
      }
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "OPENAI_API_KEY não configurada." });
      }
      const imageBase64 = await generateDarkCardCreative(service, headline, subtext || "");
      return res.status(200).json({ ok: true, imageBase64 });
    }

    return res.status(400).json({ error: `Ação "${action}" não reconhecida.` });
  } catch (err) {
    console.error("Erro em instagram-analyze:", err);
    return res.status(500).json({ error: err.message });
  }
}

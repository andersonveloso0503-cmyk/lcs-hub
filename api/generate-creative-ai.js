// /api/generate-creative-ai.js
// Gera um criativo de Instagram completo (foto + textos + elementos visuais,
// tudo junto) usando o modelo gpt-image-1.5 da OpenAI (o gpt-image-1 está
// sendo descontinuado em out/2026). Diferente do fluxo principal (foto real
// + cards desenhados com precisão via Canvas), aqui a IA cria a imagem
// inteira a partir de um prompt — mais rápido e sem precisar de foto própria,
// mas com o risco conhecido de a IA errar a escrita de texto dentro da
// imagem (nome da empresa, telefone, etc.), então o resultado deve ser
// revisado visualmente antes de publicar.
//
// CUSTO: cada chamada usa qualidade "medium" (~$0.03–0.04 por imagem em
// formato quadrado, ~$0.05–0.06 em vertical). Isso é cobrado direto na conta
// da OpenAI vinculada à OPENAI_API_KEY — não é gratuito. Para reduzir custo,
// trocar "quality" para "low" (~$0.01–0.02/imagem); para mais qualidade,
// trocar para "high" (~$0.13–0.20/imagem).

// Gera a imagem usando Gemini Imagen 3 (Google). Custo bem menor que OpenAI
// (gratuito até certa cota, depois ~$0.03/imagem fixo, sem variação por
// qualidade). Texto embutido na imagem é menos confiável que o GPT-Image,
// então preferir esse provider quando a prioridade é custo, não precisão
// do texto desenhado.
// Usa Gemini 2.5 Flash Image ("Nano Banana") via endpoint generateContent —
// os modelos Imagen (imagen-3.x, imagen-4.x) usam endpoint :predict diferente
// e estão sendo descontinuados pela Google em favor desta família. Custo
// aprox. $0.039/imagem (1024px), cobrado como tokens de output de imagem.
async function generateWithGemini(prompt, size) {
  const aspectHint = size === "1024x1536" ? " Vertical 9:16 aspect ratio, portrait orientation." : " Square 1:1 aspect ratio.";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt + aspectHint }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  const data = await response.json();

  if (!response.ok || data?.error) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imagePart) throw new Error("Resposta sem imagem do Gemini");

  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
}

async function generateWithOpenAI(prompt, size) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt,
      size,
      quality: "medium",
      n: 1,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const rawMessage = data?.error?.message || "";
    const isBillingError =
      /billing|hard limit|quota|insufficient.*quota/i.test(rawMessage) ||
      data?.error?.code === "billing_hard_limit_reached" ||
      data?.error?.type === "insufficient_quota";

    const friendlyMessage = isBillingError
      ? "A conta da OpenAI está sem créditos ou atingiu o limite de gastos configurado. Acesse platform.openai.com → Settings → Billing, cadastre um cartão/créditos e confirme o limite de uso antes de tentar novamente."
      : rawMessage || "Erro ao gerar imagem com IA";

    throw new Error(friendlyMessage);
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Resposta sem imagem da IA");

  return `data:image/png;base64,${b64}`;
}

// ── Análise de perfil e card escuro do Instagram ──────────────────────────
// Mesclado neste arquivo (em vez de api/instagram-analyze.js próprio) para
// não passar do limite de 12 funções serverless do plano Hobby da Vercel.
// Reaproveita FACEBOOK_PAGE_ACCESS_TOKEN/FACEBOOK_PAGE_ID já configurados
// para publicação (ver api/buffer-schedule.js) — a Instagram Graph API
// exige acessar a conta business "através" da página do Facebook
// vinculada, não direto por um ID de conta isolado.

const FACEBOOK_GRAPH_VERSION = "v21.0";

async function getInstagramAccountId() {
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${process.env.FACEBOOK_PAGE_ID}?fields=instagram_business_account&access_token=${process.env.FACEBOOK_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Erro ao buscar conta do Instagram vinculada: ${data.error.message}`);
  const igId = data.instagram_business_account?.id;
  if (!igId) throw new Error("Nenhuma conta do Instagram Business vinculada a esta página do Facebook.");
  return igId;
}

async function fetchInstagramProfile(igAccountId) {
  const fields = "username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,category_name";
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${igAccountId}?fields=${fields}&access_token=${process.env.FACEBOOK_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Erro ao buscar perfil do Instagram: ${data.error.message}`);
  return data;
}

async function fetchRecentMedia(igAccountId) {
  const fields = "caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink";
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${igAccountId}/media?fields=${fields}&limit=12&access_token=${process.env.FACEBOOK_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    console.error("Erro ao buscar posts recentes (segue sem essa parte):", data.error.message);
    return [];
  }
  return data.data || [];
}

/**
 * Envia o perfil + posts recentes pro Claude avaliar, no mesmo formato do
 * relatório do Ravia.app usado como referência pelo usuário: itens ❌
 * (problema) e ✅ (ok), seguidos de um resumo com a prioridade #1.
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
 * Gera um criativo "card escuro" via DALL-E (gpt-image-1.5), com estética
 * próxima dos exemplos de referência do usuário: fundo navy/escuro, foto
 * de contexto ao fundo, headline grande em destaque, faixa de WhatsApp.
 * Visual diferente do generate-creative-ai padrão (cards azul/bordô/dourado).
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

// ── Reels (vídeo slideshow com IA + Shotstack) ─────────────────────────────
// Fluxo: 1) gera N imagens via IA (reaproveita generateWithOpenAI), 2) sobe
// cada imagem pro Vercel Blob (precisa de URL pública para o Shotstack
// acessar), 3) monta o vídeo no Shotstack com efeito Ken Burns + texto
// sobreposto em cada slide, 4) faz polling até o render terminar, 5) sobe
// o vídeo final pro Blob também (para virar a video_url exigida pela
// Instagram Graph API), 6) publica como Reel via container + polling +
// media_publish. Mesclado neste arquivo pela mesma razão de sempre: não
// estourar o limite de 12 funções serverless do plano Hobby.

import { put } from "@vercel/blob";

// Sandbox (não Production) — a Sandbox API Key só funciona neste host.
// Vídeos renderizados em sandbox saem com marca d'água "Shotstack" e tem
// limite mensal de renders gratuitos; trocar para a chave/host de
// Production quando o fluxo estiver validado e for usado de verdade.
const SHOTSTACK_API_URL = "https://api.shotstack.io/stage";

/**
 * Sobe um buffer/base64 para o Vercel Blob e retorna a URL pública —
 * necessário porque tanto o Shotstack quanto a Instagram Graph API exigem
 * URLs públicas para os assets (imagens de entrada e vídeo final), não
 * aceitam upload direto de bytes.
 */
async function uploadToBlob(buffer, filename, contentType) {
  const blob = await put(filename, buffer, {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}

/**
 * Gera UMA imagem de slide do Reel via IA e sobe pro Blob — não faz loop
 * por todos os slides aqui dentro, porque cada chamada de imagem já leva
 * vários segundos sozinha (gerar 4 em sequência facilmente passaria do
 * limite de ~10s do Vercel Hobby). O frontend chama esta ação uma vez por
 * slide, em sequência, mostrando o progresso entre cada uma.
 */
async function generateReelSlideImage(sceneDescription) {
  const prompt = `Professional, modern Instagram Reels background photo for a Brazilian facilities services company "LCS Terceirização" (cleaning, security/portaria, facilities and maintenance services for condominiums and businesses in Porto Alegre, Brazil).

Scene: ${sceneDescription}
Style: realistic, professional photo, vertical 9:16 orientation, slightly darkened for text overlay readability, high quality, suitable for a B2B services company social media video. No text in the image — text will be added separately.`;

  const imageBase64 = await generateWithOpenAI(prompt, "1024x1536");
  const matches = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
  const buffer = Buffer.from(matches[2], "base64");
  return uploadToBlob(buffer, `reel-slide-${Date.now()}.png`, matches[1]);
}

/**
 * Monta o JSON do timeline do Shotstack: 1 track de imagens (com efeito
 * Ken Burns automático — zoom/pan lento, dá sensação de movimento a partir
 * de fotos estáticas) + 1 track de texto sobreposto, sincronizado por
 * slide. Cada slide dura slideDuration segundos; duração total = N * slideDuration.
 */
function buildShotstackTimeline(slideImageUrls, slideTexts, slideDuration = 4) {
  const imageClips = slideImageUrls.map((url, i) => ({
    asset: { type: "image", src: url },
    start: i * slideDuration,
    length: slideDuration,
    effect: i % 2 === 0 ? "zoomIn" : "zoomOut", // alterna zoom in/out a cada slide para variar o movimento (efeito Ken Burns)
    transition: { in: "fade", out: "fade" },
  }));

  const textClips = slideTexts.map((text, i) => ({
    asset: {
      // Trocado de "title" para "text": o tipo "title" não respeita uma
      // largura customizável da mesma forma, então o texto saía reto e
      // cortava nas bordas laterais do vídeo (texto longo ficava maior
      // que os 1080px de largura). O tipo "text" define um container com
      // width/height fixos e quebra automaticamente em múltiplas linhas
      // para caber dentro dele, em vez de vazar pra fora da tela.
      type: "text",
      text,
      width: 900, // 1080 (largura do vídeo) menos ~90px de margem de cada lado
      height: 320, // o suficiente pra 2-3 linhas com folga, sem precisar subir muito
      font: {
        family: "Open Sans",
        size: 56,
        color: "#ffffff",
        lineHeight: 1.15,
      },
      alignment: {
        horizontal: "center",
        vertical: "center",
      },
      background: {
        color: "#000000",
        opacity: 0.65,
        padding: 24,
        borderRadius: 12,
      },
    },
    start: i * slideDuration + 0.3, // pequeno delay para o texto aparecer depois da imagem
    length: slideDuration - 0.3,
    position: "bottom",
    offset: { y: -0.1 }, // sobe um pouco mais (era -0.05) -- texto ainda colava demais na borda
    transition: { in: "fade", out: "fade" },
  }));

  return {
    timeline: {
      background: "#000000",
      tracks: [{ clips: textClips }, { clips: imageClips }], // track de texto por cima (Shotstack renderiza tracks de cima para baixo na ordem do array = topo da pilha primeiro)
    },
    output: {
      format: "mp4",
      size: { width: 1080, height: 1920 }, // 9:16 vertical, formato exigido pelo Reels
      fps: 30,
    },
  };
}

/**
 * Envia o render para o Shotstack e retorna o render id (processamento é
 * assíncrono — precisa fazer polling depois para saber quando terminou).
 */
async function submitShotstackRender(timelineJson) {
  const res = await fetch(`${SHOTSTACK_API_URL}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.SHOTSTACK_API_KEY,
    },
    body: JSON.stringify(timelineJson),
  });
  const data = await res.json();
  if (!res.ok || !data?.response?.id) {
    throw new Error(`Erro ao enviar render para o Shotstack: ${JSON.stringify(data)}`);
  }
  return data.response.id;
}

/**
 * Verifica o status do render UMA VEZ (sem loop interno) — o polling de
 * verdade é feito pelo FRONTEND, chamando essa ação repetidamente a cada
 * poucos segundos. Isso é necessário porque o Vercel Hobby mata qualquer
 * função serverless depois de ~10s; um loop de polling de 1-2 minutos
 * dentro da função travaria certamente. Retorna o status atual e, se
 * pronto, a URL do vídeo.
 */
async function checkShotstackRenderStatus(renderId) {
  const res = await fetch(`${SHOTSTACK_API_URL}/render/${renderId}`, {
    headers: { "x-api-key": process.env.SHOTSTACK_API_KEY },
  });
  const data = await res.json();
  const status = data?.response?.status;
  if (status === "failed") throw new Error(`Render do Shotstack falhou: ${JSON.stringify(data.response)}`);
  return { status, url: status === "done" ? data.response.url : null };
}

/**
 * Baixa o vídeo final do Shotstack e sobe pro Vercel Blob — embora o
 * Shotstack já forneça uma URL pública própria, preferimos ter uma cópia
 * no nosso Blob (mesma infraestrutura usada para as imagens) para não
 * depender da URL do Shotstack permanecer acessível no longo prazo, já
 * que a Instagram Graph API busca o vídeo no momento da publicação.
 */
async function copyVideoToBlob(shotstackVideoUrl) {
  const res = await fetch(shotstackVideoUrl);
  if (!res.ok) throw new Error("Erro ao baixar o vídeo renderizado do Shotstack.");
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return uploadToBlob(buffer, `reel-${Date.now()}.mp4`, "video/mp4");
}

/**
 * Etapa 1/2 de publicar o Reel: cria o container no Instagram (rápido,
 * só registra a intenção de publicar — o processamento real do vídeo
 * acontece depois, de forma assíncrona do lado do Instagram).
 */
async function createReelContainer(igAccountId, videoUrl, caption) {
  const createUrl = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${igAccountId}/media`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    }),
  });
  const createData = await createRes.json();
  if (createData.error) throw new Error(`Erro ao criar container do Reel: ${createData.error.message}`);
  return createData.id;
}

/**
 * Etapa 2/2: verifica UMA VEZ se o container já processou (sem loop
 * interno — o frontend chama repetidamente). Se "FINISHED", publica
 * imediatamente e retorna o ID do Reel publicado; caso contrário, só
 * retorna o status atual para o frontend tentar de novo em alguns segundos.
 */
async function checkAndPublishReel(igAccountId, containerId) {
  const statusRes = await fetch(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${containerId}?fields=status_code&access_token=${process.env.FACEBOOK_PAGE_ACCESS_TOKEN}`
  );
  const statusData = await statusRes.json();
  if (statusData.status_code === "ERROR" || statusData.status_code === "EXPIRED") {
    throw new Error(`Processamento do Reel falhou: ${statusData.status_code}`);
  }
  if (statusData.status_code !== "FINISHED") {
    return { status: statusData.status_code, published: false, mediaId: null };
  }

  const publishRes = await fetch(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${igAccountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }),
    }
  );
  const publishData = await publishRes.json();
  if (publishData.error) throw new Error(`Erro ao publicar o Reel: ${publishData.error.message}`);
  return { status: "FINISHED", published: true, mediaId: publishData.id };
}

/**
 * Gera 3-5 slides (cena + texto curto) via IA a partir do tema do Reel,
 * para alimentar tanto generateReelSlideImages quanto o texto sobreposto
 * no Shotstack. Mantém os textos curtos (máx ~60 caracteres) porque o
 * estilo "title" do Shotstack não quebra linha automaticamente bem para
 * textos longos em vídeos verticais estreitos.
 */
async function generateReelScript(theme) {
  const prompt = `Você é roteirista de Reels para Instagram de uma empresa brasileira de terceirização (limpeza, portaria, facilities) em Porto Alegre, RS, chamada LCS Terceirização.

Crie um roteiro de Reel curto (4 slides) sobre o tema: "${theme}".

Para cada slide, descreva:
- scene_description: descrição em INGLÊS de uma cena fotográfica realista relacionada ao tema (para gerar a imagem de fundo via IA)
- text: o texto curto que aparece sobreposto no slide, em PORTUGUÊS, máximo 60 caracteres, direto e impactante (estilo Reels — frases curtas, gancho nos primeiros slides, CTA no último)

Responda APENAS um JSON neste formato, sem texto antes ou depois:
{"slides": [{"scene_description": "...", "text": "..."}], "caption": "legenda completa para o post, em português, com 2-3 hashtags relevantes ao final"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status} ao gerar roteiro do Reel`);

  const text = data.content?.[0]?.text || "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("A IA retornou um formato inválido no roteiro do Reel.");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.body?.action;

  // Análise de perfil e card escuro do Instagram (mesclados aqui em vez
  // de um arquivo próprio, para não passar do limite de 12 funções
  // serverless do plano Hobby da Vercel) — ver detalhes nas funções
  // analyzeProfileWithAI/generateDarkCardCreative abaixo.
  if (action === "analyze_profile" || action === "generate_dark_card") {
    try {
      if (action === "analyze_profile") {
        if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN || !process.env.FACEBOOK_PAGE_ID) {
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
    } catch (err) {
      console.error("Erro na análise/card do Instagram:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Reels — fluxo dividido em etapas CURTAS (cada chamada de API roda em
  // poucos segundos), porque o Vercel Hobby mata qualquer função
  // serverless depois de ~10s e o processo completo (gerar roteiro + N
  // imagens + renderizar vídeo + publicar) levaria minutos se feito numa
  // chamada só. O frontend (ver ReelCreator.jsx) orquestra a sequência,
  // chamando cada ação uma por vez e fazendo polling onde necessário.
  const REELS_ACTIONS = [
    "generate_reel_script",
    "generate_reel_slide_image",
    "build_reel_video",
    "check_reel_video_status",
    "create_reel_container",
    "check_and_publish_reel",
  ];
  if (REELS_ACTIONS.includes(action)) {
    try {
      if (action === "generate_reel_script") {
        const { theme } = req.body;
        if (!theme) return res.status(400).json({ error: "theme é obrigatório." });
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
        }
        const script = await generateReelScript(theme);
        return res.status(200).json({ ok: true, ...script });
      }

      if (action === "generate_reel_slide_image") {
        const { scene_description } = req.body;
        if (!scene_description) return res.status(400).json({ error: "scene_description é obrigatório." });
        if (!process.env.OPENAI_API_KEY) {
          return res.status(500).json({ error: "OPENAI_API_KEY não configurada." });
        }
        const url = await generateReelSlideImage(scene_description);
        return res.status(200).json({ ok: true, url });
      }

      if (action === "build_reel_video") {
        const { slide_image_urls, slide_texts } = req.body;
        if (!Array.isArray(slide_image_urls) || !Array.isArray(slide_texts)) {
          return res.status(400).json({ error: "slide_image_urls e slide_texts (arrays) são obrigatórios." });
        }
        if (!process.env.SHOTSTACK_API_KEY) {
          return res.status(500).json({ error: "SHOTSTACK_API_KEY não configurada." });
        }
        const timeline = buildShotstackTimeline(slide_image_urls, slide_texts);
        const renderId = await submitShotstackRender(timeline);
        return res.status(200).json({ ok: true, render_id: renderId });
      }

      if (action === "check_reel_video_status") {
        const { render_id } = req.body;
        if (!render_id) return res.status(400).json({ error: "render_id é obrigatório." });
        const { status, url } = await checkShotstackRenderStatus(render_id);
        if (status !== "done") return res.status(200).json({ ok: true, status, ready: false });
        // Já pronto no Shotstack — copia pro nosso Blob antes de devolver,
        // para a Instagram Graph API buscar de uma URL que controlamos.
        const blobUrl = await copyVideoToBlob(url);
        return res.status(200).json({ ok: true, status: "done", ready: true, video_url: blobUrl });
      }

      if (action === "create_reel_container") {
        const { video_url, caption } = req.body;
        if (!video_url) return res.status(400).json({ error: "video_url é obrigatório." });
        if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN || !process.env.FACEBOOK_PAGE_ID) {
          return res.status(500).json({ error: "FACEBOOK_PAGE_ACCESS_TOKEN ou FACEBOOK_PAGE_ID não configurados." });
        }
        const igAccountId = await getInstagramAccountId();
        const containerId = await createReelContainer(igAccountId, video_url, caption || "");
        return res.status(200).json({ ok: true, container_id: containerId, ig_account_id: igAccountId });
      }

      if (action === "check_and_publish_reel") {
        const { container_id, ig_account_id } = req.body;
        if (!container_id || !ig_account_id) {
          return res.status(400).json({ error: "container_id e ig_account_id são obrigatórios." });
        }
        const result = await checkAndPublishReel(ig_account_id, container_id);
        return res.status(200).json({ ok: true, ...result });
      }
    } catch (err) {
      console.error(`Erro na ação de Reels "${action}":`, err);
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const { service, headline, format, provider } = req.body || {};

    if (!service) {
      return res.status(400).json({ error: "Campo 'service' é obrigatório" });
    }

    const size = format === "stories" || format === "reels" ? "1024x1536" : "1024x1024";
    const headlineText = headline || `${service} Profissional`;

    // Mapeamento explícito de cena por serviço — evita que a IA "escolha"
    // livremente e acabe sempre gerando a mesma cena (geralmente limpeza,
    // por ser o exemplo mais genérico). Cada serviço tem uma descrição de
    // cena fixa e específica.
    const SCENE_BY_SERVICE = {
      Limpeza:
        "a professional cleaner in uniform actively cleaning a modern office or building interior, holding cleaning equipment (mop, cloth, or spray bottle), bright and spotless environment",
      Portaria:
        "a professional security/reception guard in uniform at a modern building entrance or reception desk, attentive posture, well-lit lobby with security monitors or a check-in counter visible",
      Facilities:
        "a maintenance technician in uniform performing building maintenance work (checking electrical panel, fixing equipment, or inspecting HVAC/plumbing), tool belt or toolbox visible, industrial or technical setting",
      Condomínios:
        "an exterior or lobby view of a well-maintained modern residential condominium building, clean facade, manicured entrance, possibly with a doorman or maintenance staff visible",
      Empresas:
        "a clean, modern, professional corporate office environment, possibly showing a facilities/cleaning or security professional at work in a business setting, polished and orderly",
    };
    const sceneDescription =
      SCENE_BY_SERVICE[service] ||
      `a professional scene relevant to the "${service}" service, in a clean and modern business environment`;

    const prompt = `Professional, modern Instagram marketing creative for a Brazilian facilities services company called "LCS Terceirização" (cleaning, security/portaria, facilities and maintenance services for condominiums and businesses in Porto Alegre, Brazil).

Service being promoted: ${service}.

Design requirements:
- A realistic, professional photo-style background showing: ${sceneDescription}.
- Overlaid on the photo, a modern modular design with 2-3 small solid-color rounded rectangle cards/badges, in a color palette of deep royal blue (#2A04A9), dark burgundy/wine red (#4A0508), and gold/yellow (#FAD72D).
- One small card should contain ONLY this exact short text, written clearly and correctly: "${service.toUpperCase()}"
- A larger card should contain ONLY this exact headline text, written clearly and correctly, in bold white text: "${headlineText}"
- A small card with a phone icon and this exact text: "(51) 99889-3033"
- Clean, professional, corporate aesthetic — NOT cluttered, NOT cartoonish. High contrast, legible typography, generous spacing, modern sans-serif font style.
- Do not include any other text, watermarks, or logos besides what's specified above.
- High quality, polished, suitable for a real business's social media.`;

    // Gemini não escreve texto embutido com confiabilidade — quando o
    // provider escolhido é Gemini, simplifica o prompt removendo a exigência
    // de texto exato nos cards (vira só elementos decorativos).
    const promptForProvider =
      provider === "gemini"
        ? `Professional, modern Instagram marketing photo for a Brazilian facilities services company "LCS Terceirização" (cleaning, security/portaria, facilities and maintenance services for condominiums and businesses in Porto Alegre, Brazil).

Service being promoted: ${service}.

A realistic, professional photo showing: ${sceneDescription}.
Clean, professional, corporate aesthetic, high quality photo, suitable for a real business's social media. No text overlays.`
        : prompt;

    const imageBase64 =
      provider === "gemini"
        ? await generateWithGemini(promptForProvider, size)
        : await generateWithOpenAI(promptForProvider, size);

    return res.status(200).json({ imageBase64, provider: provider === "gemini" ? "gemini" : "openai" });
  } catch (err) {
    console.error("Erro ao gerar criativo com IA:", err);
    return res.status(500).json({ error: err.message });
  }
}

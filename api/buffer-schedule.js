// /api/buffer-schedule.js
// Agenda um post no Instagram via Buffer GraphQL API, e no Facebook
// DIRETO pela Graph API do Meta (sem passar pelo Buffer — usa um token de
// Usuário de Sistema do Gerenciador de Negócios, que não expira).
//
// Buffer (Instagram):
// - Endpoint: https://api.buffer.com (não graph.buffer.com)
// - createPost retorna union type: ...on PostActionSuccess / ...on MutationError
// - Imagem(ns) vai em assets: [{ image: { url: "..." } }, ...] — 2 a 10 imagens
//   no array criam um carrossel automaticamente (Instagram exige no mínimo 2
//   pra valer como carrossel; com 1 imagem só, é um post normal)
// - Agendamento usa mode: customScheduled + dueAt (ISO 8601), ou mode: addToQueue para "agora"
// - Geotag (opcional): precisa do ID de uma localização do Facebook. Configure
//   INSTAGRAM_LOCATION_ID e INSTAGRAM_LOCATION_NAME nas variáveis de ambiente
//   pra ativar — sem isso, o post sai sem geotag, sem dar erro.
//
// Facebook (direto via Graph API):
// - Variáveis necessárias: FACEBOOK_PAGE_ACCESS_TOKEN (token do Usuário de
//   Sistema "LCS Hub Bot", com pages_show_list/pages_read_engagement/
//   pages_manage_posts) e FACEBOOK_PAGE_ID
// - 1 imagem: POST /{page-id}/photos (com legenda)
// - 2+ imagens: cada imagem sobe sem publicar (published=false) via
//   /{page-id}/photos pra pegar um media_fbid, depois um POST /{page-id}/feed
//   com attached_media juntando todas — isso cria um post multi-foto
// - Agendamento usa published=false + scheduled_publish_time (timestamp Unix)

const BUFFER_API_URL = "https://api.buffer.com";
const ORG_ID = "6a1ba757b55a708283acc599";

const CHANNELS = {
  instagram: {
    id: "6a1ba809c687a22dd44479b8",
  },
};

const INSTAGRAM_LOCATION_ID = process.env.INSTAGRAM_LOCATION_ID || "";
const INSTAGRAM_LOCATION_NAME = process.env.INSTAGRAM_LOCATION_NAME || "";

const FACEBOOK_GRAPH_VERSION = "v21.0";
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "";
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID || "";

async function bufferRequest(query) {
  const res = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BUFFER_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

function escapeGraphQLString(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

async function createPostForChannel(channelKey, { text, imageUrls, scheduledAt }) {
  const channel = CHANNELS[channelKey];
  if (!channel?.id) {
    return { channel: channelKey, ok: false, error: "Canal não configurado (Channel ID ausente)" };
  }

  const isScheduled = Boolean(scheduledAt);
  const escapedText = escapeGraphQLString(text);

  // O Instagram exige metadata específica (tipo de post + se compartilha no
  // feed). Geotag entra aqui também, quando configurado. Outros canais
  // (Facebook, etc.) não precisam desse bloco.
  let metadataBlock = "";
  if (channelKey === "instagram") {
    const geolocationField =
      INSTAGRAM_LOCATION_ID
        ? `, geolocation: { id: "${INSTAGRAM_LOCATION_ID}", text: "${escapeGraphQLString(INSTAGRAM_LOCATION_NAME)}" }`
        : "";
    metadataBlock = `,\n        metadata: { instagram: { type: post, shouldShareToFeed: true${geolocationField} } }`;
  }

  const assetsList = (imageUrls || [])
    .filter(Boolean)
    .map((url) => `{ image: { url: "${url}" } }`)
    .join(",\n          ");

  const query = `
    mutation CreatePost {
      createPost(input: {
        text: "${escapedText}",
        channelId: "${channel.id}",
        schedulingType: automatic,
        mode: ${isScheduled ? "customScheduled" : "addToQueue"}${isScheduled ? `,\n        dueAt: "${scheduledAt}"` : ""}${metadataBlock},
        assets: [
          ${assetsList}
        ]
      }) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const result = await bufferRequest(query);

  // Erros de sistema (autenticação, etc.) aparecem no array "errors" do GraphQL
  if (result?.errors) {
    return {
      channel: channelKey,
      ok: false,
      error: result.errors.map((e) => e.message).join("; "),
      raw: result,
    };
  }

  const payload = result?.data?.createPost;
  // MutationError vem como objeto com "message" e sem "post"
  if (payload?.message && !payload?.post) {
    return { channel: channelKey, ok: false, error: payload.message, raw: result };
  }

  if (!payload?.post) {
    return { channel: channelKey, ok: false, error: "Resposta inesperada do Buffer", raw: result };
  }

  return { channel: channelKey, ok: true, post: payload.post };
}

// ── Facebook direto via Graph API (sem Buffer) ────────────────────────────────

async function facebookGraphRequest(path, params) {
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: FACEBOOK_PAGE_ACCESS_TOKEN }),
  });
  return res.json();
}

async function postToFacebookDirect({ text, imageUrls, scheduledAt }) {
  if (!FACEBOOK_PAGE_ACCESS_TOKEN || !FACEBOOK_PAGE_ID) {
    return {
      channel: "facebook",
      ok: false,
      error: "FACEBOOK_PAGE_ACCESS_TOKEN ou FACEBOOK_PAGE_ID não configurados",
    };
  }

  const isScheduled = Boolean(scheduledAt);
  // Graph API exige o agendamento entre 10 minutos e 75 dias no futuro, em
  // timestamp Unix (segundos, não milissegundos).
  const scheduledUnix = isScheduled ? Math.floor(new Date(scheduledAt).getTime() / 1000) : null;

  try {
    const urls = (imageUrls || []).filter(Boolean);

    if (urls.length <= 1) {
      // Post de foto única
      const params = {
        url: urls[0],
        caption: text,
      };
      if (isScheduled) {
        params.published = "false";
        params.scheduled_publish_time = String(scheduledUnix);
      }
      const result = await facebookGraphRequest(`${FACEBOOK_PAGE_ID}/photos`, params);
      if (result.error) {
        return { channel: "facebook", ok: false, error: result.error.message, raw: result };
      }
      return { channel: "facebook", ok: true, post: { id: result.post_id || result.id } };
    }

    // Múltiplas fotos: sobe cada uma sem publicar, depois junta num post só
    // usando attached_media — isso cria um post multi-foto no Facebook.
    const mediaFbids = [];
    for (const url of urls) {
      const uploadResult = await facebookGraphRequest(`${FACEBOOK_PAGE_ID}/photos`, {
        url,
        published: "false",
      });
      if (uploadResult.error) {
        return {
          channel: "facebook",
          ok: false,
          error: `Erro ao subir imagem: ${uploadResult.error.message}`,
          raw: uploadResult,
        };
      }
      mediaFbids.push(uploadResult.id);
    }

    const feedParams = {
      message: text,
      attached_media: JSON.stringify(mediaFbids.map((id) => ({ media_fbid: id }))),
    };
    if (isScheduled) {
      feedParams.published = "false";
      feedParams.scheduled_publish_time = String(scheduledUnix);
    }

    const feedResult = await facebookGraphRequest(`${FACEBOOK_PAGE_ID}/feed`, feedParams);
    if (feedResult.error) {
      return { channel: "facebook", ok: false, error: feedResult.error.message, raw: feedResult };
    }

    return { channel: "facebook", ok: true, post: { id: feedResult.id } };
  } catch (err) {
    return { channel: "facebook", ok: false, error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, imageUrl, imageUrls, scheduledAt, channels } = req.body || {};

    // Aceita tanto o formato antigo (imageUrl, uma imagem só) quanto o novo
    // (imageUrls, array — 2+ imagens vira carrossel automaticamente no IG).
    const finalImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
      ? imageUrls
      : imageUrl
        ? [imageUrl]
        : [];

    if (!text || finalImageUrls.length === 0) {
      return res.status(400).json({ error: "Campos 'text' e 'imageUrl'/'imageUrls' são obrigatórios" });
    }

    // Por padrão, publica só no Instagram. O Facebook agora vai direto pela
    // Graph API do Meta (sem custo de canal extra no Buffer) — pra incluir,
    // passe channels: ["instagram", "facebook"].
    const targetChannels = Array.isArray(channels) && channels.length > 0
      ? channels
      : ["instagram"];

    const results = await Promise.all(
      targetChannels.map((ch) =>
        ch === "facebook"
          ? postToFacebookDirect({ text, imageUrls: finalImageUrls, scheduledAt })
          : createPostForChannel(ch, { text, imageUrls: finalImageUrls, scheduledAt })
      )
    );

    const allOk = results.every((r) => r.ok);
    const anyOk = results.some((r) => r.ok);

    return res.status(allOk ? 200 : anyOk ? 207 : 502).json({
      ok: allOk,
      partial: !allOk && anyOk,
      results,
    });
  } catch (err) {
    console.error("Erro ao agendar no Buffer:", err);
    return res.status(500).json({ error: err.message });
  }
}

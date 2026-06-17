// /api/buffer-schedule.js
// Agenda um post no Instagram e/ou Facebook via Buffer GraphQL API.
// Endpoint e sintaxe confirmados na documentação oficial atual (developers.buffer.com):
// - Endpoint: https://api.buffer.com (não graph.buffer.com)
// - createPost retorna union type: ...on PostActionSuccess / ...on MutationError
// - Imagem vai em assets: [{ image: { url: "..." } }]
// - Agendamento usa mode: customScheduled + dueAt (ISO 8601), ou mode: addToQueue para "agora"

const BUFFER_API_URL = "https://api.buffer.com";
const ORG_ID = "6a1ba757b55a708283acc599";

const CHANNELS = {
  instagram: {
    id: "6a1ba809c687a22dd44479b8",
  },
  facebook: {
    // Channel ID confirmado via consulta direta à API do Buffer em 17/06/2026.
    // Pode ser sobrescrito pela variável de ambiente FACEBOOK_CHANNEL_ID, se a
    // página for reconectada no futuro e o ID mudar.
    id: process.env.FACEBOOK_CHANNEL_ID || "6a32ab6938b5579345a5fc70",
  },
};

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

async function createPostForChannel(channelKey, { text, imageUrl, scheduledAt }) {
  const channel = CHANNELS[channelKey];
  if (!channel?.id) {
    return { channel: channelKey, ok: false, error: "Canal não configurado (Channel ID ausente)" };
  }

  const isScheduled = Boolean(scheduledAt);
  const escapedText = escapeGraphQLString(text);

  const query = `
    mutation CreatePost {
      createPost(input: {
        text: "${escapedText}",
        channelId: "${channel.id}",
        schedulingType: automatic,
        mode: ${isScheduled ? "customScheduled" : "addToQueue"}${isScheduled ? `,\n        dueAt: "${scheduledAt}"` : ""},
        assets: [
          {
            image: {
              url: "${imageUrl}"
            }
          }
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, imageUrl, scheduledAt, channels } = req.body || {};

    if (!text || !imageUrl) {
      return res.status(400).json({ error: "Campos 'text' e 'imageUrl' são obrigatórios" });
    }

    // Por padrão, publica em ambos os canais configurados
    const targetChannels = Array.isArray(channels) && channels.length > 0
      ? channels
      : ["instagram", "facebook"];

    const results = await Promise.all(
      targetChannels.map((ch) => createPostForChannel(ch, { text, imageUrl, scheduledAt }))
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

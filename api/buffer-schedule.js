// /api/buffer-schedule.js
// Agenda um post no Instagram via Buffer GraphQL API.
// Fluxo descoberto e validado: organizations (com input.id) → channels (campo "service",
// não "serviceType") → createPost mutation.

const BUFFER_GRAPHQL_URL = "https://graph.buffer.com/graphql";
const ORG_ID = "6a1ba757b55a708283acc599";
const INSTAGRAM_CHANNEL_ID = "6a1ba809c487a22dd44479b8";

async function bufferRequest(query, variables) {
  const res = await fetch(BUFFER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BUFFER_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, imageUrl, scheduledAt } = req.body || {};

    if (!text || !imageUrl) {
      return res.status(400).json({ error: "Campos 'text' e 'imageUrl' são obrigatórios" });
    }

    const isScheduled = Boolean(scheduledAt);

    const mutation = `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          post {
            id
            status
          }
          errors {
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        organizationId: ORG_ID,
        channelId: INSTAGRAM_CHANNEL_ID,
        text,
        assets: [{ type: "IMAGE", url: imageUrl }],
        schedulingType: isScheduled ? "customScheduled" : "automatic",
        ...(isScheduled ? { scheduledAt } : {}),
        metadata: {
          instagram: {
            type: "post",
            shouldShareToFeed: true,
          },
        },
      },
    };

    const result = await bufferRequest(mutation, variables);

    const errors = result?.data?.createPost?.errors;
    if (errors && errors.length > 0) {
      return res.status(502).json({ error: errors.map((e) => e.message).join("; "), raw: result });
    }

    if (result?.errors) {
      return res
        .status(502)
        .json({ error: result.errors.map((e) => e.message).join("; "), raw: result });
    }

    return res.status(200).json({ ok: true, post: result?.data?.createPost?.post });
  } catch (err) {
    console.error("Erro ao agendar no Buffer:", err);
    return res.status(500).json({ error: err.message });
  }
}

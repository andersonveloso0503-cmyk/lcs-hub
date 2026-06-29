// /api/buffer-manage.js
// Gerencia posts já existentes no Buffer: excluir ou editar (trocar imagem/texto/data).
// Usa as mutations deletePost e editPost da API GraphQL do Buffer, confirmadas
// na documentação oficial (developers.buffer.com/reference.html).

const BUFFER_API_URL = "https://api.buffer.com";

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
  return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

async function deleteBufferPost(postId) {
  const query = `
    mutation DeletePost {
      deletePost(input: { id: "${postId}" }) {
        ... on DeletePostSuccess {
          id
        }
        ... on VoidMutationError {
          message
        }
      }
    }
  `;
  const result = await bufferRequest(query);

  if (result?.errors) {
    return { ok: false, error: result.errors.map((e) => e.message).join("; "), raw: result };
  }
  const payload = result?.data?.deletePost;
  if (payload?.message && !payload?.id) {
    return { ok: false, error: payload.message, raw: result };
  }
  if (!payload?.id) {
    return { ok: false, error: "Resposta inesperada do Buffer", raw: result };
  }
  return { ok: true, deletedId: payload.id };
}

async function editBufferPostImage(postId, imageUrl, isInstagram) {
  const metadataBlock = isInstagram
    ? `,\n        metadata: { instagram: { type: post, shouldShareToFeed: true } }`
    : "";

  const query = `
    mutation EditPost {
      editPost(input: {
        id: "${postId}"${metadataBlock},
        assets: [
          {
            image: {
              url: "${escapeGraphQLString(imageUrl)}"
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

  if (result?.errors) {
    return { ok: false, error: result.errors.map((e) => e.message).join("; "), raw: result };
  }
  const payload = result?.data?.editPost;
  if (payload?.message && !payload?.post) {
    return { ok: false, error: payload.message, raw: result };
  }
  if (!payload?.post) {
    return { ok: false, error: "Resposta inesperada do Buffer", raw: result };
  }
  return { ok: true, post: payload.post };
}

/**
 * Reagenda um post já existente no Buffer, alterando o campo dueAt via a
 * mesma mutation editPost (EditPostInput.dueAt).
 *
 * IMPORTANTE: o Buffer trata editPost como uma substituição completa do
 * conteúdo do post, não como um "patch" parcial — se enviarmos só dueAt,
 * ele entende que o post passou a não ter texto/imagem/tipo e rejeita com
 * "Post must have either text or media" / "Instagram posts require..."
 * Por isso é obrigatório reenviar text, assets (imagem) e metadata.instagram
 * junto com a nova data, mesmo que esses campos não estejam mudando.
 */
async function editBufferPostDate(postId, dueAt, text, imageUrl, isInstagram) {
  const textBlock = text ? `,\n        text: "${escapeGraphQLString(text)}"` : "";
  const assetsBlock = imageUrl
    ? `,\n        assets: [{ image: { url: "${escapeGraphQLString(imageUrl)}" } }]`
    : "";
  const metadataBlock = isInstagram
    ? `,\n        metadata: { instagram: { type: post, shouldShareToFeed: true } }`
    : "";

  const query = `
    mutation EditPostDate {
      editPost(input: {
        id: "${postId}",
        schedulingType: automatic,
        mode: customScheduled,
        dueAt: "${dueAt}"${textBlock}${assetsBlock}${metadataBlock}
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

  if (result?.errors) {
    return { ok: false, error: result.errors.map((e) => e.message).join("; "), raw: result };
  }
  const payload = result?.data?.editPost;
  if (payload?.message && !payload?.post) {
    return { ok: false, error: payload.message, raw: result };
  }
  if (!payload?.post) {
    return { ok: false, error: "Resposta inesperada do Buffer", raw: result };
  }
  return { ok: true, post: payload.post };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { action, bufferPostIds, imageUrl, isInstagram, dueAt, text } = req.body || {};

    if (!action || !Array.isArray(bufferPostIds) || bufferPostIds.length === 0) {
      return res.status(400).json({
        error: "Campos 'action' e 'bufferPostIds' (array não vazio) são obrigatórios",
      });
    }

    if (action === "delete") {
      const results = await Promise.all(bufferPostIds.map((id) => deleteBufferPost(id)));
      const allOk = results.every((r) => r.ok);
      return res.status(allOk ? 200 : 502).json({ ok: allOk, results });
    }

    if (action === "editImage") {
      if (!imageUrl) {
        return res.status(400).json({ error: "Campo 'imageUrl' é obrigatório para editImage" });
      }
      const results = await Promise.all(
        bufferPostIds.map((id) => editBufferPostImage(id, imageUrl, Boolean(isInstagram)))
      );
      const allOk = results.every((r) => r.ok);
      return res.status(allOk ? 200 : 502).json({ ok: allOk, results });
    }

    if (action === "editDate") {
      if (!dueAt) {
        return res.status(400).json({ error: "Campo 'dueAt' (ISO 8601) é obrigatório para editDate" });
      }
      const results = await Promise.all(
        bufferPostIds.map((id) =>
          editBufferPostDate(id, dueAt, text, imageUrl, Boolean(isInstagram))
        )
      );
      const allOk = results.every((r) => r.ok);
      return res.status(allOk ? 200 : 502).json({ ok: allOk, results });
    }

    return res.status(400).json({ error: "Ação inválida. Use 'delete', 'editImage' ou 'editDate'." });
  } catch (err) {
    console.error("Erro ao gerenciar post no Buffer:", err);
    return res.status(500).json({ error: err.message });
  }
}

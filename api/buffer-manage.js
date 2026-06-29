// /api/buffer-manage.js
// Gerencia posts já existentes no Buffer: excluir ou editar (trocar imagem/texto).
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
 * Reagenda um post já existente no Buffer, alterando só o campo dueAt via
 * a mesma mutation editPost (EditPostInput.dueAt, confirmado no changelog
 * oficial da API GraphQL do Buffer). mode: customScheduled é obrigatório
 * junto com dueAt — sem ele, o Buffer rejeita a mudança de data.
 */
async function editBufferPostDate(postId, dueAt) {
  const query = `
    mutation EditPostDate {
      editPost(input: {
        id: "${postId}",
        mode: customScheduled,
        dueAt: "${dueAt}"
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
    const { action, bufferPostIds, imageUrl, isInstagram, dueAt } = req.body || {};

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
      const results = await Promise.all(bufferPostIds.map((id) => editBufferPostDate(id, dueAt)));
      const allOk = results.every((r) => r.ok);
      return res.status(allOk ? 200 : 502).json({ ok: allOk, results });
    }

    return res.status(400).json({ error: "Ação inválida. Use 'delete', 'editImage' ou 'editDate'." });
  } catch (err) {
    console.error("Erro ao gerenciar post no Buffer:", err);
    return res.status(500).json({ error: err.message });
  }
}

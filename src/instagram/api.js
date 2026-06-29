// Camada de chamadas às Vercel Functions do módulo Instagram.

export async function generateCaption({ service, tone, goal, format, context, includeHashtags }) {
  try {
    const res = await fetch("/api/generate-caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service, tone, goal, format, context, includeHashtags }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || "Erro ao gerar legenda" };
    return { ok: true, caption: data.caption };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Gera um título de destaque curto e criativo com IA, baseado só no serviço
 * (sem precisar analisar a foto). Usado no Editor de Fotos como sugestão,
 * e também no Criativo Estilo Card Escuro (título e subtítulo).
 * type: "headline" (padrão) ou "subtext".
 */
export async function generateHeadline(service, type = "headline") {
  try {
    const res = await fetch("/api/generate-headline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service, type }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || "Erro ao gerar título" };
    return { ok: true, headline: data.headline };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Gera um criativo completo (foto + textos + cards, tudo junto numa imagem
 * só) usando IA de geração de imagem (gpt-image-1), sem precisar de foto
 * própria. Atenção: a IA pode errar a escrita de texto dentro da imagem —
 * sempre revisar visualmente antes de usar.
 */
export async function generateCreativeAI({ service, headline, format, provider }) {
  try {
    const res = await fetch("/api/generate-creative-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service, headline, format, provider }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || "Erro ao gerar criativo com IA" };
    return { ok: true, imageBase64: data.imageBase64 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function uploadImage(dataUrl, filename) {
  try {
    const res = await fetch("/api/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: dataUrl, filename }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || "Erro ao enviar imagem" };
    return { ok: true, url: data.url };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function generateWeek() {
  try {
    const res = await fetch("/api/generate-week", { method: "POST" });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || "Erro ao gerar a semana" };
    return { ok: true, posts: data.posts };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function scheduleToBuffer({ text, imageUrl, imageUrls, scheduledAt, channels }) {
  try {
    // Aceita tanto imageUrl (uma imagem) quanto imageUrls (array) — o
    // backend (api/buffer-schedule.js) já suporta os dois formatos, mas
    // esta função só estava repassando "imageUrl", então chamadas com
    // imageUrls (como o WeeklyPlanner faz) nunca enviavam imagem alguma,
    // causando erro 400 "campos obrigatórios" silenciosamente.
    const finalImageUrls = imageUrls && imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : [];

    const res = await fetch("/api/buffer-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, imageUrls: finalImageUrls, scheduledAt, channels }),
    });
    const data = await res.json();

    // Qualquer status de erro (400 de validação, 502 de falha nos canais,
    // 500 de erro interno) precisa de uma mensagem segura — antes disso só
    // o 502 tinha tratamento, então 400/500 caíam no "return data.ok" mais
    // abaixo sem nenhum campo "error" definido, gerando o "undefined" que
    // aparecia na tela.
    if (!res.ok) {
      const errorMsg = data.results
        ? data.results
            .map((r) => `${r.channel}: ${r.error}${r.raw ? ` [detalhe: ${JSON.stringify(r.raw)}]` : ""}`)
            .join(" | ")
        : data.error || `Erro ao agendar no Buffer (HTTP ${res.status})`;
      return { ok: false, error: errorMsg };
    }

    // 200 (sucesso total) ou 207 (parcial - ex: Instagram ok, Facebook não configurado)
    return { ok: data.ok, partial: data.partial, results: data.results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Exclui um ou mais posts do Buffer pelo ID (mutation deletePost).
 * bufferPostIds deve ser um array de IDs (um post pode ter sido publicado
 * em múltiplos canais, cada um com seu próprio ID no Buffer).
 */
export async function deleteFromBuffer(bufferPostIds) {
  try {
    const res = await fetch("/api/buffer-manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", bufferPostIds }),
    });
    const data = await res.json();
    if (!res.ok) {
      const errorMsg = data.results
        ? data.results.map((r) => r.error).filter(Boolean).join(" | ")
        : data.error || "Erro ao excluir no Buffer";
      return { ok: false, error: errorMsg };
    }
    return { ok: true, results: data.results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Troca a imagem de um post já agendado no Buffer (mutation editPost),
 * mantendo o restante do conteúdo (texto, horário) intacto.
 */
export async function editImageOnBuffer(bufferPostIds, imageUrl, isInstagram = true) {
  try {
    const res = await fetch("/api/buffer-manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "editImage", bufferPostIds, imageUrl, isInstagram }),
    });
    const data = await res.json();
    if (!res.ok) {
      const errorMsg = data.results
        ? data.results.map((r) => r.error).filter(Boolean).join(" | ")
        : data.error || "Erro ao trocar imagem no Buffer";
      return { ok: false, error: errorMsg };
    }
    return { ok: true, results: data.results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

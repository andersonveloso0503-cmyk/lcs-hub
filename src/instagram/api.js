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

export async function scheduleToBuffer({ text, imageUrl, scheduledAt, channels }) {
  try {
    const res = await fetch("/api/buffer-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, imageUrl, scheduledAt, channels }),
    });
    const data = await res.json();

    if (res.status === 502) {
      const errorMsg = data.results
        ? data.results.map((r) => `${r.channel}: ${r.error}`).join(" | ")
        : data.error || "Erro ao agendar no Buffer";
      return { ok: false, error: errorMsg };
    }

    // 200 (sucesso total) ou 207 (parcial - ex: Instagram ok, Facebook não configurado)
    return { ok: data.ok, partial: data.partial, results: data.results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

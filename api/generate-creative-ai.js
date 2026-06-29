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
  // Removido "category_name" — campo descontinuado nesta versão da Graph
  // API para este tipo de conta (causava erro #100 "Tried accessing
  // nonexisting field (category_name)"). A categoria não é essencial para
  // a análise, então foi simplesmente retirada da lista de campos.
  const fields = "username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url";
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
 * Gera uma sugestão concreta de correção para um item específico apontado
 * na análise de perfil (ex: bio fraca, sem categoria, poucos posts). Não
 * altera nada automaticamente — a Instagram Graph API não permite editar
 * bio/categoria/foto de perfil de contas business via API, então o usuário
 * sempre revisa e aplica manualmente no app do Instagram.
 */
async function suggestFixForItem(item, profile) {
  const prompt = `Você é consultor de Instagram para pequenos negócios B2B no Brasil, ajudando a empresa "LCS Terceirização" (limpeza, portaria, facilities, Porto Alegre RS).

Um relatório de análise de perfil apontou o seguinte problema:
- Título: "${item.title}"
- Detalhe: "${item.detail}"

Contexto atual do perfil:
- Username: @${profile?.username || "desconhecido"}
- Nome: ${profile?.name || "(não definido)"}
- Biografia atual: "${profile?.biography || "(vazia)"}"
- Website na bio: ${profile?.website || "(não configurado)"}

Gere uma sugestão prática e específica para resolver esse problema. Se envolver texto pronto para usar (ex: nova biografia, nova categoria sugerida, ideia de CTA), escreva o texto EXATO sugerido, pronto para copiar e colar. Se for uma ação fora do Instagram (ex: "poste com mais frequência"), explique o passo a passo prático.

Responda APENAS este JSON, sem texto antes ou depois:
{
  "suggestion_text": "explicação curta da recomendação (máx 250 caracteres)",
  "ready_to_copy": "texto pronto para copiar e colar (ex: nova bio), ou null se não se aplicar",
  "action_type": "copy_text" | "manual_action" | "create_content"
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
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status} ao gerar sugestão`);

  const text = data.content?.[0]?.text || "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("A IA retornou um formato inválido na sugestão de correção.");
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
      output_format: "png",
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

  // Análise de perfil e card escuro do Instagram (mesclados aqui em vez
  // de um arquivo próprio, para não passar do limite de 12 funções
  // serverless do plano Hobby da Vercel) — ver detalhes nas funções
  // analyzeProfileWithAI/generateDarkCardCreative abaixo.
  if (action === "analyze_profile" || action === "generate_dark_card" || action === "suggest_fix") {
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

      if (action === "suggest_fix") {
        const { item, profile } = req.body || {};
        if (!item || !item.title) {
          return res.status(400).json({ error: "item (com title/detail) é obrigatório." });
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
        }
        const suggestion = await suggestFixForItem(item, profile);
        return res.status(200).json({ ok: true, ...suggestion });
      }
    } catch (err) {
      console.error("Erro na análise/card do Instagram:", err);
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

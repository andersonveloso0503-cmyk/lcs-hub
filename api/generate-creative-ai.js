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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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

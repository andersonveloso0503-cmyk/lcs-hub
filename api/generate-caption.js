// /api/generate-caption.js
// Gera legenda de Instagram com IA (Claude), no mesmo padrão de tom/serviço
// usado no restante do LCS Hub.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { service, tone, goal, format, context, includeHashtags } = req.body || {};

    if (!service) {
      return res.status(400).json({ error: "Campo 'service' é obrigatório" });
    }

    const prompt = `Você é especialista em marketing digital para a LCS Terceirização, empresa de Porto Alegre, RS que presta serviços de limpeza, portaria, facilities e manutenção para condomínios e empresas.

Crie uma legenda para Instagram (@lcs_terceirizacao) com:
- Serviço destacado: ${service}
- Tom de voz: ${tone || "Profissional e confiante"}
- Objetivo: ${goal || "Transmitir credibilidade"}
- Formato do conteúdo: ${format || "Post — Feed"}
- Contexto adicional: ${context || "nenhum"}
- ${includeHashtags === false ? "Não inclua hashtags." : "Inclua entre 8 e 12 hashtags relevantes ao final, em uma linha separada."}
- Use no máximo 4 emojis, de forma natural
- CTA claro no final incentivando contato pelo WhatsApp
- Escreva em português brasileiro, de forma natural e humana, sem parecer robótico
- Tamanho ideal: 3 a 6 linhas de texto principal

Retorne apenas a legenda final, sem explicações, sem aspas envolvendo o texto.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data?.content?.find((c) => c.type === "text")?.text;

    if (!text) {
      return res.status(502).json({ error: "Resposta vazia da IA", raw: data });
    }

    return res.status(200).json({ caption: text.trim() });
  } catch (err) {
    console.error("Erro ao gerar legenda:", err);
    return res.status(500).json({ error: err.message });
  }
}

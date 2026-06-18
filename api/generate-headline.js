// /api/generate-headline.js
// Gera só um título de destaque curto e criativo (sem a legenda completa),
// usado no Editor de Fotos para sugerir o texto que vai desenhado na imagem.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { service } = req.body || {};

    if (!service) {
      return res.status(400).json({ error: "Campo 'service' é obrigatório" });
    }

    const prompt = `Você é especialista em marketing digital para a LCS Terceirização, empresa de Porto Alegre, RS que presta serviços de limpeza, portaria, facilities e manutenção para condomínios e empresas.

Crie UM título de destaque curto e criativo para um post de Instagram sobre o serviço "${service}". Esse título vai aparecer em texto grande, desenhado sobre a foto do post — é a primeira coisa que a pessoa vê.

Regras:
- Máximo 6 palavras
- Criativo e que chame atenção (não pode ser genérico tipo "Serviço Profissional" ou "${service} Profissional")
- Direto, com impacto, pode usar jogo de palavras relacionado ao serviço
- Sem emojis, sem hashtags, sem ponto final, sem aspas
- Em português brasileiro

Retorne APENAS o título, nada mais.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data?.content?.find((c) => c.type === "text")?.text;

    if (!text) {
      return res.status(502).json({ error: "Resposta vazia da IA", raw: data });
    }

    const headline = text.trim().replace(/^["']|["']$/g, "").replace(/\.$/, "");

    return res.status(200).json({ headline });
  } catch (err) {
    console.error("Erro ao gerar título:", err);
    return res.status(500).json({ error: err.message });
  }
}

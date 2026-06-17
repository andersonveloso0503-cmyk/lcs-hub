// /api/generate-week.js
// Gera 7 legendas de Instagram de uma vez (uma para cada dia da semana),
// variando serviço, tom e objetivo, para reduzir trabalho manual diário.

const SERVICES = [
  "Limpeza e Conservação",
  "Portaria e Recepção",
  "Facilities e Manutenção",
  "Condomínios e Síndicos",
  "Empresas / Escritórios",
  "Limpeza e Conservação",
  "Apresentação Geral LCS",
];

const DAY_LABELS = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];

const SUGGESTED_TIMES = ["09:00", "12:00", "18:00", "10:00", "17:00", "11:00", "19:00"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const prompt = `Você é especialista em marketing digital para a LCS Terceirização, empresa de Porto Alegre, RS que presta serviços de limpeza, portaria, facilities e manutenção para condomínios e empresas.

Crie 7 legendas de Instagram (@lcs_terceirizacao), uma para cada dia da semana, seguindo esta distribuição de serviços (um por dia, nesta ordem):
${SERVICES.map((s, i) => `${i + 1}. ${DAY_LABELS[i]}: ${s}`).join("\n")}

Regras para cada legenda:
- Tom de voz variado entre os dias (alterne entre profissional/confiante, próximo/amigável, educativo)
- Objetivo variado (credibilidade, diferenciais, chamada para orçamento, dica profissional, depoimento)
- Use no máximo 4 emojis por legenda, de forma natural
- Inclua 8 a 10 hashtags relevantes ao final de cada legenda, em linha separada
- CTA claro no final de cada legenda, incentivando contato pelo WhatsApp
- Cada legenda deve ser diferente das outras em estrutura e abertura, para não parecer repetitivo
- Escreva em português brasileiro, de forma natural e humana
- Tamanho ideal: 3 a 5 linhas de texto principal por legenda

Responda APENAS em formato JSON válido, sem markdown, sem texto antes ou depois, seguindo exatamente esta estrutura:
{
  "posts": [
    { "day": "Segunda-feira", "service": "Limpeza e Conservação", "caption": "texto da legenda completa aqui" },
    ... (7 itens no total, um por dia)
  ]
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data?.content?.find((c) => c.type === "text")?.text;

    if (!text) {
      return res.status(502).json({ error: "Resposta vazia da IA", raw: data });
    }

    // Remove possíveis blocos de markdown (```json ... ```) antes de parsear
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      return res
        .status(502)
        .json({ error: "Não foi possível interpretar a resposta da IA", raw: text });
    }

    if (!Array.isArray(parsed?.posts) || parsed.posts.length === 0) {
      return res.status(502).json({ error: "Formato inesperado na resposta da IA", raw: parsed });
    }

    // Anexa o horário sugerido a cada post, por posição
    const postsWithTime = parsed.posts.map((p, i) => ({
      ...p,
      suggestedTime: SUGGESTED_TIMES[i] || "12:00",
    }));

    return res.status(200).json({ posts: postsWithTime });
  } catch (err) {
    console.error("Erro ao gerar semana de posts:", err);
    return res.status(500).json({ error: err.message });
  }
}

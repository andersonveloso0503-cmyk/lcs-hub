// /api/generate-headline.js
// Gera um texto curto e criativo (sem a legenda completa) usado em dois
// lugares: o título de destaque desenhado sobre a foto no Editor de Fotos,
// e agora também o título/subtítulo do Criativo Estilo Card Escuro
// (Análise IA). O parâmetro "type" controla qual dos dois é gerado —
// padrão "headline" para não quebrar a chamada já existente do
// PhotoEditor.jsx, que não envia esse campo.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { service, type } = req.body || {};
    if (!service) {
      return res.status(400).json({ error: "Campo 'service' é obrigatório" });
    }

    const isSubtext = type === "subtext";

    const prompt = isSubtext
      ? `Você é especialista em marketing digital para a LCS Terceirização, empresa de Porto Alegre, RS que presta serviços de limpeza, portaria, facilities e manutenção para condomínios e empresas.
Crie UM subtítulo curto para um post de Instagram sobre o serviço "${service}". Esse subtítulo aparece abaixo de um título principal já em destaque, dando um complemento ou reforçando a urgência/benefício — é um texto secundário, menor.
Regras:
- Máximo 10 palavras
- Complementa um título de destaque, sem repetir as mesmas palavras dele
- Foca em benefício, urgência ou consequência prática para o cliente (ex: segurança, economia, tranquilidade, risco evitado)
- Direto, sem ser genérico tipo "Qualidade garantida"
- Sem emojis, sem hashtags, sem ponto final, sem aspas
- Em português brasileiro
Retorne APENAS o subtítulo, nada mais.`
      : `Você é especialista em marketing digital para a LCS Terceirização, empresa de Porto Alegre, RS que presta serviços de limpeza, portaria, facilities e manutenção para condomínios e empresas.
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

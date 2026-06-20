// /lib/blogGenerator.js
// Lógica de geração de posts de blog via Groq.
// NÃO é uma serverless function própria — é importado e chamado de dentro
// de whatsapp-webhook.js, pra não consumir mais uma function no limite do
// plano Hobby da Vercel (12 functions).

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{TITLE}} | LCS Terceirização</title>
<meta name="description" content="{{META_DESCRIPTION}}">
<meta name="author" content="LCS Terceirização">
<meta name="robots" content="index, follow">
<meta property="og:title" content="{{TITLE}}">
<meta property="og:description" content="{{META_DESCRIPTION}}">
<meta property="og:type" content="article">
<meta property="og:locale" content="pt_BR">
<link rel="canonical" href="https://lcsterceirizacaors.com.br/blog/{{SLUG}}.html">
<style>
  :root {
    --azul-escuro: #1A4763;
    --azul-medio: #3B6E91;
    --azul-claro: #EAF2F7;
    --texto: #33424F;
    --texto-claro: #5A6B7A;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: var(--texto); background: #FFFFFF; line-height: 1.7; }
  header.site { background: var(--azul-escuro); color: #FFFFFF; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  header.site a { color: #FFFFFF; text-decoration: none; font-weight: 700; font-size: 16px; }
  header.site .contato { font-size: 13px; opacity: 0.9; }
  main { max-width: 720px; margin: 0 auto; padding: 40px 20px 60px; }
  .breadcrumb { font-size: 13px; color: var(--texto-claro); margin-bottom: 18px; }
  .breadcrumb a { color: var(--azul-medio); text-decoration: none; }
  .meta-data { font-size: 13px; color: var(--texto-claro); margin-bottom: 8px; }
  h1 { font-size: 30px; line-height: 1.25; color: #13202E; margin: 0 0 18px; }
  h2 { font-size: 21px; color: var(--azul-escuro); margin: 32px 0 12px; }
  p { margin: 0 0 16px; font-size: 16px; }
  ul { margin: 0 0 16px; padding-left: 22px; }
  li { margin-bottom: 8px; font-size: 16px; }
  .cta-box { margin-top: 40px; padding: 24px; background: var(--azul-claro); border-radius: 12px; text-align: center; }
  .cta-box p { margin: 0 0 14px; font-weight: 600; color: #13202E; }
  .cta-box a { display: inline-block; background: #25D366; color: #FFFFFF; text-decoration: none; font-weight: 700; padding: 12px 24px; border-radius: 999px; font-size: 15px; }
  footer.site { background: #13202E; color: #AAB7C2; text-align: center; padding: 24px 20px; font-size: 13px; }
  footer.site a { color: #FFFFFF; }
</style>
</head>
<body>
<header class="site">
  <a href="https://lcsterceirizacaors.com.br/">LCS Terceirização</a>
  <span class="contato">📞 (51) 99889-3033</span>
</header>
<main>
  <p class="breadcrumb"><a href="https://lcsterceirizacaors.com.br/">Início</a> &nbsp;/&nbsp; <a href="https://lcsterceirizacaors.com.br/blog/">Blog</a></p>
  <p class="meta-data">Publicado em {{DATE}} · LCS Terceirização</p>
  <h1>{{TITLE}}</h1>
  <article>
    {{BODY}}
  </article>
  <div class="cta-box">
    <p>Quer um orçamento sem compromisso pra sua empresa ou condomínio?</p>
    <a href="https://wa.me/5551998893033?text=Olá!%20Vim%20pelo%20blog%20e%20gostaria%20de%20um%20orçamento." target="_blank" rel="noopener">
      Falar no WhatsApp
    </a>
  </div>
</main>
<footer class="site">
  <p>LCS Terceirização · Av. Juca Batista, 1700/201, Cavalhada, Porto Alegre - RS</p>
  <p><a href="mailto:lcs@lcsterceirizacao.com.br">lcs@lcsterceirizacao.com.br</a></p>
</footer>
</body>
</html>`;

function slugify(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 70);
}

function formatarDataPtBr() {
  return new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function extrairJson(textoBruto) {
  const limpo = textoBruto.replace(/```json|```/g, "").trim();
  return JSON.parse(limpo);
}

/**
 * Gera um post de blog completo a partir de um tema.
 * @param {string} tema
 * @returns {Promise<{title, metaDescription, slug, date, contentHtml}>}
 */
export async function gerarPostBlog(tema) {
  if (!tema || !tema.trim()) {
    throw new Error("Campo 'tema' é obrigatório.");
  }

  const prompt = `Você é redator de SEO da LCS Terceirização, empresa de Porto Alegre (RS) que presta serviços de limpeza, portaria/recepção e zeladoria para condomínios e empresas.

Escreva um post de blog sobre o tema: "${tema.trim()}"

Regras:
- Tom profissional, direto, sem enrolação, focado em ajudar quem administra um condomínio ou empresa a tomar uma decisão.
- 500 a 800 palavras no corpo do texto.
- Use HTML simples: <h2> para subtítulos, <p> para parágrafos, <ul><li> quando fizer sentido listar itens.
- NÃO inclua <h1>, não inclua tags <html>/<body>, não inclua call-to-action de WhatsApp (isso já é adicionado automaticamente depois).
- NÃO invente preços exatos em R$; fale em termos de fatores que influenciam o custo.

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, no formato exato:
{
  "title": "título do post, até 60 caracteres, com a palavra-chave principal",
  "metaDescription": "resumo de até 155 caracteres, atrativo, com a palavra-chave principal",
  "bodyHtml": "o corpo do post em HTML, conforme as regras acima"
}`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 2000,
  });

  const textoResposta = completion.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    parsed = extrairJson(textoResposta);
  } catch (parseErr) {
    console.error("Falha ao parsear JSON da Groq (blog):", textoResposta);
    throw new Error("A IA retornou um formato inesperado. Tente gerar novamente.");
  }

  if (!parsed.title || !parsed.metaDescription || !parsed.bodyHtml) {
    throw new Error("Resposta da IA incompleta (faltou título, meta ou corpo).");
  }

  const slug = slugify(parsed.title);
  const dataPublicacao = formatarDataPtBr();

  const contentHtml = TEMPLATE_HTML
    .replaceAll("{{TITLE}}", parsed.title)
    .replaceAll("{{META_DESCRIPTION}}", parsed.metaDescription)
    .replaceAll("{{BODY}}", parsed.bodyHtml)
    .replaceAll("{{DATE}}", dataPublicacao)
    .replaceAll("{{SLUG}}", slug);

  return {
    title: parsed.title,
    metaDescription: parsed.metaDescription,
    slug,
    date: dataPublicacao,
    contentHtml,
  };
}

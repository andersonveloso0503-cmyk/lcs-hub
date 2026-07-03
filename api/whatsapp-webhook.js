// /api/whatsapp-webhook.js
// Endpoint que a Evolution API chama quando uma mensagem é recebida (ou enviada).
// Configurar no Evolution Manager: Instância "lcs_crm" → Webhook → URL desta function.
//
// Salva a mensagem em Firestore na coleção "whatsapp_messages", usando o número
// de telefone (sem o sufixo @s.whatsapp.net) como chave de agrupamento da conversa.
//
// Mídia (áudio, imagem, documento/PDF) é enviada para o Vercel Blob e só a URL
// é salva no Firestore — documentos do Firestore têm limite de 1MB, e arquivos
// de mídia (especialmente PDFs de currículo) costumam passar disso facilmente.
//
// NOVO: depois de salvar e classificar a mensagem, o webhook também roda o
// agente de atendimento automático (menu Cliente / Funcionário / Orçamento /
// Currículo / Vendas) e envia as respostas via Evolution API.
//
// IMPORTANTE: a lógica do agente (que antes estava em api/lib/botFlow.js e
// api/lib/sendWhatsApp.js) foi trazida pra DENTRO deste arquivo de propósito.
// O plano Hobby da Vercel limita o deployment a 12 Serverless Functions, e
// cada arquivo dentro de api/ (incluindo api/lib/) conta como uma function —
// criar arquivos novos ali estourava esse limite. Função auxiliar nova =
// colocar aqui dentro, não criar arquivo novo em api/.

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  getDoc,
  setDoc,
  increment,
} from "firebase/firestore";
import { put } from "@vercel/blob";
import { detectStatusFromMessage, canAutoReclassify } from "./lib/classifyMessage.js";
import { GoogleAuth } from "google-auth-library";

const firebaseConfig = {
  apiKey: "AIzaSyAHOwdtTpZXVr_BNwG5x54gfEfD3PHSCVk",
  authDomain: "lcscrm.firebaseapp.com",
  projectId: "lcscrm",
  storageBucket: "lcscrm.firebasestorage.app",
  messagingSenderId: "539374293432",
  appId: "1:539374293432:web:a83bf9e10d22440c93bf4d",
};

const EVOLUTION_BASE_URL =
  process.env.EVOLUTION_BASE_URL ||
  "https://evolution-api-production-7c15.up.railway.app";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "lcs_crm";
const EVOLUTION_TOKEN = process.env.EVOLUTION_TOKEN || "251EAE7F1D35-423F-BD4A-5E79555F1521";

// URL pública (Vercel Blob) do PDF de apresentação da empresa, enviado
// automaticamente ao final do fluxo de orçamento.
const EMPRESA_PRESENTATION_URL = process.env.EMPRESA_PRESENTATION_URL || "";

// WhatsApp do especialista que recebe os dados de cada orçamento finalizado.
const ESPECIALISTA_WHATSAPP = process.env.ESPECIALISTA_WHATSAPP || "5551985025102";

// URLs públicas (Vercel Blob) dos PDFs de proposta por serviço/modalidade.
// Configure cada uma como variável de ambiente no Vercel após subir os PDFs no Blob.
const PDF_PROPOSTAS = {
  portaria_24h:       process.env.PDF_PORTARIA_24H       || "",
  portaria_12h:       process.env.PDF_PORTARIA_12H       || "",
  limpeza_8h_sexta:   process.env.PDF_LIMPEZA_8H_SEXTA   || "",
  limpeza_8h_sabado:  process.env.PDF_LIMPEZA_8H_SABADO  || "",
  limpeza_4h_sabado:  process.env.PDF_LIMPEZA_4H_SABADO  || "",
  limpeza_4h_sexta:   process.env.PDF_LIMPEZA_4H_SEXTA   || "",
  zeladoria_8h_sabado:process.env.PDF_ZELADORIA_8H_SABADO|| "",
};
// Projeto Firebase para envio de push notifications (FCM)
const FCM_PROJECT_ID = "lcscrm";

async function getFcmAccessToken() {
  const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/**
 * Dispara push notification pros dispositivos cadastrados e incrementa
 * o contador de não lidas no Firestore. Chamar quando o CLIENTE manda
 * mensagem (branch onde fromMe === false).
 */
async function notificarNovaMensagemWhatsApp({ db, phone, pushName, texto }) {
  try {
    const unreadRef = doc(db, "whatsapp_status", "unread");
    await setDoc(
      unreadRef,
      { count: increment(1), atualizadoEm: serverTimestamp() },
      { merge: true }
    );
    const unreadSnap = await getDoc(unreadRef);
    const unreadCount = unreadSnap.exists() ? unreadSnap.data().count || 1 : 1;

    const tokensSnap = await getDocs(collection(db, "fcm_tokens"));
    if (tokensSnap.empty) return;

    const accessToken = await getFcmAccessToken();
    const nome = pushName || phone;
    const corpoMsg =
      texto && texto.length > 80 ? texto.slice(0, 80) + "..." : texto || "Nova mensagem";

    const envios = tokensSnap.docs.map(async (tokenDoc) => {
      const token = tokenDoc.id;
      const body = {
        message: {
          token,
          notification: {
            title: `💬 ${nome}`,
            body: corpoMsg,
          },
          data: {
            unreadCount: String(unreadCount),
            phone: String(phone),
          },
          webpush: {
            headers: { Urgency: "high" },
            fcm_options: { link: "/?tab=whatsapp" },
          },
        },
      };

      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Erro ao enviar push (token ${token.slice(0, 12)}...):`, errText);
        if (res.status === 404 || res.status === 400) {
          await updateDoc(doc(db, "fcm_tokens", token), { invalido: true }).catch(() => {});
        }
      }
    });

    await Promise.allSettled(envios);
  } catch (err) {
    console.error("Erro em notificarNovaMensagemWhatsApp:", err);
  }
}
/**
 * Monta a mensagem com todos os dados coletados no fluxo de orçamento, pra
 * mandar pro especialista (Luís) assim que o cliente termina de responder.
 * Formato em estilo "recibo": cabeçalho da empresa, divisórias e campos
 * alinhados, fácil de ler rápido no WhatsApp.
 */
function formatarTelefoneExibicao(raw) {
  const digits = (raw || "").toString().replace(/\D/g, "");
  // Espera formato 55DDXXXXXXXXX (13 dígitos, com 9 na frente do número)
  if (digits.length === 13) {
    const ddd = digits.slice(2, 4);
    const parte1 = digits.slice(4, 9);
    const parte2 = digits.slice(9);
    return `(${ddd}) ${parte1}-${parte2}`;
  }
  if (digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const parte1 = digits.slice(4, 8);
    const parte2 = digits.slice(8);
    return `(${ddd}) ${parte1}-${parte2}`;
  }
  return raw;
}

function formatarDataHoraPtBr() {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function buildEspecialistaMessage({ phone, pushName, data }) {
  const linhas = [
    "🧾 *LCS TERCEIRIZAÇÃO*",
    "_Novo Pedido de Orçamento_",
    "━━━━━━━━━━━━━━━━━━━",
    `🗓️ ${formatarDataHoraPtBr()}`,
    "",
    "*👤 Cliente*",
    pushName || "(sem nome)",
    formatarTelefoneExibicao(phone),
    "",
    "*🧹 Serviço*",
    data.servico,
  ];

  if (data.tipoPortaria) linhas.push(`Tipo de portaria: ${data.tipoPortaria}`);
  linhas.push(`Carga horária: ${data.cargaHoraria}`);

  linhas.push("", "*📍 Endereço*", data.endereco);

  linhas.push("", "*📋 Detalhes*");
  linhas.push(`Visita técnica: ${data.visitaTecnica ? "Sim ✅" : "Não"}`);
  if (data.insalubridade) linhas.push(`Insalubridade: ${data.insalubridade}`);

  linhas.push("━━━━━━━━━━━━━━━━━━━", "_Atendimento via bot WhatsApp_");

  return linhas.join("\n");
}

// Status que, se já estiverem no contato, fazem o agente de IA ficar
// completamente em silêncio (o atendimento já é humano) — diferente de
// "funcionario", que continua usando o submenu de autoatendimento.
const BOT_SKIP_STATUSES = ["cliente", "contrato"];

function getDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

// ============================================================================
// Gerador de posts de Blog (antes em api/lib/blogGenerator.js)
// ============================================================================
// Mesmo motivo do comentário no topo do arquivo: trazido pra dentro daqui
// pra não criar mais um arquivo em api/ e estourar o limite de 12 Serverless
// Functions do plano Hobby. Chamado via action: "generate_blog_post" no
// próprio handler deste webhook.

// (Groq é chamado via fetch direto na API REST — sem dependência de SDK,
// pra não precisar instalar pacote novo nem adicionar nada ao package.json)

const BLOG_TEMPLATE_HTML = `<!DOCTYPE html>
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

function slugifyBlogTitle(texto) {
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

function extrairJsonDaResposta(textoBruto) {
  const limpo = textoBruto.replace(/```json|```/g, "").trim();

  // Tenta o parse direto primeiro (caso a IA já tenha retornado JSON válido)
  try {
    return JSON.parse(limpo);
  } catch (_) {
    // segue para a versão "corrigida" abaixo
  }

  // A IA às vezes devolve quebras de linha reais dentro dos valores das
  // strings (ex: dentro de "bodyHtml"), o que invalida o JSON — JSON exige
  // que isso seja escapado como \n. Aqui percorremos o texto caractere a
  // caractere e escapamos quebras de linha que estejam DENTRO de uma
  // string (entre aspas), preservando as que estão fora (formatação do
  // próprio JSON, que são inofensivas).
  let dentroDeString = false;
  let escapeProximo = false;
  let corrigido = "";

  for (let i = 0; i < limpo.length; i++) {
    const char = limpo[i];

    if (escapeProximo) {
      corrigido += char;
      escapeProximo = false;
      continue;
    }

    if (char === "\\") {
      corrigido += char;
      escapeProximo = true;
      continue;
    }

    if (char === '"') {
      dentroDeString = !dentroDeString;
      corrigido += char;
      continue;
    }

    if (dentroDeString && (char === "\n" || char === "\r")) {
      corrigido += "\\n";
      continue;
    }

    corrigido += char;
  }

  return JSON.parse(corrigido);
}

async function gerarPostBlog(tema) {
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

Responda SOMENTE com um JSON válido, em uma única linha, sem nenhum texto antes ou depois e sem quebras de linha reais dentro dos valores (use \\n se precisar separar parágrafos dentro de bodyHtml), no formato exato:
{
  "title": "título do post, até 60 caracteres, com a palavra-chave principal",
  "metaDescription": "resumo de até 155 caracteres, atrativo, com a palavra-chave principal",
  "bodyHtml": "o corpo do post em HTML, conforme as regras acima"
}`;

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!groqResponse.ok) {
    const errBody = await groqResponse.text();
    console.error("Erro na chamada à Groq (blog):", groqResponse.status, errBody);
    throw new Error("Falha ao chamar a IA (Groq). Verifique a GROQ_API_KEY.");
  }

  const completion = await groqResponse.json();
  const textoResposta = completion.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    parsed = extrairJsonDaResposta(textoResposta);
  } catch (parseErr) {
    console.error("Falha ao parsear JSON da Groq (blog):", textoResposta);
    throw new Error("A IA retornou um formato inesperado. Tente gerar novamente.");
  }

  if (!parsed.title || !parsed.metaDescription || !parsed.bodyHtml) {
    throw new Error("Resposta da IA incompleta (faltou título, meta ou corpo).");
  }

  const slug = slugifyBlogTitle(parsed.title);
  const dataPublicacao = formatarDataPtBr();

  const contentHtml = BLOG_TEMPLATE_HTML
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

// ============================================================================
// Agente de IA — motor de menus (antes em api/lib/botFlow.js)
// ============================================================================

function normalize(text) {
  return (text || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isYes(text) {
  const t = normalize(text);
  return t === "sim" || t === "s" || t.startsWith("sim") || ["claro", "pode", "quero", "isso"].includes(t);
}

function isNo(text) {
  const t = normalize(text);
  return t === "nao" || t === "n" || t.startsWith("nao");
}

function isMenuCommand(text) {
  const t = normalize(text);
  return ["menu", "voltar", "inicio", "0"].includes(t);
}

function greetingWord() {
  const utcHour = new Date().getUTCHours();
  const hour = (utcHour - 3 + 24) % 24;
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

const MAIN_MENU_OPTIONS_TEXT =
  "1 - Já sou Cliente\n" +
  "2 - Sou Funcionário\n" +
  "3 - Quero um Orçamento\n" +
  "4 - Enviar Currículo\n" +
  "5 - Quero vender para a empresa\n\n" +
  "Digite o número da opção desejada.";

function mainMenuMessage(pushName) {
  const nome = pushName ? `, ${pushName}` : "";
  return (
    `${greetingWord()}${nome}! 👋 Bem-vindo à *LCS Terceirização*.\n\n` +
    `Como posso te ajudar hoje?\n\n${MAIN_MENU_OPTIONS_TEXT}`
  );
}

const FUNCIONARIO_MENU_TEXT =
  "Área do Colaborador 👷\n\nO que você precisa?\n\n" +
  "1 - Escala de Trabalho\n" +
  "2 - Holerite / Pagamento\n" +
  "3 - Benefícios\n" +
  "4 - Férias ou Folga\n" +
  "5 - Reportar Urgência\n" +
  "0 - Voltar ao Menu Principal";

const FUNCIONARIO_RESPOSTAS = {
  "1": "📅 *Escala de Trabalho*\n\nPor favor, informe seu *nome completo* e *matrícula*. Nosso RH retorna em até 2 horas úteis.\n\nDigite *menu* para voltar.",
  "2": "💵 *Holerite / Pagamento*\n\nPagamentos são feitos todo dia 5. Informe sua matrícula e o mês de referência que você precisa consultar.\n\nDigite *menu* para voltar.",
  "3": "🏥 *Benefícios*\n\nInforme qual benefício você quer consultar (vale-transporte, plano de saúde, etc) e sua matrícula.\n\nDigite *menu* para voltar.",
  "4": "📋 *Férias ou Folga*\n\nInforme seu nome completo, matrícula e o período desejado. O RH vai analisar e retornar.\n\nDigite *menu* para voltar.",
  "5": "🆘 *Urgência*\n\nDescreva rapidamente o que está acontecendo. Se for uma emergência grave, ligue diretamente para o setor operacional.\n\nDigite *menu* para voltar.",
};

const ORCAMENTO_MENU_TEXT =
  "Vamos preparar seu orçamento! 💰\n\nQual serviço você precisa?\n\n" +
  "1 - Limpeza\n" +
  "2 - Portaria\n" +
  "3 - Zeladoria\n" +
  "0 - Voltar ao Menu Principal";

const SERVICOS_ORCAMENTO = { "1": "Limpeza", "2": "Portaria", "3": "Zeladoria" };

const TIPO_PORTARIA_PERGUNTA =
  "Qual tipo de portaria você precisa?\n\n1 - Portaria 24 horas\n2 - Portaria 12 horas\n3 - Portaria Virtual";
const TIPOS_PORTARIA = { "1": "Portaria 24 horas", "2": "Portaria 12 horas", "3": "Portaria Virtual" };

const CARGA_HORARIA_PERGUNTA = "Qual a carga horária desejada? (ex: 6h, 8h, 12x36, segunda a sábado, etc)";
const ENDERECO_PERGUNTA = "Qual o endereço onde o serviço será prestado?";
const VISITA_TECNICA_PERGUNTA = "Gostaria de agendar uma visita técnica antes do orçamento? (Sim/Não)";
const INSALUBRIDADE_PERGUNTA = "O serviço inclui limpeza de banheiros ou retirada de lixo? (Sim/Não)";

const VENDAS_MENU_TEXT =
  "Parceiros e Fornecedores 🤝\n\nQual categoria você representa?\n\n" +
  "1 - Produtos de Limpeza e EPI\n" +
  "2 - Uniformes e Fardamentos\n" +
  "3 - Tecnologia e Sistemas\n" +
  "4 - Outros Produtos / Serviços\n" +
  "0 - Voltar ao Menu Principal";

const VENDAS_CATEGORIAS = {
  "1": "Produtos de Limpeza e EPI",
  "2": "Uniformes e Fardamentos",
  "3": "Tecnologia e Sistemas",
  "4": "Outros Produtos / Serviços",
};

function emptyState() {
  return { menu: "main", step: 0, data: {} };
}

// Quantas vezes seguidas o bot pode mandar o menu principal sem a pessoa
// escolher uma opção válida, antes de desistir e ficar em silêncio. Evita
// ficar respondendo em loop quando quem está do outro lado é um número que
// manda mensagem automática (propaganda, robô, etc) e não vai escolher nada.
const MAX_UNANSWERED_GREETINGS = 2;

function processMessage({ text, pushName, state }) {
  const incoming = (text || "").trim();
  const current = state && state.menu ? state : emptyState();

  if (isMenuCommand(incoming) && current.menu !== "main") {
    return { replies: [mainMenuMessage(pushName)], newState: emptyState() };
  }

  switch (current.menu) {
    case "funcionario":
      return handleFuncionarioMenu(incoming);
    case "orcamento":
      return handleOrcamentoMenu(incoming);
    case "orcamento_fluxo":
      return handleOrcamentoFluxo(incoming, current);
    case "curriculo_aguardando":
      return handleCurriculoAguardando(incoming, current);
    case "vendas":
      return handleVendasMenu(incoming);
    case "main":
    default:
      return handleMainMenu(incoming, pushName, current);
  }
}

function handleMainMenu(incoming, pushName, current) {
  if (!["1", "2", "3", "4", "5"].includes(incoming)) {
    const greetCount = (current?.greetCount || 0) + 1;

    if (greetCount > MAX_UNANSWERED_GREETINGS) {
      // Já mandamos o menu algumas vezes e a pessoa nunca escolheu uma opção
      // válida — provavelmente é uma mensagem automática (propaganda, robô,
      // número errado). Agradece, encerra e fica em silêncio pra não ficar
      // respondendo em loop.
      return {
        replies: [
          "Agradecemos o contato! 🙏 Se precisar de algo, é só mandar *menu* por aqui que a gente te ajuda.",
        ],
        newState: { ...emptyState(), paused: true, pausedReason: "sem_resposta_valida" },
      };
    }

    return {
      replies: [mainMenuMessage(pushName)],
      newState: { menu: "main", step: 0, data: {}, greetCount },
    };
  }

  if (incoming === "1") {
    return {
      replies: [
        "Que bom te ter como cliente da LCS! 😊 Vou conectar você direto com nossa equipe de atendimento, só um instante.",
      ],
      newState: { ...emptyState(), paused: true },
      statusUpdate: "cliente",
    };
  }

  if (incoming === "2") {
    return {
      replies: [FUNCIONARIO_MENU_TEXT],
      newState: { menu: "funcionario", step: 0, data: {} },
      statusUpdate: "funcionario",
    };
  }

  if (incoming === "3") {
    return { replies: [ORCAMENTO_MENU_TEXT], newState: { menu: "orcamento", step: 0, data: {} } };
  }

  if (incoming === "4") {
    return {
      replies: [
        "Que ótimo seu interesse em fazer parte da equipe LCS! 📋\n\n" +
          "Me conta seu *nome completo* e a *vaga ou área* de interesse. Em seguida, envie seu currículo em PDF aqui mesmo no chat 📎",
      ],
      newState: { menu: "curriculo_aguardando", step: 0, data: {} },
      statusUpdate: "curriculo",
    };
  }

  return { replies: [VENDAS_MENU_TEXT], newState: { menu: "vendas", step: 0, data: {} } };
}

function handleFuncionarioMenu(incoming) {
  if (incoming === "0") {
    return { replies: [mainMenuMessage()], newState: emptyState() };
  }
  const resposta = FUNCIONARIO_RESPOSTAS[incoming];
  if (!resposta) {
    return { replies: ["Não entendi 🤔\n\n" + FUNCIONARIO_MENU_TEXT], newState: { menu: "funcionario", step: 0, data: {} } };
  }
  return { replies: [resposta], newState: { menu: "funcionario", step: 0, data: {} } };
}

function handleOrcamentoMenu(incoming) {
  if (incoming === "0") {
    return { replies: [mainMenuMessage()], newState: emptyState() };
  }

  // Se pedir email
  const incomingLower = incoming.toLowerCase();
  if (
    incomingLower.includes("email") ||
    incomingLower.includes("e-mail") ||
    incomingLower.includes("manda no email") ||
    incomingLower.includes("enviar por email")
  ) {
    return {
      replies: [
        "Claro! 📧 Você pode enviar sua solicitação de orçamento diretamente para o nosso e-mail:\n\n" +
        "*lcs@lcsterceirizacao.com.br*\n\n" +
        "Nossa equipe retornará em breve com todos os detalhes. 😊",
      ],
      newState: emptyState(),
    };
  }

  const servico = SERVICOS_ORCAMENTO[incoming];
  if (!servico) {
    return { replies: ["Não entendi 🤔\n\n" + ORCAMENTO_MENU_TEXT], newState: { menu: "orcamento", step: 0, data: {} } };
  }

  if (servico === "Portaria") {
    return { replies: [TIPO_PORTARIA_PERGUNTA], newState: { menu: "orcamento_fluxo", step: 1, data: { servico } } };
  }

  return { replies: [CARGA_HORARIA_PERGUNTA], newState: { menu: "orcamento_fluxo", step: 2, data: { servico } } };
}

function handleOrcamentoFluxo(incoming, state) {
  const data = { ...state.data };
  const servico = data.servico;

  // Se o cliente pedir envio por email em qualquer etapa do fluxo
  const incomingLower = incoming.toLowerCase();
  if (
    incomingLower.includes("email") ||
    incomingLower.includes("e-mail") ||
    incomingLower.includes("correio") ||
    incomingLower.includes("mandar por email") ||
    incomingLower.includes("enviar por email") ||
    incomingLower.includes("manda no email")
  ) {
    return {
      replies: [
        "Claro! 📧 Você pode enviar sua solicitação de orçamento diretamente para o nosso e-mail:\n\n" +
        "*lcs@lcsterceirizacao.com.br*\n\n" +
        "Nossa equipe retornará em breve com todos os detalhes. 😊\n\n" +
        "Se preferir continuar aqui pelo WhatsApp, é só me dizer o serviço desejado!",
      ],
      newState: emptyState(),
    };
  }

  if (state.step === 1) {
    const tipo = TIPOS_PORTARIA[incoming];
    if (!tipo) {
      return { replies: ["Não entendi 🤔\n\n" + TIPO_PORTARIA_PERGUNTA], newState: state };
    }
    data.tipoPortaria = tipo;
    return { replies: [CARGA_HORARIA_PERGUNTA], newState: { menu: "orcamento_fluxo", step: 2, data } };
  }

  if (state.step === 2) {
    data.cargaHoraria = incoming;
    return { replies: [ENDERECO_PERGUNTA], newState: { menu: "orcamento_fluxo", step: 3, data } };
  }

  if (state.step === 3) {
    data.endereco = incoming;
    return { replies: [VISITA_TECNICA_PERGUNTA], newState: { menu: "orcamento_fluxo", step: 4, data } };
  }

  if (state.step === 4) {
    if (!isYes(incoming) && !isNo(incoming)) {
      return { replies: ["Não entendi 🤔\n\n" + VISITA_TECNICA_PERGUNTA], newState: state };
    }
    data.visitaTecnica = isYes(incoming);

    if (servico === "Portaria") {
      return finalizarOrcamento(data);
    }
    return { replies: [INSALUBRIDADE_PERGUNTA], newState: { menu: "orcamento_fluxo", step: 5, data } };
  }

  if (state.step === 5) {
    if (!isYes(incoming) && !isNo(incoming)) {
      return { replies: ["Não entendi 🤔\n\n" + INSALUBRIDADE_PERGUNTA], newState: state };
    }
    data.banheirosOuLixo = isYes(incoming);
    data.insalubridade = data.banheirosOuLixo ? "40%" : "20%";
    return finalizarOrcamento(data);
  }

  return { replies: [mainMenuMessage()], newState: emptyState() };
}

function finalizarOrcamento(data) {
  return {
    replies: [
      "Show, anotei tudo! ✅ Já estamos encaminhando para nossos especialistas — em breve eles entrarão em contato com você.\n\nEnquanto isso, segue nossa apresentação:",
    ],
    newState: emptyState(),
    statusUpdate: "lead",
    sendDocument: "apresentacao_empresa",
    saveQuote: data,
  };
}

/**
 * Determina qual PDF de proposta enviar com base no serviço e carga horária.
 * Retorna { url, fileName } ou null se não houver correspondência.
 */
function selecionarPdfProposta(data) {
  const servico = (data.servico || "").toLowerCase();
  const carga = (data.cargaHoraria || "").toLowerCase();
  const tipo = (data.tipoPortaria || "").toLowerCase();

  if (servico === "portaria") {
    if (tipo.includes("24")) return { url: PDF_PROPOSTAS.portaria_24h, fileName: "Proposta_Portaria_24h_LCS.pdf" };
    if (tipo.includes("12")) return { url: PDF_PROPOSTAS.portaria_12h, fileName: "Proposta_Portaria_12h_LCS.pdf" };
  }

  if (servico === "limpeza") {
    const isSabado = carga.includes("sáb") || carga.includes("sab") || carga.includes("44h") || carga.includes("44 h");
    const is8h = carga.includes("8");
    const is4h = carga.includes("4");
    if (is8h && isSabado) return { url: PDF_PROPOSTAS.limpeza_8h_sabado,  fileName: "Proposta_Limpeza_8h_SegSab_LCS.pdf" };
    if (is8h)             return { url: PDF_PROPOSTAS.limpeza_8h_sexta,   fileName: "Proposta_Limpeza_8h_SegSex_LCS.pdf" };
    if (is4h && isSabado) return { url: PDF_PROPOSTAS.limpeza_4h_sabado,  fileName: "Proposta_Limpeza_4h_SegSab_LCS.pdf" };
    if (is4h)             return { url: PDF_PROPOSTAS.limpeza_4h_sexta,   fileName: "Proposta_Limpeza_4h_SegSex_LCS.pdf" };
  }

  if (servico === "zeladoria") {
    return { url: PDF_PROPOSTAS.zeladoria_8h_sabado, fileName: "Proposta_Zeladoria_8h_SegSab_LCS.pdf" };
  }

  return null; // fallback: nenhum PDF mapeado → envia mensagem genérica
}

/**
 * Envia a proposta personalizada após 4 minutos da apresentação.
 * Roda de forma assíncrona — não bloqueia o fluxo principal do webhook.
 * Se não houver PDF mapeado, envia mensagem de que o orçamento está sendo elaborado.
 */
async function agendarEnvioProposta({ phone, data }) {
  await new Promise((resolve) => setTimeout(resolve, 4 * 60 * 1000)); // aguarda 4 min

  const proposta = selecionarPdfProposta(data);
  const servico = data.servico || "serviço";

  try {
    if (proposta && proposta.url) {
      // PDF específico encontrado — envia mensagem + documento
      const msgProposta =
        `Olá! 😊 Conforme prometido, segue a proposta comercial da *LCS Terceirização* para o serviço de *${servico}*.\n\n` +
        `📋 Incluído na proposta:\n` +
        `• Funcionário(s) uniformizado(s)\n` +
        `• Regime CLT com todos os encargos\n` +
        `• Troca imediata em caso de falta\n` +
        `• Supervisão diária\n` +
        `• Nota Fiscal\n` +
        `• Todos os documentos e impostos incluídos\n\n` +
        `🔒 Além disso, trabalhamos com soluções complementares de segurança:\n` +
        `• CFTV — câmeras de monitoramento\n` +
        `• Leitores de placa veicular\n` +
        `• Biometria facial\n` +
        `_Esses serviços podem ser orçados separadamente conforme sua necessidade._\n\n` +
        `Qualquer dúvida ou ajuste necessário, é só nos chamar! 🤝\n` +
        `📞 (51) 3058-6391 / 99889-3033`;

      await sendText(phone, msgProposta);
      await sendDocumentFromUrl(phone, proposta.url, proposta.fileName, "📄 Proposta Comercial LCS Terceirização");
    } else {
      // Nenhum PDF específico — envia mensagem de que o orçamento está sendo elaborado
      const msgGenerica =
        `Olá! 😊 Estamos finalizando o orçamento personalizado para o serviço de *${servico}* solicitado.\n\n` +
        `Em breve nossa equipe entrará em contato com todos os detalhes e valores. ⏳\n\n` +
        `🔒 Enquanto isso, saiba que além do serviço solicitado, trabalhamos também com:\n` +
        `• CFTV — câmeras de monitoramento\n` +
        `• Leitores de placa veicular\n` +
        `• Biometria facial\n` +
        `_Esses serviços podem ser orçados separadamente, caso tenha interesse._\n\n` +
        `Obrigado pela preferência! Qualquer dúvida, estamos à disposição. 🤝\n` +
        `📞 (51) 3058-6391 / 99889-3033`;

      await sendText(phone, msgGenerica);
    }
  } catch (err) {
    console.error("Erro ao enviar proposta agendada:", err);
  }
}

function handleCurriculoAguardando(incoming, state) {
  return {
    replies: [
      "Anotado! Agora é só enviar seu currículo em PDF por aqui mesmo no chat 📎. " +
        "Assim que recebermos, nossa equipe de RH vai dar retorno.",
    ],
    newState: { menu: "curriculo_aguardando", step: 0, data: { ...state.data, infoTexto: incoming } },
  };
}

function curriculoRecebidoMensagem() {
  return (
    "Recebemos seu currículo! 🙌 Nossa equipe de RH vai analisar e entrar em contato caso haja uma " +
    "vaga compatível com seu perfil. Obrigado pelo interesse em fazer parte da LCS!"
  );
}

function handleVendasMenu(incoming) {
  if (incoming === "0") {
    return { replies: [mainMenuMessage()], newState: emptyState() };
  }
  const categoria = VENDAS_CATEGORIAS[incoming];
  if (!categoria) {
    return { replies: ["Não entendi 🤔\n\n" + VENDAS_MENU_TEXT], newState: { menu: "vendas", step: 0, data: {} } };
  }
  return {
    replies: [
      `Anotado! Categoria: *${categoria}*.\n\n` +
        "Por favor, envie uma breve apresentação da sua empresa/produto e um contato comercial. " +
        "Nosso setor de compras vai analisar e retornar caso haja interesse. Obrigado! 🤝",
    ],
    newState: emptyState(),
    saveSupplierCategory: categoria,
  };
}

// ============================================================================
// Envio via Evolution API (antes em api/lib/sendWhatsApp.js)
// ============================================================================

function normalizePhoneForSend(raw) {
  if (!raw) return "";
  let digits = raw.toString().replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

async function sendText(toPhone, text) {
  const number = normalizePhoneForSend(toPhone);
  if (!number || !text) return { ok: false, error: "Número ou texto vazio" };

  try {
    const res = await fetch(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
      body: JSON.stringify({ number, text }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || "Erro ao enviar mensagem" };
    return { ok: true, data };
  } catch (err) {
    console.error("Erro ao enviar texto via Evolution API:", err);
    return { ok: false, error: err.message };
  }
}

async function sendTextSequence(toPhone, texts) {
  const results = [];
  for (const text of texts) {
    results.push(await sendText(toPhone, text));
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return results;
}

async function sendDocumentFromUrl(toPhone, url, fileName, caption) {
  const number = normalizePhoneForSend(toPhone);
  if (!number || !url) return { ok: false, error: "Número ou URL vazio" };

  try {
    const res = await fetch(`${EVOLUTION_BASE_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
      body: JSON.stringify({
        number,
        mediatype: "document",
        media: url,
        fileName: fileName || "documento.pdf",
        caption: caption || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || "Erro ao enviar documento" };
    return { ok: true, data };
  } catch (err) {
    console.error("Erro ao enviar documento via Evolution API:", err);
    return { ok: false, error: err.message };
  }
}

// ============================================================================
// Classificação automática por palavra-chave (já existia)
// ============================================================================

async function applyAutoClassification({ db, phone, pushName, text, type, fileName }) {
  const newStatus = detectStatusFromMessage({ text, type, fileName });
  if (!newStatus) return;

  const contactsRef = collection(db, "contacts");
  const q = query(contactsRef, where("whatsapp", "==", phone));
  const snap = await getDocs(q);

  if (snap.empty) {
    await addDoc(contactsRef, {
      name: pushName || "",
      whatsapp: phone,
      status: newStatus,
      service: "Limpeza",
      type: "Empresa",
      createdAt: serverTimestamp(),
      lastContactAt: serverTimestamp(),
      autoClassified: true,
    });
    return;
  }

  const existing = snap.docs[0];
  const currentStatus = existing.data().status || "";

  if (!canAutoReclassify(currentStatus)) return;
  if (currentStatus === newStatus) return;

  await updateDoc(doc(db, "contacts", existing.id), {
    status: newStatus,
    lastContactAt: serverTimestamp(),
  });
}

async function findContactByPhone(db, phone) {
  const contactsRef = collection(db, "contacts");
  const q = query(contactsRef, where("whatsapp", "==", phone));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function upsertContactFromBot(db, phone, pushName, status, extraFields = {}) {
  const contactsRef = collection(db, "contacts");
  const q = query(contactsRef, where("whatsapp", "==", phone));
  const snap = await getDocs(q);

  if (snap.empty) {
    await addDoc(contactsRef, {
      name: pushName || "",
      whatsapp: phone,
      status: status || "",
      service: extraFields.service || "Limpeza",
      type: "Empresa",
      createdAt: serverTimestamp(),
      lastContactAt: serverTimestamp(),
      autoClassified: true,
      ...extraFields,
    });
    return;
  }

  const existing = snap.docs[0];
  const currentStatus = existing.data().status || "";
  const updates = { lastContactAt: serverTimestamp(), ...extraFields };

  if (status && (canAutoReclassify(currentStatus) || currentStatus === status)) {
    updates.status = status;
  }

  await updateDoc(doc(db, "contacts", existing.id), updates);
}

async function runBotFlow({ db, phone, pushName, messageDoc }) {
  const stateRef = doc(db, "bot_state", phone);
  const stateSnap = await getDoc(stateRef);
  const state = stateSnap.exists() ? stateSnap.data() : null;

  // Se estiver pausado (ex: um atendente humano assumiu a conversa), o bot
  // fica em silêncio — a não ser que a pessoa mande "menu"/"voltar", caso em
  // que entendemos que ela quer retomar o atendimento automático.
  const wantsToResume = messageDoc.type === "text" && isMenuCommand(messageDoc.text);
  if (state?.paused && !wantsToResume) return;

  if (messageDoc.type === "document" && state?.menu === "curriculo_aguardando") {
    await sendTextSequence(phone, [curriculoRecebidoMensagem()]);
    await setDoc(stateRef, {
      menu: "main",
      step: 0,
      data: {},
      paused: false,
      curriculoRecebido: true,
      lastBotSentAt: Date.now(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  if (messageDoc.type !== "text") return;

  // Currículo já recebido anteriormente: a pessoa escrevendo de novo (texto
  // qualquer) recebe só o agradecimento de novo, sem reabrir o menu ou
  // qualquer outro fluxo. Só "menu"/"voltar" tira a pessoa desse estado.
  const wantsMenuAfterCurriculo = isMenuCommand(messageDoc.text);
  if (state?.curriculoRecebido && !wantsMenuAfterCurriculo) {
    await sendTextSequence(phone, [
      "Já recebemos seu currículo! 🙌 Agradecemos o interesse em fazer parte da LCS — nossa equipe de RH " +
        "vai analisar e entra em contato caso surja uma vaga compatível com seu perfil.",
    ]);
    await setDoc(stateRef, { lastBotSentAt: Date.now(), updatedAt: serverTimestamp() }, { merge: true });
    return;
  }

  const result = processMessage({ text: messageDoc.text, pushName, state });

  let sentMessageIds = [];
  if (result.replies?.length) {
    // Marca o horário ANTES de enviar — assim, se o eco da própria mensagem
    // do bot voltar pelo webhook rapidinho, já encontra esse valor salvo.
    await setDoc(stateRef, { lastBotSentAt: Date.now() }, { merge: true });
    const sendResults = await sendTextSequence(phone, result.replies);
    sentMessageIds = sendResults
      .map((r) => r?.data?.key?.id)
      .filter(Boolean);
  }

  await setDoc(stateRef, {
    menu: result.newState.menu,
    step: result.newState.step,
    data: result.newState.data || {},
    paused: !!result.newState.paused,
    greetCount: result.newState.greetCount || 0,
    lastBotSentAt: Date.now(),
    lastBotMessageIds: sentMessageIds,
    updatedAt: serverTimestamp(),
  });

  if (result.statusUpdate) {
    await upsertContactFromBot(db, phone, pushName, result.statusUpdate);
  }

  if (result.sendDocument === "apresentacao_empresa") {
    if (EMPRESA_PRESENTATION_URL) {
      await sendDocumentFromUrl(phone, EMPRESA_PRESENTATION_URL, "Apresentacao-LCS-Terceirizacao.pdf");
    } else {
      console.warn("EMPRESA_PRESENTATION_URL não configurada — apresentação não enviada.");
    }
  }

  if (result.saveQuote) {
    await addDoc(collection(db, "orcamentos"), {
      phone,
      pushName: pushName || "",
      ...result.saveQuote,
      propostaEnviada: false,
      propostaPendenteSince: Date.now(),
      createdAt: serverTimestamp(),
    });
    await upsertContactFromBot(db, phone, pushName, "lead", { service: result.saveQuote.servico });

    try {
      const especialistaMsg = buildEspecialistaMessage({ phone, pushName, data: result.saveQuote });
      await sendText(ESPECIALISTA_WHATSAPP, especialistaMsg);
    } catch (notifyErr) {
      console.error("Erro ao notificar especialista sobre o orçamento:", notifyErr);
    }
  }

  if (result.saveSupplierCategory) {
    await upsertContactFromBot(db, phone, pushName, null, {
      tipo: "fornecedor",
      categoriaFornecedor: result.saveSupplierCategory,
    });
  }
}

// Quanto tempo (em ms) depois de o bot mandar uma mensagem ainda consideramos
// que um evento "fromMe" recebido é só o eco da própria mensagem do bot
// voltando pelo webhook, e não um atendente digitando na mão.
const BOT_ECHO_WINDOW_MS = 10000;

/**
 * Roda para toda mensagem ENVIADA pela LCS (fromMe: true). Se não for o eco
 * de uma mensagem que o próprio bot mandou, entendemos que foi um atendente
 * humano respondendo manualmente (pelo app do WhatsApp Business ou pelo
 * CRM) e pausamos o agente nesse contato.
 */
async function handlePossibleHumanIntervention({ db, phone, messageId, messageTimestamp }) {
  const stateRef = doc(db, "bot_state", phone);
  const stateSnap = await getDoc(stateRef);

  // Se não existe nenhum estado ainda, é porque a LCS está iniciando a
  // conversa com esse número pela primeira vez. Criamos já como pausado —
  // o bot não vai entrar nesse atendimento a não ser que alguém mande "menu".
  if (!stateSnap.exists()) {
    await setDoc(stateRef, {
      menu: "main",
      step: 0,
      data: {},
      paused: true,
      pausedReason: "conversa_iniciada_pela_lcs",
      lastBotSentAt: 0,
      lastBotMessageIds: [],
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const state = stateSnap.data();
  const sentIds = state.lastBotMessageIds || [];
  const withinEchoWindow =
    state.lastBotSentAt && messageTimestamp - state.lastBotSentAt < BOT_ECHO_WINDOW_MS;

  const isBotEcho = (messageId && sentIds.includes(messageId)) || withinEchoWindow;
  if (isBotEcho) return;

  // Mensagem humana de verdade — reseta o relógio do follow-up automático
  // desse contato (acabou de ser atendido, não está mais atrasado) e zera
  // o contador de tentativas automáticas, já que agora é um humano cuidando.
  try {
    const contact = await findContactByPhone(db, phone);
    if (contact) {
      await updateDoc(doc(db, "contacts", contact.id), {
        lastContactAt: serverTimestamp(),
        autoFollowUpCount: 0,
      });
    }
  } catch (followUpResetErr) {
    console.error("Erro ao resetar follow-up após intervenção humana:", followUpResetErr);
  }

  if (!state.paused) {
    await setDoc(stateRef, {
      ...state,
      paused: true,
      pausedReason: "atendimento_humano",
      updatedAt: serverTimestamp(),
    });
  }
}

// ============================================================================
// Mídia (já existia)
// ============================================================================

async function fetchMediaBase64(messageId) {
  try {
    const res = await fetch(
      `${EVOLUTION_BASE_URL}/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_TOKEN,
        },
        body: JSON.stringify({
          message: { key: { id: messageId } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.base64) return null;
    return { base64: data.base64, mimetype: data.mimetype || "application/octet-stream" };
  } catch (err) {
    console.error("Erro ao buscar mídia base64:", err);
    return null;
  }
}

async function uploadMediaToBlob(base64, mimetype, extensionHint) {
  try {
    const buffer = Buffer.from(base64, "base64");
    const ext = extensionHint || mimetype.split("/")[1] || "bin";
    const filename = `whatsapp-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const blob = await put(filename, buffer, {
      access: "public",
      contentType: mimetype,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  } catch (err) {
    console.error("Erro ao enviar mídia para o Blob:", err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --------------------------------------------------------------------
  // ROTEAMENTO: geração de post de blog (LCS Hub → módulo de Conteúdo)
  // Não tem relação com a Evolution API / WhatsApp. Usa o mesmo arquivo
  // pra não estourar o limite de 12 Serverless Functions do plano Hobby.
  // Chamada esperada do front-end:
  //   fetch("/api/whatsapp-webhook", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ action: "generate_blog_post", tema: "..." }),
  //   })
  // --------------------------------------------------------------------
  if (req.body?.action === "generate_blog_post") {
    try {
      const { tema } = req.body;
      const post = await gerarPostBlog(tema);
      return res.status(200).json(post);
    } catch (err) {
      console.error("Erro ao gerar post de blog:", err);
      return res.status(500).json({ error: err.message || "Erro ao gerar post." });
    }
  }

  try {
    const body = req.body;
    const event = body?.event;

    if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const data = Array.isArray(body?.data) ? body.data[0] : body?.data;
    if (!data) {
      return res.status(200).json({ ok: true, skipped: true, reason: "no data" });
    }

    const remoteJid = data.key?.remoteJid || "";
    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    const fromMe = data.key?.fromMe === true;
    const pushName = data.pushName || "";
    const messageTimestamp = data.messageTimestamp
      ? Number(data.messageTimestamp) * 1000
      : Date.now();

    if (!phone) {
      return res.status(200).json({ ok: true, skipped: true, reason: "no phone" });
    }

    const messageContent = data.message || {};
    const isAudio = Boolean(messageContent.audioMessage);
    const isImage = Boolean(messageContent.imageMessage);
    const isDocument = Boolean(messageContent.documentMessage);

    let messageDoc;

    if (isAudio) {
      const media = await fetchMediaBase64(data.key?.id);
      const mediaUrl = media
        ? await uploadMediaToBlob(media.base64, media.mimetype, "ogg")
        : null;
      messageDoc = {
        phone,
        fromMe,
        type: "audio",
        text: "🎤 Mensagem de voz",
        audioUrl: mediaUrl,
        durationSeconds: messageContent.audioMessage?.seconds || 0,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
        lida: fromMe,
      };
    } else if (isImage) {
      const media = await fetchMediaBase64(data.key?.id);
      const mediaUrl = media
        ? await uploadMediaToBlob(media.base64, media.mimetype, "jpg")
        : null;
      messageDoc = {
        phone,
        fromMe,
        type: "image",
        text: messageContent.imageMessage?.caption || "📷 Imagem",
        fileUrl: mediaUrl,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
        lida: fromMe,
      };
    } else if (isDocument) {
      const media = await fetchMediaBase64(data.key?.id);
      const fileName = messageContent.documentMessage?.fileName || "documento";
      const mimetype = messageContent.documentMessage?.mimetype || "application/octet-stream";
      const extFromName = fileName.includes(".") ? fileName.split(".").pop() : null;
      const mediaUrl = media
        ? await uploadMediaToBlob(media.base64, mimetype, extFromName)
        : null;
      messageDoc = {
        phone,
        fromMe,
        type: "document",
        text: `📄 ${fileName}`,
        fileUrl: mediaUrl,
        fileName,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
        lida: fromMe,
      };
    } else {
      const text =
        messageContent.conversation ||
        messageContent.extendedTextMessage?.text ||
        "(mensagem sem texto / mídia)";
      messageDoc = {
        phone,
        fromMe,
        type: "text",
        text,
        pushName,
        messageTimestamp,
        createdAt: serverTimestamp(),
        lida: fromMe,
      };
    }

    const db = getDb();
    await addDoc(collection(db, "whatsapp_messages"), messageDoc);

    if (!fromMe) {
      try {
        await applyAutoClassification({
          db,
          phone,
          pushName,
          text: messageDoc.text,
          type: messageDoc.type,
          fileName: messageDoc.fileName,
        });
      } catch (classifyErr) {
        console.error("Erro na classificação automática:", classifyErr);
      }
      try {
        await notificarNovaMensagemWhatsApp({ db, phone, pushName, texto: messageDoc.text });
      } catch (notifErr) {
        console.error("Erro ao notificar push:", notifErr);
      }
      try {
        const contact = await findContactByPhone(db, phone);
        const currentStatus = contact?.status || "";
        const botSkipped = BOT_SKIP_STATUSES.includes(currentStatus);

        if (!botSkipped) {
          await runBotFlow({ db, phone, pushName, messageDoc });
        }
      } catch (botErr) {
        console.error("Erro no agente de IA do WhatsApp:", botErr);
      }
    } else {
      // Mensagem enviada PELA LCS. Pode ser uma resposta automática do
      // próprio bot (que sai pelo mesmo número) ou um atendente humano
      // respondendo na mão, pelo WhatsApp Business ou pelo CRM. Se for
      // humano, pausamos o agente nesse contato pra não atropelar o
      // atendimento.
      try {
        await handlePossibleHumanIntervention({
          db,
          phone,
          messageId: data.key?.id,
          messageTimestamp,
        });
      } catch (humanErr) {
        console.error("Erro ao checar intervenção humana:", humanErr);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Erro no webhook do WhatsApp:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

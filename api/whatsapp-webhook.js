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
} from "firebase/firestore";
import { put } from "@vercel/blob";
import { detectStatusFromMessage, canAutoReclassify } from "./lib/classifyMessage.js";
import { gerarPostBlog } from "./lib/blogGenerator.js";

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

/**
 * Monta a mensagem com todos os dados coletados no fluxo de orçamento, pra
 * mandar pro especialista assim que o cliente termina de responder.
 */
function buildEspecialistaMessage({ phone, pushName, data }) {
  const linhas = [
    "📋 *Novo pedido de orçamento pelo WhatsApp*",
    "",
    `Cliente: ${pushName || "(sem nome)"}`,
    `WhatsApp: ${phone}`,
    `Serviço: ${data.servico}`,
  ];

  if (data.tipoPortaria) linhas.push(`Tipo de portaria: ${data.tipoPortaria}`);
  linhas.push(`Carga horária desejada: ${data.cargaHoraria}`);
  linhas.push(`Endereço: ${data.endereco}`);
  linhas.push(`Visita técnica: ${data.visitaTecnica ? "Sim" : "Não"}`);
  if (data.insalubridade) linhas.push(`Insalubridade: ${data.insalubridade}`);

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
      lastBotSentAt: Date.now(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  if (messageDoc.type !== "text") return;

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

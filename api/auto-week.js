// testte
// /api/auto-week.js
//
// Cron que roda todo dia às 10h UTC (07h Brasília) e faz TRÊS coisas
// independentes (pra não precisar de um segundo arquivo em api/, já que o
// plano Hobby da Vercel limita a 12 Serverless Functions):
//
// 1) FOLLOW-UP — verifica contatos do CRM com follow-up atrasado (regras em
//      src/crm/followUp.js: Lead 2 dias, Proposta 3 dias, Contrato 7 dias)
//      e manda uma mensagem automática de WhatsApp.
//
// 2) PROPOSTAS — verifica orçamentos salvos com propostaEnviada: false há
//      mais de 4 minutos e envia o PDF de proposta correspondente via WhatsApp.
//      (O setTimeout dentro do whatsapp-webhook.js tem timeout de 60s no Vercel
//      Hobby, então o envio é delegado para este cron que não tem esse limite.)
//
// 3) INSTAGRAM — verifica se é hora de preparar a próxima semana de posts.
//
// Segurança: a Vercel envia Authorization: Bearer {CRON_SECRET}. Qualquer
// chamada sem esse header recebe 401.
//
// CUSTO por execução (quando gera a semana do Instagram):
//   - Provider de imagem ALTERNA por semana ISO (par = Gemini, ímpar = OpenAI):
//       OpenAI: 7 imagens quality "medium" ~$0.21-0.35 (~R$1,20/semana)
//       Gemini: 7 imagens Imagen 3 ~$0.03-0.05 cada (~R$1,00/semana, sem texto na imagem)
//   - Claude Haiku (legendas): centavos, toda semana
//   Total médio: ~R$1,10/semana, ~R$4,40/mês (metade do custo anterior de
//   usar sempre OpenAI). O follow-up não tem custo de IA.

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  doc,
  setDoc,
  updateDoc,
  increment,
  runTransaction,
} from "firebase/firestore";
import { put } from "@vercel/blob";
import { needsFollowUp, buildFollowUpMessage } from "../src/crm/followUp.js";

// URLs dos PDFs de proposta (mesmas variáveis do whatsapp-webhook.js)
const PDF_PROPOSTAS = {
  portaria_24h:        process.env.PDF_PORTARIA_24H        || "",
  portaria_12h:        process.env.PDF_PORTARIA_12H        || "",
  limpeza_8h_sexta:    process.env.PDF_LIMPEZA_8H_SEXTA    || "",
  limpeza_8h_sabado:   process.env.PDF_LIMPEZA_8H_SABADO   || "",
  limpeza_4h_sabado:   process.env.PDF_LIMPEZA_4H_SABADO   || "",
  limpeza_4h_sexta:    process.env.PDF_LIMPEZA_4H_SEXTA    || "",
  zeladoria_8h_sabado: process.env.PDF_ZELADORIA_8H_SABADO || "",
};

const EVOLUTION_BASE_URL = process.env.EVOLUTION_BASE_URL || "https://evolution-api-production-7c15.up.railway.app";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "lcs_crm";
const EVOLUTION_TOKEN    = process.env.EVOLUTION_TOKEN    || "833e1efbd3e377537bf10ce7aa61120401d1e420bea7dbd7698b6ca1904379de";

function normalizePhoneForSend(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");

  // Garante prefixo 55 (Brasil)
  if (!digits.startsWith("55")) digits = "55" + digits;

  // Números brasileiros: 55 + DDD (2) + número (8 ou 9 dígitos)
  // Se tiver 55 + DDD + 8 dígitos (sem o 9), adiciona o 9
  if (digits.length === 12) {
    digits = digits.slice(0, 4) + "9" + digits.slice(4);
  }

  return digits;
}

async function sendTextProposta(toPhone, text) {
  const number = normalizePhoneForSend(toPhone);
  if (!number) throw new Error("Telefone inválido/ausente para envio de texto");
  const res = await fetch(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
    body: JSON.stringify({ number, text }),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.error(`[auto-week/proposta] sendText falhou (${res.status}) para ${number}:`, raw);
    throw new Error(`Evolution API sendText status ${res.status}: ${raw?.slice(0, 200)}`);
  }
}

async function sendDocumentProposta(toPhone, url, fileName, caption) {
  const number = normalizePhoneForSend(toPhone);
  if (!number) throw new Error("Telefone inválido/ausente para envio de documento");
  if (!url) throw new Error(`URL do PDF vazia/não configurada para ${fileName || "arquivo desconhecido"} — confira a env var correspondente no Vercel`);
  const res = await fetch(`${EVOLUTION_BASE_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
    body: JSON.stringify({ number, mediatype: "document", media: url, fileName, caption: caption || "" }),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.error(`[auto-week/proposta] sendMedia falhou (${res.status}) para ${number}:`, raw);
    throw new Error(`Evolution API sendMedia status ${res.status}: ${raw?.slice(0, 200)}`);
  }
}

function selecionarPdfProposta(data) {
  const servico = (data.servico || "").toLowerCase();
  const carga   = (data.cargaHoraria || "").toLowerCase();
  const tipo    = (data.tipoPortaria || "").toLowerCase();

  if (servico === "portaria") {
    if (tipo.includes("24")) return { url: PDF_PROPOSTAS.portaria_24h,        fileName: "Proposta_Portaria_24h_LCS.pdf" };
    if (tipo.includes("12")) return { url: PDF_PROPOSTAS.portaria_12h,        fileName: "Proposta_Portaria_12h_LCS.pdf" };
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
  return null;
}

// Tenta "reservar" o orçamento antes de processar, usando uma transação
// atômica do Firestore. Isso evita que dois disparos simultâneos (ex: o
// cron automático do cron-job.org rodando ao mesmo tempo que uma chamada
// manual de teste) processem e enviem o mesmo orçamento duas vezes.
async function claimOrcamento(db, docId, lockField = "propostaLockedAt") {
  const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutos — tempo máximo que um lock é considerado válido
  const ref = doc(db, "orcamentos", docId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const data = snap.data();

      const now = Date.now();
      const lockedAt = Number(data[lockField]) || 0;
      if (lockedAt && now - lockedAt < LOCK_TTL_MS) return false; // outro processo já está cuidando disso agora

      tx.update(ref, { [lockField]: now });
      return true;
    });
  } catch (err) {
    console.error(`[auto-week/proposta] Erro ao travar ${docId} (${lockField}):`, err.message);
    return false;
  }
}

async function runPropostaCheck(db) {
  const DELAY_MS = 5 * 60 * 1000; // 5 minutos
  const agora = Date.now();
  const results = [];

  const snap = await getDocs(
    query(collection(db, "orcamentos"), where("propostaEnviada", "==", false))
  );

  for (const docSnap of snap.docs) {
    const orc = docSnap.data();

    let since = 0;
    if (orc.createdAt && typeof orc.createdAt.toMillis === "function") {
      since = orc.createdAt.toMillis();
    } else if (orc.propostaPendenteSince) {
      since = Number(orc.propostaPendenteSince) || 0;
    }

    if (since > 0 && agora - since < DELAY_MS) {
      results.push({ id: docSnap.id, skipped: true, reason: `Aguardando ${Math.round((DELAY_MS - (agora - since)) / 1000)}s` });
      continue;
    }

    const claimed = await claimOrcamento(db, docSnap.id, "propostaLockedAt");
    if (!claimed) {
      results.push({ id: docSnap.id, skipped: true, reason: "Lock ativo" });
      continue;
    }

    try {
      let phone = orc.phone || "";
      // Normaliza número: adiciona 9 se estiver faltando
      let digits = phone.replace(/\D/g, "");
      if (!digits.startsWith("55")) digits = "55" + digits;
      if (digits.length === 12) digits = digits.slice(0, 4) + "9" + digits.slice(4);
      phone = digits;

      const proposta = selecionarPdfProposta(orc);

      if (proposta && proposta.url) {
        await sendDocumentProposta(phone, proposta.url, proposta.fileName,
          `Pronto! 🎉 Segue a proposta comercial da *LCS Terceirização*!`
        );
        await sendTextProposta(phone,
          `🔒 Além disso, trabalhamos com soluções complementares de segurança:\n` +
          `• 📹 CFTV — câmeras de monitoramento\n` +
          `• 🚗 Leitores de placa veicular\n` +
          `• 👤 Biometria facial\n\n` +
          `_Esses serviços podem ser orçados separadamente. Qualquer dúvida é só chamar!_ 😊`
        );
      } else {
        const servico = orc.servico || "serviço";
        await sendTextProposta(phone,
          `Olá! 😊 Nossa equipe está finalizando o orçamento para *${servico}* e entrará em contato em breve.\n\n` +
          `📞 (51) 3058-6391 / 99889-3033`
        );
      }

      await updateDoc(doc(db, "orcamentos", docSnap.id), {
        propostaEnviada: true,
        propostaEnviadaEm: serverTimestamp(),
      });

      results.push({ id: docSnap.id, phone, ok: true });
      console.log(`[auto-week/proposta] ✅ Proposta enviada para ${phone}`);
    } catch (err) {
      console.error(`[auto-week/proposta] ❌ ${docSnap.id}: ${err.message}`);
      results.push({ id: docSnap.id, ok: false, error: err.message });
    }
  }

  return results;
}

const MENSAGEM_DUVIDA_PROPOSTA =
  `Ficou com alguma dúvida sobre a proposta? Gostaria de falar com um especialista? 😊\n\n` +
  `Responde *sim* ou *não* que eu já te ajudo!`;

/**
 * Verifica orçamentos com proposta já enviada e ainda sem resposta do
 * cliente, mandando a pergunta de check-in em duas ondas:
 *   1) 1 hora depois do envio da proposta (primeira tentativa)
 *   2) 2 dias depois da primeira tentativa, se ainda não respondeu
 *
 * O campo `ultimaMensagemClienteEm` deve ser atualizado pelo
 * whatsapp-webhook.js sempre que uma mensagem do cliente chegar — é assim
 * que sabemos se ele respondeu ou não desde a proposta. Se esse campo for
 * mais recente que o envio do check-in, consideramos que ele já respondeu
 * (a interpretação da resposta — sim/não/especialista — é feita no
 * whatsapp-webhook.js, não aqui).
 */
async function runDuvidaCheck(db) {
  const UMA_HORA_MS = 60 * 60 * 1000;
  const DOIS_DIAS_MS = 2 * 24 * 60 * 60 * 1000;
  const agora = Date.now();
  const results = [];

  const snap = await getDocs(
    query(collection(db, "orcamentos"), where("propostaEnviada", "==", true))
  );

  for (const docSnap of snap.docs) {
    const orc = docSnap.data();

    // Já foi encaminhado pro especialista ou já foi encerrado (cliente disse "não")
    if (orc.encaminhadoEspecialista === true || orc.duvidaEncerrada === true) continue;

    const propostaEnviadaEm = orc.propostaEnviadaEm?.toMillis?.() || 0;
    if (!propostaEnviadaEm) continue;

    const ultimaMsgCliente = orc.ultimaMensagemClienteEm?.toMillis?.() || 0;
    const respondeuDepoisDaProposta = ultimaMsgCliente > propostaEnviadaEm;

    // Se o cliente já respondeu por conta própria depois da proposta,
    // não mandamos nenhum check-in automático — deixa o webhook cuidar da resposta.
    if (respondeuDepoisDaProposta) continue;

    const duvidaCheck1EnviadoEm = orc.duvidaCheck1EnviadoEm?.toMillis?.() || 0;
    const duvidaCheck2EnviadoEm = orc.duvidaCheck2EnviadoEm?.toMillis?.() || 0;

    try {
      if (!duvidaCheck1EnviadoEm) {
        // Primeira tentativa: 1h depois da proposta
        if (agora - propostaEnviadaEm < UMA_HORA_MS) {
          results.push({ id: docSnap.id, skipped: true, reason: "Aguardando 1h desde a proposta" });
          continue;
        }
        const claimed = await claimOrcamento(db, docSnap.id, "duvidaCheck1LockedAt");
        if (!claimed) { results.push({ id: docSnap.id, skipped: true, reason: "Lock ativo (check-in 1)" }); continue; }

        await sendTextProposta(orc.phone, MENSAGEM_DUVIDA_PROPOSTA);
        await updateDoc(doc(db, "orcamentos", docSnap.id), { duvidaCheck1EnviadoEm: serverTimestamp() });
        results.push({ id: docSnap.id, ok: true, etapa: "check-in 1 (1h)" });
        console.log(`[auto-week/duvida] ✅ Check-in 1 enviado para ${orc.phone}`);
      } else if (!duvidaCheck2EnviadoEm) {
        // Segunda tentativa: 2 dias depois do primeiro check-in
        if (agora - duvidaCheck1EnviadoEm < DOIS_DIAS_MS) {
          results.push({ id: docSnap.id, skipped: true, reason: "Aguardando 2 dias desde o check-in 1" });
          continue;
        }
        const claimed = await claimOrcamento(db, docSnap.id, "duvidaCheck2LockedAt");
        if (!claimed) { results.push({ id: docSnap.id, skipped: true, reason: "Lock ativo (check-in 2)" }); continue; }

        await sendTextProposta(orc.phone, MENSAGEM_DUVIDA_PROPOSTA);
        await updateDoc(doc(db, "orcamentos", docSnap.id), { duvidaCheck2EnviadoEm: serverTimestamp() });
        results.push({ id: docSnap.id, ok: true, etapa: "check-in 2 (2 dias)" });
        console.log(`[auto-week/duvida] ✅ Check-in 2 enviado para ${orc.phone}`);
      }
      // Se já mandou os dois check-ins e ainda assim não respondeu, paramos por aqui
      // — fica pendente pra alguém decidir na mão (mesmo espírito do follow-up de CRM).
    } catch (err) {
      console.error(`[auto-week/duvida] ❌ ${docSnap.id}: ${err.message}`);
      results.push({ id: docSnap.id, ok: false, error: err.message });
    }
  }

  return results;
}

const firebaseConfig = {
  apiKey: "AIzaSyAHOwdtTpZXVr_BNwG5x54gfEfD3PHSCVk",
  authDomain: "lcscrm.firebaseapp.com",
  projectId: "lcscrm",
  storageBucket: "lcscrm.firebasestorage.app",
  messagingSenderId: "539374293432",
  appId: "1:539374293432:web:a83bf9e10d22440c93bf4d",
};

const SERVICES = [
  "Limpeza e Conservação",
  "Portaria e Recepção",
  "Zeladoria",
  "Limpeza e Conservação",
  "Portaria e Recepção",
  "Zeladoria",
  "Apresentação Geral LCS",
];

const DAY_LABELS = [
  "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira",
  "Sexta-feira", "Sábado", "Domingo",
];

const SUGGESTED_TIMES = ["09:00", "12:00", "18:00", "10:00", "17:00", "11:00", "19:00"];

const DAY_NAME_TO_INDEX = {
  "Segunda-feira": 1, "Terça-feira": 2, "Quarta-feira": 3,
  "Quinta-feira": 4, "Sexta-feira": 5, "Sábado": 6, "Domingo": 0,
};

const SERVICE_TO_AI_KEY = {
  "Limpeza e Conservação": "Limpeza",
  "Portaria e Recepção": "Portaria",
  "Zeladoria": "Facilities",
  "Apresentação Geral LCS": "Limpeza",
};

const SCENE_BY_SERVICE = {
  Limpeza: "a professional cleaner in uniform actively cleaning a modern office or building interior, holding cleaning equipment (mop, cloth, or spray bottle), bright and spotless environment",
  Portaria: "a professional security/reception guard in uniform at a modern building entrance or reception desk, attentive posture, well-lit lobby with security monitors or a check-in counter visible",
  Facilities: "a maintenance technician in uniform performing building maintenance work (checking electrical panel, fixing equipment, or inspecting HVAC/plumbing), tool belt or toolbox visible, industrial or technical setting",
  Condomínios: "an exterior or lobby view of a well-maintained modern residential condominium building, clean facade, manicured entrance, possibly with a doorman or maintenance staff visible",
  Empresas: "a clean, modern, professional corporate office environment, possibly showing a facilities/cleaning or security professional at work in a business setting, polished and orderly",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

function getNextMonday() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7 || 7;
  const next = new Date(today);
  next.setDate(today.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

// Número da semana ISO do ano (1-52/53) — usado para alternar o provider de
// imagem (OpenAI numa semana, Gemini na outra), sem precisar guardar estado
// em nenhum lugar: a conta é sempre a mesma pra uma data dada.
function getIsoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Alterna o provider de geração de imagem por semana: semanas pares usam
// Gemini (mais barato), semanas ímpares usam OpenAI (texto mais preciso).
// Baseado na semana de referência (segunda-feira que está sendo gerada),
// não na data de hoje — assim fica estável mesmo se o cron rodar atrasado.
function getProviderForWeek(monday) {
  const week = getIsoWeekNumber(monday);
  return week % 2 === 0 ? "gemini" : "openai";
}

function buildScheduledAt(dayName, suggestedTime, monday) {
  const dayIndex = DAY_NAME_TO_INDEX[dayName];
  const offset = dayIndex === 0 ? 6 : dayIndex - 1;
  const date = new Date(monday);
  date.setDate(monday.getDate() + offset);
  const [h, m] = (suggestedTime || "12:00").split(":").map(Number);
  date.setHours(h, m, 0, 0);
  return date.toISOString();
}

// ── Step 0: Verifica se é hora de gerar ──────────────────────────────────────

async function shouldGenerate(db) {
  // Verifica se já tem posts "aguardando_aprovacao" (não gera duplicado)
  const pendingQ = query(
    collection(db, "posts"),
    where("status", "==", "aguardando_aprovacao"),
    limit(1)
  );
  const pendingSnap = await getDocs(pendingQ);
  if (!pendingSnap.empty) {
    return { should: false, reason: "Já existem posts aguardando aprovação" };
  }

  // Busca o post agendado com a data mais distante no futuro
  const scheduledQ = query(
    collection(db, "posts"),
    where("status", "==", "agendado"),
    orderBy("scheduledAt", "desc"),
    limit(1)
  );
  const snap = await getDocs(scheduledQ);

  if (snap.empty) {
    return { should: true, reason: "Nenhum post agendado encontrado" };
  }

  const lastPost = snap.docs[0].data();
  const lastDate = new Date(lastPost.scheduledAt);
  const now = new Date();
  const daysUntilLast = (lastDate - now) / (1000 * 60 * 60 * 24);

  if (daysUntilLast <= 1) {
    return {
      should: true,
      reason: `Último post agendado em ${lastDate.toLocaleDateString("pt-BR")} (${daysUntilLast.toFixed(1)} dias restantes)`,
    };
  }

  return {
    should: false,
    reason: `Último post agendado em ${lastDate.toLocaleDateString("pt-BR")} — ainda faltam ${daysUntilLast.toFixed(1)} dias`,
  };
}

// ── Step 1: Gera legendas com Claude ─────────────────────────────────────────

async function generateCaptions() {
  const prompt = `Você é especialista em marketing digital para a LCS Terceirização, empresa de Porto Alegre, RS que presta serviços de limpeza, portaria, facilities e manutenção para condomínios e empresas.

Crie 7 legendas de Instagram (@lcs_terceirizacao), uma para cada dia da semana, seguindo esta distribuição de serviços:
${SERVICES.map((s, i) => `${i + 1}. ${DAY_LABELS[i]}: ${s}`).join("\n")}

Regras para cada legenda:
- Tom de voz variado entre os dias (alterne entre profissional/confiante, próximo/amigável, educativo)
- Objetivo variado (credibilidade, diferenciais, chamada para orçamento, dica profissional)
- Use no máximo 4 emojis por legenda, de forma natural
- Inclua 8 a 10 hashtags relevantes ao final de cada legenda, em linha separada
- CTA claro no final de cada legenda, incentivando contato pelo WhatsApp
- Cada legenda diferente das outras em estrutura e abertura
- Português brasileiro, natural e humano
- Tamanho ideal: 3 a 5 linhas de texto principal por legenda

Escolha o formato de cada dia entre "post" (feed) ou "stories" (vertical). Use maioria "post" (5-6 dias) e 1-2 "stories" nos dias de conteúdo mais leve.

Responda APENAS em JSON válido, sem markdown:
{
  "posts": [
    { "day": "Segunda-feira", "service": "Limpeza e Conservação", "format": "post", "caption": "texto aqui" },
    ... (7 itens)
  ]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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

  const data = await res.json();
  const text = data?.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Resposta vazia do Claude");
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  if (!Array.isArray(parsed?.posts)) throw new Error("Formato inesperado de legendas");
  return parsed.posts.map((p, i) => ({ ...p, suggestedTime: SUGGESTED_TIMES[i] || "12:00" }));
}

// ── Step 2: Gera criativo via OpenAI ─────────────────────────────────────────

async function generateCreativeOpenAI(service, format) {
  const aiKey = SERVICE_TO_AI_KEY[service] || "Limpeza";
  const size = format === "stories" ? "1024x1536" : "1024x1024";
  const scene = SCENE_BY_SERVICE[aiKey] || SCENE_BY_SERVICE.Limpeza;

  const imagePrompt = `Professional, modern Instagram marketing creative for a Brazilian facilities services company called "LCS Terceirização" (cleaning, security/portaria, facilities and maintenance services for condominiums and businesses in Porto Alegre, Brazil).
Service: ${aiKey}.
Background: ${scene}.
Design: modern modular cards/badges in royal blue (#2A04A9), dark burgundy (#4A0508), and gold (#FAD72D).
One badge with text: "${aiKey.toUpperCase()}"
One headline card in bold white: "${aiKey} Profissional"
Footer strip in dark burgundy: "LCS Terceirização"
Style: polished, corporate, B2B marketing photo.`;

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: imagePrompt,
      n: 1,
      size,
      quality: "medium",
      output_format: "b64_json",
    }),
  });

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI sem imagem para ${service}: ${JSON.stringify(data?.error)}`);
  return `data:image/png;base64,${b64}`;
}

// Usa Gemini 2.5 Flash Image ("Nano Banana") via generateContent — os
// modelos Imagen (imagen-3.x/4.x) usam endpoint :predict e estão sendo
// descontinuados pela Google. Custo aprox. $0.039/imagem (1024px).
async function generateCreativeGemini(service, format) {
  const aiKey = SERVICE_TO_AI_KEY[service] || "Limpeza";
  const aspectHint = format === "stories" ? " Vertical 9:16 aspect ratio, portrait orientation." : " Square 1:1 aspect ratio.";
  const scene = SCENE_BY_SERVICE[aiKey] || SCENE_BY_SERVICE.Limpeza;

  // Gemini não escreve texto embutido com confiabilidade, então o prompt
  // pede só a foto, sem cards de texto sobrepostos (diferente do OpenAI).
  const imagePrompt = `Professional, modern Instagram marketing photo for a Brazilian facilities services company "LCS Terceirização" (cleaning, security/portaria, facilities and maintenance services for condominiums and businesses in Porto Alegre, Brazil).
Service: ${aiKey}.
A realistic, professional photo showing: ${scene}.
Clean, professional, corporate aesthetic, high quality photo, suitable for a real business's social media. No text overlays.${aspectHint}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(`Gemini sem imagem para ${service}: ${data?.error?.message || res.status}`);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imagePart) throw new Error(`Gemini sem imagem para ${service}: resposta sem inlineData`);
  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
}

async function generateCreative(service, format, provider) {
  return provider === "gemini"
    ? generateCreativeGemini(service, format)
    : generateCreativeOpenAI(service, format);
}

// ── Step 3: Upload pro Vercel Blob ────────────────────────────────────────────

async function uploadToBlob(base64, filename) {
  const matches = base64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!matches) throw new Error("Formato de imagem inválido");
  const buffer = Buffer.from(matches[2], "base64");
  const blob = await put(filename, buffer, {
    access: "public",
    contentType: matches[1],
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}

// ── Follow-up automático ──────────────────────────────────────────────────────

// Quantas vezes o cron pode mandar follow-up automático pro mesmo contato
// antes de desistir e deixar pra alguém decidir na mão (ver Home do site).
const MAX_AUTO_FOLLOWUPS = 3;

function normalizePhoneForFollowUp(raw) {
  let digits = (raw || "").toString().replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

function isValidPhoneForWhatsApp(raw) {
  if (!raw) return false;
  const digits = String(raw).replace(/\D/g, "");
  // IDs de grupo do WhatsApp começam com "120363" e têm muito mais dígitos
  // que um telefone real — nunca devem ser tratados como número de contato.
  if (digits.startsWith("120363")) return false;
  // Telefone brasileiro válido: 55 + DDD (2) + número (8 ou 9) = 12 a 13 dígitos.
  // Sem o 55: 10 a 11 dígitos.
  return digits.length >= 10 && digits.length <= 13;
}

async function sendFollowUpWhatsApp(phone, text) {
  const number = normalizePhoneForFollowUp(phone);
  const res = await fetch(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_TOKEN },
    body: JSON.stringify({ number, text }),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!res.ok) {
    console.error(`[auto-week/followup] Evolution API status ${res.status} | telefone original: ${JSON.stringify(phone)} | número normalizado: ${JSON.stringify(number)} | resposta:`, raw);
    throw new Error(
      `Evolution API status ${res.status} (telefone original: ${phone}, normalizado: ${number}): ${data?.message || raw?.slice(0, 200) || "sem corpo de resposta"}`
    );
  }
  return data;
}

/**
 * Verifica todos os contatos do CRM e manda follow-up automático pra quem
 * estiver atrasado, respeitando o limite de MAX_AUTO_FOLLOWUPS por contato.
 * Reaproveita as mesmas regras (FOLLOWUP_RULES) usadas no botão manual da
 * Home — assim o comportamento automático e o manual ficam sempre iguais.
 */
async function runFollowUpCheck(db) {
  const snap = await getDocs(collection(db, "contacts"));
  const contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const pending = contacts.filter((c) => {
    if ((c.autoFollowUpCount || 0) >= MAX_AUTO_FOLLOWUPS) return false;
    if (!isValidPhoneForWhatsApp(c.whatsapp)) {
      console.warn(`[auto-week/followup] ⚠️ Pulando ${c.name || c.id} — whatsapp inválido: ${JSON.stringify(c.whatsapp)}`);
      return false;
    }
    return needsFollowUp(c);
  });

  console.log(`[auto-week/followup] ${pending.length} contato(s) com follow-up pendente.`);

  const results = [];
  for (const contact of pending) {
    try {
      const message = buildFollowUpMessage(contact);
      await sendFollowUpWhatsApp(contact.whatsapp, message);

      await updateDoc(doc(db, "contacts", contact.id), {
        lastContactAt: serverTimestamp(),
        autoFollowUpCount: increment(1),
      });

      // Marca que foi o próprio sistema que mandou essa mensagem, pra o
      // webhook não confundir o eco dela com um atendente humano e pausar
      // o agente de IA desse contato sem necessidade.
      await setDoc(
        doc(db, "bot_state", contact.whatsapp),
        { lastBotSentAt: Date.now() },
        { merge: true }
      );

      results.push({ id: contact.id, name: contact.name || contact.whatsapp, ok: true });
      console.log(`[auto-week/followup] ✅ ${contact.name || contact.whatsapp}`);
    } catch (err) {
      results.push({ id: contact.id, ok: false, error: err.message });
      console.error(`[auto-week/followup] ❌ ${contact.name || contact.whatsapp}: ${err.message}`);
    }
  }

  return results;
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

  const authHeader = (req.headers.authorization || "").trim();
  const querySecret = (req.query?.secret || "").toString().trim();

  const headerOk = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  const queryOk = CRON_SECRET && querySecret === CRON_SECRET;

  if (!headerOk && !queryOk) {
    console.log("[auto-week/auth] FALHOU. Header recebido:", JSON.stringify(authHeader), "| Query recebida:", JSON.stringify(querySecret), "| CRON_SECRET configurado?", CRON_SECRET ? "sim (" + CRON_SECRET.length + " chars)" : "NÃO — env var vazia/ausente");
    return res.status(401).json({ error: "Não autorizado" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();
  const response = { ok: true };

  try {
    // 1) Follow-up — roda sempre, independente do que acontecer com o Instagram
    try {
      const followUpResults = await runFollowUpCheck(db);
      response.followUp = {
        sent: followUpResults.filter((r) => r.ok).length,
        results: followUpResults,
      };
    } catch (followUpErr) {
      console.error("[auto-week/followup] Erro fatal:", followUpErr);
      response.followUp = { error: followUpErr.message };
    }

    // 2) Propostas pendentes — envia PDF de orçamento para quem completou o fluxo há mais de 4 min
    try {
      const propostaResults = await runPropostaCheck(db);
      response.propostas = {
        enviadas: propostaResults.filter((r) => r.ok).length,
        results: propostaResults,
      };
    } catch (propostaErr) {
      console.error("[auto-week/proposta] Erro fatal:", propostaErr);
      response.propostas = { error: propostaErr.message };
    }

    // 2.5) Check-in de dúvida — pergunta se o cliente ficou com dúvida sobre
    // a proposta (1h depois, e de novo 2 dias depois se ainda não respondeu)
    try {
      const duvidaResults = await runDuvidaCheck(db);
      response.duvidaCheck = {
        enviados: duvidaResults.filter((r) => r.ok).length,
        results: duvidaResults,
      };
    } catch (duvidaErr) {
      console.error("[auto-week/duvida] Erro fatal:", duvidaErr);
      response.duvidaCheck = { error: duvidaErr.message };
    }

    // 3) Instagram — verifica se é hora de gerar (pode ser ignorado com ?force=true)
    const force = req.query?.force === "true";

    if (!force) {
      const { should, reason } = await shouldGenerate(db);
      console.log(`[auto-week] Verificação: ${reason}`);
      if (!should) {
        response.instagram = { skipped: true, reason };
        return res.status(200).json(response);
      }
    } else {
      console.log("[auto-week] Modo forçado — pulando verificação de prazo.");
    }

    console.log("[auto-week] Iniciando geração...");
    const monday = getNextMonday();
    // Alternância Gemini/OpenAI desativada por ora — Gemini exige billing
    // ativado no Google Cloud para gerar imagens (cota gratuita é zero desde
    // dez/2025). Pra reativar a alternância, troque a linha abaixo de volta
    // para: const provider = getProviderForWeek(monday);
    const provider = "openai";
    console.log(`[auto-week] Provider de imagem desta semana: ${provider}`);
    const igResults = [];

    // Gera legendas
    const posts = await generateCaptions();
    console.log(`[auto-week] ${posts.length} legendas geradas.`);

    // Pra cada post: gera imagem, sobe pro Blob, salva no Firestore como rascunho
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const scheduledAt = buildScheduledAt(post.day, post.suggestedTime, monday);

      try {
        console.log(`[auto-week] Criativo ${i + 1}/${posts.length} (${provider}): ${post.day}`);
        const base64 = await generateCreative(post.service, post.format, provider);
        const filename = `auto-week-${monday.toISOString().slice(0, 10)}-${i + 1}.png`;
        const imageUrl = await uploadToBlob(base64, filename);

        // Salva como "aguardando_aprovacao" — NÃO vai pro Buffer ainda
        await addDoc(collection(db, "posts"), {
          service: post.service,
          caption: post.caption,
          imageUrl,
          status: "aguardando_aprovacao",
          scheduledAt,
          format: post.format,
          day: post.day,
          bufferPostIds: [],
          imageSource: "ia",
          aiProvider: provider,
          autoGenerated: true,
          createdAt: serverTimestamp(),
        });

        igResults.push({ day: post.day, ok: true });
        console.log(`[auto-week] ✅ ${post.day} salvo.`);
      } catch (err) {
        console.error(`[auto-week] ❌ ${post.day}: ${err.message}`);
        igResults.push({ day: post.day, ok: false, error: err.message });
      }
    }

    const ok = igResults.filter((r) => r.ok).length;
    console.log(`[auto-week] Concluído — ${ok}/${posts.length} posts aguardando aprovação.`);
    response.instagram = { results: igResults };
    return res.status(200).json(response);
  } catch (err) {
    console.error("[auto-week] Erro fatal:", err);
    return res.status(500).json({ ok: false, error: err.message, partial: response });
  }
}
 

// /api/auto-week.js
//
// Cron que roda todo dia às 10h UTC (07h Brasília) e verifica se é hora de
// preparar a próxima semana de posts. A lógica é:
//   - Busca no Firestore o post agendado com a data mais distante no futuro
//   - Se essa data estiver a 1 dia ou menos de hoje, gera a semana nova
//   - Se não houver nenhum post agendado, também gera
//
// Ao gerar, salva os posts com status "aguardando_aprovacao" no Firestore —
// NÃO agenda no Buffer ainda. O responsável vê no painel (ApprovalQueue),
// edita o que quiser e clica em "Aprovar". Só aí vai pro Buffer.
//
// Segurança: a Vercel envia Authorization: Bearer {CRON_SECRET}. Qualquer
// chamada sem esse header recebe 401.
//
// CUSTO por execução:
//   - 7 imagens OpenAI quality "medium": ~$0.21–0.35 (~R$1,20)
//   - Claude Haiku (legendas): centavos
//   Total: ~R$1,50/semana, ~R$6/mês

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
} from "firebase/firestore";
import { put } from "@vercel/blob";

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

async function generateCreative(service, format) {
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

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();

  try {
    // Verifica se é hora de gerar
    const { should, reason } = await shouldGenerate(db);
    console.log(`[auto-week] Verificação: ${reason}`);

    if (!should) {
      return res.status(200).json({ ok: true, skipped: true, reason });
    }

    console.log("[auto-week] Iniciando geração...");
    const monday = getNextMonday();
    const results = [];

    // Gera legendas
    const posts = await generateCaptions();
    console.log(`[auto-week] ${posts.length} legendas geradas.`);

    // Pra cada post: gera imagem, sobe pro Blob, salva no Firestore como rascunho
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const scheduledAt = buildScheduledAt(post.day, post.suggestedTime, monday);

      try {
        console.log(`[auto-week] Criativo ${i + 1}/${posts.length}: ${post.day}`);
        const base64 = await generateCreative(post.service, post.format);
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
          autoGenerated: true,
          createdAt: serverTimestamp(),
        });

        results.push({ day: post.day, ok: true });
        console.log(`[auto-week] ✅ ${post.day} salvo.`);
      } catch (err) {
        console.error(`[auto-week] ❌ ${post.day}: ${err.message}`);
        results.push({ day: post.day, ok: false, error: err.message });
      }
    }

    const ok = results.filter((r) => r.ok).length;
    console.log(`[auto-week] Concluído — ${ok}/${posts.length} posts aguardando aprovação.`);
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error("[auto-week] Erro fatal:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

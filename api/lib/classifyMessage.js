// /api/lib/classifyMessage.js
// Lógica de classificação automática de contatos a partir do conteúdo das
// mensagens de WhatsApp recebidas. Usada pelo whatsapp-webhook.js.
//
// Regras:
// - "Currículo": menções a vaga, emprego, currículo, RH, etc, ou um documento
//   recebido (PDF/imagem) cujo nome sugere ser um currículo.
// - "Lead": menções a orçamento, preço, valor, cotação, etc.
// - Contatos já em status "consolidados" (contrato, funcionario) NUNCA são
//   sobrescritos pela classificação automática — só os estágios mais fluidos
//   (sem status, lead, proposta, curriculo, inativo) podem ser reclassificados.

const CURRICULO_KEYWORDS = [
  "vaga",
  "curriculo",
  "currículo",
  "emprego",
  "contratando",
  "contratacao",
  "contratação",
  "trabalhar",
  "trabalho",
  "oportunidade",
  "rh",
  "recursos humanos",
  "envio meu cv",
  "sou candidato",
];

const LEAD_KEYWORDS = [
  "orcamento",
  "orçamento",
  "preco",
  "preço",
  "valor",
  "quanto custa",
  "contratar servico",
  "contratar serviço",
  "cotacao",
  "cotação",
  "proposta de servico",
  "proposta de serviço",
];

// Status que representam relações já consolidadas — a classificação
// automática nunca os sobrescreve.
const PROTECTED_STATUSES = ["contrato", "funcionario"];

function containsKeyword(text, keywords) {
  const normalized = (text || "").toLowerCase();
  return keywords.some((kw) => normalized.includes(kw));
}

/**
 * Decide se uma mensagem deve disparar uma reclassificação automática de
 * status, e qual seria esse novo status. Retorna null se nenhuma regra bater.
 */
export function detectStatusFromMessage({ text, type, fileName }) {
  // Documento com nome sugestivo de currículo é um sinal forte, mesmo sem
  // texto explícito na mensagem.
  if (type === "document" && fileName) {
    const lowerName = fileName.toLowerCase();
    if (
      lowerName.includes("curriculo") ||
      lowerName.includes("currículo") ||
      lowerName.includes("cv") ||
      lowerName.includes("cv.pdf")
    ) {
      return "curriculo";
    }
  }

  if (containsKeyword(text, CURRICULO_KEYWORDS)) return "curriculo";
  if (containsKeyword(text, LEAD_KEYWORDS)) return "lead";

  return null;
}

/**
 * Decide se é seguro aplicar a reclassificação automática ao status atual
 * de um contato. Retorna true se pode sobrescrever, false se o status atual
 * está protegido.
 */
export function canAutoReclassify(currentStatus) {
  return !PROTECTED_STATUSES.includes(currentStatus);
}

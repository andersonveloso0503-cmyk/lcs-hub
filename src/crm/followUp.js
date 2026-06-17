// Regras de follow-up por status do funil.
// Cada status tem um limite de dias sem contato antes de ser considerado "atrasado".
export const FOLLOWUP_RULES = {
  lead: 2,
  proposta: 3,
  contrato: 7,
  funcionario: null, // funcionários não entram no fluxo de follow-up de vendas
  inativo: null, // nunca alerta
};

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate(); // Firestore Timestamp
  return new Date(value);
}

export function daysSince(date) {
  if (!date) return null;
  const ms = Date.now() - date.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Retorna true se o contato precisa de follow-up agora.
 */
export function needsFollowUp(contact) {
  const limit = FOLLOWUP_RULES[contact.status];
  if (limit == null) return false;

  const lastContact = toDate(contact.lastContactAt) || toDate(contact.createdAt);
  if (!lastContact) return false;

  const days = daysSince(lastContact);
  return days != null && days >= limit;
}

/**
 * Filtra e ordena (mais atrasado primeiro) os contatos que precisam de follow-up.
 */
export function getPendingFollowUps(contacts) {
  return contacts
    .filter(needsFollowUp)
    .map((c) => {
      const lastContact = toDate(c.lastContactAt) || toDate(c.createdAt);
      return { ...c, _daysSinceContact: daysSince(lastContact) };
    })
    .sort((a, b) => b._daysSinceContact - a._daysSinceContact);
}

/**
 * Gera uma mensagem padrão de follow-up personalizada para o contato.
 */
export function buildFollowUpMessage(contact) {
  const nome = contact.name || "tudo bem";
  const servico = contact.service ? ` sobre ${contact.service.toLowerCase()}` : "";
  return `Olá${nome !== "tudo bem" ? " " + nome : ""}! Passando para saber se ainda tem interesse${servico} com a LCS Terceirização. Posso te ajudar com mais alguma informação? 😊`;
}

// Calcula as datas dos próximos 7 dias (a partir da próxima segunda-feira),
// para o agendamento semanal automático do Instagram.

const DAY_NAME_TO_INDEX = {
  "Segunda-feira": 1,
  "Terça-feira": 2,
  "Quarta-feira": 3,
  "Quinta-feira": 4,
  "Sexta-feira": 5,
  "Sábado": 6,
  "Domingo": 0,
};

/**
 * Retorna a data da próxima segunda-feira (ou hoje, se hoje já for segunda
 * e ainda não passou do meio-dia).
 */
function getNextMonday() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = domingo, 1 = segunda...
  const diff = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7 || 7;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + diff);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday;
}

/**
 * Recebe a lista de posts (com campo "day" e "suggestedTime") e retorna
 * a mesma lista com um campo adicional "scheduledAt" (ISO string) calculado
 * a partir da próxima segunda-feira.
 */
export function attachScheduleDates(posts) {
  const monday = getNextMonday();

  return posts.map((post) => {
    const dayIndex = DAY_NAME_TO_INDEX[post.day];
    const offset = dayIndex === 0 ? 6 : dayIndex - 1; // domingo é o último (offset 6)
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);

    const [hours, minutes] = (post.suggestedTime || "12:00").split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);

    return { ...post, scheduledAt: date.toISOString() };
  });
}

export function formatScheduledDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

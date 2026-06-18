// /api/lib/botFlow.js
//
// Motor do agente de atendimento automático do WhatsApp (menu principal +
// submenus). É uma função pura (sem chamadas a Firestore/Evolution API aqui
// dentro) — recebe o texto da mensagem e o estado atual da conversa, e
// devolve a(s) resposta(s) e o novo estado. Quem persiste o estado e envia
// as mensagens é o whatsapp-webhook.js.
//
// Menus:
//   1 - Cliente     -> não passa por submenu de IA, só confirma e pausa o bot
//                       (tratado parcialmente aqui, parcialmente no webhook)
//   2 - Funcionário -> submenu fixo (escala, holerite, benefícios, férias, urgência)
//   3 - Orçamento   -> Limpeza / Portaria / Zeladoria, cada um com um fluxo de
//                       perguntas (carga horária, endereço, visita técnica, etc)
//   4 - Currículo   -> coleta nome/vaga e aguarda o PDF (PDF é tratado no webhook)
//   5 - Vendas      -> submenu de categorias de fornecedor

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
  // Aproximação do horário de Brasília (UTC-3), sem depender de timezone do servidor
  const utcHour = new Date().getUTCHours();
  const hour = (utcHour - 3 + 24) % 24;
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

export const MAIN_MENU_OPTIONS_TEXT =
  "1 - Já sou Cliente\n" +
  "2 - Sou Funcionário\n" +
  "3 - Quero um Orçamento\n" +
  "4 - Enviar Currículo\n" +
  "5 - Quero vender para a empresa\n\n" +
  "Digite o número da opção desejada.";

export function mainMenuMessage(pushName) {
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

/**
 * Ponto de entrada principal. Recebe:
 *   text     - texto da mensagem recebida
 *   pushName - nome do contato no WhatsApp (pode ser vazio)
 *   state    - estado atual salvo em bot_state/{phone} (ou null se for a primeira mensagem)
 *
 * Devolve:
 *   {
 *     replies: string[],          // uma ou mais mensagens a enviar, em ordem
 *     newState: {...},            // novo estado a salvar
 *     statusUpdate?: string,      // status do CRM a aplicar ao contato, se houver
 *     sendDocument?: string,      // chave de um documento a enviar (ver sendWhatsApp.js)
 *     saveQuote?: {...},          // dados coletados do orçamento, prontos para salvar
 *     saveSupplierCategory?: str, // categoria escolhida em Vendas
 *   }
 */
export function processMessage({ text, pushName, state }) {
  const incoming = (text || "").trim();
  const current = state && state.menu ? state : emptyState();

  // "menu"/"voltar"/"0" sempre reseta para o menu principal, a partir de
  // qualquer ponto da conversa (exceto se já estiver no próprio menu principal).
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
      return handleMainMenu(incoming, pushName);
  }
}

function handleMainMenu(incoming, pushName) {
  if (!["1", "2", "3", "4", "5"].includes(incoming)) {
    return { replies: [mainMenuMessage(pushName)], newState: emptyState() };
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

  // incoming === "5"
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
  // Continua disponível no menu de funcionário para escolher outra opção depois
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

  // Limpeza e Zeladoria seguem o mesmo roteiro, começando pela carga horária
  return { replies: [CARGA_HORARIA_PERGUNTA], newState: { menu: "orcamento_fluxo", step: 2, data: { servico } } };
}

// Roteiro de passos dentro de "orcamento_fluxo":
//   Portaria:           1 tipo -> 2 carga horária -> 3 endereço -> 4 visita técnica -> fim
//   Limpeza / Zeladoria: 2 carga horária -> 3 endereço -> 4 visita técnica -> 5 insalubridade -> fim
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
      return finalizarOrcamento(data); // Portaria não tem pergunta de insalubridade
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

  // Fallback de segurança — não deveria chegar aqui
  return { replies: [mainMenuMessage()], newState: emptyState() };
}

function finalizarOrcamento(data) {
  return {
    replies: [
      "Show, anotei tudo! ✅ Já vou passar essas informações para nossa equipe elaborar seu orçamento, " +
        "e em breve alguém vai te chamar por aqui.\n\nEnquanto isso, segue nossa apresentação:",
    ],
    newState: emptyState(),
    statusUpdate: "lead",
    sendDocument: "apresentacao_empresa",
    saveQuote: data,
  };
}

function handleCurriculoAguardando(incoming, state) {
  // Texto livre nesta etapa = nome / vaga de interesse. O PDF em si é detectado
  // no webhook (mensagem do tipo "document"), não aqui.
  return {
    replies: [
      "Anotado! Agora é só enviar seu currículo em PDF por aqui mesmo no chat 📎. " +
        "Assim que recebermos, nossa equipe de RH vai dar retorno.",
    ],
    newState: { menu: "curriculo_aguardando", step: 0, data: { ...state.data, infoTexto: incoming } },
  };
}

// Mensagem enviada pelo webhook quando o PDF do currículo efetivamente chega
// (enquanto o estado da conversa está em "curriculo_aguardando").
export function curriculoRecebidoMensagem() {
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

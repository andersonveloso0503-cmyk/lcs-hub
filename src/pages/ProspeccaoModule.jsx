import React, { useState } from "react";
import { useLeadsProspeccao } from "../prospeccao/useLeadsProspeccao";

// ============================================================================
// ProspeccaoModule — LCS Hub
// ============================================================================
// Painel com 3 botões pra rodar a prospecção ativa sem precisar de Postman,
// curl ou terminal — só clicar. Cada botão chama uma action já implementada
// em api/whatsapp-webhook.js:
//   1. Buscar leads      → action: "prospeccao_buscar"
//   2. Enviar emails      → action: "prospeccao_email"   (máx. 5/dia)
//   3. Enviar WhatsApp    → action: "prospeccao_whatsapp" (só quem interagiu
//      com o email, máx. 5/dia)
//
// Precisa da variável VITE_PROSPECCAO_SECRET configurada na Vercel com o
// MESMO valor de PROSPECCAO_SECRET (mesmo padrão já usado pra Evolution API:
// uma versão com prefixo VITE_ pro navegador, outra sem prefixo pro servidor).
// ============================================================================

const SEGMENTOS = [
  { valor: "condominios", label: "Condomínios", query: "condomínios em Porto Alegre" },
  { valor: "empresas", label: "Empresas / escritórios", query: "empresas em Porto Alegre" },
];

async function chamarProspeccao(action, extra = {}) {
  const resp = await fetch("/api/whatsapp-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-prospeccao-secret": import.meta.env.VITE_PROSPECCAO_SECRET || "",
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || "Falha na requisição (" + resp.status + ")");
  return data;
}

function ResultadoBox({ resultado }) {
  if (!resultado) return null;
  if (resultado.limiteDiarioAtingido) {
    return (
      <p style={styles.resultInfo}>
        Limite diário já atingido hoje ({resultado.enviadosHoje}/{resultado.limite}). Volta amanhã.
      </p>
    );
  }
  return (
    <div style={styles.resultBox}>
      {Object.entries(resultado).map(([chave, valor]) => (
        <div key={chave} style={styles.resultRow}>
          <span style={styles.resultLabel}>{TRADUCOES[chave] || chave}</span>
          <span style={styles.resultValor}>{String(valor)}</span>
        </div>
      ))}
    </div>
  );
}

const TRADUCOES = {
  encontrados: "Lugares encontrados",
  novos: "Leads novos salvos",
  jaExistiam: "Já existiam (ignorados)",
  avaliados: "Leads avaliados",
  enviadosNestaChamada: "Enviados agora",
  enviadosHojeNoTotal: "Total enviado hoje",
  limite: "Limite diário",
  semEmail: "Sem email cadastrado",
  semTelefone: "Sem telefone cadastrado",
  falhas: "Falhas no envio",
};

const STATUS_INFO = {
  novo: { label: "Novo", bg: "#EEF2F5", cor: "#5A6B7A" },
  email_enviado: { label: "Email enviado", bg: "#E6F1FB", cor: "#185FA5" },
  whatsapp_enviado: { label: "WhatsApp enviado", bg: "#E1F5EE", cor: "#0F6E56" },
};

function StatusBadge({ status }) {
  const info = STATUS_INFO[status] || { label: status || "—", bg: "#EEF2F5", cor: "#5A6B7A" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: info.bg,
        color: info.cor,
      }}
    >
      {info.label}
    </span>
  );
}

function formatarData(timestamp) {
  if (!timestamp?.toDate) return "—";
  return timestamp.toDate().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Mostra a origem do último envio que aconteceu com o lead (WhatsApp tem
// prioridade sobre email, porque é o passo mais recente do funil).
function OrigemBadge({ lead }) {
  const origem = lead.origemWhatsapp || lead.origemEmail || lead.origemBusca;
  if (!origem) return <span>—</span>;
  const ehCron = origem === "cron";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: ehCron ? "#F1EAFB" : "#FFF6E5",
        color: ehCron ? "#5B2E9E" : "#8A5A00",
      }}
    >
      {ehCron ? "🤖 Automático" : "👤 Manual"}
    </span>
  );
}

function TabelaLeads() {
  const { leads, loading, error } = useLeadsProspeccao();

  if (loading) return <p style={styles.helperText}>Carregando leads…</p>;
  if (error) return <p style={styles.errorText}>Erro ao carregar leads: {error}</p>;
  if (leads.length === 0) {
    return <p style={styles.helperText}>Nenhum lead ainda. Busca alguns leads acima pra começar.</p>;
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Nome</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Origem</th>
            <th style={styles.th}>Interagiu?</th>
            <th style={styles.th}>Email</th>
            <th style={styles.th}>Telefone</th>
            <th style={styles.th}>Encontrado em</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td style={styles.td}>{lead.nome || "—"}</td>
              <td style={styles.td}>
                <StatusBadge status={lead.status} />
              </td>
              <td style={styles.td}>
                <OrigemBadge lead={lead} />
              </td>
              <td style={styles.td}>{lead.interagiuEmail ? "Sim" : "—"}</td>
              <td style={styles.td}>{lead.email || "—"}</td>
              <td style={styles.td}>{lead.telefone || "—"}</td>
              <td style={styles.td}>{formatarData(lead.criadoEm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProspeccaoModule() {
  const [segmento, setSegmento] = useState(SEGMENTOS[0].valor);
  const [statusBusca, setStatusBusca] = useState("idle"); // idle | loading | done | error
  const [statusEmail, setStatusEmail] = useState("idle");
  const [statusWhats, setStatusWhats] = useState("idle");
  const [resultBusca, setResultBusca] = useState(null);
  const [resultEmail, setResultEmail] = useState(null);
  const [resultWhats, setResultWhats] = useState(null);
  const [erro, setErro] = useState("");

  const segmentoAtual = SEGMENTOS.find((s) => s.valor === segmento) || SEGMENTOS[0];

  async function rodarBusca() {
    setStatusBusca("loading");
    setErro("");
    try {
      const data = await chamarProspeccao("prospeccao_buscar", {
        query: segmentoAtual.query,
        segmento: segmentoAtual.valor,
        maxResults: 20,
        origem: "manual",
      });
      setResultBusca(data);
      setStatusBusca("done");
    } catch (e) {
      setErro(e.message);
      setStatusBusca("error");
    }
  }

  async function rodarEmail() {
    setStatusEmail("loading");
    setErro("");
    try {
      const data = await chamarProspeccao("prospeccao_email", { origem: "manual" });
      setResultEmail(data);
      setStatusEmail("done");
    } catch (e) {
      setErro(e.message);
      setStatusEmail("error");
    }
  }

  async function rodarWhatsapp() {
    setStatusWhats("loading");
    setErro("");
    try {
      const data = await chamarProspeccao("prospeccao_whatsapp", { origem: "manual" });
      setResultWhats(data);
      setStatusWhats("done");
    } catch (e) {
      setErro(e.message);
      setStatusWhats("error");
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.eyebrow}>LCS Hub · Prospecção</span>
        <h1 style={styles.h1}>Prospecção ativa</h1>
        <p style={styles.subhead}>
          Busca leads em potencial, manda a apresentação por email e depois por
          WhatsApp — só pra quem interagiu com o email. Limite de 5 envios por
          dia em cada canal, pra não parecer disparo em massa.
        </p>
      </header>

      {erro && <p style={styles.errorText}>Deu erro: {erro}</p>}

      <section style={styles.card}>
        <h2 style={styles.h2}>1. Buscar leads</h2>
        <div style={styles.segmentoGrid}>
          {SEGMENTOS.map((s) => (
            <button
              key={s.valor}
              onClick={() => setSegmento(s.valor)}
              style={{
                ...styles.segmentoBtn,
                ...(segmento === s.valor ? styles.segmentoBtnActive : {}),
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={rodarBusca}
          disabled={statusBusca === "loading"}
          style={{
            ...styles.primaryBtn,
            ...(statusBusca === "loading" ? styles.btnDisabled : {}),
          }}
        >
          {statusBusca === "loading" ? "Buscando…" : "Buscar leads"}
        </button>
        <ResultadoBox resultado={resultBusca} />
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>2. Enviar email de apresentação</h2>
        <p style={styles.helperText}>
          Manda pros leads novos que têm email cadastrado, respeitando o
          limite diário.
        </p>
        <button
          onClick={rodarEmail}
          disabled={statusEmail === "loading"}
          style={{
            ...styles.secondaryBtn,
            ...(statusEmail === "loading" ? styles.btnDisabled : {}),
          }}
        >
          {statusEmail === "loading" ? "Enviando…" : "Enviar emails (até 5/dia)"}
        </button>
        <ResultadoBox resultado={resultEmail} />
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>3. Enviar WhatsApp</h2>
        <p style={styles.helperText}>
          Só pra quem abriu ou clicou no email (marcado automaticamente pelo
          webhook do Resend).
        </p>
        <button
          onClick={rodarWhatsapp}
          disabled={statusWhats === "loading"}
          style={{
            ...styles.secondaryBtn,
            ...(statusWhats === "loading" ? styles.btnDisabled : {}),
          }}
        >
          {statusWhats === "loading" ? "Enviando…" : "Enviar WhatsApp (até 5/dia)"}
        </button>
        <ResultadoBox resultado={resultWhats} />
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Leads e status</h2>
        <p style={styles.helperText}>Atualiza em tempo real, igual o resto do CRM.</p>
        <TabelaLeads />
      </section>
    </div>
  );
}

const styles = {
  page: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxWidth: 720,
    margin: "0 auto",
    padding: "32px 20px 80px",
    color: "#1A2433",
  },
  header: { marginBottom: 32 },
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#3B6E91",
  },
  h1: { fontSize: 28, fontWeight: 800, margin: "8px 0 8px", color: "#13202E" },
  subhead: { fontSize: 15, color: "#5A6B7A", lineHeight: 1.5, margin: 0 },
  card: {
    background: "#FFFFFF",
    border: "1px solid #E3E8EC",
    borderRadius: 14,
    padding: 24,
    marginBottom: 20,
    boxShadow: "0 1px 2px rgba(20,30,40,0.04)",
  },
  h2: { fontSize: 16, fontWeight: 700, margin: "0 0 12px", color: "#13202E" },
  helperText: { fontSize: 13, color: "#5A6B7A", margin: "0 0 14px", lineHeight: 1.5 },
  segmentoGrid: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  segmentoBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    background: "#FAFBFC",
    color: "#33424F",
    fontSize: 14,
    cursor: "pointer",
  },
  segmentoBtnActive: {
    border: "1px solid #3B6E91",
    background: "#EAF2F7",
    color: "#1A4763",
    fontWeight: 600,
  },
  primaryBtn: {
    background: "#1A4763",
    color: "#FFFFFF",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryBtn: {
    background: "#FFFFFF",
    color: "#1A4763",
    border: "1px solid #1A4763",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  errorText: {
    color: "#B3261E",
    fontSize: 13,
    marginBottom: 16,
    background: "#FCEBEB",
    padding: "10px 14px",
    borderRadius: 10,
  },
  resultBox: {
    marginTop: 16,
    background: "#FAFBFC",
    border: "1px solid #E3E8EC",
    borderRadius: 10,
    padding: "12px 16px",
  },
  resultInfo: {
    marginTop: 16,
    fontSize: 13,
    color: "#8A5A00",
    background: "#FFF6E5",
    padding: "10px 14px",
    borderRadius: 10,
  },
  resultRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    fontSize: 13,
    borderBottom: "1px solid #EEF2F5",
  },
  resultLabel: { color: "#5A6B7A" },
  resultValor: { color: "#13202E", fontWeight: 700 },
  tableWrap: { overflowX: "auto", marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "2px solid #E3E8EC",
    color: "#5A6B7A",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 10px",
    borderBottom: "1px solid #EEF2F5",
    color: "#33424F",
    whiteSpace: "nowrap",
  },
};

import React, { useMemo, useState } from "react";
import { useFinanceiro } from "../financeiro/useFinanceiro";

// ============================================================================
// FinanceiroModule — LCS Hub
// ============================================================================
// Painel de leitura dos gastos registrados pelo agente financeiro do
// WhatsApp (api/whatsapp-webhook.js → handleFinanceiroMessage). O registro
// em si acontece só pelo WhatsApp, mandando mensagem tipo "gastei 50 no
// mercado" pro número do bot a partir do número pessoal cadastrado em
// ADMIN_FINANCEIRO_WHATSAPP — aqui é só visualização em tempo real.
// ============================================================================

const EMPRESAS = {
  LCS: { label: "LCS Terceirização", emoji: "🏢", cor: "#1A4763", bg: "#EAF2F7" },
  VAN: { label: "Van Service", emoji: "🚐", cor: "#8A5A00", bg: "#FFF6E5" },
};

const FILTROS = [
  { valor: "todas", label: "Todas" },
  { valor: "LCS", label: "🏢 LCS" },
  { valor: "VAN", label: "🚐 Van Service" },
];

function formatarMoeda(valor) {
  return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

function ehMesAtual(timestamp) {
  if (!timestamp?.toDate) return false;
  const d = timestamp.toDate();
  const agora = new Date();
  return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
}

function EmpresaBadge({ empresa }) {
  const info = EMPRESAS[empresa] || { label: empresa || "—", emoji: "❓", cor: "#5A6B7A", bg: "#EEF2F5" };
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
        whiteSpace: "nowrap",
      }}
    >
      {info.emoji} {info.label}
    </span>
  );
}

function CardTotal({ empresaKey, total }) {
  const info = EMPRESAS[empresaKey];
  return (
    <div style={{ ...styles.totalCard, borderColor: info.bg }}>
      <span style={styles.totalLabel}>
        {info.emoji} {info.label} · este mês
      </span>
      <span style={{ ...styles.totalValor, color: info.cor }}>{formatarMoeda(total)}</span>
    </div>
  );
}

export default function FinanceiroModule() {
  const { lancamentos, loading, error } = useFinanceiro();
  const [filtro, setFiltro] = useState("todas");

  const totaisMes = useMemo(() => {
    const totais = { LCS: 0, VAN: 0 };
    for (const l of lancamentos) {
      if (ehMesAtual(l.criadoEm) && totais[l.empresa] !== undefined) {
        totais[l.empresa] += Number(l.valor) || 0;
      }
    }
    return totais;
  }, [lancamentos]);

  const lancamentosFiltrados = useMemo(() => {
    if (filtro === "todas") return lancamentos;
    return lancamentos.filter((l) => l.empresa === filtro);
  }, [lancamentos, filtro]);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.eyebrow}>LCS Hub · Financeiro</span>
        <h1 style={styles.h1}>Gastos por WhatsApp</h1>
        <p style={styles.subhead}>
          Manda uma mensagem pro WhatsApp do bot a partir do seu número pessoal — algo tipo{" "}
          <strong>"gastei 50 no mercado"</strong> ou <strong>"120 combustível da van"</strong> — e o gasto
          aparece aqui na hora. Manda <strong>"resumo"</strong> a qualquer momento pra receber o total do
          mês direto no WhatsApp.
        </p>
      </header>

      {error && <p style={styles.errorText}>Erro ao carregar lançamentos: {error}</p>}

      <div style={styles.totalsGrid}>
        <CardTotal empresaKey="LCS" total={totaisMes.LCS} />
        <CardTotal empresaKey="VAN" total={totaisMes.VAN} />
      </div>

      <section style={styles.card}>
        <div style={styles.filtroRow}>
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              onClick={() => setFiltro(f.valor)}
              style={{
                ...styles.filtroBtn,
                ...(filtro === f.valor ? styles.filtroBtnActive : {}),
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={styles.helperText}>Carregando lançamentos…</p>
        ) : lancamentosFiltrados.length === 0 ? (
          <p style={styles.helperText}>
            Nenhum gasto registrado ainda{filtro !== "todas" ? " nesse filtro" : ""}. Manda uma mensagem pro
            WhatsApp do bot pra começar.
          </p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Data</th>
                  <th style={styles.th}>Empresa</th>
                  <th style={styles.th}>Categoria</th>
                  <th style={styles.th}>Descrição</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {lancamentosFiltrados.map((l) => (
                  <tr key={l.id}>
                    <td style={styles.td}>{formatarData(l.criadoEm)}</td>
                    <td style={styles.td}>
                      <EmpresaBadge empresa={l.empresa} />
                    </td>
                    <td style={styles.td}>{l.categoria || "—"}</td>
                    <td style={styles.td}>{l.descricao || "—"}</td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700 }}>
                      {formatarMoeda(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxWidth: 780,
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
  totalsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  totalCard: {
    background: "#FFFFFF",
    border: "2px solid #E3E8EC",
    borderRadius: 14,
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    boxShadow: "0 1px 2px rgba(20,30,40,0.04)",
  },
  totalLabel: { fontSize: 13, fontWeight: 600, color: "#5A6B7A" },
  totalValor: { fontSize: 26, fontWeight: 800 },
  card: {
    background: "#FFFFFF",
    border: "1px solid #E3E8EC",
    borderRadius: 14,
    padding: 24,
    marginBottom: 20,
    boxShadow: "0 1px 2px rgba(20,30,40,0.04)",
  },
  filtroRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  filtroBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    background: "#FAFBFC",
    color: "#33424F",
    fontSize: 14,
    cursor: "pointer",
  },
  filtroBtnActive: {
    border: "1px solid #3B6E91",
    background: "#EAF2F7",
    color: "#1A4763",
    fontWeight: 600,
  },
  helperText: { fontSize: 13, color: "#5A6B7A", margin: 0, lineHeight: 1.5 },
  errorText: {
    color: "#B3261E",
    fontSize: 13,
    marginBottom: 16,
    background: "#FCEBEB",
    padding: "10px 14px",
    borderRadius: 10,
  },
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

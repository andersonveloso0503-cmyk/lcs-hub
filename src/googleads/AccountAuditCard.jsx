import { useState } from "react";
import { Award, RefreshCw, AlertTriangle } from "lucide-react";

const CATEGORY_LABELS = {
  criativo: "🎨 Criativo",
  pagina_destino: "🌐 Página de destino",
  palavras_chave: "🔑 Palavras-chave",
  estrutura: "🏗️ Estrutura",
};

const IMPACT_COLOR = { alto: "#C62828", medio: "#B8860B", baixo: "var(--gray)" };

/**
 * Auditoria geral e estratégica da conta — diferente das "Recomendações
 * da IA" (que olham campanha por campanha), esta olha o panorama inteiro
 * de uma vez: combina estrutura, métricas e Índice de Qualidade
 * (Quality Score) agregado de todas as palavras-chave, para identificar
 * padrões sistêmicos que afetam a posição dos anúncios como um todo —
 * o que o usuário pediu como "melhorar a campanha em geral para ficar
 * bem posicionado nas pesquisas".
 */
export default function AccountAuditCard() {
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);

  async function handleRunAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "run_account_audit" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao rodar auditoria");
      setAudit(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Award size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Auditoria Geral da Conta
        </span>
        <button className="btn btn-teal btn-sm" onClick={handleRunAudit} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw size={13} className="spin" style={{ marginRight: 6 }} /> Analisando...
            </>
          ) : audit ? (
            "🔄 Atualizar"
          ) : (
            "Rodar Auditoria"
          )}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 14, fontSize: 13 }}>
        Analisa o Índice de Qualidade de todas as palavras-chave junto com a estrutura geral das
        campanhas, identificando o que mais limita sua posição nas pesquisas hoje.
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
          <span>{error}</span>
        </div>
      )}

      {audit && (
        <>
          {audit.avg_quality_score !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: 12, borderRadius: 10, background: "var(--bg)" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: audit.avg_quality_score >= 7 ? "var(--teal)" : audit.avg_quality_score >= 4 ? "#B8860B" : "var(--pink)" }}>
                  {audit.avg_quality_score.toFixed(1)}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>Índice de Qualidade médio</div>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Baseado em {audit.keywords_analyzed} palavras-chave com dado disponível nos últimos
                30 dias. Quanto maior, melhor a posição e menor o custo por clique.
              </p>
            </div>
          )}

          {audit.overall_assessment && (
            <div style={{ padding: 14, borderRadius: 10, background: "var(--navy)", color: "#fff", marginBottom: 16 }}>
              <strong style={{ fontSize: 12, letterSpacing: 0.5, color: "var(--teal)" }}>DIAGNÓSTICO GERAL</strong>
              <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>{audit.overall_assessment}</p>
            </div>
          )}

          {audit.priority_actions?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {audit.priority_actions.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "var(--bg)",
                    border: "1px solid var(--gray-light)",
                  }}
                >
                  <span style={{ fontSize: 18, fontWeight: 800, color: "var(--gray-light)", minWidth: 22 }}>
                    {i + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <strong style={{ fontSize: 14 }}>{a.title}</strong>
                      {a.category && (
                        <span className="muted" style={{ fontSize: 11 }}>{CATEGORY_LABELS[a.category] || a.category}</span>
                      )}
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>{a.detail}</p>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 8,
                      color: "#fff",
                      height: "fit-content",
                      whiteSpace: "nowrap",
                      background: IMPACT_COLOR[a.impact] || "var(--gray)",
                    }}
                  >
                    {(a.impact || "").toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

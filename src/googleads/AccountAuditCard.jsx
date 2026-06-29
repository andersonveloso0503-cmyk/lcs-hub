import { useState } from "react";
import { Award, RefreshCw, AlertTriangle, Check } from "lucide-react";

const CATEGORY_LABELS = {
  criativo: "🎨 Criativo",
  pagina_destino: "🌐 Página de destino",
  palavras_chave: "🔑 Palavras-chave",
  estrutura: "🏗️ Estrutura",
};

const IMPACT_COLOR = { alto: "#C62828", medio: "#B8860B", baixo: "var(--gray)" };

/**
 * Auditoria geral e estratégica da conta — visão única de recomendações
 * (substituiu o antigo card separado "Recomendações da IA" + esta
 * auditoria, que eram redundantes). Combina estrutura, métricas e Índice
 * de Qualidade (Quality Score) agregado de todas as palavras-chave para
 * identificar padrões sistêmicos que afetam a posição dos anúncios como
 * um todo. Cada ação prioritária, quando corresponder a uma ação
 * automatizável (pausar, ajustar orçamento, mudar estratégia de lance),
 * ganha um botão "Aplicar" — ações qualitativas (ex.: melhorar a página
 * de destino) ficam só como texto, sem botão, porque não há como
 * automatizar isso via API.
 */
export default function AccountAuditCard({ campaigns }) {
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);
  const [applyingIndex, setApplyingIndex] = useState(null);
  const [appliedIndexes, setAppliedIndexes] = useState(new Set());

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
      setAppliedIndexes(new Set()); // nova auditoria = reseta o estado de "aplicado" da anterior
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Aplica a ação estruturada de um item da auditoria. Localiza o objeto
   * completo da campanha a partir do campaign_id (a IA só devolve o ID,
   * não os detalhes como budget_resource_name necessários para a
   * mutação de orçamento).
   */
  async function handleApply(action, index) {
    const campaign = campaigns?.find((c) => c.campaign_id === action.campaign_id);
    if (!campaign) {
      setError("Campanha não encontrada — sincronize de novo e rode a auditoria outra vez.");
      return;
    }

    let payload = null;
    if (action.type === "pause_campaign") {
      if (!confirm(`Pausar a campanha "${campaign.name}"? Ela para de gerar cliques e gastos imediatamente.`)) return;
      payload = { action: "pause_campaign", campaign_id: campaign.campaign_id };
    } else if (action.type === "update_budget") {
      if (!campaign.budget_resource_name) {
        setError("Esta campanha não tem orçamento próprio identificado.");
        return;
      }
      if (!confirm(`Alterar orçamento diário de "${campaign.name}" de R$ ${campaign.budget_amount.toFixed(2)} para R$ ${action.new_amount.toFixed(2)}?`)) return;
      payload = {
        action: "update_budget",
        budget_resource_name: campaign.budget_resource_name,
        new_amount: action.new_amount,
      };
    } else if (action.type === "update_bidding_strategy") {
      const label = action.strategy === "MAXIMIZE_CONVERSIONS" ? "Maximizar Conversões" : "Maximizar Cliques";
      if (!confirm(`Mudar a estratégia de lance de "${campaign.name}" para ${label}?`)) return;
      payload = {
        action: "update_bidding_strategy",
        campaign_id: campaign.campaign_id,
        strategy: action.strategy,
      };
    } else {
      return; // tipo de ação não reconhecido — não deveria chegar aqui, já que o backend só preenche "action" para tipos válidos
    }

    setApplyingIndex(index);
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao aplicar ação");
      setAppliedIndexes((prev) => new Set(prev).add(index));
    } catch (err) {
      setError(err.message);
    } finally {
      setApplyingIndex(null);
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
              {audit.priority_actions.map((a, i) => {
                const isApplied = appliedIndexes.has(i);
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: isApplied ? "#ECFEFF" : "var(--bg)",
                      border: `1px solid ${isApplied ? "var(--teal)" : "var(--gray-light)"}`,
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
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
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
                      {a.action && (
                        isApplied ? (
                          <span style={{ fontSize: 11, color: "var(--teal)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                            <Check size={12} /> Aplicado
                          </span>
                        ) : (
                          <button
                            className="btn btn-teal btn-sm"
                            onClick={() => handleApply(a.action, i)}
                            disabled={applyingIndex === i}
                          >
                            {applyingIndex === i ? "Aplicando..." : "✓ Aplicar"}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

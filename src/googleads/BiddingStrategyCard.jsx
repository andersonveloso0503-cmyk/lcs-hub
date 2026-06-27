import { useState } from "react";
import { SlidersHorizontal, Check, AlertTriangle } from "lucide-react";

const STRATEGY_LABELS = {
  MAXIMIZE_CONVERSIONS: "Maximizar Conversões",
  TARGET_SPEND: "Maximizar Cliques",
  MAXIMIZE_CONVERSION_VALUE: "Maximizar Valor de Conversão",
  TARGET_CPA: "CPA Alvo",
  TARGET_ROAS: "ROAS Alvo",
  MANUAL_CPC: "CPC Manual",
};

/**
 * Card de sugestões de estratégia de lance — regra fixa (sem IA): poucas
 * conversões sugerem Maximizar Cliques (gerar mais volume/dados), 5+
 * conversões sugerem Maximizar Conversões. Mesmo padrão de aprovação
 * manual das demais ações da Fase 4.
 */
export default function BiddingStrategyCard({ suggestions }) {
  const [applying, setApplying] = useState(null);
  const [applied, setApplied] = useState(new Set());
  const [feedback, setFeedback] = useState(null);

  if (!suggestions || suggestions.length === 0) return null;

  const visible = suggestions.filter((s) => !applied.has(s.campaign_id));
  if (visible.length === 0) return null;

  async function handleApply(s) {
    if (
      !confirm(
        `Mudar a estratégia de lance de "${s.campaign_name}" de ${STRATEGY_LABELS[s.current_strategy] || s.current_strategy} para ${STRATEGY_LABELS[s.suggested_strategy]}?`
      )
    )
      return;
    setApplying(s.campaign_id);
    setFeedback(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({
          action: "update_bidding_strategy",
          campaign_id: s.campaign_id,
          strategy: s.suggested_strategy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao atualizar estratégia");
      setApplied((prev) => new Set(prev).add(s.campaign_id));
      setFeedback({ ok: true, message: data.message });
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        <SlidersHorizontal size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
        Sugestões de Estratégia de Lance ({visible.length})
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 14, fontSize: 13 }}>
        Baseado no volume de conversões dos últimos 30 dias de cada campanha.
      </p>

      {feedback && (
        <div
          className="pending-metrics-note"
          style={
            feedback.ok
              ? { borderColor: "var(--teal)", background: "#ECFEFF", marginBottom: 12 }
              : { borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 12 }
          }
        >
          {feedback.ok ? <Check size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} /> : <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((s) => (
          <div
            key={s.campaign_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--bg)",
              border: "1px solid var(--gray-light)",
              flexWrap: "wrap",
            }}
          >
            <strong style={{ flex: "1 1 160px" }}>{s.campaign_name}</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              {STRATEGY_LABELS[s.current_strategy] || s.current_strategy || "—"} →{" "}
              <strong style={{ color: "var(--teal)" }}>{STRATEGY_LABELS[s.suggested_strategy]}</strong>
            </span>
            <span className="muted" style={{ fontSize: 12, flex: "2 1 200px" }}>{s.reason}</span>
            <button
              className="btn btn-teal btn-sm"
              onClick={() => handleApply(s)}
              disabled={applying === s.campaign_id}
              style={{ marginLeft: "auto" }}
            >
              {applying === s.campaign_id ? "Aplicando..." : "✓ Aplicar"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

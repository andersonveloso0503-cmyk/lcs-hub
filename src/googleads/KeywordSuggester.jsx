import { useState } from "react";
import { Plus, RefreshCw, Check, AlertTriangle, X } from "lucide-react";

const SERVICE_OPTIONS = [
  "Limpeza para condomínios",
  "Portaria para condomínios",
  "Limpeza para empresas",
  "Facilities e manutenção predial",
  "Serviços terceirizados em geral",
];

const MATCH_TYPE_LABELS = {
  EXACT: "Exata",
  PHRASE: "Frase",
  BROAD: "Ampla",
};

/**
 * Painel de sugestão de novas palavras-chave (positivas) via IA, no mesmo
 * padrão de fluxo em 2 passos do resto da Fase 4: 1) gerar sugestões
 * (suggest_keywords, não altera nada), 2) aplicar individualmente
 * (add_keyword) ou descartar cada sugestão.
 */
export default function KeywordSuggester({ campaigns }) {
  const [open, setOpen] = useState(false);
  const [serviceLabel, setServiceLabel] = useState(SERVICE_OPTIONS[0]);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaign_id || "");
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [applying, setApplying] = useState(null); // term sendo aplicado agora
  const [applied, setApplied] = useState(new Set());

  async function handleGenerate() {
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "suggest_keywords", service_label: serviceLabel, campaign_id: campaignId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar sugestões");
      setSuggestions(data.suggestions || []);
      setApplied(new Set());
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setGenerating(false);
    }
  }

  async function handleApply(s) {
    setApplying(s.term);
    setFeedback(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "add_keyword", campaign_id: campaignId, term: s.term, match_type: s.match_type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao adicionar palavra-chave");
      setApplied((prev) => new Set(prev).add(s.term));
      setFeedback({ ok: true, message: data.message });
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setApplying(null);
    }
  }

  function handleDismiss(term) {
    setSuggestions((prev) => prev.filter((s) => s.term !== term));
  }

  if (!open) {
    return (
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>
            <Plus size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Sugerir Novas Palavras-Chave
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            IA sugere termos novos para aparecer em mais buscas relevantes
          </p>
        </div>
        <button className="btn btn-teal btn-sm" onClick={() => setOpen(true)}>
          Sugerir Palavras
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Plus size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Sugerir Novas Palavras-Chave
        </span>
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)} title="Fechar">
          <X size={14} />
        </button>
      </div>

      {feedback && (
        <div
          className="pending-metrics-note"
          style={
            feedback.ok
              ? { borderColor: "var(--teal)", background: "#ECFEFF", marginTop: 10 }
              : { borderColor: "var(--pink)", background: "#FFF0F6", marginTop: 10 }
          }
        >
          {feedback.ok ? <Check size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} /> : <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14, marginBottom: 16 }}>
        <div>
          <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
            Serviço a anunciar
          </label>
          <select
            value={serviceLabel}
            onChange={(e) => setServiceLabel(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--gray-light)" }}
          >
            {SERVICE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
            Campanha de destino
          </label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--gray-light)" }}
          >
            {campaigns.map((c) => (
              <option key={c.campaign_id} value={c.campaign_id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <button className="btn btn-teal" onClick={handleGenerate} disabled={generating} style={{ marginBottom: suggestions.length > 0 ? 16 : 0 }}>
        {generating ? (
          <>
            <RefreshCw size={14} className="spin" style={{ marginRight: 6 }} /> Gerando...
          </>
        ) : (
          <>
            <Plus size={14} style={{ marginRight: 6 }} /> Gerar sugestões
          </>
        )}
      </button>

      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {suggestions.map((s) => {
            const isApplied = applied.has(s.term);
            const isApplying = applying === s.term;
            return (
              <div
                key={s.term}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: isApplied ? "#ECFEFF" : "var(--bg)",
                  border: `1px solid ${isApplied ? "var(--teal)" : "var(--gray-light)"}`,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 8,
                    color: "#fff",
                    background: "var(--blue)",
                    textTransform: "uppercase",
                  }}
                >
                  {MATCH_TYPE_LABELS[s.match_type] || s.match_type}
                </span>
                <strong style={{ flex: "1 1 160px" }}>"{s.term}"</strong>
                <span className="muted" style={{ fontSize: 13, flex: "2 1 200px" }}>{s.reason}</span>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  {isApplied ? (
                    <span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 700 }}>✓ Adicionada</span>
                  ) : (
                    <>
                      <button
                        className="btn btn-teal btn-sm"
                        onClick={() => handleApply(s)}
                        disabled={isApplying}
                      >
                        {isApplying ? "Aplicando..." : "✓ Aplicar"}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => handleDismiss(s.term)}>
                        Descartar
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

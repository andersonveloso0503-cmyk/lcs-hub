import { useState } from "react";
import { Sparkles, RefreshCw, Send, X, AlertTriangle, Check } from "lucide-react";

const SERVICE_OPTIONS = [
  "Limpeza para condomínios",
  "Portaria para condomínios",
  "Limpeza para empresas",
  "Facilities e manutenção predial",
  "Serviços terceirizados em geral",
];

/**
 * Painel de criação de anúncio (Responsive Search Ad) assistida por IA.
 * Fluxo em 2 passos, igual ao resto da Fase 4: 1) gerar texto via IA
 * (generate_ad_copy, não altera nada na conta), 2) revisar/editar e
 * publicar de verdade (create_ad, sempre criado como PAUSED — ativação
 * manual no Google Ads depois de revisar visualmente).
 */
export default function AdCreator({ campaigns }) {
  const [open, setOpen] = useState(false);
  const [serviceLabel, setServiceLabel] = useState(SERVICE_OPTIONS[0]);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaign_id || "");
  const [generating, setGenerating] = useState(false);
  const [headlines, setHeadlines] = useState([]);
  const [descriptions, setDescriptions] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState(null);

  async function handleGenerate() {
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "generate_ad_copy", service_label: serviceLabel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar anúncio");
      setHeadlines(data.headlines);
      setDescriptions(data.descriptions);
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setGenerating(false);
    }
  }

  function updateHeadline(i, value) {
    setHeadlines((prev) => prev.map((h, idx) => (idx === i ? value : h)));
  }

  function updateDescription(i, value) {
    setDescriptions((prev) => prev.map((d, idx) => (idx === i ? value : d)));
  }

  function removeHeadline(i) {
    setHeadlines((prev) => prev.filter((_, idx) => idx !== i));
  }

  function removeDescription(i) {
    setDescriptions((prev) => prev.filter((_, idx) => idx !== i));
  }

  const headlinesValid = headlines.length >= 3 && headlines.every((h) => h.length <= 30 && h.length > 0);
  const descriptionsValid = descriptions.length >= 2 && descriptions.every((d) => d.length <= 90 && d.length > 0);
  const canPublish = headlinesValid && descriptionsValid && campaignId && !publishing;

  async function handlePublish() {
    if (!confirm(`Criar este anúncio (pausado) na campanha selecionada? Você poderá revisar e ativar depois no Google Ads.`)) return;
    setPublishing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "create_ad", campaign_id: campaignId, headlines, descriptions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao publicar anúncio");
      setFeedback({ ok: true, message: data.message });
      setHeadlines([]);
      setDescriptions([]);
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setPublishing(false);
    }
  }

  if (!open) {
    return (
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>
            <Sparkles size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Criar Anúncio com IA
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Gera headlines e descrições para um novo Responsive Search Ad
          </p>
        </div>
        <button className="btn btn-teal btn-sm" onClick={() => setOpen(true)}>
          Criar Anúncio
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Sparkles size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Criar Anúncio com IA
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

      {headlines.length === 0 ? (
        <button className="btn btn-teal" onClick={handleGenerate} disabled={generating}>
          {generating ? (
            <>
              <RefreshCw size={14} className="spin" style={{ marginRight: 6 }} /> Gerando...
            </>
          ) : (
            <>
              <Sparkles size={14} style={{ marginRight: 6 }} /> Gerar com IA
            </>
          )}
        </button>
      ) : (
        <>
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>Headlines ({headlines.length}/15)</strong>
              <span className="muted" style={{ fontSize: 12 }}>Máx. 30 caracteres cada</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {headlines.map((h, i) => (
                <EditableField
                  key={i}
                  value={h}
                  maxLength={30}
                  onChange={(v) => updateHeadline(i, v)}
                  onRemove={headlines.length > 3 ? () => removeHeadline(i) : null}
                />
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>Descriptions ({descriptions.length}/4)</strong>
              <span className="muted" style={{ fontSize: 12 }}>Máx. 90 caracteres cada</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {descriptions.map((d, i) => (
                <EditableField
                  key={i}
                  value={d}
                  maxLength={90}
                  onChange={(v) => updateDescription(i, v)}
                  onRemove={descriptions.length > 2 ? () => removeDescription(i) : null}
                />
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={handleGenerate} disabled={generating}>
              <RefreshCw size={13} style={{ marginRight: 4 }} /> Gerar outra versão
            </button>
            <button className="btn btn-teal" onClick={handlePublish} disabled={!canPublish}>
              <Send size={14} style={{ marginRight: 6 }} />
              {publishing ? "Publicando..." : "Publicar (pausado)"}
            </button>
          </div>
          {!headlinesValid && (
            <p style={{ color: "var(--pink)", fontSize: 12, marginTop: 8 }}>
              Precisa de pelo menos 3 headlines, todas com até 30 caracteres e não vazias.
            </p>
          )}
          {!descriptionsValid && (
            <p style={{ color: "var(--pink)", fontSize: 12, marginTop: 4 }}>
              Precisa de pelo menos 2 descriptions, todas com até 90 caracteres e não vazias.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EditableField({ value, maxLength, onChange, onRemove }) {
  const overLimit = value.length > maxLength;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          padding: "7px 10px",
          borderRadius: 8,
          border: `1px solid ${overLimit ? "var(--pink)" : "var(--gray-light)"}`,
          fontSize: 13,
        }}
      />
      <span
        className="muted"
        style={{ fontSize: 11, minWidth: 36, textAlign: "right", color: overLimit ? "var(--pink)" : undefined }}
      >
        {value.length}/{maxLength}
      </span>
      {onRemove && (
        <button
          className="btn btn-outline btn-sm"
          onClick={onRemove}
          style={{ padding: "4px 8px" }}
          title="Remover"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

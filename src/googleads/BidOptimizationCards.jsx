import { useState } from "react";
import { Clock, Smartphone, MapPin, RefreshCw, Check, AlertTriangle } from "lucide-react";

const DEVICE_LABELS = { MOBILE: "Celular", DESKTOP: "Computador", TABLET: "Tablet" };

function formatHour(h) {
  return `${String(h).padStart(2, "0")}:00 - ${String(h === 23 ? 0 : h + 1).padStart(2, "0")}:00`;
}

/**
 * Card genérico de sugestão de bid modifier — reaproveitado pelas 3
 * otimizações (horário, dispositivo, geográfica), que têm o mesmo
 * formato de interação (escolher campanha → gerar sugestões → aplicar
 * individualmente), só muda o endpoint e como cada sugestão é exibida.
 */
function BidCard({ icon: Icon, title, description, campaigns, suggestAction, applyAction, renderSuggestion }) {
  const [open, setOpen] = useState(false);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaign_id || "");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [avgConvRate, setAvgConvRate] = useState(null);
  const [applying, setApplying] = useState(null);
  const [applied, setApplied] = useState(new Set());
  const [feedback, setFeedback] = useState(null);

  async function handleGenerate() {
    setLoading(true);
    setFeedback(null);
    setSuggestions([]);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: suggestAction, campaign_id: campaignId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar sugestões");
      setSuggestions(data.suggestions || []);
      setAvgConvRate(data.avg_conv_rate ?? null);
      setApplied(new Set());
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleApply(suggestion, key, payload) {
    if (!confirm(`Aplicar este ajuste de lance (${(suggestion.bid_modifier * 100).toFixed(0)}%)?`)) return;
    setApplying(key);
    setFeedback(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: applyAction, campaign_id: campaignId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao aplicar ajuste");
      setApplied((prev) => new Set(prev).add(key));
      setFeedback({ ok: true, message: data.message });
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setApplying(null);
    }
  }

  if (!open) {
    return (
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>
            <Icon size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            {title}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{description}</p>
        </div>
        <button className="btn btn-teal btn-sm" onClick={() => setOpen(true)}>
          Analisar
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Icon size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          {title}
        </span>
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
          Fechar
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

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, marginBottom: 14 }}>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--gray-light)" }}
        >
          {campaigns.map((c) => (
            <option key={c.campaign_id} value={c.campaign_id}>{c.name}</option>
          ))}
        </select>
        <button className="btn btn-teal btn-sm" onClick={handleGenerate} disabled={loading}>
          {loading ? <RefreshCw size={13} className="spin" /> : "Gerar sugestões"}
        </button>
      </div>

      {avgConvRate !== null && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Taxa de conversão média da campanha: {(avgConvRate * 100).toFixed(1)}%
        </p>
      )}

      {suggestions.length === 0 && !loading && avgConvRate !== null && (
        <p className="muted" style={{ fontSize: 13 }}>
          Nenhum ajuste sugerido — dados insuficientes ou já bem distribuídos.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {suggestions.map((s, i) => renderSuggestion(s, i, { applied, applying, handleApply }))}
      </div>
    </div>
  );
}

function ModifierBadge({ modifier }) {
  const isUp = modifier > 1;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 8,
        color: "#fff",
        background: isUp ? "#2E7D32" : "#C62828",
      }}
    >
      {isUp ? "+" : ""}{((modifier - 1) * 100).toFixed(0)}%
    </span>
  );
}

export function HourlyBidCard({ campaigns }) {
  return (
    <BidCard
      icon={Clock}
      title="Otimização por Horário"
      description="Ajusta lances por faixa horária com base na taxa de conversão real"
      campaigns={campaigns}
      suggestAction="suggest_hourly_bids"
      applyAction="apply_hourly_bid"
      renderSuggestion={(s, i, { applied, applying, handleApply }) => {
        const key = `hour-${s.hour}`;
        const isApplied = applied.has(key);
        return (
          <div
            key={i}
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
            <strong style={{ minWidth: 110 }}>{formatHour(s.hour)}</strong>
            <ModifierBadge modifier={s.bid_modifier} />
            <span className="muted" style={{ fontSize: 12, flex: 1 }}>{s.reason}</span>
            {isApplied ? (
              <span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 700 }}>✓ Aplicado</span>
            ) : (
              <button
                className="btn btn-teal btn-sm"
                onClick={() => handleApply(s, key, { hour: s.hour, bid_modifier: s.bid_modifier })}
                disabled={applying === key}
              >
                {applying === key ? "Aplicando..." : "Aplicar"}
              </button>
            )}
          </div>
        );
      }}
    />
  );
}

export function DeviceBidCard({ campaigns }) {
  return (
    <BidCard
      icon={Smartphone}
      title="Otimização por Dispositivo"
      description="Compara mobile vs desktop e ajusta lances conforme conversão"
      campaigns={campaigns}
      suggestAction="suggest_device_bids"
      applyAction="apply_device_bid"
      renderSuggestion={(s, i, { applied, applying, handleApply }) => {
        const key = `device-${s.device}`;
        const isApplied = applied.has(key);
        return (
          <div
            key={i}
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
            <strong style={{ minWidth: 100 }}>{DEVICE_LABELS[s.device] || s.device}</strong>
            <ModifierBadge modifier={s.bid_modifier} />
            <span className="muted" style={{ fontSize: 12, flex: 1 }}>{s.reason}</span>
            {isApplied ? (
              <span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 700 }}>✓ Aplicado</span>
            ) : (
              <button
                className="btn btn-teal btn-sm"
                onClick={() => handleApply(s, key, { device: s.device, bid_modifier: s.bid_modifier })}
                disabled={applying === key}
              >
                {applying === key ? "Aplicando..." : "Aplicar"}
              </button>
            )}
          </div>
        );
      }}
    />
  );
}

export function GeoBidCard({ campaigns }) {
  return (
    <BidCard
      icon={MapPin}
      title="Otimização Geográfica"
      description="Reduz lance fora de Porto Alegre e região metropolitana sem conversões"
      campaigns={campaigns}
      suggestAction="suggest_geo_bids"
      applyAction="apply_geo_bid"
      renderSuggestion={(s, i, { applied, applying, handleApply }) => {
        const key = `geo-${s.geo_target_constant}`;
        const isApplied = applied.has(key);
        return (
          <div
            key={i}
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
            <strong style={{ minWidth: 140 }}>Local ID: {s.geo_target_constant}</strong>
            <ModifierBadge modifier={s.bid_modifier} />
            <span className="muted" style={{ fontSize: 12, flex: 1 }}>{s.reason}</span>
            {isApplied ? (
              <span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 700 }}>✓ Aplicado</span>
            ) : (
              <button
                className="btn btn-teal btn-sm"
                onClick={() =>
                  handleApply(s, key, { geo_target_constant: s.geo_target_constant, bid_modifier: s.bid_modifier })
                }
                disabled={applying === key}
              >
                {applying === key ? "Aplicando..." : "Aplicar"}
              </button>
            )}
          </div>
        );
      }}
    />
  );
}

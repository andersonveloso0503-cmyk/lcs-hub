import { useState } from "react";
import { FlaskConical, Check, AlertTriangle, X } from "lucide-react";

const SERVICE_OPTIONS = [
  "Limpeza para condomínios",
  "Portaria para condomínios",
  "Limpeza para empresas",
  "Facilities e manutenção predial",
  "Serviços terceirizados em geral",
];

/**
 * Cria 2 variantes de anúncio (ângulos diferentes) já ATIVAS no mesmo ad
 * group — diferente de AdCreator.jsx, que sempre cria pausado. O Google
 * Ads já testa A/B nativamente entre RSAs ativos do mesmo ad group, então
 * não há lógica de "vencedor" própria aqui: o algoritmo do Google decide
 * a rotação. Por afetar a conta de forma mais direta (anúncio ativo,
 * gastando, desde o primeiro clique), este card tem uma confirmação extra
 * mais explícita do que as demais ações da Fase 4.
 */
export default function ABTestCard({ campaigns }) {
  const [open, setOpen] = useState(false);
  const [serviceLabel, setServiceLabel] = useState(SERVICE_OPTIONS[0]);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaign_id || "");
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null);
  const [feedback, setFeedback] = useState(null);

  async function handleCreate() {
    if (
      !confirm(
        "Isso vai criar e ATIVAR imediatamente 2 anúncios diferentes nesta campanha, gastando orçamento desde já. O Google vai testar qual performa melhor automaticamente. Continuar?"
      )
    )
      return;
    setCreating(true);
    setFeedback(null);
    setResult(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "create_ab_test", campaign_id: campaignId, service_label: serviceLabel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar teste A/B");
      setResult(data);
      setFeedback({ ok: true, message: data.message });
    } catch (err) {
      setFeedback({ ok: false, message: err.message });
    } finally {
      setCreating(false);
    }
  }

  if (!open) {
    return (
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>
            <FlaskConical size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Testes A/B
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Cria 2 anúncios com ângulos diferentes — Google testa qual performa melhor
          </p>
        </div>
        <button className="btn btn-teal btn-sm" onClick={() => setOpen(true)}>
          Criar Teste
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <FlaskConical size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Testes A/B
        </span>
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
          <X size={14} />
        </button>
      </div>

      <p className="muted" style={{ marginTop: 8, marginBottom: 14, fontSize: 13 }}>
        Gera 2 versões de anúncio com ângulos diferentes (Rapidez vs Confiabilidade) e ativa ambas
        no mesmo grupo de anúncios. ⚠️ Diferente das outras ações, estes anúncios entram{" "}
        <strong>ativos imediatamente</strong>, não pausados.
      </p>

      {feedback && (
        <div
          className="pending-metrics-note"
          style={
            feedback.ok
              ? { borderColor: "var(--teal)", background: "#ECFEFF", marginBottom: 14 }
              : { borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 14 }
          }
        >
          {feedback.ok ? <Check size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} /> : <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />}
          <span>{feedback.message}</span>
        </div>
      )}

      {!result && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
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

          <button className="btn btn-teal" onClick={handleCreate} disabled={creating}>
            {creating ? "Criando..." : "🧪 Criar e Ativar Teste A/B"}
          </button>
        </>
      )}

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ padding: 12, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--gray-light)" }}>
            <strong style={{ fontSize: 13, color: "var(--teal)" }}>Variante A — {result.variant_a?.angle}</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
              {result.variant_a?.headlines?.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
          <div style={{ padding: 12, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--gray-light)" }}>
            <strong style={{ fontSize: 13, color: "var(--blue)" }}>Variante B — {result.variant_b?.angle}</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
              {result.variant_b?.headlines?.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

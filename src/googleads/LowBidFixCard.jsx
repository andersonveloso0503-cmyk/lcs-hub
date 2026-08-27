import { useState } from "react";
import { TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * Corrigir Lances Baixos — verifica se algum grupo de anúncios está com o
 * lance máximo de CPC quase zero (o que trava a exibição de quase todas as
 * palavras-chave, marcadas como "raramente exibido" no Google Ads). Mostra
 * a lista pro usuário confirmar antes de aplicar o novo valor.
 */
export default function LowBidFixCard() {
  const [step, setStep] = useState("idle"); // idle | loading | preview | applying | done
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [newBid, setNewBid] = useState(3.0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function loadPreview() {
    setStep("loading");
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "preview_low_bids" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao verificar lances");
      setCandidates(data.candidates || []);
      setSelected(new Set((data.candidates || []).map((c) => c.ad_group_id)));
      setStep("preview");
    } catch (err) {
      setError(err.message);
      setStep("idle");
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyFix() {
    if (selected.size === 0) return;
    if (!confirm(`Mudar o lance de ${selected.size} grupo(s) para R$${Number(newBid).toFixed(2)}?`)) return;
    setStep("applying");
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "fix_low_bids", ad_group_ids: Array.from(selected), new_bid: Number(newBid) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao aplicar novo lance");
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err.message);
      setStep("preview");
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <TrendingUp size={15} />
        Corrigir Lances Baixos
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 12, fontSize: 13 }}>
        Verifica se algum grupo de anúncios está com lance máximo por clique tão baixo que trava a
        exibição das palavras-chave (aparece como "raramente exibido" no Google Ads).
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 12 }}>
          <span>{error}</span>
        </div>
      )}

      {step === "idle" && (
        <button className="btn btn-primary btn-sm" onClick={loadPreview}>
          Verificar lances
        </button>
      )}

      {step === "loading" && <p className="muted" style={{ fontSize: 13 }}>Verificando os grupos de anúncios...</p>}

      {step === "preview" && (
        <>
          {candidates.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Nenhum lance travado — está tudo em nível competitivo. 🎉</p>
          ) : (
            <>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={13} color="#EF6C00" />
                {candidates.length} grupo(s) com lance abaixo de R$0,50:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {candidates.map((c) => (
                  <label
                    key={c.ad_group_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--gray-light)",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <input type="checkbox" checked={selected.has(c.ad_group_id)} onChange={() => toggle(c.ad_group_id)} />
                    <span style={{ flex: 1 }}>
                      {c.campaign_name} — {c.ad_group_name}
                      <span className="muted"> · lance atual: R${c.cpc_bid.toFixed(2)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <label htmlFor="newBid" style={{ fontSize: 13 }}>Novo lance (R$):</label>
                <input
                  id="newBid"
                  type="number"
                  step="0.5"
                  min="0.1"
                  value={newBid}
                  onChange={(e) => setNewBid(e.target.value)}
                  style={{ width: 80, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--gray-light)" }}
                />
              </div>
              <button className="btn btn-primary btn-sm" onClick={applyFix} disabled={selected.size === 0}>
                Aplicar novo lance em {selected.size} grupo(s)
              </button>
            </>
          )}
        </>
      )}

      {step === "applying" && <p className="muted" style={{ fontSize: 13 }}>Aplicando novo lance...</p>}

      {step === "done" && (
        <p style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={14} color="var(--teal)" />
          {result?.updated || 0} grupo(s) atualizado(s) para R${Number(newBid).toFixed(2)}.
        </p>
      )}
    </div>
  );
}

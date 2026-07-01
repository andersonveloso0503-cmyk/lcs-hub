import { useState, useEffect } from "react";
import { ShieldAlert, X, Check, Settings } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";

/**
 * Stop Loss — detecta campanhas que gastaram acima do limite configurado
 * (padrão R$50) sem nenhuma conversão nos últimos 7 dias, e exibe um
 * alerta no painel pedindo confirmação antes de pausar. O usuário decidiu
 * "pausa mas me avisa primeiro" — então nunca pausa automaticamente, só
 * exibe o alerta e aguarda a decisão manual.
 */
export default function StopLossCard({ campaigns }) {
  const [alerts, setAlerts] = useState([]);
  const [threshold, setThreshold] = useState(50);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("50");
  const [pausing, setPausing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "google_ads_snapshot", "current"), (snap) => {
      if (snap.exists()) {
        setAlerts(snap.data().stop_loss_alerts || []);
        setThreshold(snap.data().stop_loss_threshold || 50);
        setThresholdInput(String(snap.data().stop_loss_threshold || 50));
      }
    });
    return () => unsub();
  }, []);

  if (alerts.length === 0) return null; // nenhum alerta ativo = card não aparece

  async function handlePause(alert) {
    const campaign = campaigns?.find((c) => c.campaign_id === alert.campaign_id);
    if (!confirm(`Pausar a campanha "${alert.campaign_name}"? Ela para de gerar cliques e gastos imediatamente.`)) return;
    setPausing(alert.campaign_id);
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "pause_campaign", campaign_id: alert.campaign_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao pausar campanha");
      await handleDismiss(alert.campaign_id); // remove o alerta depois de pausar
    } catch (err) {
      setError(err.message);
    } finally {
      setPausing(null);
    }
  }

  async function handleDismiss(campaign_id) {
    try {
      await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "dismiss_stop_loss", campaign_id }),
      });
    } catch (err) {
      console.error("Erro ao descartar alerta de stop loss:", err);
    }
  }

  async function handleSaveThreshold() {
    const val = parseFloat(thresholdInput.replace(",", "."));
    if (!val || val <= 0) return;
    try {
      await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "configure_stop_loss", threshold: val }),
      });
      setEditingThreshold(false);
    } catch (err) {
      console.error("Erro ao salvar threshold:", err);
    }
  }

  return (
    <div className="card" style={{ border: "2px solid #C62828" }}>
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#C62828" }}>
        <span>
          <ShieldAlert size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Stop Loss — {alerts.length} alerta(s)
        </span>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => setEditingThreshold((v) => !v)}
          title="Configurar limite"
        >
          <Settings size={13} />
        </button>
      </div>

      {editingThreshold && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Limite de gasto sem conversão:</span>
          <span style={{ fontSize: 13 }}>R$</span>
          <input
            type="text"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            style={{ width: 70, padding: "4px 8px", borderRadius: 8, border: "1px solid var(--gray-light)", fontSize: 13 }}
          />
          <button className="btn btn-teal btn-sm" onClick={handleSaveThreshold}>Salvar</button>
          <button className="btn btn-outline btn-sm" onClick={() => setEditingThreshold(false)}>Cancelar</button>
        </div>
      )}

      <p className="muted" style={{ marginTop: 8, marginBottom: 12, fontSize: 13 }}>
        As campanhas abaixo gastaram mais de R${threshold.toFixed(0)} sem nenhuma conversão nos últimos 7 dias. Revise e decida se deseja pausá-las.
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 12 }}>
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {alerts.map((a) => (
          <div
            key={a.campaign_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: "#FFF0F6",
              border: "1px solid #F8BBD0",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 14 }}>{a.campaign_name}</strong>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                ≈ R${a.estimated_cost_7d.toFixed(2)} gastos em 7 dias · 0 conversões · limite: R${a.threshold}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-sm"
                style={{ background: "#C62828", color: "#fff" }}
                onClick={() => handlePause(a)}
                disabled={pausing === a.campaign_id}
              >
                {pausing === a.campaign_id ? "Pausando..." : "⏸ Pausar"}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => handleDismiss(a.campaign_id)}
              >
                <X size={13} /> Ignorar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

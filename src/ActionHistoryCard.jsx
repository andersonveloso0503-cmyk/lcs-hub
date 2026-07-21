import { useState, useEffect } from "react";
import { History, Undo2, PauseCircle, Ban, CircleDollarSign, SlidersHorizontal, Clock, Monitor, Globe, PlusCircle, Sparkles } from "lucide-react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";

// Ícone + descrição em português simples para cada tipo de ação, na mesma
// ordem em que runAutoOptimizations (api/google-ads-fetch-real.js) as gera.
const ACTION_META = {
  pause_campaign: { icon: PauseCircle, color: "#C62828", label: (a) => `Campanha "${a.campaign}" foi pausada (nota baixa)` },
  negative_keyword: { icon: Ban, color: "#EF6C00", label: (a) => `Bloqueou buscas por "${a.term}" em "${a.campaign}"` },
  budget_reduction: { icon: CircleDollarSign, color: "#6A1B9A", label: (a) => `Orçamento de "${a.campaign}" reduzido: R$${a.old_amount?.toFixed(2)} → R$${a.new_amount?.toFixed(2)}` },
  bidding_strategy: { icon: SlidersHorizontal, color: "var(--teal)", label: (a) => `Estratégia de lance de "${a.campaign}" trocada para ${a.to === "MAXIMIZE_CONVERSIONS" ? "Maximizar Conversões" : "Maximizar Cliques"}` },
  hourly_bid: { icon: Clock, color: "var(--blue)", label: (a) => `Lance ajustado por horário (${a.hour}h) em "${a.campaign}"` },
  device_bid: { icon: Monitor, color: "var(--blue)", label: (a) => `Lance ajustado por dispositivo (${a.device}) em "${a.campaign}"` },
  geo_bid: { icon: Globe, color: "var(--blue)", label: (a) => `Lance ajustado por região em "${a.campaign}"` },
  add_keyword: { icon: PlusCircle, color: "var(--teal)", label: (a) => `Nova palavra-chave "${a.term}" adicionada em "${a.campaign}"` },
  create_ad: { icon: Sparkles, color: "var(--teal)", label: (a) => `Novo anúncio (pausado) criado em "${a.campaign}" — revise antes de publicar` },
};

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return isToday ? `hoje às ${time}` : `${d.toLocaleDateString("pt-BR")} às ${time}`;
}

/**
 * Histórico de Ações — lista as últimas otimizações automáticas aplicadas
 * (vindas da coleção google_ads_action_history, escrita por
 * logActionHistory em api/google-ads-fetch-real.js) e permite desfazer as
 * que têm reversão implementada (pausar campanha, palavra negativa e
 * corte de orçamento). As demais aparecem só para acompanhamento.
 */
export default function ActionHistoryCard() {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "google_ads_action_history"), orderBy("applied_at", "desc"), limit(30));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("Erro ao carregar histórico de ações:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  async function handleRevert(action) {
    if (!confirm("Desfazer essa ação? Ela volta ao estado de antes na sua conta do Google Ads.")) return;
    setReverting(action.id);
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "revert_action", history_id: action.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao desfazer ação");
      // onSnapshot atualiza a lista sozinho assim que o backend marcar reverted: true
    } catch (err) {
      setError(err.message);
    } finally {
      setReverting(null);
    }
  }

  if (loading) return null;
  if (actions.length === 0) return null; // sem histórico ainda = card não aparece

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <History size={15} />
        Histórico de Ações
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 12, fontSize: 13 }}>
        Últimas mudanças aplicadas automaticamente na sua conta. Achou que alguma não fez sentido? Dá pra desfazer.
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 12 }}>
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.map((a) => {
          const meta = ACTION_META[a.type] || { icon: History, color: "var(--gray)", label: () => a.type };
          const Icon = meta.icon;
          return (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--gray-light)",
                background: a.reverted ? "var(--bg)" : "var(--white)",
                opacity: a.reverted ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--bg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={15} color={meta.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: a.reverted ? "line-through" : "none" }}>
                  {meta.label(a)}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {formatWhen(a.applied_at)}
                  {a.reverted && " · desfeita"}
                </div>
              </div>
              {a.revertible && !a.reverted && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleRevert(a)}
                  disabled={reverting === a.id}
                  style={{ flexShrink: 0 }}
                >
                  <Undo2 size={13} /> {reverting === a.id ? "Desfazendo..." : "Desfazer"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

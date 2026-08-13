import { useState } from "react";
import { Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * Limpeza de Conversões — busca (via api/google-ads-fetch-real, ação
 * preview_conversion_cleanup) todas as ações de conversão da conta e
 * separa as que não converteram nada nos últimos 90 dias. O usuário
 * escolhe quais desativar; nada é alterado na conta até confirmar
 * explicitamente (ação cleanup_conversion_actions).
 */
export default function ConversionCleanupCard() {
  const [step, setStep] = useState("idle"); // idle | loading | preview | applying | done
  const [candidates, setCandidates] = useState([]);
  const [keeping, setKeeping] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function loadPreview() {
    setStep("loading");
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "preview_conversion_cleanup" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao buscar ações de conversão");
      setCandidates(data.candidates || []);
      setKeeping(data.keeping || []);
      setSelected(new Set((data.candidates || []).map((c) => c.id)));
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

  async function applyCleanup() {
    if (selected.size === 0) return;
    if (!confirm(`Desativar ${selected.size} ação(ões) de conversão? Dá pra reverter depois no Histórico de Ações.`)) return;
    setStep("applying");
    setError(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ action: "cleanup_conversion_actions", ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao desativar conversões");
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
        <Trash2 size={15} />
        Limpeza de Conversões
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 12, fontSize: 13 }}>
        Verifica quais ações de conversão cadastradas na conta nunca registraram nada nos últimos
        90 dias, pra você desativar as que não servem pra nada — sem mexer nas que estão
        funcionando.
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 12 }}>
          <span>{error}</span>
        </div>
      )}

      {step === "idle" && (
        <button className="btn btn-primary btn-sm" onClick={loadPreview}>
          Ver conversões sem uso
        </button>
      )}

      {step === "loading" && <p className="muted" style={{ fontSize: 13 }}>Verificando os últimos 90 dias de cada ação de conversão...</p>}

      {step === "preview" && (
        <>
          {keeping.length > 0 && (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={13} color="var(--teal)" />
              {keeping.length} ação(ões) com conversão real nos últimos 90 dias — essas ficam de fora, não aparecem aqui.
            </p>
          )}

          {candidates.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Nenhuma ação parada — está tudo em uso. 🎉</p>
          ) : (
            <>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={13} color="#EF6C00" />
                {candidates.length} ação(ões) sem nenhuma conversão em 90 dias:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {candidates.map((c) => (
                  <label
                    key={c.id}
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
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    <span style={{ flex: 1 }}>
                      {c.name}
                      {c.primaryForGoal && <span className="muted" style={{ fontSize: 11 }}> · usada como principal na otimização de lance</span>}
                    </span>
                  </label>
                ))}
              </div>
              <button className="btn btn-primary btn-sm" onClick={applyCleanup} disabled={selected.size === 0}>
                Desativar {selected.size} selecionada(s)
              </button>
            </>
          )}
        </>
      )}

      {step === "applying" && <p className="muted" style={{ fontSize: 13 }}>Desativando...</p>}

      {step === "done" && (
        <p style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={14} color="var(--teal)" />
          {result?.removed || 0} ação(ões) desativada(s). Aparecem no Histórico de Ações acima, com opção de desfazer.
        </p>
      )}
    </div>
  );
}

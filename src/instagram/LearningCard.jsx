import { useState } from "react";
import { Brain, RefreshCw, AlertTriangle } from "lucide-react";

/**
 * Mostra o que a IA aprendeu dos posts mais recentes — tipo de conteúdo
 * que mais performa, horário ideal, palavras-chave das legendas de sucesso.
 * Esses insights são usados automaticamente ao gerar carrosseis e reels.
 */
export default function LearningCard() {
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState(null);
  const [error, setError] = useState(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-creative-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze_top_posts" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao analisar posts");
      setLearning(data.learning);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Brain size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          O que a IA aprendeu com seus posts
        </span>
        <button className="btn btn-teal btn-sm" onClick={handleAnalyze} disabled={loading}>
          {loading ? <><RefreshCw size={13} className="spin" style={{ marginRight: 6 }} />Analisando...</> : learning ? "🔄 Atualizar" : "Analisar"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 14, fontSize: 13 }}>
        Analisa seus últimos posts e identifica padrões dos que geraram mais engajamento.
        Esses insights são usados automaticamente ao criar carrosseis e reels.
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, color: "var(--pink)" }} />
          <span>{error}</span>
        </div>
      )}

      {learning && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 120px", padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--gray-light)" }}>
              <div className="muted" style={{ fontSize: 11 }}>Posts analisados</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{learning.total_posts_analyzed}</div>
            </div>
            <div style={{ flex: "1 1 120px", padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--gray-light)" }}>
              <div className="muted" style={{ fontSize: 11 }}>Melhor tipo</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{learning.best_content_type}</div>
            </div>
            <div style={{ flex: "1 1 120px", padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--gray-light)" }}>
              <div className="muted" style={{ fontSize: 11 }}>Melhor horário</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{learning.best_posting_hour}h</div>
            </div>
            <div style={{ flex: "1 1 120px", padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--teal)" }}>
              <div className="muted" style={{ fontSize: 11 }}>Engajamento top posts</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--teal)" }}>{learning.avg_engagement_top}</div>
            </div>
          </div>

          {learning.top_caption_words?.length > 0 && (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--gray-light)" }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Palavras que mais aparecem nos posts de sucesso</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {learning.top_caption_words.map((w, i) => (
                  <span key={i} style={{ padding: "3px 10px", borderRadius: 20, background: "var(--teal)", color: "#fff", fontSize: 12, fontWeight: 600 }}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}

          {learning.top_posts_preview?.length > 0 && (
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Top posts de referência</div>
              {learning.top_posts_preview.map((p, i) => (
                <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--gray-light)", marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span className="muted" style={{ fontSize: 11 }}>{p.type} · publicado às {p.hour}h</span>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>❤️ {p.likes} 💬 {p.comments}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12 }}>{p.caption_preview}...</p>
                </div>
              ))}
            </div>
          )}

          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            ✅ Esses padrões são usados automaticamente ao criar carrosseis e reels — a IA gera conteúdo
            mais parecido com o que já funcionou nessa conta.
          </p>
        </div>
      )}
    </div>
  );
}

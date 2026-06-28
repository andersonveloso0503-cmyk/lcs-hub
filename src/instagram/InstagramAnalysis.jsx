import { useState } from "react";
import { Sparkles, RefreshCw, Check, X, AlertTriangle, Image as ImageIcon, Download } from "lucide-react";

const SERVICE_OPTIONS = [
  "portaria de condomínio",
  "equipe de limpeza profissional",
  "facilities e manutenção predial",
  "segurança patrimonial",
];

/**
 * Análise de perfil — no mesmo formato do relatório do Ravia.app usado
 * como referência: itens ❌ (problema) e ✅ (ok), com resumo final de
 * prioridade. Busca dados reais do Instagram via Graph API, server-side.
 */
function ProfileAnalysis() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-creative-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze_profile" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao analisar perfil");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>🔍 Análise do Perfil</span>
        <button className="btn btn-teal btn-sm" onClick={handleAnalyze} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw size={13} className="spin" style={{ marginRight: 6 }} /> Analisando...
            </>
          ) : (
            "Analisar Agora"
          )}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 14, fontSize: 13 }}>
        Avalia categoria, biografia, contato e atividade recente — no mesmo estilo de relatório de
        ferramentas como Ravia, Linktree Pulse, etc.
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: 12, borderRadius: 10, background: "var(--bg)" }}>
            {result.profile?.profile_picture_url && (
              <img
                src={result.profile.profile_picture_url}
                alt="Foto de perfil"
                style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }}
              />
            )}
            <div>
              <strong>@{result.profile?.username}</strong>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                {result.profile?.followers_count?.toLocaleString("pt-BR")} seguidores · {result.profile?.media_count} posts
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {result.items?.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: item.status === "problema" ? "#FFF0F6" : "#ECFEFF",
                  border: `1px solid ${item.status === "problema" ? "#F8BBD0" : "var(--teal)"}`,
                }}
              >
                {item.status === "problema" ? (
                  <X size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
                ) : (
                  <Check size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} />
                )}
                <div>
                  <strong style={{ fontSize: 13 }}>{item.title}</strong>
                  <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {result.summary && (
            <div style={{ padding: 14, borderRadius: 10, background: "var(--navy)", color: "#fff" }}>
              <strong style={{ fontSize: 12, letterSpacing: 0.5, color: "var(--teal)" }}>PRIORIDADE Nº1</strong>
              <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>{result.summary}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Gerador de criativo "card escuro" — variação visual mais próxima das
 * referências enviadas pelo usuário (fundo navy, headline grande,
 * faixa de contato), separado do gerador padrão (cards azul/bordô/dourado).
 */
function DarkCardGenerator() {
  const [service, setService] = useState(SERVICE_OPTIONS[0]);
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [image, setImage] = useState(null);
  const [error, setError] = useState(null);

  async function handleGenerate() {
    if (!headline.trim()) {
      setError("Digite o título principal do card.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-creative-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_dark_card", service, headline, subtext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar imagem");
      setImage(data.imageBase64);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  function handleDownload() {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image;
    a.download = `lcs-card-${Date.now()}.png`;
    a.click();
  }

  return (
    <div className="card">
      <div className="card-title">
        <ImageIcon size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
        Criativo Estilo Card Escuro
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 14, fontSize: 13 }}>
        Visual com fundo navy, título grande em destaque e faixa de WhatsApp — no estilo dos
        exemplos enviados.
      </p>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6", marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div>
          <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Cenário de fundo</label>
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--gray-light)" }}
          >
            {SERVICE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Título principal (card destacado)</label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder='Ex: "Portaria terceirizada protege mais do que o acesso"'
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--gray-light)" }}
          />
        </div>
        <div>
          <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Subtítulo (opcional)</label>
          <input
            type="text"
            value={subtext}
            onChange={(e) => setSubtext(e.target.value)}
            placeholder='Ex: "Patrimônio, pessoas e reputação em risco sem controle"'
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--gray-light)" }}
          />
        </div>
      </div>

      <button className="btn btn-teal" onClick={handleGenerate} disabled={generating}>
        {generating ? (
          <>
            <RefreshCw size={14} className="spin" style={{ marginRight: 6 }} /> Gerando...
          </>
        ) : (
          <>
            <Sparkles size={14} style={{ marginRight: 6 }} /> Gerar Criativo
          </>
        )}
      </button>

      {image && (
        <div style={{ marginTop: 16 }}>
          <img src={image} alt="Criativo gerado" style={{ width: "100%", maxWidth: 360, borderRadius: 12, display: "block", margin: "0 auto" }} />
          <button className="btn btn-outline btn-sm" onClick={handleDownload} style={{ marginTop: 10, display: "block", marginLeft: "auto", marginRight: "auto" }}>
            <Download size={13} style={{ marginRight: 6 }} /> Baixar Imagem
          </button>
        </div>
      )}
    </div>
  );
}

export default function InstagramAnalysis() {
  return (
    <div>
      <ProfileAnalysis />
      <DarkCardGenerator />
    </div>
  );
}

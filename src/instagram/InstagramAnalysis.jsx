import { useState } from "react";
import { Sparkles, RefreshCw, Check, X, AlertTriangle, Image as ImageIcon, Download, Lightbulb, Copy, CheckCheck, Wand2 } from "lucide-react";
import { generateCaption, generateCreativeAI, uploadImage } from "./api";

const SERVICE_OPTIONS = [
  "portaria de condomínio",
  "equipe de limpeza profissional",
  "facilities e manutenção predial",
  "segurança patrimonial",
];

// Mesmo mapeamento usado no PostGenerator/WeeklyPlanner, pra escolher a
// cena certa no generate-creative-ai.js a partir do serviço em destaque.
const SERVICE_TO_AI_KEY = {
  "Limpeza e Conservação": "Limpeza",
  "Portaria e Recepção": "Portaria",
  "Facilities e Manutenção": "Facilities",
  "Condomínios e Síndicos": "Condomínios",
  "Empresas / Escritórios": "Empresas",
};
const DEFAULT_SERVICE = "Limpeza e Conservação";

/**
 * Botão + painel de sugestão de correção para um item específico do
 * relatório de análise. Comportamento depende do action_type retornado
 * pela IA:
 * - "copy_text" (bio, categoria, link) → mostra texto + botão "Copiar".
 *   A Graph API não permite editar esses campos via API para este tipo de
 *   conta, então sempre fica manual.
 * - "create_content" (poucos posts, falta variedade, etc.) → mostra botão
 *   "Corrigir com IA" que gera legenda + imagem automaticamente e salva
 *   como RASCUNHO (nunca publica direto — aprovação fica em "Meus Posts").
 * - "manual_action" → só explicação, sem botão de ação.
 */
function FixSuggestion({ item, profile, onSavePost }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Estado da correção automática (create_content)
  const [applying, setApplying] = useState(false);
  const [applyStep, setApplyStep] = useState(""); // texto de progresso
  const [applyResult, setApplyResult] = useState(null); // { ok, error }

  async function handleClick() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (suggestion) return; // já buscou antes, não busca de novo
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-creative-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest_fix", item, profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar sugestão");
      setSuggestion(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!suggestion?.ready_to_copy) return;
    navigator.clipboard.writeText(suggestion.ready_to_copy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /**
   * Corrige automaticamente quando a ação é "criar conteúdo": gera legenda
   * + imagem via IA (mesmas funções já usadas no Gerador de Post manual) e
   * salva tudo como rascunho — nunca publica sem revisão humana.
   */
  async function handleApplyWithAI() {
    setApplying(true);
    setApplyResult(null);
    const service = DEFAULT_SERVICE;
    const aiKey = SERVICE_TO_AI_KEY[service] || "Limpeza";

    try {
      setApplyStep("Gerando legenda...");
      const captionResult = await generateCaption({
        service,
        tone: "Profissional e confiante",
        goal: "Dica profissional",
        context: `Post criado a partir da correção sugerida pela Análise IA: "${item.title}" — ${item.detail}`,
      });
      if (!captionResult.ok) throw new Error(captionResult.error);

      setApplyStep("Gerando imagem...");
      const imageResult = await generateCreativeAI({ service: aiKey, headline: aiKey, format: "post", provider: "openai" });
      if (!imageResult.ok) throw new Error(imageResult.error);

      setApplyStep("Salvando rascunho...");
      const upload = await uploadImage(imageResult.imageBase64, `correcao-ia-${Date.now()}.png`);
      if (!upload.ok) throw new Error(upload.error);

      await onSavePost({
        service,
        caption: captionResult.caption,
        imageUrl: upload.url,
        status: "rascunho",
        origin: "analise_ia_correcao",
      });

      setApplyResult({ ok: true });
    } catch (err) {
      setApplyResult({ ok: false, error: err.message });
    } finally {
      setApplying(false);
      setApplyStep("");
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        className="btn btn-outline btn-sm"
        onClick={handleClick}
        style={{ fontSize: 12, padding: "4px 10px" }}
      >
        <Lightbulb size={12} style={{ marginRight: 5 }} />
        {open ? "Ocultar sugestão" : "Como corrigir?"}
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            borderRadius: 10,
            background: "#fff",
            border: "1px solid var(--gray-light)",
          }}
        >
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--gray)" }}>
              <RefreshCw size={13} className="spin" /> Gerando sugestão...
            </div>
          )}

          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--pink)" }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {suggestion && (
            <>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{suggestion.suggestion_text}</p>

              {suggestion.ready_to_copy && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    borderRadius: 8,
                    background: "var(--bg)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {suggestion.ready_to_copy}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {/* copy_text: texto pronto pra colar manualmente no Instagram */}
                {suggestion.action_type === "copy_text" && suggestion.ready_to_copy && (
                  <button className="btn btn-teal btn-sm" onClick={handleCopy} style={{ fontSize: 12 }}>
                    {copied ? (
                      <>
                        <CheckCheck size={13} style={{ marginRight: 6 }} /> Copiado!
                      </>
                    ) : (
                      <>
                        <Copy size={13} style={{ marginRight: 6 }} /> Copiar texto
                      </>
                    )}
                  </button>
                )}

                {/* create_content: gera e salva o conteúdo automaticamente como rascunho */}
                {suggestion.action_type === "create_content" && (
                  <button
                    className="btn btn-gads btn-sm"
                    onClick={handleApplyWithAI}
                    disabled={applying || applyResult?.ok}
                    style={{ fontSize: 12 }}
                  >
                    {applying ? (
                      <>
                        <RefreshCw size={13} className="spin" style={{ marginRight: 6 }} /> {applyStep || "Aplicando..."}
                      </>
                    ) : applyResult?.ok ? (
                      <>
                        <CheckCheck size={13} style={{ marginRight: 6 }} /> Rascunho criado!
                      </>
                    ) : (
                      <>
                        <Wand2 size={13} style={{ marginRight: 6 }} /> Corrigir com IA
                      </>
                    )}
                  </button>
                )}
              </div>

              {applyResult?.ok && (
                <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: "var(--teal)" }}>
                  ✅ Um rascunho foi criado na aba "Meus Posts" — revise e publique quando quiser.
                </p>
              )}
              {applyResult?.error && (
                <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: "var(--pink)" }}>
                  ⚠️ {applyResult.error}
                </p>
              )}

              <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 11 }}>
                {suggestion.action_type === "create_content"
                  ? "A IA gera o conteúdo e salva como rascunho — nada é publicado sem sua aprovação."
                  : "Revise antes de aplicar — você decide e cola/ajusta manualmente no Instagram."}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Análise de perfil — no mesmo formato do relatório do Ravia.app usado
 * como referência: itens ❌ (problema) e ✅ (ok), com resumo final de
 * prioridade. Busca dados reais do Instagram via Graph API, server-side.
 */
function ProfileAnalysis({ onSavePost }) {
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
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: item.status === "problema" ? "#FFF0F6" : "#ECFEFF",
                  border: `1px solid ${item.status === "problema" ? "#F8BBD0" : "var(--teal)"}`,
                }}
              >
                <div style={{ display: "flex", gap: 10 }}>
                  {item.status === "problema" ? (
                    <X size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
                  ) : (
                    <Check size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 13 }}>{item.title}</strong>
                    <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>{item.detail}</p>

                    {/* Botão de sugestão só aparece para itens marcados como problema */}
                    {item.status === "problema" && (
                      <FixSuggestion item={item} profile={result.profile} onSavePost={onSavePost} />
                    )}
                  </div>
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
function DarkCardGenerator({ addPhoto }) {
  const [service, setService] = useState(SERVICE_OPTIONS[0]);
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [image, setImage] = useState(null);
  const [error, setError] = useState(null);

  // Status do salvamento automático no Banco de Temas, que acontece em
  // seguida à geração da imagem, sem precisar de clique extra.
  const [savingToBank, setSavingToBank] = useState(false);
  const [bankSaveError, setBankSaveError] = useState(null);
  const [savedToBank, setSavedToBank] = useState(false);

  async function handleGenerate() {
    if (!headline.trim()) {
      setError("Digite o título principal do card.");
      return;
    }
    setGenerating(true);
    setError(null);
    setSavedToBank(false);
    setBankSaveError(null);
    try {
      const res = await fetch("/api/generate-creative-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_dark_card", service, headline, subtext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar imagem");
      setImage(data.imageBase64);
      // Salva automaticamente no Banco de Temas, sem exigir clique extra.
      saveToThemeBank(data.imageBase64);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function saveToThemeBank(imageBase64) {
    setSavingToBank(true);
    setBankSaveError(null);
    try {
      const upload = await uploadImage(imageBase64, `card-escuro-${Date.now()}.png`);
      if (!upload.ok) throw new Error(upload.error || "Erro no upload da imagem");
      await addPhoto({
        service,
        imageUrl: upload.url,
        headline,
        subtext: subtext || "",
        source: "card_escuro",
      });
      setSavedToBank(true);
    } catch (err) {
      setBankSaveError(err.message);
    } finally {
      setSavingToBank(false);
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

          <div style={{ textAlign: "center", marginTop: 10, fontSize: 12 }}>
            {savingToBank && (
              <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <RefreshCw size={12} className="spin" /> Salvando no Banco de Temas...
              </span>
            )}
            {savedToBank && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--teal)" }}>
                <CheckCheck size={13} /> Salvo no Banco de Temas
              </span>
            )}
            {bankSaveError && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--pink)" }}>
                <AlertTriangle size={13} /> Não foi possível salvar no Banco de Temas: {bankSaveError}
              </span>
            )}
          </div>

          <button className="btn btn-outline btn-sm" onClick={handleDownload} style={{ marginTop: 10, display: "block", marginLeft: "auto", marginRight: "auto" }}>
            <Download size={13} style={{ marginRight: 6 }} /> Baixar Imagem
          </button>
        </div>
      )}
    </div>
  );
}

export default function InstagramAnalysis({ onSavePost, addPhoto }) {
  return (
    <div>
      <ProfileAnalysis onSavePost={onSavePost} />
      <DarkCardGenerator addPhoto={addPhoto} />
    </div>
  );
}

import { useState } from "react";
import { Sparkles, Send, Calendar, Copy, Image as ImageIcon, RefreshCw } from "lucide-react";
import { generateCaption, scheduleToBuffer, generateCreativeAI, uploadImage } from "./api";

const SERVICE_OPTIONS = [
  "Limpeza e Conservação",
  "Portaria e Recepção",
  "Facilities e Manutenção",
  "Condomínios e Síndicos",
  "Empresas / Escritórios",
  "Apresentação Geral LCS",
];

const TONE_OPTIONS = [
  "Profissional e confiante",
  "Amigável e próximo",
  "Urgente / Promoção",
  "Educativo / Informativo",
];

const GOAL_OPTIONS = [
  "Transmitir credibilidade",
  "Destacar diferenciais",
  "Chamar para orçamento",
  "Dica profissional",
  "Antes e depois / Resultados",
];

// Mapeamento pro generate-creative-ai.js, igual ao usado no WeeklyPlanner.
const SERVICE_TO_AI_KEY = {
  "Limpeza e Conservação": "Limpeza",
  "Portaria e Recepção": "Portaria",
  "Facilities e Manutenção": "Facilities",
  "Condomínios e Síndicos": "Condomínios",
  "Empresas / Escritórios": "Empresas",
  "Apresentação Geral LCS": "Limpeza",
};

export default function PostGenerator({ themeBankPhotos, onSavePost }) {
  const [service, setService] = useState(SERVICE_OPTIONS[0]);
  const [tone, setTone] = useState(TONE_OPTIONS[0]);
  const [goal, setGoal] = useState(GOAL_OPTIONS[0]);
  const [context, setContext] = useState("");
  const [caption, setCaption] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const [selectedPhotoId, setSelectedPhotoId] = useState(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [showAllPhotos, setShowAllPhotos] = useState(false);

  // Comparação de criativos IA: gera um de cada provider lado a lado, pra
  // ver a qualidade antes de decidir qual usar no automático (auto-week.js).
  const [aiPreview, setAiPreview] = useState({ openai: null, gemini: null });
  const [aiPreviewLoading, setAiPreviewLoading] = useState({ openai: false, gemini: false });
  const [aiPreviewError, setAiPreviewError] = useState({ openai: "", gemini: "" });
  const [selectedAiProvider, setSelectedAiProvider] = useState(null); // "openai" | "gemini" | null

  const matchingPhotos = themeBankPhotos.filter((p) =>
    service.toLowerCase().includes(p.service?.toLowerCase().split(" ")[0] || "zzz")
  );
  const photosToShow = showAllPhotos || matchingPhotos.length === 0 ? themeBankPhotos : matchingPhotos;
  const selectedPhoto = themeBankPhotos.find((p) => p.id === selectedPhotoId);

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    const result = await generateCaption({ service, tone, goal, context });
    if (result.ok) {
      setCaption(result.caption);
    } else {
      setError(result.error);
    }
    setGenerating(false);
  }

  function copyCaption() {
    navigator.clipboard.writeText(caption);
  }

  async function handleGenerateAiPreview(provider) {
    setAiPreviewLoading((prev) => ({ ...prev, [provider]: true }));
    setAiPreviewError((prev) => ({ ...prev, [provider]: "" }));
    const aiKey = SERVICE_TO_AI_KEY[service] || "Limpeza";
    const result = await generateCreativeAI({ service: aiKey, headline: aiKey, format: "post", provider });
    if (result.ok) {
      setAiPreview((prev) => ({ ...prev, [provider]: result.imageBase64 }));
    } else {
      setAiPreviewError((prev) => ({ ...prev, [provider]: result.error }));
    }
    setAiPreviewLoading((prev) => ({ ...prev, [provider]: false }));
  }

  function handleGenerateBothPreviews() {
    handleGenerateAiPreview("openai");
    handleGenerateAiPreview("gemini");
  }

  function selectAiPhoto(provider) {
    setSelectedAiProvider(provider);
    setSelectedPhotoId(null); // desmarca foto do Banco de Temas, se tinha uma
  }

  async function handleSendToBuffer() {
    const usingAiImage = selectedAiProvider && aiPreview[selectedAiProvider];
    if (!caption || (!selectedPhoto && !usingAiImage)) {
      setError("Gere a legenda e escolha uma imagem (Banco de Temas ou criativo IA) antes de enviar.");
      return;
    }
    setSending(true);
    setError("");
    setSendResult(null);

    let imageUrl = selectedPhoto?.imageUrl || null;
    let imageSource = "temas";

    if (usingAiImage) {
      // Imagem da IA vem em base64 — precisa subir pro Blob antes, já que o
      // Buffer exige uma URL pública.
      const upload = await uploadImage(aiPreview[selectedAiProvider], `post-${Date.now()}.png`);
      if (!upload.ok) {
        setError("Erro no upload da imagem: " + upload.error);
        setSending(false);
        return;
      }
      imageUrl = upload.url;
      imageSource = selectedAiProvider; // "openai" ou "gemini"
    }

    const result = await scheduleToBuffer({
      text: caption,
      imageUrl,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });

    if (result.ok || result.partial) {
      setSendResult({ ok: true, partial: result.partial });
      if (result.partial) {
        const failed = result.results?.filter((r) => !r.ok).map((r) => r.channel).join(", ");
        setError(`Publicado parcialmente — falhou em: ${failed}`);
      }
      // Guarda os IDs dos posts criados no Buffer (um por canal bem-sucedido),
      // para permitir excluir ou trocar a imagem depois direto no Buffer.
      const bufferPostIds = (result.results || [])
        .filter((r) => r.ok && r.post?.id)
        .map((r) => r.post.id);
      await onSavePost({
        service,
        caption,
        imageUrl,
        status: scheduledAt ? "agendado" : "publicado",
        scheduledAt: scheduledAt || null,
        bufferPostIds,
        imageSource,
      });
    } else {
      setError("Erro ao agendar no Buffer: " + result.error);
    }
    setSending(false);
  }

  async function handleSaveDraft() {
    const usingAiImage = selectedAiProvider && aiPreview[selectedAiProvider];
    await onSavePost({
      service,
      caption,
      imageUrl: selectedPhoto?.imageUrl || (usingAiImage ? aiPreview[selectedAiProvider] : null),
      status: "rascunho",
    });
    setSendResult({ ok: true, draft: true });
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">✦ Configurar post</div>

        <label>Serviço em destaque</label>
        <div className="chips">
          {SERVICE_OPTIONS.map((s) => (
            <div
              key={s}
              className={"chip" + (service === s ? " selected" : "")}
              onClick={() => setService(s)}
            >
              {s}
            </div>
          ))}
        </div>

        <label>Tom de voz</label>
        <div className="chips">
          {TONE_OPTIONS.map((t) => (
            <div
              key={t}
              className={"chip" + (tone === t ? " selected" : "")}
              onClick={() => setTone(t)}
            >
              {t}
            </div>
          ))}
        </div>

        <label>Tema / Objetivo</label>
        <div className="chips">
          {GOAL_OPTIONS.map((g) => (
            <div
              key={g}
              className={"chip" + (goal === g ? " selected" : "")}
              onClick={() => setGoal(g)}
            >
              {g}
            </div>
          ))}
        </div>

        <label>Contexto extra (opcional)</label>
        <textarea
          placeholder="Ex: foto de equipe em condomínio, antes e depois de limpeza..."
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />

        <div className="btn-row">
          <button className="btn btn-ig" onClick={handleGenerate} disabled={generating}>
            <Sparkles size={15} /> {generating ? "Gerando..." : "Gerar com IA"}
          </button>
        </div>
      </div>

      {(caption || generating) && (
        <div className="card">
          <div className="card-title">📝 Legenda gerada</div>
          <div className={"output-box" + (generating ? " loading" : "")}>
            {!generating && caption && (
              <button className="copy-btn" onClick={copyCaption}>
                <Copy size={11} /> Copiar
              </button>
            )}
            <span>{generating ? "Gerando legenda personalizada..." : caption}</span>
          </div>
          {!generating && caption && (
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              style={{ marginTop: 12 }}
              placeholder="Edite a legenda se quiser ajustar algo..."
            />
          )}
        </div>
      )}

      {caption && !generating && (
        <div className="card">
          <div
            className="card-title"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span>🆚 Comparar criativo gerado por IA (opcional)</span>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleGenerateBothPreviews}
              disabled={aiPreviewLoading.openai || aiPreviewLoading.gemini}
            >
              <RefreshCw size={13} /> Gerar dos dois
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 14 }}>
            Gera uma imagem de teste em cada provider pra você comparar qualidade antes de
            escolher. Isso é só uma prévia — não agenda nada ainda.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* OpenAI */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>🎨 OpenAI</strong>
                <button className="btn btn-outline btn-sm" onClick={() => handleGenerateAiPreview("openai")} disabled={aiPreviewLoading.openai}>
                  <RefreshCw size={12} className={aiPreviewLoading.openai ? "spin" : ""} />
                </button>
              </div>
              <div
                className={"photo-card" + (selectedAiProvider === "openai" ? " selected" : "")}
                style={{ minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", cursor: aiPreview.openai ? "pointer" : "default" }}
                onClick={() => aiPreview.openai && selectAiPhoto("openai")}
              >
                {aiPreviewLoading.openai ? (
                  <RefreshCw size={20} className="spin" />
                ) : aiPreview.openai ? (
                  <img src={aiPreview.openai} alt="Criativo OpenAI" style={{ width: "100%" }} />
                ) : (
                  <ImageIcon size={20} className="muted" />
                )}
              </div>
              {aiPreviewError.openai && <div className="chat-error" style={{ marginTop: 6, fontSize: 11 }}>{aiPreviewError.openai}</div>}
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>~$0.03–0.05/img · texto na imagem mais preciso</p>
            </div>

            {/* Gemini */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>✨ Gemini</strong>
                <button className="btn btn-outline btn-sm" onClick={() => handleGenerateAiPreview("gemini")} disabled={aiPreviewLoading.gemini}>
                  <RefreshCw size={12} className={aiPreviewLoading.gemini ? "spin" : ""} />
                </button>
              </div>
              <div
                className={"photo-card" + (selectedAiProvider === "gemini" ? " selected" : "")}
                style={{ minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", cursor: aiPreview.gemini ? "pointer" : "default" }}
                onClick={() => aiPreview.gemini && selectAiPhoto("gemini")}
              >
                {aiPreviewLoading.gemini ? (
                  <RefreshCw size={20} className="spin" />
                ) : aiPreview.gemini ? (
                  <img src={aiPreview.gemini} alt="Criativo Gemini" style={{ width: "100%" }} />
                ) : (
                  <ImageIcon size={20} className="muted" />
                )}
              </div>
              {aiPreviewError.gemini && <div className="chat-error" style={{ marginTop: 6, fontSize: 11 }}>{aiPreviewError.gemini}</div>}
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>custo bem menor · sem texto embutido na imagem</p>
            </div>
          </div>

          {selectedAiProvider && (
            <div className="followup-empty" style={{ marginTop: 12 }}>
              ✅ Criativo {selectedAiProvider === "openai" ? "OpenAI" : "Gemini"} selecionado para este post.
            </div>
          )}
        </div>
      )}

      {caption && !generating && (
        <div className="card">
          <div
            className="card-title"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span>
              <ImageIcon size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
              Ou escolha uma foto do Banco de Temas
            </span>
            {matchingPhotos.length > 0 && matchingPhotos.length < themeBankPhotos.length && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setShowAllPhotos((v) => !v)}
              >
                {showAllPhotos ? `Só de ${service}` : `Ver todas (${themeBankPhotos.length})`}
              </button>
            )}
          </div>

          {photosToShow.length === 0 ? (
            <p className="muted">
              Nenhuma foto disponível ainda. Vá para o Editor de Fotos e processe algumas fotos
              primeiro.
            </p>
          ) : (
            <div className="photo-grid">
              {photosToShow.map((p) => (
                <div
                  key={p.id}
                  className={"photo-card selectable" + (selectedPhotoId === p.id ? " selected" : "")}
                  onClick={() => { setSelectedPhotoId(p.id); setSelectedAiProvider(null); }}
                >
                  <img src={p.imageUrl} alt={p.service} />
                </div>
              ))}
            </div>
          )}

          <label style={{ marginTop: 16 }}>Agendar para (opcional — deixe vazio para publicar agora via Buffer)</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />

          {error && <div className="chat-error" style={{ marginBottom: 12 }}>{error}</div>}
          {sendResult?.ok && !sendResult.draft && (
            <div className="followup-empty" style={{ marginBottom: 12 }}>
              ✅ Post enviado ao Buffer com sucesso!
            </div>
          )}
          {sendResult?.draft && (
            <div className="followup-empty" style={{ marginBottom: 12 }}>
              💾 Rascunho salvo!
            </div>
          )}

          <div className="btn-row">
            <button className="btn btn-outline btn-sm" onClick={handleSaveDraft}>
              💾 Salvar rascunho
            </button>
            <button className="btn btn-gads" onClick={handleSendToBuffer} disabled={sending}>
              {scheduledAt ? <Calendar size={14} /> : <Send size={14} />}
              {sending ? "Enviando..." : scheduledAt ? "Agendar no Buffer" : "Publicar agora via Buffer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

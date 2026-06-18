import { useState, useRef } from "react";
import { Upload, X, Download, Save, Loader2, Sparkles, Wand2 } from "lucide-react";
import { loadImage, applyStyle, STYLE_THEMES, FORMAT_SIZES } from "./photoStyle";
import { uploadImage, generateHeadline, generateCreativeAI } from "./api";

const SERVICE_OPTIONS = [
  "Limpeza",
  "Portaria",
  "Facilities",
  "Condomínios",
  "Empresas",
];

export default function PhotoEditor({ onSaveToBank }) {
  const [files, setFiles] = useState([]); // { id, img, styledUrl }
  const [theme, setTheme] = useState("azul");
  const [format, setFormat] = useState("post");
  const [service, setService] = useState("Limpeza");
  const [headline, setHeadline] = useState("");
  const [headlineGenerating, setHeadlineGenerating] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = useRef(null);

  // Estado separado para o fluxo de "Criativo pronto com IA" (gera a imagem
  // inteira a partir de um prompt, sem precisar de foto própria).
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResultUrl, setAiResultUrl] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSaveSuccess, setAiSaveSuccess] = useState(false);

  async function handleSuggestHeadline() {
    setHeadlineGenerating(true);
    const result = await generateHeadline(service);
    if (result.ok) {
      setHeadline(result.headline);
    }
    setHeadlineGenerating(false);
  }

  async function handleGenerateAICreative() {
    setAiGenerating(true);
    setAiError("");
    setAiResultUrl(null);
    setAiSaveSuccess(false);
    const result = await generateCreativeAI({
      service,
      headline: headline || `${service} Profissional`,
      format,
    });
    if (result.ok) {
      setAiResultUrl(result.imageBase64);
    } else {
      setAiError(result.error);
    }
    setAiGenerating(false);
  }

  async function handleSaveAICreativeToBank() {
    if (!aiResultUrl) return;
    setAiSaving(true);
    setAiError("");
    const upload = await uploadImage(aiResultUrl, `ai-criativo-${Date.now()}.png`);
    if (!upload.ok) {
      setAiError(`Erro ao enviar a imagem: ${upload.error}`);
      setAiSaving(false);
      return;
    }
    try {
      await onSaveToBank({ service, theme, format, imageUrl: upload.url });
      setAiSaveSuccess(true);
      setAiResultUrl(null);
    } catch (err) {
      setAiError(`Erro ao salvar no banco de temas: ${err.message}`);
    }
    setAiSaving(false);
  }

  async function handleFiles(fileList) {
    const newItems = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith("image/")) continue;
      const img = await loadImage(file);
      newItems.push({ id: crypto.randomUUID(), img, styledUrl: null });
    }
    setFiles((prev) => [...prev, ...newItems]);
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  async function applyStyleToAll() {
    setProcessing(true);
    const updated = await Promise.all(
      files.map(async (f) => ({
        ...f,
        styledUrl: await applyStyle(f.img, theme, format, service, headline),
      }))
    );
    setFiles(updated);
    setProcessing(false);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function clearAll() {
    setFiles([]);
  }

  function downloadImage(styledUrl, index) {
    const a = document.createElement("a");
    a.href = styledUrl;
    a.download = `lcs-post-${index + 1}.png`;
    a.click();
  }

  async function saveAllToBank() {
    const styled = files.filter((f) => f.styledUrl);
    if (styled.length === 0) return;

    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    let savedCount = 0;
    for (const f of styled) {
      // Faz upload da imagem para o Vercel Blob primeiro — o Firestore tem um
      // limite de 1MB por documento, e uma foto em base64 facilmente passa
      // disso, causando falha silenciosa se salva direto.
      const upload = await uploadImage(f.styledUrl, `theme-bank-${Date.now()}-${f.id}.png`);
      if (!upload.ok) {
        setSaveError(`Erro ao enviar uma das fotos: ${upload.error}`);
        continue;
      }

      try {
        await onSaveToBank({
          service,
          theme,
          format,
          imageUrl: upload.url,
        });
        savedCount++;
      } catch (err) {
        setSaveError(`Erro ao salvar no banco de temas: ${err.message}`);
      }
    }

    setSaving(false);
    if (savedCount > 0) {
      setSaveSuccess(true);
      setFiles([]); // limpa a área de upload já que as fotos foram persistidas
    }
  }

  const hasStyled = files.some((f) => f.styledUrl);

  return (
    <div>
      <div className="card">
        <div className="card-title">Configuração do post</div>
        <p className="muted" style={{ marginBottom: 12 }}>
          Esses campos valem tanto para estilizar fotos próprias quanto para o criativo gerado
          por IA, abaixo — escolha o serviço aqui antes de usar qualquer uma das duas opções.
        </p>

        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div>
            <label>Serviço</label>
            <select value={service} onChange={(e) => setService(e.target.value)}>
              {SERVICE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Formato</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {Object.keys(FORMAT_SIZES).map((key) => (
                <option key={key} value={key}>
                  {key === "post" ? "Post (1:1)" : key === "stories" ? "Stories (9:16)" : "Reels (9:16)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Estilo visual (só para fotos próprias)</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              {Object.entries(STYLE_THEMES).map(([key, t]) => (
                <option key={key} value={key}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label>Título de destaque (opcional — ex: "Limpeza Profissional para Condomínios")</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder={`Deixe em branco para usar "${service} Profissional"`}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-outline btn-sm"
            onClick={handleSuggestHeadline}
            disabled={headlineGenerating}
            title="Gerar um título criativo com IA"
          >
            {headlineGenerating ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <>
                <Sparkles size={14} /> Sugerir com IA
              </>
            )}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🎨 Editor de Fotos — Estilo LCS</div>
        <p className="muted" style={{ marginBottom: 16 }}>
          Faça upload das suas fotos reais e aplique o estilo visual da marca automaticamente.
        </p>

        <div
          className="upload-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={28} />
          <div>Arraste fotos aqui ou clique para selecionar</div>
          <span className="muted">JPG, PNG, WEBP — múltiplas fotos aceitas</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Wand2 size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Criativo pronto com IA (sem precisar de foto própria)
        </div>
        <p className="muted" style={{ marginBottom: 12 }}>
          A IA gera a imagem completa do zero (foto + textos + elementos visuais, tudo junto),
          usando o serviço e o título de destaque definidos acima. A logo real da LCS não entra
          nessa imagem (a IA não consegue reproduzi-la com fidelidade) — se precisar da logo,
          use o Editor de Fotos abaixo com uma foto própria. <strong>Atenção:</strong> modelos de
          geração de imagem podem errar a escrita de texto dentro da imagem (nome, telefone,
          etc.) — sempre revise visualmente o resultado antes de salvar ou publicar. Cada clique
          tem custo (~R$ 0,15–0,25 por imagem, cobrado na sua conta OpenAI).
        </p>

        <button className="btn btn-ig" onClick={handleGenerateAICreative} disabled={aiGenerating}>
          {aiGenerating ? (
            <>
              <Loader2 size={14} className="spin" /> Gerando criativo...
            </>
          ) : (
            <>
              <Sparkles size={14} /> Gerar criativo com IA
            </>
          )}
        </button>

        {aiError && <div className="chat-error" style={{ marginTop: 12 }}>{aiError}</div>}

        {aiSaveSuccess && (
          <div className="followup-empty" style={{ marginTop: 12 }}>
            ✅ Criativo salvo no Banco de Temas!
          </div>
        )}

        {aiResultUrl && (
          <div style={{ marginTop: 16 }}>
            <img
              src={aiResultUrl}
              alt="Criativo gerado por IA"
              style={{ maxWidth: "100%", borderRadius: 12, marginBottom: 12 }}
            />
            <div className="btn-row">
              <button
                className="btn btn-teal btn-sm"
                onClick={handleSaveAICreativeToBank}
                disabled={aiSaving}
              >
                {aiSaving ? (
                  <>
                    <Loader2 size={14} className="spin" /> Salvando...
                  </>
                ) : (
                  <>
                    <Save size={14} /> Salvar no Banco de Temas
                  </>
                )}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setAiResultUrl(null)}>
                <X size={14} /> Descartar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">📷 Estilizar fotos próprias</div>

        {files.length > 0 && (
          <>
            <div className="btn-row" style={{ marginTop: 4 }}>
              <button className="btn btn-ig" onClick={applyStyleToAll} disabled={processing}>
                {processing ? (
                  <>
                    <Loader2 size={14} className="spin" /> Aplicando...
                  </>
                ) : (
                  <>✨ Aplicar estilo em todas</>
                )}
              </button>
              <button className="btn btn-outline btn-sm" onClick={clearAll}>
                <X size={14} /> Limpar
              </button>
              {hasStyled && (
                <button className="btn btn-teal btn-sm" onClick={saveAllToBank} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 size={14} className="spin" /> Salvando...
                    </>
                  ) : (
                    <>
                      <Save size={14} /> Salvar no Banco de Temas
                    </>
                  )}
                </button>
              )}
            </div>

            {saveError && <div className="chat-error" style={{ marginTop: 12 }}>{saveError}</div>}
            {saveSuccess && !saveError && (
              <div className="followup-empty" style={{ marginTop: 12 }}>
                ✅ Fotos salvas no Banco de Temas com sucesso!
              </div>
            )}
          </>
        )}

        {files.length > 0 && (
          <div className="photo-grid">
            {files.map((f, i) => (
              <div key={f.id} className="photo-card">
                <button className="photo-remove" onClick={() => removeFile(f.id)}>
                  <X size={13} />
                </button>
                <img src={f.styledUrl || f.img.src} alt={`Foto ${i + 1}`} />
                {f.styledUrl && (
                  <button
                    className="btn btn-outline btn-sm photo-download"
                    onClick={() => downloadImage(f.styledUrl, i)}
                  >
                    <Download size={12} /> PNG
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

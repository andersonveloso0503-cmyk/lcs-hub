import { useState, useRef } from "react";
import { Upload, X, Download, Save } from "lucide-react";
import { loadImage, applyStyle, STYLE_THEMES, FORMAT_SIZES } from "./photoStyle";

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
  const [opacity, setOpacity] = useState(0.85);
  const [service, setService] = useState("Limpeza");
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef(null);

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

  function applyStyleToAll() {
    setProcessing(true);
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        styledUrl: applyStyle(f.img, theme, format, opacity),
      }))
    );
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
    for (const f of styled) {
      await onSaveToBank({
        service,
        theme,
        format,
        imageDataUrl: f.styledUrl,
      });
    }
  }

  const hasStyled = files.some((f) => f.styledUrl);

  return (
    <div>
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

        {files.length > 0 && (
          <>
            <div className="grid-3" style={{ marginTop: 20 }}>
              <div>
                <label>Estilo visual</label>
                <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                  {Object.entries(STYLE_THEMES).map(([key, t]) => (
                    <option key={key} value={key}>
                      {t.name}
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
                <label>Serviço (para o Banco de Temas)</label>
                <select value={service} onChange={(e) => setService(e.target.value)}>
                  {SERVICE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label>Opacidade da faixa: {Math.round(opacity * 100)}%</label>
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              style={{ width: "100%", marginBottom: 16 }}
            />

            <div className="btn-row">
              <button className="btn btn-ig" onClick={applyStyleToAll} disabled={processing}>
                ✨ Aplicar estilo em todas
              </button>
              <button className="btn btn-outline btn-sm" onClick={clearAll}>
                <X size={14} /> Limpar
              </button>
              {hasStyled && (
                <button className="btn btn-teal btn-sm" onClick={saveAllToBank}>
                  <Save size={14} /> Salvar no Banco de Temas
                </button>
              )}
            </div>
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

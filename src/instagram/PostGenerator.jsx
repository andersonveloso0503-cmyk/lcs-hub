import { useState } from "react";
import { Sparkles, Send, Calendar, Copy, Image as ImageIcon } from "lucide-react";
import { generateCaption, scheduleToBuffer } from "./api";

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

  async function handleSendToBuffer() {
    if (!caption || !selectedPhoto) {
      setError("Gere a legenda e selecione uma foto do Banco de Temas antes de enviar.");
      return;
    }
    setSending(true);
    setError("");
    setSendResult(null);

    // A foto do Banco de Temas já é uma URL pública do Vercel Blob — não
    // precisa de upload novamente.
    const result = await scheduleToBuffer({
      text: caption,
      imageUrl: selectedPhoto.imageUrl,
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
        imageUrl: selectedPhoto.imageUrl,
        status: scheduledAt ? "agendado" : "publicado",
        scheduledAt: scheduledAt || null,
        bufferPostIds,
      });
    } else {
      setError("Erro ao agendar no Buffer: " + result.error);
    }
    setSending(false);
  }

  async function handleSaveDraft() {
    await onSavePost({
      service,
      caption,
      imageUrl: selectedPhoto?.imageUrl || null,
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
            <span>
              <ImageIcon size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
              Escolha uma foto do Banco de Temas
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
                  onClick={() => setSelectedPhotoId(p.id)}
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

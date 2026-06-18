import { useRef, useState } from "react";
import { Calendar, Trash2, ExternalLink, ImagePlus, Loader2 } from "lucide-react";
import { formatScheduledDate } from "./weekSchedule";
import { deleteFromBuffer, editImageOnBuffer, uploadImage } from "./api";

const STATUS_FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "rascunho", label: "Rascunho" },
  { value: "agendado", label: "Agendado" },
  { value: "publicado", label: "Publicado" },
];

const STATUS_LABELS = {
  rascunho: { label: "Rascunho", className: "status-rascunho" },
  agendado: { label: "Agendado", className: "status-agendado" },
  publicado: { label: "Publicado", className: "status-publicado" },
};

export default function PostsList({ posts, onDelete, onUpdate }) {
  const [filter, setFilter] = useState("todos");
  const [deletingId, setDeletingId] = useState(null);
  const [replacingId, setReplacingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const fileInputRef = useRef(null);
  const [targetPostForReplace, setTargetPostForReplace] = useState(null);

  const filtered = filter === "todos" ? posts : posts.filter((p) => p.status === filter);

  async function handleDelete(post) {
    setActionError("");
    setDeletingId(post.id);

    // Se o post tem posts correspondentes no Buffer (foi agendado/publicado
    // por lá), exclui eles também antes de remover nosso registro local.
    if (post.bufferPostIds?.length > 0) {
      const result = await deleteFromBuffer(post.bufferPostIds);
      if (!result.ok) {
        setActionError(
          `Não foi possível excluir no Buffer (${result.error}). O post permanece agendado lá — exclua manualmente no Buffer se necessário.`
        );
        setDeletingId(null);
        return;
      }
    }

    await onDelete(post.id);
    setDeletingId(null);
  }

  function handleReplaceImageClick(post) {
    setActionError("");
    setTargetPostForReplace(post);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    const post = targetPostForReplace;
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois
    if (!file || !post) return;

    setReplacingId(post.id);
    setActionError("");

    try {
      // 1. Lê o arquivo como data URL e envia para o Vercel Blob
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const upload = await uploadImage(dataUrl, `post-${post.id}-${Date.now()}.png`);
      if (!upload.ok) {
        setActionError(`Erro ao enviar a nova foto: ${upload.error}`);
        setReplacingId(null);
        return;
      }

      // 2. Se o post está no Buffer (agendado/publicado), troca a imagem lá também
      if (post.bufferPostIds?.length > 0) {
        const editResult = await editImageOnBuffer(post.bufferPostIds, upload.url, true);
        if (!editResult.ok) {
          setActionError(
            `A foto foi enviada, mas não foi possível atualizar no Buffer (${editResult.error}).`
          );
          setReplacingId(null);
          return;
        }
      }

      // 3. Atualiza nosso registro local com a nova URL
      await onUpdate(post.id, { imageUrl: upload.url });
    } catch (err) {
      setActionError(`Erro ao trocar a imagem: ${err.message}`);
    } finally {
      setReplacingId(null);
      setTargetPostForReplace(null);
    }
  }

  return (
    <div>
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />

      <div className="tabs crm-tabs" style={{ marginBottom: 16 }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            className={"tab" + (filter === f.value ? " active" : "")}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            {f.value !== "todos" && (
              <span className="chip-count">
                {posts.filter((p) => p.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="chat-error" style={{ marginBottom: 16 }}>
          {actionError}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="card">
          <div className="followup-empty">Nenhum post nessa categoria ainda.</div>
        </div>
      )}

      <div className="posts-list-grid">
        {filtered.map((post) => {
          const statusInfo = STATUS_LABELS[post.status] || STATUS_LABELS.rascunho;
          const isDeleting = deletingId === post.id;
          const isReplacing = replacingId === post.id;
          return (
            <div key={post.id} className="post-list-card">
              {post.imageUrl && (
                <img src={post.imageUrl} alt={post.service} className="post-list-thumb" />
              )}
              <div className="post-list-body">
                <div className="post-list-top">
                  <span className="kanban-tag">{post.service}</span>
                  <span className={"status-badge " + statusInfo.className}>
                    {statusInfo.label}
                  </span>
                </div>
                <p className="post-list-caption">{post.caption}</p>
                {post.scheduledAt && (
                  <div className="post-list-date">
                    <Calendar size={12} /> {formatScheduledDate(post.scheduledAt)}
                  </div>
                )}
                <div className="post-list-actions">
                  {post.imageUrl && (
                    <a
                      href={post.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline btn-sm"
                    >
                      <ExternalLink size={12} /> Ver foto
                    </a>
                  )}
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => handleReplaceImageClick(post)}
                    disabled={isReplacing || isDeleting}
                  >
                    {isReplacing ? (
                      <>
                        <Loader2 size={12} className="spin" /> Trocando...
                      </>
                    ) : (
                      <>
                        <ImagePlus size={12} /> Trocar foto
                      </>
                    )}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => handleDelete(post)}
                    disabled={isDeleting || isReplacing}
                  >
                    <Trash2 size={12} /> {isDeleting ? "Removendo..." : "Remover"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

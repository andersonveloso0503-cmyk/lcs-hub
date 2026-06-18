import { useState } from "react";
import { CheckCircle, Trash2, Send, Calendar, Edit3, X, Check } from "lucide-react";
import { scheduleToBuffer } from "./api";
import { formatScheduledDate } from "./weekSchedule";

/**
 * Painel de aprovação de posts gerados automaticamente.
 * Mostra todos os posts com status "aguardando_aprovacao", permite editar
 * legenda e data individualmente, excluir, e aprovar (agendando no Buffer).
 */
export default function ApprovalQueue({ posts, onUpdate, onDelete }) {
  const pending = posts
    .filter((p) => p.status === "aguardando_aprovacao")
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  const [editingId, setEditingId] = useState(null);
  const [editCaption, setEditCaption] = useState("");
  const [editDate, setEditDate] = useState("");
  const [approvingId, setApprovingId] = useState(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (pending.length === 0) return null;

  function startEdit(post) {
    setEditingId(post.id);
    setEditCaption(post.caption);
    // Converte ISO pra formato datetime-local (YYYY-MM-DDTHH:MM)
    const d = new Date(post.scheduledAt);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setEditDate(local);
  }

  async function saveEdit(post) {
    const newScheduledAt = new Date(editDate).toISOString();
    await onUpdate(post.id, {
      caption: editCaption,
      scheduledAt: newScheduledAt,
    });
    setEditingId(null);
  }

  async function handleApproveOne(post) {
    setError("");
    setApprovingId(post.id);
    try {
      const result = await scheduleToBuffer({
        text: post.caption,
        imageUrl: post.imageUrl,
        scheduledAt: post.scheduledAt,
      });

      if (!result.ok && !result.partial) {
        setError(`Erro ao agendar ${post.day}: ${result.error}`);
        setApprovingId(null);
        return;
      }

      const bufferPostIds = (result.results || [])
        .filter((r) => r.ok && r.post?.id)
        .map((r) => r.post.id);

      await onUpdate(post.id, {
        status: "agendado",
        bufferPostIds,
        approvedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(`Erro: ${err.message}`);
    }
    setApprovingId(null);
  }

  async function handleApproveAll() {
    setError("");
    setApprovingAll(true);
    setApprovedCount(0);
    setDone(false);
    const warnings = [];

    for (const post of pending) {
      try {
        const result = await scheduleToBuffer({
          text: post.caption,
          imageUrl: post.imageUrl,
          scheduledAt: post.scheduledAt,
        });

        if (!result.ok && !result.partial) {
          warnings.push(`${post.day}: ${result.error}`);
          continue;
        }

        const bufferPostIds = (result.results || [])
          .filter((r) => r.ok && r.post?.id)
          .map((r) => r.post.id);

        await onUpdate(post.id, {
          status: "agendado",
          bufferPostIds,
          approvedAt: new Date().toISOString(),
        });

        setApprovedCount((c) => c + 1);
      } catch (err) {
        warnings.push(`${post.day}: ${err.message}`);
      }
    }

    if (warnings.length > 0) setError(warnings.join(" · "));
    setApprovingAll(false);
    setDone(true);
  }

  return (
    <div className="card" style={{ marginBottom: 24, border: "2px solid var(--accent-pink)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          ⏳ {pending.length} post{pending.length > 1 ? "s" : ""} aguardando sua aprovação
        </div>
        {done && pending.length === 0 ? null : (
          <button
            className="btn btn-gads"
            style={{ fontSize: 13 }}
            onClick={handleApproveAll}
            disabled={approvingAll || !!approvingId}
          >
            <Send size={13} />
            {approvingAll
              ? `Agendando... (${approvedCount}/${pending.length})`
              : `Aprovar todos (${pending.length})`}
          </button>
        )}
      </div>

      {error && <div className="chat-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {pending.map((post) => (
          <div
            key={post.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
              background: "var(--bg-secondary)",
            }}
          >
            <div style={{ display: "flex", gap: 0 }}>
              {/* Miniatura da imagem */}
              <div style={{ width: 120, minHeight: 120, flexShrink: 0, background: "var(--border)" }}>
                {post.imageUrl && (
                  <img
                    src={post.imageUrl}
                    alt={post.service}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                )}
              </div>

              {/* Conteúdo */}
              <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="kanban-tag">{post.service}</span>
                  <span className={"week-card-format-badge " + (post.format || "post")}>
                    {post.format === "stories" ? "📱 Stories" : "🖼️ Post"}
                  </span>
                  <span className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                    <Calendar size={11} /> {formatScheduledDate(post.scheduledAt)}
                  </span>
                </div>

                {editingId === post.id ? (
                  // Modo de edição
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={editCaption}
                      onChange={(e) => setEditCaption(e.target.value)}
                      className="week-card-caption"
                      style={{ minHeight: 100 }}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Data/hora:</label>
                      <input
                        type="datetime-local"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: "var(--text)",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-ig"
                        style={{ fontSize: 12, padding: "5px 12px" }}
                        onClick={() => saveEdit(post)}
                      >
                        <Check size={12} /> Salvar
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: "5px 12px" }}
                        onClick={() => setEditingId(null)}
                      >
                        <X size={12} /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  // Modo de visualização
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5, whiteSpace: "pre-line" }}>
                    {post.caption?.slice(0, 200)}{post.caption?.length > 200 ? "..." : ""}
                  </p>
                )}
              </div>

              {/* Ações */}
              {editingId !== post.id && (
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "12px 10px",
                  borderLeft: "1px solid var(--border)",
                  justifyContent: "center",
                }}>
                  <button
                    className="btn btn-ig"
                    style={{ fontSize: 12, padding: "6px 10px", whiteSpace: "nowrap" }}
                    onClick={() => handleApproveOne(post)}
                    disabled={!!approvingId || approvingAll}
                    title="Aprovar e agendar no Buffer"
                  >
                    {approvingId === post.id ? (
                      "..."
                    ) : (
                      <><CheckCircle size={13} /> Aprovar</>
                    )}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                    onClick={() => startEdit(post)}
                    title="Editar legenda ou data"
                  >
                    <Edit3 size={13} /> Editar
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: "6px 10px", color: "var(--danger, #e53e3e)" }}
                    onClick={() => onDelete(post.id)}
                    title="Excluir este post"
                  >
                    <Trash2 size={13} /> Excluir
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

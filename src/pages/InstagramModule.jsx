import { useState } from "react";
import { Sparkles, Image as ImageIcon, Grid3x3, CalendarDays, List, Search } from "lucide-react";
import PostGenerator from "../instagram/PostGenerator";
import PhotoEditor from "../instagram/PhotoEditor";
import ThemeBank from "../instagram/ThemeBank";
import WeeklyPlanner from "../instagram/WeeklyPlanner";
import ApprovalQueue from "../instagram/ApprovalQueue";
import PostsList from "../instagram/PostsList";
import InstagramAnalysis from "../instagram/InstagramAnalysis";
import { usePosts } from "../instagram/usePosts";
import { useThemeBank } from "../instagram/useThemeBank";

export default function InstagramModule() {
  const [tab, setTab] = useState("week");
  const { posts, savePost, deletePost, updatePost } = usePosts();
  const { photos, loading: bankLoading, addPhoto, removePhoto } = useThemeBank();

  const pendingCount = posts.filter((p) => p.status === "aguardando_aprovacao").length;

  async function handleSaveToBank(data) {
    await addPhoto(data);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Instagram</h1>
          <p className="page-subtitle">
            @lcs_terceirizacao · Legendas com IA, fotos reais e agendamento via Buffer
          </p>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <button className="stat-card accent-pink clickable" onClick={() => setTab("posts")}>
          <div className="stat-icon"><Sparkles size={20} /></div>
          <div>
            <div className="stat-label">Posts criados</div>
            <div className="stat-value">{posts.length}</div>
          </div>
        </button>
        <button className="stat-card accent-blue clickable" onClick={() => setTab("bank")}>
          <div className="stat-icon"><ImageIcon size={20} /></div>
          <div>
            <div className="stat-label">Fotos no banco</div>
            <div className="stat-value">{photos.length}</div>
          </div>
        </button>
        <button className="stat-card accent-teal clickable" onClick={() => setTab("posts")}>
          <div className="stat-icon"><Grid3x3 size={20} /></div>
          <div>
            <div className="stat-label">Agendados</div>
            <div className="stat-value">
              {posts.filter((p) => p.status === "agendado").length}
            </div>
          </div>
        </button>
      </div>

      <div className="tabs crm-tabs">
        {[
          { id: "week", label: "Semana Automática", icon: CalendarDays },
          { id: "generate", label: "Gerar Post", icon: Sparkles },
          { id: "analysis", label: "Análise IA", icon: Search },
          { id: "editor", label: "Editor de Fotos", icon: ImageIcon },
          { id: "bank", label: "Banco de Temas", icon: Grid3x3 },
          { id: "posts", label: "Meus Posts", icon: List },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={"tab" + (tab === id ? " active" : "")}
            onClick={() => setTab(id)}
            style={{ position: "relative" }}
          >
            <Icon size={14} /> {label}
            {/* Badge de notificação: aparece quando há posts aguardando aprovação */}
            {id === "week" && pendingCount > 0 && (
              <span style={{
                position: "absolute",
                top: -4,
                right: -4,
                background: "var(--accent-pink, #e91e8c)",
                color: "#fff",
                borderRadius: "50%",
                fontSize: 10,
                fontWeight: 700,
                minWidth: 17,
                height: 17,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 4px",
                lineHeight: 1,
              }}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "week" && (
        <>
          {/* Fila de aprovação — aparece no topo se houver posts pendentes */}
          {pendingCount > 0 && (
            <ApprovalQueue
              posts={posts}
              onUpdate={updatePost}
              onDelete={deletePost}
            />
          )}
          <WeeklyPlanner themeBankPhotos={photos} onSavePost={savePost} />
        </>
      )}

      {tab === "generate" && (
        <PostGenerator themeBankPhotos={photos} onSavePost={savePost} />
      )}

      {tab === "analysis" && <InstagramAnalysis onSavePost={savePost} />}

      {tab === "editor" && <PhotoEditor onSaveToBank={handleSaveToBank} />}

      {tab === "bank" && (
        <ThemeBank photos={photos} loading={bankLoading} onRemove={removePhoto} />
      )}

      {tab === "posts" && <PostsList posts={posts} onDelete={deletePost} onUpdate={updatePost} />}
    </div>
  );
}

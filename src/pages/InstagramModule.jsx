import { useState } from "react";
import { Sparkles, Image as ImageIcon, Grid3x3, CalendarDays } from "lucide-react";
import PostGenerator from "../instagram/PostGenerator";
import PhotoEditor from "../instagram/PhotoEditor";
import ThemeBank from "../instagram/ThemeBank";
import WeeklyPlanner from "../instagram/WeeklyPlanner";
import { usePosts } from "../instagram/usePosts";
import { useThemeBank } from "../instagram/useThemeBank";

const TABS = [
  { id: "week", label: "Semana Automática", icon: CalendarDays },
  { id: "generate", label: "Gerar Post", icon: Sparkles },
  { id: "editor", label: "Editor de Fotos", icon: ImageIcon },
  { id: "bank", label: "Banco de Temas", icon: Grid3x3 },
];

export default function InstagramModule() {
  const [tab, setTab] = useState("week");
  const { posts, savePost } = usePosts();
  const { photos, loading: bankLoading, addPhoto, removePhoto } = useThemeBank();

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
        <div className="stat-card accent-pink">
          <div className="stat-icon"><Sparkles size={20} /></div>
          <div>
            <div className="stat-label">Posts criados</div>
            <div className="stat-value">{posts.length}</div>
          </div>
        </div>
        <div className="stat-card accent-blue">
          <div className="stat-icon"><ImageIcon size={20} /></div>
          <div>
            <div className="stat-label">Fotos no banco</div>
            <div className="stat-value">{photos.length}</div>
          </div>
        </div>
        <div className="stat-card accent-teal">
          <div className="stat-icon"><Grid3x3 size={20} /></div>
          <div>
            <div className="stat-label">Agendados</div>
            <div className="stat-value">
              {posts.filter((p) => p.status === "agendado").length}
            </div>
          </div>
        </div>
      </div>

      <div className="tabs crm-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={"tab" + (tab === id ? " active" : "")}
            onClick={() => setTab(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "week" && (
        <WeeklyPlanner themeBankPhotos={photos} onSavePost={savePost} />
      )}

      {tab === "generate" && (
        <PostGenerator themeBankPhotos={photos} onSavePost={savePost} />
      )}

      {tab === "editor" && <PhotoEditor onSaveToBank={handleSaveToBank} />}

      {tab === "bank" && (
        <ThemeBank photos={photos} loading={bankLoading} onRemove={removePhoto} />
      )}
    </div>
  );
}

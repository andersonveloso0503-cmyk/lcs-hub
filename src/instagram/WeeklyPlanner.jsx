import { useState } from "react";
import { Sparkles, Calendar, Send, RefreshCw, Image as ImageIcon } from "lucide-react";
import { generateWeek, uploadImage, scheduleToBuffer } from "./api";
import { attachScheduleDates, formatScheduledDate } from "./weekSchedule";

export default function WeeklyPlanner({ themeBankPhotos, onSavePost }) {
  const [posts, setPosts] = useState([]); // { day, service, caption, suggestedTime, scheduledAt, photoId }
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [sendingAll, setSendingAll] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [done, setDone] = useState(false);

  function pickPhotoForService(service, usedIds) {
    if (themeBankPhotos.length === 0) return null;
    const serviceWord = service.toLowerCase().split(" ")[0];
    const match = themeBankPhotos.find(
      (p) => p.service?.toLowerCase().includes(serviceWord) && !usedIds.has(p.id)
    );
    if (match) return match;
    // fallback: pega a próxima foto não usada ainda, ciclicamente
    const unused = themeBankPhotos.find((p) => !usedIds.has(p.id));
    return unused || themeBankPhotos[0];
  }

  async function handleGenerateWeek() {
    setGenerating(true);
    setError("");
    setDone(false);

    const result = await generateWeek();
    if (!result.ok) {
      setError(result.error);
      setGenerating(false);
      return;
    }

    const withDates = attachScheduleDates(result.posts);
    const usedIds = new Set();
    const withPhotos = withDates.map((p) => {
      const photo = pickPhotoForService(p.service, usedIds);
      if (photo) usedIds.add(photo.id);
      return { ...p, photoId: photo?.id || null, photoUrl: photo?.imageDataUrl || null };
    });

    setPosts(withPhotos);
    setGenerating(false);
  }

  function updatePost(index, field, value) {
    setPosts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }

  function changePhoto(index) {
    const post = posts[index];
    const candidates = themeBankPhotos.filter((p) => p.id !== post.photoId);
    if (candidates.length === 0) return;
    const currentIdx = themeBankPhotos.findIndex((p) => p.id === post.photoId);
    const nextIdx = (currentIdx + 1) % themeBankPhotos.length;
    const next = themeBankPhotos[nextIdx] === post.photoId ? candidates[0] : themeBankPhotos[nextIdx];
    updatePost(index, "photoId", next.id);
    updatePost(index, "photoUrl", next.imageDataUrl);
  }

  async function handleApproveAndScheduleAll() {
    setSendingAll(true);
    setSentCount(0);
    setError("");

    for (const post of posts) {
      if (!post.photoUrl) continue;

      const upload = await uploadImage(post.photoUrl, `week-post-${Date.now()}.png`);
      if (!upload.ok) {
        setError(`Erro no upload da foto de ${post.day}: ${upload.error}`);
        continue;
      }

      const result = await scheduleToBuffer({
        text: post.caption,
        imageUrl: upload.url,
        scheduledAt: post.scheduledAt,
      });

      if (result.ok) {
        await onSavePost({
          service: post.service,
          caption: post.caption,
          imageUrl: upload.url,
          status: "agendado",
          scheduledAt: post.scheduledAt,
        });
        setSentCount((c) => c + 1);
      } else {
        setError(`Erro ao agendar ${post.day}: ${result.error}`);
      }
    }

    setSendingAll(false);
    setDone(true);
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">📅 Planejamento Semanal — 7 posts de uma vez</div>
        <p className="muted" style={{ marginBottom: 16 }}>
          A IA gera 7 legendas variadas (uma por dia, serviços diferentes), escolhe fotos do
          Banco de Temas e sugere horários. Revise, ajuste o que quiser, e agende tudo no Buffer
          com um clique.
        </p>

        {themeBankPhotos.length === 0 && (
          <div className="chat-error" style={{ marginBottom: 16 }}>
            Você ainda não tem fotos no Banco de Temas. Vá no Editor de Fotos e processe algumas
            fotos antes de gerar a semana.
          </div>
        )}

        <button
          className="btn btn-ig"
          onClick={handleGenerateWeek}
          disabled={generating || themeBankPhotos.length === 0}
        >
          {generating ? (
            <>
              <RefreshCw size={15} className="spin" /> Gerando a semana...
            </>
          ) : (
            <>
              <Sparkles size={15} /> {posts.length > 0 ? "Gerar nova semana" : "Gerar semana com IA"}
            </>
          )}
        </button>

        {error && <div className="chat-error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {posts.length > 0 && (
        <div className="week-grid">
          {posts.map((post, i) => (
            <div key={i} className="week-card">
              <div className="week-card-header">
                <span className="week-card-day">{post.day}</span>
                <span className="week-card-time">
                  <Calendar size={12} /> {formatScheduledDate(post.scheduledAt)}
                </span>
              </div>

              <div className="week-card-photo">
                {post.photoUrl ? (
                  <img src={post.photoUrl} alt={post.service} />
                ) : (
                  <div className="week-card-no-photo">
                    <ImageIcon size={20} />
                  </div>
                )}
                {themeBankPhotos.length > 1 && (
                  <button
                    className="week-card-change-photo"
                    onClick={() => changePhoto(i)}
                    title="Trocar foto"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
              </div>

              <span className="kanban-tag">{post.service}</span>

              <textarea
                value={post.caption}
                onChange={(e) => updatePost(i, "caption", e.target.value)}
                className="week-card-caption"
              />
            </div>
          ))}
        </div>
      )}

      {posts.length > 0 && (
        <div className="card">
          {done ? (
            <div className="followup-empty">
              ✅ {sentCount} de {posts.length} posts agendados com sucesso no Buffer!
            </div>
          ) : (
            <div className="btn-row">
              <button
                className="btn btn-gads"
                onClick={handleApproveAndScheduleAll}
                disabled={sendingAll}
              >
                <Send size={15} />
                {sendingAll
                  ? `Agendando... (${sentCount}/${posts.length})`
                  : `Aprovar e agendar os ${posts.length} posts no Buffer`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { Sparkles, Calendar, Send, RefreshCw, Image as ImageIcon, Layers, Bot } from "lucide-react";
import { generateWeek, generateCreativeAI, uploadImage, scheduleToBuffer } from "./api";
import { attachScheduleDates, formatScheduledDate } from "./weekSchedule";
import { adaptToStoriesFormat } from "./photoStyle";

// Serviços disponíveis pra geração de criativo via IA — mesma lista usada
// no generate-creative-ai.js (mapeados por cena lá dentro).
const SERVICE_TO_AI_KEY = {
  "Limpeza e Conservação": "Limpeza",
  "Portaria e Recepção": "Portaria",
  "Zeladoria": "Facilities",
  "Condomínios e Síndicos": "Condomínios",
  "Empresas / Escritórios": "Empresas",
  "Apresentação Geral LCS": "Limpeza",
};

export default function WeeklyPlanner({ themeBankPhotos, onSavePost }) {
  const [posts, setPosts] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [imageSource, setImageSource] = useState("temas"); // "temas" | "ia"
  const [aiProgress, setAiProgress] = useState(null); // null | { current, total }
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
    const unused = themeBankPhotos.find((p) => !usedIds.has(p.id));
    return unused || themeBankPhotos[0];
  }

  async function handleGenerateWeek() {
    if (imageSource === "temas" && themeBankPhotos.length === 0) return;

    setGenerating(true);
    setError("");
    setDone(false);
    setAiProgress(null);

    // 1. Gera as 7 legendas via Claude
    const result = await generateWeek();
    if (!result.ok) {
      setError(result.error);
      setGenerating(false);
      return;
    }

    const withDates = attachScheduleDates(result.posts);

    // 2. Para cada post, pega ou gera a imagem conforme o modo escolhido
    const postsBuilt = [];
    for (let i = 0; i < withDates.length; i++) {
      const p = withDates[i];

      if (imageSource === "ia") {
        setAiProgress({ current: i + 1, total: withDates.length });
        const aiKey = SERVICE_TO_AI_KEY[p.service] || "Limpeza";
        const headline = p.service.split(" ")[0]; // ex: "Limpeza", "Portaria"
        const creative = await generateCreativeAI({ service: aiKey, headline, format: p.format });
        if (!creative.ok) {
          setError(`Erro ao gerar criativo de ${p.day}: ${creative.error}`);
          setGenerating(false);
          setAiProgress(null);
          return;
        }

        // Carrossel (2 imagens) pra posts de feed — Stories fica só com 1,
        // já que não dá pra ter swipe de várias imagens numa story só.
        const images = [creative.imageBase64];
        if (p.format !== "stories") {
          const detailTaglines = ["Qualidade Garantida", "Equipe Treinada", "Confiança e Profissionalismo", "Atendimento Personalizado"];
          const detailHeadline = detailTaglines[Math.floor(Math.random() * detailTaglines.length)];
          const creative2 = await generateCreativeAI({
            service: aiKey,
            headline: detailHeadline,
            format: p.format,
          });
          if (creative2.ok) images.push(creative2.imageBase64);
        }

        postsBuilt.push({
          ...p,
          photoId: null,
          photoUrl: images[0], // capa, usada na pré-visualização
          photoUrls: images, // array completo, usado na hora de agendar
          isBase64: true,
          isAdapted: false,
        });
      } else {
        // Banco de Temas
        const usedIds = new Set(postsBuilt.map((x) => x.photoId).filter(Boolean));
        const photo = pickPhotoForService(p.service, usedIds);
        let photoUrl = photo?.imageUrl || null;
        let isAdapted = false;
        if (photoUrl && p.format === "stories") {
          photoUrl = await adaptToStoriesFormat(photoUrl, photo?.theme || "azul");
          isAdapted = true;
        }
        postsBuilt.push({
          ...p,
          photoId: photo?.id || null,
          photoUrl,
          isBase64: isAdapted, // stories adaptados viram base64 local
          isAdapted,
        });
      }
    }

    setPosts(postsBuilt);
    setGenerating(false);
    setAiProgress(null);
  }

  function updatePost(index, field, value) {
    setPosts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }

  function changePhoto(index) {
    if (imageSource === "ia") return; // não faz sentido trocar foto gerada por IA aqui
    const post = posts[index];
    const currentIdx = themeBankPhotos.findIndex((p) => p.id === post.photoId);
    const nextIdx = (currentIdx + 1) % themeBankPhotos.length;
    const next = themeBankPhotos[nextIdx];
    updatePost(index, "photoId", next.id);
    updatePost(index, "photoUrl", next.imageUrl);
    updatePost(index, "isBase64", false);
    updatePost(index, "isAdapted", false);
  }

  async function handleApproveAndScheduleAll() {
    setSendingAll(true);
    setSentCount(0);
    setError("");
    const warnings = [];

    for (const post of posts) {
      if (!post.photoUrl) continue;

      // Se a imagem é base64 (criativo IA ou stories adaptado), precisa subir
      // pro Vercel Blob antes de enviar ao Buffer (que exige URL pública).
      // Quando tem mais de uma imagem (carrossel), sobe todas.
      const sourceUrls = post.photoUrls && post.photoUrls.length > 0 ? post.photoUrls : [post.photoUrl];
      let finalImageUrls = sourceUrls;

      if (post.isBase64) {
        finalImageUrls = [];
        let uploadFailed = false;
        for (let idx = 0; idx < sourceUrls.length; idx++) {
          const upload = await uploadImage(sourceUrls[idx], `week-post-${Date.now()}-${idx}.png`);
          if (!upload.ok) {
            setError(`Erro no upload da foto de ${post.day}: ${upload.error}`);
            uploadFailed = true;
            break;
          }
          finalImageUrls.push(upload.url);
        }
        if (uploadFailed) continue;
      }

      const result = await scheduleToBuffer({
        text: post.caption,
        imageUrls: finalImageUrls,
        scheduledAt: post.scheduledAt,
        channels: ["instagram", "facebook"],
      });

      if (result.ok || result.partial) {
        const bufferPostIds = (result.results || [])
          .filter((r) => r.ok && r.post?.id)
          .map((r) => r.post.id);
        await onSavePost({
          service: post.service,
          caption: post.caption,
          imageUrl: finalImageUrls[0],
          imageUrls: finalImageUrls,
          status: "agendado",
          scheduledAt: post.scheduledAt,
          bufferPostIds,
          imageSource,
        });
        setSentCount((c) => c + 1);

        if (result.partial) {
          const failed = result.results?.filter((r) => !r.ok).map((r) => r.channel).join(", ");
          warnings.push(`${post.day}: publicado parcialmente (falhou em: ${failed})`);
        }
      } else {
        setError(`Erro ao agendar ${post.day}: ${result.error}`);
      }
    }

    if (warnings.length > 0) setError(warnings.join(" · "));
    setSendingAll(false);
    setDone(true);
  }

  const canGenerate =
    !generating &&
    (imageSource === "ia" || themeBankPhotos.length > 0);

  return (
    <div>
      <div className="card">
        <div className="card-title">📅 Planejamento Semanal — 7 posts de uma vez</div>
        <p className="muted" style={{ marginBottom: 16 }}>
          A IA gera 7 legendas variadas (uma por dia, alternando Limpeza, Portaria e Zeladoria),
          com criativo e horário sugerido. Revise, ajuste o que quiser, e agende tudo no Buffer
          com um clique.
        </p>

        {/* Seletor de fonte de imagem */}
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <button
            className={"btn " + (imageSource === "temas" ? "btn-ig" : "btn-secondary")}
            onClick={() => setImageSource("temas")}
            style={{ flex: 1 }}
          >
            <Layers size={14} /> Banco de Temas
          </button>
          <button
            className={"btn " + (imageSource === "ia" ? "btn-ig" : "btn-secondary")}
            onClick={() => setImageSource("ia")}
            style={{ flex: 1 }}
          >
            <Bot size={14} /> IA gera o criativo
          </button>
        </div>

        {imageSource === "temas" && themeBankPhotos.length === 0 && (
          <div className="chat-error" style={{ marginBottom: 16 }}>
            Você ainda não tem fotos no Banco de Temas. Vá no Editor de Fotos e processe algumas
            fotos antes de gerar a semana, ou escolha "IA gera o criativo" acima.
          </div>
        )}

        {imageSource === "ia" && (
          <div className="muted" style={{ marginBottom: 16, fontSize: 12 }}>
            💡 A IA gera 7 imagens (~$0.03–0.05 cada). Revise os criativos antes de agendar —
            a IA pode errar textos dentro da imagem.
          </div>
        )}

        <button
          className="btn btn-ig"
          onClick={handleGenerateWeek}
          disabled={!canGenerate}
        >
          {generating ? (
            <>
              <RefreshCw size={15} className="spin" />
              {aiProgress
                ? `Gerando criativo ${aiProgress.current}/${aiProgress.total}...`
                : "Gerando legendas..."}
            </>
          ) : (
            <>
              <Sparkles size={15} />
              {posts.length > 0 ? "Gerar nova semana" : "Gerar semana com IA"}
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
                <span className={"week-card-format-badge " + post.format}>
                  {post.format === "stories" ? "📱 Stories" : "🖼️ Post"}
                </span>
                <span className="week-card-time">
                  <Calendar size={12} /> {formatScheduledDate(post.scheduledAt)}
                </span>
              </div>

              <div className={"week-card-photo" + (post.format === "stories" ? " stories-ratio" : "")}>
                {post.photoUrl ? (
                  <img src={post.photoUrl} alt={post.service} />
                ) : (
                  <div className="week-card-no-photo">
                    <ImageIcon size={20} />
                  </div>
                )}
                {post.photoUrls && post.photoUrls.length > 1 && (
                  <span style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    background: "rgba(0,0,0,0.65)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: 5,
                  }}>
                    📷 {post.photoUrls.length} · carrossel
                  </span>
                )}
                {imageSource === "temas" && themeBankPhotos.length > 1 && (
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

import { useState, useRef } from "react";
import { Video, Sparkles, Check, AlertTriangle, X } from "lucide-react";

const THEME_OPTIONS = [
  "Por que terceirizar a limpeza do seu condomínio",
  "3 sinais de que sua portaria precisa de reforço",
  "Como a manutenção preventiva evita gastos maiores",
  "O que diferencia uma equipe de limpeza profissional",
];

/**
 * Orquestra a geração completa de um Reel em etapas curtas, chamadas uma
 * por vez pelo frontend (cada chamada de API individual roda em poucos
 * segundos — necessário porque o Vercel Hobby mata funções serverless
 * depois de ~10s, e o processo completo levaria minutos numa chamada só).
 *
 * Fluxo: roteiro → imagem por imagem → vídeo no Shotstack (com polling) →
 * container no Instagram → polling + publicação.
 */
export default function ReelCreator({ campaigns }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(THEME_OPTIONS[0]);
  // idle | script | images | rendering | preview | publishing | done | error
  // "preview" é o novo estado: vídeo já renderizado, aguardando aprovação
  // manual antes de enviar para o Instagram — sem isso, o Reel ia direto
  // ao ar mesmo com problemas visuais (como o texto ilegível identificado
  // antes), sem chance de revisão.
  const [phase, setPhase] = useState("idle");
  const [progressText, setProgressText] = useState("");
  const [script, setScript] = useState(null);
  const [slideImageUrls, setSlideImageUrls] = useState([]);
  const [videoUrl, setVideoUrl] = useState(null);
  const [publishedMediaId, setPublishedMediaId] = useState(null);
  const [error, setError] = useState(null);
  const cancelledRef = useRef(false);

  async function callApi(body) {
    const res = await fetch("/api/generate-creative-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro na chamada à API");
    return data;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Etapas 1-3: roteiro, imagens, e renderização do vídeo. Termina em
   * "preview", SEM publicar nada ainda — o usuário revisa o resultado e
   * decide manualmente se aprova (handlePublish) ou descarta (handleReset).
   */
  async function handleStart() {
    cancelledRef.current = false;
    setError(null);
    setSlideImageUrls([]);
    setVideoUrl(null);
    setPublishedMediaId(null);

    try {
      // Etapa 1 — roteiro
      setPhase("script");
      setProgressText("Criando roteiro do Reel...");
      const scriptResult = await callApi({ action: "generate_reel_script", theme });
      if (cancelledRef.current) return;
      setScript(scriptResult);

      // Etapa 2 — uma imagem por slide, em sequência (não em paralelo, para
      // não disparar várias chamadas caras de geração de imagem ao mesmo
      // tempo e facilitar mostrar progresso claro ao usuário)
      setPhase("images");
      const urls = [];
      for (let i = 0; i < scriptResult.slides.length; i++) {
        if (cancelledRef.current) return;
        setProgressText(`Gerando imagem ${i + 1} de ${scriptResult.slides.length}...`);
        const imgResult = await callApi({
          action: "generate_reel_slide_image",
          scene_description: scriptResult.slides[i].scene_description,
        });
        urls.push(imgResult.url);
        setSlideImageUrls([...urls]);
      }

      // Etapa 3 — envia para renderizar no Shotstack
      setPhase("rendering");
      setProgressText("Montando o vídeo...");
      const slideTexts = scriptResult.slides.map((s) => s.text);
      const buildResult = await callApi({
        action: "build_reel_video",
        slide_image_urls: urls,
        slide_texts: slideTexts,
      });
      const renderId = buildResult.render_id;

      // Polling do status do render — intervalo de 4s, até ~3 minutos
      let videoReady = null;
      for (let attempt = 0; attempt < 45; attempt++) {
        if (cancelledRef.current) return;
        await sleep(4000);
        setProgressText(`Renderizando vídeo... (${attempt + 1}/45)`);
        const statusResult = await callApi({ action: "check_reel_video_status", render_id: renderId });
        if (statusResult.ready) {
          videoReady = statusResult.video_url;
          break;
        }
      }
      if (!videoReady) throw new Error("Tempo limite excedido renderizando o vídeo. Tente novamente.");
      setVideoUrl(videoReady);
      setPhase("preview"); // para aqui — espera aprovação manual antes de publicar
    } catch (err) {
      setError(err.message);
      setPhase("error");
    }
  }

  /**
   * Etapas 4-5: só rodam quando o usuário aprova explicitamente o vídeo
   * já renderizado na prévia. videoUrl e script já estão no state desde
   * handleStart — não precisa gerar nada de novo aqui.
   */
  async function handlePublish() {
    cancelledRef.current = false;
    setError(null);
    try {
      setPhase("publishing");
      setProgressText("Enviando para o Instagram...");
      const containerResult = await callApi({
        action: "create_reel_container",
        video_url: videoUrl,
        caption: script.caption,
      });

      let published = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (cancelledRef.current) return;
        await sleep(5000);
        setProgressText(`Processando no Instagram... (${attempt + 1}/60)`);
        const publishResult = await callApi({
          action: "check_and_publish_reel",
          container_id: containerResult.container_id,
          ig_account_id: containerResult.ig_account_id,
        });
        if (publishResult.published) {
          setPublishedMediaId(publishResult.mediaId);
          published = true;
          break;
        }
      }
      if (!published) throw new Error("Tempo limite excedido esperando o Instagram processar o Reel.");

      setPhase("done");
    } catch (err) {
      setError(err.message);
      setPhase("error");
    }
  }

  function handleCancel() {
    cancelledRef.current = true;
    setPhase("idle");
    setProgressText("");
  }

  function handleReset() {
    setPhase("idle");
    setScript(null);
    setSlideImageUrls([]);
    setVideoUrl(null);
    setPublishedMediaId(null);
    setError(null);
  }

  const isRunning = phase === "script" || phase === "images" || phase === "rendering" || phase === "publishing";

  if (!open) {
    return (
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>
            <Video size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Criar Reel com IA
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Gera um vídeo curto (4 slides com texto e movimento) e publica automaticamente
          </p>
        </div>
        <button className="btn btn-teal btn-sm" onClick={() => setOpen(true)}>
          Criar Reel
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Video size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Criar Reel com IA
        </span>
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
          <X size={14} />
        </button>
      </div>

      {error && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6", marginTop: 10 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
          <span>{error}</span>
        </div>
      )}

      {phase === "idle" && (
        <>
          <div style={{ marginTop: 14, marginBottom: 16 }}>
            <label className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
              Tema do Reel
            </label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--gray-light)" }}
            >
              {THEME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            ⚠️ A geração leva 1-3 minutos (imagens + renderização do vídeo). Depois disso, você
            revisa o resultado antes de decidir se publica.
          </p>
          <button className="btn btn-teal" onClick={handleStart}>
            <Sparkles size={14} style={{ marginRight: 6 }} /> Gerar Reel para Revisão
          </button>
        </>
      )}

      {isRunning && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div className="spin" style={{ width: 16, height: 16, border: "2px solid var(--gray-light)", borderTopColor: "var(--teal)", borderRadius: "50%" }} />
            <span style={{ fontSize: 14 }}>{progressText}</span>
          </div>

          {slideImageUrls.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {slideImageUrls.map((url, i) => (
                <img key={i} src={url} alt={`Slide ${i + 1}`} style={{ width: 70, height: 124, objectFit: "cover", borderRadius: 8 }} />
              ))}
            </div>
          )}

          <button className="btn btn-outline btn-sm" onClick={handleCancel}>
            Cancelar
          </button>
        </div>
      )}

      {phase === "preview" && (
        <div style={{ marginTop: 14 }}>
          <div className="pending-metrics-note" style={{ borderColor: "var(--blue)", background: "#EEF2FF", marginBottom: 14 }}>
            <span>👀 Revise o vídeo abaixo antes de publicar. Texto ilegível, imagem estranha ou erro no roteiro? Descarte e gere outro.</span>
          </div>
          {videoUrl && (
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              muted
              style={{ width: "100%", maxWidth: 280, borderRadius: 12, display: "block", margin: "0 auto 14px", background: "#000" }}
            />
          )}
          {script?.caption && (
            <div style={{ padding: 10, borderRadius: 8, background: "var(--bg)", marginBottom: 14, fontSize: 13 }}>
              <strong style={{ fontSize: 12, color: "var(--gray)" }}>LEGENDA:</strong>
              <p style={{ margin: "4px 0 0" }}>{script.caption}</p>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-teal" onClick={handlePublish}>
              <Check size={14} style={{ marginRight: 6 }} /> Aprovar e Publicar
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleReset}>
              Descartar e gerar outro
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div style={{ marginTop: 14 }}>
          <div className="pending-metrics-note" style={{ borderColor: "var(--teal)", background: "#ECFEFF", marginBottom: 14 }}>
            <Check size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} />
            <span>Reel publicado com sucesso no Instagram!</span>
          </div>
          {videoUrl && (
            <video src={videoUrl} controls style={{ width: "100%", maxWidth: 280, borderRadius: 12, display: "block", margin: "0 auto 14px" }} />
          )}
          <button className="btn btn-outline btn-sm" onClick={handleReset}>
            Criar outro Reel
          </button>
        </div>
      )}

      {phase === "error" && (
        <button className="btn btn-outline btn-sm" onClick={handleReset} style={{ marginTop: 10 }}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

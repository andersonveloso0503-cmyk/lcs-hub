import { useState, useRef } from "react";
import { Sparkles, RefreshCw, Check, AlertTriangle, X, Images } from "lucide-react";

/**
 * Cria carrosséis automáticos de 3 slides — a IA escolhe o tema,
 * gera o texto e as imagens de cada slide, você revisa na prévia
 * e decide se publica ou descarta. Fluxo idêntico ao ReelCreator
 * (etapas curtas pro Vercel Hobby não timeout).
 */
export default function CarouselCreator() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | script | images | preview | publishing | done | error
  const [progressText, setProgressText] = useState("");
  const [script, setScript] = useState(null);
  const [slideImageUrls, setSlideImageUrls] = useState([]);
  const [childrenIds, setChildrenIds] = useState([]);
  const [igAccountId, setIgAccountId] = useState(null);
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

  async function handleGenerate() {
    cancelledRef.current = false;
    setError(null);
    setSlideImageUrls([]);
    setChildrenIds([]);
    setPublishedMediaId(null);

    try {
      // Etapa 1 — roteiro
      setPhase("script");
      setProgressText("IA criando tema e roteiro dos 3 slides...");
      const scriptResult = await callApi({ action: "generate_carousel_script" });
      if (cancelledRef.current) return;
      setScript(scriptResult);

      // Etapa 2 — imagens (uma por slide)
      setPhase("images");
      const urls = [];
      for (let i = 0; i < scriptResult.slides.length; i++) {
        if (cancelledRef.current) return;
        setProgressText(`Gerando imagem ${i + 1} de ${scriptResult.slides.length}...`);
        const slide = scriptResult.slides[i];
        const result = await callApi({
          action: "generate_carousel_slide_image",
          scene_description: slide.scene_description,
          headline: slide.headline,
          subtext: slide.subtext || "",
        });
        urls.push(result.url);
        setSlideImageUrls([...urls]);
      }

      setPhase("preview");
    } catch (err) {
      setError(err.message);
      setPhase("error");
    }
  }

  async function handlePublish() {
    if (!script || slideImageUrls.length < 2) return;
    cancelledRef.current = false;
    setError(null);

    try {
      // Etapa 3 — containers filhos (um por imagem)
      setPhase("publishing");
      setProgressText("Enviando imagens para o Instagram...");
      const ids = [];
      let igId = igAccountId;
      for (let i = 0; i < slideImageUrls.length; i++) {
        if (cancelledRef.current) return;
        setProgressText(`Preparando slide ${i + 1} de ${slideImageUrls.length}...`);
        const result = await callApi({
          action: "create_carousel_item_container",
          image_url: slideImageUrls[i],
        });
        ids.push(result.container_id);
        if (!igId) igId = result.ig_account_id;
      }
      setChildrenIds(ids);
      setIgAccountId(igId);

      // Etapa 4 — container pai
      setProgressText("Montando o carrossel...");
      const carouselResult = await callApi({
        action: "create_carousel_container",
        children_ids: ids,
        caption: script.caption,
        ig_account_id: igId,
      });
      const containerId = carouselResult.container_id;

      // Etapa 5 — polling até publicar
      for (let attempt = 0; attempt < 30; attempt++) {
        if (cancelledRef.current) return;
        await sleep(5000);
        setProgressText(`Publicando no Instagram... (${attempt + 1}/30)`);
        const pubResult = await callApi({
          action: "check_and_publish_carousel",
          container_id: containerId,
          ig_account_id: igId,
        });
        if (pubResult.published) {
          setPublishedMediaId(pubResult.mediaId);
          setPhase("done");
          return;
        }
      }
      throw new Error("Tempo limite excedido publicando o carrossel.");
    } catch (err) {
      setError(err.message);
      setPhase("error");
    }
  }

  function handleReset() {
    setPhase("idle");
    setScript(null);
    setSlideImageUrls([]);
    setChildrenIds([]);
    setPublishedMediaId(null);
    setError(null);
  }

  const isRunning = phase === "script" || phase === "images" || phase === "publishing";

  if (!open) {
    return (
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>
            <Images size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Carrossel com IA
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            IA escolhe o tema, gera texto e imagens de 3 slides — você revisa e publica
          </p>
        </div>
        <button className="btn btn-teal btn-sm" onClick={() => setOpen(true)}>
          Criar Carrossel
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Images size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Carrossel com IA
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
          <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 14 }}>
            A IA escolhe automaticamente um tema relevante pra LCS (portaria, limpeza, facilities),
            gera o texto de cada slide e cria as imagens. Você revisa na prévia antes de publicar.
          </p>
          <button className="btn btn-teal" onClick={handleGenerate}>
            <Sparkles size={14} style={{ marginRight: 6 }} /> Gerar Carrossel
          </button>
        </>
      )}

      {isRunning && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <RefreshCw size={16} className="spin" style={{ color: "var(--teal)" }} />
            <span style={{ fontSize: 14 }}>{progressText}</span>
          </div>
          {slideImageUrls.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {slideImageUrls.map((url, i) => (
                <img key={i} src={url} alt={`Slide ${i + 1}`}
                  style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "2px solid var(--teal)" }} />
              ))}
            </div>
          )}
          <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => { cancelledRef.current = true; setPhase("idle"); }}>
            Cancelar
          </button>
        </div>
      )}

      {phase === "preview" && script && (
        <div style={{ marginTop: 14 }}>
          <div className="pending-metrics-note" style={{ borderColor: "var(--blue)", background: "#EEF2FF", marginBottom: 14 }}>
            <span>👀 Revise o carrossel antes de publicar</span>
          </div>

          {script.theme && (
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Tema: {script.theme}</p>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {slideImageUrls.map((url, i) => (
              <div key={i} style={{ flex: "1 1 90px", maxWidth: 120 }}>
                <img src={url} alt={`Slide ${i + 1}`}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
                <p style={{ fontSize: 11, fontWeight: 700, marginTop: 4, marginBottom: 1 }}>
                  {script.slides[i]?.headline}
                </p>
                <p className="muted" style={{ fontSize: 10 }}>{script.slides[i]?.subtext}</p>
              </div>
            ))}
          </div>

          {script.caption && (
            <div style={{ padding: 10, borderRadius: 8, background: "var(--bg)", marginBottom: 14, fontSize: 12 }}>
              <strong style={{ fontSize: 11, color: "var(--gray)" }}>LEGENDA:</strong>
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
            <Check size={16} style={{ flexShrink: 0, color: "var(--teal)" }} />
            <span>Carrossel publicado com sucesso no Instagram! 🎉</span>
          </div>
          <button className="btn btn-outline btn-sm" onClick={handleReset}>
            Criar outro carrossel
          </button>
        </div>
      )}

      {phase === "error" && (
        <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={handleReset}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

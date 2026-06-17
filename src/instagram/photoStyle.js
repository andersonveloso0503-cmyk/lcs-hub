// Aplica estilo visual da marca LCS a uma foto real, usando Canvas.
// Desenha apenas uma faixa no topo (logo + nome) e uma faixa no rodapé (contato),
// sem nenhum texto sobreposto no centro da imagem — lição aprendida do app anterior,
// que tinha problema de textos se sobrepondo na foto.

export const STYLE_THEMES = {
  vermelho: { name: "LCS Vermelho", bg: "#C0392B", text: "#FFFFFF" },
  azul: { name: "LCS Azul", bg: "#1A56DB", text: "#FFFFFF" },
  dark: { name: "LCS Dark", bg: "#0D1B2A", text: "#FFFFFF" },
  roxo: { name: "LCS Roxo", bg: "#6D28D9", text: "#FFFFFF" },
  verde: { name: "LCS Verde", bg: "#0EA5A0", text: "#FFFFFF" },
  minimal: { name: "Minimalista", bg: "#FFFFFF", text: "#0D1B2A" },
};

export const FORMAT_SIZES = {
  post: { w: 1080, h: 1080 },
  stories: { w: 1080, h: 1920 },
  reels: { w: 1080, h: 1920 },
};

/**
 * Carrega um arquivo de imagem (File) como HTMLImageElement.
 */
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Desenha a foto cortada (cover) dentro do canvas, preenchendo todo o espaço.
 */
function drawCoverImage(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let drawW, drawH, offsetX, offsetY;

  if (imgRatio > boxRatio) {
    drawH = h;
    drawW = h * imgRatio;
    offsetX = x - (drawW - w) / 2;
    offsetY = y;
  } else {
    drawW = w;
    drawH = w / imgRatio;
    offsetX = x;
    offsetY = y - (drawH - h) / 2;
  }

  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
}

/**
 * Aplica o estilo visual LCS a uma imagem e retorna um data URL (PNG).
 *
 * @param {HTMLImageElement} img - imagem já carregada
 * @param {string} themeKey - chave de STYLE_THEMES
 * @param {string} format - chave de FORMAT_SIZES
 * @param {number} opacity - opacidade do overlay das faixas (0 a 1)
 * @param {string} contactLine - texto da faixa de rodapé (ex: telefone)
 */
export function applyStyle(img, themeKey, format, opacity = 0.85, contactLine = "(51) 99889-3033") {
  const theme = STYLE_THEMES[themeKey] || STYLE_THEMES.azul;
  const size = FORMAT_SIZES[format] || FORMAT_SIZES.post;

  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");

  // Foto de fundo, cobrindo todo o canvas
  drawCoverImage(ctx, img, 0, 0, size.w, size.h);

  const barHeight = size.h * 0.082;

  // Faixa superior (logo + nome da empresa)
  ctx.globalAlpha = opacity;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, size.w, barHeight);

  // Faixa inferior (contato)
  ctx.fillRect(0, size.h - barHeight, size.w, barHeight);
  ctx.globalAlpha = 1;

  // Texto da faixa superior
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${barHeight * 0.38}px Arial`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("LCS Terceirização", size.w * 0.04, barHeight / 2);

  // Texto da faixa inferior
  ctx.font = `500 ${barHeight * 0.32}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText(contactLine, size.w / 2, size.h - barHeight / 2);

  return canvas.toDataURL("image/png");
}

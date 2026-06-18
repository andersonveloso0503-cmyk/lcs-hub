// Motor de design dos criativos do Instagram, usando Canvas.
// Reescrito para um visual mais elaborado: gradiente de marca, logo real,
// ícone do serviço desenhado vetorialmente, e tipografia em camadas —
// substituindo a faixa sólida simples da versão anterior.

import lcsLogoUrl from "../assets/lcs-logo.png";

// Paleta extraída diretamente da logo oficial da LCS Terceirização.
export const BRAND_COLORS = {
  azulRoyal: "#2A04A9",
  dourado: "#FAD72D",
  bordo: "#4A0508",
  preto: "#0A0A0A",
  branco: "#FFFFFF",
};

// Temas de cor para o criativo — cada um usa um gradiente de duas cores da marca.
export const STYLE_THEMES = {
  azul: { name: "Azul Royal", from: "#2A04A9", to: "#1A0570", accent: "#FAD72D" },
  bordo: { name: "Bordô LCS", from: "#4A0508", to: "#240204", accent: "#FAD72D" },
  dourado: { name: "Dourado", from: "#FAD72D", to: "#C9A815", accent: "#2A04A9", darkText: true },
  dark: { name: "Preto Elegante", from: "#0A0A0A", to: "#1A1A1A", accent: "#FAD72D" },
  duo: { name: "Azul + Bordô", from: "#2A04A9", to: "#4A0508", accent: "#FAD72D" },
};

export const FORMAT_SIZES = {
  post: { w: 1080, h: 1080 },
  stories: { w: 1080, h: 1920 },
  reels: { w: 1080, h: 1920 },
};

// Ícones vetoriais simples por serviço, desenhados com paths de Canvas
// (sem dependência de fontes de ícone externas, que não renderizam em Canvas
// com confiabilidade). Cada função recebe o contexto, centro (cx, cy) e raio.
const SERVICE_ICONS = {
  Limpeza: drawIconBucket,
  Portaria: drawIconShield,
  Facilities: drawIconWrench,
  Condomínios: drawIconBuilding,
  Empresas: drawIconBriefcase,
};

function drawIconBucket(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#FFFFFF";
  ctx.fillStyle = "#FFFFFF";
  ctx.lineWidth = r * 0.09;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Corpo do balde (trapézio)
  const w1 = r * 0.7, w2 = r * 0.95, h = r * 1.1;
  ctx.beginPath();
  ctx.moveTo(-w1, -h * 0.3);
  ctx.lineTo(w1, -h * 0.3);
  ctx.lineTo(w2 * 0.85, h * 0.6);
  ctx.lineTo(-w2 * 0.85, h * 0.6);
  ctx.closePath();
  ctx.stroke();

  // Alça
  ctx.beginPath();
  ctx.arc(0, -h * 0.3, w1 * 0.9, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();

  // Linha de água dentro do balde
  ctx.beginPath();
  ctx.moveTo(-w1 * 0.7, -h * 0.05);
  ctx.lineTo(w1 * 0.7, -h * 0.05);
  ctx.lineWidth = r * 0.06;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.restore();
}

function drawIconShield(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = r * 0.09;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.8, -r * 0.55);
  ctx.lineTo(r * 0.8, r * 0.25);
  ctx.quadraticCurveTo(r * 0.8, r * 0.85, 0, r * 1.05);
  ctx.quadraticCurveTo(-r * 0.8, r * 0.85, -r * 0.8, r * 0.25);
  ctx.lineTo(-r * 0.8, -r * 0.55);
  ctx.closePath();
  ctx.stroke();

  // Check mark dentro do escudo
  ctx.beginPath();
  ctx.moveTo(-r * 0.35, 0);
  ctx.lineTo(-r * 0.05, r * 0.3);
  ctx.lineTo(r * 0.45, -r * 0.3);
  ctx.lineWidth = r * 0.11;
  ctx.stroke();
  ctx.restore();
}

function drawIconWrench(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = "round";

  // Cabo da chave
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, 0);
  ctx.lineTo(r * 0.5, 0);
  ctx.stroke();

  // Cabeça da chave (anel aberto)
  ctx.lineWidth = r * 0.18;
  ctx.beginPath();
  ctx.arc(r * 0.65, 0, r * 0.38, Math.PI * 0.25, Math.PI * 1.65);
  ctx.stroke();
  ctx.restore();
}

function drawIconBuilding(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#FFFFFF";
  ctx.fillStyle = "#FFFFFF";
  ctx.lineWidth = r * 0.08;
  ctx.lineJoin = "round";

  const w = r * 1.1, h = r * 1.4;
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  // Janelas (grade 2x3)
  const cols = 2, rows = 3;
  const padX = w * 0.18, padY = h * 0.12;
  const cellW = (w - padX * 3) / cols;
  const cellH = (h - padY * 4) / rows;
  ctx.globalAlpha = 0.85;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = -w / 2 + padX + col * (cellW + padX);
      const y = -h / 2 + padY + row * (cellH + padY);
      ctx.fillRect(x, y, cellW, cellH);
    }
  }
  ctx.restore();
}

function drawIconBriefcase(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = r * 0.09;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const w = r * 1.5, h = r;
  // Corpo
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  // Alça
  ctx.beginPath();
  ctx.moveTo(-w * 0.18, -h / 2);
  ctx.lineTo(-w * 0.18, -h * 0.85);
  ctx.lineTo(w * 0.18, -h * 0.85);
  ctx.lineTo(w * 0.18, -h / 2);
  ctx.stroke();
  // Linha central (fecho)
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(w / 2, 0);
  ctx.lineWidth = r * 0.06;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.restore();
}

function drawServiceIcon(ctx, service, cx, cy, r) {
  const fn = SERVICE_ICONS[service] || SERVICE_ICONS.Empresas;
  fn(ctx, cx, cy, r);
}

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

// Cache do elemento de imagem da logo, carregado uma vez e reaproveitado.
let logoImagePromise = null;
function getLogoImage() {
  if (!logoImagePromise) {
    logoImagePromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = lcsLogoUrl;
    });
  }
  return logoImagePromise;
}

/**
 * Desenha a foto cortada (cover) dentro de uma região do canvas.
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

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  ctx.restore();
}

/**
 * Quebra um texto em múltiplas linhas para caber em uma largura máxima.
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = words[0] || "";

  for (let i = 1; i < words.length; i++) {
    const testLine = currentLine + " " + words[i];
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
/**
 * Desenha um retângulo com cantos arredondados.
 */
function roundRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Aplica o criativo elaborado da marca LCS a uma foto real, e retorna um
 * data URL (PNG). Layout: a foto real cobre todo o canvas, com uma leve
 * vinheta escura para garantir contraste, e três cards flutuantes sólidos
 * (cores da marca) sobrepostos — um com o serviço/ícone, um com o título
 * de destaque, e um com o contato — além da logo real flutuando no canto.
 *
 * @param {HTMLImageElement} img - imagem já carregada
 * @param {string} themeKey - chave de STYLE_THEMES
 * @param {string} format - chave de FORMAT_SIZES
 * @param {string} service - nome do serviço (para escolher o ícone)
 * @param {string} headline - texto de destaque (ex: "Limpeza Profissional")
 * @param {string} contactLine - texto de contato/CTA
 */
export async function applyStyle(
  img,
  themeKey,
  format,
  service = "Empresas",
  headline = "",
  contactLine = "(51) 99889-3033"
) {
  const theme = STYLE_THEMES[themeKey] || STYLE_THEMES.azul;
  const size = FORMAT_SIZES[format] || FORMAT_SIZES.post;
  const logo = await getLogoImage();

  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");

  // 1. Foto real cobrindo todo o canvas
  drawCoverImage(ctx, img, 0, 0, size.w, size.h);

  // Vinheta escura sutil em toda a foto, para garantir contraste com os
  // cards claros e com a logo, independente do quão clara a foto seja.
  const vignette = ctx.createLinearGradient(0, 0, 0, size.h);
  vignette.addColorStop(0, "rgba(0,0,0,0.20)");
  vignette.addColorStop(0.4, "rgba(0,0,0,0.05)");
  vignette.addColorStop(0.75, "rgba(0,0,0,0.15)");
  vignette.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size.w, size.h);

  const padX = size.w * 0.06;
  const radius = size.w * 0.022;
  const accentTextColor = theme.darkText ? BRAND_COLORS.preto : "#FFFFFF";

  // 2. CARD DE SERVIÇO — canto superior esquerdo, cor de acento (geralmente
  // dourado), com ícone + nome do serviço.
  const card1Y = size.h * 0.06;
  const card1H = size.w * 0.10;
  const iconR = card1H * 0.34;
  ctx.font = `700 ${size.w * 0.032}px Arial`;
  const serviceLabel = service.toUpperCase();
  const serviceTextWidth = ctx.measureText(serviceLabel).width;
  const card1W = iconR * 2 + size.w * 0.06 + serviceTextWidth + size.w * 0.05;

  ctx.fillStyle = theme.accent;
  roundRect(ctx, padX, card1Y, card1W, card1H, radius);
  ctx.fill();

  const iconCx = padX + card1H * 0.5;
  const iconCy = card1Y + card1H / 2;
  ctx.beginPath();
  ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
  ctx.fillStyle = theme.darkText ? "#FFFFFF" : theme.from;
  ctx.fill();
  drawServiceIcon(ctx, service, iconCx, iconCy, iconR * 0.78);

  ctx.fillStyle = accentTextColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(serviceLabel, iconCx + iconR + size.w * 0.03, iconCy);

  // 3. LOGO real, flutuando direto na foto, canto superior direito
  const logoSize = size.w * 0.13;
  ctx.drawImage(logo, size.w - padX - logoSize, size.h * 0.06, logoSize, logoSize);

  // 4. CARD DE TÍTULO — bloco maior próximo da base, cor principal do tema
  // (gradiente sutil interno), com o headline em destaque.
  const headlineText = headline || `${service} Profissional`;
  const headlineFontSize = size.w * 0.052;
  ctx.font = `800 ${headlineFontSize}px Arial`;
  const maxTextWidth = size.w - padX * 2 - size.w * 0.08;
  const headlineLines = wrapText(ctx, headlineText, maxTextWidth).slice(0, 2);
  const lineHeight = headlineFontSize * 1.18;

  const subtitleFontSize = size.w * 0.03;
  const hasSubtitle = Boolean(theme.subtitle);

  const card2PadV = size.w * 0.045;
  const card2H =
    card2PadV * 2 +
    headlineLines.length * lineHeight +
    (hasSubtitle ? subtitleFontSize * 1.6 : 0);
  const card2Y = size.h * (format === "post" ? 0.62 : 0.74);
  const card2W = size.w - padX * 2;

  const cardGrad = ctx.createLinearGradient(padX, card2Y, padX + card2W, card2Y + card2H);
  cardGrad.addColorStop(0, theme.from);
  cardGrad.addColorStop(1, theme.to);
  ctx.fillStyle = cardGrad;
  roundRect(ctx, padX, card2Y, card2W, card2H, radius * 1.3);
  ctx.fill();

  ctx.fillStyle = theme.darkText ? BRAND_COLORS.preto : "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let textCursorY = card2Y + card2PadV;
  headlineLines.forEach((line) => {
    ctx.fillText(line, padX + size.w * 0.04, textCursorY);
    textCursorY += lineHeight;
  });

  // 5. CARD DE CONTATO — pequeno, abaixo do card de título, cor de acento
  // contrastante (bordô) para chamar atenção ao CTA.
  const contactFontSize = size.w * 0.03;
  ctx.font = `600 ${contactFontSize}px Arial`;
  const contactTextWidth = ctx.measureText(contactLine).width;
  const card3H = contactFontSize * 2.4;
  const card3W = contactTextWidth + size.w * 0.08;
  const card3Y = card2Y + card2H + size.w * 0.035;
  const card3Color = themeKey === "bordo" ? theme.accent : BRAND_COLORS.bordo;

  ctx.fillStyle = card3Color;
  roundRect(ctx, padX, card3Y, card3W, card3H, radius);
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(contactLine, padX + size.w * 0.04, card3Y + card3H / 2);

  return canvas.toDataURL("image/png");
}

/**
 * Adapta uma imagem já estilizada (ex: post quadrado) para o formato Stories,
 * centralizando-a sobre um fundo da cor do tema — sem precisar reprocessar
 * a foto original. Útil quando o Banco de Temas só tem fotos em outro formato.
 */
export function adaptToStoriesFormat(imageDataUrl, themeKey) {
  return new Promise((resolve) => {
    const theme = STYLE_THEMES[themeKey] || STYLE_THEMES.azul;
    const size = FORMAT_SIZES.stories;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext("2d");

      const grad = ctx.createLinearGradient(0, 0, size.w, size.h);
      grad.addColorStop(0, theme.from);
      grad.addColorStop(1, theme.to);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size.w, size.h);

      const scale = Math.min(size.w / img.width, (size.h * 0.75) / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offsetX = (size.w - drawW) / 2;
      const offsetY = (size.h - drawH) / 2;

      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      resolve(canvas.toDataURL("image/png"));
    };
    img.src = imageDataUrl;
  });
}

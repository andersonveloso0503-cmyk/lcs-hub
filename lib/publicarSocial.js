// lib/publicarSocial.js
//
// Publica um vídeo ou imagem na Página "Em Nome de Jesus" (Facebook) e no
// Instagram (@emnomedejesus_rs) vinculado a ela.
//
// Variáveis de ambiente necessárias (Vercel):
//   FACEBOOK_PAGE_ACCESS_TOKEN  -> token de acesso da Página (de longa duração, ver nota no final)
//   FACEBOOK_PAGE_ID            -> 1298474906688229
//   INSTAGRAM_BUSINESS_ACCOUNT_ID -> pegue com GET /me?fields=instagram_business_account

const GRAPH_VERSION = 'v21.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

function tokenPagina() {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('FACEBOOK_PAGE_ACCESS_TOKEN não configurada');
  return token;
}

// --- Facebook ---

async function publicarVideoFacebook({ videoUrl, legenda }) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageId) throw new Error('FACEBOOK_PAGE_ID não configurada');

  const resp = await fetch(`${GRAPH_URL}/${pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_url: videoUrl,
      description: legenda,
      access_token: tokenPagina(),
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Facebook (vídeo) respondeu ${resp.status}: ${JSON.stringify(data)}`);
  return { id: data.id, url: `https://www.facebook.com/${data.id}` };
}

async function publicarImagemFacebook({ imagemUrl, legenda }) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageId) throw new Error('FACEBOOK_PAGE_ID não configurada');

  const resp = await fetch(`${GRAPH_URL}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imagemUrl,
      caption: legenda,
      access_token: tokenPagina(),
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Facebook (imagem) respondeu ${resp.status}: ${JSON.stringify(data)}`);
  return { id: data.post_id || data.id, url: `https://www.facebook.com/${data.post_id || data.id}` };
}

// --- Instagram ---
// Publicar no Instagram é em 2 passos: criar o "container" de mídia,
// esperar ele processar, e só depois publicar de fato.

async function criarContainerInstagram({ tipo, midiaUrl, legenda }) {
  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!igId) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID não configurada');

  const corpo = {
    caption: legenda,
    access_token: tokenPagina(),
  };
  if (tipo === 'video') {
    corpo.media_type = 'REELS';
    corpo.video_url = midiaUrl;
  } else {
    corpo.image_url = midiaUrl;
  }

  const resp = await fetch(`${GRAPH_URL}/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Instagram (criar container) respondeu ${resp.status}: ${JSON.stringify(data)}`);
  return data.id; // creation_id
}

async function esperarContainerPronto(creationId, { tentativas = 30, intervaloMs = 3000 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const resp = await fetch(
      `${GRAPH_URL}/${creationId}?fields=status_code&access_token=${tokenPagina()}`
    );
    const data = await resp.json();
    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR') throw new Error('Instagram falhou ao processar a mídia.');
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  throw new Error('Instagram demorou demais pra processar a mídia (timeout).');
}

async function publicarContainerInstagram(creationId) {
  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const resp = await fetch(`${GRAPH_URL}/${igId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: tokenPagina() }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Instagram (publicar) respondeu ${resp.status}: ${JSON.stringify(data)}`);
  return { id: data.id };
}

async function publicarNoInstagram({ tipo, midiaUrl, legenda }) {
  const creationId = await criarContainerInstagram({ tipo, midiaUrl, legenda });
  // vídeo precisa esperar processar; imagem geralmente já sai pronta, mas
  // não custa checar do mesmo jeito
  await esperarContainerPronto(creationId);
  const resultado = await publicarContainerInstagram(creationId);
  return { id: resultado.id, url: `https://www.instagram.com/p/${resultado.id}` };
}

module.exports = {
  publicarVideoFacebook,
  publicarImagemFacebook,
  publicarNoInstagram,
};

// /api/upload-image.js
// Recebe uma imagem em base64 e faz upload para o Vercel Blob,
// retornando a URL pública (necessária para o Buffer agendar o post).

import { put } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { imageBase64, filename } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Campo 'imageBase64' é obrigatório" });
    }

    // imageBase64 vem como data URL: "data:image/png;base64,XXXX"
    const matches = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Formato de imagem inválido" });
    }
    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    const name = filename || `post-${Date.now()}.png`;

    const blob = await put(name, buffer, {
      access: "public",
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error("Erro no upload da imagem:", err);
    return res.status(500).json({ error: err.message });
  }
}

// upload-presentation.mjs
//
// Script de uso único, roda LOCAL (não faz parte da Vercel Functions).
// Sobe o PDF de apresentação pro mesmo Blob Store do projeto lcs-hub e
// imprime a URL pública pra você colar na variável EMPRESA_PRESENTATION_URL.
//
// Como usar (CMD, dentro da pasta do projeto):
//
//   npm install            (se ainda não tiver instalado as dependências)
//   set BLOB_READ_WRITE_TOKEN=cole_o_token_aqui
//   node upload-presentation.mjs caminho\para\apresentacao-lcs-terceirizacao.pdf
//
// O token é o mesmo BLOB_READ_WRITE_TOKEN que já está configurado na Vercel
// (Project Settings → Environment Variables) — copie o valor de lá.

import { put } from "@vercel/blob";
import { readFileSync } from "fs";

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error(
    "Defina BLOB_READ_WRITE_TOKEN antes de rodar (set BLOB_READ_WRITE_TOKEN=...)."
  );
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Uso: node upload-presentation.mjs caminho\\para\\apresentacao.pdf");
  process.exit(1);
}

const fileBuffer = readFileSync(filePath);

const blob = await put("apresentacao-lcs-terceirizacao.pdf", fileBuffer, {
  access: "public",
  contentType: "application/pdf",
  token,
  allowOverwrite: true,
});

console.log("\nUpload concluído!");
console.log("URL pública:", blob.url);
console.log(
  "\nAgora vá na Vercel → Project Settings → Environment Variables → adicione:\n" +
    "  EMPRESA_PRESENTATION_URL = " + blob.url +
    "\n\nE faça um Redeploy pra valer pra todo mundo."
);

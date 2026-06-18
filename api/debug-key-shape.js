// /api/debug-key-shape.js
// ENDPOINT TEMPORÁRIO DE DIAGNÓSTICO — não expõe o conteúdo da chave, só
// metadados sobre seu formato, para identificar por que o parse está
// falhando. Remover depois que o problema for resolvido.

export default async function handler(req, res) {
  const raw = process.env.FIREBASE_PRIVATE_KEY || "";

  return res.status(200).json({
    length: raw.length,
    startsWithDashes: raw.startsWith("-----BEGIN"),
    endsWithDashes: raw.trim().endsWith("-----END PRIVATE KEY-----"),
    containsLiteralBackslashN: raw.includes("\\n"),
    containsRealNewline: raw.includes("\n"),
    firstChars: raw.slice(0, 30),
    lastChars: raw.slice(-30),
    hasOuterQuotes: raw.startsWith('"') && raw.endsWith('"'),
  });
}

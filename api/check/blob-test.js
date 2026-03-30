// api/check/blob-test.js — GET /api/check/blob-test
// Solo para diagnóstico: escribe y lee el blob para verificar que funciona.

import { put, head } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const testData = { test: true, ts: new Date().toISOString() };

    // Escribir
    const result = await put("notificados.json", JSON.stringify(testData), {
      access:          "public",
      contentType:     "application/json",
      addRandomSuffix: false,
    });

    // Leer de vuelta
    const info = await head("notificados.json");
    const readRes = await fetch(info.url);
    const readData = await readRes.json();

    res.status(200).json({ written: result, read: readData });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}

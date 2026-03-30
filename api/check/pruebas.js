// api/check/pruebas.js — GET /api/check/pruebas
// Igual que /api/check pero sin enviar notificación a Telegram ni actualizar el blob.

import { fetchAvailable } from "../_lib/padel.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const data = await fetchAvailable();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

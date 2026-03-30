// api/check/index.js — GET /api/check
// Comprueba disponibilidad y notifica por Telegram si hay huecos nuevos.

import {
  fetchAvailable,
  loadNotificados,
  saveNotificados,
  limpiarNotificados,
  sendTelegram,
} from "../_lib/padel.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const data = await fetchAvailable();

    if (data.total > 0) {
      let notificados = limpiarNotificados(await loadNotificados());

      const nuevos = data.disponibles.filter(d => {
        const key = `${d.fecha}|${d.hora}|${d.pista}`;
        return !notificados[key];
      });

      if (nuevos.length > 0) {
        await sendTelegram(nuevos);
        for (const d of nuevos) {
          notificados[`${d.fecha}|${d.hora}|${d.pista}`] = true;
        }
        await saveNotificados(notificados);
      }
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

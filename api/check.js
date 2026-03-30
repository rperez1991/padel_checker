// api/check.js — Vercel serverless function
// GET /api/check  →  JSON con huecos disponibles lunes-jueves en 18:30 y 19:00

import { put, head, del } from "@vercel/blob";

const BASE   = "https://reservas.fundacioncrcantabria.es";
const LOGIN  = process.env.PADEL_LOGIN;
const PASSWD = process.env.PADEL_PASSWD;
const UA     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

// pista_id en la API (número de pista visual + 10)
const COURTS_1830 = [17, 18, 19];  // pistas 7, 8, 9  → 18:30
const COURTS_1900 = [20, 21, 22];  // pistas 10, 11, 12 → 19:00

// ── Helpers de cookies ────────────────────────────────────────────────────────

function extractSetCookies(headers) {
  // getSetCookie() es Node 18.14+ / undici; fallback a get() para entornos más viejos
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  return raw ? raw.split(/,(?=[^ ])/) : [];
}

function parseCookies(headers) {
  return extractSetCookies(headers)
    .map(c => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookies(existing, incoming) {
  if (!incoming) return existing;
  const map = {};
  for (const part of (existing + "; " + incoming).split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    map[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

// GET que sigue redirecciones manualmente acumulando cookies
async function getFollowing(url, cookies) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, {
      headers: { "User-Agent": UA, Cookie: cookies },
      redirect: "manual",
    });
    cookies = mergeCookies(cookies, parseCookies(res.headers));
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      current = loc.startsWith("http") ? loc : `${BASE}${loc}`;
    } else {
      return { res, cookies, text: await res.text() };
    }
  }
  throw new Error("Demasiadas redirecciones");
}

// ── Lógica principal ──────────────────────────────────────────────────────────

async function fetchAvailable() {
  // 1. Home → CSRF + cookies iniciales
  const { text: homeHtml, cookies: c1 } = await getFollowing(`${BASE}/`, "");

  const csrfMatch =
    homeHtml.match(/name=['"]_csrf['"][^>]+value=['"]([^'"]+)['"]/) ||
    homeHtml.match(/value=['"]([^'"]+)['"][^>]+name=['"]_csrf['"]/) ||
    homeHtml.match(/"_csrf"\s*:\s*"([^"]{8,})"/);
  const csrf = csrfMatch?.[1] ?? "";

  // 2. Login POST → seguir redirect acumulando cookies
  const loginBody = new URLSearchParams({
    _csrf:       csrf,
    request_url: "",
    login:       LOGIN,
    password:    PASSWD,
  });

  let cookies = c1;
  let current = `${BASE}/session/create`;
  for (let i = 0; i < 5; i++) {
    const isFirst = i === 0;
    const res = await fetch(current, {
      method:  isFirst ? "POST" : "GET",
      headers: {
        ...(isFirst ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        "Origin":   BASE,
        "Referer":  `${BASE}/`,
        "User-Agent": UA,
        "Cookie":   cookies,
      },
      body:     isFirst ? loginBody.toString() : undefined,
      redirect: "manual",
    });
    cookies = mergeCookies(cookies, parseCookies(res.headers));
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      current = loc.startsWith("http") ? loc : `${BASE}${loc}`;
    } else {
      break;
    }
  }

  // 3. Consulta reservas (ventana 7 días)
  const today = new Date().toISOString().slice(0, 10);
  const ts    = Date.now();
  const apiRes = await fetch(
    `${BASE}/reservas/dia?dia=${today}&pistas=padel&days_forward=7&days_back=0&_=${ts}`,
    {
      headers: {
        "Accept":           "application/json, text/javascript, */*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer":          `${BASE}/reservas/padel`,
        "User-Agent":       UA,
        "Cookie":           cookies,
      },
    }
  );

  const contentType = apiRes.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    const body = await apiRes.text();
    throw new Error(`La API devolvió ${apiRes.status} no-JSON: ${body.slice(0, 200)}`);
  }
  const reservas = await apiRes.json();

  // 4. Set de ocupadas para búsqueda O(1)
  const ocupadas = new Set(
    reservas.map(r => `${r.pista_id}|${r.fecha_desde_local}`)
  );

  // 5. Días lunes-jueves dentro de la ventana
  const now    = new Date();
  const fechas = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dow = d.getDay(); // 0=dom … 6=sáb
    if (dow >= 1 && dow <= 4) {  // lun=1 … jue=4
      fechas.push(d.toISOString().slice(0, 10));
    }
  }

  const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  // Fechas excluidas manualmente
  const FECHAS_EXCLUIDAS = new Set(["2026-04-02", "2026-04-03", "2026-04-06"]);

  // 6. Huecos disponibles
  const disponibles = [];
  for (const fecha of fechas) {
    if (FECHAS_EXCLUIDAS.has(fecha)) continue;
    const diaSemana = DIAS[new Date(fecha + "T12:00:00").getDay()];
    for (const pista of COURTS_1830) {
      if (!ocupadas.has(`${pista}|${fecha} 18:30`))
        disponibles.push({ fecha, dia: diaSemana, hora: "18:30", pista: pista - 10 });
    }
    for (const pista of COURTS_1900) {
      if (!ocupadas.has(`${pista}|${fecha} 19:00`))
        disponibles.push({ fecha, dia: diaSemana, hora: "19:00", pista: pista - 10 });
    }
  }

  return {
    consultado:  new Date().toISOString(),
    disponibles,
    total:       disponibles.length,
  };
}

// ── Deduplicación via Vercel Blob ─────────────────────────────────────────────

const BLOB_KEY = "notificados.json";

async function loadNotificados() {
  try {
    const info = await head(BLOB_KEY);
    const res  = await fetch(info.url);
    return await res.json();   // { "2026-04-07|18:30|7": true, ... }
  } catch {
    return {};
  }
}

async function saveNotificados(notificados) {
  await put(BLOB_KEY, JSON.stringify(notificados), {
    access:      "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

// Elimina entradas de fechas pasadas para no acumular indefinidamente
function limpiarNotificados(notificados) {
  const hoy = new Date().toISOString().slice(0, 10);
  return Object.fromEntries(
    Object.entries(notificados).filter(([k]) => k.slice(0, 10) >= hoy)
  );
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function sendTelegram(disponibles) {
  const token  = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const lineas = disponibles.map(d =>
    `• ${d.dia} ${d.fecha} — ${d.hora} — Pista ${d.pista}`
  );
  const text = `🎾 Pistas disponibles:\n\n${lineas.join("\n")}`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text }),
  });
}

// ── Handler Vercel ─────────────────────────────────────────────────────────────

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

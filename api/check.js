// api/check.js — Vercel serverless function
// GET /api/check  →  JSON con huecos disponibles lunes-jueves en 18:30 y 19:00

const BASE   = "https://reservas.fundacioncrcantabria.es";
const LOGIN  = process.env.PADEL_LOGIN;
const PASSWD = process.env.PADEL_PASSWD;
const UA     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

// pista_id en la API (número de pista visual + 10)
const COURTS_1830 = [17, 18, 19];  // pistas 7, 8, 9  → 18:30
const COURTS_1900 = [20, 21, 22];  // pistas 10, 11, 12 → 19:00

// ── Helpers de cookies ────────────────────────────────────────────────────────

function parseCookies(headers) {
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map(c => c.split(";")[0]).join("; ");
}

function mergeCookies(existing, incoming) {
  if (!incoming) return existing;
  const map = Object.fromEntries(
    existing.split(";").filter(Boolean).map(p => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    })
  );
  incoming.split(";").filter(Boolean).forEach(p => {
    const [k, ...v] = p.trim().split("=");
    map[k] = v.join("=");
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── Lógica principal ──────────────────────────────────────────────────────────

async function fetchAvailable() {
  let cookies = "";

  // 1. Home → CSRF + cookies de sesión
  const homeRes = await fetch(`${BASE}/`, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  cookies = mergeCookies(cookies, parseCookies(homeRes.headers));
  const homeHtml = await homeRes.text();

  const csrfMatch =
    homeHtml.match(/name=['"]_csrf['"][^>]+value=['"]([^'"]+)['"]/) ||
    homeHtml.match(/value=['"]([^'"]+)['"][^>]+name=['"]_csrf['"]/) ||
    homeHtml.match(/"_csrf"\s*:\s*"([^"]{8,})"/);
  const csrf = csrfMatch?.[1] ?? "";

  // 2. Login
  const loginBody = new URLSearchParams({
    _csrf:       csrf,
    request_url: "",
    login:       LOGIN,
    password:    PASSWD,
  });
  const loginRes = await fetch(`${BASE}/session/create`, {
    method:   "POST",
    headers:  {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin":       BASE,
      "Referer":      `${BASE}/`,
      "User-Agent":   UA,
      "Cookie":       cookies,
    },
    body:     loginBody.toString(),
    redirect: "manual",
  });
  cookies = mergeCookies(cookies, parseCookies(loginRes.headers));

  // 3. Consulta reservas (ventana 7 días)
  const today = new Date().toISOString().slice(0, 10);
  const ts    = Date.now();
  const apiRes = await fetch(
    `${BASE}/reservas/dia?dia=${today}&pistas=padel&days_forward=7&days_back=0&_=${ts}`,
    {
      headers: {
        "Accept":           "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer":          `${BASE}/reservas/padel`,
        "User-Agent":       UA,
        "Cookie":           cookies,
      },
    }
  );
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

  // 6. Huecos disponibles
  const disponibles = [];
  for (const fecha of fechas) {
    for (const pista of COURTS_1830) {
      if (!ocupadas.has(`${pista}|${fecha} 18:30`))
        disponibles.push({ fecha, hora: "18:30", pista });
    }
    for (const pista of COURTS_1900) {
      if (!ocupadas.has(`${pista}|${fecha} 19:00`))
        disponibles.push({ fecha, hora: "19:00", pista });
    }
  }

  return {
    consultado:  new Date().toISOString(),
    disponibles,
    total:       disponibles.length,
  };
}

// ── Handler Vercel ─────────────────────────────────────────────────────────────

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

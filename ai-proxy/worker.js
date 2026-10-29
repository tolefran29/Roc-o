// Proxy de IA para Rocío (Cloudflare Worker).
// Guarda tu clave de Anthropic en el servidor para que nunca viaje dentro de la app.
// Secretos: ANTHROPIC_API_KEY (obligatorio), APP_KEY (la misma que pongas en src/config.js).
// Variables: MODEL (por defecto claude-haiku-5-5), DAILY_LIMIT (consultas por dispositivo/IP y día).
const SYSTEM = "Eres Rocío, experta en botánica y riego dentro de una app móvil. Responde en español de España, breve y práctico.";
const hits = new Map();

export default {
  async fetch(req, env) {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-app-key", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return json({ error: "method" }, 405, cors);
    if (env.APP_KEY && req.headers.get("x-app-key") !== env.APP_KEY) return json({ error: "forbidden" }, 403, cors);

    // Límite sencillo por IP y día (por instancia). Para producción, añade una regla de Rate Limiting en Cloudflare.
    const ip = req.headers.get("cf-connecting-ip") || "x", day = new Date().toISOString().slice(0, 10), k = ip + day;
    const n = (hits.get(k) || 0) + 1; hits.set(k, n);
    if (n > Number(env.DAILY_LIMIT || 40)) return json({ error: "rate_limited" }, 429, cors);

    let body; try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, cors); }
    const messages = Array.isArray(body.messages) ? body.messages.slice(-14) : null;
    if (!messages || !messages.length) return json({ error: "no_messages" }, 400, cors);
    if (JSON.stringify(messages).length > 6_000_000) return json({ error: "too_large" }, 413, cors);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 1000, system: SYSTEM, messages })
    });
    if (!r.ok) return json({ error: "upstream", status: r.status }, r.status === 429 ? 429 : 502, cors);
    const j = await r.json();
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    return json({ text }, 200, cors);
  }
};
function json(o, status, h) { return new Response(JSON.stringify(o), { status, headers: { ...h, "content-type": "application/json" } }); }

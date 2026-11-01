import { PERSONA } from "./persona.js";

/**
 * POST /chat: the "Ask about Cade" widget. Forwards the conversation to
 * Gemini with the persona as the system prompt. Same origin as the site, so
 * no CORS to speak of; rate-limited per IP to protect a free key.
 */

const MAX_MESSAGES = 20;
const MAX_CHARS = 1000;
const PER_MINUTE = 8;
const PER_HOUR = 40;
// Where the chat ran before it moved here; used only while this Worker has no key of its own.
const LEGACY_CHAT = "https://portfolio-chat.frog-site.workers.dev/chat";

// Per-isolate memory. Good enough to blunt abuse of a free key; resets when the isolate recycles.
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  const lastMinute = list.filter((t) => now - t < 60_000).length;
  if (lastMinute >= PER_MINUTE || list.length >= PER_HOUR) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function handleChat(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "Not found" }, 404);

  if (!env.GEMINI_API_KEY) {
    // Not configured here yet: hand the request to the old Worker, which is.
    const res = await fetch(LEGACY_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://cade.work" },
      body: await request.text(),
    });
    return json(await res.json().catch(() => ({ error: "The chat service had a hiccup." })), res.status);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimited(ip)) return json({ error: "Slow down a little and try again in a minute." }, 429);

  let messages;
  try {
    ({ messages } = await request.json());
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) return json({ error: "No messages" }, 400);

  const contents = messages.slice(-MAX_MESSAGES).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "").slice(0, MAX_CHARS) }],
  }));
  if (contents[contents.length - 1].role !== "user") return json({ error: "Last message must be from the user" }, 400);

  const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: PERSONA }] },
      contents,
      generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("Gemini error", upstream.status, detail.slice(0, 500));
    const msg = upstream.status === 429 ? "The free quota is busy right now. Try again shortly." : "The model had a hiccup. Try again.";
    return json({ error: msg }, 502);
  }

  const data = await upstream.json();
  const reply = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!reply) return json({ error: "No answer came back. Try rephrasing." }, 502);
  return json({ reply }, 200);
}

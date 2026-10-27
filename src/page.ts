// Everything below the frog: the section bar, reveal-on-scroll and the chat bot.

const hero = document.querySelector<HTMLElement>("#hero")!;
const topbar = document.querySelector<HTMLElement>("#topbar")!;

// The section bar (and the chat button) slide in once the hero is mostly scrolled away.
new IntersectionObserver(([entry]) => {
  topbar.classList.toggle("shown", !entry.isIntersecting);
  document.body.classList.toggle("past-hero", !entry.isIntersecting);
}, {
  rootMargin: "-64px 0px 0px 0px",
}).observe(hero);

// Light up the section you're reading.
const barLinks = [...topbar.querySelectorAll<HTMLAnchorElement>(".topbar-links a")];
const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of barLinks) a.classList.toggle("current", a.hash === `#${e.target.id}`);
    }
  },
  { rootMargin: "-45% 0px -50% 0px" },
);
for (const s of document.querySelectorAll("section[id]")) sectionObserver.observe(s);

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("visible");
      revealObserver.unobserve(e.target);
    }
  },
  { threshold: 0.12 },
);
for (const el of document.querySelectorAll(".reveal")) revealObserver.observe(el);

// Chat: talks to the portfolio-chat worker, which holds the Gemini key.
const CHAT_URL = "https://portfolio-chat.frog-site.workers.dev/chat";
const toggle = document.querySelector<HTMLButtonElement>("#chat-toggle")!;
const panel = document.querySelector<HTMLElement>("#chat-panel")!;
const log = document.querySelector<HTMLElement>("#chat-log")!;
const form = document.querySelector<HTMLFormElement>("#chat-form")!;
const input = document.querySelector<HTMLInputElement>("#chat-input")!;
const send = document.querySelector<HTMLButtonElement>("#chat-send")!;
const suggest = panel.querySelector<HTMLElement>(".chat-suggest")!;
const chatHistory: { role: "user" | "assistant"; content: string }[] = [];

function setOpen(open: boolean) {
  panel.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  if (open) setTimeout(() => input.focus(), 50);
}
toggle.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
panel.querySelector(".chat-close")!.addEventListener("click", () => setOpen(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setOpen(false);
});

function add(text: string, cls: string) {
  const el = document.createElement("div");
  el.className = `chat-msg ${cls}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function ask(q: string) {
  q = q.trim();
  if (!q) return;
  suggest.style.display = "none";
  add(q, "user");
  chatHistory.push({ role: "user", content: q });
  input.value = "";
  send.disabled = true;
  const typing = add("thinking…", "bot typing");
  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory.slice(-12) }),
    });
    const data = await res.json().catch(() => ({}));
    typing.remove();
    if (!res.ok || !data.reply) {
      add(data.error || "Something went wrong. Try again.", "err");
      chatHistory.pop();
      return;
    }
    add(data.reply, "bot");
    chatHistory.push({ role: "assistant", content: data.reply });
  } catch {
    typing.remove();
    add("Could not reach the chat service.", "err");
    chatHistory.pop();
  } finally {
    send.disabled = false;
    input.focus();
  }
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  ask(input.value);
});
for (const b of suggest.querySelectorAll("button")) b.addEventListener("click", () => ask(b.textContent ?? ""));

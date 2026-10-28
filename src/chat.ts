/** The "Ask about Cade" widget, backed by a small Worker in front of Gemini. */
const CHAT_URL = "https://portfolio-chat.frog-site.workers.dev/chat";

export function startChat() {
  const toggle = document.getElementById("chat-toggle") as HTMLButtonElement | null;
  const panel = document.getElementById("chat-panel");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form") as HTMLFormElement | null;
  const input = document.getElementById("chat-input") as HTMLInputElement | null;
  const send = document.getElementById("chat-send") as HTMLButtonElement | null;
  if (!toggle || !panel || !log || !form || !input || !send) return;
  const suggest = panel.querySelector<HTMLElement>(".chat-suggest")!;
  const history: { role: "user" | "assistant"; content: string }[] = [];

  function setOpen(open: boolean) {
    panel!.classList.toggle("open", open);
    toggle!.setAttribute("aria-expanded", String(open));
    if (open) setTimeout(() => input!.focus(), 50);
  }
  toggle.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  panel.querySelector(".chat-close")!.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  function add(text: string, cls: string) {
    const el = document.createElement("div");
    el.className = "chat-msg " + cls;
    el.textContent = text;
    log!.appendChild(el);
    log!.scrollTop = log!.scrollHeight;
    return el;
  }

  async function ask(q: string) {
    q = q.trim();
    if (!q) return;
    suggest.style.display = "none";
    add(q, "user");
    history.push({ role: "user", content: q });
    input!.value = "";
    send!.disabled = true;
    const typing = add("thinking…", "bot typing");
    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-12) }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (!res.ok || !data.reply) {
        add(data.error || "Something went wrong. Try again.", "err");
        history.pop();
        return;
      }
      add(data.reply, "bot");
      history.push({ role: "assistant", content: data.reply });
    } catch {
      typing.remove();
      add("Could not reach the chat service.", "err");
      history.pop();
    } finally {
      send!.disabled = false;
      input!.focus();
    }
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
  suggest.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => ask(b.textContent ?? "")));
}

import { startMap } from "./map";
import { startChat } from "./chat";

/**
 * The portfolio half of the page: the map fading in as the frog's screen
 * scrolls away, the top bar appearing with it, sections revealing as they
 * come into view, and the chat widget.
 */
export function startPage(onReveal: () => void) {
  const map = startMap(document.querySelector<HTMLCanvasElement>("#pixels")!);
  const pixels = document.querySelector<HTMLElement>("#pixels")!;
  const topbar = document.querySelector<HTMLElement>(".topbar")!;
  const hint = document.querySelector<HTMLElement>(".scroll-hint");
  const chat = document.querySelector<HTMLElement>("#chat-toggle");

  // The map is hidden under the frog's screen and comes up as you leave it.
  function onScroll() {
    const h = window.innerHeight;
    const y = window.scrollY;
    const k = Math.min(1, Math.max(0, (y - h * 0.25) / (h * 0.6)));
    pixels.style.opacity = String(k);
    map.setVisible(k > 0);
    topbar.classList.toggle("shown", y > h * 0.6);
    chat?.classList.toggle("shown", y > h * 0.6);
    hint?.classList.toggle("hidden", y > 40);

    let current = "";
    for (const s of document.querySelectorAll<HTMLElement>("section[id]")) {
      if (y >= s.offsetTop - 120) current = s.id;
    }
    for (const a of topbar.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) {
      a.classList.toggle("current", a.getAttribute("href") === "#" + current);
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Scroll-triggered reveal. The frog's perches are measured from the page,
  // so it gets told once things have slid into place.
  let revealTimer = 0;
  const observer = new IntersectionObserver(
    (entries) => {
      let any = false;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("visible");
        any = true;
      }
      if (any) {
        clearTimeout(revealTimer);
        revealTimer = window.setTimeout(onReveal, 750);
      }
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

  startChat();
}

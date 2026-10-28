import * as THREE from "three";
import { Frog, type Surface } from "./frog";
import { Pond, type PoolShape } from "./pond";
import { DitherPass } from "./dither";
import { startPage } from "./page";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// A flat, front-on view, like looking into a terrarium. World units are CSS
// pixels of the whole page with y up: page point (x, y) is world (x, -y), so
// the page's top left corner is the origin. The camera shows the part of the
// page that is scrolled into view.
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
camera.position.z = 1000;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(-0.4, 0.8, 1); // from the front, up and to the left
scene.add(key);

const pond = new Pond();
const dither = new DitherPass(renderer, pond);

const toWorld = (x: number, y: number) => new THREE.Vector3(x, -y, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** A rectangle in page px. */
type Box = { left: number; right: number; top: number; bottom: number };

let perches: Surface[] = []; // every surface on the page
let surfaces: Surface[] = []; // the ones near the viewport: all the frog sees
let frogLength = 1;
// Frogs rarely leap far: at most about three body lengths.
const frog = new Frog({
  surfaces: () => surfaces,
  reach: () => frogLength * 3,
  scale: () => Math.min(window.innerWidth, window.innerHeight),
  blocked: (c, r) => textBoxes.some((b) => circleHitsBox(c, r, b)),
});

// The text the frog must never overlap (page px).
let textBoxes: Box[] = [];
const landing = document.querySelector<HTMLElement>("#landing")!;
const nameEl = landing.querySelector<HTMLElement>("h1")!;
const landingText = [...landing.querySelectorAll<HTMLElement>("h1, .tagline, nav")];
// Further down, it may sit on top of these but never over them.
const BLOCK =
  ".about-inner, .section-label, .section-title, .skill-row, .project-card, .edu-card, .contact-eyebrow, .contact-title, .contact-subtitle, .contact-links, .contact-email, footer";
// Things it may perch on: their top edges are ledges (never text itself:
// cards, button rows and the footer, which all have padding above their words).
const PERCH = ".btns, .skill-row, .project-card, .edu-card, .contact-links, footer";
// It needs this much clear space above a ledge (frog lengths) to sit there.
const HEADROOM = 0.6;

/** A circle around world point `c` against a page rect. */
function circleHitsBox(c: THREE.Vector3, r: number, b: Box) {
  const x = c.x;
  const y = -c.y; // world y is up; page y is down
  const dx = x - THREE.MathUtils.clamp(x, b.left, b.right);
  const dy = y - THREE.MathUtils.clamp(y, b.top, b.bottom);
  return dx * dx + dy * dy < r * r;
}
scene.add(frog.root);
const frogReady = frog.load();
// For poking at its behavior from the console while developing.
if (import.meta.env.DEV) Object.assign(window, { frog, world: () => ({ textBoxes, perches, surfaces }) });

function pageRect(el: Element): Box {
  return toPage(el.getBoundingClientRect());
}

/**
 * Just the words (and buttons) inside an element, each as its own box: a
 * heading is as wide as its column, its text is not, and a card's padding
 * is fine to sit on.
 */
function textRects(el: Element): Box[] {
  const out: Box[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push(toPage(r));
  }
  for (const b of el.querySelectorAll("a, button, .skill-icon-box")) out.push(pageRect(b));
  if (el.matches("a, button")) out.push(pageRect(el));
  return out;
}

function toPage(r: DOMRect): Box {
  const x = window.scrollX;
  const y = window.scrollY;
  return { left: r.left + x, right: r.right + x, top: r.top + y, bottom: r.bottom + y };
}

/** A ledge along the top of an element, e.g. the frog sitting on your name. */
function topOf(id: string, el: Element): Surface {
  const r = pageRect(el);
  return { id, a: toWorld(r.left, r.top), b: toWorld(r.right, r.top), normal: UP };
}

/** Elements still waiting to slide in sit 24px low; they only count once they have. */
const settled = (el: Element) => !el.classList.contains("reveal") || el.classList.contains("visible");

/**
 * Everything the frog can stand on, over the whole page: the landing's
 * floor, the top of the name, two invisible ledges between the name and the
 * pond, and the top edge of each card, heading and button row below.
 */
function buildPerches(w: number, h: number, frogLength: number, pool: PoolShape): Surface[] {
  const floor = h - 1;
  const out: Surface[] = [
    { id: "floor", a: toWorld(0, floor), b: toWorld(w, floor), normal: UP },
    // Only the name: anything below it would put the frog over the other text.
    topOf("name", nameEl),
  ];

  const pondBottom = pool.cy + pool.ry;
  const nameTop = pageRect(nameEl).top;
  const gap = nameTop - pondBottom;
  if (gap > frogLength * 1.2) {
    const width = Math.max(frogLength * 2, w * 0.16);
    // Out toward the sides, but never beyond a leap from the name: on wide
    // screens ledges at the edges left the frog stranded on the name.
    const cx = w / 2;
    const near = frogLength * 3 * 0.7; // a comfortable share of its reach
    const left = Math.max(w * 0.1, cx - near - width);
    const right = Math.min(w * 0.9 - width, cx + near);
    const y1 = pondBottom + gap * 0.35;
    const y2 = pondBottom + gap * 0.65;
    out.push(
      { id: "ledge-left", a: toWorld(left, y1), b: toWorld(left + width, y1), normal: UP },
      { id: "ledge-right", a: toWorld(right, y2), b: toWorld(right + width, y2), normal: UP },
    );
  } else {
    // No room above the name (short screens): put the ledges level with it,
    // one each side, so the frog can hop off and down past the text rather
    // than being stuck on the name.
    const name = pageRect(nameEl);
    const width = frogLength * 2;
    const off = frogLength * 1.2;
    const left = Math.max(w * 0.03, name.left - off - width);
    const right = Math.min(w * 0.97 - width, name.right + off);
    out.push(
      { id: "ledge-left", a: toWorld(left, name.top), b: toWorld(left + width, name.top), normal: UP },
      { id: "ledge-right", a: toWorld(right, name.top), b: toWorld(right + width, name.top), normal: UP },
    );
  }

  // The portfolio below: a card or button row is a ledge if a frog sitting
  // on it would be clear of everything above it (so never over any text).
  let i = 0;
  for (const el of document.querySelectorAll(PERCH)) {
    const id = `perch-${i++}`;
    if (!settled(el)) continue;
    const r = pageRect(el);
    if (r.right - r.left < frogLength * 1.2 || r.bottom <= r.top) continue;
    const band: Box = { left: r.left, right: r.right, top: r.top - frogLength * HEADROOM, bottom: r.top - 1 };
    // Only the stretch with nothing in the way above it (a heading often
    // overhangs the left end of a card): the longest clear run, if any.
    const inWay = textBoxes.filter((b) => overlaps(b, band));
    const run = clearRun(r.left, r.right, inWay);
    if (!run || run[1] - run[0] < frogLength * 1.2) continue;
    out.push({ id, a: toWorld(run[0], r.top), b: toWorld(run[1], r.top), normal: UP });
  }
  return out;
}

/** The longest part of [left, right] not under any of `boxes`. */
function clearRun(left: number, right: number, boxes: Box[]): [number, number] | null {
  const edges = boxes.map((b) => [b.left, b.right] as [number, number]).sort((a, b) => a[0] - b[0]);
  let best: [number, number] | null = null;
  let at = left;
  const take = (a: number, b: number) => {
    if (b - a > (best ? best[1] - best[0] : 0)) best = [a, b];
  };
  for (const [a, b] of edges) {
    if (a > at) take(at, Math.min(a, right));
    at = Math.max(at, b);
  }
  if (at < right) take(at, right);
  return best;
}

function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Whether the reader has scrolled down off the frog's screen. */
const scrolledDown = () => window.scrollY > window.innerHeight * 0.25;

/**
 * What the frog can see from where the page is scrolled to: the perches
 * near the viewport, and the two side walls of the viewport itself (so
 * following the reader down the page means leaping from ledge to ledge, or
 * climbing). Walls run bottom to top, so "forward" on them is climbing.
 */
function nearby(): Surface[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const top = window.scrollY;
  const bottom = top + h;
  // Until the reader scrolls, it stays on its own screen.
  const out = scrolledDown()
    ? perches.filter((s) => -s.a.y > top - h * 0.3 && -s.a.y < bottom + h * 0.3)
    : perches.filter((s) => -s.a.y < h);
  const wallTop = top + h * 0.06;
  out.push(
    { id: "wall-left", a: toWorld(0, bottom), b: toWorld(0, wallTop), normal: new THREE.Vector3(1, 0, 0) },
    { id: "wall-right", a: toWorld(w, bottom), b: toWorld(w, wallTop), normal: new THREE.Vector3(-1, 0, 0) },
  );
  return out;
}

/** Re-measures the page (text boxes and perches) without moving the frog. */
function measure() {
  const { innerWidth: w, innerHeight: h } = window;
  textBoxes = [...landingText, ...document.querySelectorAll(BLOCK)].flatMap(textRects);
  perches = buildPerches(w, h, frogLength, pool);
  surfaces = nearby();
}

let pool: PoolShape = { cx: 0, cy: 0, rx: 0, ry: 0 };
function layout() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h, false);
  camera.left = 0;
  camera.right = w;
  dither.setSize();

  frogLength = THREE.MathUtils.clamp(Math.min(w, h) * 0.2, 70, 150);
  frog.setLength(frogLength);

  // The pond: a faint oval in the background, a little above the middle of the landing.
  const rx = Math.min(w * 0.38, 400);
  pool = { cx: w / 2, cy: h * 0.42, rx, ry: rx * 0.2 };
  pond.setPool(pool);

  measure();
  frog.refresh();
}
window.addEventListener("resize", layout);
layout();
// Text positions shift once the web font arrives.
document.fonts.ready.then(layout);
window.addEventListener("load", measure);

// Start as a still little blob sitting on top of the name.
{
  const name = perches.find((s) => s.id === "name")!;
  frog.placeOn(name, name.a.distanceTo(name.b) * 0.5, 1);
}

// The portfolio: map, top bar, reveals, chat. Cards slide into place as they
// appear, so the ledges are measured again once they have.
startPage(measure);

// ---- Following the reader, and being startled -----------------------------

/** Where the frog's body is on the page (page px). */
function frogAt() {
  const p = frog.root.position;
  return { x: p.x, y: -p.y - frogLength * 0.3 };
}

/**
 * Left behind by the reader: one long leap into view, onto a ledge there if
 * there is one (the nearest across), else a bound along the nearer wall.
 */
function catchUp() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const top = window.scrollY;
  const { x } = frogAt();
  const inView = surfaces.filter((s) => !s.id.startsWith("wall") && -s.a.y > top + h * 0.1 && -s.a.y < top + h * 0.9);
  if (inView.length) {
    const mid = (s: Surface) => (s.a.x + s.b.x) / 2;
    const to = inView.reduce((best, s) => (Math.abs(mid(s) - x) < Math.abs(mid(best) - x) ? s : best));
    const len = to.a.distanceTo(to.b);
    return frog.bolt(to, len * (0.3 + Math.random() * 0.4));
  }
  const wall = surfaces.find((s) => s.id === (x < w / 2 ? "wall-left" : "wall-right"));
  if (!wall) return;
  const y = top + h * (0.4 + Math.random() * 0.3);
  frog.bolt(wall, -wall.a.y - y); // up the wall from its bottom
}

/** Startled: one long bound back up to the pond, onto the floor or a ledge there. */
function boltHome() {
  const home = perches.filter((s) => s.id === "floor" || s.id.startsWith("ledge"));
  const to = home[Math.floor(Math.random() * home.length)];
  if (!to) return;
  const len = to.a.distanceTo(to.b);
  frog.bolt(to, len * (0.25 + Math.random() * 0.5));
  // It stays put up there until the reader scrolls again.
  settledAt = window.scrollY;
}

// Click (or tap) the frog and it bolts back up to the pond.
let settledAt: number | null = null;
const inChrome = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest("a, button, input, #chat-panel, .topbar");
window.addEventListener("pointerdown", (e) => {
  if (inChrome(e.target)) return;
  const { x, y } = frogAt();
  const px = e.clientX + window.scrollX;
  const py = e.clientY + window.scrollY;
  if (Math.hypot(px - x, py - y) > frogLength * 0.6) return;
  boltHome();
});
// Scrolled away from it: it follows, leaping from ledge to ledge if it can;
// left out of view for a moment, it makes one long leap to catch up.
let lostFor = 0;
function follow(dt: number) {
  if (frog.leaping) return;
  const h = window.innerHeight;
  // Sent home by a click: it waits there until the page moves again.
  if (settledAt !== null && Math.abs(window.scrollY - settledAt) < h * 0.3) return;
  settledAt = null;
  const y = frogAt().y - window.scrollY;
  lostFor = y < -h * 0.2 || y > h * 1.2 ? lostFor + dt : 0;
  if (lostFor > 1.2) {
    lostFor = 0;
    catchUp();
  }
}

// What it can see changes as the page scrolls.
let lastScroll = -1;
function scrolled() {
  const y = window.scrollY;
  if (y === lastScroll) return;
  lastScroll = y;
  surfaces = nearby();
  camera.top = -y;
  camera.bottom = -(y + window.innerHeight);
  camera.updateProjectionMatrix();
}

// Hold the scene back until the frog has loaded, so the pond and the frog
// appear together rather than the frog popping in afterwards.
frogReady.then(() => {
  const clock = new THREE.Clock();
  const step = (dt: number) => {
    scrolled();
    follow(dt);
    frog.update(dt);
    pond.update(dt);
    dither.render(scene, camera);
  };
  renderer.setAnimationLoop(() => step(Math.min(clock.getDelta(), 0.1)));
  // Dev: step frames by hand (the browser pauses the loop while the page is hidden).
  if (import.meta.env.DEV) Object.assign(window, { step });
});

// A clicked link opens in a new tab but keeps focus here, so coming back
// (e.g. closing that tab with a shortcut) would show it highlighted.
// Let go of focus after mouse/touch clicks; keyboard focus still shows.
for (const link of landing.querySelectorAll<HTMLElement>("nav a, nav button")) {
  link.addEventListener("click", (e) => {
    if (e.detail > 0) link.blur(); // detail is 0 for keyboard-triggered clicks
  });
}

const emailBtn = document.querySelector<HTMLButtonElement>("#email")!;
emailBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(emailBtn.dataset.email ?? "");
  emailBtn.textContent = "Copied";
  setTimeout(() => (emailBtn.textContent = "Email"), 1500);
});

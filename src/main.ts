import * as THREE from "three";
import { Frog, type Surface } from "./frog";
import { Pond, type PoolShape } from "./pond";
import { DitherPass } from "./dither";
import "./style.css";
import "./page";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// A flat, front-on view, like looking into a terrarium. World units are CSS
// pixels with y up: screen point (x, y) is world (x, -y), so the screen's top
// left corner is the origin. The scene is fixed to the screen, so the frog
// comes along as you scroll: the floor and walls are the screen's edges, and
// the things on the page it can perch on slide past with the page.
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

let surfaces: Surface[] = [];
let frogLength = 1;
// Frogs rarely leap far: at most about three body lengths.
const frog = new Frog({
  surfaces: () => surfaces,
  reach: () => frogLength * 3,
  scale: () => Math.min(window.innerWidth, window.innerHeight),
  blocked: (c, r) => textBoxes.some((b) => circleHitsBox(c, r, b)),
});

// The text the frog must never overlap (screen rects, in CSS px).
let textBoxes: DOMRect[] = [];
const textEls = [...document.querySelectorAll<HTMLElement>("#hero h1, #hero .tagline, #hero nav")];
let heroText: DOMRect[] = []; // the same, in page coordinates
/** An element's box in page coordinates, so scrolling doesn't move it. */
function pageRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left + window.scrollX, r.top + window.scrollY, r.width, r.height);
}
/** A circle around world point `c` against a screen rect. */
function circleHitsBox(c: THREE.Vector3, r: number, b: DOMRect) {
  const x = c.x;
  const y = -c.y; // world y is up; screen y is down
  const dx = x - THREE.MathUtils.clamp(x, b.left, b.right);
  const dy = y - THREE.MathUtils.clamp(y, b.top, b.bottom);
  return dx * dx + dy * dy < r * r;
}
scene.add(frog.root);
const frogReady = frog.load();
// For poking at its behavior from the console while developing.
if (import.meta.env.DEV) Object.assign(window, { frog });

const hero = document.querySelector<HTMLElement>("#hero")!;
const nameEl = hero.querySelector<HTMLElement>("h1")!;
const topbar = document.querySelector<HTMLElement>("#topbar")!;
// Further down the page: the tops of the boxes between the text, where
// there's room above for a frog to sit.
const perchEls: [string, HTMLElement | null][] = [
  ["edu", document.querySelector(".edu")],
  ["projects", document.querySelector(".projects")],
  ["skills", document.querySelector(".skills")],
  ["contact", document.querySelector(".contact-links")],
  ["footer", document.querySelector(".content footer")],
];

/** A ledge along the top of an element (page coordinates), e.g. the frog sitting on your name. */
function topOf(id: string, el: HTMLElement): Surface {
  const r = pageRect(el);
  return { id, a: toWorld(r.left, r.top), b: toWorld(r.right, r.top), normal: UP };
}

/**
 * Everything on the page the frog can perch on, in page coordinates: the top
 * of the name, two invisible ledges between the name and the pond, and the
 * boxes further down.
 */
function buildPerches(w: number, frogLength: number, pool: PoolShape): Surface[] {
  const out: Surface[] = [topOf("name", nameEl)];

  const pondBottom = pool.cy + pool.ry;
  const name = pageRect(nameEl);
  const gap = name.top - pondBottom;
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
    const width = frogLength * 2;
    const off = frogLength * 1.2;
    const left = Math.max(w * 0.03, name.left - off - width);
    const right = Math.min(w * 0.97 - width, name.right + off);
    out.push(
      { id: "ledge-left", a: toWorld(left, name.top), b: toWorld(left + width, name.top), normal: UP },
      { id: "ledge-right", a: toWorld(right, name.top), b: toWorld(right + width, name.top), normal: UP },
    );
  }
  for (const [id, el] of perchEls) if (el) out.push(topOf(id, el));
  return out;
}

let perches: Surface[] = [];
let laidOut = { w: 0, h: 0 };
let syncedScroll = NaN;

/**
 * Rebuilds the frog's world for where the page is scrolled to: the screen's
 * floor and walls, plus the perches shifted up the screen by the scroll.
 * Perches too close to the top or bottom edge are still tracked (so a frog
 * sitting on one rides along) but marked hidden, so it won't head for them.
 */
function syncScroll(force = false) {
  const y = window.scrollY;
  if (!force && y === syncedScroll) return;
  syncedScroll = y;
  const { w, h } = laidOut;
  const floor = h - 1;
  const wallTop = h * 0.06;
  const shift = new THREE.Vector3(0, y, 0); // page to screen, in world units (y up)
  const ceiling = Math.max(0, topbar.getBoundingClientRect().bottom) + frogLength * 0.6;
  surfaces = [
    { id: "floor", a: toWorld(0, floor), b: toWorld(w, floor), normal: UP },
    // Walls run bottom to top, so "forward" on them is climbing.
    { id: "wall-left", a: toWorld(0, floor), b: toWorld(0, wallTop), normal: new THREE.Vector3(1, 0, 0) },
    { id: "wall-right", a: toWorld(w, floor), b: toWorld(w, wallTop), normal: new THREE.Vector3(-1, 0, 0) },
    ...perches.map((p) => {
      const top = -p.a.y - y;
      return { ...p, a: p.a.clone().add(shift), b: p.b.clone().add(shift), hidden: top < ceiling || top > h - frogLength * 0.8 };
    }),
  ];
  textBoxes = heroText.map((r) => new DOMRect(r.x, r.y - y, r.width, r.height));
  pond.setScroll(y);
  frog.refresh();
}

function layout() {
  const { innerWidth: w, innerHeight: h } = window;
  laidOut = { w, h };
  hero.style.height = `${h}px`;
  canvas.style.height = `${h}px`;
  renderer.setSize(w, h, false);
  camera.left = 0;
  camera.right = w;
  camera.top = 0;
  camera.bottom = -h;
  camera.updateProjectionMatrix();
  dither.setSize();

  frogLength = THREE.MathUtils.clamp(Math.min(w, h) * 0.2, 70, 150);
  frog.setLength(frogLength);

  // The pond: a faint oval in the hero's background, a little above the middle.
  const rx = Math.min(w * 0.38, 400);
  const pool: PoolShape = { cx: w / 2, cy: h * 0.42, rx, ry: rx * 0.2 };
  pond.setPool(pool);

  heroText = textEls.map(pageRect);
  perches = buildPerches(w, frogLength, pool);
  syncScroll(true);
}
window.addEventListener("resize", () => {
  // Phone browsers resize the viewport as their address bar slides in and out
  // while scrolling. Relaying out then would jolt the hero and the page under
  // it, so only a width change or a big height change counts.
  const { innerWidth: w, innerHeight: h } = window;
  if (w !== laidOut.w || Math.abs(h - laidOut.h) > 150) layout();
});
layout();
// Text positions shift once the web font arrives.
document.fonts.ready.then(layout);

// Start as a still little blob sitting on top of the name.
{
  const name = surfaces.find((s) => s.id === "name")!;
  frog.placeOn(name, name.a.distanceTo(name.b) * 0.5, 1);
}

/** Somewhere in view to leap to when its perch scrolls away: the nearest perch, or the floor. */
function landingSpot() {
  const at = frog.root.position;
  let best = surfaces.find((s) => s.id === "floor")!;
  let bestDist = Infinity;
  for (const s of surfaces) {
    if (s.hidden || s.id.startsWith("wall")) continue;
    const x = THREE.MathUtils.clamp(at.x, Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x));
    const d = Math.hypot(x - at.x, s.a.y - at.y);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

// Too distracting? Click the frog and it leaps up off the screen, back home
// to the pond, and waits there: it only follows you again once you've
// scrolled back up to it. (Up at the pond already, it just hops onto your
// name, or off it to a ledge.)
let stayHome = false;
function hitsFrog(x: number, y: number) {
  if (!frog.perch) return false;
  const box = new THREE.Box3().setFromObject(frog.root).expandByScalar(frogLength * 0.1);
  return x >= box.min.x && x <= box.max.x && -y >= box.min.y && -y <= box.max.y;
}
window.addEventListener(
  "click",
  (e) => {
    if (!hitsFrog(e.clientX, e.clientY)) return;
    // It's sitting over the page: don't also follow a link under it.
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove("over-frog");
    goHome();
  },
  true,
);
window.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") document.body.classList.toggle("over-frog", !stayHome && hitsFrog(e.clientX, e.clientY));
});
function goHome() {
  const name = surfaces.find((s) => s.id === "name")!;
  if (name.hidden) {
    stayHome = true;
    return frog.leapTo(name);
  }
  const home = surfaces.filter((s) => (s.id === "name" || s.id.startsWith("ledge")) && !s.hidden && s.id !== frog.perch?.id);
  const pick = frog.perch?.id !== "name" ? name : home[Math.floor(Math.random() * home.length)];
  if (pick) frog.leapTo(pick);
}

// Hold the scene back until the frog has loaded, so the pond and the frog
// appear together rather than the frog popping in afterwards.
frogReady.then(() => {
  const clock = new THREE.Clock();
  const step = (dt: number) => {
    syncScroll();
    // Sent home: once you're back up at the pond, it's free to follow again.
    if (stayHome && !frog.perch?.hidden) stayHome = false;
    // Its perch is scrolling off the screen: it leaps after you.
    if (!stayHome && frog.perch?.hidden && !frog.airborne) frog.leapTo(landingSpot());
    // Home and out of sight: it waits there, still, until you come back.
    if (!stayHome || frog.airborne || !frog.perch?.hidden) frog.update(dt);
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
for (const link of document.querySelectorAll<HTMLElement>("#hero nav a, #hero nav button")) {
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

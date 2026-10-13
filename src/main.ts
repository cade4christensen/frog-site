import * as THREE from "three";
import { Frog, type Surface } from "./frog";
import { Pond, type PoolShape } from "./pond";
import { DitherPass } from "./dither";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// A flat, front-on view, like looking into a terrarium. World units are CSS
// pixels with y up: screen point (x, y) is world (x, -y), so the page's top
// left corner is the origin.
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
const textEls = [...document.querySelectorAll<HTMLElement>("h1, .tagline, nav")];
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

const nameEl = document.querySelector<HTMLElement>("h1")!;

/** A ledge along the top of an element, e.g. the frog sitting on your name. */
function topOf(id: string, el: HTMLElement): Surface {
  const r = el.getBoundingClientRect();
  return { id, a: toWorld(r.left, r.top), b: toWorld(r.right, r.top), normal: UP };
}

/**
 * Everything the frog can stand on: the floor, both side walls, the top of
 * the name, and two invisible ledges between the name and the pond.
 */
function buildSurfaces(w: number, h: number, frogLength: number, pool: PoolShape): Surface[] {
  const floor = h - 1;
  const wallTop = h * 0.06;
  const out: Surface[] = [
    { id: "floor", a: toWorld(0, floor), b: toWorld(w, floor), normal: UP },
    // Walls run bottom to top, so "forward" on them is climbing.
    { id: "wall-left", a: toWorld(0, floor), b: toWorld(0, wallTop), normal: new THREE.Vector3(1, 0, 0) },
    { id: "wall-right", a: toWorld(w, floor), b: toWorld(w, wallTop), normal: new THREE.Vector3(-1, 0, 0) },
    // Only the name: anything below it would put the frog over the other text.
    topOf("name", nameEl),
  ];

  const pondBottom = pool.cy + pool.ry;
  const nameTop = nameEl.getBoundingClientRect().top;
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
    const name = nameEl.getBoundingClientRect();
    const width = frogLength * 2;
    const off = frogLength * 1.2;
    const left = Math.max(w * 0.03, name.left - off - width);
    const right = Math.min(w * 0.97 - width, name.right + off);
    out.push(
      { id: "ledge-left", a: toWorld(left, name.top), b: toWorld(left + width, name.top), normal: UP },
      { id: "ledge-right", a: toWorld(right, name.top), b: toWorld(right + width, name.top), normal: UP },
    );
  }
  return out;
}

function layout() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h, false);
  camera.left = 0;
  camera.right = w;
  camera.top = 0;
  camera.bottom = -h;
  camera.updateProjectionMatrix();
  dither.setSize();

  frogLength = THREE.MathUtils.clamp(Math.min(w, h) * 0.2, 70, 150);
  frog.setLength(frogLength);

  // The pond: a faint oval in the background, a little above the middle.
  const rx = Math.min(w * 0.38, 400);
  const pool: PoolShape = { cx: w / 2, cy: h * 0.42, rx, ry: rx * 0.2 };
  pond.setPool(pool);

  textBoxes = textEls.map((el) => el.getBoundingClientRect());
  surfaces = buildSurfaces(w, h, frogLength, pool);
  frog.refresh();
}
window.addEventListener("resize", layout);
layout();
// Text positions shift once the web font arrives.
document.fonts.ready.then(layout);

// Start as a still little blob sitting on top of the name.
{
  const name = surfaces.find((s) => s.id === "name")!;
  frog.placeOn(name, name.a.distanceTo(name.b) * 0.5, 1);
}

window.addEventListener("pointerdown", (e) => frog.poke(toWorld(e.clientX, e.clientY)));

// Hold the scene back until the frog has loaded, so the pond and the frog
// appear together rather than the frog popping in afterwards.
frogReady.then(() => {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    frog.update(dt);
    pond.update(dt);
    dither.render(scene, camera);
  });
});

// A clicked link opens in a new tab but keeps focus here, so coming back
// (e.g. closing that tab with a shortcut) would show it highlighted.
// Let go of focus after mouse/touch clicks; keyboard focus still shows.
for (const link of document.querySelectorAll<HTMLElement>("nav a, nav button")) {
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

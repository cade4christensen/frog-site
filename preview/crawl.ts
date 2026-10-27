// Dev-only page for looking at a work-in-progress clip from ChatGPT's
// Blender scene (preview/turn.glb) on its own. Not part of the site build.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { armsOf, poseArms, unwindArms, ELBOW_LIFT } from "../src/frog";

const canvas = document.querySelector<HTMLCanvasElement>("#c")!;
const ui = document.querySelector<HTMLDivElement>("#ui")!;
const info = document.querySelector<HTMLDivElement>("#info")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040b08);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(-0.4, 0.8, 1);
scene.add(key);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

const views = {
  "Side (like the site)": new THREE.Vector3(Math.sin(0.44), 0.18, Math.cos(0.44)),
  "Three-quarter": new THREE.Vector3(0.7, 0.6, 0.7),
  "From above": new THREE.Vector3(0, 1, 0.001),
};
let view = views["Side (like the site)"];
let size = 1;
const center = new THREE.Vector3();

function place() {
  camera.position.copy(center).addScaledVector(view.clone().normalize(), size * 3.2);
  camera.lookAt(center);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const gltf = await new GLTFLoader().loadAsync(new URLSearchParams(location.search).get("model") ?? "/models/frog.glb");
const model = gltf.scene;
model.traverse((o) => {
  if (o.name.startsWith("Original scan") || (o as THREE.Light).isLight || (o as THREE.Camera).isCamera) o.visible = false;
});
scene.add(model);
const box = new THREE.Box3().setFromObject(model, true);
size = box.getSize(new THREE.Vector3()).length();
box.getCenter(center);
const grid = new THREE.GridHelper(size * 4, 16, 0x22352b, 0x13201a);
grid.position.y = box.min.y;
scene.add(grid);
place();

const mixer = new THREE.AnimationMixer(model);
const clips = gltf.animations.filter((c) => !/breathing/i.test(c.name));
// The site's fix for the turns' windmilling front legs (add ?raw to see them as exported).
if (!new URLSearchParams(location.search).has("raw")) for (const c of clips) if (/turn/i.test(c.name)) unwindArms(model, c);
let action: THREE.AnimationAction | null = null;
let pauseLeft = 0;
let speed = 1;

const buttons = new Map<string, HTMLButtonElement>();
function button(label: string, group: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.dataset.group = group;
  b.onclick = () => {
    for (const other of ui.querySelectorAll<HTMLButtonElement>(`button[data-group="${group}"]`)) other.classList.remove("on");
    b.classList.add("on");
    onClick();
  };
  ui.append(b);
  buttons.set(group + label, b);
  return b;
}

function play(clip: THREE.AnimationClip) {
  mixer.stopAllAction();
  action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.reset().play();
  pauseLeft = 0;
}
for (const clip of clips) button(clip.name, "clip", () => play(clip));
for (const [label, v] of Object.entries(views)) button(label, "view", () => ((view = v), place()));
for (const s of [0.5, 1]) button(`${s}x`, "speed", () => (speed = s));
// The site's crawl fixes: the "in" arm tucked closer, elbows lifted off the ground (see poseArms).
const arms = armsOf(model);
let elbows = true;
let unlift: (() => void) | undefined;
button("Arm fixes on", "elbows", () => (elbows = true));
button("Arm fixes off", "elbows", () => (elbows = false));
buttons.get("clipCrawling")?.click();
buttons.get("viewSide (like the site)")?.click();
buttons.get("speed1x")?.click();
buttons.get("elbowsArm fixes on")?.click();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1) * speed;
  if (action) {
    const clip = action.getClip();
    // Hold the last pose for a moment, then play it again.
    if (action.time >= clip.duration - 1e-3) {
      if ((pauseLeft += dt) > 0.8) action.reset().play(), (pauseLeft = 0);
    }
    info.textContent = `${clip.name} · ${action.time.toFixed(2)} / ${clip.duration.toFixed(2)}s`;
  }
  unlift?.();
  unlift = undefined;
  mixer.update(dt);
  if (elbows && action?.getClip().name === "Crawling") {
    model.updateMatrixWorld(true);
    const forward = model.getObjectByName("head")!.getWorldPosition(new THREE.Vector3()).sub(model.getObjectByName("body")!.getWorldPosition(new THREE.Vector3()));
    unlift = poseArms(arms, new THREE.Vector3(0, 1, 0), forward, ELBOW_LIFT, 1);
  }
  renderer.render(scene, camera);
});

// For stepping through by hand from the console: show("Turn 90", 1.4).
Object.assign(window, {
  show(name: string, t: number) {
    const clip = clips.find((c) => c.name === name);
    if (!clip) return;
    play(clip);
    action!.time = t;
    speed = 0;
  },
});

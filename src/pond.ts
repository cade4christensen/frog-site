/**
 * The pool in the middle of the page: its water and rim, ripples where you
 * click it, lily pads, reeds at either end, and a few fireflies drifting up (some off the
 * water, some from the ground around it). Drawn at dot-grid resolution into an offscreen canvas that
 * DitherPass turns into dots, so it matches the frog.
 * Channels: red = rim, ripples and fireflies; green = water.
 */

type Ripple = { x: number; y: number; age: number; life: number; size: number; strength: number };
type LilyPad = { x: number; y: number; size: number; notch: number; phase: number; flower: boolean };
type Reed = { at: number; height: number; lean: number; phase: number; head: boolean };
type Firefly = { x: number; y: number; age: number; life: number; roam: number; speed: number; phase: number };
/** The pool as it appears on screen (CSS px): an ellipse. */
export type PoolShape = { cx: number; cy: number; rx: number; ry: number };

// Ripples are squashed vertically so the water reads as a flat surface.
const SQUASH = 0.36;
const FIREFLY_FADE = 2.5; // seconds to fade in, and to fade out
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const FIREFLY_COUNT = 9;
const WAKE_SPACING = 16; // px the pointer travels through the water between wake ripples

export class Pond {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  private w = 0;
  private h = 0;
  private ripples: Ripple[] = [];
  private fireflies: Firefly[] = [];
  private time = 0;
  private pool: PoolShape = { cx: 0, cy: 0, rx: 0, ry: 0 };
  // A clump of reeds at each end of the pond; `at` is -1 (left) or 1 (right)
  // plus a little scatter, in units of the pond's half-width.
  private reeds: Reed[] = [];
  // Lily pads floating on the water; x, y in units of the pond's radii.
  private pads: LilyPad[] = [];

  constructor() {
    window.addEventListener("pointerdown", (e) => {
      if (this.inPool(e.clientX, e.clientY)) this.addRipple(e.clientX, e.clientY, this.pool.rx * 0.9, 1);
    });
    window.addEventListener("pointermove", (e) => this.trail(e.clientX, e.clientY, e.timeStamp));
  }

  // Where the pointer last left a wake ripple, so a drag leaves an evenly spaced trail.
  private lastWake: { x: number; y: number; t: number } | null = null;

  /** Dragging the pointer through the water leaves a wake; faster drags make bigger rings. */
  private trail(x: number, y: number, t: number) {
    if (!this.inPool(x, y)) {
      this.lastWake = null;
      return;
    }
    const last = this.lastWake;
    if (!last) {
      this.lastWake = { x, y, t };
      return;
    }
    const dist = Math.hypot(x - last.x, y - last.y);
    if (dist < WAKE_SPACING) return;
    const speed = dist / Math.max(t - last.t, 1); // px per ms
    const k = clamp01(speed / 1.5);
    this.addRipple(x, y, this.pool.rx * (0.12 + 0.2 * k), 0.35 + 0.4 * k);
    this.lastWake = { x, y, t };
  }

  setPool(pool: PoolShape) {
    this.pool = pool;
    if (!this.pads.length) {
      // Spread out across the water, never quite touching the rim.
      const slots = [-0.55, -0.15, 0.25, 0.6];
      for (const [i, x] of slots.entries()) {
        this.pads.push({
          x: x + (Math.random() - 0.5) * 0.15,
          y: (Math.random() - 0.5) * 0.3, // near the middle so taller pads aren't clipped by the rim
          size: 0.11 + Math.random() * 0.07, // in pond widths (rx)
          notch: Math.random() * Math.PI * 2,
          phase: Math.random() * Math.PI * 2,
          flower: i === 1 || (i === 3 && Math.random() < 0.5),
        });
      }
    }
    if (!this.reeds.length) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          this.reeds.push({
            at: side * (0.82 + Math.random() * 0.3),
            height: 1.8 + Math.random() * 2.2, // in pond depths (ry)
            lean: side * (0.05 + Math.random() * 0.25),
            phase: Math.random() * Math.PI * 2,
            head: Math.random() < 0.5, // some have cattail heads
          });
        }
      }
    }
  }

  private inPool(x: number, y: number) {
    const { cx, cy, rx, ry } = this.pool;
    return rx > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  }

  /** A random point on the water, kept a little in from the rim. */
  private randomInPool() {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 0.85;
    return { x: this.pool.cx + Math.cos(a) * r * this.pool.rx, y: this.pool.cy + Math.sin(a) * r * this.pool.ry };
  }

  /** Match the dot grid: one canvas pixel per dot cell. Drawing stays in CSS px. */
  setSize(gridW: number, gridH: number) {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = gridW;
    this.canvas.height = gridH;
    this.ctx.setTransform(gridW / this.w, 0, 0, gridH / this.h, 0, 0);
  }

  update(dt: number) {
    this.time += dt;
    const { ctx, w, h } = this;

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    // Additive so the red and green channels stay independent.
    ctx.globalCompositeOperation = "lighter";

    // Water and ripples stay inside the pool.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(this.pool.cx, this.pool.cy, this.pool.rx, this.pool.ry, 0, 0, Math.PI * 2);
    ctx.clip();
    this.drawWater();
    this.drawPads();
    this.drawRipples(dt);
    ctx.restore();
    this.drawRim();
    this.drawReeds();
    this.drawFireflies(dt);
  }

  /** Ripple at a screen point (CSS px). */
  addRipple(x: number, y: number, size: number, strength: number) {
    this.ripples.push({ x, y, age: 0, life: 2.2 + size / 160, size, strength });
    if (this.ripples.length > 120) this.ripples.shift();
  }

  private drawWater() {
    const { ctx } = this;
    const { cx, cy, rx, ry } = this.pool;
    // Deeper (denser dots) toward the middle, as an ellipse to match the pool.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, "rgb(0, 60, 0)");
    g.addColorStop(1, "rgb(0, 30, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  }

  private drawRim() {
    const { ctx } = this;
    const { cx, cy, rx, ry } = this.pool;
    ctx.lineWidth = (this.w / this.canvas.width) * 1.1;
    ctx.strokeStyle = "rgb(35, 0, 0)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawRipples(dt: number) {
    const { ctx, ripples } = this;
    // At least one dot wide whatever the grid size.
    ctx.lineWidth = (this.w / this.canvas.width) * 1.1;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      // Ease out so rings slow as they spread, and fade as they grow.
      const ease = 1 - Math.pow(1 - t, 3);
      const fade = (1 - t) * (1 - t) * r.strength;
      // Two rings per ripple; the inner one trails slightly.
      for (const [offset, alpha] of [[0, 1], [0.18, 0.55]] as const) {
        const radius = Math.max(r.size * (ease - offset), 0);
        if (radius <= 0) continue;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, radius, radius * SQUASH, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgb(${Math.round(255 * fade * alpha)}, 0, 0)`;
        ctx.stroke();
      }
    }
  }

  /** Lily pads: flat ovals with a wedge cut out, bobbing gently on the water. */
  private drawPads() {
    const { ctx } = this;
    const { cx, cy, rx, ry } = this.pool;
    ctx.lineWidth = (this.w / this.canvas.width) * 1.1;
    for (const pad of this.pads) {
      const bob = this.reduceMotion ? 0 : Math.sin(this.time * 0.8 + pad.phase) * ry * 0.04;
      const x = cx + pad.x * rx;
      const y = cy + pad.y * ry + bob;
      const w = pad.size * rx;
      // Tilted a little toward the viewer, so rounder than the pond's own angle.
      const h = w * 0.5;
      const turn = this.reduceMotion ? 0 : Math.sin(this.time * 0.15 + pad.phase) * 0.15;
      const gap = 0.35; // half-width of the notch, radians
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.ellipse(x, y, w, h, 0, pad.notch + turn + gap, pad.notch + turn - gap + Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = "rgb(55, 0, 0)";
      ctx.fill();
      ctx.strokeStyle = "rgb(95, 0, 0)";
      ctx.stroke();
      if (pad.flower) {
        // A small bloom sitting on the pad.
        ctx.beginPath();
        ctx.ellipse(x - w * 0.2, y - h * 0.6, w * 0.22, h * 0.7, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgb(140, 0, 0)";
        ctx.fill();
      }
    }
  }

  /** Reeds growing at both ends of the pond, swaying a little. */
  private drawReeds() {
    const { ctx } = this;
    const { cx, cy, rx, ry } = this.pool;
    if (rx <= 0) return;
    ctx.lineWidth = (this.w / this.canvas.width) * 1.1;
    ctx.strokeStyle = ctx.fillStyle = "rgb(70, 0, 0)";
    for (const r of this.reeds) {
      const baseX = cx + r.at * rx;
      const baseY = cy + ry * 0.3;
      const h = r.height * ry;
      const sway = this.reduceMotion ? 0 : Math.sin(this.time * 0.6 + r.phase) * h * 0.04;
      const tipX = baseX + (r.lean * h) + sway;
      const tipY = baseY - h;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(baseX + r.lean * h * 0.2, baseY - h * 0.6, tipX, tipY);
      ctx.stroke();
      if (r.head) {
        // A cattail: a fat little oval just below the tip.
        const hx = baseX + (tipX - baseX) * 0.85;
        const hy = baseY - h * 0.85;
        ctx.beginPath();
        ctx.ellipse(hx, hy, ry * 0.12, ry * 0.35, Math.atan2(tipX - baseX, baseY - tipY), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Fireflies blink into being, hover and wander around a spot, then fade away. */
  private drawFireflies(dt: number) {
    const { ctx } = this;
    if (this.pool.rx <= 0) return;
    while (this.fireflies.length < FIREFLY_COUNT) {
      // Around the pond: over the water and just above it, up to about reed height.
      const { cx, cy, rx, ry } = this.pool;
      const p = { x: cx + (Math.random() * 2 - 1) * rx * 1.15, y: cy + ry * 0.5 - Math.random() * ry * 4 };
      this.fireflies.push({
        ...p,
        // Stagger the first batch so they don't all appear together.
        age: this.time < 1 ? -Math.random() * 14 : 0,
        life: 12 + Math.random() * 8,
        roam: 14 + Math.random() * 22, // how far it wanders from its spot (px)
        speed: 0.12 + Math.random() * 0.15,
        phase: Math.random() * Math.PI * 2,
      });
    }
    for (let i = this.fireflies.length - 1; i >= 0; i--) {
      const f = this.fireflies[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.fireflies.splice(i, 1);
        continue;
      }
      if (f.age < 0) continue;
      // Lazy, looping wander: two out-of-step waves per axis so the path
      // never quite repeats, with just a faint upward drift.
      const t = f.age * f.speed;
      const x = f.x + f.roam * (Math.sin(t * 1.3 + f.phase) * 0.7 + Math.sin(t * 2.9 + f.phase * 2) * 0.3);
      const y = f.y + f.roam * 0.6 * (Math.cos(t * 1.7 + f.phase) * 0.7 + Math.sin(t * 3.4 + f.phase * 3) * 0.3) - f.age * 2;
      // Fade in at the start and out at the end (~2.5s each), and in between
      // glow up and dim down slowly a few times, like a real firefly.
      const ramp = (v: number) => {
        const c = clamp01(v / FIREFLY_FADE);
        return c * c * (3 - 2 * c);
      };
      const envelope = Math.min(ramp(f.age), ramp(f.life - f.age));
      const pulse = this.reduceMotion ? 1 : 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(f.age * 1.1 + f.phase));
      const glow = envelope * pulse;
      if (glow < 0.02) continue;

      // The glow swells with its brightness so the fade shows in the dots.
      const radius = 4 + 6 * glow;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgb(${Math.round(150 * glow)}, 0, 0)`);
      g.addColorStop(0.35, `rgb(${Math.round(60 * glow)}, 0, 0)`);
      g.addColorStop(1, "rgb(0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }
}

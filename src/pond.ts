/**
 * The pool in the middle of the page: its water and rim, ripples where you
 * click it, lily pads, reeds at either end, and a few fireflies drifting up (some off the
 * water, some from the ground around it). Drawn at dot-grid resolution into an offscreen canvas that
 * DitherPass turns into dots, so it matches the frog.
 * Channels: red = rim, ripples and fireflies; green = water.
 */

type Ripple = { x: number; y: number; age: number; life: number; size: number; strength: number };
/** A pad: `x`, `y` in units of the pond's radii, `size` in pond widths; its `look` sets it apart. */
type LilyPad = {
  x: number;
  y: number;
  size: number;
  notch: number;
  phase: number;
  look: PadLook;
  // Pushed about by ripples: how far it has drifted from its spot (px) and how fast.
  ox: number;
  oy: number;
  vx: number;
  vy: number;
};
type PadLook = "plain" | "veined" | "flower" | "nibbled";
type Reed = { at: number; height: number; lean: number; phase: number; head: boolean };
/** A tuft of grass on the bank: `angle` round the pool, a few short blades. */
type Tuft = { angle: number; out: number; blades: { lean: number; height: number }[]; phase: number };
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
  // Grass along the bank all the way round, thicker at the back.
  private tufts: Tuft[] = [];

  constructor() {
    // Pointer positions are viewport px; the pond lives in page px.
    window.addEventListener("pointerdown", (e) => {
      const x = e.clientX + window.scrollX;
      const y = e.clientY + window.scrollY;
      if (this.inPool(x, y)) this.addRipple(x, y, this.pool.rx * 0.9, 1);
    });
    window.addEventListener("pointermove", (e) => this.trail(e.clientX + window.scrollX, e.clientY + window.scrollY, e.timeStamp));
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
      // A handful of pads of quite different sizes, dropped onto the water
      // wherever they fit without touching each other or the rim.
      const looks: PadLook[] = ["flower", "veined", "nibbled", "plain", "veined", "plain"];
      const want = 5 + Math.floor(Math.random() * 2);
      const { rx, ry } = pool;
      for (let i = 0; i < want; i++) {
        const size = i === 0 ? 0.2 + Math.random() * 0.05 : 0.06 + Math.random() * 0.12;
        const w = size * rx; // half-width in px; half-height is w / 2
        for (let tries = 0; tries < 40; tries++) {
          const x = (Math.random() * 2 - 1) * 0.8;
          const y = (Math.random() * 2 - 1) * 0.5;
          // Inside the water, pad included.
          if (((Math.abs(x) * rx + w) / rx) ** 2 + ((Math.abs(y) * ry + w * 0.5) / ry) ** 2 > 0.92) continue;
          const clash = this.pads.some((p) => {
            const pw = p.size * rx;
            const dx = (p.x - x) * rx;
            const dy = (p.y - y) * ry;
            const gap = 1.25; // a little water showing between pads
            return (dx / ((pw + w) * gap)) ** 2 + (dy / ((pw + w) * 0.5 * gap)) ** 2 < 1;
          });
          if (clash) continue;
          this.pads.push({ x, y, size, notch: Math.random() * Math.PI * 2, phase: Math.random() * Math.PI * 2, look: looks[i], ox: 0, oy: 0, vx: 0, vy: 0 });
          break;
        }
      }
    }
    if (!this.tufts.length) {
      // Two rings of tufts: one hugging the rim, one a little further out, so
      // the bank reads as a thick fringe rather than a row of blades.
      const count = 120;
      for (let i = 0; i < count; i++) {
        const angle = ((i + Math.random() * 0.8) / count) * Math.PI * 2;
        // Shorter tufts along the front edge so they don't hide the water.
        const front = Math.sin(angle) > 0 ? Math.sin(angle) : 0;
        if (front > 0.35 && Math.random() < 0.5) continue;
        const n = 3 + Math.floor(Math.random() * 3);
        const tall = 1 - front * 0.75;
        this.tufts.push({
          angle,
          out: (i % 2 ? 0.97 : 1.04) + Math.random() * 0.08, // on the rim or just beyond, in units of the radii
          blades: Array.from({ length: n }, (_, k) => ({
            // A narrow fan: blades stand nearly upright, just splayed enough to read as a tuft.
            lean: ((k - (n - 1) / 2) * 0.14 + (Math.random() - 0.5) * 0.08),
            height: (0.3 + Math.random() * 0.7) * tall, // in pond depths (ry)
          })),
          phase: Math.random() * Math.PI * 2,
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
    // Everything below is in page px: scroll it with the page.
    ctx.save();
    ctx.translate(-window.scrollX, -window.scrollY);

    // Water and ripples stay inside the pool.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(this.pool.cx, this.pool.cy, this.pool.rx, this.pool.ry, 0, 0, Math.PI * 2);
    ctx.clip();
    this.drawWater();
    this.drawRipples(dt);
    this.movePads(dt);
    this.drawPads(); // on top: rings pass under the pads
    ctx.restore();
    this.drawRim();
    this.drawGrass();
    this.drawReeds();
    this.drawFireflies(dt);
    ctx.restore();
  }

  /** Ripple at a page point (CSS px). It also shoves any pad it reaches. */
  addRipple(x: number, y: number, size: number, strength: number) {
    this.ripples.push({ x, y, age: 0, life: 2.2 + size / 160, size, strength });
    if (this.ripples.length > 120) this.ripples.shift();
    if (this.reduceMotion) return;
    const { cx, cy, rx, ry } = this.pool;
    for (const pad of this.pads) {
      const px = cx + pad.x * rx + pad.ox;
      const py = cy + pad.y * ry + pad.oy;
      const dx = px - x;
      const dy = (py - y) / SQUASH; // the water is foreshortened: a ring reaches less far up and down
      const d = Math.hypot(dx, dy);
      const reach = size * 1.2;
      if (d < 1 || d > reach) continue;
      // Harder shoves close in, and small pads skitter further than big ones.
      const push = strength * 90 * (1 - d / reach) * (0.12 / pad.size);
      pad.vx += (dx / d) * push;
      pad.vy += (dy / d) * push * SQUASH;
    }
  }

  /** How far a pad can get from its spot: its stem, rooted in the floor below. */
  private tether(pad: LilyPad) {
    return pad.size * this.pool.rx * 1.3;
  }

  /**
   * Pads drift after a shove, slow down and nudge each other apart, but each
   * is on a stem: it pulls back harder the further the pad strays, and at
   * full stretch the pad can go no further.
   */
  private movePads(dt: number) {
    const { cx, cy, rx, ry } = this.pool;
    const drag = Math.exp(-dt * 1.6);
    for (const pad of this.pads) {
      const stem = this.tether(pad);
      const off = Math.hypot(pad.ox, pad.oy);
      // The stem's pull: gentle near home, firm as it nears full stretch.
      const pull = 0.6 + 3 * (off / stem) ** 2;
      pad.vx -= pad.ox * pull * dt;
      pad.vy -= pad.oy * pull * dt;
      pad.vx *= drag;
      pad.vy *= drag;
      pad.ox += pad.vx * dt;
      pad.oy += pad.vy * dt;
      // Taut: hold it there and drop any speed that was carrying it further out.
      const now = Math.hypot(pad.ox, pad.oy);
      if (now > stem) {
        const nx = pad.ox / now;
        const ny = pad.oy / now;
        pad.ox = nx * stem;
        pad.oy = ny * stem;
        const outward = pad.vx * nx + pad.vy * ny;
        if (outward > 0) {
          pad.vx -= outward * nx;
          pad.vy -= outward * ny;
        }
      }
      // Keep well inside the water.
      const px = (pad.x * rx + pad.ox) / (rx - pad.size * rx);
      const py = (pad.y * ry + pad.oy) / (ry - pad.size * rx * 0.5);
      const out = Math.hypot(px, py);
      if (out > 0.95) {
        pad.ox -= (px * (out - 0.95) * (rx - pad.size * rx)) / out;
        pad.oy -= (py * (out - 0.95) * (ry - pad.size * rx * 0.5)) / out;
        pad.vx *= 0.5;
        pad.vy *= 0.5;
      }
    }
    // Pads bump: push overlapping pairs apart.
    for (let i = 0; i < this.pads.length; i++) {
      for (let j = i + 1; j < this.pads.length; j++) {
        const a = this.pads[i];
        const b = this.pads[j];
        const w = (a.size + b.size) * rx * 1.15;
        const dx = (b.x - a.x) * rx + b.ox - a.ox;
        const dy = ((b.y - a.y) * ry + b.oy - a.oy) * 2; // pads are half as tall as wide
        const d = Math.hypot(dx, dy) || 1;
        if (d >= w) continue;
        const shove = ((w - d) / w) * 60 * dt;
        a.vx -= (dx / d) * shove;
        a.vy -= (dy / d) * shove * 0.5;
        b.vx += (dx / d) * shove;
        b.vy += (dy / d) * shove * 0.5;
      }
    }
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
    // Pads sit on the water, so they cover it (and any ripple) rather than adding to it.
    ctx.globalCompositeOperation = "source-over";
    for (const pad of this.pads) {
      const bob = this.reduceMotion ? 0 : Math.sin(this.time * 0.8 + pad.phase) * ry * 0.04;
      const x = cx + pad.x * rx + pad.ox;
      const y = cy + pad.y * ry + pad.oy + bob;
      // Pulled off its spot, the stem shows: a faint line from where it's rooted.
      if (Math.hypot(pad.ox, pad.oy) > 3) {
        ctx.beginPath();
        ctx.moveTo(cx + pad.x * rx, cy + pad.y * ry);
        ctx.lineTo(x, y);
        ctx.strokeStyle = "rgb(60, 0, 0)";
        ctx.stroke();
      }
      const w = pad.size * rx;
      // Tilted a little toward the viewer, so rounder than the pond's own angle.
      const h = w * 0.5;
      const turn = this.reduceMotion ? 0 : Math.sin(this.time * 0.15 + pad.phase) * 0.15;
      const gap = pad.look === "nibbled" ? 0.6 : 0.35; // half-width of the notch, radians
      const a0 = pad.notch + turn + gap;
      const a1 = pad.notch + turn - gap + Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.ellipse(x, y, w, h, 0, a0, a1);
      ctx.closePath();
      // Plain pads are a touch darker, so the veined ones read as lighter leaves.
      ctx.fillStyle = pad.look === "plain" ? "rgb(40, 0, 0)" : "rgb(55, 0, 0)";
      ctx.fill();
      ctx.strokeStyle = "rgb(95, 0, 0)";
      ctx.stroke();
      if (pad.look === "nibbled") {
        // A couple of bites out of the far edge.
        for (const k of [0.9, 1.6]) {
          const a = pad.notch + turn + Math.PI + k;
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * w, y + Math.sin(a) * h, w * 0.14, h * 0.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgb(0, 0, 0)";
          ctx.globalCompositeOperation = "source-over";
          ctx.fill();
        }
      }
      if (pad.look === "veined") {
        // Veins fanning out from the stem to the rim.
        ctx.strokeStyle = "rgb(120, 0, 0)";
        for (let k = 1; k <= 4; k++) {
          const a = a0 + ((a1 - a0) * k) / 5;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * w * 0.85, y + Math.sin(a) * h * 0.85);
          ctx.stroke();
        }
      }
      if (pad.look === "flower") {
        // A bloom sitting on the pad: a few petals round a bright middle.
        const fx = x - w * 0.15;
        const fy = y - h * 0.5;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + pad.phase;
          ctx.beginPath();
          ctx.ellipse(fx + Math.cos(a) * w * 0.16, fy + Math.sin(a) * h * 0.4, w * 0.13, h * 0.3, a, 0, Math.PI * 2);
          ctx.fillStyle = "rgb(110, 0, 0)";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(fx, fy, w * 0.1, h * 0.25, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgb(200, 0, 0)";
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "lighter";
  }

  /** Short grass all round the bank: little fans of blades leaning away from the water. */
  private drawGrass() {
    const { ctx } = this;
    const { cx, cy, rx, ry } = this.pool;
    if (rx <= 0) return;
    ctx.lineWidth = (this.w / this.canvas.width) * 1.1;
    ctx.strokeStyle = "rgb(60, 0, 0)";
    for (const t of this.tufts) {
      const baseX = cx + Math.cos(t.angle) * rx * t.out;
      const baseY = cy + Math.sin(t.angle) * ry * t.out;
      // Blades stand straight, tipping only slightly away from the water, with a faint sway.
      const outward = Math.cos(t.angle);
      const sway = this.reduceMotion ? 0 : Math.sin(this.time * 0.7 + t.phase) * 0.04;
      for (const b of t.blades) {
        const h = b.height * ry;
        const lean = outward * 0.1 + b.lean + sway;
        const tipX = baseX + lean * h;
        const tipY = baseY - h;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
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

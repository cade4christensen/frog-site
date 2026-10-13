import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL = "/models/frog.glb";
const FADE = 0.35; // seconds to blend between animations
// Stopping always tucks the legs in with Settle to rest, and moving off from a
// tuck unfolds with Wake and move. Awake stops tuck a little quicker than
// settling down to sleep.
const SETTLE_AWAKE_SPEED = 2.4;
const UNFOLD_SPEED = 2.2;
const CRAWL_ANIM_SPEED = 3.4; // playback rate of the Crawling clip; sets crawl speed
const FALLBACK_STRIDE = 0.25; // frog lengths per clip second if feet can't be measured
const LOOK_ANIM_SPEED = 1.3; // Looking around is a little slow as exported
const TURN_ANIM_SPEED = 1.5; // Turn around is slow as exported
// Jumping plays at different speeds per phase: a quick crouch, an airborne
// part so fast the frog nearly teleports, then a brisk landing.
const JUMP_CROUCH_SPEED = 2;
const JUMP_LAND_SPEED = 2.5;
// Jump distances are fractions of the page size (its shorter side), so leaps
// look as big on a large screen as on a phone.
const JUMP_MIN = 0.2; // shortest leap between surfaces
const HOP = [0.18, 0.35]; // a hop along a surface, min to max
const MID_HOP = [0.15, 0.25]; // a hop breaking up a crawl
const MIN_HOP_LENGTHS = 1.2; // ...but always at least this many frog lengths
// Frogs lunge straight at where they're going: the path barely rises, just
// enough (this fraction of the distance, capped) to clear the ground.
const JUMP_ARC = 0.03;
const JUMP_LIFT_MAX = 0.3; // frog lengths
// Turn the body this far toward the viewer so it isn't a flat profile.
const VIEW_YAW = (25 * Math.PI) / 180;
// While crawling a long way, the chance per second of breaking into a hop.
const HOP_CHANCE = 0.15;
// While crawling, the chance per second of stopping to look around before going on.
const PAUSE_CHANCE = 0.12;
// After arriving somewhere, the chance it carries straight on without stopping to look.
const KEEP_GOING = 0.55;
const STARTLE_RADIUS = 0.9; // clicks this close (in frog lengths) make it jump
// When nothing is within reach, it tries once more allowing a leap this much longer.
const LEAP_STRETCH = 1.6;
// Bone names (Three strips the dots Blender uses, e.g. hind.ankle.L).
const FEET = ["frontlowerL", "frontlowerR", "hindankleL", "hindankleR"];
const SAMPLES = 64;
const UP = new THREE.Vector3(0, 1, 0);

// The frog's day: rest, wake up, look around, then crawl along whatever it's
// on, turn around, or leap to another surface; now and then settle to rest.
type State =
  | "resting"
  | "waking"
  | "crawling"
  | "turning"
  | "jumping"
  | "looking"
  | "settling";

// Clip names as exported from Blender. One-shot clips play once and hold
// their last pose; the rest loop.
const CLIPS = {
  rest: "Resting",
  wake: "Wake and move",
  crawl: "Crawling",
  turn: "Turn around",
  jump: "Jumping",
  alert: "Alert idle",
  look: "Looking around",
  settle: "Settle to rest",
  // On a wall it only ever uses these, authored against the wall.
  wallCling: "Wall cling",
  wallClimb: "Wall climbing",
  wallLook: "Wall looking around",
  breathe: "Idle", // shape keys only (breathing, throat); always layered on
} as const;
type ClipKey = keyof typeof CLIPS;
const ONE_SHOT = new Set<ClipKey>(["wake", "settle", "turn", "jump", "look", "wallLook"]);
const WALL_LOOK_CHANCE = 0.45; // pausing on a wall: chance it looks around rather than just clinging

/**
 * Something the frog can sit on: a straight edge from `a` to `b` (world
 * units, y up) with `normal` pointing away from it, e.g. up for a floor.
 */
export interface Surface {
  id: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  normal: THREE.Vector3;
}

/** What the frog needs to know about the page it lives on. */
export interface World {
  surfaces(): Surface[];
  /** The farthest the frog will leap, in world units. */
  reach(): number;
  /** The page's size (its shorter side, world units); jump distances scale with it. */
  scale(): number;
  /** Whether a circle (the frog's body) would overlap something it must avoid, like text. */
  blocked(center: THREE.Vector3, radius: number): boolean;
}

const tangentOf = (s: Surface) => new THREE.Vector3().subVectors(s.b, s.a).normalize();
const lengthOf = (s: Surface) => s.a.distanceTo(s.b);

/**
 * Loads the frog model (made in Blender) and runs its behavior in a flat,
 * side-on world of surfaces. The model's clips animate in place, so travel,
 * turning and jumps are applied here, measured from the clips themselves so
 * feet don't skate.
 */
export class Frog {
  readonly root = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<ClipKey, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;

  private state: State = "resting";
  // First nap: long enough that visitors puzzle over the still little blob
  // before it suddenly unfolds into a frog.
  private timer = 4 + Math.random() * 2;
  private length = 1; // frog length in world units
  private facingOffset = 0; // model yaw at which its head points along +Z
  private justWoke = false;
  // Legs folded under (resting, looking, after settling) vs out (moving).
  private tucked = true;
  // What to do once a settle (tuck) or wake (unfold) finishes.
  private then?: () => void;

  // Where it is: on `surface`, `s` units along it from `a`, facing toward
  // `b` (dir 1) or `a` (dir -1). `goal` is where a crawl is heading.
  private surface?: Surface;
  private s = 0;
  private dir: 1 | -1 = 1;
  private goal = 0;
  private afterTurn?: () => void; // what to do once Turn around finishes
  // Heading for bed: it only sleeps fully tucked up in a top corner, so it
  // makes its way to the top of a wall first.
  private sleepy = false;
  // A crawl over to a wall ends with a hop onto it, landing at `s` and
  // climbing on to `goal`.
  private pendingWallHop: { surface: Surface; s: number; goal: number } | null = null;
  private resumeCrawl = false; // after a mid-crawl hop, keep crawling to the goal
  private resumeAfterLook = false; // after a mid-crawl look around, carry on

  // Pace for the current crawl (1 = normal) and a drifting wobble on top.
  private gait = 1;
  private gaitPhase = 0;
  private clock = 0;

  // Measured from the clips at load time.
  // Crawl: planted-foot push speed through the cycle, frog lengths per clip second.
  private stride = new Map<ClipKey, number[]>();
  // Turn around: how far it rotates and the point it pivots on (frog lengths).
  private turnAngle = Math.PI;
  private turnPivot = new THREE.Vector3();
  // Jumping: clip times when the feet leave and meet the ground, and how far
  // through the leap (0-1) the clip's lunge is at each sampled time.
  private airStart = 0.6;
  private airEnd = 1.45;
  private leapCurve: [number, number][] = [];
  // Wall grip: a held copy of the crawl, and the clip time it holds.
  private gripAction?: THREE.AnimationAction;
  private gripTime = 0;
  // Jumping: the clip time of its deepest crouch before take-off, where a
  // jump from a tuck starts so the legs never open up beforehand.
  private jumpCrouch = 0;

  private jump = {
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    launch: new THREE.Quaternion(),
    takeoff: new THREE.Quaternion(),
    landing: new THREE.Quaternion(),
    flight: new THREE.Quaternion(), // nose along the line of the leap
    height: 0,
    air: 0.15, // seconds airborne
    surface: undefined as Surface | undefined,
    s: 0,
    dir: 1 as 1 | -1,
    tookOff: false,
    landed: false,
  };

  constructor(private world: World) {}

  async load(): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
      this.useModel(gltf.scene, gltf.animations);
    } catch {
      // No exported model yet; leave the stage empty.
    }
  }

  /** Frog length in world units; the model is normalized to length 1. */
  setLength(length: number) {
    this.length = length;
    this.root.scale.setScalar(length);
  }

  /** Sets the frog down on a surface, `s` units along it. */
  placeOn(surface: Surface, s: number, dir: 1 | -1) {
    this.surface = surface;
    this.s = this.clampS(surface, s);
    this.dir = dir;
    this.root.position.copy(this.pointOn(surface, this.s));
    this.root.quaternion.copy(this.facing());
  }

  /** Call after the surfaces move (resize, fonts loading) to stay attached. */
  refresh() {
    if (!this.surface) return;
    const same = this.world.surfaces().find((x) => x.id === this.surface!.id);
    if (!same) return;
    this.surface = same;
    this.s = this.clampS(same, this.s);
    this.goal = this.clampS(same, this.goal);
    if (this.state !== "jumping") this.root.position.copy(this.pointOn(same, this.s));
  }

  /** A click: if it's on or near the frog, it leaps somewhere else. */
  poke(point: THREE.Vector3) {
    // Mid-jump or mid-turn the clip owns the pose; don't interrupt.
    if (!this.mixer || !this.surface || this.state === "jumping" || this.state === "turning") return;
    const middle = this.root.position.clone().addScaledVector(this.surface.normal, this.length * 0.2);
    if (middle.distanceTo(point) > this.length * STARTLE_RADIUS) return;
    this.sleepy = false; // too startled to carry on to bed
    this.leap(point);
  }

  update(dt: number) {
    if (!this.mixer || !this.surface) return;
    this.mixer.update(dt);
    this.timer -= dt;
    this.clock += dt;

    switch (this.state) {
      case "resting":
        if (this.timer <= 0) {
          this.justWoke = true; // always have a look (still tucked) and then move off
          this.enter("looking", "look");
        }
        break;
      case "waking":
        if (this.timer <= 0) this.next();
        break;
      case "crawling":
        this.crawl(dt);
        break;
      case "turning":
        if (this.timer <= 0) this.finishTurn();
        break;
      case "jumping":
        this.updateJump(dt);
        return; // the jump steers its own orientation
      case "looking":
        if (this.timer <= 0) {
          if (this.resumeAfterLook) {
            this.resumeAfterLook = false;
            this.crawlTo(this.goal);
          } else this.decide();
        }
        break;
      case "settling":
        if (this.timer <= 0) {
          this.tucked = true;
          this.next();
        }
        break;
    }


    // Ease toward facing along the surface (the turn clip owns it meanwhile).
    if (this.state !== "turning") {
      this.root.quaternion.slerp(this.facing(), 1 - Math.exp(-dt * 8));
    }
  }

  private enter(state: State, clip?: ClipKey) {
    // On a wall it clings, legs out; it only sits tucked on something flat.
    // On a wall it only ever uses the wall poses (never tucked): it clings,
    // now and then looks around, and sleeps clinging up in the top corner.
    if ((state === "resting" || state === "looking") && this.onWall()) {
      this.state = state;
      this.tucked = false;
      if (state === "resting") this.sleepy = false;
      const look = state === "looking" && (clip === "look" || Math.random() < WALL_LOOK_CHANCE);
      const duration = look ? this.play("wallLook") : 0;
      if (duration) this.timer = duration - FADE;
      else {
        this.grip();
        this.timer = state === "resting" ? 6 + Math.random() * 6 : 1.5 + Math.random() * 2.5;
      }
      return;
    }
    // Frogs don't sit about with their legs out: tuck them in first.
    if ((state === "resting" || state === "looking") && !this.tucked) {
      this.settleThen(() => this.enter(state, clip), state === "resting" ? 1 : SETTLE_AWAKE_SPEED);
      return;
    }
    this.state = state;
    switch (state) {
      case "resting":
        this.sleepy = false;
        this.play("rest");
        this.timer = 6 + Math.random() * 6;
        break;
      case "looking": {
          const key = clip ?? (Math.random() < 0.65 ? "look" : "alert");
        const speed = key === "look" ? LOOK_ANIM_SPEED : 1;
        const duration = this.play(key, speed);
        // Let Looking around play through; Alert idle just holds briefly.
        this.timer = key === "look" && duration ? duration / speed - FADE : 1.2 + Math.random() * 1.8;
        break;
      }
      default:
        break;
    }
  }

  /** Tucks the legs in (four alternating tucks), then does `then`. */
  private settleThen(then: () => void, speed = SETTLE_AWAKE_SPEED) {
    this.state = "settling";
    this.then = then;
    this.timer = this.play("settle", speed) / speed;
    if (!this.timer) {
      this.tucked = true;
      this.next();
    }
  }

  /** Unfolds from a tuck ready to move, then does `then`; straight away if already unfolded. */
  private unfoldThen(then: () => void) {
    if (!this.tucked) return then();
    this.tucked = false;
    this.state = "waking";
    this.then = then;
    this.timer = this.play("wake", UNFOLD_SPEED) / UNFOLD_SPEED;
    if (!this.timer) this.next();
  }

  private next() {
    const then = this.then ?? (() => this.enter("resting"));
    this.then = undefined;
    then();
  }

  /**
   * After a look, pick what's next. Frogs love walls, so from the floor it
   * often heads for one to climb, and on a wall it mostly roams up and down.
   */
  private decide() {
    const fresh = this.justWoke;
    this.justWoke = false;
    const here = this.surface!;
    const r = Math.random();
    const roam = () => this.crawlTo(this.randomS(here, Math.max(this.length * 2, this.world.scale() * 0.3)));
    const canRoam = lengthOf(here) - this.length > this.length * 1.5;
    const sleepy = !fresh && Math.random() < (here.id === "floor" ? 0.18 : 0.12);
    if (sleepy) return this.goToSleep();
    // Moves unfold the legs themselves (or turn round tucked first).
    this.move(r, roam, canRoam);
  }

  private move(r: number, roam: () => void, canRoam: boolean) {
    const here = this.surface!;
    if (here.id === "floor") {
      if (r < 0.45) this.climbWall();
      else if (r < 0.75 && canRoam) roam();
      else if (r < 0.82) this.hop();
      else this.leap();
    } else if (here.id.startsWith("wall")) {
      // Frogs crawl up walls but jump to get down.
      const above = this.clampS(here, lengthOf(here)) - this.s;
      // (No hops along a wall: on a wall it only uses the wall poses.)
      if (r < 0.62 && above > this.length * 1.5) this.climbUp();
      else this.leap(undefined, true);
    } else if (r < 0.55 && canRoam) roam();
    else this.leap();
  }

  /** Crawls further up the wall it's on. */
  private climbUp() {
    const here = this.surface!;
    const top = this.clampS(here, lengthOf(here));
    // A good stretch up: a share of the page, at least a couple of frog lengths.
    const climb = Math.max(this.length * 2.5, this.world.scale() * (0.25 + Math.random() * 0.35));
    this.crawlTo(Math.min(top, this.s + climb));
  }

  /** Crawls over near a wall (usually the nearer one), hops onto it and climbs. */
  private climbWall(toTop = false) {
    const floor = this.surface!;
    const walls = this.world.surfaces().filter((x) => x.id.startsWith("wall"));
    if (!walls.length) return this.leap();
    // Usually the nearer wall.
    walls.sort((a, b) => Math.abs(a.a.x - this.root.position.x) - Math.abs(b.a.x - this.root.position.x));
    const wall = Math.random() < 0.75 ? walls[0] : walls[walls.length - 1];
    const atStart = Math.abs(wall.a.x - floor.a.x) < Math.abs(wall.a.x - floor.b.x);
    // Take off a short hop out from the wall and land a little way up it.
    const toWall = atStart ? -1 : 1;
    const takeoff = this.clampS(floor, (atStart ? 0 : lengthOf(floor)) - toWall * this.length * 1.5);
    const wallLen = lengthOf(wall);
    const landing = this.clampS(wall, this.length * 1.2);
    const height = this.clampS(wall, toTop ? wallLen : wallLen * (0.3 + Math.random() * 0.55));
    this.pendingWallHop = { surface: wall, s: landing, goal: Math.max(height, landing) };
    // Already that close to the wall: hop on from here.
    if ((takeoff - this.s) * toWall <= 0) return this.hopOntoWall();
    this.crawlTo(takeoff);
  }

  private hopOntoWall() {
    const hop = this.pendingWallHop!;
    this.pendingWallHop = null;
    this.goal = hop.goal;
    this.resumeCrawl = hop.goal - hop.s > this.length * 0.1; // then climb on up
    this.jumpTo(hop.surface, hop.s);
  }

  /**
   * On big pages the frog is small next to the space it has, so it scurries a
   * bit quicker (up to 1.5x). Its feet still set its speed, so they don't skate.
   */
  private pagePace() {
    return THREE.MathUtils.clamp(this.world.scale() / (this.length * 5), 1, 1.5);
  }

  /** A random hop length (world units) within `range` of the page size. */
  private hopDistance([lo, hi]: number[]) {
    const page = this.world.scale() * (lo + Math.random() * (hi - lo));
    return Math.min(this.world.reach(), Math.max(this.length * MIN_HOP_LENGTHS, page));
  }

  /** How far a leap of `dist` rises above the straight line: hardly at all. */
  private arcHeight(dist: number) {
    return Math.min(dist * JUMP_ARC, this.length * JUMP_LIFT_MAX);
  }

  /** A short hop along the surface it's on, the way it's facing if there's room. */
  private hop() {
    const here = this.surface!;
    const len = lengthOf(here);
    const dist = this.hopDistance(HOP);
    // On a wall, hops only go up; elsewhere, the way it's facing if there's room.
    const onWall = here.id.startsWith("wall");
    let target = this.s + (onWall ? 1 : this.dir) * dist;
    if (!onWall && (target < this.clampS(here, 0) || target > this.clampS(here, len))) target = this.s - this.dir * dist;
    target = this.clampS(here, target);
    const p = this.pointOn(here, target);
    const clear = this.pathClear(this.root.position, p, p.distanceTo(this.root.position));
    if (Math.abs(target - this.s) < this.length || !clear) return this.enter("looking");
    this.jumpTo(here, target);
  }

  /**
   * Sleeps only on the floor or tucked in a corner (the bottom of a wall);
   * from anywhere else it first hops down to the floor, often into a corner.
   */
  private goToSleep() {
    this.sleepy = true;
    const here = this.surface!;
    if (this.onWall()) {
      const top = this.clampS(here, lengthOf(here));
      if (top - this.s <= this.length * 0.1) return this.enter("resting");
      return this.crawlTo(top);
    }
    if (here.id === "floor") return this.climbWall(true);
    // On the name or a ledge: hop down to the floor, then head for a wall.
    const floor = this.world.surfaces().find((x) => x.id === "floor");
    if (!floor) {
      this.sleepy = false;
      return this.enter("looking");
    }
    const len = lengthOf(floor);
    const corner = this.root.position.x < (floor.a.x + floor.b.x) / 2 ? 0 : len;
    for (let i = 0; i < 6; i++) {
      const s = i === 0 && Math.random() < 0.5 ? this.clampS(floor, corner) : this.randomS(floor, 0);
      const p = this.pointOn(floor, s);
      const dist = p.distanceTo(this.root.position);
      // Hopping down is mostly falling, so only the sideways part counts toward reach.
      if (Math.abs(p.x - this.root.position.x) > this.world.reach() || !this.pathClear(this.root.position, p, dist)) continue;
      this.jumpTo(floor, s);
      return;
    }
    this.sleepy = false;
    this.enter("looking"); // nowhere reachable; try again later
  }

  // ---- Crawling and turning ------------------------------------------------

  private crawlTo(goal: number) {
    this.goal = goal;
    const want = goal >= this.s ? 1 : -1;
    // On a wall it only ever climbs up, head up; it jumps to get down.
    if (this.onWall()) {
      this.dir = 1;
      if (want < 0) return this.enter("looking");
      return this.startCrawl();
    }
    if (want === this.dir) return this.unfoldThen(() => this.startCrawl());
    // Facing the wrong way: turn round properly first, then set off.
    this.turnThen(() => this.unfoldThen(() => this.startCrawl()));
  }

  /**
   * Turns to face the other way, then does `then`. Turn around steps round
   * with planted feet but is done tucked, so it tucks in fully first rather
   * than spinning on the spot with its legs out (which makes the feet skate).
   */
  private turnThen(then: () => void) {
    if (!this.actions.has("turn")) {
      this.dir = this.dir === 1 ? -1 : 1;
      return then();
    }
    if (!this.tucked) return this.settleThen(() => this.turnThen(then));
    this.afterTurn = then;
    this.state = "turning";
    this.timer = this.play("turn", TURN_ANIM_SPEED) / TURN_ANIM_SPEED;
  }

  private startCrawl() {
    this.state = "crawling";
    this.play(this.travelClip());
    // Each trip gets its own pace: mostly an amble, sometimes a scurry.
    this.gait = Math.random() < 0.2 ? 1.5 + Math.random() * 0.4 : 0.75 + Math.random() * 0.5;
    this.gaitPhase = Math.random() * Math.PI * 2;
  }

  private crawl(dt: number) {
    const remaining = (this.goal - this.s) * this.dir;
    if (remaining <= this.length * 0.02) {
      if (this.pendingWallHop) this.hopOntoWall();
      else if (this.sleepy) this.goToSleep(); // next leg of the trip up to bed
      else if (!this.resumeAfterLook && Math.random() < KEEP_GOING) this.decide();
      else this.enter("looking");
      return;
    }
    // Now and then stop partway for a look around, then carry on.
    if (remaining > this.length * 1.5 && Math.random() < PAUSE_CHANCE * dt) {
      this.resumeAfterLook = true;
      this.enter("looking", "look");
      return;
    }
    // On a long crawl, now and then break into a quick hop, then carry on.
    if (!this.onWall() && remaining > this.length * 3 && Math.random() < HOP_CHANCE * dt) {
      this.hopAlong(Math.min(this.hopDistance(MID_HOP), remaining - this.length * 0.5));
      return;
    }
    // Pace drifts up and down a little within the trip too.
    const wobble = 1 + 0.25 * Math.sin(this.clock * 0.8 + this.gaitPhase);
    const timeScale = CRAWL_ANIM_SPEED * this.gait * wobble * this.pagePace();
    if (this.current) this.current.timeScale = timeScale;
    // Travel exactly as far as the planted feet push, so they don't skate.
    const speed = this.length * this.strideAt() * timeScale;
    this.s += this.dir * Math.min(speed * dt, remaining);
    this.root.position.copy(this.pointOn(this.surface!, this.s));
  }

  /**
   * Turn around rotates the model inside its clip. When it ends, move that
   * rotation onto the frog itself (about the same pivot) and cut straight to
   * the next clip, so nothing visibly snaps back.
   */
  private finishTurn() {
    const spin = new THREE.Quaternion().setFromAxisAngle(UP, this.turnAngle);
    const shift = this.turnPivot
      .clone()
      .sub(this.turnPivot.clone().applyQuaternion(spin))
      .multiplyScalar(this.length)
      .applyQuaternion(this.root.quaternion);
    // Stay on the surface: only the along-surface part of the pivot shift counts.
    this.s = this.clampS(this.surface!, this.s + shift.dot(tangentOf(this.surface!)));
    this.root.position.copy(this.pointOn(this.surface!, this.s));
    this.root.quaternion.multiply(spin);
    this.dir = this.dir === 1 ? -1 : 1;

    // The turn ends tucked: cut straight to the matching tucked pose (so the
    // clip's own rotation can't snap back), then unfold to move off.
    this.play("alert", 1, 0);
    this.tucked = true;
    const then = this.afterTurn;
    this.afterTurn = undefined;
    if (then) then();
    else this.enter("looking");
  }

  /** A hop forward mid-crawl; it resumes crawling to the same goal on landing. */
  private hopAlong(distance: number) {
    this.resumeCrawl = true;
    this.jumpTo(this.surface!, this.clampS(this.surface!, this.s + this.dir * distance));
  }

  // ---- Jumping -------------------------------------------------------------

  /**
   * Leaps to a random spot on another surface, favoring short leaps ahead of
   * it. When startled from `away`, prefers the spot farthest from it.
   */
  private leap(away?: THREE.Vector3, downward = false, stretch = 1) {
    const here = this.surface!;
    // Never straight across from one wall to the other: too far for a frog.
    const isWall = (x: Surface) => x.id.startsWith("wall");
    const others = this.world.surfaces().filter((x) => x.id !== here.id && !(isWall(here) && isWall(x)));
    if (!others.length) return;
    let best: { surface: Surface; s: number } | undefined;
    let bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const surface = others[Math.floor(Math.random() * others.length)];
      const s = this.randomS(surface, 0);
      const p = this.pointOn(surface, s);
      const dist = p.distanceTo(this.root.position);
      // Dropping down is mostly falling, so only the sideways part counts toward reach.
      const span = downward ? Math.abs(p.x - this.root.position.x) : dist;
      if (dist < Math.max(this.length * 1.5, this.world.scale() * JUMP_MIN) || span > this.world.reach() * stretch) continue;
      if (!this.pathClear(this.root.position, p, dist)) continue;
      if (downward && p.y > this.root.position.y - this.length) continue;
      // Mostly random, but frogs rarely choose a long leap: favor short ones.
      // Mostly random, but frogs rarely choose a long leap, and would rather
      // jump the way they're facing than turn round first.
      const along = p.clone().sub(this.root.position).dot(tangentOf(here));
      const ahead = isWall(here) || Math.abs(along) < this.length * 0.3 || Math.sign(along) === this.dir;
      const score = away
        ? p.distanceTo(away)
        : (Math.random() / (1 + dist / (this.length * 1.5))) * (ahead ? 1 : 0.25);
      if (score > bestScore) {
        bestScore = score;
        best = { surface, s };
      }
    }
    if (best) this.jumpTo(best.surface, best.s, !!away);
    // Nothing in range: on a wall, climb (never crawl down); elsewhere wander along.
    else if (isWall(here)) {
      if (this.clampS(here, lengthOf(here)) - this.s > this.length) this.climbUp();
      else if (stretch === 1) this.leap(away, downward, LEAP_STRETCH);
      else this.enter("looking");
    } else if (lengthOf(here) - this.length > this.length * 1.5) this.crawlTo(this.randomS(here, this.length));
    // Stranded (e.g. on a short ledge with everything just out of reach):
    // one bigger leap rather than looking around forever.
    else if (stretch === 1) this.leap(away, downward, LEAP_STRETCH);
    else this.enter("looking");
  }

  /**
   * Whether a leap from `from` to `to` would stay clear of the text: checks
   * the frog's body along the arc, skipping the very ends where it's sitting.
   */
  private pathClear(from: THREE.Vector3, to: THREE.Vector3, dist: number) {
    const height = this.arcHeight(dist);
    const L = this.length;
    const p = new THREE.Vector3();
    for (let u = 0.1; u <= 0.9; u += 0.1) {
      p.lerpVectors(from, to, u).addScaledVector(UP, height * 4 * u * (1 - u));
      // The body sits above the feet; test its front, middle and back.
      for (const dx of [-0.3, 0, 0.3]) {
        if (this.world.blocked(new THREE.Vector3(p.x + dx * L, p.y + 0.3 * L, 0), 0.28 * L)) return false;
      }
    }
    return true;
  }

  /**
   * Leaps to `s` on `surface`. From a tuck it doesn't unfold first: it
   * shifts straight into the clip's crouch and only spreads out in the air.
   * If the spot is behind it, it turns round properly first (unless startled).
   */
  private jumpTo(surface: Surface, s: number, startled = false) {
    const behind = this.pointOn(surface, s).sub(this.root.position).dot(tangentOf(this.surface!)) * this.dir;
    if (!startled && !this.onWall() && behind < -this.length * 0.3) {
      return this.turnThen(() => this.jumpTo(surface, s, true));
    }
    const fromTuck = this.tucked;
    const j = this.jump;
    j.from.copy(this.root.position);
    j.to.copy(this.pointOn(surface, s));
    const d = new THREE.Vector3().subVectors(j.to, j.from);

    // Face the way it's going (along this surface) before take-off...
    const along = d.dot(tangentOf(this.surface!));
    if (Math.abs(along) > this.length * 0.3) this.dir = along > 0 ? 1 : -1;
    j.launch.copy(this.facing());
    // ...and land still heading the same way, along the new surface.
    const onward = d.dot(tangentOf(surface));
    j.dir = Math.abs(onward) > this.length * 0.1 ? (onward > 0 ? 1 : -1) : Math.random() < 0.5 ? 1 : -1;
    if (surface.id.startsWith("wall")) j.dir = 1; // always cling facing up
    j.landing.copy(this.facing(surface, j.dir));
    // Mid-air the body lines up with the leap, back toward the sky.
    const line = d.clone().normalize();
    const back = UP.clone().addScaledVector(line, -UP.dot(line));
    if (back.lengthSq() < 1e-4) back.copy(this.surface!.normal).addScaledVector(line, -this.surface!.normal.dot(line));
    j.flight.copy(this.frame(back.normalize(), line));
    j.surface = surface;
    j.s = s;

    const dist = d.length();
    // Time aloft grows with the leap relative to the page, not in raw pixels.
    j.air = 0.1 + (dist / this.world.scale()) * 0.3;
    j.height = this.arcHeight(dist);
    j.tookOff = j.landed = false;
    this.state = "jumping";
    this.play("jump", JUMP_CROUCH_SPEED, fromTuck ? 0.25 : 0.15, fromTuck ? this.jumpCrouch : 0);
  }

  private updateJump(dt: number) {
    const j = this.jump;
    const action = this.actions.get("jump");
    const t = action?.time ?? Infinity;

    if (t < this.airStart) {
      // Crouch: swing round to face the way it's about to leap, holding the
      // crouch (legs still in) until it's lined up.
      this.root.quaternion.slerp(j.launch, 1 - Math.exp(-dt * 16));
      if (action) action.timeScale = this.root.quaternion.angleTo(j.launch) < 0.15 ? JUMP_CROUCH_SPEED : 0;
      return;
    }
    if (!j.tookOff) {
      j.tookOff = true;
      j.takeoff.copy(this.root.quaternion);
    }
    if (action) {
      // Play the airborne part of the clip in exactly the time spent in the air.
      action.timeScale = t < this.airEnd ? (this.airEnd - this.airStart) / j.air : JUMP_LAND_SPEED;
    }
    // Follow the clip's own lunge so the body moves as the legs push.
    const u = this.leapProgress(t);
    this.root.position.lerpVectors(j.from, j.to, u).addScaledVector(UP, j.height * 4 * u * (1 - u));
    // Stretch out along the leap, then twist into the landing pose (e.g. onto a wall).
    const ease = (x: number) => x * x * (3 - 2 * x);
    if (u < 0.4) this.root.quaternion.slerpQuaternions(j.takeoff, j.flight, ease(u / 0.4));
    else this.root.quaternion.slerpQuaternions(j.flight, j.landing, ease((u - 0.4) / 0.6));

    if (u >= 1 && !j.landed) {
      j.landed = true;
      this.surface = j.surface;
      this.s = j.s;
      this.dir = j.dir;
      if (!this.resumeCrawl) this.goal = j.s;
    }
    if (t >= this.airEnd + 0.3) {
      if (this.resumeCrawl) {
        this.resumeCrawl = false;
        this.state = "crawling";
        this.play(this.travelClip(), 1, 0.15);
      } else {
        if (this.sleepy) this.goToSleep(); // on its way up to bed
        else this.enter("looking"); // tucks the legs in first
      }
    }
  }

  /** How far through the leap (0-1) the jump clip is at time `t`. */
  private leapProgress(t: number) {
    const c = this.leapCurve;
    if (c.length < 2) return THREE.MathUtils.clamp((t - this.airStart) / (this.airEnd - this.airStart), 0, 1);
    let i = 1;
    while (i < c.length - 1 && c[i][0] < t) i++;
    const [t0, p0] = c[i - 1];
    const [t1, p1] = c[i];
    const f = THREE.MathUtils.clamp((t - t0) / (t1 - t0 || 1), 0, 1);
    return THREE.MathUtils.clamp(p0 + (p1 - p0) * f, 0, 1);
  }

  // ---- Geometry ------------------------------------------------------------

  private onWall() {
    return !!this.surface?.id.startsWith("wall");
  }

  private pointOn(surface: Surface, s: number) {
    return surface.a.clone().addScaledVector(tangentOf(surface), s);
  }

  /** Keeps the frog's middle at least half a length from a surface's ends. */
  private clampS(surface: Surface, s: number) {
    const len = lengthOf(surface);
    const margin = Math.min(this.length * 0.5, len / 2);
    return THREE.MathUtils.clamp(s, margin, len - margin);
  }

  /** A random spot on a surface, at least `minFromHere` from the frog if it's this one. */
  private randomS(surface: Surface, minFromHere: number) {
    const len = lengthOf(surface);
    const margin = Math.min(this.length * 0.5, len / 2);
    let s = margin + Math.random() * (len - 2 * margin);
    for (let i = 0; i < 8 && surface === this.surface && Math.abs(s - this.s) < minFromHere; i++) {
      s = margin + Math.random() * (len - 2 * margin);
    }
    return s;
  }

  /**
   * The orientation for standing on a surface facing along it: belly to the
   * surface, head toward `dir`, body turned a little toward the viewer.
   */
  private facing(surface = this.surface!, dir = this.dir) {
    // Frogs never hang head-down on a wall (walls run bottom to top).
    if (surface.id.startsWith("wall")) dir = 1;
    return this.frame(surface.normal, tangentOf(surface).multiplyScalar(dir));
  }

  /** Orientation with its back toward `n` and head along `f`, turned toward the viewer. */
  private frame(n: THREE.Vector3, f: THREE.Vector3) {
    const a = f.clone().applyAxisAngle(n, VIEW_YAW);
    const b = f.clone().applyAxisAngle(n, -VIEW_YAW);
    const fwd = a.z >= b.z ? a : b; // the viewer is toward +z
    const world = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(n, fwd), n, fwd);
    const mf = new THREE.Vector3(Math.sin(this.facingOffset), 0, Math.cos(this.facingOffset));
    const model = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(UP, mf), UP, mf);
    return new THREE.Quaternion().setFromRotationMatrix(world.multiply(model.transpose()));
  }

  // ---- Animation -----------------------------------------------------------

  /** Push strength at the crawl clip's current point in its cycle. */
  private strideAt(): number {
    const key = this.travelClip();
    const action = this.actions.get(key);
    const stride = this.stride.get(key);
    if (!action || !stride?.length) return FALLBACK_STRIDE;
    const n = stride.length;
    const f = (action.time / action.getClip().duration) * n;
    const i = Math.floor(f);
    const a = stride[((i % n) + n) % n];
    const b = stride[(i + 1) % n];
    return a + (b - a) * (f - i);
  }

  /**
   * The clip it travels with. Wall climbing's steps are too small to carry
   * the frog anywhere without its feet skating (a whole cycle moves it about
   * 1/70 of its length), so it climbs walls with the crawl, whose steps
   * really cover the ground. Use wall climbing here once its reach is longer.
   */
  private travelClip(): ClipKey {
    return "crawl";
  }

  /** Blends to a clip; returns the clip's length in clip seconds (0 if missing). */
  private play(key: ClipKey, timeScale = 1, fade = FADE, startAt = 0): number {
    const next = this.actions.get(key) ?? (key === "alert" ? this.actions.get("look") : undefined);
    if (!next) return 0;
    if (key !== "rest" && key !== "settle" && key !== "alert" && key !== "look") this.tucked = false;
    this.blendTo(next, timeScale, fade, startAt);
    return next.getClip().duration;
  }

  /** Clings to a wall: a still pose from the crawl with both back legs well out. */
  private grip() {
    if (this.actions.has("wallCling")) return this.play("wallCling");
    if (!this.gripAction) return this.play("crawl", 0);
    this.blendTo(this.gripAction, 0, FADE, this.gripTime);
  }

  private blendTo(next: THREE.AnimationAction, timeScale: number, fade: number, startAt = 0) {
    if (next !== this.current) {
      next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1);
      next.time = startAt;
      if (fade > 0) {
        next.fadeIn(fade).play();
        this.current?.fadeOut(fade);
      } else {
        next.play();
        this.current?.stop();
      }
      this.current = next;
    }
  }

  /**
   * Jumping lunges the root bone forward inside the clip. The frog itself
   * makes the trip here (to wherever it's leaping), so remove that travel
   * from the clip, keeping any lift, and remember how far along the lunge is
   * at each moment so the trip keeps the same timing.
   */
  private takeLeapOut(clip: THREE.AnimationClip) {
    const track = clip.tracks.find((t) => t.name === "root.position");
    if (!track || track.values.length < 6) return;
    const v = track.values;
    const at = (i: number) => new THREE.Vector3(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    const start = at(0);
    const travel = at(track.times.length - 1).sub(start);
    const len2 = travel.lengthSq();
    if (len2 < 1e-6) return; // jumps in place; nothing to take out
    this.leapCurve = [];
    for (let i = 0; i < track.times.length; i++) {
      const p = at(i);
      const progress = p.clone().sub(start).dot(travel) / len2;
      p.addScaledVector(travel, -progress);
      v[i * 3] = p.x;
      v[i * 3 + 1] = p.y;
      v[i * 3 + 2] = p.z;
      this.leapCurve.push([track.times[i], progress]);
    }
  }

  /** Poses the model at evenly spaced points through a clip. */
  private sampleClip(key: ClipKey, each: (time: number, duration: number) => void) {
    const action = this.actions.get(key);
    if (!action) return false;
    const duration = action.getClip().duration;
    action.reset().setEffectiveWeight(1).play();
    for (let i = 0; i <= SAMPLES; i++) {
      action.time = Math.min((i / SAMPLES) * duration, duration - 1e-4);
      this.mixer!.update(0);
      this.root.updateMatrixWorld(true);
      each(action.time, duration);
    }
    action.stop();
    return true;
  }

  /** A bone's position in the frog's own frame (units: frog lengths). */
  private local(bone: THREE.Object3D) {
    return this.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  }

  /**
   * Reads what the in-place clips imply about motion: how fast planted feet
   * push in Crawling, when the frog is airborne in Jumping, and how far and
   * about which point Turn around rotates it.
   */
  private measureClips(model: THREE.Object3D) {
    const fwd = new THREE.Vector2(Math.sin(this.facingOffset), Math.cos(this.facingOffset));
    const feet = FEET.map((n) => model.getObjectByName(n)).filter((f) => f !== undefined);

    // Crawling and wall climbing: samples[i][foot] = [forward position, height].
    for (const key of ["crawl", "wallClimb"] as const) {
      const samples: [number, number][][] = [];
      let duration = 0;
      this.sampleClip(key, (_, d) => {
        duration = d;
        samples.push(
          feet.map((f) => {
            const p = this.local(f);
            return [p.x * fwd.x + p.z * fwd.y, p.y];
          }),
        );
      });
      samples.pop(); // last sample repeats the first; the cycle wraps
      if (!samples.length || !feet.length) continue;
      const n = samples.length;
      // A foot counts as planted in the lowest part of its own up/down range.
      const planted = feet.map((_, f) => {
        const ys = samples.map((s) => s[f][1]);
        const lo = Math.min(...ys);
        return lo + (Math.max(...ys) - lo) * 0.35;
      });
      const push = samples.map((s, i) => {
        const next = samples[(i + 1) % n];
        let v = 0;
        s.forEach(([z, y], f) => {
          if (y <= planted[f]) v = Math.max(v, z - next[f][0]);
        });
        return v;
      });
      // Light smoothing so the body doesn't jitter between samples.
      const smooth = push.map((_, i) => (push[(i - 1 + n) % n] + 2 * push[i] + push[(i + 1) % n]) / 4);
      const step = duration / n;
      if (smooth.some((v) => v > 0)) this.stride.set(key, smooth.map((v) => v / step));
    }

    // Wall grip: the crawl frame where the nearer-in back leg is farthest out.
    const bodyBone = model.getObjectByName("body");
    const hind = ["hindankleL", "hindankleR"].map((n) => model.getObjectByName(n)).filter((f) => f !== undefined);
    if (bodyBone && hind.length) {
      let best = -Infinity;
      this.sampleClip("crawl", (t) => {
        const b = this.local(bodyBone);
        const spread = Math.min(...hind.map((h) => this.local(h).distanceTo(b)));
        if (spread > best) {
          best = spread;
          this.gripTime = t;
        }
      });
    }

    // Jump: airborne while the lunge is under way, or (for clips that jump in
    // place) while the root bone is lifted off its resting height.
    const rootBone = model.getObjectByName("root");
    if (this.leapCurve.length) {
      const c = this.leapCurve;
      this.airStart = (c.find(([, p]) => p > 0.03) ?? c[0])[0];
      this.airEnd = (c.find(([, p]) => p >= 0.97) ?? c[c.length - 1])[0];
    } else if (rootBone) {
      const lift: [number, number][] = [];
      this.sampleClip("jump", (t) => lift.push([t, this.local(rootBone).y]));
      if (lift.length) {
        const base = lift[0][1];
        const up = lift.filter(([, y]) => y > base + 0.03);
        if (up.length) {
          this.airStart = up[0][0];
          this.airEnd = up[up.length - 1][0];
        }
      }
    }

    // Jump crouch: back legs drawn in closest, before take-off.
    if (bodyBone && hind.length) {
      let least = Infinity;
      this.sampleClip("jump", (t) => {
        if (t >= this.airStart) return;
        const b = this.local(bodyBone);
        const spread = Math.max(...hind.map((h) => this.local(h).distanceTo(b)));
        if (spread < least) {
          least = spread;
          this.jumpCrouch = t;
        }
      });
    }

    // Turn: yaw change of the body-to-head line, pivoting on the root bone.
    const head = model.getObjectByName("head");
    const body = model.getObjectByName("body");
    if (head && body) {
      const yaws: number[] = [];
      this.sampleClip("turn", (t) => {
        const h = this.local(head);
        const b = this.local(body);
        yaws.push(Math.atan2(h.x - b.x, h.z - b.z));
        if (t === 0 && rootBone) this.turnPivot.copy(this.local(rootBone)).setY(0);
      });
      if (yaws.length) {
        let total = 0;
        for (let i = 1; i < yaws.length; i++) {
          const d = yaws[i] - yaws[i - 1];
          total += Math.atan2(Math.sin(d), Math.cos(d));
        }
        this.turnAngle = total;
      }
    }
  }

  private useModel(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    // Normalize whatever comes out of Blender: length 1, centered, feet at y=0.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1 / Math.max(size.x, size.z);
    const center = box.getCenter(new THREE.Vector3());
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(scale);
    model.position.set(-center.x, -box.min.y, -center.z);
    wrapper.add(model);
    this.root.add(wrapper);

    // Measure in the frog's own frame, then put it back where it was.
    const saved = { pos: this.root.position.clone(), scale: this.root.scale.clone() };
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.scale.setScalar(1);

    // Work out which way the head points so "facing" means facing. The head
    // bone sits near the middle of the outline, so measure from the body bone.
    const head = model.getObjectByName("head");
    const body = model.getObjectByName("body");
    if (head && body) {
      this.root.updateMatrixWorld(true);
      const h = head.getWorldPosition(new THREE.Vector3());
      const b = body.getWorldPosition(new THREE.Vector3());
      this.facingOffset = Math.atan2(h.x - b.x, h.z - b.z);
    }

    const jumpClip = clips.find((c) => c.name === CLIPS.jump);
    if (jumpClip) this.takeLeapOut(jumpClip);

    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(CLIPS) as [ClipKey, string][]) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(key)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(key, action);
    }
    // Measure before the breathing layer starts so it can't skew anything.
    this.measureClips(model);
    this.actions.get("breathe")?.play();
    // A separate copy of the crawl, so the wall grip can hold one frame while
    // the crawl itself keeps playing normally.
    const crawlClip = clips.find((c) => c.name === CLIPS.crawl);
    if (crawlClip) this.gripAction = this.mixer.clipAction(crawlClip.clone());

    this.root.position.copy(saved.pos);
    this.root.scale.copy(saved.scale);
    if (this.surface) this.root.quaternion.copy(this.facing());
    this.play("rest");
  }
}

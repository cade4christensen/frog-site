import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL = "/models/frog.glb";
// Seconds to blend between animations: short, so the clips' deliberate limb
// timing isn't smeared (the handoff asks for about 0.1-0.2s).
const FADE = 0.15;
// Stopping always tucks the legs in with Settle to rest, and moving off from a
// tuck unfolds with Wake and move. Awake stops tuck a little quicker than
// settling down to sleep.
const SETTLE_AWAKE_SPEED = 1.3;
const UNFOLD_SPEED = 3.4; // quick: the arms come out as part of setting off, not before it
const CRAWL_ANIM_SPEED = 2.35; // playback rate of the Crawling clip; sets crawl speed
// Never play the crawl faster than this overall (gait, wobble and page pace
// all multiply in), bursts aside: much faster and the legs flicker.
const CRAWL_MAX_SPEED = 3.2;
// How far the crawl carries the frog, as a multiple of what its planted feet push.
// The in-clip foot push, measured in the frog's own frame, is 1.4-2x what the screen-projected
// measurement reports, so the feet skated. Scale travel up to match the real push.
const CRAWL_TRAVEL = 1.75;
const WALL_CLIMB_TRAVEL = 2.0;
// Between bursts the frog tucks its legs in (Settle to rest) and unfolds again (Wake and move).
const BURST_TUCK_SPEED = 1.6;
// Frogs crawl a little at a time: a quick couple of steps, a pause with the
// feet set, another couple. Steps per burst, seconds of pause, and the pace
// of the steps.
const BURST_STEPS = [16, 26]; // footfalls per burst: long runs of steps before a rest
const BURST_REST = [0.5, 1.6];
const BURST_FAST = 1.55;
const FALLBACK_STRIDE = 0.25; // frog lengths per clip second if feet can't be measured
const LOOK_ANIM_SPEED = 1.3; // Looking around is a little slow as exported
const TURN_ANIM_SPEED = 1.5; // Turn around (8.5s as exported) is slow; much faster and its quick steps flick
// The Turn 90 family (79 and 145 frames) is leisurely as exported; a quarter turn should take about a second.
const QUARTER_ANIM_SPEED = 2.6;
// At those speeds the turns' quickest steps flick a foot across in a frame or
// two. Through those stretches only, slow the turn so no limb moves faster
// than this (frog lengths per second), but never below the share TURN_MIN_PACE.
const TURN_LIMB_MAX = 4.5;
const TURN_MIN_PACE = 0.35;
// Jumping plays at different speeds per phase: a quick crouch, an airborne
// part so fast the frog nearly teleports, then a brisk landing.
const JUMP_CROUCH_SPEED = 2;
const JUMP_LAND_SPEED = 2.5;
// How long the push takes (seconds): the body moves off as the legs straighten,
// and is up to flying speed by the time they're fully out.
const JUMP_PUSH_TIME = 0.1;
// How far through the push (0-1) the body starts taking off ahead of the legs.
const JUMP_LIFT_FROM = 0.35;
// Jump distances are fractions of the page size (its shorter side), so leaps
// look as big on a large screen as on a phone.
const JUMP_MIN = 0.2; // shortest leap between surfaces
const HOP = [0.18, 0.35]; // a hop along a surface, min to max
const MID_HOP = [0.15, 0.25]; // a hop breaking up a crawl
const MIN_HOP_LENGTHS = 1.2; // ...but always at least this many frog lengths
// Frogs lunge fairly straight at where they're going: the path rises a
// little (this fraction of the distance, capped, in frog lengths) and drops
// late, mostly near the end (see arcShape).
const JUMP_ARC = 0.08;
const JUMP_LIFT_MIN = 0.06;
const JUMP_LIFT_MAX = 0.3;
// ...with the clip's own lift on top, just enough that the trailing back
// legs skim clear after the push. Any more and the frog looks like it levitates.
const JUMP_CLEARANCE = 0.02; // frog lengths of daylight under it mid-leap
// Most the leap tilts the body nose up or down mid-air. The jump clip's own
// push rears the body up a little on top of this.
const FLIGHT_PITCH = (18 * Math.PI) / 180;
const MAX_LEAP_ANGLE = (45 * Math.PI) / 180; // steepest leap it chooses (from level)
// Clinging to a wall it can only push off along it (up, or down once it's
// turned head-down), so leaps off a wall go at least this steeply up or down.
const MIN_WALL_LEAP_ANGLE = (30 * Math.PI) / 180;
// Leaping down, it sets off this far above level and falls the rest...
const DROP_LAUNCH_ANGLE = (10 * Math.PI) / 180;
// ...so it has to hop out at least a little: drops are never steeper than
// this or nearer than a frog length sideways.
const MAX_DROP_ANGLE = (65 * Math.PI) / 180;
// Turn the body this far toward the viewer so it isn't a flat profile.
const VIEW_YAW = (25 * Math.PI) / 180;
// While crawling a long way, the chance per second of breaking into a hop.
const HOP_CHANCE = 0.06;
// While crawling, the chance per second of stopping to look around before going on.
const PAUSE_CHANCE = 0.08;
// After arriving somewhere, the chance it carries straight on without stopping to look.
const KEEP_GOING = 0.7;
// When nothing is within reach, it tries once more allowing a leap this much longer.
const LEAP_STRETCH = 1.6;
// Bone names (Three strips the dots Blender uses, e.g. hind.ankle.L).
const FEET = ["frontlowerL", "frontlowerR", "hindankleL", "hindankleR"];
const SAMPLES = 64;
const LIMB_STEP = 1 / 48; // clip seconds between limb speed samples (clips are 24 fps)
// Keyframe pops: a key-to-key step this many times a bone's usual step gets
// spread over this many keys either side.
const POP_RATIO = 3;
const POP_SPREAD = 3;
const UP = new THREE.Vector3(0, 1, 0);

// The frog's day: rest, wake up, look around, then crawl along whatever it's
// on, turn around, or leap to another surface; now and then settle to rest.
type State =
  | "resting"
  | "waking"
  | "crawling"
  | "pausing" // tucked in between crawl bursts
  | "turning"
  | "jumping"
  | "looking"
  | "settling"
  | "sequence" // a run of clips played back to back, e.g. leaning out off a wall
  | "wallLanding"; // arriving on a wall: Wall landing carries it in to the wall

// Clip names as exported from Blender. One-shot clips play once and hold
// their last pose; the rest loop.
const CLIPS = {
  rest: "Resting",
  wake: "Wake and move",
  crawl: "Crawling",
  turn: "Turn around", // legacy all-in-one 180; the 90-degree family below is preferred
  turn90: "Turn 90", // a quarter turn, ending braced, then one of:
  turn90More: "Continue turn 90", //   on round to 180 (then tucks)
  turn90Back: "Turn back 90", //   back to where it started (tucked)
  turn90Settle: "Turn 90 settle", //   tuck in, still facing 90 degrees
  jump: "Jumping",
  alert: "Alert idle",
  look: "Looking around",
  settle: "Settle to rest",
  // On a wall it only ever uses these, authored against the wall.
  wallCling: "Wall cling",
  wallLand: "Wall landing", // arriving on a wall from a jump, ending in the cling stance
  wallStart: "Wall start crawl", // from the cling stance into the climbing gait
  wallClimb: "Wall climbing",
  wallLook: "Wall looking around",
  wallLeanOut: "Wall lean out",
  wallLookout: "Wall lookout pose",
  wallLeanBack: "Wall lean back",
  wallTurnDown: "Wall turn to look down", // swivels to peek down before leaping off
  breathe: "Idle", // shape keys only (breathing, throat); always layered on
} as const;
type ClipKey = keyof typeof CLIPS;
const ONE_SHOT = new Set<ClipKey>([
  "wake", "settle", "turn", "turn90", "turn90More", "turn90Back", "turn90Settle", "jump", "look", "wallLook", "wallLeanOut", "wallLookout", "wallLeanBack", "wallTurnDown", "wallLand", "wallStart",
]);
// Sitting still on a wall, the frog slowly slips down it (frog lengths per
// second); once it has slipped this far while awake, it climbs back up.
const WALL_SLIDE = 0.08;
const WALL_REGRIP = 0.6;
// Wall climbing's steps are tiny (each foot reaches ~3% of the frog's length
// per cycle), so its clip can't set the pace: the frog climbs at this speed
// (frog lengths per second) with the gait playing at this rate.
const WALL_CLIMB_SPEED = 0.3;
const MIN_CLIMB_STRIDE = 0.05; // below this, wall climbing's steps don't carry the frog
// On a wall the frog never turns round: it clings, climbs, idles or jumps straight off.
const WALL_PEEK = false;
// Turning round on the floor: play the full Turn around clip rather than the Turn 90 family.
const PREFER_FULL_TURN = false; // Cade: turn 90 at a time, pause, then turn back, look, sit or finish
const WALL_CLIMB_ANIM_SPEED = 2.2;
// Wall climbing whose steps do carry the frog plays at its own rate (the floor crawl's is tuned for a much shorter clip).
const WALL_CLIMB_CLIP_SPEED = 2.2;
const WALL_CLIMB_MAX_SPEED = 3.0;
const WALL_LAND_SPEED = 1.4; // Wall landing playback rate
const WALL_BLEND = 0.12; // between wall clips (the handoff suggests ~0.12s)
const WALL_LAND_FADE = 0.06; // seconds blending from the leap into it (short, to keep the momentum)
// Transition clips whose held still stretches (at the start or end) are
// skipped, so one movement flows straight into the next without a pause.
const TRIMMED = new Set<ClipKey>(["settle", "wake", "wallStart", "wallLeanOut", "wallLeanBack", "wallTurnDown"]);
// After a quarter turn: how often it carries on round, stops to look about
// while facing 90 degrees, or thinks better of it and turns back.
// With room ahead, how often a crawl sets off the other way (and so turns round first).
const TURN_CHANCE = 0.08;
// At the end of a short perch (name, ledges), how often it leaps off instead of turning round.
const LEAVE_PERCH = 0.7;
const QUARTER_CONTINUE = 0.72;
const QUARTER_PAUSE = 0.18; // (the rest, 10%, turn back)
const WALL_LOOK_CHANCE = 0.45; // pausing on a wall: chance it looks around rather than just clinging
const WALL_LOOKOUT_CHANCE = 0.35; // ...or leans out off the wall to keep a lookout

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
/**
 * Height (0-1 of the arc's peak) at progress `u` through a leap: rising
 * gently, peaking past halfway and dropping off mostly near the end.
 */
function arcShape(u: number) {
  const a = 1.8; // 1 would be a parabola; higher pushes the peak later
  const peak = a / (a + 1);
  return (Math.pow(u, a) * (1 - u)) / (Math.pow(peak, a) * (1 - peak));
}

/**
 * Progress (0-1) through a leap at time share `x`: it leaves at speed `v0`
 * and arrives at `v1` (shares of the average speed), easing up to a steady
 * cruise and down again over the first and last quarter.
 */
function flightEase(x: number, v0: number, v1: number) {
  x = THREE.MathUtils.clamp(x, 0, 1);
  const r = 0.25;
  const cruise = (1 - (r * (v0 + v1)) / 2) / (1 - r);
  // Distance covered `y` into a ramp from speed `w` up to cruise.
  const ramp = (y: number, w: number) => w * y + ((cruise - w) / 2) * (y - (r / Math.PI) * Math.sin((Math.PI * y) / r));
  if (x < r) return ramp(x, v0);
  if (x > 1 - r) return 1 - ramp(1 - x, v1);
  return ramp(r, v0) + cruise * (x - r);
}

// The crawl lays each whole forearm flat on the ground with the hand, like a
// sphinx. Lift the elbows this share of the way to straight up (scaled by the
// crawl's weight), so the forearm angles down to the planted hand.
export const ELBOW_LIFT = 0.35;
// Of the two front legs, whichever reaches less far forward is pulled back
// toward its shoulder by this share of its reach (the crawl's "in" arm sat too
// far out). It fades in over ARM_TUCK_SPAN (shares of arm length) of difference.
export const ARM_TUCK = 0.3;
const ARM_TUCK_SPAN = 0.1;
export type Arm = { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D };
const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3();
const _n = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _hand = new THREE.Quaternion(), _p = new THREE.Quaternion();

/** Finds the front legs' bones (shoulder, elbow, hand) in a model. */
export function armsOf(model: THREE.Object3D): Arm[] {
  return ["L", "R"].flatMap((side) => {
    const [upper, lower, hand] = ["frontupper", "frontlower", "fronthand"].map((n) => model.getObjectByName(n + side));
    return upper && lower && hand ? [{ upper, lower, hand }] : [];
  });
}

/**
 * The crawl's arm fixes: tucks the "in" arm (see ARM_TUCK, scaled by `tuck`),
 * then raises each elbow by `lift` (0-1) of the way toward `up` (world space).
 * It swings the arm round the line from shoulder to hand, so the hand stays
 * exactly where it is (planted feet don't skate) and keeps its angle.
 * Call after the mixer has posed the frog and its world matrices are current.
 * Call the returned undo before the mixer's next update: the mixer only
 * rewrites a bone whose animated value has changed, so a lift left in place
 * would stack up frame after frame wherever the clip holds still (spinning
 * hands).
 */
export function poseArms(arms: Arm[], up: THREE.Vector3, forward: THREE.Vector3, lift: number, tuck: number): () => void {
  const saved = arms.flatMap(({ upper, lower, hand }) => [upper, lower, hand].map((b) => [b, b.quaternion.clone()] as const));
  const undo = () => saved.forEach(([b, q]) => b.quaternion.copy(q));
  if (tuck > 0 && arms.length === 2) {
    const fwd = forward.clone().projectOnPlane(up).normalize();
    const reach = arms.map(({ upper, hand }) => hand.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).dot(fwd));
    const span = arms[0].upper.getWorldPosition(new THREE.Vector3()).distanceTo(arms[0].lower.getWorldPosition(new THREE.Vector3())) * 2;
    arms.forEach((arm, i) => {
      const w = THREE.MathUtils.smoothstep((reach[1 - i] - reach[i]) / (span * ARM_TUCK_SPAN), 0, 1);
      if (w <= 0 || reach[i] <= 0) return;
      const hand = arm.hand.getWorldQuaternion(new THREE.Quaternion());
      reachFor(arm, arm.hand.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, -reach[i] * ARM_TUCK * tuck * w));
      arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hand));
      arm.hand.updateMatrixWorld(true);
    });
  }
  if (lift <= 0) return undo;
  for (const { upper, lower, hand } of arms) {
    upper.getWorldPosition(_s);
    lower.getWorldPosition(_e);
    hand.getWorldPosition(_h);
    _n.subVectors(_h, _s).normalize();
    // Where the elbow points, and straight up, both square to that line.
    _u.subVectors(_e, _s).projectOnPlane(_n);
    _t.copy(up).projectOnPlane(_n);
    if (_u.lengthSq() < 1e-10 || _t.lengthSq() < 1e-10) continue;
    const angle = Math.atan2(_n.dot(_u.clone().cross(_t)), _u.dot(_t));
    hand.getWorldQuaternion(_hand);
    _q.setFromAxisAngle(_n, angle * lift).multiply(upper.getWorldQuaternion(new THREE.Quaternion()));
    upper.quaternion.copy(upper.parent!.getWorldQuaternion(_p).invert().multiply(_q));
    upper.updateMatrixWorld(true);
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(_p).invert().multiply(_hand));
    hand.updateMatrixWorld(true);
  }
  return undo;
}

/**
 * Puts an arm's hand on `target` (world space) the short way: the elbow bends
 * to span the distance, then the shoulder swings round. The hand keeps its
 * own rotation relative to the forearm.
 */
export function reachFor({ upper, lower, hand }: Arm, target: THREE.Vector3) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const H = hand.getWorldPosition(new THREE.Vector3());
  const la = S.distanceTo(E);
  const lb = E.distanceTo(H);
  const want = THREE.MathUtils.clamp(S.distanceTo(target), Math.abs(la - lb) + 1e-4, la + lb - 1e-4);
  const now = Math.acos(THREE.MathUtils.clamp(S.clone().sub(E).normalize().dot(H.clone().sub(E).normalize()), -1, 1));
  const need = Math.acos(THREE.MathUtils.clamp((la * la + lb * lb - want * want) / (2 * la * lb), -1, 1));
  const axis = S.clone().sub(E).cross(H.clone().sub(E));
  if (axis.lengthSq() > 1e-12) {
    const turn = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), need - now);
    const world = lower.getWorldQuaternion(new THREE.Quaternion());
    lower.quaternion.copy(lower.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(turn.multiply(world)));
    lower.updateMatrixWorld(true);
  }
  hand.getWorldPosition(H);
  const swing = new THREE.Quaternion().setFromUnitVectors(H.sub(S).normalize(), target.clone().sub(S).normalize());
  const world = upper.getWorldQuaternion(new THREE.Quaternion());
  upper.quaternion.copy(upper.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(swing.multiply(world)));
  upper.updateMatrixWorld(true);
}

// The turn clips swing a front leg right round in a full circle (and back to
// where it started) for what should be a small step. A step between keys
// bigger than this (degrees, upper arm direction) marks one of those loops.
const LOOP_STEP = 25;
// The clean step that replaces a loop lifts the hand this share of the arm's length.
const LOOP_LIFT = 0.15;

/**
 * Rebuilds the front legs through any windmill loops in `clip` (see
 * LOOP_STEP) as a plain step: the hand lifts from where it was planted
 * before the loop and sets down where it's planted after, the shoulder and
 * elbow easing between their poses either side and then bending the short
 * way to follow it.
 */
export function unwindArms(model: THREE.Object3D, clip: THREE.AnimationClip) {
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip).play();
  const pose = (t: number) => {
    action.time = t;
    mixer.update(0);
    model.updateMatrixWorld(true);
  };
  for (const { upper, lower, hand } of armsOf(model)) {
    const tu = clip.tracks.find((t) => t.name === `${upper.name}.quaternion`);
    const tl = clip.tracks.find((t) => t.name === `${lower.name}.quaternion`);
    if (!tu || !tl || tl.times.length !== tu.times.length) continue;
    const times = tu.times;
    const n = times.length;
    // Upper arm direction (in its parent's frame) at each key.
    const dir = (i: number) => new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().fromArray(tu.values, i * 4));
    const big = Array.from({ length: n - 1 }, (_, i) => dir(i).angleTo(dir(i + 1)) * THREE.MathUtils.RAD2DEG > LOOP_STEP);
    // Loops: runs of big steps (merging runs a key or two apart), from the
    // calm key before to the calm key after.
    const loops: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) {
      if (!big[i]) continue;
      const last = loops[loops.length - 1];
      if (last && i - last[1] <= 2) last[1] = i + 1;
      else loops.push([i, i + 1]);
    }
    for (const [a, b] of loops) {
      if (b - a < 2) continue;
      // The step: a low arc from the hand's spot before the loop to its spot after.
      pose(times[a]);
      const from = hand.getWorldPosition(new THREE.Vector3());
      const arm = upper.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3())) * 2;
      pose(times[b]);
      const to = hand.getWorldPosition(new THREE.Vector3());
      const targets: THREE.Vector3[] = [];
      for (let i = a + 1; i < b; i++) {
        const s = (times[i] - times[a]) / (times[b] - times[a]);
        targets.push(from.clone().lerp(to, s).add(new THREE.Vector3(0, arm * LOOP_LIFT * Math.sin(Math.PI * s), 0)));
      }
      const q = (t: THREE.KeyframeTrack, i: number) => new THREE.Quaternion().fromArray(t.values, i * 4);
      for (let i = a + 1; i < b; i++) {
        const s = (times[i] - times[a]) / (times[b] - times[a]);
        // The rest of the body as the clip has it, the arm eased between the calm keys.
        pose(times[i]);
        upper.quaternion.copy(q(tu, a).slerp(q(tu, b), s));
        lower.quaternion.copy(q(tl, a).slerp(q(tl, b), s));
        upper.updateMatrixWorld(true);
        reachFor({ upper, lower, hand }, targets[i - a - 1]);
        upper.quaternion.toArray(tu.values, i * 4);
        lower.quaternion.toArray(tl.values, i * 4);
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
}

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
  private wallHold = 0; // where on the wall it last took hold
  // Clips still to play in a "sequence", and what to do when they're done.
  private queue: { key: ClipKey; hold: number }[] = [];
  private afterQueue?: () => void;
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
  private burst = { going: true, steps: 0, left: 0, pace: 1, last: 0 };
  // Crawl and climb clip times where a step has finished and the feet are set.
  private stepEnds = new Map<ClipKey, number[]>();
  private clock = 0;

  // Measured from the clips at load time.
  // Crawl: planted-foot push speed through the cycle, frog lengths per clip second.
  // (keyed by clip and view, see viewOf: the frog is seen in three-quarter
  // view, so a foot's sideways movement shows on screen too)
  private stride = new Map<string, number[]>();
  // Turn around: how far it rotates and the point it pivots on (frog lengths).
  private turnAngle = Math.PI;
  private turnPivot = new THREE.Vector3();
  private rootBone?: THREE.Object3D; // the skeleton's root, which some clips move
  private arms: Arm[] = []; // front legs, for lifting the elbows in the crawl
  private unlift?: () => void; // puts the arms back as the mixer left them
  private headBone?: THREE.Object3D; // for which way is forward in the arm fixes
  private bodyBone?: THREE.Object3D;
  // Copies of clips that move the whole body, minus that movement, to blend
  // out of once the movement has been handed over to the frog itself.
  private stillCopies = new Map<ClipKey, THREE.AnimationAction>();
  // Turn around: when its turning is done (it then tucks in, built in), and
  // the crawl phase closest to its pose at that moment.
  private turnMoveEnd = 0;
  private turnToCrawlAt = 0;
  private turnThenMove = false;
  // The 90-degree turn family: which part is playing, its measured turns
  // (radians), when Continue turn 90 stops turning, and the crawl phases that
  // best match the poses it can move off from.
  private turnStage: "quarter" | "more" | "back" | "settle90" | "second" | null = null;
  private quarterQ: THREE.Quaternion | null = null; // facing held while paused at 90 degrees
  private afterQuarterPause = false;
  private yaw = new Map<ClipKey, number>();
  private moreMoveEnd = 0;
  private crawlAfterMore = 0;
  private crawlAfterQuarter = 0;
  // Wall landing starts with the body out from the wall: where its root bone
  // starts relative to where it ends (frog lengths, in the frog's own frame).
  private wallApproach = new THREE.Vector3();
  // The body's offset from where Wall landing ends, through the clip (frog lengths).
  private wallApproachCurve: { t: number; at: THREE.Vector3 }[] = [];
  private wallArrival = { contact: new THREE.Vector3(), approach: new THREE.Vector3(), total: 0, rate: 1, elapsed: 0 };
  private wallContactTime = 0; // when in Wall landing the body reaches the wall (clip seconds)
  // When each landing clip's movement is over (it just holds the pose after
  // that), so the next animation can start straight away.
  private jumpStill = 0;
  private wallLandStill = 0;
  // Transition clips that hold still at their start or end: the stretch in
  // between where they actually move (clip seconds). Playback skips the holds.
  private moving = new Map<ClipKey, [number, number]>();
  // Spread through a turn: from the starting orientation, the extra rotation
  // that leaves it facing properly at the end, and the turn's length (s).
  private turnFix?: { start: THREE.Quaternion; delta: THREE.Quaternion; total: number };
  // Turns: fastest limb speed through each clip (frog lengths per clip
  // second, every LIMB_STEP), the turn's playback rate, and this frame's pace.
  private limbSpeed = new Map<ClipKey, number[]>();
  private turnRate = 1;
  private turnPace = 1;
  // Wall turn to look down: its swivel (about the wall normal) and pivot.
  private peekAngle = 0;
  private peekPivot = new THREE.Vector3();
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
  // Jumping's ground contact, measured from the clip (times in clip seconds,
  // distances in frog lengths). During the push the back feet stay planted,
  // so the body moves forward exactly as far as they extend back; on landing
  // the front feet stay planted as they draw back under the body. In between,
  // the frog flies the rest of the way.
  private push = { start: 0, end: 0, curve: [] as [number, number][] };
  private land = { start: 0, end: 0, curve: [] as [number, number][] };
  // Jumping: how far the skin's lowest point dips below the feet's surface at
  // each moment (frog lengths, positive = below), so the flight lifts the
  // frog only just enough to keep it clear.
  private dip: [number, number][] = [];

  private jump = {
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    launch: new THREE.Quaternion(),
    takeoff: new THREE.Quaternion(),
    landing: new THREE.Quaternion(),
    flight: new THREE.Quaternion(), // nose along the line of the leap
    air: 0.15, // seconds airborne
    pushDist: 0, // world units covered by the push, the flight and the landing
    // Flight speed at take-off and touch-down, as a share of its average.
    flyV0: 0,
    pushRate: 1, // jump clip playback speed during the push
    fromWall: false,
    pushPath: [] as [number, number][], // distance pushed (world units) by clip time
    pushLegPath: [] as [number, number][], // ...of which with the feet planted
    launchDir: new THREE.Vector3(), // which way the flight sets off
    flyV1: 0,
    flyDist: 0,
    landDist: 0,
    // The push slides along the take-off surface and the landing along the
    // one it lands on (feet stay on them); only the flight goes between.
    pushDir: new THREE.Vector3(),
    landDir: new THREE.Vector3(),
    flyFrom: new THREE.Vector3(),
    flyTo: new THREE.Vector3(),
    surface: undefined as Surface | undefined,
    s: 0,
    dir: 1 as 1 | -1,
    tookOff: false,
    landed: false,
    toWall: false, // finishes with Wall landing instead of the jump's own landing
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

  update(dt: number) {
    if (!this.mixer || !this.surface) return;
    this.unlift?.();
    this.unlift = undefined;
    this.mixer.update(dt);
    // Crawling and climbing (the same gait, laid on the wall): tuck the "in"
    // arm closer and stand the forearms up off the surface. Right after the
    // mixer, while the gait's weight matches the pose it just made.
    const gait = this.actions.get(this.onWall() ? "wallClimb" : "crawl");
    const weight = gait?.isRunning() ? gait.getEffectiveWeight() : 0;
    if (weight > 0 && this.headBone && this.bodyBone) {
      this.root.updateMatrixWorld(true);
      const forward = this.headBone.getWorldPosition(new THREE.Vector3()).sub(this.bodyBone.getWorldPosition(new THREE.Vector3()));
      this.unlift = poseArms(this.arms, UP.clone().applyQuaternion(this.root.quaternion), forward, weight * ELBOW_LIFT, weight);
    }
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
      case "pausing":
        // Back to it: on a wall via Wall start crawl (startCrawl handles that), on the floor by unfolding.
        if (this.timer <= 0) this.onWall() ? this.startCrawl() : this.unfoldThen(() => this.resumeBurst());
        break;
      case "crawling":
        this.crawl(dt);
        break;
      case "turning":
        this.paceTurn(dt);
        if (this.turnFix) {
          const { start, delta, total } = this.turnFix;
          const p = THREE.MathUtils.clamp(1 - this.timer / total, 0, 1);
          const eased = p * p * (3 - 2 * p);
          this.root.quaternion.copy(new THREE.Quaternion().slerp(delta, eased).multiply(start));
        }
        if (this.timer <= 0) {
          this.turnFix = undefined;
          if (this.turnStage) this.nextQuarterStage();
          else this.finishTurn();
        }
        break;
      case "jumping":
        this.updateJump(dt);
        return; // the jump steers its own orientation
      case "looking":
        if (this.timer <= 0) {
          if (this.afterQuarterPause) {
            this.afterQuarterPause = false;
            this.quarterTurn("second");
          } else if (this.resumeAfterLook) {
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
      case "sequence":
        if (this.timer <= 0) this.playNext();
        break;
      case "wallLanding":
        this.updateWallLanding(dt);
        return; // the clip owns the approach
    }


    // Not gripping hard while it sits on a wall: it slowly slips down.
    const sitting = this.state === "resting" || this.state === "looking" || (this.state === "sequence" && !this.peeking);
    if (sitting && this.onWall()) {
      // Walls run bottom (a) to top (b), so down is toward smaller s.
      this.s = this.clampS(this.surface, this.s - WALL_SLIDE * this.length * dt);
      this.root.position.copy(this.pointOn(this.surface, this.s));
      // Slipped a fair way while awake: scramble back up to where it was.
      if (this.state !== "resting" && this.wallHold - this.s > this.length * WALL_REGRIP) {
        this.resumeAfterLook = false;
        this.queue = [];
        this.afterQueue = undefined;
        return this.crawlTo(this.wallHold);
      }
    } else if (this.onWall()) this.wallHold = this.s;

    // Ease toward facing along the surface (turning clips own it meanwhile).
    if (this.state !== "turning" && !(this.state === "sequence" && this.peeking)) {
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
      if (state === "looking" && clip !== "look" && this.actions.has("wallLeanOut") && Math.random() < WALL_LOOKOUT_CHANCE) {
        // Lean out off the wall, hold a lookout, lean back in, then decide.
        return this.sequence(
          [
            { key: "wallLeanOut", hold: 0 },
            { key: "wallLookout", hold: 1.5 + Math.random() * 2 },
            { key: "wallLeanBack", hold: 0 },
          ],
          () => this.decide(),
        );
      }
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

  private peeking = false; // in the middle of Wall turn to look down

  /** Plays clips back to back (each held `hold` seconds past its end), then `done`. */
  private sequence(steps: { key: ClipKey; hold: number }[], done: () => void) {
    this.queue = steps.filter((x) => this.actions.has(x.key));
    this.afterQueue = done;
    this.state = "sequence";
    this.playNext();
  }

  private playNext() {
    const step = this.queue.shift();
    if (!step) {
      const done = this.afterQueue;
      this.afterQueue = undefined;
      return done ? done() : this.enter("looking");
    }
    this.state = "sequence";
    this.timer = this.play(step.key) + step.hold;
  }

  /**
   * Before dropping off a wall: swivel round to peek down, then leap from
   * that pose. The swivel happens inside the clip, so when it ends it's moved
   * onto the frog itself (about the same pivot) and the leap starts from there.
   */
  private peekThenDrop(surface: Surface, s: number) {
    if (!WALL_PEEK || !this.actions.has("wallTurnDown") || Math.abs(this.peekAngle) < 0.1) return this.jumpTo(surface, s);
    this.peeking = true;
    this.sequence([{ key: "wallTurnDown", hold: 0.2 }], () => {
      this.peeking = false;
      const spin = new THREE.Quaternion().setFromAxisAngle(UP, this.peekAngle);
      const shift = this.peekPivot
        .clone()
        .sub(this.peekPivot.clone().applyQuaternion(spin))
        .multiplyScalar(this.length)
        .applyQuaternion(this.root.quaternion);
      this.s = this.clampS(this.surface!, this.s + shift.dot(tangentOf(this.surface!)));
      this.root.position.copy(this.pointOn(this.surface!, this.s));
      this.root.quaternion.multiply(spin);
      this.jumpTo(surface, s, false, true);
    });
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
    // How far it could travel along this surface; short perches (the name) still get short crawls.
    const room = lengthOf(here) - this.length;
    const canRoam = room > this.length * 0.25;
    // Mostly keeps going the way it faces; it only turns round when it's run out of room ahead
    // (or now and then on a whim), so turning stays an event rather than a habit.
    const roam = () => {
      const len = lengthOf(here);
      const margin = Math.min(this.length * 0.25, len / 2);
      const ahead = this.dir === 1 ? len - margin - this.s : this.s - margin;
      const far = Math.min(Math.max(this.length * 2, this.world.scale() * 0.3), room * 0.7);
      if (ahead > this.length * 0.4 && Math.random() > TURN_CHANCE) {
        const d = Math.min(ahead, far * (0.6 + Math.random() * 0.8));
        return this.crawlTo(this.s + this.dir * d);
      }
      // Out of room ahead on a perch: usually move on to somewhere else rather than turn round here.
      if (here.id !== "floor" && Math.random() < LEAVE_PERCH) return this.leap();
      this.crawlTo(this.randomS(here, far));
    };
    const sleepy = !fresh && Math.random() < (here.id === "floor" ? 0.18 : 0.12);
    if (sleepy) return this.goToSleep();
    // Moves unfold the legs themselves (or turn round tucked first).
    this.move(r, roam, canRoam);
  }

  private move(r: number, roam: () => void, canRoam: boolean) {
    const here = this.surface!;
    if (here.id === "floor") {
      // Mostly crawls about; climbs a wall or jumps now and then.
      if (r < 0.2) this.climbWall();
      else if (r < 0.85 && canRoam) roam();
      else if (r < 0.92) this.hop();
      else this.leap();
    } else if (here.id.startsWith("wall")) {
      // Frogs crawl up walls but jump to get down.
      const above = this.clampS(here, lengthOf(here)) - this.s;
      // (No hops along a wall: on a wall it only uses the wall poses.)
      if (r < 0.62 && above > this.length * 1.5) this.climbUp();
      else this.leap(true);
    } else if (r < 0.8 && canRoam) roam();
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
    // Close to the wall already: land lower on it, so the hop stays a gentle
    // angle (under about 40 degrees) instead of shooting straight up.
    const across = Math.abs(hop.surface.a.x - this.root.position.x);
    const landing = this.clampS(hop.surface, Math.min(hop.s, across * 0.85));
    this.goal = Math.max(hop.goal, landing);
    this.resumeCrawl = this.goal - landing > this.length * 0.1; // then climb on up
    this.jumpTo(hop.surface, landing);
  }

  /**
   * On big pages the frog is small next to the space it has, so it scurries a
   * bit quicker (up to 1.2x). Its feet still set its speed, so they don't skate.
   */
  private pagePace() {
    return THREE.MathUtils.clamp(this.world.scale() / (this.length * 5), 1, 1.2);
  }

  /** A random hop length (world units) within `range` of the page size. */
  private hopDistance([lo, hi]: number[]) {
    const page = this.world.scale() * (lo + Math.random() * (hi - lo));
    return Math.min(this.world.reach(), Math.max(this.length * MIN_HOP_LENGTHS, page));
  }

  /**
   * How far above the straight line from `from` to `to` a leap is at
   * progress `u`: a low arc, or leaping down, a launch just above level and
   * a fall the rest of the way (as gravity would have it).
   */
  private leapLift(from: THREE.Vector3, to: THREE.Vector3, u: number, fromWall: boolean) {
    const arc = this.arcHeight(from.distanceTo(to));
    // (Off a wall it pushes out along the leap itself, so no launch arc.)
    const drop = fromWall ? 0 : from.y - to.y;
    const fall = drop > 0 ? Math.abs(to.x - from.x) * Math.tan(DROP_LAUNCH_ANGLE) + drop : 0;
    return fall / 4 > arc ? fall * u * (1 - u) : arc * arcShape(u);
  }

  /** How far a leap of `dist` rises above the straight line: only a little. */
  private arcHeight(dist: number) {
    return THREE.MathUtils.clamp(dist * JUMP_ARC, this.length * JUMP_LIFT_MIN, this.length * JUMP_LIFT_MAX);
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
    const clear = this.pathClear(this.root.position, p);
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
      // Hopping down is mostly falling, so only the sideways part counts toward reach.
      if (Math.abs(p.x - this.root.position.x) > this.world.reach() || !this.dropOk(p) || !this.pathClear(this.root.position, p)) continue;
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
    if (!PREFER_FULL_TURN && this.actions.has("turn90") && this.actions.has("turn90More")) return this.quarterTurn("quarter");
    this.state = "turning";
    const full = this.play("turn", TURN_ANIM_SPEED);
    this.turnRate = TURN_ANIM_SPEED;
    this.turnPace = 1;
    // Turning in order to move off: stop once it's turned (before the clip's
    // own tuck) and go straight into the crawl. Otherwise let it tuck in.
    this.turnThenMove = this.turnMoveEnd > 0;
    this.timer = (this.turnThenMove ? this.turnMoveEnd : full) / TURN_ANIM_SPEED;
    // The clip turns the body 180 degrees, which would leave it angled away
    // from the viewer (it normally sits angled toward them). Fold that
    // correction into the turn itself, a little at a time, rather than
    // swivelling (and sliding the feet) once the turn is over.
    const q0 = this.root.quaternion.clone();
    const ending = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.turnAngle));
    const wanted = this.facing(this.surface!, this.dir === 1 ? -1 : 1);
    this.turnFix = { start: q0, delta: wanted.multiply(ending.invert()), total: this.timer };
  }

  private startCrawl() {
    // On a wall, setting off from the cling stance eases into the climbing
    // gait with Wall start crawl first (unless it's already climbing).
    const climbing = this.current === this.actions.get("wallClimb");
    if (this.onWall() && !climbing && this.actions.has("wallStart") && this.state !== "waking") {
      this.state = "waking";
      this.then = () => this.startCrawl();
      this.timer = this.play("wallStart", 1, WALL_BLEND) - WALL_BLEND;
      return;
    }
    this.state = "crawling";
    this.play(this.travelClip(), 1, this.onWall() ? WALL_BLEND : FADE);
    // Each trip gets its own pace: mostly an amble, sometimes a scurry.
    this.gait = Math.random() < 0.2 ? 1.25 + Math.random() * 0.15 : 0.8 + Math.random() * 0.4;
    this.gaitPhase = Math.random() * Math.PI * 2;
    this.startBurst(1);
  }

  /** Back into the crawl after a tucked pause between bursts. */
  private resumeBurst() {
    this.state = "crawling";
    this.play(this.travelClip(), 1, FADE);
    this.startBurst(1);
  }

  /** Sets off on a couple of steps. */
  private startBurst(pace = 0) {
    const [lo, hi] = BURST_STEPS;
    this.burst = { going: true, steps: lo + Math.floor(Math.random() * (hi - lo + 1)), left: 0, pace, last: this.current?.time ?? 0 };
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
    const wobble = 1 + 0.15 * Math.sin(this.clock * 0.8 + this.gaitPhase);
    // (Wall climbing whose steps really carry the frog is paced by its feet
    // like the crawl; a tiny in-place gait uses the fixed climbing speed.)
    const climbing = this.travelClip() === "wallClimb" && this.strideOf("wallClimb") < MIN_CLIMB_STRIDE;
    const burst = this.burst;
    const t = this.current?.time ?? 0;
    if (burst.going) {
      // Count the steps as they finish (the clip loops, so allow for wrapping),
      // and stop with the feet set once the burst's steps are done.
      const ends = this.stepEnds.get(this.travelClip()) ?? [];
      const done = ends.some((e) => (burst.last <= t ? e > burst.last && e <= t : e > burst.last || e <= t));
      if (done && --burst.steps <= 0) {
        burst.going = false;
        burst.pace = 0;
        burst.left = BURST_REST[0] + Math.random() * (BURST_REST[1] - BURST_REST[0]);
        const rest = burst.left;
        if (this.onWall()) {
          // On a wall, pause in the cling stance rather than frozen mid-step.
          this.grip();
          this.state = "pausing";
          this.timer = rest;
          return;
        }
        // On the floor, pause tucked in, legs folded.
        this.settleThen(() => {
          this.state = "pausing";
          this.timer = rest;
        }, BURST_TUCK_SPEED);
        return;
      }
    } else if ((burst.left -= dt) <= 0) this.startBurst();
    burst.last = t;
    if (burst.going) burst.pace += (BURST_FAST - burst.pace) * (1 - Math.exp(-dt * 14));
    const onWallClip = this.travelClip() === "wallClimb";
    const timeScale =
      burst.pace *
      (climbing
        ? WALL_CLIMB_ANIM_SPEED * this.gait * wobble
        : onWallClip
          ? Math.min(WALL_CLIMB_MAX_SPEED, WALL_CLIMB_CLIP_SPEED * this.gait * wobble * this.pagePace())
          : Math.min(CRAWL_MAX_SPEED, CRAWL_ANIM_SPEED * this.gait * wobble * this.pagePace()));
    if (this.current) this.current.timeScale = timeScale;
    // Travel exactly as far as the planted feet push, so they don't skate
    // (wall climbing's steps are too small for that; see WALL_CLIMB_SPEED).
    const speed = climbing
      ? this.length * WALL_CLIMB_SPEED * this.gait * wobble
      : this.length * this.strideAt() * timeScale * (onWallClip ? WALL_CLIMB_TRAVEL : CRAWL_TRAVEL);
    this.s += this.dir * Math.min(speed * dt, remaining);
    this.root.position.copy(this.pointOn(this.surface!, this.s));
  }

  /**
   * Turn around rotates the model inside its clip. When it ends, move that
   * rotation onto the frog itself (about the same pivot) and cut straight to
   * the next clip, so nothing visibly snaps back.
   */
  /**
   * The 90-degree turn family. "quarter" turns 90 and ends braced; from there
   * it carries on round ("more"), tucks in facing 90 degrees and looks about
   * ("settle90", then "second" turns the rest of the way), or turns back
   * ("back") and does something else. The clips share one root anchor, so
   * the whole-body movement is only handed over to the frog when a branch ends.
   */
  private quarterTurn(stage: "quarter" | "more" | "back" | "settle90" | "second") {
    const key = { quarter: "turn90", second: "turn90", more: "turn90More", back: "turn90Back", settle90: "turn90Settle" }[
      stage
    ] as ClipKey;
    this.turnStage = stage;
    this.state = "turning";
    // Branches start exactly where Turn 90 ends: cut straight over.
    const fade = stage === "more" || stage === "back" || stage === "settle90" ? 0 : FADE;
    const full = this.play(key, QUARTER_ANIM_SPEED, fade);
    this.turnRate = QUARTER_ANIM_SPEED;
    this.turnPace = 1;
    const moving = !!this.afterTurn;
    const stopAt = stage === "more" && moving && this.moreMoveEnd ? this.moreMoveEnd : full;
    this.timer = stopAt / QUARTER_ANIM_SPEED;
    // Ending up facing the other way: fold in the view-angle correction (see
    // the full turn) a little at a time over this last part of the turn.
    if (stage === "more" || stage === "second") {
      const q0 = this.root.quaternion.clone();
      const angle = stage === "more" ? (this.yaw.get("turn90") ?? 0) + (this.yaw.get("turn90More") ?? 0) : this.yaw.get("turn90") ?? 0;
      const ending = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, angle));
      const wasQuarter = this.quarterQ;
      this.quarterQ = null;
      const wanted = this.facing(this.surface!, this.dir === 1 ? -1 : 1);
      this.quarterQ = wasQuarter;
      this.turnFix = { start: q0, delta: wanted.multiply(ending.invert()), total: this.timer };
    }
  }

  private nextQuarterStage() {
    const stage = this.turnStage;
    const moving = !!this.afterTurn;
    if (stage === "quarter") {
      const r = Math.random();
      if (r < QUARTER_CONTINUE) return this.quarterTurn("more");
      if (r < QUARTER_CONTINUE + QUARTER_PAUSE) return this.quarterTurn("settle90");
      return this.quarterTurn("back");
    }
    this.turnStage = null;
    if (stage === "settle90") {
      // Tucked, facing 90 degrees: look about (or just wait), then go on round.
      this.handOff("turn90Settle", "alert");
      this.tucked = true;
      this.quarterQ = this.root.quaternion.clone();
      this.afterQuarterPause = true;
      return this.enter("looking");
    }
    if (stage === "back") {
      // Changed its mind: back where it started, tucked; do something else.
      this.handOff("turn90Back", "alert");
      this.tucked = true;
      this.quarterQ = null;
      this.afterTurn = undefined;
      return this.enter("looking");
    }
    // "more" or "second": now facing the other way.
    const from: ClipKey = stage === "more" ? "turn90More" : "turn90";
    const phase = stage === "more" ? this.crawlAfterMore : this.crawlAfterQuarter;
    if (moving) {
      this.handOff(from, "crawl", phase);
      this.tucked = false;
    } else {
      this.handOff(from, "alert");
      this.tucked = true;
    }
    this.quarterQ = null;
    this.dir = this.dir === 1 ? -1 : 1;
    const then = this.afterTurn;
    this.afterTurn = undefined;
    if (then) then();
    else this.enter("looking");
  }

  /**
   * Slows the current turn clip through its quick steps (see TURN_LIMB_MAX).
   * The turn's timer counts clip time at the normal rate, so give back the
   * share of this frame the clip didn't play.
   */
  private paceTurn(dt: number) {
    this.timer += dt * (1 - this.turnPace);
    const action = this.current;
    const key = [...this.actions].find(([, a]) => a === action)?.[0];
    const speeds = key && this.limbSpeed.get(key);
    if (!action || !speeds) return void (this.turnPace = 1);
    const v = speeds[Math.min(speeds.length - 1, Math.round(action.time / LIMB_STEP))] * this.turnRate;
    this.turnPace = THREE.MathUtils.clamp(TURN_LIMB_MAX / Math.max(v, 1e-6), TURN_MIN_PACE, 1);
    action.timeScale = this.turnRate * this.turnPace;
  }

  /**
   * How fast the quickest limb moves through a clip, in frog lengths per clip
   * second, every LIMB_STEP. Each value is the fastest within a short window
   * around it, so the slow-down starts a little before a quick step.
   */
  private measureLimbSpeed(model: THREE.Object3D, key: ClipKey) {
    const action = this.actions.get(key);
    if (!action) return;
    const limbs: THREE.Object3D[] = [];
    model.traverse((o) => (o as THREE.Bone).isBone && o.name !== "root" && limbs.push(o));
    const duration = action.getClip().duration;
    action.reset().setEffectiveWeight(1).play();
    const raw: number[] = [];
    let prev: THREE.Vector3[] | undefined;
    for (let t = 0; t <= duration; t += LIMB_STEP) {
      action.time = Math.min(t, duration - 1e-4);
      this.mixer!.update(0);
      this.root.updateMatrixWorld(true);
      const now = limbs.map((b) => this.local(b));
      raw.push(prev ? Math.max(...now.map((p, i) => p.distanceTo(prev![i]))) / LIMB_STEP : 0);
      prev = now;
    }
    action.stop();
    const reach = Math.round(0.08 / LIMB_STEP);
    this.limbSpeed.set(
      key,
      raw.map((_, i) => Math.max(...raw.slice(Math.max(0, i - reach), i + reach + 1))),
    );
  }

  private finishTurn() {
    // Carry over wherever the turn left the body (it rotates and steps it
    // along), then either crawl straight off or sit tucked, as the clip ends.
    if (this.turnThenMove) {
      this.handOff("turn", "crawl", this.turnToCrawlAt);
      this.tucked = false;
    } else {
      this.handOff("turn", "alert");
      this.tucked = true;
    }
    this.dir = this.dir === 1 ? -1 : 1;
    const then = this.afterTurn;
    this.afterTurn = undefined;
    if (then) then();
    else this.enter("looking");
  }

  /**
   * Moves on from `from`, a clip that moves the whole body itself (via the
   * skeleton's root bone, e.g. Turn around), to `key` without any snap:
   * wherever the root bone ended up is moved onto the frog, so the body stays
   * exactly where the clip left it. It then blends to `key` from a copy of
   * `from` with that movement taken out, so it isn't applied twice.
   */
  private handOff(from: ClipKey, key: ClipKey, startAt = 0) {
    const bone = this.rootBone;
    const moving = this.actions.get(from);
    const still = this.stillCopies.get(from);
    if (!bone || !this.mixer || !moving || !still) return void this.play(key, 1, 0, startAt);
    this.root.updateMatrixWorld(true);
    const toFrog = this.root.matrixWorld.clone().invert();
    const end = toFrog.clone().multiply(bone.matrixWorld);
    // Swap to the still copy at the same moment, which leaves the root at rest.
    const t = moving.time;
    moving.stop();
    still.reset().setEffectiveWeight(1).setEffectiveTimeScale(0).play();
    still.time = t;
    this.current = still;
    this.unlift?.();
    this.unlift = undefined;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const rest = toFrog.clone().multiply(bone.matrixWorld);
    // New frog = frog * end * rest^-1, so the root bone lands where it was.
    const m = this.root.matrixWorld.clone().multiply(end).multiply(rest.invert());
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    m.decompose(pos, quat, new THREE.Vector3());
    // Stay on the surface: only the along-surface part of any step counts.
    const here = this.pointOn(this.surface!, this.s);
    this.s = this.clampS(this.surface!, this.s + pos.sub(here).dot(tangentOf(this.surface!)));
    this.root.position.copy(this.pointOn(this.surface!, this.s));
    this.root.quaternion.copy(quat);
    this.play(key, 1, FADE, startAt);
  }

  /** A hop forward mid-crawl; it resumes crawling to the same goal on landing. */
  private hopAlong(distance: number) {
    this.resumeCrawl = true;
    this.jumpTo(this.surface!, this.clampS(this.surface!, this.s + this.dir * distance));
  }

  // ---- Jumping -------------------------------------------------------------

  /**
   * Leaps to a random spot on another surface, favoring short leaps ahead of it.
   */
  private leap(downward = false, stretch = 1) {
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
      const span = downward || p.y < this.root.position.y - this.length ? Math.abs(p.x - this.root.position.x) : dist;
      if (dist < Math.max(this.length * 1.5, this.world.scale() * JUMP_MIN) || span > this.world.reach() * stretch) continue;
      if (!this.pathClear(this.root.position, p)) continue;
      if (downward && p.y > this.root.position.y - this.length) continue;
      // No steep leaps upward (rocketing onto something overhead). Steep drops
      // are fine: they're mostly falling, and the body stays nearly level.
      const rise = p.y - this.root.position.y;
      const angle = Math.atan2(Math.abs(rise), Math.abs(p.x - this.root.position.x));
      if (angle > MAX_LEAP_ANGLE && rise > 0) continue;
      if (isWall(here) ? angle < MIN_WALL_LEAP_ANGLE : !this.dropOk(p)) continue;
      // Mostly random, but frogs rarely choose a long leap, and would rather
      // jump the way they're facing than turn round first.
      const along = p.clone().sub(this.root.position).dot(tangentOf(here));
      const ahead = isWall(here) || Math.abs(along) < this.length * 0.3 || Math.sign(along) === this.dir;
      const score = (Math.random() / (1 + dist / (this.length * 1.5))) * (ahead ? 1 : 0.25);
      if (score > bestScore) {
        bestScore = score;
        best = { surface, s };
      }
    }
    // Dropping off a wall, it turns head-down first (it can't push off
    // downward facing up).
    if (best && isWall(here) && this.pointOn(best.surface, best.s).y < this.root.position.y) this.peekThenDrop(best.surface, best.s);
    else if (best) this.jumpTo(best.surface, best.s);
    // Nothing in range: on a wall, climb (never crawl down); elsewhere wander along.
    else if (isWall(here)) {
      if (this.clampS(here, lengthOf(here)) - this.s > this.length) this.climbUp();
      else if (stretch === 1) this.leap(downward, LEAP_STRETCH);
      else this.enter("looking");
    } else if (lengthOf(here) - this.length > this.length * 1.5) this.crawlTo(this.randomS(here, this.length));
    // Stranded (e.g. on a short ledge with everything just out of reach):
    // one bigger leap rather than looking around forever.
    else if (stretch === 1) this.leap(downward, LEAP_STRETCH);
    else this.enter("looking");
  }

  /** Whether a leap down to `p` (if it is down) hops out far enough to fall there. */
  private dropOk(p: THREE.Vector3) {
    const drop = this.root.position.y - p.y;
    const out = Math.abs(p.x - this.root.position.x);
    return drop <= this.length * 0.5 || (out >= this.length && Math.atan2(drop, out) <= MAX_DROP_ANGLE);
  }

  /**
   * Whether a leap from `from` to `to` would stay clear of the text: checks
   * the frog's body along the arc, skipping the very ends where it's sitting.
   */
  private pathClear(from: THREE.Vector3, to: THREE.Vector3) {
    const fromWall = this.onWall();
    const L = this.length;
    const p = new THREE.Vector3();
    for (let u = 0.1; u <= 0.9; u += 0.1) {
      p.lerpVectors(from, to, u).addScaledVector(UP, this.leapLift(from, to, u, fromWall));
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
   * If the spot is behind it, it turns round properly first.
   */
  private jumpTo(surface: Surface, s: number, turned = false, fromHere = false) {
    // Leaping off from partway round a turn: it squares up as it crouches.
    this.quarterQ = null;
    this.afterQuarterPause = false;
    const behind = this.pointOn(surface, s).sub(this.root.position).dot(tangentOf(this.surface!)) * this.dir;
    if (!turned && !this.onWall() && behind < -this.length * 0.3) {
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
    // (After peeking down off a wall it launches from the pose it's already in.)
    j.launch.copy(fromHere ? this.root.quaternion : this.facing());
    // ...and land still heading the same way, along the new surface.
    const onward = d.dot(tangentOf(surface));
    j.dir = Math.abs(onward) > this.length * 0.1 ? (onward > 0 ? 1 : -1) : Math.random() < 0.5 ? 1 : -1;
    if (surface.id.startsWith("wall")) j.dir = 1; // always cling facing up
    j.landing.copy(this.facing(surface, j.dir));
    // Mid-air the body angles along the leap, back toward the sky, but never
    // tips more than FLIGHT_PITCH from level (no nose-dives or straight-up rockets).
    const line = this.flightLine(d);
    const back = UP.clone().addScaledVector(line, -UP.dot(line)).normalize();
    j.flight.copy(this.frame(back, line));
    j.surface = surface;
    j.s = s;

    const dist = d.length();
    // Time aloft grows with the leap relative to the page, not in raw pixels.
    j.air = 0.07 + (dist / this.world.scale()) * 0.2;
    // The push and the landing cover their own (fixed) bit of ground; the
    // flight covers the rest. On a hop too short for both, shrink them to fit.
    const pushL = this.curveEnd(this.push.curve) * this.length;
    const landL = this.curveEnd(this.land.curve) * this.length;
    const fit = Math.min(1, (dist * 0.6) / Math.max(pushL + landL, 1e-6));
    j.pushDist = pushL * fit;
    j.landDist = landL * fit;
    j.flyDist = dist - j.pushDist - j.landDist;
    // The push: the body never goes slower than the legs straighten (so the
    // feet stay planted), and partway through it starts taking off, picking
    // up to flying speed by the time they're straight; the feet come away
    // before the legs have finished. (Taking off covers more ground, which
    // comes out of the flight, which slows it a little: settle on a speed.)
    j.pushRate = Math.max(1, (this.push.end - this.push.start) / JUMP_PUSH_TIME);
    const legScale = j.pushDist / Math.max(this.curveEnd(this.push.curve), 1e-6);
    const { start: p0, end: p1 } = this.push;
    const liftFrom = p0 + (p1 - p0) * JUMP_LIFT_FROM;
    const steps = 24;
    // It takes off at the speed the flight sets off at: leaping down, that's
    // only the sideways part (the drop comes from falling).
    j.fromWall = this.onWall();
    const launch = d.clone().multiplyScalar(0.02).addScaledVector(UP, this.leapLift(j.from, j.to, 0.02, j.fromWall));
    const launchShare = launch.length() / 0.02 / Math.max(dist, 1e-6);
    for (let pass = 0; pass < 3 && this.push.curve.length; pass++) {
      const cruise = (Math.max(j.flyDist, 0) / j.air) * launchShare;
      const path: [number, number][] = [[p0, 0]];
      const legPath: [number, number][] = [[p0, 0]];
      let at = 0;
      let legAt = 0;
      let speed = 0; // (only ever building up)
      for (let i = 0; i < steps; i++) {
        const t0 = p0 + ((p1 - p0) * i) / steps;
        const t1 = p0 + ((p1 - p0) * (i + 1)) / steps;
        const dt = (t1 - t0) / j.pushRate;
        const leg = ((this.curveAt(this.push.curve, t1) - this.curveAt(this.push.curve, t0)) * legScale) / dt;
        const x = THREE.MathUtils.clamp(((t0 + t1) / 2 - liftFrom) / (p1 - liftFrom), 0, 1);
        speed = Math.max(speed, leg, cruise * x * x * (3 - 2 * x));
        at += speed * dt;
        legAt += leg * dt;
        path.push([t1, at]);
        legPath.push([t1, legAt]);
      }
      j.pushPath = path;
      j.pushLegPath = legPath;
      j.pushDist = Math.min(at, dist - j.landDist - this.length * 0.1);
      j.flyDist = dist - j.pushDist - j.landDist;
    }
    // Along each surface, the way the frog is facing on it: the feet stay on
    // the surface even when the leap itself goes steeply up or down.
    // The push drives the body the way it's actually facing (it's turned a
    // little toward the viewer), as the clip's own root does, so both planted
    // feet stay put; any depth this adds is taken back out in the flight.
    const forward = new THREE.Vector3(Math.sin(this.facingOffset), 0, Math.cos(this.facingOffset)).applyQuaternion(j.launch);
    const n = this.surface!.normal;
    forward.addScaledVector(n, -forward.dot(n)).normalize();
    j.pushDir.copy(forward.lengthSq() > 0.5 ? forward : tangentOf(this.surface!).multiplyScalar(this.dir));
    // Off a wall the legs shove it away from the wall: straight out along the leap.
    if (j.fromWall) j.pushDir.copy(d).normalize();
    j.landDir.copy(tangentOf(surface).multiplyScalar(j.dir));
    j.flyTo.copy(j.to).addScaledVector(j.landDir, -j.landDist);
    // Leave the ground at full speed (the push is the launch) and arrive at
    // the landing's own speed, so it doesn't lurch into the landing.
    const avg = Math.max(j.flyDist, 1e-6) / j.air;
    const c = this.land.curve;
    const landSpeed = c.length < 2 ? 0 : ((c[1][1] - c[0][1]) / Math.max(c[1][0] - c[0][0], 1e-6) / Math.max(this.curveEnd(c), 1e-6)) * j.landDist * JUMP_LAND_SPEED;
    j.flyV0 = 1;
    j.flyV1 = THREE.MathUtils.clamp(landSpeed / avg, 0, 1);
    // Onto a wall: fly to where Wall landing starts (out from the wall), and
    // let that clip carry it the rest of the way in.
    j.toWall = surface.id.startsWith("wall") && this.actions.has("wallLand");
    if (j.toWall) {
      this.wallArrival.contact.copy(j.to);
      this.wallArrival.approach.copy(this.wallApproach).applyQuaternion(j.landing).multiplyScalar(this.length);
      j.flyTo.copy(j.to).add(this.wallArrival.approach);
      j.flyV1 = 1; // Wall landing carries on at the flying speed
    }
    // The planted part of the push runs along the surface; the rest (taking
    // off ahead of the legs) already heads the way the flight sets off, so
    // the body curves up off the ground rather than turning at once.
    const legDist = Math.min(this.curveEnd(j.pushLegPath), j.pushDist);
    j.launchDir
      .lerpVectors(j.from, j.flyTo, 0.02)
      .addScaledVector(UP, this.leapLift(j.from, j.flyTo, 0.02, j.fromWall))
      .sub(j.from)
      .normalize();
    j.flyFrom.copy(j.from).addScaledVector(j.pushDir, legDist).addScaledVector(j.launchDir, j.pushDist - legDist);
    j.tookOff = j.landed = false;
    this.state = "jumping";
    // From a tuck, start in the clip's crouch, early enough that the blend in
    // is finished before the push: the push only works with the legs fully in
    // the clip's pose (mid-blend they'd extend less than the body moves).
    const fade = fromTuck ? 0.1 : 0.15;
    const lead = fade * JUMP_CROUCH_SPEED + 0.05;
    const startAt = fromTuck ? Math.max(0, Math.min(this.jumpCrouch, this.push.start - lead)) : 0;
    this.play("jump", JUMP_CROUCH_SPEED, fade, startAt);
  }

  /** The leap's direction, tilted no more than FLIGHT_PITCH from level. */
  private flightLine(d: THREE.Vector3) {
    // Which way is "forward, level": along the leap if it goes sideways at
    // all, otherwise out from a wall or the way it's facing.
    let side = Math.sign(d.x);
    if (Math.abs(d.x) < this.length * 0.05) {
      const n = this.surface!.normal;
      side = Math.abs(n.x) > 0.5 ? Math.sign(n.x) : Math.sign(tangentOf(this.surface!).x * this.dir) || 1;
    }
    const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.abs(d.x)), -FLIGHT_PITCH, FLIGHT_PITCH);
    return new THREE.Vector3(side * Math.cos(pitch), Math.sin(pitch), 0);
  }

  private updateJump(dt: number) {
    const j = this.jump;
    const action = this.actions.get("jump");
    const t = action?.time ?? Infinity;
    const line = j.to.clone().sub(j.from).normalize();
    const pushStart = this.push.curve.length ? this.push.start : this.airStart;
    const flyStart = this.push.curve.length ? this.push.end : this.airStart;
    const flyEnd = this.land.curve.length ? this.land.start : this.airEnd;

    if (t < pushStart) {
      // Crouch: swing round to face the way it's about to leap, holding the
      // crouch (legs still in) until it's lined up.
      this.root.quaternion.slerp(j.launch, 1 - Math.exp(-dt * 16));
      if (action) action.timeScale = this.root.quaternion.angleTo(j.launch) < 0.15 ? JUMP_CROUCH_SPEED : 0;
      return;
    }
    if (t < flyStart) {
      // Push: back feet planted, body driven forward as the legs straighten
      // (quickly, so it's already flying by the time they're straight).
      if (action) action.timeScale = j.pushRate;
      const pushed = Math.min(this.curveAt(j.pushPath, t), j.pushDist);
      const planted = Math.min(this.curveAt(j.pushLegPath, t), pushed);
      this.root.position.copy(j.from).addScaledVector(j.pushDir, planted).addScaledVector(j.launchDir, pushed - planted);
      this.root.quaternion.slerp(j.launch, 1 - Math.exp(-dt * 16));
      return;
    }
    if (!j.tookOff) {
      j.tookOff = true;
      j.takeoff.copy(this.root.quaternion);
    }
    const ease = (x: number) => x * x * (3 - 2 * x);
    if (t < flyEnd) {
      // Flight: the rest of the way, in exactly the time spent in the air,
      // following the clip's own lunge timing, with a low arc so the
      // trailing legs are clear of the ground.
      if (action) action.timeScale = (flyEnd - flyStart) / j.air;
      const u = flightEase((t - flyStart) / Math.max(flyEnd - flyStart, 1e-6), j.flyV0, j.flyV1);
      // The arc, plus as much as the clip's legs need to clear the surface
      // (eased in and out so it doesn't pop up at take-off or landing).
      const clear = this.dip.length ? (Math.max(0, this.curveAt(this.dip, t)) + JUMP_CLEARANCE) * this.length : 0;
      const lift = this.leapLift(j.flyFrom, j.flyTo, u, j.fromWall) + clear * ease(Math.min(1, u / 0.2, (1 - u) / 0.2));
      this.root.position.lerpVectors(j.flyFrom, j.flyTo, u).addScaledVector(UP, lift);
      // Stretch out along the leap, then twist into the landing pose (e.g. onto a wall).
      if (u < 0.4) this.root.quaternion.slerpQuaternions(j.takeoff, j.flight, ease(u / 0.4));
      else this.root.quaternion.slerpQuaternions(j.flight, j.landing, ease((u - 0.4) / 0.6));
      return;
    }

    if (j.toWall) return this.arriveOnWall();

    // Landing: front feet planted, body carried on over them as they draw back.
    if (action) action.timeScale = JUMP_LAND_SPEED;
    const land = this.land.curve.length ? this.curveAt(this.land.curve, t) / Math.max(this.curveEnd(this.land.curve), 1e-6) : 1;
    this.root.position.copy(j.flyTo).addScaledVector(j.landDir, j.landDist * land);
    this.root.quaternion.slerp(j.landing, 1 - Math.exp(-dt * 16));
    if (!j.landed) {
      j.landed = true;
      this.surface = j.surface;
      this.s = j.s;
      this.dir = j.dir;
      if (!this.resumeCrawl) this.goal = j.s;
    }
    // Move on as soon as the landing has stopped moving (no held pause).
    const done = this.jumpStill || Math.max(this.airEnd, this.land.curve.length ? this.land.end : 0) + 0.3;
    if (t >= done) {
      this.root.position.copy(j.to);
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

  /**
   * End of a leap onto a wall: stand the frog at its contact point and let
   * Wall landing (which starts with the body out from the wall) carry it in.
   * While the clip blends in, the frog is held back by the part of the
   * approach the clip isn't showing yet, so nothing jumps.
   */
  private arriveOnWall() {
    const j = this.jump;
    this.surface = j.surface;
    this.s = j.s;
    this.dir = 1;
    this.root.quaternion.copy(j.landing);
    this.state = "wallLanding";
    // Keep the leap's momentum: play the approach part of the clip in about
    // the time the frog would take to cover it at its flying speed.
    const flySpeed = j.flyDist / Math.max(j.air, 1e-3);
    const approachTime = THREE.MathUtils.clamp(this.wallArrival.approach.length() / Math.max(flySpeed, 1e-3), WALL_LAND_FADE, 0.3);
    this.wallArrival.rate = this.wallContactTime > 0 ? Math.max(WALL_LAND_SPEED, this.wallContactTime / approachTime) : WALL_LAND_SPEED;
    this.wallArrival.elapsed = 0;
    this.play("wallLand", this.wallArrival.rate, WALL_LAND_FADE);
    this.updateWallLanding(0);
  }

  private updateWallLanding(dt: number) {
    const action = this.actions.get("wallLand");
    this.wallArrival.elapsed += dt;
    // How far the blend into Wall landing has got (the mixer's own weight
    // isn't updated until its next tick, so track it here).
    const w = THREE.MathUtils.clamp(this.wallArrival.elapsed / WALL_LAND_FADE, 0, 1);
    // Make up the share of the clip's own approach the blend isn't showing
    // yet (the clip moves on through it while still blending in).
    this.root.position.copy(this.wallArrival.contact).add(this.approachAt(action?.time ?? Infinity).multiplyScalar(1 - w));
    // Fast until it's on the wall, then the grab and settle at normal pace.
    if (action) action.timeScale = action.time < this.wallContactTime ? this.wallArrival.rate : WALL_LAND_SPEED;
    const end = this.wallLandStill || (action?.getClip().duration ?? 0) - 1e-3;
    const done = !action || action.time >= end;
    if (!done) return;
    this.root.position.copy(this.wallArrival.contact);
    this.tucked = false;
    if (this.resumeCrawl) {
      this.resumeCrawl = false;
      this.startCrawl(); // climb on up
    } else this.enter("looking");
  }

  /** Where Wall landing has the body at clip time `t`, from the contact point (world units). */
  private approachAt(t: number) {
    const c = this.wallApproachCurve;
    const out = new THREE.Vector3();
    if (!c.length) return out.copy(this.wallArrival.approach);
    let i = 1;
    while (i < c.length - 1 && c[i].t < t) i++;
    const f = THREE.MathUtils.clamp((t - c[i - 1].t) / (c[i].t - c[i - 1].t || 1), 0, 1);
    return out.lerpVectors(c[i - 1].at, c[i].at, f).applyQuaternion(this.jump.landing).multiplyScalar(this.length);
  }

  /** Value of a [time, value] curve at `t` (held flat past either end). */
  private curveAt(c: [number, number][], t: number) {
    if (!c.length) return 0;
    if (t <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (t <= c[i][0]) {
        const [t0, v0] = c[i - 1];
        const [t1, v1] = c[i];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
      }
    }
    return c[c.length - 1][1];
  }

  private curveEnd(c: [number, number][]) {
    return c.length ? c[c.length - 1][1] : 0;
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
    // Keep the body on the surface; the feet may overhang a short perch a little.
    const margin = Math.min(this.length * 0.25, len / 2);
    return THREE.MathUtils.clamp(s, margin, len - margin);
  }

  /** A random spot on a surface, at least `minFromHere` from the frog if it's this one. */
  private randomS(surface: Surface, minFromHere: number) {
    const len = lengthOf(surface);
    // Keep the body on the surface; the feet may overhang a short perch a little.
    const margin = Math.min(this.length * 0.25, len / 2);
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
    // Paused partway round a turn: hold that heading.
    if (this.quarterQ && surface === this.surface) return this.quarterQ.clone();
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

  /** Average push of a travel clip's planted feet (frog lengths per clip second). */
  private strideOf(key: ClipKey) {
    const all = [...this.stride.entries()].filter(([k]) => k.startsWith(key + "|")).flatMap(([, v]) => v);
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  }

  /** Which way the frog is seen: on the floor facing right/left, or on a wall. */
  private viewOf(surface = this.surface!, dir = this.dir) {
    if (surface.id.startsWith("wall")) return surface.normal.x > 0 ? "wall-left" : "wall-right";
    return dir > 0 ? "floor+1" : "floor-1";
  }

  /** For a view, maps a point in the frog's own frame to its on-screen position along the direction of travel. */
  private viewProjector(view: string) {
    const up = new THREE.Vector3(0, 1, 0);
    const [n, f] =
      view === "floor+1" ? [up, new THREE.Vector3(1, 0, 0)]
      : view === "floor-1" ? [up, new THREE.Vector3(-1, 0, 0)]
      : view === "wall-left" ? [new THREE.Vector3(1, 0, 0), up]
      : [new THREE.Vector3(-1, 0, 0), up];
    const q = this.frame(n, f.clone());
    return (p: THREE.Vector3) => {
      const w = p.clone().applyQuaternion(q);
      return w.x * f.x + w.y * f.y; // screen plane only (depth doesn't show)
    };
  }

  /** Push strength at the crawl clip's current point in its cycle. */
  private strideAt(): number {
    const key = this.travelClip();
    const action = this.actions.get(key);
    const stride = this.stride.get(`${key}|${this.viewOf()}`);
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
    return this.onWall() && this.actions.has("wallClimb") ? "wallClimb" : "crawl";
  }

  /** Blends to a clip; returns the clip's length in clip seconds (0 if missing). */
  private play(key: ClipKey, timeScale = 1, fade = FADE, startAt = 0): number {
    const next = this.actions.get(key) ?? (key === "alert" ? this.actions.get("look") : undefined);
    if (!next) return 0;
    if (key !== "rest" && key !== "settle" && key !== "alert" && key !== "look") this.tucked = false;
    // Skip a transition clip's held stretches: start where it starts moving,
    // and report how long until it stops (callers time the next step by it).
    const span = this.moving.get(key);
    if (span && startAt === 0) {
      this.blendTo(next, timeScale, fade, span[0]);
      return span[1] - span[0];
    }
    this.blendTo(next, timeScale, fade, startAt);
    return next.getClip().duration - startAt;
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

  /**
   * Smooths out keyframe pops in a looping clip: where one key-to-key step
   * of a bone is far bigger than that bone's usual step (a foot teleporting
   * forward), the surrounding keys are blended so the move is spread over a
   * few frames instead. Everything else is left exactly as authored.
   */
  private smoothPops(clip: THREE.AnimationClip, loop = true, ratio = POP_RATIO, spread = POP_SPREAD) {
    for (const track of clip.tracks) {
      const k = track.getValueSize();
      if (k !== 3 && k !== 4) continue;
      // Leave the root alone: in clips like Turn around it moves the whole body.
      if (track.name.startsWith("root.")) continue;
      const v = track.values;
      // In a loop the last key repeats the first: work on the unique ones,
      // wrapping round. Otherwise just stop at the ends.
      const n = loop ? track.times.length - 1 : track.times.length;
      if (n < 8) continue;
      const wrap = (i: number) => (loop ? (i + n) % n : THREE.MathUtils.clamp(i, 0, n - 1));
      const key = (i: number) => Array.from(v.slice(wrap(i) * k, wrap(i) * k + k));
      const step = (i: number) => {
        const a = key(i), b = key(i + 1);
        if (k === 4) return 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      };
      const steps = Array.from({ length: loop ? n : n - 1 }, (_, i) => step(i));
      const typical = [...steps].sort((a, b) => a - b)[Math.floor(steps.length * 0.75)];
      const pops = steps.map((d, i) => (d > Math.max(typical * ratio, 1e-3) ? i : -1)).filter((i) => i >= 0);
      if (!pops.length) continue;
      const original = Array.from({ length: n }, (_, i) => key(i));
      const touched = new Set<number>();
      for (const i of pops) for (let d = -spread + 1; d <= spread; d++) touched.add(wrap(i + d));
      for (const i of touched) {
        // Gaussian-weighted average of the original keys around it.
        const acc = new Array(k).fill(0);
        let wsum = 0;
        const ref = original[i];
        for (let d = -spread; d <= spread; d++) {
          const w = Math.exp(-(d * d) / (spread * 0.8));
          const q = original[wrap(i + d)];
          // Quaternions: keep them on the same side before averaging.
          const sign = k === 4 && q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? -1 : 1;
          for (let c = 0; c < k; c++) acc[c] += w * sign * q[c];
          wsum += w;
        }
        let out = acc.map((x) => x / wsum);
        if (k === 4) {
          const len = Math.hypot(...out);
          out = out.map((x) => x / len);
        }
        for (let c = 0; c < k; c++) v[i * k + c] = out[c];
        // Keep a loop's closing key matching the opening one.
        if (loop && i === 0) for (let c = 0; c < k; c++) v[n * k + c] = out[c];
      }
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

    // Crawling and wall climbing: samples[i][foot] = [position along the
    // direction of travel as seen on screen, height off the surface], for
    // each way the frog can face (it's seen in three-quarter view).
    for (const key of ["crawl", "wallClimb"] as const) {
      const views = key === "crawl" ? ["floor+1", "floor-1"] : ["wall-left", "wall-right"];
      for (const view of views) {
        const along = this.viewProjector(view);
        const samples: [number, number][][] = [];
        let duration = 0;
        this.sampleClip(key, (_, d) => {
          duration = d;
          samples.push(feet.map((f) => {
            const p = this.local(f);
            return [along(p), p.y];
          }));
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
        if (smooth.some((v) => v > 0)) this.stride.set(`${key}|${view}`, smooth.map((v) => v / step));
      }
    }
    void fwd;

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

    // Wall turn to look down: same idea as the turn below.
    {
      const head = model.getObjectByName("head");
      const body = model.getObjectByName("body");
      if (head && body) {
        const yaws: number[] = [];
        this.sampleClip("wallTurnDown", (t) => {
          const h = this.local(head);
          const b = this.local(body);
          yaws.push(Math.atan2(h.x - b.x, h.z - b.z));
          if (t === 0 && rootBone) this.peekPivot.copy(this.local(rootBone)).setY(0);
        });
        let total = 0;
        for (let i = 1; i < yaws.length; i++) {
          const d = yaws[i] - yaws[i - 1];
          total += Math.atan2(Math.sin(d), Math.cos(d));
        }
        this.peekAngle = total;
      }
    }

    // Jump ground contact: when the back feet push (extending backward while
    // planted) and when the front feet land and draw back under the body.
    {
      const fz = (p: THREE.Vector3) => p.x * fwd.x + p.z * fwd.y;
      const hindFeet = ["hindankleL", "hindankleR"].map((n) => model.getObjectByName(n)).filter((x) => x !== undefined);
      const frontFeet = ["frontlowerL", "frontlowerR"].map((n) => model.getObjectByName(n)).filter((x) => x !== undefined);
      const rows: { t: number; hz: number; fz: number; fy: number }[] = [];
      this.sampleClip("jump", (t) => {
        const hz = hindFeet.reduce((a, b) => a + fz(this.local(b)), 0) / Math.max(hindFeet.length, 1);
        const fzz = frontFeet.reduce((a, b) => a + fz(this.local(b)), 0) / Math.max(frontFeet.length, 1);
        const fy = Math.min(...frontFeet.map((b) => this.local(b).y));
        rows.push({ t, hz, fz: fzz, fy });
      });
      if (rows.length > 4 && hindFeet.length && frontFeet.length) {
        // Push: back feet reach farthest back around take-off (searching only
        // from a little before it, so the clip's opening pose can't count)...
        const lo = this.airStart * 0.5;
        const hi = (this.airStart + this.airEnd) / 2;
        let endIdx = -1;
        rows.forEach((r, i) => {
          if (r.t >= lo && r.t <= hi && (endIdx < 0 || r.hz < rows[endIdx].hz)) endIdx = i;
        });
        if (endIdx < 0) endIdx = 0;
        // The legs may stay fully extended for a while: the push ends when
        // they first get there.
        while (endIdx > 0 && rows[endIdx - 1].t >= lo && rows[endIdx - 1].hz <= rows[endIdx].hz + 0.005) endIdx--;
        // ...having started extending where they last stopped moving forward.
        let startIdx = endIdx;
        while (startIdx > 0 && rows[startIdx - 1].hz > rows[startIdx].hz + 1e-4) startIdx--;
        const pushLen = rows[startIdx].hz - rows[endIdx].hz;
        if (pushLen > 0.02) {
          // The push is only a few coarse samples long: resample just that
          // window finely so the body's push follows the leg exactly.
          const t0 = rows[Math.max(0, startIdx - 1)].t;
          const t1 = rows[Math.min(rows.length - 1, endIdx + 1)].t;
          const jump = this.actions.get("jump")!;
          jump.reset().setEffectiveWeight(1).play();
          const fine: { t: number; hz: number }[] = [];
          for (let i = 0; i <= 48; i++) {
            jump.time = t0 + ((t1 - t0) * i) / 48;
            this.mixer!.update(0);
            this.root.updateMatrixWorld(true);
            fine.push({
              t: jump.time,
              hz: hindFeet.reduce((a, b) => a + fz(this.local(b)), 0) / hindFeet.length,
            });
          }
          jump.stop();
          let a = 0;
          let b = fine.length - 1;
          for (let i = 0; i < fine.length; i++) if (fine[i].hz < fine[b].hz - 1e-6) b = i;
          while (a < b && fine[a + 1].hz >= fine[a].hz - 1e-4) a++;
          // (Ending as the legs get to full stretch, not once they've held it.)
          while (b > a + 1 && fine[b - 1].hz <= fine[b].hz + 0.003) b--;
          this.push.start = fine[a].t;
          this.push.end = fine[b].t;
          this.push.curve = fine.slice(a, b + 1).map((r) => [r.t, fine[a].hz - r.hz]);
        }
        // Landing: front feet back down near their lowest after the lunge...
        const after = rows.filter((r) => r.t > Math.max(this.push.end, this.airStart) + 0.1);
        if (after.length) {
          const low = Math.min(...after.map((r) => r.fy));
          // (The feet come down gradually, drawing back as they go.)
          const contact = after.find((r) => r.fy <= low + 0.03);
          if (contact) {
            const i0 = rows.indexOf(contact);
            // ...and drawing back under the body until they stop.
            let i1 = i0;
            while (i1 < rows.length - 1 && rows[i1 + 1].fz < rows[i1].fz - 1e-4) i1++;
            const landLen = rows[i0].fz - rows[i1].fz;
            if (landLen > 0.01) {
              this.land.start = rows[i0].t;
              this.land.end = rows[i1].t;
              this.land.curve = rows.slice(i0, i1 + 1).map((r) => [r.t, rows[i0].fz - r.fz]);
            }
          }
        }
      }
    }

    // Where each step of the crawl and climb finishes: the moments the feet
    // are stillest (well apart, and quieter than usual).
    {
      const feet = FEET.map((n) => model.getObjectByName(n)).filter((x) => x !== undefined);
      for (const key of ["crawl", "wallClimb"] as ClipKey[]) {
        const rows: { t: number; at: THREE.Vector3[] }[] = [];
        this.sampleClip(key, (t) => rows.push({ t, at: feet.map((b) => this.local(b)) }));
        const n = rows.length;
        if (n < 8) continue;
        const motion = rows.map((r, i) => r.at.reduce((sum, p, k) => sum + p.distanceTo(rows[(i + n - 1) % n].at[k]), 0));
        const calm = [...motion].sort((a, b) => a - b)[Math.floor(n / 2)];
        const span = rows[n - 1].t / (n - 1);
        const near = Math.max(1, Math.round(0.3 / Math.max(span, 1e-6)));
        const ends: number[] = [];
        for (let i = 1; i < n; i++) {
          let lowest = true;
          for (let k = -near; k <= near && lowest; k++) if (k && motion[(i + k + n) % n] < motion[i]) lowest = false;
          if (lowest && motion[i] < calm) ends.push(rows[i].t);
        }
        // One end per step: calm moments closer together than this are the same footfall
        // (a looping clip's seam often yields two), so keep only the first of each cluster.
        const MIN_STEP_GAP = 0.15;
        const merged = ends.filter((t, i) => i === 0 || t - ends[i - 1] >= MIN_STEP_GAP);
        if (merged.length > 1 && rows[n - 1].t - merged[merged.length - 1] + merged[0] < MIN_STEP_GAP) merged.pop();
        this.stepEnds.set(key, merged);
      }
    }

    // Wall landing: how far out from (and below) its end the body starts.
    if (rootBone) {
      const pts: THREE.Vector3[] = [];
      const times: number[] = [];
      this.sampleClip("wallLand", (t) => {
        pts.push(this.local(rootBone));
        times.push(t);
      });
      if (pts.length > 1) {
        const end = pts[pts.length - 1];
        this.wallApproach.copy(pts[0]).sub(end);
        this.wallApproachCurve = pts.map((p, k) => ({ t: times[k], at: p.clone().sub(end) }));
        // Reached the wall once it's covered nearly all of the approach.
        const total = this.wallApproach.length();
        const i = pts.findIndex((p) => p.distanceTo(end) <= total * 0.05);
        this.wallContactTime = times[Math.max(0, i)];
      }
    }

    // When the landings stop moving: the last moment any limb still changes.
    {
      const limbs = [...FEET, "head", "body", "root", "hindlowerL", "hindlowerR"]
        .map((n) => model.getObjectByName(n))
        .filter((x) => x !== undefined);
      const stillFrom = (key: ClipKey, after: number) => {
        const poses: { t: number; p: THREE.Vector3[] }[] = [];
        this.sampleClip(key, (t) => poses.push({ t, p: limbs.map((b) => this.local(b)) }));
        if (poses.length < 2) return 0;
        const last = poses[poses.length - 1].p;
        // Walk back from the end while the pose still matches the final one.
        let i = poses.length - 1;
        while (i > 0 && poses[i - 1].t > after && Math.max(...poses[i - 1].p.map((q, k) => q.distanceTo(last[k]))) < 0.004) i--;
        return poses[i].t;
      };
      this.jumpStill = stillFrom("jump", this.airEnd);
      this.wallLandStill = stillFrom("wallLand", this.wallContactTime);
      // Where each transition clip actually moves.
      for (const key of TRIMMED) {
        const poses: { t: number; p: THREE.Vector3[] }[] = [];
        this.sampleClip(key, (t) => poses.push({ t, p: limbs.map((b) => this.local(b)) }));
        if (poses.length < 2) continue;
        const gap = (a: THREE.Vector3[], b: THREE.Vector3[]) => Math.max(...a.map((q, k) => q.distanceTo(b[k])));
        const first = poses[0].p;
        const last = poses[poses.length - 1].p;
        const i0 = poses.findIndex((x) => gap(x.p, first) > 0.004);
        let i1 = poses.length - 1;
        while (i1 > 0 && gap(poses[i1 - 1].p, last) < 0.004) i1--;
        if (i0 < 0 || i1 <= i0) continue;
        // Start a sample early so the first movement isn't clipped.
        this.moving.set(key, [poses[Math.max(0, i0 - 1)].t, poses[i1].t]);
      }
    }

    // Jump dip: the skin's lowest point through the clip (a sample of vertices).
    {
      const meshes: THREE.SkinnedMesh[] = [];
      model.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
      });
      if (meshes.length) {
        const v = new THREE.Vector3();
        this.dip = [];
        this.sampleClip("jump", (t) => {
          let low = Infinity;
          for (const mesh of meshes) {
            mesh.skeleton.update();
            const n = mesh.geometry.attributes.position.count;
            for (let i = 0; i < n; i += 9) {
              mesh.getVertexPosition(i, v);
              v.applyMatrix4(mesh.matrixWorld);
              this.root.worldToLocal(v);
              low = Math.min(low, v.y);
            }
          }
          this.dip.push([t, -low]);
        });
      }
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

  /** How far a clip turns the body (radians), from the body-to-head line. */
  private measureYaw(model: THREE.Object3D, key: ClipKey) {
    const head = model.getObjectByName("head");
    const body = model.getObjectByName("body");
    if (!head || !body) return 0;
    const yaws: number[] = [];
    this.sampleClip(key, () => {
      const h = this.local(head);
      const b = this.local(body);
      yaws.push(Math.atan2(h.x - b.x, h.z - b.z));
    });
    let total = 0;
    for (let i = 1; i < yaws.length; i++) {
      const d = yaws[i] - yaws[i - 1];
      total += Math.atan2(Math.sin(d), Math.cos(d));
    }
    return total;
  }

  /** When a clip's root bone stops moving (clip seconds); its duration if it never does early. */
  private rootStillTime(clip: THREE.AnimationClip) {
    let end = 0;
    for (const track of clip.tracks.filter((t) => t.name.startsWith("root."))) {
      const k = track.getValueSize();
      const n = track.times.length;
      for (let i = n - 1; i > 0; i--) {
        let d = 0;
        for (let c = 0; c < k; c++) d = Math.max(d, Math.abs(track.values[i * k + c] - track.values[(n - 1) * k + c]));
        if (d > 1e-4) {
          end = Math.max(end, track.times[Math.min(i + 1, n - 1)]);
          break;
        }
      }
    }
    return end > clip.duration - 0.3 ? 0 : end;
  }

  /** The crawl time whose pose (limbs relative to the root) best matches the turn's at its movement end. */
  private closestCrawlPhase(model: THREE.Object3D, from: ClipKey = "turn", time = this.turnMoveEnd) {
    const bone = this.rootBone;
    const limbs = [...FEET, "head", "hindlowerL", "hindlowerR"].map((n) => model.getObjectByName(n)).filter((x) => x !== undefined);
    const still = this.stillCopies.get(from);
    const crawl = this.actions.get("crawl");
    if (!bone || !still || !crawl || !limbs.length) return 0;
    const pose = (action: THREE.AnimationAction, t: number) => {
      this.mixer!.stopAllAction();
      action.reset().setEffectiveWeight(1).play();
      action.time = t;
      this.mixer!.update(0);
      this.root.updateMatrixWorld(true);
      const inv = bone.matrixWorld.clone().invert();
      return limbs.map((b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
    };
    const target = pose(still, time);
    let best = Infinity;
    let at = 0;
    const d = crawl.getClip().duration;
    for (let t = 0; t < d; t += d / SAMPLES) {
      const p = pose(crawl, t);
      const gap = Math.max(...p.map((q, i) => q.distanceTo(target[i])));
      if (gap < best) {
        best = gap;
        at = t;
      }
    }
    this.mixer!.stopAllAction();
    return at;
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

    // The crawl snaps a foot forward in a single key twice a cycle; ease it.
    const crawlForSmoothing = clips.find((c) => c.name === CLIPS.crawl);
    if (crawlForSmoothing) this.smoothPops(crawlForSmoothing);
    // Wall climbing copies the crawl cycle, pops and all.
    const climbForSmoothing = clips.find((c) => c.name === CLIPS.wallClimb);
    if (climbForSmoothing) this.smoothPops(climbForSmoothing);
    // (Turn around has quick back-foot flicks too, but smoothing those shifts
    // when its feet plant and makes them skate, which looks worse: leave it.)
    // The turns windmill a front leg round in full circles; make those plain steps.
    for (const key of ["turn", "turn90", "turn90More", "turn90Back", "turn90Settle"] as const) {
      const clip = clips.find((c) => c.name === CLIPS[key]);
      if (clip) unwindArms(model, clip);
    }
    // The 90-degree turns also snap a back foot across in a single key or two
    // (up to half a frog length), which looks like a spasm at turning speed.
    for (const key of ["turn90", "turn90More", "turn90Back", "turn90Settle"] as const) {
      const clip = clips.find((c) => c.name === CLIPS[key]);
      if (clip) this.smoothPops(clip, false);
    }

    const jumpClip = clips.find((c) => c.name === CLIPS.jump);
    if (jumpClip) this.takeLeapOut(jumpClip);
    this.rootBone = model.getObjectByName("root");
    this.arms = armsOf(model);
    this.headBone = model.getObjectByName("head");
    this.bodyBone = model.getObjectByName("body");

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
    // Still copies (root bone tracks removed) of clips that move the body.
    for (const key of ["turn", "turn90", "turn90More", "turn90Back", "turn90Settle", "wallTurnDown"] as const) {
      const clip = this.actions.get(key)?.getClip();
      if (!clip) continue;
      const copy = clip.clone();
      copy.tracks = copy.tracks.filter((t) => !t.name.startsWith("root."));
      const action = this.mixer.clipAction(copy);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      this.stillCopies.set(key, action);
    }
    // Turn around: its turning ends where the root bone stops moving.
    const turnClip = this.actions.get("turn")?.getClip();
    if (turnClip) {
      for (const track of turnClip.tracks.filter((t) => t.name.startsWith("root."))) {
        const k = track.getValueSize();
        const n = track.times.length;
        for (let i = n - 1; i > 0; i--) {
          let d = 0;
          for (let c = 0; c < k; c++) d = Math.max(d, Math.abs(track.values[i * k + c] - track.values[(n - 1) * k + c]));
          if (d > 1e-4) {
            this.turnMoveEnd = Math.max(this.turnMoveEnd, track.times[Math.min(i + 1, n - 1)]);
            break;
          }
        }
      }
      // Only worth stopping early if there's a real tuck after it.
      if (this.turnMoveEnd > turnClip.duration - 0.5) this.turnMoveEnd = 0;
    }
    // Measure before the breathing layer starts so it can't skew anything.
    this.measureClips(model);
    if (this.turnMoveEnd) this.turnToCrawlAt = this.closestCrawlPhase(model);
    // The 90-degree family: how far each part turns, when Continue turn 90
    // is done turning, and the crawl phases it can move off into.
    for (const key of ["turn90", "turn90More", "turn90Back"] as const) this.yaw.set(key, this.measureYaw(model, key));
    for (const key of ["turn", "turn90", "turn90More", "turn90Back", "turn90Settle"] as const) this.measureLimbSpeed(model, key);
    const moreClip = this.actions.get("turn90More")?.getClip();
    if (moreClip) this.moreMoveEnd = this.rootStillTime(moreClip);
    if (this.stillCopies.has("turn90More")) this.crawlAfterMore = this.closestCrawlPhase(model, "turn90More", this.moreMoveEnd || moreClip!.duration);
    const q = this.actions.get("turn90")?.getClip();
    if (q && this.stillCopies.has("turn90")) this.crawlAfterQuarter = this.closestCrawlPhase(model, "turn90", q.duration - 1e-3);
    this.actions.get("breathe")?.play();
    // A separate copy of the crawl, so the wall grip can hold one frame while
    // the crawl itself keeps playing normally.
    const crawlClip = clips.find((c) => c.name === CLIPS.crawl);
    if (crawlClip) this.gripAction = this.mixer.clipAction(crawlClip.clone());

    this.root.position.copy(saved.pos);
    this.root.scale.copy(saved.scale);
    if (this.surface) this.root.quaternion.copy(this.facing());
    // Appear already curled up: no fade in from the model's legs-out bind pose.
    this.play("rest", 1, 0);
    this.mixer.update(0);
  }
}

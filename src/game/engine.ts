/* GRAVEYARD SHIFT — top-down zombie survival shooter engine. */
import { SFX } from "./audio";

export type Phase = "menu" | "playing" | "paused" | "gameover" | "downed";

export type Mode = "survival" | "endless";
export type Difficulty = "easy" | "medium" | "hard";

export interface StartOpts {
  mode: Mode;
  difficulty: Difficulty;
}

export interface RunStats {
  score: number;
  wave: number;
  kills: number;
  time: number;
  bestChain: number;
  mode: Mode;
  difficulty: Difficulty;
  deaths: number;
}

export interface EngineCallbacks {
  onPhase: (phase: Phase, stats?: RunStats) => void;
  onMute: (muted: boolean) => void;
  /** Fired once whenever a run ends (death in survival, or leaving the yard in endless). */
  onRunEnd: (stats: RunStats) => void;
}

interface DiffDef {
  density: number; // multiplier on the wave composition
  rate: number; // multiplier on the spawn interval (lower = faster)
  cap: number; // max zombies alive at once
}

const DIFFS: Record<Difficulty, DiffDef> = {
  easy: { density: 0.6, rate: 1.35, cap: 30 },
  medium: { density: 1, rate: 1, cap: 45 },
  hard: { density: 1.5, rate: 0.7, cap: 70 },
};

const DIFF_LABEL: Record<Difficulty, string> = { easy: "EASY", medium: "MEDIUM", hard: "HARD" };
const MODE_LABEL: Record<Mode, string> = { survival: "SURVIVAL", endless: "ENDLESS" };

const TAU = Math.PI * 2;
const GLOW_SIZE = 26;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const irand = (a: number, b: number) => Math.floor(rand(a, b + 1));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/** In-place dead-entity removal: same result as filter() but with no per-frame allocation. */
function compact<T extends { dead: boolean }>(list: T[]) {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it.dead) list[n++] = it;
  }
  list.length = n;
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

type ZType = "walker" | "runner" | "brute" | "spitter" | "exploder" | "alpha";

interface ZDef {
  hp: number;
  speed: number;
  r: number;
  dmg: number;
  score: number;
  body: string;
  dark: string;
  eye: string;
}

const ZDEFS: Record<ZType, ZDef> = {
  walker: { hp: 60, speed: 66, r: 16, dmg: 12, score: 50, body: "#7d9457", dark: "#4c5f33", eye: "#ff4040" },
  runner: { hp: 38, speed: 152, r: 13, dmg: 9, score: 75, body: "#a8bd5a", dark: "#6d7f33", eye: "#ffd23c" },
  brute: { hp: 340, speed: 40, r: 30, dmg: 28, score: 250, body: "#5d7a46", dark: "#33471f", eye: "#ff4040" },
  spitter: { hp: 75, speed: 58, r: 15, dmg: 14, score: 100, body: "#4f9e5f", dark: "#2b5f38", eye: "#b8ff2e" },
  exploder: { hp: 55, speed: 96, r: 15, dmg: 42, score: 125, body: "#c05a34", dark: "#77301a", eye: "#ffb020" },
  alpha: { hp: 120, speed: 50, r: 18, dmg: 15, score: 200, body: "#2a1b3d", dark: "#140c1d", eye: "#d942ff" },
};

type WeaponRole = "long" | "short";

interface WeaponDef {
  id: string;
  name: string;
  short: string;
  role: WeaponRole;
  dmg: number;
  rate: number;
  mag: number;
  reload: number;
  speed: number;
  pellets: number;
  spread: number;
  reserve: number; // -1 = infinite
  shake: number;
  knock: number;
  pierce: number;
  tracer: string;
  /** Short-range falloff: full damage up to `start`, scaled to x`far` beyond `end`. */
  fo?: { start: number; end: number; far: number };
}

/*
 * Arsenal split 50/50 by role: 3 dedicated long-range, 3 dedicated short-range.
 * `role` only describes intent; bullet reach stays exactly as tuned (speed x life),
 * so no existing weapon feel changes.
 */
const WEAPONS: WeaponDef[] = [
  { id: "pistol", name: "M9 SIDEARM", short: "M9", role: "long", dmg: 36, rate: 4.5, mag: 15, reload: 0.6, speed: 980, pellets: 1, spread: 0.025, reserve: -1, shake: 2.4, knock: 90, pierce: 0, tracer: "#ffe9a8" },
  { id: "smg", name: "VIPER SMG", short: "SMG", role: "long", dmg: 17, rate: 13, mag: 36, reload: 0.8, speed: 1020, pellets: 1, spread: 0.065, reserve: 150, shake: 1.6, knock: 50, pierce: 0, tracer: "#d8ff9a" },
  { id: "shotgun", name: "RIOT GUN", short: "RIOT", role: "short", dmg: 45, rate: 2.1, mag: 6, reload: 0.95, speed: 900, pellets: 6, spread: 0.4, reserve: 30, shake: 8, knock: 260, pierce: 0, tracer: "#ffc46a", fo: { start: 140, end: 420, far: 0.3 } },
  { id: "rifle", name: "RAIL-7 RIFLE", short: "RAIL", role: "long", dmg: 140, rate: 2.7, mag: 6, reload: 0.9, speed: 1700, pellets: 1, spread: 0.005, reserve: 20, shake: 5.5, knock: 160, pierce: 4, tracer: "#9adcff" },
  { id: "flame", name: "INCINERATOR", short: "FLAME", role: "short", dmg: 16, rate: 18, mag: 120, reload: 1.1, speed: 480, pellets: 2, spread: 0.35, reserve: 300, shake: 1.2, knock: 8, pierce: 99, tracer: "#ff5000" },
  { id: "chainsaw", name: "RIPPER SAW", short: "SAW", role: "short", dmg: 15, rate: 20, mag: 999, reload: 0, speed: 600, pellets: 3, spread: 0.6, reserve: -1, shake: 1.5, knock: 45, pierce: 99, tracer: "rgba(255,40,40,0.15)" },
];

const ROLE_COLOR: Record<WeaponRole, string> = { long: "#9adcff", short: "#ffb46a" };
const ROLE_LABEL: Record<WeaponRole, string> = { long: "LONG RANGE", short: "SHORT RANGE" };

/** Serializable endless-run snapshot written by Save & Exit and consumed on resume. */
export interface EndlessSave {
  v: 1;
  mode: "endless";
  difficulty: Difficulty;
  score: number;
  kills: number;
  wave: number;
  time: number;
  bestChain: number;
  deaths: number;
  hp: number;
  bombs: number;
  bombRechargeT: number;
  wIdx: number;
  weapons: { id: string; mag: number; reserve: number }[];
  savedAt: number;
}

/* AoE bomb tuning */
const BOMB_RADIUS = 170;
const BOMB_DMG = 320;
const BOMB_EDGE = 90;
const BOMB_SELF = 80;
const BOMB_SPEED = 620;
const BOMB_FUSE = 0.55; // ~340px of travel at BOMB_SPEED
const BOMB_START = 2;
const BOMB_MAX = 5;
const BOMB_RECHARGE = 20; // seconds to regen one bomb once the stock hits 0 (15–30s budget)

/* World, camera & render budget */
const WORLD_SCALE = 2.2; // arena area is ~4.8x the viewport
const WORLD_MIN_W = 1400;
const WORLD_MIN_H = 1100;
const WORLD_MAX = 4096;
const GROUND_TILE = 512;
const TILE_VARIANTS = 6;
const DECAL_SCALE = 0.5; // blood layer is stored at half resolution
const CAM_DEAD_X = 0.11; // dead-zone before the camera starts to follow
const CAM_DEAD_Y = 0.13;
const CAM_LERP = 8;
const THREAT_SECTORS = 16;
const THREAT_MAX = 8;
const TINTS = ["rgba(0,0,0,0)", "rgba(255,255,255,0.012)", "rgba(9,13,9,0.05)", "rgba(40,55,35,0.05)"];
const THREAT_PRIO = [0, 1, 2, 4, 3];
const TILE_WRAP: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

type PickupType = "med" | "ammo" | "weapon" | "adre" | "nuke";

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

interface Zombie {
  type: ZType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  speed: number;
  r: number;
  flash: number;
  attackCd: number;
  spitCd: number;
  wob: number;
  dead: boolean;
}

interface Bullet {
  x: number;
  y: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  dmg: number;
  life: number;
  pierce: number;
  knock: number;
  tracer: string;
  /** falloff multiplier at max range, 1 = no falloff */
  far: number;
  foStart: number;
  foEnd: number;
}

interface AcidBlob {
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  p: number;
  dur: number;
  dmg: number;
  hit: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  add: boolean;
}

interface Floater {
  x: number;
  y: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
}

interface Pickup {
  x: number;
  y: number;
  type: PickupType;
  weaponIdx: number;
  t: number;
  life: number;
}

interface SpawnMark {
  x: number;
  y: number;
  t: number;
  dur: number;
  type: ZType;
}

interface OwnedWeapon {
  def: WeaponDef;
  mag: number;
  reserve: number;
}

interface Banner {
  text: string;
  sub: string;
  t: number;
  dur: number;
  color: string;
}

interface MenuZom {
  x: number;
  y: number;
  a: number;
  turnT: number;
  speed: number;
  type: ZType;
  wob: number;
}

type TouchBtnId = "dash" | "swap" | "bomb";

interface TouchBtn {
  id: TouchBtnId;
  x: number;
  y: number;
  r: number;
}

interface ThrownBomb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  rot: number;
}

interface BlastRing {
  x: number;
  y: number;
  t: number;
  r: number;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private sfx = new SFX();

  phase: Phase = "menu";
  touchMode = false;

  private W = 960;
  private H = 640;
  private dpr = 1;

  // world (larger than the viewport) + follow camera
  private worldW = 960;
  private worldH = 640;
  private camX = 0;
  private camY = 0;

  // off-screen threat cue: bucketed by angle so it never draws per zombie
  private threatW = new Float32Array(THREAT_SECTORS);
  private threatK = new Uint8Array(THREAT_SECTORS);
  private threatHit = new Uint8Array(THREAT_SECTORS);

  private raf = 0;
  private last = 0;
  private time = 0;
  private runTime = 0;

  // input
  private keys = new Set<string>();
  private mouse = { x: 480, y: 200, down: false };
  private moveStick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0, on: false };
  private aimStick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0, on: false };
  private wantDash = false;
  private wantCycle = false;
  private wantBomb = false;
  private switchTo = -1;

  // world
  private player = {
    x: 480, y: 320, hp: 100, maxHp: 100, aim: 0, r: 14,
    dashT: 0, dashCd: 0, dashX: 1, dashY: 0,
    invulnT: 0, hurtT: 0, regenT: 0, fireCd: 0, reloadT: 0,
    muzzleT: 0, adreT: 0, walk: 0, moving: false, dryCd: 0,
  };
  private weapons: OwnedWeapon[] = [];
  private wIdx = 0;

  // AoE bombs
  private bombs = BOMB_START;
  private bombCd = 0;
  private bombRechargeT = 0;
  private bombHoldId = -1; // pointerId while the bomb button is held, -2 while G is held, -1 idle
  private thrown: ThrownBomb[] = [];
  private rings: BlastRing[] = [];
  private blastDepth = 0;

  private zombies: Zombie[] = [];
  private bullets: Bullet[] = [];
  private acids: AcidBlob[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private pickups: Pickup[] = [];
  private marks: SpawnMark[] = [];
  private menuZoms: MenuZom[] = [];

  private wave = 0;
  private score = 0;
  private kills = 0;
  private chain = 0;
  private bestChain = 0;
  private comboT = 0;
  private spawnQueue: ZType[] = [];
  private spawnT = 0;
  private interT = 0;
  private clearedFlag = false;

  // run configuration
  private mode: Mode = "survival";
  private difficulty: Difficulty = "medium";
  private started = false;
  private deaths = 0;
  private respawnT = 0;
  private lastTickN = 0;
  private resumePhase: Phase = "playing";

  // fx
  private trauma = 0;
  private hitStop = 0;
  private flashA = 0;
  private banner: Banner | null = null;
  private heartT = 0;
  private lastHitSnd = 0;

  // layers (ground is a small pool of tiles, so memory stays constant as the world grows)
  private groundTiles: HTMLCanvasElement[] = [];
  private groundVariant = 0;
  private decal: HTMLCanvasElement;
  private decalCtx: CanvasRenderingContext2D;
  private vignette: HTMLCanvasElement;
  private redVig: HTMLCanvasElement;
  private fogSprites: HTMLCanvasElement[] = [];
  private fog: { x: number; y: number; vx: number; vy: number; s: number }[] = [];
  private dust: { x: number; y: number; vx: number; vy: number; a: number }[] = [];

  // spatial hash
  private gridCELL = 75;
  private gridW = 0;
  private grid: Zombie[][] = [];

  // prerendered pickup glows (avoids a createRadialGradient call per pickup per frame)
  private glowSprites: Partial<Record<PickupType, HTMLCanvasElement>> = {};

  // pending weapon-slot tap: a drag that starts on the slot row is handed to the move stick
  private tapCand = { id: -1, idx: -1, x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cb = cb;
    this.decal = document.createElement("canvas");
    this.decalCtx = this.decal.getContext("2d")!;
    this.vignette = document.createElement("canvas");
    this.redVig = document.createElement("canvas");

    try {
      void document.fonts.load('60px "Creepster"');
      void document.fonts.load('700 20px "Barlow Condensed"');
    } catch {
      /* noop */
    }

    this.sfx.setMuted(this.sfx.muted);
    this.resize();
    this.buildFog();
    this.buildDust();
    this.buildGlowSprites();
    this.initMenuZoms();
    this.bind();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ---------------- lifecycle ---------------- */

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  start(opts?: StartOpts) {
    this.sfx.unlock();
    this.sfx.uiClick();
    if (opts) {
      this.mode = opts.mode;
      // endless is the casual tier: standard density, so its records stay comparable
      this.difficulty = opts.mode === "endless" ? "medium" : opts.difficulty;
    }
    this.started = true;
    this.resetRun();
    this.setPhase("playing");
    this.nextWave();
  }

  getMode() {
    return this.mode;
  }

  getDifficulty() {
    return this.difficulty;
  }

  /** Keep the engine's stored run config in sync with the start-screen selection. */
  select(opts: StartOpts) {
    this.mode = opts.mode;
    this.difficulty = opts.mode === "endless" ? "medium" : opts.difficulty;
  }

  /** Endless only: serializable mid-run snapshot for Save & Exit. */
  snapshotRun(): EndlessSave | null {
    if (this.mode !== "endless" || !this.started) return null;
    if (this.phase !== "playing" && this.phase !== "paused" && this.phase !== "downed") return null;
    return {
      v: 1,
      mode: "endless",
      difficulty: this.difficulty,
      score: this.score,
      kills: this.kills,
      wave: Math.max(1, this.wave),
      time: this.runTime,
      bestChain: this.bestChain,
      deaths: this.deaths,
      hp: Math.max(1, Math.min(this.player.hp, this.player.maxHp)),
      bombs: clamp(this.bombs, 0, BOMB_MAX),
      bombRechargeT: this.bombRechargeT,
      wIdx: this.wIdx,
      weapons: this.weapons.map((o) => ({ id: o.def.id, mag: o.mag, reserve: o.reserve })),
      savedAt: Date.now(),
    };
  }

  /** Consumes a snapshot: fresh endless run with the saved stats, gear and wave replayed. */
  restoreRun(s: EndlessSave) {
    this.start({ mode: "endless", difficulty: s.difficulty });
    this.score = s.score;
    this.kills = s.kills;
    this.runTime = s.time;
    this.bestChain = s.bestChain;
    this.chain = 0;
    this.comboT = 0;
    this.deaths = s.deaths;
    this.bombs = clamp(s.bombs, 0, BOMB_MAX);
    this.bombRechargeT = this.bombs === 0 ? Math.max(1, s.bombRechargeT) : 0;
    this.player.hp = clamp(s.hp, 1, this.player.maxHp);
    const owned: OwnedWeapon[] = [];
    for (const ws of s.weapons) {
      const def = WEAPONS.find((d) => d.id === ws.id);
      if (def) owned.push({ def, mag: clamp(ws.mag, 0, def.mag), reserve: ws.reserve });
    }
    if (owned.length > 0) {
      this.weapons = owned;
      this.wIdx = clamp(s.wIdx, 0, owned.length - 1);
      this.player.reloadT = 0;
    }
    // replay the saved wave fresh (mid-wave zombies are not serialized)
    this.wave = Math.max(1, s.wave);
    this.spawnQueue = this.waveComp(this.wave);
    this.spawnT = 0.6;
    this.interT = 0;
    this.clearedFlag = false;
    this.zombies = [];
    this.marks = [];
    this.announce(`WAVE ${this.wave} — RESUMED`, `${s.score} PTS · ${s.kills} KILLS`, "#9dff20");
  }

  /** Save-and-quit leaves the yard WITHOUT counting the run as finished (no onRunEnd). */
  saveExit() {
    this.sfx.uiClick();
    this.started = false;
    this.initMenuZoms();
    this.setPhase("menu");
  }

  togglePause() {
    if (this.phase === "playing" || this.phase === "downed") {
      this.resumePhase = this.phase;
      this.setPhase("paused");
      this.sfx.uiClick();
    } else if (this.phase === "paused") {
      this.sfx.unlock();
      this.sfx.uiClick();
      this.setPhase(this.resumePhase);
    }
  }

  toMenu() {
    this.sfx.uiClick();
    // endless never reaches a game-over, so a run also ends when the player leaves
    if (this.started) {
      this.started = false;
      this.cb.onRunEnd(this.stats());
    }
    this.initMenuZoms();
    this.setPhase("menu");
  }

  toggleMute() {
    this.sfx.unlock();
    this.sfx.setMuted(!this.sfx.muted);
    this.cb.onMute(this.sfx.muted);
  }

  getMuted() {
    return this.sfx.muted;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    // a finger that was on the glass when play stopped must not keep steering or firing
    if (p !== "playing") this.resetSticks();
    this.cb.onPhase(p, p === "gameover" || p === "paused" ? this.stats() : undefined);
  }

  private stats(): RunStats {
    return {
      score: this.score,
      wave: this.wave,
      kills: this.kills,
      time: this.runTime,
      bestChain: this.bestChain,
      mode: this.mode,
      difficulty: this.difficulty,
      deaths: this.deaths,
    };
  }

  private resetRun() {
    this.zombies = [];
    this.bullets = [];
    this.acids = [];
    this.particles = [];
    this.floaters = [];
    this.pickups = [];
    this.marks = [];
    this.spawnQueue = [];
    this.decalCtx.clearRect(0, 0, this.worldW, this.worldH);

    const p = this.player;
    p.x = this.worldW / 2;
    p.y = this.worldH / 2;
    p.hp = p.maxHp;
    p.aim = -Math.PI / 2;
    p.dashT = 0;
    p.dashCd = 0;
    p.invulnT = 0;
    p.hurtT = 0;
    p.regenT = 0;
    p.fireCd = 0;
    p.reloadT = 0;
    p.muzzleT = 0;
    p.adreT = 0;
    p.dryCd = 0;

    this.weapons = [
      { def: WEAPONS[0], mag: WEAPONS[0].mag, reserve: -1 },
      { def: WEAPONS.find(w => w.id === "flame") || WEAPONS[0], mag: 100, reserve: 300 },
      { def: WEAPONS.find(w => w.id === "chainsaw") || WEAPONS[0], mag: 999, reserve: -1 }
    ];
    this.wIdx = 0;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.chain = 0;
    this.bestChain = 0;
    this.comboT = 0;
    this.spawnT = 0;
    this.interT = 0;
    this.clearedFlag = false;
    this.trauma = 0;
    this.hitStop = 0;
    this.flashA = 0;
    this.banner = null;
    this.runTime = 0;
    this.deaths = 0;
    this.respawnT = 0;
    this.lastTickN = 0;
    this.resumePhase = "playing";
    this.bombs = BOMB_START;
    this.bombCd = 0;
    this.bombRechargeT = 0;
    this.bombHoldId = -1;
    this.wantBomb = false;
    this.thrown.length = 0;
    this.rings.length = 0;
    this.blastDepth = 0;
    this.centerCamera();
  }

  /* ---------------- waves ---------------- */

  private waveComp(w: number): ZType[] {
    const q: ZType[] = [];
    const density = DIFFS[this.difficulty].density;
    const push = (t: ZType, n: number) => {
      const c = Math.max(1, Math.round(n * density));
      for (let i = 0; i < c; i++) q.push(t);
    };
    push("walker", 10 + Math.floor(w * 4.5));
    if (w >= 2) push("runner", Math.floor(w * 2.5));
    if (w >= 3) push("spitter", Math.floor(w * 0.8));
    if (w >= 4) push("exploder", Math.floor(w * 0.6) + (w >= 6 ? 2 : 0));
    if (w >= 4) push("alpha", Math.floor(w * 0.5) + (w >= 7 ? 1 : 0));
    if (w >= 5) push("brute", Math.floor((w - 2) * 0.8));
    // shuffle
    for (let i = q.length - 1; i > 0; i--) {
      const j = irand(0, i);
      [q[i], q[j]] = [q[j], q[i]];
    }
    return q;
  }

  private nextWave() {
    this.wave++;
    this.clearedFlag = false;
    this.spawnQueue = this.waveComp(this.wave);
    this.spawnT = 0.6;
    const sub =
      this.wave === 1
        ? "THEY SMELL YOU — HOLD THE YARD"
        : this.wave === 3
          ? "SPITTERS INBOUND — KEEP MOVING"
          : this.wave === 5
            ? "BRUTES BREACHED THE FENCE"
            : "THE HORDE THICKENS";
    this.announce(`WAVE ${this.wave}`, sub, "#ff2f2f");
    this.sfx.waveHorn();
  }

  private updateWaves(dt: number) {
    const alive = this.zombies.length;
    const queued = this.spawnQueue.length + this.marks.length;

    if (alive === 0 && queued === 0) {
      if (!this.clearedFlag) {
        this.clearedFlag = true;
        const bonus = 200 + this.wave * 100;
        this.score += bonus;
        this.announce("WAVE CLEARED", `SECTOR BONUS +${bonus}`, "#9dff20");
        this.sfx.waveClear();
        this.interT = 3.2;
        // a little gift between waves
        this.dropPickup(this.player.x + rand(-60, 60), this.player.y + rand(-60, 60), Math.random() < 0.5 ? "ammo" : "med");
        // resupply one bomb per wave
        if (this.bombs < BOMB_MAX) {
          this.bombs++;
          this.floaters.push({ x: this.player.x, y: this.player.y - 44, life: 1, max: 1, text: "+1 BOMB", color: "#ff5c2a", size: 16 });
        }
      } else {
        this.interT -= dt;
        if (this.interT <= 0) this.nextWave();
      }
      return;
    }

    const cap = DIFFS[this.difficulty].cap;
    if (this.spawnQueue.length > 0 && alive + this.marks.length < cap) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = Math.max(0.22, (1.15 - this.wave * 0.07) * DIFFS[this.difficulty].rate) * rand(0.7, 1.35);
        const type = this.spawnQueue.pop()!;
        const pt = this.spawnPoint();
        this.marks.push({ x: pt.x, y: pt.y, t: 0, dur: 0.7, type });
      }
    }

    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mk = this.marks[i];
      mk.t += dt;
      if (mk.t >= mk.dur) {
        this.spawnZombie(mk.type, clamp(mk.x, 20, this.worldW - 20), clamp(mk.y, 20, this.worldH - 20));
        this.marks.splice(i, 1);
      }
    }
  }

  /* Spawn marks appear just outside the view (never at the far map edge) so arrivals stay snappy. */
  private spawnPoint() {
    const cx = this.camX + this.W / 2;
    const cy = this.camY + this.H / 2;
    const rx = this.W / 2 + 62;
    const ry = this.H / 2 + 62;
    const m = 34;
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TAU);
      const x = cx + Math.cos(a) * rx * rand(1, 1.18);
      const y = cy + Math.sin(a) * ry * rand(1, 1.18);
      if (x > m && x < this.worldW - m && y > m && y < this.worldH - m && !this.visible(x, y, 20)) return { x, y };
    }
    return { x: clamp(cx + rx, m, this.worldW - m), y: clamp(cy, m, this.worldH - m) };
  }

  private spawnZombie(type: ZType, x: number, y: number) {
    const d = ZDEFS[type];
    const hpScale = 1 + (this.wave - 1) * 0.13;
    const spScale = 1 + Math.min(this.wave * 0.02, 0.45);
    this.zombies.push({
      type,
      x, y,
      vx: 0, vy: 0,
      hp: Math.round(d.hp * hpScale * rand(0.9, 1.1)),
      maxHp: Math.round(d.hp * hpScale),
      speed: d.speed * spScale * rand(0.85, 1.15),
      r: d.r,
      flash: 0,
      attackCd: rand(0, 0.3),
      spitCd: rand(0.8, 1.8),
      wob: rand(0, TAU),
      dead: false,
    });
    this.puff(x, y, 5, "#2c3a22", 2.4, false);
  }

  /* ---------------- update ---------------- */

  private update(dt: number) {
    const p = this.player;

    /* downed (endless): the yard keeps moving while the clock runs down */
    if (this.phase === "downed") {
      this.respawnT -= dt;
      const n = Math.max(1, Math.ceil(this.respawnT));
      if (n !== this.lastTickN) {
        this.lastTickN = n;
        this.sfx.tick();
      }
      if (this.respawnT <= 0) this.respawn();
      this.comboT -= dt;
      if (this.comboT <= 0) this.chain = 0;
      this.updateWaves(dt);
      this.updateZombies(dt);
      this.updateBullets(dt);
      this.updateBombs(dt);
      this.updateAcids(dt);
      this.updatePickups(dt);
      this.updateFx(dt);
      return;
    }

    this.runTime += dt;

    /* movement */
    let mx = 0;
    let my = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) my -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) my += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mx += 1;
    if (this.moveStick.on) {
      mx = this.moveStick.dx;
      my = this.moveStick.dy;
    }
    const mlen = Math.hypot(mx, my);
    if (mlen > 1) { mx /= mlen; my /= mlen; }
    p.moving = mlen > 0.05;

    const spd = 262 * (p.adreT > 0 ? 1.25 : 1);
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashX * 880 * dt;
      p.y += p.dashY * 880 * dt;
      if (Math.random() < 0.6) this.puff(p.x, p.y, 1, "#9dff20", 1.6, true);
    } else {
      p.x += mx * spd * dt;
      p.y += my * spd * dt;
      p.walk += dt * (p.moving ? 11 : 0);
    }
    p.x = clamp(p.x, p.r + 4, this.worldW - p.r - 4);
    p.y = clamp(p.y, p.r + 4, this.worldH - p.r - 4);

    /* dash */
    p.dashCd = Math.max(0, p.dashCd - dt);
    if (this.wantDash && p.dashCd <= 0 && p.dashT <= 0) {
      const dx = mlen > 0.05 ? mx : Math.cos(p.aim);
      const dy = mlen > 0.05 ? my : Math.sin(p.aim);
      p.dashT = 0.16;
      p.dashCd = 1.8;
      p.invulnT = Math.max(p.invulnT, 0.34);
      p.dashX = dx;
      p.dashY = dy;
      this.sfx.dash();
      this.puff(p.x, p.y, 10, "#9dff20", 2.6, true);
    }
    this.wantDash = false;

    /* aim */
    if (this.aimStick.on && Math.hypot(this.aimStick.dx, this.aimStick.dy) > 0.25) {
      p.aim = Math.atan2(this.aimStick.dy, this.aimStick.dx);
    } else if (!this.touchMode) {
      // mouse is screen-space, the player is world-space: add the camera back first
      p.aim = Math.atan2(this.mouse.y + this.camY - p.y, this.mouse.x + this.camX - p.x);
    }

    /* weapon switching (also cancels an auto-reload in progress) */
    if (this.switchTo >= 0) {
      const idx = this.weapons.findIndex((w) => w.def === WEAPONS[this.switchTo]);
      if (idx >= 0 && idx !== this.wIdx) {
        this.wIdx = idx;
        p.reloadT = 0;
        this.sfx.uiClick();
      }
      this.switchTo = -1;
    }
    if (this.wantCycle && this.weapons.length > 1) {
      this.wIdx = (this.wIdx + 1) % this.weapons.length;
      p.reloadT = 0;
      this.sfx.uiClick();
    }
    this.wantCycle = false;

    /* bomb */
    if (this.wantBomb) this.throwBomb();
    this.wantBomb = false;

    /* reload — triggered automatically the moment a magazine runs dry */
    const w = this.weapons[this.wIdx];
    this.tryAutoReload();
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        p.reloadT = 0;
        this.finishReload();
      }
    }

    /* fire */
    p.fireCd -= dt;
    p.muzzleT = Math.max(0, p.muzzleT - dt);
    p.dryCd = Math.max(0, p.dryCd - dt);
    const wantFire = this.mouse.down || this.aimStick.on;
    const rate = w.def.rate * (p.adreT > 0 ? 1.6 : 1);
    if (wantFire && p.fireCd <= 0 && p.dashT <= 0) {
      if (p.reloadT > 0) {
        // busy
      } else if (w.mag <= 0) {
        if (p.dryCd <= 0) {
          this.sfx.dryFire();
          p.dryCd = 0.25;
        }
      } else {
        this.shoot(w, rate);
      }
    }

    /* timers */
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.adreT = Math.max(0, p.adreT - dt);
    p.regenT += dt;
    if (p.regenT > 4 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 3.5 * dt);

    this.comboT -= dt;
    if (this.comboT <= 0) this.chain = 0;

    this.updateWaves(dt);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.updateBombs(dt);
    this.updateAcids(dt);
    this.updatePickups(dt);
    this.updateFx(dt);

    /* low hp heartbeat */
    if (p.hp <= 30) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.05;
        this.sfx.heart();
      }
    }
  }

  private startReload() {
    const p = this.player;
    const w = this.weapons[this.wIdx];
    if (p.reloadT > 0 || w.mag >= w.def.mag) return;
    if (w.reserve === 0) return;
    // zero-duration reloads (RIPPER SAW) would never tick past the completion check
    if (w.def.reload <= 0) {
      this.finishReload();
      return;
    }
    p.reloadT = w.def.reload;
    this.sfx.reload();
  }

  /* One shared guard for every firearm: empty mag + any reserve + not already reloading. */
  private tryAutoReload() {
    const p = this.player;
    const w = this.weapons[this.wIdx];
    if (w.mag <= 0 && w.reserve !== 0 && p.reloadT <= 0) this.startReload();
  }

  /* Tops the magazine back up exactly once when a reload finishes (or instantly for reload:0). */
  private finishReload() {
    const w = this.weapons[this.wIdx];
    const need = w.def.mag - w.mag;
    if (need <= 0) return;
    if (w.reserve < 0) w.mag = w.def.mag;
    else {
      if (w.reserve <= 0) return;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
    }
    this.sfx.reload();
  }

  private shoot(w: OwnedWeapon, rate: number) {
    const p = this.player;
    w.mag--;
    p.fireCd = 1 / rate;
    p.muzzleT = 0.055;
    this.trauma = Math.min(1.4, this.trauma + w.def.shake * 0.055);
    const muzzleX = p.x + Math.cos(p.aim) * 24;
    const muzzleY = p.y + Math.sin(p.aim) * 24;
    const fo = w.def.fo;
    const far = fo ? fo.far : 1;
    const foStart = fo ? fo.start : 0;
    const foEnd = fo ? fo.end : 0;
    for (let i = 0; i < w.def.pellets; i++) {
      const a = p.aim + rand(-w.def.spread, w.def.spread);
      const s = w.def.speed * rand(0.92, 1.05);
      this.bullets.push({
        x: muzzleX, y: muzzleY, x0: muzzleX, y0: muzzleY,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        dmg: w.def.dmg * rand(0.88, 1.12),
        life: w.def.id === "flame" ? rand(0.25, 0.4) : (w.def.id === "chainsaw" ? 0.08 : 0.9),
        pierce: w.def.pierce,
        knock: w.def.knock,
        tracer: w.def.id === "flame" ? (Math.random() > 0.5 ? "#ff5000" : "#ffb020") : w.def.tracer,
        far,
        foStart,
        foEnd,
      });
    }
    // shell casing
    if (w.def.id !== "flame" && w.def.id !== "chainsaw") {
      const ca = p.aim + Math.PI / 2 + rand(-0.4, 0.4);
      this.particles.push({
        x: muzzleX, y: muzzleY, vx: Math.cos(ca) * rand(90, 150), vy: Math.sin(ca) * rand(90, 150),
        life: 0.5, max: 0.5, size: 2.2, color: "#ffd479", drag: 0.88, add: false,
      });
      this.puff(muzzleX, muzzleY, 2, "#ffcf6a", 2.2, true);
    } else if (w.def.id === "flame") {
      this.puff(muzzleX, muzzleY, 3, "#ff5000", 3, true);
    } else if (w.def.id === "chainsaw") {
      this.puff(muzzleX, muzzleY, 4, "#ff2f2f", 2, true); // blood splatter instead of puff
    }

    if (w.def.id === "pistol") this.sfx.pistol();
    else if (w.def.id === "smg") this.sfx.smg();
    else if (w.def.id === "shotgun") this.sfx.shotgun();
    else if (w.def.id === "flame") { if (Math.random() < 0.25) this.sfx.smg(); }
    else if (w.def.id === "chainsaw") { if (Math.random() < 0.2) this.sfx.shotgun(); } // pretend it's a rev
    else this.sfx.rifle();

    // auto-reload: fire the instant the magazine runs dry, no input required
    this.tryAutoReload();
  }

  private updateZombies(dt: number) {
    const p = this.player;
    const zs = this.zombies;
    for (const z of zs) {
      if (z.dead) continue;
      const d = ZDEFS[z.type];
      z.flash = Math.max(0, z.flash - dt);
      z.attackCd -= dt;
      z.wob += dt * (z.speed / 9);

      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const dist = Math.hypot(dx, dy) || 1;
      let tx = dx / dist;
      let ty = dy / dist;

      // spitter keeps its distance and lobs acid
      if (z.type === "spitter") {
        if (dist < 190) { tx = -tx; ty = -ty; }
        else if (dist < 330) { tx = 0; ty = 0; }
        z.spitCd -= dt;
        if (z.spitCd <= 0 && dist < 480) {
          z.spitCd = rand(1.8, 2.6);
          this.acids.push({
            x: z.x, y: z.y, sx: z.x, sy: z.y,
            tx: p.x + rand(-30, 30), ty: p.y + rand(-30, 30),
            p: 0, dur: clamp(dist / 300, 0.5, 1.1), dmg: d.dmg, hit: false,
          });
          this.sfx.spit();
        }
      } else if (z.type === "alpha") {
        if (dist < 150) { tx = -tx; ty = -ty; } // tries to avoid getting too close if possible
        else if (dist < 250) { tx = 0; ty = 0; }
        z.spitCd -= dt;
        if (z.spitCd <= 0) {
          z.spitCd = 2.5;
          this.puff(z.x, z.y, 6, "#d942ff", 3, true);
          for (const other of zs) {
            if (other === z || other.dead) continue;
            if (dist2(z.x, z.y, other.x, other.y) < 250 * 250) {
              other.hp = Math.min(other.maxHp, other.hp + 15);
              other.speed = Math.min(ZDEFS[other.type].speed * 1.6, other.speed + 15);
              other.flash = 0.5;
            }
          }
        }
      }

      z.vx = tx * z.speed;
      z.vy = ty * z.speed;
      z.x += z.vx * dt;
      z.y += z.vy * dt;
      z.x = clamp(z.x, z.r, this.worldW - z.r);
      z.y = clamp(z.y, z.r, this.worldH - z.r);

      // contact attack
      const rr = z.r + p.r + 3;
      if (dist2(z.x, z.y, p.x, p.y) < rr * rr && z.attackCd <= 0) {
        z.attackCd = 0.9;
        this.damagePlayer(d.dmg, z.x, z.y);
      }
    }

    // build spatial hash grid
    for (let i = 0; i < this.grid.length; i++) this.grid[i].length = 0;
    for (const z of zs) {
      if (z.dead) continue;
      const cx = Math.max(0, Math.min(this.gridW - 1, Math.floor(z.x / this.gridCELL)));
      const cy = Math.max(0, Math.floor(z.y / this.gridCELL));
      const idx = cy * this.gridW + cx;
      if (idx < this.grid.length) this.grid[idx].push(z);
    }

    // separation using spatial hash
    for (const a of zs) {
      if (a.dead) continue;
      const cx = Math.max(0, Math.min(this.gridW - 1, Math.floor(a.x / this.gridCELL)));
      const cy = Math.max(0, Math.floor(a.y / this.gridCELL));
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          if (x >= 0 && x < this.gridW) {
            const idx = y * this.gridW + x;
            if (idx >= 0 && idx < this.grid.length) {
              for (const b of this.grid[idx]) {
                if (a === b || b.dead) continue;
                const rr = a.r + b.r;
                const d2 = dist2(a.x, a.y, b.x, b.y);
                if (d2 > 0.01 && d2 < rr * rr) {
                  const d = Math.sqrt(d2);
                  const push = ((rr - d) / d) * 0.5;
                  const px = (a.x - b.x) * push;
                  const py = (a.y - b.y) * push;
                  const aw = a.type === "brute" ? 0.12 : 1;
                  const bw = b.type === "brute" ? 0.12 : 1;
                  a.x += px * aw; a.y += py * aw;
                  b.x -= px * bw; b.y -= py * bw;
                }
              }
            }
          }
        }
      }
    }
    compact(zs);
  }

  private updateBullets(dt: number) {
    const zs = this.zombies;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = b.life <= 0 || b.x < -20 || b.x > this.worldW + 20 || b.y < -20 || b.y > this.worldH + 20;
      if (!dead) {
        let hit = false;
        const cx = Math.max(0, Math.min(this.gridW - 1, Math.floor(b.x / this.gridCELL)));
        const cy = Math.max(0, Math.floor(b.y / this.gridCELL));
        for (let y = cy - 1; y <= cy + 1; y++) {
          for (let x = cx - 1; x <= cx + 1; x++) {
            if (x >= 0 && x < this.gridW) {
              const idx = y * this.gridW + x;
              if (idx >= 0 && idx < this.grid.length) {
                for (const z of this.grid[idx]) {
                  if (z.dead) continue;
                  const rr = z.r + 4;
                  if (dist2(b.x, b.y, z.x, z.y) < rr * rr) {
                    this.hitZombie(z, b);
                    if (b.pierce > 0) {
                      b.pierce--;
                    } else {
                      dead = true;
                    }
                    hit = true;
                    break;
                  }
                }
              }
            }
            if (hit) break;
          }
          if (hit) break;
        }
      }
      if (dead) this.bullets.splice(i, 1);
    }
    compact(zs);
  }

  private hitZombie(z: Zombie, b: Bullet) {
    let dmg = b.dmg;
    // short-range falloff: one sqrt on impact only, never per frame
    if (b.far < 1) {
      const trav = Math.hypot(b.x - b.x0, b.y - b.y0);
      if (trav >= b.foEnd) dmg *= b.far;
      else if (trav > b.foStart) dmg *= 1 - (1 - b.far) * ((trav - b.foStart) / (b.foEnd - b.foStart));
    }
    const crit = Math.random() < 0.12;
    if (crit) dmg *= 2;
    z.hp -= dmg;
    z.flash = 0.11;
    const kb = b.knock / (z.r / 15);
    const len = Math.hypot(b.vx, b.vy) || 1;
    z.x += (b.vx / len) * kb * 0.06;
    z.y += (b.vy / len) * kb * 0.06;
    this.blood(b.x, b.y, 6, b.vx / len, b.vy / len);
    this.floaters.push({
      x: z.x + rand(-8, 8), y: z.y - z.r - 6,
      life: 0.7, max: 0.7,
      text: `${Math.round(dmg)}${crit ? "!" : ""}`,
      color: crit ? "#ffb020" : "#e8e2cf",
      size: crit ? 22 : 15,
    });
    if (this.time - this.lastHitSnd > 0.045) {
      this.lastHitSnd = this.time;
      if (crit) this.sfx.crit();
      else this.sfx.hit();
    }
    if (z.hp <= 0) this.killZombie(z, b.vx / len, b.vy / len, true);
  }

  private comboMult() {
    return this.chain >= 12 ? 5 : this.chain >= 8 ? 4 : this.chain >= 5 ? 3 : this.chain >= 2 ? 2 : 1;
  }

  private killZombie(z: Zombie, nx: number, ny: number, allowDrop: boolean) {
    if (z.dead) return;
    z.dead = true;
    const d = ZDEFS[z.type];
    this.kills++;
    this.chain++;
    this.bestChain = Math.max(this.bestChain, this.chain);
    this.comboT = 2.5;
    const mult = this.comboMult();
    const pts = d.score * mult;
    this.score += pts;
    this.floaters.push({
      x: z.x, y: z.y - z.r - 14, life: 0.9, max: 0.9,
      text: `+${pts}`, color: mult > 1 ? "#9dff20" : "#e8e2cf", size: mult > 1 ? 19 : 15,
    });
    if (mult > 1 && this.chain === 2) this.floaters.push({ x: z.x, y: z.y - z.r - 34, life: 0.9, max: 0.9, text: `CHAIN x${mult}`, color: "#9dff20", size: 17 });

    this.blood(z.x, z.y, z.type === "brute" ? 26 : 14, nx, ny);
    this.splatDecal(z.x, z.y, z.r * 1.3);
    this.sfx.zdie();
    this.sfx.splat();

    if (z.type === "brute") {
      this.hitStop = 0.06;
      this.trauma = Math.min(1.4, this.trauma + 0.55);
    }
    if (z.type === "exploder") this.explode(z.x, z.y);

    if (allowDrop && Math.random() < 0.2) {
      const roll = Math.random();
      const type: PickupType =
        roll < 0.3 ? "med" : roll < 0.62 ? "ammo" : roll < 0.82 ? "weapon" : roll < 0.94 ? "adre" : "nuke";
      this.dropPickup(z.x, z.y, type);
    }
  }

  /* Visits live zombies overlapping the circle using the spatial hash (never a full scan). */
  private forEachZombieInCircle(x: number, y: number, r: number, fn: (z: Zombie, d: number) => void) {
    const r2 = r * r;
    const c0x = Math.max(0, Math.floor((x - r) / this.gridCELL));
    const c1x = Math.min(this.gridW - 1, Math.floor((x + r) / this.gridCELL));
    const c0y = Math.max(0, Math.floor((y - r) / this.gridCELL));
    const c1y = Math.max(0, Math.floor((y + r) / this.gridCELL));
    for (let gy = c0y; gy <= c1y; gy++) {
      for (let gx = c0x; gx <= c1x; gx++) {
        const idx = gy * this.gridW + gx;
        if (idx < 0 || idx >= this.grid.length) continue;
        const cell = this.grid[idx];
        for (let i = 0; i < cell.length; i++) {
          const z = cell[i];
          if (z.dead) continue;
          const d2 = dist2(z.x, z.y, x, y);
          if (d2 < r2) fn(z, Math.sqrt(d2));
        }
      }
    }
  }

  /* Shared AoE: damages every zombie in the radius with linear falloff + knockback. */
  private blast(x: number, y: number, radius: number, dmgClose: number, dmgEdge: number, allowDrop: boolean) {
    // nested blasts (exploder chains) still deal damage but skip the costly visuals/sfx
    const heavy = this.blastDepth < 4;
    this.blastDepth++;
    if (heavy) {
      this.trauma = Math.min(1.5, this.trauma + 0.95);
      this.hitStop = Math.max(this.hitStop, 0.045);
      this.scorchDecal(x, y, radius * 0.47);
      for (let i = 0; i < 34; i++) {
        const a = rand(0, TAU);
        const s = rand(60, 420);
        this.particles.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rand(0.3, 0.7), max: 0.7, size: rand(2, 6),
          color: Math.random() < 0.5 ? "#ffb020" : "#ff5c2a", drag: 0.9, add: true,
        });
      }
      this.puff(x, y, 12, "#3a3a3a", 3.4, false);
    }
    const ramp = dmgEdge - dmgClose;
    this.forEachZombieInCircle(x, y, radius, (z, d) => {
      z.hp -= dmgClose + ramp * (d / radius);
      z.flash = 0.15;
      if (z.hp <= 0) {
        const len = d || 1;
        this.killZombie(z, (z.x - x) / len, (z.y - y) / len, allowDrop);
      }
    });
    this.blastDepth--;
  }

  private explode(x: number, y: number) {
    if (this.blastDepth < 4) this.sfx.explode();
    const pd = Math.hypot(this.player.x - x, this.player.y - y);
    if (pd < 110) this.damagePlayer(ZDEFS.exploder.dmg * (1 - pd / 140), x, y);
    this.blast(x, y, 110, 70, 70, false);
  }

  /* ---------------- AoE bomb ---------------- */

  private throwBomb() {
    const p = this.player;
    if (this.bombs <= 0 || this.bombCd > 0) return;
    this.bombs--;
    this.bombCd = 0.6;
    this.thrown.push({
      x: p.x + Math.cos(p.aim) * 20,
      y: p.y + Math.sin(p.aim) * 20,
      vx: Math.cos(p.aim) * BOMB_SPEED,
      vy: Math.sin(p.aim) * BOMB_SPEED,
      t: 0,
      rot: rand(0, TAU),
    });
    this.sfx.bombPin();
  }

  private updateBombs(dt: number) {
    this.bombCd = Math.max(0, this.bombCd - dt);
    // stock-dry recharge; any +1 source (wave clear, respawn) fills the stock and cancels it
    if (this.bombs === 0) {
      if (this.bombRechargeT <= 0) this.bombRechargeT = BOMB_RECHARGE;
      else {
        this.bombRechargeT -= dt;
        if (this.bombRechargeT <= 0) {
          this.bombRechargeT = 0;
          this.bombs = 1;
          this.floaters.push({ x: this.player.x, y: this.player.y - 44, life: 1, max: 1, text: "+1 BOMB", color: "#ff5c2a", size: 16 });
          this.sfx.uiClick();
        }
      }
    } else {
      this.bombRechargeT = 0;
    }
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const b = this.thrown[i];
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += dt * 14;
      // detonates on the first zombie it touches, on a wall, or at max range
      let hit = b.t >= BOMB_FUSE || b.x < 12 || b.x > this.worldW - 12 || b.y < 12 || b.y > this.worldH - 12;
      if (!hit) this.forEachZombieInCircle(b.x, b.y, 24, () => { hit = true; });
      if (!hit) {
        if (Math.random() < 0.5) this.puff(b.x, b.y, 1, "#ffd479", 1.6, true);
        continue;
      }
      const bx = clamp(b.x, 14, this.worldW - 14);
      const by = clamp(b.y, 14, this.worldH - 14);
      this.thrown.splice(i, 1);
      this.detonate(bx, by);
    }
  }

  private detonate(x: number, y: number) {
    this.sfx.bombBlast();
    this.flashA = Math.max(this.flashA, 0.3);
    const pd = Math.hypot(this.player.x - x, this.player.y - y);
    if (pd < BOMB_RADIUS) this.damagePlayer(BOMB_SELF * (1 - pd / BOMB_RADIUS), x, y);
    this.blast(x, y, BOMB_RADIUS, BOMB_DMG, BOMB_EDGE, true);
    this.rings.push({ x, y, t: 0, r: BOMB_RADIUS });
  }

  private damagePlayer(dmg: number, fx: number, fy: number) {
    const p = this.player;
    if (p.invulnT > 0 || this.phase !== "playing") return;
    p.hp -= dmg;
    p.invulnT = 0.5;
    p.hurtT = 0.45;
    p.regenT = 0;
    this.trauma = Math.min(1.5, this.trauma + 0.5);
    this.hitStop = Math.max(this.hitStop, 0.035);
    this.sfx.hurt();
    const len = Math.hypot(p.x - fx, p.y - fy) || 1;
    this.blood(p.x, p.y, 8, (p.x - fx) / len, (p.y - fy) / len);
    // knockback
    p.x = clamp(p.x + ((p.x - fx) / len) * 14, p.r, this.worldW - p.r);
    p.y = clamp(p.y + ((p.y - fy) / len) * 14, p.r, this.worldH - p.r);
    if (p.hp <= 0) {
      p.hp = 0;
      this.die();
    }
  }

  private die() {
    const p = this.player;
    this.blood(p.x, p.y, 46, 0, 0);
    this.splatDecal(p.x, p.y, 40);
    this.trauma = 1.5;
    this.hitStop = 0.12;
    this.sfx.explode();

    // endless never ends: count down, then drop the player straight back in
    if (this.mode === "endless") {
      this.deaths++;
      this.respawnT = 3;
      this.lastTickN = 4;
      this.sfx.down();
      this.setPhase("downed");
      return;
    }

    this.sfx.gameOver();
    this.setPhase("gameover");
    this.started = false;
    this.cb.onRunEnd(this.stats());
  }

  /* Endless revive: full health, a moment of grace, and a blast to clear the bubble. */
  private respawn() {
    const p = this.player;
    p.hp = p.maxHp;
    p.invulnT = 2.5;
    p.hurtT = 0;
    p.regenT = 0;
    p.reloadT = 0;
    p.adreT = 0;
    const w = this.weapons[this.wIdx];
    if (w.reserve < 0) w.mag = w.def.mag;
    else {
      const take = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
    }
    this.bombs = Math.min(BOMB_MAX, this.bombs + 1);
    this.blast(p.x, p.y, 140, 400, 400, false);
    this.rings.push({ x: p.x, y: p.y, t: 0, r: 140 });
    this.sfx.respawn();
    this.announce("BACK IN THE FIGHT", `DEATHS ${this.deaths}`, "#9dff20");
    this.setPhase("playing");
  }

  private updateAcids(dt: number) {
    const p = this.player;
    for (let i = this.acids.length - 1; i >= 0; i--) {
      const a = this.acids[i];
      a.p += dt / a.dur;
      a.x = a.sx + (a.tx - a.sx) * a.p;
      a.y = a.sy + (a.ty - a.sy) * a.p;
      const h = Math.sin(Math.min(a.p, 1) * Math.PI) * 46;
      if (Math.random() < 0.35) this.puff(a.x, a.y, 1, "#b8ff2e", 1.4, true);
      if (!a.hit && h < 14 && dist2(a.x, a.y, p.x, p.y) < 26 * 26) {
        a.hit = true;
        this.damagePlayer(a.dmg, a.x, a.y);
        this.sfx.acid();
      }
      if (a.p >= 1) {
        this.sfx.acid();
        this.puff(a.tx, a.ty, 8, "#b8ff2e", 2.2, true);
        this.decalCtx.fillStyle = "rgba(120,170,30,0.16)";
        this.decalCtx.beginPath();
        this.decalCtx.ellipse(a.tx, a.ty, 16, 10, rand(0, TAU), 0, TAU);
        this.decalCtx.fill();
        this.acids.splice(i, 1);
      }
    }
  }

  private updatePickups(dt: number) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.life -= dt;
      if (pk.life <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }
      if (dist2(pk.x, pk.y, p.x, p.y) < 30 * 30) {
        this.collect(pk);
        this.pickups.splice(i, 1);
      }
    }
  }

  private dropPickup(x: number, y: number, type: PickupType) {
    let weaponIdx = -1;
    if (type === "weapon") {
      const unowned = WEAPONS.filter((d) => !this.weapons.some((w) => w.def === d));
      if (unowned.length === 0) type = "ammo";
      else weaponIdx = WEAPONS.indexOf(this.pickBalancedWeapon(unowned));
    }
    this.pickups.push({
      x: clamp(x, 26, this.W - 26), y: clamp(y, 26, this.H - 26),
      type, weaponIdx, t: 0, life: 13,
    });
  }

  /* Keeps the loadout drifting toward the designed 50/50 long-range / short-range split. */
  private pickBalancedWeapon(pool: WeaponDef[]): WeaponDef {
    let longOwned = 0;
    for (const w of this.weapons) if (w.def.role === "long") longOwned++;
    const shortOwned = this.weapons.length - longOwned;
    const want: WeaponRole = longOwned <= shortOwned ? "long" : "short";
    const preferred = pool.filter((d) => d.role === want);
    const list = preferred.length > 0 ? preferred : pool;
    return list[irand(0, list.length - 1)];
  }

  private collect(pk: Pickup) {
    const p = this.player;
    this.sfx.pickup();
    this.score += 25;
    if (pk.type === "med") {
      p.hp = Math.min(p.maxHp, p.hp + 40);
      this.sfx.medkit();
      this.floaters.push({ x: p.x, y: p.y - 26, life: 0.9, max: 0.9, text: "+40 HP", color: "#7dffa8", size: 17 });
      this.puff(p.x, p.y, 12, "#7dffa8", 2.4, true);
    } else if (pk.type === "ammo") {
      for (const w of this.weapons) {
        if (w.reserve >= 0) w.reserve = Math.min(999, w.reserve + w.def.mag * 2);
        w.mag = w.def.mag;
      }
      this.floaters.push({ x: p.x, y: p.y - 26, life: 0.9, max: 0.9, text: "AMMO REFILLED", color: "#ffb020", size: 16 });
    } else if (pk.type === "weapon") {
      const def = WEAPONS[pk.weaponIdx];
      this.weapons.push({ def, mag: def.mag, reserve: def.reserve });
      this.wIdx = this.weapons.length - 1;
      p.reloadT = 0;
      this.floaters.push({ x: p.x, y: p.y - 26, life: 1.1, max: 1.1, text: `${def.name} ACQUIRED`, color: "#9dff20", size: 18 });
    } else if (pk.type === "adre") {
      p.adreT = 8;
      this.floaters.push({ x: p.x, y: p.y - 26, life: 1, max: 1, text: "ADRENALINE SURGE", color: "#b8ff2e", size: 17 });
      this.puff(p.x, p.y, 16, "#b8ff2e", 3, true);
    } else if (pk.type === "nuke") {
      this.sfx.nuke();
      this.flashA = 1;
      this.trauma = 1.5;
      for (const z of this.zombies) {
        if (!z.dead) {
          this.blood(z.x, z.y, 10, 0, 0);
          this.splatDecal(z.x, z.y, z.r);
          z.dead = true;
          this.kills++;
          this.score += ZDEFS[z.type].score;
        }
      }
      compact(this.zombies);
      this.announce("TACTICAL NUKE", "THE YARD IS QUIET... FOR NOW", "#ffb020");
    }
  }

  /* ---------------- fx ---------------- */

  private announce(text: string, sub: string, color: string) {
    if (!text) return;
    this.banner = { text, sub, t: 0, dur: 2.1, color };
  }

  private puff(x: number, y: number, n: number, color: string, size: number, add: boolean) {
    if (this.particles.length > 650) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(20, 130);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.2, 0.5), max: 0.5, size: rand(1, size), color, drag: 0.86, add,
      });
    }
  }

  private blood(x: number, y: number, n: number, nx: number, ny: number) {
    if (this.particles.length > 650) return;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + rand(-1.1, 1.1);
      const s = rand(40, 300);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.25, 0.6), max: 0.6, size: rand(1.5, 4),
        color: Math.random() < 0.5 ? "#c81e1e" : "#7a1010", drag: 0.86, add: false,
      });
    }
  }

  private splatDecal(x: number, y: number, r: number) {
    const c = this.decalCtx;
    const n = irand(5, 9);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const d = rand(0, r);
      c.fillStyle = Math.random() < 0.5 ? "rgba(110,14,14,0.5)" : "rgba(70,8,8,0.5)";
      c.beginPath();
      c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rand(2, r * 0.32), 0, TAU);
      c.fill();
    }
  }

  private scorchDecal(x: number, y: number, r: number) {
    const c = this.decalCtx;
    const g = c.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }

  private updateFx(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= pt.drag;
      pt.vy *= pt.drag;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= 0.3) {
        this.rings[i] = this.rings[this.rings.length - 1];
        this.rings.pop();
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.y -= 44 * dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.dur) this.banner = null;
    }
  }

  private updateAmbient(dt: number) {
    for (const f of this.fog) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -300) f.x = this.W + 280;
      if (f.x > this.W + 300) f.x = -280;
      if (f.y < -300) f.y = this.H + 280;
      if (f.y > this.H + 300) f.y = -280;
    }
    for (const d of this.dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < 0) d.x = this.W;
      if (d.x > this.W) d.x = 0;
      if (d.y < 0) d.y = this.H;
      if (d.y > this.H) d.y = 0;
    }
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    this.flashA = Math.max(0, this.flashA - dt * 2.6);
  }

  private updateMenu(dt: number) {
    for (const z of this.menuZoms) {
      z.turnT -= dt;
      if (z.turnT <= 0) {
        z.turnT = rand(1, 3);
        z.a = rand(0, TAU);
      }
      z.wob += dt * 5;
      z.x += Math.cos(z.a) * z.speed * dt;
      z.y += Math.sin(z.a) * z.speed * dt;
      const x0 = this.camX + 30;
      const x1 = this.camX + this.W - 30;
      const y0 = this.camY + 30;
      const y1 = this.camY + this.H - 30;
      if (z.x < x0 || z.x > x1) z.a = Math.PI - z.a;
      if (z.y < y0 || z.y > y1) z.a = -z.a;
      z.x = clamp(z.x, x0, x1);
      z.y = clamp(z.y, y0, y1);
    }
  }

  private initMenuZoms() {
    this.menuZoms = [];
    this.centerCamera(); // frame the arena center before scattering the ambience
    const types: ZType[] = ["walker", "runner", "brute", "walker", "spitter", "exploder", "walker"];
    for (const t of types) {
      this.menuZoms.push({
        x: rand(this.camX + 60, this.camX + this.W - 60),
        y: rand(this.camY + 60, this.camY + this.H - 60),
        a: rand(0, TAU), turnT: rand(0.5, 2), speed: ZDEFS[t].speed * 0.5,
        type: t, wob: rand(0, TAU),
      });
    }
  }

  /* ---------------- input ---------------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
    this.sfx.unlock();
    const c = e.code;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(c)) e.preventDefault();
    this.keys.add(c);
    if (c === "Enter") {
      if (this.phase === "menu" || this.phase === "gameover") this.start();
    } else if (c === "KeyP" || c === "Escape") {
      if (this.phase === "playing" || this.phase === "paused") this.togglePause();
    } else if (c === "KeyM") {
      this.toggleMute();
    } else if (c === "KeyR") {
      if (this.phase === "gameover") this.start();
    } else if (c === "KeyG") {
      // hold G to preview the throw; releasing (onKeyUp) throws
      if (this.phase === "playing") this.bombHoldId = -2;
    } else if (c === "Space" || c === "ShiftLeft" || c === "ShiftRight") {
      if (this.phase === "playing") this.wantDash = true;
    } else if (c.startsWith("Digit")) {
      const n = Number(c.slice(5)) - 1;
      if (n >= 0 && n < WEAPONS.length) this.switchTo = n;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === "KeyG" && this.bombHoldId === -2) {
      this.bombHoldId = -1;
      if (this.phase === "playing") this.wantBomb = true;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.weapons.length <= 1 || this.player.reloadT > 0 || this.phase !== "playing") return;
    if (e.deltaY > 0) {
      this.wIdx = (this.wIdx + 1) % this.weapons.length;
      this.sfx.uiClick();
    } else if (e.deltaY < 0) {
      this.wIdx = (this.wIdx - 1 + this.weapons.length) % this.weapons.length;
      this.sfx.uiClick();
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    this.sfx.unlock();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.pointerType !== "touch") {
      // desktop keeps mouse aim + left-click fire; weapon swapping lives on wheel / number keys
      if (e.button === 0) this.mouse.down = true;
      this.mouse.x = x;
      this.mouse.y = y;
      return;
    }
    this.touchMode = true;
    if (this.phase !== "playing") return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    // on-screen buttons take priority over the sticks
    for (const b of this.touchButtons()) {
      if (dist2(x, y, b.x, b.y) < b.r * b.r * 1.8) {
        this.pressTouchBtn(b.id, e.pointerId);
        return;
      }
    }
    // weapon slots resolve on tap-up, so a drag starting on the slot row still steers
    const slot = this.slotHit(x, y);
    if (slot >= 0) {
      this.tapCand = { id: e.pointerId, idx: slot, x, y };
      return;
    }
    if (x < this.W * 0.44 && this.moveStick.id < 0) {
      this.moveStick = { id: e.pointerId, bx: x, by: y, dx: 0, dy: 0, on: true };
    } else if (this.aimStick.id < 0) {
      this.aimStick = { id: e.pointerId, bx: x, by: y, dx: 0, dy: 0, on: true };
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.pointerType !== "touch") {
      this.mouse.x = x;
      this.mouse.y = y;
      return;
    }
    // a finger that started on a weapon slot but is dragging becomes a stick instead
    if (e.pointerId === this.tapCand.id) {
      if (Math.hypot(x - this.tapCand.x, y - this.tapCand.y) > 12) {
        if (this.tapCand.x < this.W * 0.44) {
          if (!this.moveStick.on) this.moveStick = { id: e.pointerId, bx: this.tapCand.x, by: this.tapCand.y, dx: 0, dy: 0, on: true };
        } else if (!this.aimStick.on) {
          this.aimStick = { id: e.pointerId, bx: this.tapCand.x, by: this.tapCand.y, dx: 0, dy: 0, on: true };
        }
        this.tapCand = { id: -1, idx: -1, x: 0, y: 0 };
      } else {
        return;
      }
    }
    const upd = (s: { id: number; bx: number; by: number; dx: number; dy: number }) => {
      let dx = x - s.bx;
      let dy = y - s.by;
      const len = Math.hypot(dx, dy);
      const max = 52;
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      s.dx = dx / max;
      s.dy = dy / max;
    };
    if (e.pointerId === this.moveStick.id) upd(this.moveStick);
    if (e.pointerId === this.aimStick.id) upd(this.aimStick);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== "touch") {
      if (e.button === 0) this.mouse.down = false;
      return;
    }
    if (e.pointerId === this.tapCand.id) {
      const idx = this.tapCand.idx;
      this.tapCand = { id: -1, idx: -1, x: 0, y: 0 };
      this.selectSlot(idx);
    }
    if (e.pointerId === this.moveStick.id) {
      this.moveStick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0, on: false };
    }
    if (e.pointerId === this.aimStick.id) {
      this.aimStick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0, on: false };
    }
    if (e.pointerId === this.bombHoldId) {
      this.bombHoldId = -1;
      if (this.phase === "playing") this.wantBomb = true;
    }
  };

  private onBlur = () => {
    if (this.phase === "playing") this.togglePause();
    this.keys.clear();
    this.mouse.down = false;
  };

  private onVis = () => {
    if (document.hidden && this.phase === "playing") this.togglePause();
  };

  private onCtx = (e: Event) => e.preventDefault();

  private onResize = () => this.resize();

  private bind() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    document.addEventListener("visibilitychange", this.onVis);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", this.onCtx);
  }

  private unbind() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("visibilitychange", this.onVis);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onCtx);
  }

  /* Single source of truth for on-screen button geometry: drawn and hit-tested from here. */
  private touchButtons(): TouchBtn[] {
    const tight = this.H < 430;
    return [
      { id: "dash", x: this.W - 64 - this.safeR, y: this.H - 76 - this.safeB, r: 32 },
      { id: "swap", x: this.W - 64 - this.safeR, y: this.H - 156 - this.safeB, r: 26 },
      {
        id: "bomb",
        x: tight ? this.W - 140 - this.safeR : this.W - 64 - this.safeR,
        y: tight ? this.H - 170 - this.safeB : this.H - 234 - this.safeB,
        r: tight ? 26 : 24,
      },
    ];
  }

  private pressTouchBtn(id: TouchBtnId, pid: number) {
    if (id === "dash") this.wantDash = true;
    else if (id === "swap") this.wantCycle = true;
    else this.bombHoldId = pid; // hold to preview the trajectory; pointerup throws
  }

  /* Weapon slot geometry, shared by the HUD and the touch hit-test. */
  private slotRect(i: number) {
    if (this.touchMode) return { x: 14 + this.safeL + i * 34, y: 70 + this.safeT, w: 34, h: 24 };
    return { x: 18 + this.safeL + i * 40, y: this.H - 108 - this.safeB, w: 34, h: 24 };
  }

  private slotHit(x: number, y: number) {
    const pad = 6;
    for (let i = 0; i < WEAPONS.length; i++) {
      const r = this.slotRect(i);
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return i;
    }
    return -1;
  }

  private selectSlot(idx: number) {
    if (idx < 0 || idx >= WEAPONS.length) return;
    const owned = this.weapons.findIndex((w) => w.def === WEAPONS[idx]);
    if (owned < 0 || owned === this.wIdx) return;
    this.switchTo = idx;
    this.sfx.uiClick();
  }

  /* Drops every touch the browser may no longer report (pause, blur, tab switch, pointer loss). */
  private resetSticks() {
    this.moveStick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0, on: false };
    this.aimStick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0, on: false };
    this.tapCand = { id: -1, idx: -1, x: 0, y: 0 };
    this.bombHoldId = -1; // a held bomb never throws across a pause/blur
    this.wantBomb = false;
  }

  /* ---------------- layout & prerender ---------------- */

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(320, window.innerWidth);
    this.H = Math.max(320, window.innerHeight);
    this.readSafeInsets();
    this.buildVignettes();
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    
    // the arena only reshapes between runs, so browser-chrome resizing can't rescale it mid-fight
    if (this.phase === "playing" || this.phase === "downed") {
      this.clampCamera();
      return;
    }

    this.worldW = clamp(Math.round(this.W * WORLD_SCALE), WORLD_MIN_W, WORLD_MAX);
    this.worldH = clamp(Math.round(this.H * WORLD_SCALE), WORLD_MIN_H, WORLD_MAX);

    this.gridW = Math.ceil(this.worldW / this.gridCELL) + 1;
    const gh = Math.ceil(this.worldH / this.gridCELL) + 1;
    if (this.grid.length !== this.gridW * gh) this.grid = Array.from({ length: this.gridW * gh }, () => []);

    this.buildGroundTiles();

    const dw = Math.ceil(this.worldW * DECAL_SCALE);
    const dh = Math.ceil(this.worldH * DECAL_SCALE);
    const old = this.decal;
    const keep = old.width === dw && old.height === dh;
    this.decal = document.createElement("canvas");
    this.decal.width = dw;
    this.decal.height = dh;
    this.decalCtx = this.decal.getContext("2d")!;
    this.decalCtx.scale(DECAL_SCALE, DECAL_SCALE);
    if (keep) this.decalCtx.drawImage(old, 0, 0, this.worldW, this.worldH);

    // keep everything inside the arena
    this.player.x = clamp(this.player.x, 20, this.worldW - 20);
    this.player.y = clamp(this.player.y, 20, this.worldH - 20);
    for (const z of this.zombies) {
      z.x = clamp(z.x, z.r, this.worldW - z.r);
      z.y = clamp(z.y, z.r, this.worldH - z.r);
    }
    for (const m of this.menuZoms) {
      m.x = clamp(m.x, 24, this.worldW - 24);
      m.y = clamp(m.y, 24, this.worldH - 24);
    }
    this.centerCamera();
    if (this.phase === "menu") this.initMenuZoms(); // re-frame the ambience after a reshape
  }

  /* ---------------- camera ---------------- */

  private centerCamera() {
    this.camX = clamp(this.worldW / 2 - this.W / 2, 0, Math.max(0, this.worldW - this.W));
    this.camY = clamp(this.worldH / 2 - this.H / 2, 0, Math.max(0, this.worldH - this.H));
  }

  private clampCamera() {
    this.camX = clamp(this.camX, 0, Math.max(0, this.worldW - this.W));
    this.camY = clamp(this.camY, 0, Math.max(0, this.worldH - this.H));
  }

  /* Dead-zone follow: the view only moves once the player leaves the middle of the screen. */
  private updateCamera(dt: number) {
    const p = this.player;
    const tx = p.x - this.W / 2;
    const ty = p.y - this.H / 2;
    const deadX = this.W * CAM_DEAD_X;
    const deadY = this.H * CAM_DEAD_Y;
    let gx = this.camX;
    let gy = this.camY;
    const dx = tx - this.camX;
    const dy = ty - this.camY;
    if (dx > deadX) gx = tx - deadX;
    else if (dx < -deadX) gx = tx + deadX;
    if (dy > deadY) gy = ty - deadY;
    else if (dy < -deadY) gy = ty + deadY;
    const k = Math.min(1, dt * CAM_LERP);
    this.camX += (gx - this.camX) * k;
    this.camY += (gy - this.camY) * k;
    this.clampCamera();
  }

  private visible(x: number, y: number, pad: number) {
    return (
      x > this.camX - pad && x < this.camX + this.W + pad &&
      y > this.camY - pad && y < this.camY + this.H + pad
    );
  }

  /* Notch / home-bar insets (standalone + viewport-fit=cover), read once per resize. */
  private safeL = 0;
  private safeT = 0;
  private safeR = 0;
  private safeB = 0;

  /* env() only lives in CSS, so a hidden probe element reads it back for the canvas HUD. */
  private readSafeInsets() {
    try {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
        "padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);" +
        "padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);";
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      this.safeL = parseFloat(cs.paddingLeft) || 0;
      this.safeT = parseFloat(cs.paddingTop) || 0;
      this.safeR = parseFloat(cs.paddingRight) || 0;
      this.safeB = parseFloat(cs.paddingBottom) || 0;
      probe.remove();
    } catch {
      this.safeL = this.safeT = this.safeR = this.safeB = 0;
    }
  }

  /* Tile pool: baked once (~6.3 MB for 6 × 512²), constant no matter how big the world gets. */
  private buildGroundTiles() {
    if (this.groundTiles.length === TILE_VARIANTS) return;
    this.groundVariant = irand(0, TILE_VARIANTS - 1);
    const T = GROUND_TILE;
    for (let v = 0; v < TILE_VARIANTS; v++) {
      const cv = document.createElement("canvas");
      cv.width = T;
      cv.height = T;
      const c = cv.getContext("2d")!;
      c.fillStyle = "#141a10";
      c.fillRect(0, 0, T, T);

      // wrap a radial blob across tile edges so gradients are seamless
      const blob = (x: number, y: number, r: number, paint: (x: number, y: number) => void) => {
        for (const [ox, oy] of TILE_WRAP) {
          const bx = x + ox * T;
          const by = y + oy * T;
          if (bx < -r || bx > T + r || by < -r || by > T + r) continue;
          paint(bx, by);
        }
      };
      // duplicate a point-sprite across edges for the same reason
      const dot = (x: number, y: number, paint: () => void) => {
        paint();
        if (x < 8) { c.translate(T, 0); paint(); c.translate(-T, 0); }
        if (x > T - 8) { c.translate(-T, 0); paint(); c.translate(T, 0); }
        if (y < 8) { c.translate(0, T); paint(); c.translate(0, -T); }
        if (y > T - 8) { c.translate(0, -T); paint(); c.translate(0, T); }
      };

      // mossy patches
      for (let i = 0; i < 7; i++) {
        const x = rand(0, T);
        const y = rand(0, T);
        const r = rand(60, 200);
        const dark = Math.random() < 0.5;
        blob(x, y, r, (bx, by) => {
          const gr = c.createRadialGradient(bx, by, 4, bx, by, r);
          gr.addColorStop(0, dark ? "rgba(9,13,7,0.5)" : "rgba(38,50,28,0.35)");
          gr.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = gr;
          c.beginPath();
          c.arc(bx, by, r, 0, TAU);
          c.fill();
        });
      }
      // toxic puddle glows
      for (let i = 0; i < 2; i++) {
        const x = rand(40, T - 40);
        const y = rand(40, T - 40);
        const r = rand(26, 60);
        blob(x, y, r, (bx, by) => {
          const gr = c.createRadialGradient(bx, by, 2, bx, by, r);
          gr.addColorStop(0, "rgba(157,255,32,0.09)");
          gr.addColorStop(0.8, "rgba(157,255,32,0.03)");
          gr.addColorStop(1, "rgba(157,255,32,0)");
          c.fillStyle = gr;
          c.beginPath();
          c.ellipse(bx, by, r, r * 0.6, rand(0, TAU), 0, TAU);
          c.fill();
        });
      }
      // cracks (kept in-bounds; ending at the margin reads as natural)
      c.strokeStyle = "rgba(5,8,4,0.7)";
      for (let i = 0; i < 7; i++) {
        c.lineWidth = rand(0.6, 1.8);
        c.beginPath();
        let x = rand(14, T - 14);
        let y = rand(14, T - 14);
        c.moveTo(x, y);
        const segs = irand(3, 7);
        let a = rand(0, TAU);
        for (let s = 0; s < segs; s++) {
          a += rand(-0.7, 0.7);
          x += Math.cos(a) * rand(14, 46);
          y += Math.sin(a) * rand(14, 46);
          if (x < 8 || x > T - 8 || y < 8 || y > T - 8) break;
          c.lineTo(x, y);
        }
        c.stroke();
      }
      // speckle noise
      for (let i = 0; i < 440; i++) {
        const l = Math.random();
        const x = rand(0, T);
        const y = rand(0, T);
        c.fillStyle = l < 0.5 ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.09)";
        dot(x, y, () => c.fillRect(x, y, rand(1, 2.4), rand(1, 2.4)));
      }
      // rubble
      for (let i = 0; i < 17; i++) {
        const x = rand(0, T);
        const y = rand(0, T);
        c.fillStyle = `rgba(${irand(40, 70)},${irand(46, 74)},${irand(34, 56)},0.8)`;
        dot(x, y, () => { c.beginPath(); c.arc(x, y, rand(1.5, 4.5), 0, TAU); c.fill(); });
      }
      // bones (half the variants carry them, for texture variety)
      if (v % 2 === 0) {
        for (let i = 0; i < 3; i++) {
          const x = rand(26, T - 26);
          const y = rand(26, T - 26);
          c.save();
          c.translate(x, y);
          c.rotate(rand(0, TAU));
          c.fillStyle = "rgba(210,205,180,0.14)";
          c.fillRect(-9, -1.6, 18, 3.2);
          c.beginPath();
          c.arc(10, 0, 3.4, 0, TAU);
          c.fill();
          c.restore();
        }
      }
      // old baked blood
      if (v % 3 === 0) {
        for (let i = 0; i < 3; i++) {
          const x = rand(46, T - 46);
          const y = rand(46, T - 46);
          c.fillStyle = "rgba(80,12,12,0.12)";
          c.beginPath();
          c.ellipse(x, y, rand(14, 40), rand(8, 22), rand(0, TAU), 0, TAU);
          c.fill();
        }
      }
      this.groundTiles.push(cv);
    }
  }

  /* Culls to the tiles under the viewport: cost scales with the screen, never the world. */
  private drawGround(c: CanvasRenderingContext2D) {
    const T = GROUND_TILE;
    const x0 = Math.max(0, Math.floor(this.camX / T));
    const y0 = Math.max(0, Math.floor(this.camY / T));
    const x1 = Math.min(Math.ceil(this.worldW / T) - 1, Math.floor((this.camX + this.W) / T));
    const y1 = Math.min(Math.ceil(this.worldH / T) - 1, Math.floor((this.camY + this.H) / T));
    for (let ty = y0; ty <= y1; ty++) {
      const py = ty * T;
      for (let tx = x0; tx <= x1; tx++) {
        const px = tx * T;
        const h = Math.abs((tx * 73856093) ^ (ty * 19349663) ^ this.groundVariant);
        const flipX = (h & 1) === 1;
        const flipY = (h & 2) === 2;
        c.save();
        c.translate(px, py);
        if (flipX) { c.translate(T, 0); c.scale(-1, 1); }
        if (flipY) { c.translate(0, T); c.scale(1, -1); }
        c.drawImage(this.groundTiles[h % TILE_VARIANTS], 0, 0);
        c.restore();
        // low-alpha per-cell tint so repeats never read as a grid
        const t = (h >> 2) & 3;
        if (t !== 0) {
          c.fillStyle = TINTS[t];
          c.fillRect(px, py, T, T);
        }
      }
    }
    // the yard's fence line, in world space
    c.save();
    c.strokeStyle = "rgba(157,255,32,0.10)";
    c.lineWidth = 2;
    c.setLineDash([16, 12]);
    c.strokeRect(10, 10, this.worldW - 20, this.worldH - 20);
    c.restore();
  }

  private buildVignettes() {
    const v = this.vignette;
    v.width = this.W;
    v.height = this.H;
    let c = v.getContext("2d")!;
    const r = Math.hypot(this.W, this.H) * 0.55;
    const g = c.createRadialGradient(this.W / 2, this.H / 2, r * 0.35, this.W / 2, this.H / 2, r);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.62)");
    c.fillStyle = g;
    c.fillRect(0, 0, this.W, this.H);

    const rv = this.redVig;
    rv.width = this.W;
    rv.height = this.H;
    c = rv.getContext("2d")!;
    const g2 = c.createRadialGradient(this.W / 2, this.H / 2, r * 0.3, this.W / 2, this.H / 2, r);
    g2.addColorStop(0, "rgba(255,20,20,0)");
    g2.addColorStop(0.75, "rgba(200,10,10,0.25)");
    g2.addColorStop(1, "rgba(160,0,0,0.6)");
    c.fillStyle = g2;
    c.fillRect(0, 0, this.W, this.H);
  }

  private buildFog() {
    this.fogSprites = [];
    for (let i = 0; i < 3; i++) {
      const cv = document.createElement("canvas");
      cv.width = 256;
      cv.height = 256;
      const c = cv.getContext("2d")!;
      const g = c.createRadialGradient(128, 128, 10, 128, 128, 128);
      g.addColorStop(0, "rgba(130,160,120,0.10)");
      g.addColorStop(1, "rgba(130,160,120,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 256);
      this.fogSprites.push(cv);
    }
    this.fog = [];
    for (let i = 0; i < 8; i++) {
      this.fog.push({
        x: rand(0, this.W), y: rand(0, this.H),
        vx: rand(-14, 14), vy: rand(-8, 8), s: rand(1.4, 3.2),
      });
    }
  }

  private buildDust() {
    this.dust = [];
    for (let i = 0; i < 34; i++) {
      this.dust.push({ x: rand(0, this.W), y: rand(0, this.H), vx: rand(-9, 9), vy: rand(-6, 6), a: rand(0.04, 0.13) });
    }
  }

  /* Bake each pickup glow once instead of building a radial gradient every frame. */
  private buildGlowSprites() {
    const colors: Record<PickupType, string> = {
      med: "rgba(125,255,168,0.25)", ammo: "rgba(255,176,32,0.25)",
      weapon: "rgba(157,255,32,0.28)", adre: "rgba(184,255,46,0.28)", nuke: "rgba(255,47,47,0.3)",
    };
    const s = GLOW_SIZE * 2;
    for (const k of Object.keys(colors) as PickupType[]) {
      const cv = document.createElement("canvas");
      cv.width = s;
      cv.height = s;
      const c = cv.getContext("2d")!;
      const g = c.createRadialGradient(GLOW_SIZE, GLOW_SIZE, 2, GLOW_SIZE, GLOW_SIZE, GLOW_SIZE);
      g.addColorStop(0, colors[k]);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(GLOW_SIZE, GLOW_SIZE, GLOW_SIZE, 0, TAU);
      c.fill();
      this.glowSprites[k] = cv;
    }
  }

  private glowSprite(type: PickupType): HTMLCanvasElement {
    return this.glowSprites[type] || this.glowSprites.med!;
  }

  /* ---------------- main loop ---------------- */

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    let rawDt = (t - this.last) / 1000;
    this.last = t;
    rawDt = clamp(rawDt, 0, 0.05);
    this.time += rawDt;

    let dt = rawDt;
    if (this.hitStop > 0) {
      this.hitStop -= rawDt;
      dt = 0;
    }

    this.updateAmbient(rawDt);
    if (this.phase === "playing" || this.phase === "downed") {
      if (dt > 0) this.update(dt);
      this.updateCamera(rawDt);
    } else if (this.phase === "menu") {
      this.updateMenu(rawDt);
      this.updateFx(rawDt);
    } else if (this.phase === "gameover") {
      this.updateFx(rawDt);
    }

    this.draw();
  };

  /* ---------------- drawing ---------------- */

  private draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);

    const shake = this.trauma * this.trauma * 20;
    const sx = shake > 0.1 ? rand(-shake, shake) : 0;
    const sy = shake > 0.1 ? rand(-shake, shake) : 0;

    c.save();
    c.translate(sx, sy);

    /* world space — integer-snapped camera offset keeps tiles and sprites crisp */
    c.save();
    c.translate(-Math.round(this.camX), -Math.round(this.camY));

    this.drawGround(c);
    c.drawImage(this.decal, 0, 0, this.worldW, this.worldH);

    // dust motes
    for (const d of this.dust) {
      c.fillStyle = `rgba(190,210,170,${d.a})`;
      c.fillRect(d.x + this.camX, d.y + this.camY, 1.6, 1.6);
    }

    if (this.phase === "menu") {
      for (const z of this.menuZoms) this.drawZombieBody(z.type, z.x, z.y, Math.cos(z.a), Math.sin(z.a), z.wob, ZDEFS[z.type].r, 0, 1, 0.55);
    } else {
      this.drawMarks();
      this.drawPickups();
      for (const z of this.zombies) {
        if (this.visible(z.x, z.y, z.r + 40)) this.drawZombie(z);
      }
      this.drawAcids();
      if (this.phase !== "gameover" && this.phase !== "downed") this.drawPlayer();
      if (this.phase === "playing" && this.bombHoldId !== -1 && this.bombs > 0) this.drawBombSight(c);
      this.drawBullets();
    }

    // particles — opaque pass
    for (const pt of this.particles) {
      if (pt.add) continue;
      if (!this.visible(pt.x, pt.y, 40)) continue;
      c.globalAlpha = clamp(pt.life / pt.max, 0, 1);
      c.fillStyle = pt.color;
      c.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    // particles — glow pass
    c.globalCompositeOperation = "lighter";
    for (const pt of this.particles) {
      if (!pt.add) continue;
      if (!this.visible(pt.x, pt.y, 40)) continue;
      c.globalAlpha = clamp(pt.life / pt.max, 0, 1) * 0.9;
      c.fillStyle = pt.color;
      c.beginPath();
      c.arc(pt.x, pt.y, pt.size, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";

    // lights
    if (this.phase === "playing" || this.phase === "paused" || this.phase === "downed") {
      this.drawLights(c);
    }

    // floaters
    for (const f of this.floaters) {
      if (!this.visible(f.x, f.y, 100)) continue;
      const a = clamp(f.life / f.max, 0, 1);
      c.globalAlpha = a;
      c.font = `700 ${f.size}px "Barlow Condensed", sans-serif`;
      c.textAlign = "center";
      c.lineWidth = 3;
      c.strokeStyle = "rgba(0,0,0,0.75)";
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.color;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;

    // fog (screen-fixed: coordinates offset back out by the camera)
    for (const f of this.fog) {
      const spr = this.fogSprites[Math.floor(f.s) % this.fogSprites.length];
      c.globalAlpha = 0.55;
      c.drawImage(spr, this.camX + f.x - 128 * f.s, this.camY + f.y - 128 * f.s, 256 * f.s, 256 * f.s);
    }
    c.globalAlpha = 1;

    c.restore(); // end world space
    c.restore(); // end shake

    c.drawImage(this.vignette, 0, 0, this.W, this.H);

    // hurt / low-hp overlay
    const p = this.player;
    let redA = 0;
    if (p.hurtT > 0) redA = Math.max(redA, (p.hurtT / 0.45) * 0.85);
    if (this.phase === "playing" && p.hp <= 30) redA = Math.max(redA, ((Math.sin(this.time * 6) + 1) / 2) * 0.3 + 0.12);
    if (this.phase === "gameover") redA = Math.max(redA, 0.4);
    if (redA > 0.01) {
      c.globalAlpha = clamp(redA, 0, 1);
      c.drawImage(this.redVig, 0, 0, this.W, this.H);
      c.globalAlpha = 1;
    }
    if (this.flashA > 0.01) {
      c.fillStyle = `rgba(255,255,240,${clamp(this.flashA, 0, 1) * 0.9})`;
      c.fillRect(0, 0, this.W, this.H);
    }

    if (this.phase === "playing" || this.phase === "paused" || this.phase === "downed") {
      this.drawHUD(c);
      if (this.touchMode && this.phase === "playing") this.drawTouchUI(c);
    }
    if (this.phase === "downed") this.drawDowned(c);
    if (this.phase === "playing" || this.phase === "downed") this.drawThreats(c);
    if (this.banner && (this.phase === "playing" || this.phase === "paused")) this.drawBanner(c);
  }

  private drawLights(c: CanvasRenderingContext2D) {
    const p = this.player;
    c.save();
    c.globalCompositeOperation = "lighter";
    // flashlight cone
    const coneLen = 330;
    const half = 0.42;
    const g = c.createRadialGradient(p.x, p.y, 10, p.x, p.y, coneLen);
    g.addColorStop(0, "rgba(255,244,205,0.16)");
    g.addColorStop(1, "rgba(255,244,205,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.arc(p.x, p.y, coneLen, p.aim - half, p.aim + half);
    c.closePath();
    c.fill();
    // muzzle flash
    if (p.muzzleT > 0) {
      const mx = p.x + Math.cos(p.aim) * 26;
      const my = p.y + Math.sin(p.aim) * 26;
      const mg = c.createRadialGradient(mx, my, 2, mx, my, 80);
      mg.addColorStop(0, "rgba(255,220,120,0.5)");
      mg.addColorStop(1, "rgba(255,180,60,0)");
      c.fillStyle = mg;
      c.beginPath();
      c.arc(mx, my, 80, 0, TAU);
      c.fill();
      c.fillStyle = "rgba(255,240,180,0.95)";
      c.save();
      c.translate(mx, my);
      c.rotate(p.aim);
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + rand(0, 0.6);
        const rr = i % 2 === 0 ? rand(8, 15) : rand(3, 5);
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath();
      c.fill();
      c.restore();
    }
    // adrenaline aura
    if (p.adreT > 0) {
      const ag = c.createRadialGradient(p.x, p.y, 4, p.x, p.y, 46);
      ag.addColorStop(0, "rgba(184,255,46,0.25)");
      ag.addColorStop(1, "rgba(184,255,46,0)");
      c.fillStyle = ag;
      c.beginPath();
      c.arc(p.x, p.y, 46, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  private drawMarks() {
    const c = this.ctx;
    for (const m of this.marks) {
      const pr = m.t / m.dur;
      const a = 0.25 + pr * 0.55 + Math.sin(this.time * 18) * 0.12;
      c.strokeStyle = `rgba(255,47,47,${clamp(a, 0, 0.9)})`;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(m.x, m.y, 20 - pr * 6, 0, TAU);
      c.stroke();
      // claw slashes
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        const off = (i - 1) * 7;
        c.moveTo(m.x + off - 4, m.y - 12 + pr * 4);
        c.quadraticCurveTo(m.x + off + 2, m.y, m.x + off - 4, m.y + 12 - pr * 4);
        c.stroke();
      }
    }
  }

  private drawPickups() {
    const c = this.ctx;
    for (const pk of this.pickups) {
      const bob = Math.sin(pk.t * 4) * 3;
      const blink = pk.life < 3 && Math.sin(pk.t * 14) > 0;
      if (blink) continue;
      const x = pk.x;
      const y = pk.y + bob;
      // glow (prerendered sprite: no per-frame gradient allocation)
      c.save();
      c.globalCompositeOperation = "lighter";
      c.drawImage(this.glowSprite(pk.type), x - GLOW_SIZE, y - GLOW_SIZE);
      c.restore();

      c.save();
      c.translate(x, y);
      c.rotate(Math.sin(pk.t * 2) * 0.12);
      c.fillStyle = "#10160c";
      c.strokeStyle = "#3a4a2c";
      c.lineWidth = 1.5;
      c.fillRect(-11, -11, 22, 22);
      c.strokeRect(-11, -11, 22, 22);
      if (pk.type === "med") {
        c.fillStyle = "#7dffa8";
        c.fillRect(-2.5, -7, 5, 14);
        c.fillRect(-7, -2.5, 14, 5);
      } else if (pk.type === "ammo") {
        c.fillStyle = "#ffb020";
        for (let i = -1; i <= 1; i++) {
          c.fillRect(i * 5 - 1.5, -7, 3, 11);
          c.beginPath();
          c.arc(i * 5, -7, 1.5, Math.PI, 0);
          c.fill();
        }
      } else if (pk.type === "weapon") {
        c.fillStyle = "#9dff20";
        c.fillRect(-8, -2, 14, 4);
        c.fillRect(-8, 2, 3, 5);
        c.fillRect(2, -5, 3, 3);
      } else if (pk.type === "adre") {
        c.fillStyle = "#b8ff2e";
        c.beginPath();
        c.moveTo(2, -8);
        c.lineTo(-4, 1);
        c.lineTo(-1, 1);
        c.lineTo(-2, 8);
        c.lineTo(4, -1);
        c.lineTo(1, -1);
        c.closePath();
        c.fill();
      } else {
        c.strokeStyle = "#ff2f2f";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(0, 0, 6.5, 0, TAU);
        c.stroke();
        c.fillStyle = "#ff2f2f";
        c.beginPath();
        c.arc(0, 0, 2.4, 0, TAU);
        c.fill();
      }
      c.restore();
    }
  }

  private drawZombie(z: Zombie) {
    const dx = this.player.x - z.x;
    const dy = this.player.y - z.y;
    const len = Math.hypot(dx, dy) || 1;
    this.drawZombieBody(z.type, z.x, z.y, dx / len, dy / len, z.wob, z.r, z.flash, 1, 1);
    // hp bar
    if (z.hp < z.maxHp) {
      const c = this.ctx;
      const w = z.r * 2;
      c.fillStyle = "rgba(0,0,0,0.6)";
      c.fillRect(z.x - w / 2, z.y - z.r - 10, w, 4);
      c.fillStyle = z.hp / z.maxHp > 0.4 ? "#9dff20" : "#ff2f2f";
      c.fillRect(z.x - w / 2, z.y - z.r - 10, w * clamp(z.hp / z.maxHp, 0, 1), 4);
    }
  }

  private drawZombieBody(
    type: ZType, x: number, y: number, fx: number, fy: number,
    wob: number, r: number, flash: number, alpha: number, dim: number,
  ) {
    const c = this.ctx;
    const d = ZDEFS[type];
    c.save();
    c.globalAlpha = alpha;
    // shadow
    c.fillStyle = "rgba(0,0,0,0.4)";
    c.beginPath();
    c.ellipse(x, y + r * 0.55, r * 1.05, r * 0.5, 0, 0, TAU);
    c.fill();

    // exploder warning glow
    if (type === "exploder") {
      c.save();
      c.globalCompositeOperation = "lighter";
      const pu = (Math.sin(this.time * 9 + wob) + 1) / 2;
      const g = c.createRadialGradient(x, y, 2, x, y, r * 2.1);
      g.addColorStop(0, `rgba(255,120,40,${0.16 + pu * 0.16})`);
      g.addColorStop(1, "rgba(255,120,40,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r * 2.1, 0, TAU);
      c.fill();
      c.restore();
    }

    // arms
    const sway = Math.sin(wob) * 3;
    const px = -fy;
    const py = fx;
    for (const s of [-1, 1]) {
      const ax = x + fx * r * 0.9 + px * s * r * 0.72 + fx * sway * s;
      const ay = y + fy * r * 0.9 + py * s * r * 0.72 + fy * sway * s;
      
      c.save();
      c.translate(ax, ay);
      c.rotate(Math.atan2(fy, fx) + s * 0.3 + sway * 0.1);
      c.fillStyle = d.dark;
      c.beginPath();
      c.ellipse(0, 0, r * 0.5, r * 0.25, 0, 0, TAU);
      c.fill();
      // bloody hands
      c.fillStyle = "#501010";
      c.beginPath();
      c.arc(r * 0.4, 0, r * 0.2, 0, TAU);
      c.fill();
      c.restore();
    }
    // body
    c.fillStyle = d.body;
    c.strokeStyle = d.dark;
    c.lineWidth = 2.5;
    c.save();
    c.translate(x, y);
    c.rotate(Math.atan2(fy, fx));
    c.beginPath();
    if (type === "runner") {
      c.ellipse(0, 0, r * 1.12, r * 0.82, 0, 0, TAU);
    } else if (type === "brute") {
      c.ellipse(0, 0, r * 1.1, r * 1.3, 0, 0, TAU);
    } else {
      c.ellipse(0, 0, r * 1.0, r * 1.15, 0, 0, TAU);
    }
    c.fill();
    c.stroke();
    c.restore();
    // brute armor plates
    if (type === "brute") {
      c.strokeStyle = "#22301466";
      c.lineWidth = 5;
      c.beginPath();
      c.arc(x, y, r * 0.66, 0, TAU);
      c.stroke();
      c.fillStyle = "#2b3c1a";
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5;
        c.beginPath();
        c.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, 4.5, 0, TAU);
        c.fill();
      }
    }
    // spitter acid sac
    if (type === "spitter") {
      const pu = (Math.sin(this.time * 6 + wob) + 1) / 2;
      c.fillStyle = `rgba(184,255,46,${0.5 + pu * 0.3})`;
      c.beginPath();
      c.arc(x - fx * r * 0.35, y - fy * r * 0.35, r * 0.42 + pu * 1.6, 0, TAU);
      c.fill();
    }
    // head
    c.save();
    c.translate(x + fx * r * 0.22, y + fy * r * 0.22);
    c.rotate(Math.atan2(fy, fx));
    c.fillStyle = d.body;
    c.beginPath();
    c.arc(0, 0, r * 0.52, 0, TAU);
    c.fill();
    c.strokeStyle = d.dark;
    c.lineWidth = 1.6;
    c.stroke();
    c.restore();
    // eyes
    c.save();
    c.globalCompositeOperation = "lighter";
    c.fillStyle = d.eye;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.arc(
        x + fx * r * 0.5 + px * s * r * 0.2,
        y + fy * r * 0.5 + py * s * r * 0.2,
        Math.max(1.6, r * 0.11), 0, TAU,
      );
      c.fill();
    }
    c.restore();
    // hit flash
    if (flash > 0) {
      c.globalAlpha = clamp(flash / 0.11, 0, 1) * 0.85 * alpha;
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(x, y, r * 1.05, 0, TAU);
      c.fill();
    }
    c.restore();
    void dim;
  }

  private drawAcids() {
    const c = this.ctx;
    for (const a of this.acids) {
      const h = Math.sin(Math.min(a.p, 1) * Math.PI) * 46;
      // shadow
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.beginPath();
      c.ellipse(a.x, a.y + 4, 7, 3.5, 0, 0, TAU);
      c.fill();
      c.fillStyle = "#b8ff2e";
      c.strokeStyle = "#5f8f12";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(a.x, a.y - h, 7 + h * 0.04, 0, TAU);
      c.fill();
      c.stroke();
      c.fillStyle = "rgba(255,255,255,0.5)";
      c.beginPath();
      c.arc(a.x - 2, a.y - h - 2, 2, 0, TAU);
      c.fill();
    }
  }

  private drawPlayer() {
    const c = this.ctx;
    const p = this.player;
    if (p.invulnT > 0 && p.dashT <= 0 && Math.sin(this.time * 40) > 0.2) c.globalAlpha = 0.55;

    // shadow
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath();
    c.ellipse(p.x, p.y + 9, 15, 7, 0, 0, TAU);
    c.fill();

    const bob = Math.sin(p.walk) * 1.4;
    const bx = p.x;
    const by = p.y + bob * 0.4;

    c.save();
    c.translate(bx, by);
    c.rotate(p.aim);
    
    // shoulders/body
    c.fillStyle = "#cfe3a4";
    c.strokeStyle = "#5c6b3e";
    c.lineWidth = 2.5;
    c.beginPath();
    // wider shoulder profile instead of perfect circle
    c.ellipse(0, 0, 11, 14, 0, 0, TAU);
    c.fill();
    c.stroke();
    
    // arms / sleeves
    c.fillStyle = "#cfe3a4";
    c.beginPath();
    c.arc(6, -11, 5, 0, TAU); // right arm reaching
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(12, 10, 5, 0, TAU); // left arm gripping barrel
    c.fill();
    c.stroke();

    // gun
    c.fillStyle = "#20262c";
    c.strokeStyle = "#0c0f12";
    c.lineWidth = 1.5;
    const w = this.weapons[this.wIdx];
    const glen = w.def.id === "pistol" ? 18 : w.def.id === "smg" ? 24 : w.def.id === "shotgun" ? 27 : 30;
    // draw gun body
    c.fillRect(8, -2.6, glen, 5.2);
    c.strokeRect(8, -2.6, glen, 5.2);
    c.fillStyle = "#39424c";
    c.fillRect(8 + glen - 3, -1.6, 5, 3.2); // barrel tip

    // hands
    c.fillStyle = "#e6d3ac";
    c.beginPath();
    c.arc(10, -3, 3, 0, TAU); // right hand on trigger
    c.fill();
    c.beginPath();
    c.arc(14, 3, 3, 0, TAU); // left hand on barrel
    c.fill();
    
    c.restore();

    // head + helmet
    c.save();
    c.translate(bx + Math.cos(p.aim) * 2.5, by + Math.sin(p.aim) * 2.5 + bob * 0.2 - 1);
    c.rotate(p.aim);
    c.fillStyle = "#e6d3ac"; // skin
    c.beginPath();
    c.arc(0, 0, 6.4, 0, TAU);
    c.fill();
    // helmet
    c.fillStyle = "#3a4a2c";
    c.beginPath();
    c.arc(-1, 0, 6.2, Math.PI * -0.45, Math.PI * 0.45, true); 
    c.fill();
    c.restore();

    c.globalAlpha = 1;
  }

  private drawBullets() {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    for (const b of this.bullets) {
      c.strokeStyle = b.tracer;
      c.globalAlpha = 0.9;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
      c.lineTo(b.x, b.y);
      c.stroke();
      c.globalAlpha = 0.35;
      c.lineWidth = 6;
      c.stroke();
    }
    c.restore();
  }

  private drawBanner(c: CanvasRenderingContext2D) {
    const b = this.banner!;
    const p = b.t / b.dur;
    let a = 1;
    if (p < 0.12) a = p / 0.12;
    else if (p > 0.78) a = 1 - (p - 0.78) / 0.22;
    const scale = 1 + Math.max(0, 0.25 - p * 2.2);
    c.save();
    c.translate(this.W / 2, this.H * 0.3);
    c.rotate(-0.028);
    c.scale(scale, scale);
    c.globalAlpha = clamp(a, 0, 1);
    c.textAlign = "center";
    c.font = `56px "Creepster", cursive`;
    c.lineWidth = 9;
    c.lineJoin = "round";
    c.strokeStyle = "rgba(10,4,2,0.9)";
    c.strokeText(b.text, 0, 0);
    c.fillStyle = b.color;
    c.fillText(b.text, 0, 0);
    if (b.sub) {
      c.font = `700 19px "Barlow Condensed", sans-serif`;
      c.lineWidth = 5;
      c.strokeText(b.sub, 0, 32);
      c.fillStyle = "#e8e2cf";
      c.fillText(b.sub, 0, 32);
    }
    c.restore();
  }

  /* Hold-to-throw aid: dashed flight line + landing reticle (matches updateBombs' linear path). */
  private drawBombSight(c: CanvasRenderingContext2D) {
    const p = this.player;
    const dx = Math.cos(p.aim);
    const dy = Math.sin(p.aim);
    const travel = BOMB_SPEED * BOMB_FUSE;
    const lx = clamp(p.x + dx * (20 + travel), 14, this.worldW - 14);
    const ly = clamp(p.y + dy * (20 + travel), 14, this.worldH - 14);
    c.save();
    c.strokeStyle = "rgba(255,138,92,0.7)";
    c.lineWidth = 2;
    c.setLineDash([10, 8]);
    c.beginPath();
    c.moveTo(p.x + dx * 20, p.y + dy * 20);
    c.lineTo(lx, ly);
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = "rgba(255,138,92,0.9)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(lx, ly, 12, 0, TAU);
    c.stroke();
    c.strokeStyle = "rgba(255,92,42,0.35)";
    c.setLineDash([7, 7]);
    c.beginPath();
    c.arc(lx, ly, BOMB_RADIUS, 0, TAU);
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  /* Off-screen threat arrows: one pass into 16 preallocated buckets, ≤8 arrows drawn. */
  private drawThreats(c: CanvasRenderingContext2D) {
    const zs = this.zombies;
    if (zs.length === 0) return;
    const w = this.threatW;
    const k = this.threatK;
    const hit = this.threatHit;
    w.fill(0);
    k.fill(0);
    hit.fill(0);

    const p = this.player;
    const px = p.x - this.camX;
    const py = p.y - this.camY;
    const reach = Math.max(this.W, this.H);
    let any = false;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.dead) continue;
      const sx = z.x - this.camX;
      const sy = z.y - this.camY;
      if (sx > -6 && sx < this.W + 6 && sy > -6 && sy < this.H + 6) continue;
      const dx = sx - px;
      const dy = sy - py;
      const d = Math.hypot(dx, dy);
      if (d > reach) continue;
      let s = Math.floor(((Math.atan2(dy, dx) + Math.PI) / TAU) * THREAT_SECTORS);
      if (s < 0) s = 0;
      else if (s >= THREAT_SECTORS) s = THREAT_SECTORS - 1;
      w[s] += 1 + (1 - d / reach);
      // class 1 normal / 2 spitter / 3 exploder / 4 brute-alpha, ranked by THREAT_PRIO
      const cls = z.type === "exploder" ? 3 : z.type === "spitter" ? 2 : (z.type === "brute" || z.type === "alpha") ? 4 : 1;
      if (k[s] === 0 || THREAT_PRIO[cls] > THREAT_PRIO[k[s]]) k[s] = cls;
      hit[s] = 1;
      any = true;
    }
    if (!any) return;

    // band inset clear of vitals, wave banner, weapon slots and the touch cluster
    const padL = 150 + this.safeL;
    const padT = 140 + this.safeT;
    const padR = (this.touchMode ? 190 : 64) + this.safeR;
    const padB = (this.touchMode ? 170 : 140) + this.safeB;
    const right = this.W - padR;
    const bottom = this.H - padB;
    if (right <= padL + 24 || bottom <= padT + 24) return; // screen too small for a safe band

    for (let n = 0; n < THREAT_MAX; n++) {
      let best = -1;
      let bw = 1e-6;
      for (let s = 0; s < THREAT_SECTORS; s++) {
        if (hit[s] !== 1 || w[s] <= bw) continue;
        bw = w[s];
        best = s;
      }
      if (best < 0) break;
      hit[best] = 2; // consumed

      const ang = ((best + 0.5) / THREAT_SECTORS) * TAU - Math.PI;
      const dirX = Math.cos(ang);
      const dirY = Math.sin(ang);
      let t = Infinity;
      if (dirX > 1e-6) t = Math.min(t, (right - px) / dirX);
      else if (dirX < -1e-6) t = Math.min(t, (padL - px) / dirX);
      if (dirY > 1e-6) t = Math.min(t, (bottom - py) / dirY);
      else if (dirY < -1e-6) t = Math.min(t, (padT - py) / dirY);
      if (!isFinite(t) || t < 0) t = 0;
      const ax = clamp(px + dirX * t, padL, right);
      const ay = clamp(py + dirY * t, padT, bottom);

      const cls = k[best];
      const size = cls === 4 ? 12 : cls === 3 ? 11 : 9;
      c.save();
      c.translate(ax, ay);
      c.rotate(ang);
      c.globalAlpha = 0.92;
      c.fillStyle = cls === 2 ? "#7dff3a" : cls === 3 ? "#ff9a1f" : "#ff4d3d";
      c.beginPath();
      c.moveTo(size, 0);
      c.lineTo(-size * 0.6, size * 0.75);
      c.lineTo(-size * 0.6, -size * 0.75);
      c.closePath();
      c.fill();
      c.restore();
    }
  }

  /* Endless death: the yard keeps running behind this (loop keeps calling update()). */
  private drawDowned(c: CanvasRenderingContext2D) {
    const t = Math.max(0, this.respawnT);
    const n = Math.max(1, Math.ceil(t));
    const sz = Math.round(Math.min(this.W, this.H) * 0.32);
    const cx = this.W / 2;
    const cy = this.H * 0.46;

    c.save();
    c.fillStyle = "rgba(8,4,4,0.55)";
    c.fillRect(0, 0, this.W, this.H);
    c.textAlign = "center";
    c.textBaseline = "middle";

    c.font = `700 15px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#ff6b5e";
    c.fillText("YOU WENT DOWN", cx, cy - sz * 0.72);

    const pulse = 1 + (t - Math.floor(t)) * 0.12; // pops once per second tick
    c.save();
    c.translate(cx, cy);
    c.scale(pulse, pulse);
    c.font = `${sz}px "Creepster", cursive`;
    c.lineWidth = 10;
    c.lineJoin = "round";
    c.strokeStyle = "rgba(10,4,2,0.9)";
    c.strokeText(`${n}`, 0, 0);
    c.fillStyle = "#ffb020";
    c.fillText(`${n}`, 0, 0);
    c.restore();

    c.font = `700 16px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#e8e2cf";
    c.fillText("REBOOTING — STAND BY", cx, cy + sz * 0.58);
    c.font = `700 12px "Barlow Condensed", sans-serif`;
    c.fillStyle = "rgba(168,189,138,0.75)";
    c.fillText(`DEATHS ${this.deaths}   KILLS ${this.kills}   WAVE ${this.wave}`, cx, cy + sz * 0.58 + 26);
    c.restore();
  }

  private drawTouchUI(c: CanvasRenderingContext2D) {
    // static hints while fingers are off the sticks
    c.save();
    c.textAlign = "center";
    c.font = `700 13px "Barlow Condensed", sans-serif`;
    if (!this.moveStick.on) {
      c.strokeStyle = "rgba(157,255,32,0.22)";
      c.fillStyle = "rgba(157,255,32,0.35)";
      c.lineWidth = 2;
      c.setLineDash([7, 7]);
      c.beginPath();
      c.arc(96 + this.safeL, this.H - 110 - this.safeB, 50, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      c.fillText("MOVE", 96 + this.safeL, this.H - 105 - this.safeB);
    }
    if (!this.aimStick.on) {
      c.strokeStyle = "rgba(255,176,32,0.22)";
      c.fillStyle = "rgba(255,176,32,0.4)";
      c.setLineDash([7, 7]);
      c.beginPath();
      c.arc(this.W - 170 - this.safeR, this.H - 110 - this.safeB, 50, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      c.fillText("AIM + FIRE", this.W - 170 - this.safeR, this.H - 105 - this.safeB);
    }
    c.restore();

    const stick = (s: { bx: number; by: number; dx: number; dy: number; on: boolean }, hint: string) => {
      const x = s.on ? s.bx : 0;
      const y = s.on ? s.by : 0;
      if (!s.on) return;
      c.strokeStyle = "rgba(157,255,32,0.35)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, 52, 0, TAU);
      c.stroke();
      c.fillStyle = "rgba(157,255,32,0.22)";
      c.beginPath();
      c.arc(x + s.dx * 52, y + s.dy * 52, 22, 0, TAU);
      c.fill();
      c.strokeStyle = "rgba(157,255,32,0.7)";
      c.stroke();
      void hint;
    };
    stick(this.moveStick, "MOVE");
    stick(this.aimStick, "AIM+FIRE");

    const pl = this.player;
    for (const b of this.touchButtons()) {
      if (b.id === "dash") {
        const ready = pl.dashCd <= 0;
        c.fillStyle = ready ? "rgba(157,255,32,0.2)" : "rgba(157,255,32,0.07)";
        c.strokeStyle = ready ? "rgba(157,255,32,0.8)" : "rgba(157,255,32,0.25)";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(b.x, b.y, b.r, 0, TAU);
        c.fill();
        c.stroke();
        if (!ready) {
          c.beginPath();
          c.moveTo(b.x, b.y);
          c.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + (1 - pl.dashCd / 1.8) * TAU);
          c.closePath();
          c.fillStyle = "rgba(157,255,32,0.15)";
          c.fill();
        }
        c.fillStyle = ready ? "#9dff20" : "rgba(157,255,32,0.4)";
        c.font = `700 14px "Barlow Condensed", sans-serif`;
        c.textAlign = "center";
        c.fillText("DASH", b.x, b.y + 5);
        continue;
      }

      const isBomb = b.id === "bomb";
      const ready = this.bombs > 0 && this.bombCd <= 0;
      const dry = isBomb && this.bombs === 0;
      c.fillStyle = isBomb
        ? ready ? "rgba(255,92,42,0.18)" : "rgba(255,92,42,0.06)"
        : "rgba(255,176,32,0.14)";
      c.strokeStyle = isBomb
        ? ready ? "rgba(255,92,42,0.85)" : "rgba(255,92,42,0.25)"
        : "rgba(255,176,32,0.7)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(b.x, b.y, b.r, 0, TAU);
      c.fill();
      c.stroke();
      c.textAlign = "center";
      if (dry && this.bombRechargeT > 0) {
        // dry: recharge ring + exact seconds until the next bomb
        c.beginPath();
        c.moveTo(b.x, b.y);
        c.arc(b.x, b.y, b.r - 3, -Math.PI / 2, -Math.PI / 2 + (1 - this.bombRechargeT / BOMB_RECHARGE) * TAU);
        c.closePath();
        c.fillStyle = "rgba(255,92,42,0.3)";
        c.fill();
        c.font = `800 15px "Barlow Condensed", sans-serif`;
        c.fillStyle = "#ff8a5c";
        c.fillText(`${Math.ceil(this.bombRechargeT)}`, b.x, b.y - 1);
        c.font = `700 9px "Barlow Condensed", sans-serif`;
        c.fillStyle = "rgba(255,138,92,0.85)";
        c.fillText("RECHG", b.x, b.y + 11);
      } else if (isBomb) {
        if (this.bombCd > 0) {
          c.beginPath();
          c.moveTo(b.x, b.y);
          c.arc(b.x, b.y, b.r - 3, -Math.PI / 2, -Math.PI / 2 + (1 - this.bombCd / 0.6) * TAU);
          c.closePath();
          c.fillStyle = "rgba(255,92,42,0.22)";
          c.fill();
        }
        c.fillStyle = ready ? "#ff8a5c" : "rgba(255,138,92,0.45)";
        c.font = `800 17px "Barlow Condensed", sans-serif`;
        c.fillText(`${this.bombs}`, b.x, b.y + 1);
        c.font = `700 10px "Barlow Condensed", sans-serif`;
        c.fillText("BOMB", b.x, b.y + 13);
      } else {
        c.fillStyle = "#ffb020";
        c.font = `700 12px "Barlow Condensed", sans-serif`;
        c.fillText("SWAP", b.x, b.y + 4);
      }
    }
  }

  private drawHUD(c: CanvasRenderingContext2D) {
    const p = this.player;
    const w = this.weapons[this.wIdx];

    /* --- top-left: vitals --- */
    const bx = 14 + this.safeL;
    const by = 14 + this.safeT;
    const bw = Math.min(250, this.W * 0.3);
    c.font = `700 12px "Barlow Condensed", sans-serif`;
    c.textAlign = "left";
    c.fillStyle = "#7d9457";
    c.fillText("VITALS", bx + 2, by - 4);
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillRect(bx, by, bw, 16);
    const pct = clamp(p.hp / p.maxHp, 0, 1);
    const hcol = pct > 0.5 ? "#9dff20" : pct > 0.25 ? "#ffb020" : "#ff2f2f";
    c.fillStyle = hcol;
    c.fillRect(bx + 2, by + 2, (bw - 4) * pct, 12);
    c.strokeStyle = "rgba(232,226,207,0.35)";
    c.lineWidth = 1;
    c.strokeRect(bx + 0.5, by + 0.5, bw - 1, 15);
    for (let i = 1; i < 4; i++) {
      c.beginPath();
      c.moveTo(bx + (bw / 4) * i, by + 2);
      c.lineTo(bx + (bw / 4) * i, by + 14);
      c.strokeStyle = "rgba(0,0,0,0.4)";
      c.stroke();
    }
    c.fillStyle = "#e8e2cf";
    c.font = `800 13px "Barlow Condensed", sans-serif`;
    c.fillText(`${Math.ceil(p.hp)}`, bx + bw + 8, by + 13);

    // dash meter
    const dy = by + 24;
    c.fillStyle = "#7d9457";
    c.font = `700 11px "Barlow Condensed", sans-serif`;
    c.fillText("DASH", bx + 2, dy + 9);
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillRect(bx + 42, dy + 2, 90, 7);
    const dp = 1 - clamp(p.dashCd / 1.8, 0, 1);
    c.fillStyle = dp >= 1 ? "#b8ff2e" : "#5c9c12";
    c.fillRect(bx + 43, dy + 3, 88 * dp, 5);

    // adrenaline
    if (p.adreT > 0) {
      const ay = dy + 15;
      const pu = 0.7 + Math.sin(this.time * 10) * 0.3;
      c.fillStyle = `rgba(184,255,46,${pu})`;
      c.font = `700 11px "Barlow Condensed", sans-serif`;
      c.fillText(`ADRENALINE ${p.adreT.toFixed(1)}s`, bx + 2, ay + 10);
      c.fillStyle = "rgba(0,0,0,0.5)";
      c.fillRect(bx + 100, ay + 3, 60, 7);
      c.fillStyle = "#b8ff2e";
      c.fillRect(bx + 101, ay + 4, 58 * (p.adreT / 8), 5);
    }

    // bomb stock (right of the dash meter)
    for (let i = 0; i < BOMB_MAX; i++) {
      const on = i < this.bombs;
      c.fillStyle = on ? "#ff5c2a" : "rgba(255,92,42,0.15)";
      c.fillRect(bx + 142 + i * 14, dy + 3, 10, 9);
      c.fillStyle = on ? "#ffb020" : "rgba(255,176,32,0.2)";
      c.fillRect(bx + 144 + i * 14, dy + 1, 6, 2);
      c.strokeStyle = on ? "#ff8a5c" : "rgba(255,92,42,0.3)";
      c.lineWidth = 1;
      c.strokeRect(bx + 142.5 + i * 14, dy + 3.5, 9, 8);
    }
    // recharge progress fills the next empty pip while the stock is dry (both input modes)
    if (this.bombs === 0 && this.bombRechargeT > 0) {
      const rp = 1 - this.bombRechargeT / BOMB_RECHARGE;
      c.fillStyle = "rgba(255,92,42,0.55)";
      c.fillRect(bx + 143, dy + 4, 8 * rp, 7);
    }

    /* --- top-center: wave --- */
    c.textAlign = "center";
    const cx = this.W / 2;
    const small = this.W < 640;
    const wcy = small ? 96 : 44;
    const left = this.zombies.length + this.spawnQueue.length + this.marks.length;
    c.font = `${small ? 26 : 34}px "Creepster", cursive`;
    c.lineWidth = 6;
    c.strokeStyle = "rgba(10,4,2,0.85)";
    c.strokeText(`WAVE ${this.wave}`, cx, wcy);
    c.fillStyle = "#ff2f2f";
    c.fillText(`WAVE ${this.wave}`, cx, wcy);
    c.font = `700 14px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#e8e2cf";
    c.fillText(left > 0 ? `HOSTILES REMAINING — ${left}` : "AREA SECURE — REGROUP", cx, wcy + 20);
    c.font = `700 11px "Barlow Condensed", sans-serif`;
    c.fillStyle = "rgba(168,189,138,0.65)";
    c.fillText(
      `${MODE_LABEL[this.mode]} / ${DIFF_LABEL[this.difficulty]}${this.mode === "endless" ? ` / DEATHS ${this.deaths}` : ""}`,
      cx,
      wcy + 36,
    );

    /* --- top-right: score (leave room for DOM buttons) --- */
    const rx = this.W - 128 - this.safeR;
    c.textAlign = "right";
    c.font = `700 12px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#7d9457";
    c.fillText("SCORE", rx, 26);
    c.font = `800 30px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#ffb020";
    c.fillText(`${this.score}`, rx, 52);
    const mult = this.comboMult();
    if (mult > 1 && this.comboT > 0) {
      const pu = 1 + Math.sin(this.time * 14) * 0.08;
      c.font = `800 ${Math.round(19 * pu)}px "Barlow Condensed", sans-serif`;
      c.fillStyle = "#9dff20";
      c.fillText(`CHAIN x${mult}`, rx, 74);
      c.fillStyle = "rgba(0,0,0,0.5)";
      c.fillRect(rx - 80, 80, 80, 4);
      c.fillStyle = "#9dff20";
      c.fillRect(rx - 80, 80, 80 * clamp(this.comboT / 2.5, 0, 1), 4);
    }
    c.font = `700 13px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#a8bd8a";
    c.fillText(`KILLS ${this.kills}`, rx, mult > 1 && this.comboT > 0 ? 100 : 74);

    /* --- bottom-left: weapon --- */
    const wx = 18 + this.safeL;
    const wy = this.H - 74 - this.safeB;
    c.textAlign = "left";
    c.font = `700 13px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#9dff20";
    const nameW = c.measureText(w.def.name).width;
    c.fillText(w.def.name, wx, wy);
    c.font = `700 11px "Barlow Condensed", sans-serif`;
    c.fillStyle = ROLE_COLOR[w.def.role];
    c.fillText(` // ${ROLE_LABEL[w.def.role]}`, wx + nameW + 4, wy);
    c.font = `800 34px "Barlow Condensed", sans-serif`;
    c.fillStyle = w.mag === 0 ? "#ff2f2f" : "#e8e2cf";
    const resTxt = w.reserve < 0 ? "∞" : `${w.reserve}`;
    c.fillText(`${w.mag}`, wx, wy + 32);
    c.font = `700 18px "Barlow Condensed", sans-serif`;
    c.fillStyle = "#7d9457";
    const mw = c.measureText(`${w.mag}`).width;
    c.fillText(`/ ${resTxt}`, wx + mw + 8 + (w.mag >= 10 ? 20 : 10), wy + 32);

    // reload bar
    if (p.reloadT > 0) {
      const rw = 150;
      const rp = 1 - p.reloadT / w.def.reload;
      c.fillStyle = "rgba(0,0,0,0.6)";
      c.fillRect(wx, wy + 42, rw, 8);
      c.fillStyle = "#ffb020";
      c.fillRect(wx + 1, wy + 43, (rw - 2) * rp, 6);
      c.font = `700 12px "Barlow Condensed", sans-serif`;
      c.fillStyle = "#ffb020";
      c.fillText("RELOADING", wx + rw + 8, wy + 50);
    } else if (w.mag === 0) {
      c.font = `700 13px "Barlow Condensed", sans-serif`;
      c.fillStyle = "#ff2f2f";
      c.fillText("OUT OF AMMO — FIND A CACHE", wx, wy + 50);
    } else {
      c.font = `700 12px "Barlow Condensed", sans-serif`;
      c.fillStyle = "rgba(168,189,138,0.7)";
      c.fillText(
        this.touchMode
          ? "AUTO-RELOAD"
          : `AUTO-RELOAD  /  G - BOMB${this.bombs === 0 && this.bombRechargeT > 0 ? `  •  BOMB ${Math.ceil(this.bombRechargeT)}s` : ""}`,
        wx,
        wy + 50,
      );
    }

    // weapon slots (geometry shared with the touch hit-test)
    for (let i = 0; i < WEAPONS.length; i++) {
      const def = WEAPONS[i];
      const owned = this.weapons.some((ow) => ow.def === def);
      const active = w.def === def;
      const slot = this.slotRect(i);
      const sx = slot.x;
      const slotY = slot.y;
      c.fillStyle = active ? "rgba(157,255,32,0.16)" : owned ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)";
      c.fillRect(sx, slotY, 34, 24);
      c.strokeStyle = active ? "#9dff20" : owned ? "rgba(232,226,207,0.35)" : "rgba(232,226,207,0.12)";
      c.lineWidth = active ? 1.6 : 1;
      c.strokeRect(sx + 0.5, slotY + 0.5, 33, 23);
      // role marker: cyan = dedicated long range, amber = dedicated short range
      c.fillStyle = ROLE_COLOR[def.role];
      c.globalAlpha = owned ? 0.9 : 0.3;
      c.fillRect(sx + 2, slotY + 20, 30, 2);
      c.globalAlpha = 1;
      c.font = `700 11px "Barlow Condensed", sans-serif`;
      c.fillStyle = active ? "#9dff20" : owned ? "#a8bd8a" : "rgba(168,189,138,0.3)";
      c.fillText(`${i + 1} ${owned ? WEAPONS[i].short : "——"}`, sx + 4, slotY + 16);
    }

    /* --- bottom-right: survival time --- */
    if (!this.touchMode) {
      const t = Math.floor(this.runTime);
      const mm = Math.floor(t / 60);
      const ss = `${t % 60}`.padStart(2, "0");
      c.textAlign = "right";
      c.font = `700 13px "Barlow Condensed", sans-serif`;
      c.fillStyle = "rgba(168,189,138,0.75)";
      c.fillText(`SURVIVED ${mm}:${ss}  •  SHIFT — DASH  •  P — PAUSE`, this.W - 18 - this.safeR, this.H - 16 - this.safeB);
    }
  }
}

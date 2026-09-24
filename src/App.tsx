import { useCallback, useEffect, useRef, useState } from "react";
import { Game, type Difficulty, type EndlessSave, type Mode, type Phase, type RunStats } from "./game/engine";

interface HS {
  name: string;
  score: number;
  wave: number;
  kills: number;
  t: number;
}

const HS_KEY = "gs-highscores";

function loadHS(): HS[] {
  try {
    const raw = localStorage.getItem(HS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as HS[];
    return Array.isArray(arr) ? arr.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveHS(list: HS[]) {
  try {
    localStorage.setItem(HS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* noop */
  }
}

const fmtTime = (s: number) => {
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${`${t % 60}`.padStart(2, "0")}`;
};

/* ---------- fullscreen (Fullscreen API + vendor fallbacks) ---------- */
type FSDoc = Document & {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};
type FSEl = HTMLElement & {
  webkitRequestFullscreen?: (opts?: unknown) => Promise<void> | void;
  msRequestFullscreen?: (opts?: unknown) => Promise<void> | void;
};

const fsActive = (): boolean => {
  const d = document as FSDoc;
  return !!(document.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement);
};

const fsSupported = (): boolean => {
  const el = document.documentElement as FSEl;
  return !!(
    document.fullscreenEnabled ||
    typeof el.requestFullscreen === "function" ||
    typeof el.webkitRequestFullscreen === "function" ||
    typeof el.msRequestFullscreen === "function"
  );
};

const enterFs = (): void => {
  const el = document.documentElement as FSEl;
  try {
    const req = (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen) as
      | ((this: Element, opts?: FullscreenOptions) => Promise<void>)
      | undefined;
    if (!req) return;
    req.call(el, { navigationUI: "hide" }).catch(() => {});
    // best-effort: Android Chrome allows an orientation lock only inside fullscreen
    const o = screen.orientation as unknown as { lock?: (or: string) => Promise<void> };
    const op = o.lock?.("landscape");
    op?.catch(() => {});
  } catch {
    /* unsupported here (iOS Safari has no element-fullscreen) — Add to Home Screen is the fallback */
  }
};

const exitFs = (): void => {
  try {
    const d = document as FSDoc;
    const exit = (document.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen) as
      | (() => Promise<void>)
      | undefined;
    exit?.call(document)?.catch(() => {});
  } catch {
    /* noop */
  }
};

const isStandalone = (): boolean => {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* noop */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
};

/* ---------- personal records (per mode / difficulty) ---------- */
interface Rec {
  kills: number;
  time: number;
  score: number;
  wave: number;
  runs: number;
  deaths: number;
}

type RecMap = Record<string, Rec>;

const REC_KEY = "gs-records";

const recKey = (mode: Mode, difficulty: Difficulty) =>
  mode === "endless" ? "endless" : `survival:${difficulty}`;

const emptyRec = (): Rec => ({ kills: 0, time: 0, score: 0, wave: 0, runs: 0, deaths: 0 });

function loadRecs(): RecMap {
  try {
    const raw = localStorage.getItem(REC_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as RecMap;
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveRecs(map: RecMap) {
  try {
    localStorage.setItem(REC_KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

/* ---------- endless save & resume ---------- */
const SAVE_KEY = "gs-endless-save";

function loadSave(): EndlessSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as EndlessSave;
    if (!s || s.v !== 1 || s.mode !== "endless") return null;
    if (typeof s.score !== "number" || typeof s.wave !== "number" || s.wave < 1) return null;
    if (!Array.isArray(s.weapons)) return null;
    return s;
  } catch {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* noop */
  }
}

/* Written once per finished run — never per frame. */
function mergeRun(map: RecMap, s: RunStats): RecMap {
  const k = recKey(s.mode, s.difficulty);
  const prev = map[k] ?? emptyRec();
  return {
    ...map,
    [k]: {
      kills: Math.max(prev.kills, s.kills),
      time: Math.max(prev.time, s.time),
      score: Math.max(prev.score, s.score),
      wave: Math.max(prev.wave, s.wave),
      runs: prev.runs + 1,
      deaths: prev.deaths + s.deaths,
    },
  };
}

/* ---------- mode selection card ---------- */
function ModeCard({
  title,
  sub,
  active,
  onPick,
  best,
}: {
  title: string;
  sub: string;
  active: boolean;
  onPick: () => void;
  best?: Rec;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="panel w-full p-4 text-left"
      style={active ? { borderColor: "#9dff20", background: "rgba(157,255,32,0.07)" } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="stencil-tag" style={{ color: active ? "#9dff20" : "#a8bd8a" }}>
          {title}
        </span>
        <span
          className="text-[10px] font-bold tracking-[0.2em]"
          style={{ color: active ? "#9dff20" : "rgba(168,189,138,0.5)" }}
        >
          {active ? "SELECTED" : "TAP"}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-snug tracking-wide text-[#a8bd8a]">{sub}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-semibold tracking-[0.14em] text-[#e8e2cf]/85 tabular-nums">
        <span>BEST KILLS {best?.kills ?? 0}</span>
        <span>BEST TIME {fmtTime(best?.time ?? 0)}</span>
        <span>RUNS {best?.runs ?? 0}</span>
      </div>
    </button>
  );
}

/* ---------- tiny inline icons ---------- */
const IconPause = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="3" y="2" width="4" height="12" />
    <rect x="9" y="2" width="4" height="12" />
  </svg>
);
const IconSound = ({ muted }: { muted: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
    <path d="M2 6h3l4-3.5v13L5 12H2z" />
    {muted ? (
      <path d="M11 6l5 6M16 6l-5 6" stroke="currentColor" strokeWidth="1.8" fill="none" />
    ) : (
      <path d="M11.5 5.5a5 5 0 010 7M13.5 3.5a8 8 0 010 11" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    )}
  </svg>
);
const IconSkull = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 1a6 6 0 00-6 6c0 2.2 1.2 3.9 3 4.9V14a1 1 0 001 1h4a1 1 0 001-1v-2.1c1.8-1 3-2.7 3-4.9a6 6 0 00-6-6zM5.5 8.5A1.5 1.5 0 117 7a1.5 1.5 0 01-1.5 1.5zm5 0A1.5 1.5 0 1112 7a1.5 1.5 0 01-1.5 1.5zM8 9.5l1 2H7z" />
  </svg>
);

const IconFs = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    {active ? (
      <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
    ) : (
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
    )}
  </svg>
);

/* ---------- high score table ---------- */
function HighScores({ list, highlight }: { list: HS[]; highlight?: number }) {
  return (
    <div className="w-full">
      {list.length === 0 ? (
        <p className="text-[15px] tracking-wide text-[#a8bd8a]/70 py-3">
          NO SURVIVORS ON RECORD. THE YARD AWAITS.
        </p>
      ) : (
        <table className="w-full text-[15px] leading-tight">
          <thead>
            <tr className="text-left text-[11px] tracking-[0.25em] text-[#7d9457]">
              <th className="pb-1.5 font-bold">#</th>
              <th className="pb-1.5 font-bold">CALLSIGN</th>
              <th className="pb-1.5 font-bold text-right">SCORE</th>
              <th className="pb-1.5 font-bold text-right hidden sm:table-cell">WAVE</th>
              <th className="pb-1.5 font-bold text-right hidden sm:table-cell">KILLS</th>
            </tr>
          </thead>
          <tbody>
            {list.map((h, i) => (
              <tr
                key={h.t + "-" + i}
                className={
                  i === highlight
                    ? "text-[#9dff20] bg-[#9dff2010]"
                    : i === 0
                      ? "text-[#ffb020]"
                      : "text-[#e8e2cf]/85"
                }
              >
                <td className="py-[3px] font-bold">{i + 1}</td>
                <td className="py-[3px] font-semibold tracking-[0.12em]">{h.name}</td>
                <td className="py-[3px] text-right font-extrabold tabular-nums">{h.score}</td>
                <td className="py-[3px] text-right tabular-nums hidden sm:table-cell">{h.wave}</td>
                <td className="py-[3px] text-right tabular-nums hidden sm:table-cell">{h.kills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- control rows ---------- */
function Key({ k }: { k: string }) {
  return <span className="kbd">{k}</span>;
}

function Manual({ touch }: { touch: boolean }) {
  return (
    <div className="space-y-[7px] text-[15px] tracking-wide">
      {touch ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">MOVE</span>
            <span className="font-bold text-[#e8e2cf]">LEFT STICK</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">AIM + FIRE</span>
            <span className="font-bold text-[#e8e2cf]">RIGHT STICK (HOLD)</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">DASH</span>
            <span className="font-bold text-[#e8e2cf]">DASH BUTTON</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">SWAP WEAPON</span>
            <span className="font-bold text-[#e8e2cf]">SWAP / TAP SLOT</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">RELOAD</span>
            <span className="font-bold text-[#e8e2cf]">AUTOMATIC</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">AOE BOMB</span>
            <span className="font-bold text-[#e8e2cf]">BOMB BUTTON</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">MOVE</span>
            <span className="flex gap-1"><Key k="W" /><Key k="A" /><Key k="S" /><Key k="D" /></span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">AIM</span>
            <span className="font-bold text-[#e8e2cf]">MOUSE</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">FIRE</span>
            <span className="font-bold text-[#e8e2cf]">HOLD LEFT CLICK</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">DASH</span>
            <span className="flex gap-1"><Key k="SHIFT" /><Key k="SPACE" /></span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">RELOAD</span>
            <span className="font-bold text-[#e8e2cf]">AUTOMATIC</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">AOE BOMB</span>
            <span className="flex gap-1"><Key k="G" /></span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">SWAP WEAPON</span>
            <span className="font-bold text-[#e8e2cf] text-[11px] tracking-widest mt-1">SCROLL / KEYS 1-6</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#a8bd8a]">PAUSE / MUTE</span>
            <span className="flex gap-1"><Key k="P" /><Key k="M" /></span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- app ---------- */
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>("menu");
  const [stats, setStats] = useState<RunStats | null>(null);
  const [muted, setMuted] = useState(false);
  const [scores, setScores] = useState<HS[]>(loadHS);
  const [name, setName] = useState("SURVIVOR");
  const [savedIdx, setSavedIdx] = useState(-1);
  const [isTouch] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window),
  );
  const [recs, setRecs] = useState<RecMap>(loadRecs);
  const [savedRun, setSavedRun] = useState<EndlessSave | null>(loadSave);
  const [mode, setMode] = useState<Mode>("survival");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const game = new Game(cv, {
      onPhase: (p, st) => {
        setPhase(p);
        if (st) setStats(st);
        if (p === "gameover") setSavedIdx(-1);
      },
      onMute: setMuted,
      onRunEnd: (s) =>
        setRecs((prev) => {
          const next = mergeRun(prev, s);
          saveRecs(next);
          return next;
        }),
    });
    gameRef.current = game;
    setMuted(game.getMuted());
    return () => game.destroy();
  }, []);

  const g = () => gameRef.current;

  const run = useCallback(
    (m: Mode) => {
      setMode(m);
      g()?.start({ mode: m, difficulty });
    },
    [difficulty],
  );

  const saveAndExit = () => {
    const s = g()?.snapshotRun();
    if (!s) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      /* noop */
    }
    setSavedRun(s);
    g()?.saveExit();
  };

  const resumeSaved = () => {
    const s = savedRun;
    if (!s) return;
    clearSave();
    setSavedRun(null);
    g()?.restoreRun(s);
  };

  const qualifies = useCallback(
    (s: RunStats | null) => {
      if (!s || s.mode !== "survival" || s.score <= 0) return false;
      return scores.length < 8 || s.score > scores[scores.length - 1].score;
    },
    [scores],
  );

  const submitScore = () => {
    if (!stats) return;
    const entry: HS = {
      name: (name.trim() || "SURVIVOR").toUpperCase().slice(0, 12),
      score: stats.score,
      wave: stats.wave,
      kills: stats.kills,
      t: Date.now(),
    };
    const next = [...scores, entry].sort((a, b) => b.score - a.score).slice(0, 8);
    setScores(next);
    saveHS(next);
    setSavedIdx(next.findIndex((e) => e.t === entry.t));
  };

  // keep the engine's stored run config in step with the on-screen selection
  // (Enter / R restarts use whatever the engine has stored)
  useEffect(() => {
    g()?.select({ mode, difficulty });
  }, [mode, difficulty]);

  // fullscreen state (iOS Safari has no element-fullscreen; standalone mode covers it there)
  const [fsOn, setFsOn] = useState(fsActive());
  useEffect(() => {
    const sync = () => setFsOn(fsActive());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);
  const toggleFs = () => {
    if (fsActive()) exitFs();
    else if (fsSupported()) enterFs();
  };

  const ticker =
    "OUTBREAK DAY 114 •• QUARANTINE ZONE 07 •• NO SIGNAL BEYOND THE FENCE •• AMMUNITION IS CURRENCY •• THE DEAD DO NOT SLEEP •• ";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0f0a] scanlines noise">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* in-game DOM controls */}
      {(phase === "playing" || phase === "paused" || phase === "downed") && (
        <div className="safe-r-t absolute right-3 top-3 z-40 flex gap-2">
          <button className="icon-btn" aria-label="Toggle sound" onClick={() => g()?.toggleMute()}>
            <IconSound muted={muted} />
          </button>
          {(phase === "playing" || phase === "downed") && (
            <button className="icon-btn" aria-label="Pause" onClick={() => g()?.togglePause()}>
              <IconPause />
            </button>
          )}
        </div>
      )}

      {/* ============ START SCREEN ============ */}
      {phase === "menu" && (
        <div className="safe-inset absolute inset-0 z-30 flex flex-col">
          {/* ticker */}
          <div className="relative z-10 flex h-9 items-center overflow-hidden border-b border-[#2c3a22] bg-[#0a0e08]/90">
            <div className="marquee-track flex text-[13px] font-semibold tracking-[0.3em] text-[#9dff20]/70">
              <span className="pr-2">{ticker.repeat(3)}</span>
              <span className="pr-2">{ticker.repeat(3)}</span>
            </div>
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 gap-2">
              <button
                className="icon-btn"
                aria-label={fsOn ? "Exit fullscreen" : "Enter fullscreen"}
                title={fsOn ? "EXIT FULLSCREEN" : "FULLSCREEN"}
                onClick={toggleFs}
              >
                <IconFs active={fsOn} />
              </button>
              <button className="icon-btn" aria-label="Toggle sound" onClick={() => g()?.toggleMute()}>
                <IconSound muted={muted} />
              </button>
            </div>
          </div>

          <div className="relative z-10 flex flex-1 overflow-y-auto p-4 sm:p-8">
            <div className="m-auto grid w-full max-w-5xl items-center gap-8 py-4 lg:grid-cols-[1.15fr_1fr]">
              {/* left: identity */}
              <div className="rise-in">
                <div className="stencil-tag mb-3 flex items-center gap-3">
                  <span className="inline-block h-[2px] w-8 bg-[#9dff20]" />
                  ZONE 07 // NIGHT OPERATIONS
                </div>
                <h1 className="font-creep title-drip text-[19vw] leading-[0.86] text-[#ff2f2f] sm:text-8xl lg:text-[7.2rem]">
                  GRAVEYARD
                  <br />
                  SHIFT
                </h1>
                <p className="mt-4 max-w-md text-lg font-medium leading-snug tracking-wide text-[#e8e2cf]/85">
                  The fence won't hold. Hold the yard instead — wave after wave of the
                  restless dead, until the sun comes up or you don't.
                </p>

                {/* shift selection: mode cards + difficulty chips */}
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <ModeCard
                    title="SURVIVAL SHIFT"
                    sub="Die and the shift ends — reach the extraction wave."
                    active={mode === "survival"}
                    onPick={() => setMode("survival")}
                    best={recs[recKey("survival", difficulty)]}
                  />
                  <ModeCard
                    title="ENDLESS SHIFT"
                    sub="Down and you reboot in three seconds — the yard never ends."
                    active={mode === "endless"}
                    onPick={() => setMode("endless")}
                    best={recs[recKey("endless", difficulty)]}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold tracking-[0.2em] text-[#7d9457]">
                    DIFFICULTY
                  </span>
                  {mode === "endless" ? (
                    <span className="text-[11px] font-semibold tracking-[0.16em] text-[#a8bd8a]">
                      LOCKED · MEDIUM
                    </span>
                  ) : (
                    (["easy", "medium", "hard"] as Difficulty[]).map((d) => {
                      const rec = recs[recKey("survival", d)];
                      const on = difficulty === d;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDifficulty(d)}
                          className="panel px-3 py-1.5 text-[12px] font-bold tracking-[0.16em]"
                          style={
                            on
                              ? { borderColor: "#9dff20", background: "rgba(157,255,32,0.07)", color: "#9dff20" }
                              : { color: "#a8bd8a" }
                          }
                        >
                          {d.toUpperCase()} · {rec?.kills ?? 0}K
                          <span className="ml-1 font-semibold text-[#e8e2cf]/60">
                            {fmtTime(rec?.time ?? 0)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <button
                    className="btn px-9 py-4 text-xl"
                    onClick={() => {
                      run(mode);
                      // phones only: drop into fullscreen before the fight starts
                      if (isTouch && !fsOn && !isStandalone() && fsSupported()) enterFs();
                    }}
                  >
                    <IconSkull /> CLOCK IN
                  </button>
                  {savedRun && (
                    <button className="btn btn-ghost px-6 py-3" onClick={resumeSaved}>
                      RESUME ENDLESS — WAVE {savedRun.wave} · {savedRun.score}
                    </button>
                  )}
                  <div className="text-[13px] font-semibold tracking-[0.22em] text-[#a8bd8a]">
                    {isTouch ? "TAP TO DEPLOY" : (
                      <>PRESS <span className="kbd">ENTER</span></>
                    )}
                  </div>
                </div>

                <div className="mt-8 flex gap-6 text-[13px] font-semibold tracking-[0.18em] text-[#7d9457]">
                  <span><span className="text-[#ffb020]">5</span> MUTATIONS</span>
                  <span><span className="text-[#ffb020]">6</span> WEAPONS</span>
                  <span>
                    <span className="text-[#9adcff]">3</span> LONG
                    <span className="text-[#7d9457]"> / </span>
                    <span className="text-[#ffb46a]">3</span> SHORT
                  </span>
                  <span><span className="text-[#ffb020]">∞</span> WAVES</span>
                </div>
              </div>

              {/* right: manual + records */}
              <div className="flex flex-col gap-4">
                <div className="panel rise-in-1 p-5">
                  <div className="stencil-tag mb-3">{isTouch ? "TOUCH PROTOCOL" : "FIELD MANUAL"}</div>
                  <Manual touch={isTouch} />
                  {isTouch ? null : (
                    <div className="mt-3 border-t border-[#2c3a22] pt-3">
                      <div className="stencil-tag mb-2 text-[#ffb020]">TOUCH PROTOCOL</div>
                      <p className="text-[14px] tracking-wide text-[#a8bd8a]">
                        On phones: left stick moves, right stick aims and fires, corner buttons dash &amp; swap.
                      </p>
                    </div>
                  )}
                </div>
                <div className="panel rise-in-2 p-5">
                  <div className="stencil-tag mb-2">HALL OF THE LIVING — TOP SCORES</div>
                  <HighScores list={scores} />
                </div>
              </div>
            </div>
          </div>

          {/* footer strip */}
          <div className="relative z-10 flex h-8 items-center justify-between border-t border-[#2c3a22] bg-[#0a0e08]/90 px-4 text-[12px] font-semibold tracking-[0.25em] text-[#7d9457]">
            <span>NIGHT OPS BUILD 1.7</span>
            <span className="flicker text-[#ff2f2f]">PERIMETER BREACH IMMINENT</span>
          </div>
        </div>
      )}

      {/* ============ PAUSE ============ */}
      {phase === "paused" && (
        <div className="safe-inset absolute inset-0 z-30 grid place-items-center bg-[#05080488] p-4 backdrop-blur-[2px]">
          <div className="panel rise-in w-full max-w-[340px] p-5 text-center">
            <div className="stencil-tag mb-1">SHIFT SUSPENDED</div>
            <h2 className="font-creep text-4xl text-[#9dff20]">PAUSED</h2>
            <div className="mx-auto my-3 grid w-full grid-cols-3 gap-2 text-center">
              <div className="bg-[#0a0e08] py-1.5">
                <div className="text-[11px] tracking-[0.2em] text-[#7d9457]">SCORE</div>
                <div className="text-lg font-extrabold text-[#ffb020] tabular-nums">
                  {stats?.score ?? 0}
                </div>
              </div>
              <div className="bg-[#0a0e08] py-1.5">
                <div className="text-[11px] tracking-[0.2em] text-[#7d9457]">WAVE</div>
                <div className="text-lg font-extrabold text-[#ff2f2f]">
                  {(stats?.wave ?? 0) || "—"}
                </div>
              </div>
              <div className="bg-[#0a0e08] py-1.5">
                <div className="text-[11px] tracking-[0.2em] text-[#7d9457]">KILLS</div>
                <div className="text-lg font-extrabold text-[#e8e2cf]">
                  {(stats?.kills ?? 0) || "—"}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <button className="btn px-6 py-2.5 text-base" onClick={() => g()?.togglePause()}>
                RESUME — P
              </button>
              <button className="btn btn-ghost px-6 py-2.5" onClick={() => g()?.start()}>
                RESTART RUN
              </button>
              {stats?.mode === "endless" && (
                <button className="btn btn-ghost px-6 py-2.5" onClick={saveAndExit}>
                  SAVE &amp; EXIT
                </button>
              )}
              <button className="btn btn-ghost px-6 py-2.5" onClick={() => g()?.toMenu()}>
                ABANDON POST
              </button>
            </div>
            <p className="mt-3 text-[11px] tracking-[0.2em] text-[#7d9457]">THE DEAD WAIT FOR NO ONE</p>
          </div>
        </div>
      )}

      {/* ============ GAME OVER ============ */}
      {phase === "gameover" && stats && (
        <div className="absolute inset-0 z-30 flex overflow-y-auto bg-[#160505aa] p-4">
          <div className="m-auto w-full max-w-3xl py-4">
            <div className="mb-4 text-center">
              <span className="font-creep stamp-in inline-block border-4 border-[#ff2f2f] px-8 py-2 text-6xl text-[#ff2f2f] sm:text-7xl">
                DEAD.
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="panel panel-blood rise-in p-6">
                <div className="stencil-tag mb-3" style={{ color: "#ff6b5e" }}>SHIFT REPORT</div>
                <div className="space-y-2 text-[17px] tracking-wide">
                  <div className="flex justify-between">
                    <span className="text-[#a8bd8a]">FINAL SCORE</span>
                    <span className="font-extrabold text-[#ffb020] tabular-nums">{stats.score}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a8bd8a]">WAVES HELD</span>
                    <span className="font-extrabold text-[#ff2f2f] tabular-nums">{stats.wave}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a8bd8a]">KILLS</span>
                    <span className="font-extrabold text-[#e8e2cf] tabular-nums">{stats.kills}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a8bd8a]">LONGEST CHAIN</span>
                    <span className="font-extrabold text-[#9dff20] tabular-nums">{stats.bestChain} KILLS</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#a8bd8a]">TIME SURVIVED</span>
                    <span className="font-extrabold text-[#e8e2cf] tabular-nums">{fmtTime(stats.time)}</span>
                  </div>
                </div>

                {qualifies(stats) && savedIdx < 0 && (
                  <div className="mt-5 border-t border-[#4a1414] pt-4">
                    <div className="stencil-tag mb-2 text-[#ffb020]">NEW RECORD — SIGN THE WALL</div>
                    <div className="flex gap-2">
                      <input
                        className="hs-input w-full min-w-0 flex-1"
                        maxLength={12}
                        value={name}
                        autoFocus={!isTouch}
                        onChange={(e) => setName(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && submitScore()}
                        placeholder="SURVIVOR"
                      />
                      <button className="btn px-5 py-2 text-sm" onClick={submitScore}>
                        SAVE
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-3">
                  <button className="btn btn-blood heartbeat px-6 py-3 text-lg" onClick={() => g()?.start()}>
                    <IconSkull /> RESTART — R
                  </button>
                  <button className="btn btn-ghost px-6 py-3" onClick={() => g()?.toMenu()}>
                    MAIN MENU
                  </button>
                </div>
              </div>

              <div className="panel rise-in-1 p-6">
                <div className="stencil-tag mb-3">HALL OF THE LIVING</div>
                <HighScores list={scores} highlight={savedIdx} />
                {savedIdx >= 0 && (
                  <p className="mt-3 text-[13px] font-bold tracking-[0.2em] text-[#9dff20]">
                    RECORD CARVED INTO THE FENCE ✓
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hand kinematics + MediaPipe Hands + Kalidokit
 * UPDATED to support time-series recording + JSON export.
 *
 * Recording controls:
 *  - Press "r" to start/stop recording
 *  - Press "d" to download the current recording as JSON
 *
 * Fixed sampling rate:
 *  - Uses a timer-driven sampler to record at a fixed rate, independent of MediaPipe frame rate.
 *  - TARGET_SAMPLE_RATE_HZ controls the fixed recording rate.
 *
 * NEW (requested):
 *  - Each saved sample now includes `sampleNumber` = 1,2,3,... in the order recorded.
 */

import { Hands, HAND_CONNECTIONS } from "@mediapipe/hands";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { Camera } from "@mediapipe/camera_utils";
import { Hand as KHand } from "kalidokit";

/** ---- DOM ---- */
const videoEl = document.getElementById("webcam") as HTMLVideoElement;
const canvasEl = document.getElementById("output") as HTMLCanvasElement;
const ctx = canvasEl.getContext("2d")!;
const leftPanel = document.getElementById("leftPanel") as HTMLPreElement;
const rightPanel = document.getElementById("rightPanel") as HTMLPreElement;

/** ---- Types we actually use in this file ---- */
type Angle = { x: number; y: number; z: number };
type AngleMap = Record<string, Angle>;
type HandLabel = "Left" | "Right";

/** ---- Smoothing util ---- */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothAngles(prev: AngleMap | null, next: AngleMap, t = 0.35): AngleMap {
  if (!prev) return next;
  const out: AngleMap = {};
  for (const key of Object.keys(next)) {
    const p = prev[key] ?? { x: 0, y: 0, z: 0 };
    const n = next[key];
    out[key] = { x: lerp(p.x, n.x, t), y: lerp(p.y, n.y, t), z: lerp(p.z, n.z, t) };
  }
  return out;
}

let lastLeftRig: AngleMap | null = null;
let lastRightRig: AngleMap | null = null;

/** Helper: get width/height regardless of element type (kept for completeness) */
function getSizeFromSource(src: any): { w: number; h: number } {
  if (src && typeof src.videoWidth === "number") return { w: src.videoWidth, h: src.videoHeight };
  if (src && typeof src.width === "number" && typeof src.height === "number")
    return { w: src.width, h: src.height };
  return { w: canvasEl.width || 960, h: canvasEl.height || 540 };
}

/** ---- Pretty print angles ---- */
function prettyAngles(rig: AngleMap | null) {
  if (!rig) return "—";
  const keys = Object.keys(rig).sort();
  const out: Record<string, string> = {};
  for (const k of keys) {
    const { x, y, z } = rig[k];
    out[k] = `x:${x.toFixed(2)} y:${y.toFixed(2)} z:${z.toFixed(2)}`;
  }
  return JSON.stringify(out, null, 2);
}

/** ---- MediaPipe Hands setup ----
 * ARE WE MIRRORING STUFF OR NOT
 * NOTE: When IS_SELFIE_VIEW = false (non-mirrored), MediaPipe handedness labels
 * are camera-view labels. We flip them to be subject-relative.
 */
const IS_SELFIE_VIEW = false;

/** =========================================================
 *  Recording (FIXED-RATE SAMPLING)
 *  =========================================================
 *  - `onResults` updates `latestSnapshot` when MediaPipe produces a frame.
 *  - A drift-corrected timer loop records at a fixed rate by sampling the latestSnapshot.
 *
 *  Edit TARGET_SAMPLE_RATE_HZ to change recording rate.
 */

// --- Sampling config (EDIT THIS to change fixed recording rate) ---
const TARGET_SAMPLE_RATE_HZ = 30; // <-- change to 10, 30, 60, 120, etc.
const SAMPLE_INTERVAL_MS = 1000 / TARGET_SAMPLE_RATE_HZ;

type KinematicsSample = {
  /** 1-based sample index: 1,2,3,... in the order recorded (NEW) */
  sampleNumber: number;

  /** milliseconds since recording start (fixed-grid time) */
  t_ms: number;

  /** number of detected hands in the latest snapshot */
  detectedHands: number;

  /** raw labels from MediaPipe (camera/selfie dependent) */
  rawHandedness: HandLabel[];

  /** subject-correct labels after applying IS_SELFIE_VIEW flip logic */
  subjectHandedness: HandLabel[];

  /** subject-left hand rig (smoothed), null if not detected in snapshot */
  left: AngleMap | null;

  /** subject-right hand rig (smoothed), null if not detected in snapshot */
  right: AngleMap | null;
};

type KinematicsRecording = {
  meta: {
    version: 1;
    targetSampleRateHz: number;
    sampleIntervalMs: number;
    isSelfieView: boolean;
    startedAtEpochMs: number;
    note: string;
  };
  samples: KinematicsSample[];
};

// --- Recorder state ---
let isRecording = false;
let recordingStartPerfMs = 0; // performance.now() at start
let recordingStartEpochMs = 0; // Date.now() at start (for real-world reference)
let recordedSamples: KinematicsSample[] = [];
let sampleCounter = 0; // (NEW) increments for each saved sample

/** Latest computed kinematics (updated by onResults). Sampler records this at fixed rate. */
type LatestSnapshot = {
  detectedHands: number;
  rawHandedness: HandLabel[];
  subjectHandedness: HandLabel[];
  left: AngleMap | null;
  right: AngleMap | null;
  updatedAtPerfMs: number; // when onResults last updated this snapshot
};

let latestSnapshot: LatestSnapshot = {
  detectedHands: 0,
  rawHandedness: [],
  subjectHandedness: [],
  left: null,
  right: null,
  updatedAtPerfMs: 0,
};

// Timer state for fixed sampler
let samplerTimerId: number | null = null;
let nextSamplePerfMs = 0;

/**
 * Starts a drift-corrected fixed-rate sampling loop.
 * We schedule samples on an absolute time grid (nextSamplePerfMs += interval),
 * so your `t_ms` is evenly spaced at the target rate under normal conditions.
 */
function startFixedSampler() {
  stopFixedSampler(); // safety: ensure no duplicate timers
  nextSamplePerfMs = performance.now(); // start immediately
  scheduleNextSample();
}

/** Stops the fixed sampler loop. */
function stopFixedSampler() {
  if (samplerTimerId !== null) {
    clearTimeout(samplerTimerId);
    samplerTimerId = null;
  }
}

/**
 * Schedules the next sample tick. Uses setTimeout + drift correction.
 * If the main thread is busy, it may "catch up" by writing multiple samples,
 * each with its own fixed-grid t_ms (but sampling the same latestSnapshot).
 *
 * NOTE: Background tabs may throttle timers (browser behavior).
 */
function scheduleNextSample() {
  if (!isRecording) return;

  const nowPerf = performance.now();

  // Catch up if we're behind. Limit catch-up per tick to avoid runaway loops.
  let safety = 0;
  while (nowPerf >= nextSamplePerfMs && safety < 5) {
    sampleCounter += 1; // (NEW) increment on each saved sample

    recordedSamples.push({
      sampleNumber: sampleCounter, // (NEW) 1-based index
      // Fixed-grid timestamp
      t_ms: nextSamplePerfMs - recordingStartPerfMs,
      detectedHands: latestSnapshot.detectedHands,
      rawHandedness: latestSnapshot.rawHandedness,
      subjectHandedness: latestSnapshot.subjectHandedness,
      left: latestSnapshot.left,
      right: latestSnapshot.right,
    });

    nextSamplePerfMs += SAMPLE_INTERVAL_MS;
    safety++;
  }

  // Schedule next tick relative to the fixed time grid
  const delayMs = Math.max(0, nextSamplePerfMs - performance.now());
  samplerTimerId = window.setTimeout(scheduleNextSample, delayMs);
}

/** Start a new recording (clears previous samples). */
function startRecording() {
  isRecording = true;
  recordedSamples = [];
  sampleCounter = 0; // (NEW) reset counter per recording
  recordingStartPerfMs = performance.now();
  recordingStartEpochMs = Date.now();
  console.log(`[REC] Started recording @ ${TARGET_SAMPLE_RATE_HZ} Hz (fixed-rate)`);

  startFixedSampler();
}

/** Stop recording (does not auto-download). */
function stopRecording() {
  isRecording = false;
  stopFixedSampler();
  console.log(`[REC] Stopped. Samples: ${recordedSamples.length}`);
}

/** Toggle recording on/off. */
function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

/** Build the JSON object we’ll export. */
function buildRecording(): KinematicsRecording {
  return {
    meta: {
      version: 1,
      targetSampleRateHz: TARGET_SAMPLE_RATE_HZ,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      isSelfieView: IS_SELFIE_VIEW,
      startedAtEpochMs: recordingStartEpochMs,
      note:
        "Left/Right are subject-relative (your left/right), after IS_SELFIE_VIEW correction. Samples are fixed-rate timer snapshots of the latest MediaPipe results.",
    },
    samples: recordedSamples,
  };
}

/** Download the current recording as a .json file. */
function downloadRecording(filename = `hand_kinematics_${new Date().toISOString()}.json`) {
  const data = buildRecording();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
  console.log(`[REC] Downloaded: ${filename}`);
}

/** Keyboard shortcuts:
 *  - Press "r" to start/stop recording
 *  - Press "d" to download the current recording
 */
document.addEventListener("keydown", (e) => {
  if (e.key === "r") toggleRecording();
  if (e.key === "d") downloadRecording();
});

// Optional: expose helpers on window so you can control from DevTools console
(Object.assign(window as any, {
  startRecording,
  stopRecording,
  toggleRecording,
  downloadRecording,
}) as any);

/** ---- MediaPipe Hands setup ---- */
// const hands = new Hands({
//   // Serve from /public => available at http://localhost:5173/mediapipe/hands/...
//   locateFile: (file) => `/mediapipe/hands/${file}`,
// });

const hands = new Hands({
  locateFile: (file: string) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  selfieMode: IS_SELFIE_VIEW,
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5, // easier to detect
  minTrackingConfidence: 0.3, // easier to keep tracking
});

/** ---- Render + Solve callback from MediaPipe ----
 * NOTE: we accept 'results' as 'any' to avoid fighting upstream type changes.
 *
 * IMPORTANT:
 *  - This function does NOT record directly.
 *  - It ONLY updates `latestSnapshot`, which the fixed-rate sampler reads.
 */
function onResults(results: any) {
  const frame = results.image as CanvasImageSource;

  // Match canvas to frame size
  const imgAny = results.image as any;
  const w = imgAny?.videoWidth ?? imgAny?.width ?? (canvasEl.width || 960);
  const h = imgAny?.videoHeight ?? imgAny?.height ?? (canvasEl.height || 540);
  if (canvasEl.width !== w || canvasEl.height !== h) {
    canvasEl.width = w;
    canvasEl.height = h;
  }

  // Draw the video as-is (not mirrored)
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.drawImage(frame, 0, 0, canvasEl.width, canvasEl.height);

  // Draw landmarks directly (no transforms)
  const lms = results.multiHandLandmarks ?? [];
  for (const lm of lms) {
    drawConnectors(ctx as any, lm as any, HAND_CONNECTIONS);
    drawLandmarks(ctx as any, lm as any);
  }

  // If no hands: clear panels + update latest snapshot (sampler will record nulls)
  if (!lms.length) {
    leftPanel.textContent = "—";
    rightPanel.textContent = "—";

    latestSnapshot = {
      detectedHands: 0,
      rawHandedness: [],
      subjectHandedness: [],
      left: null,
      right: null,
      updatedAtPerfMs: performance.now(),
    };

    return;
  }

  const handednessList = (results.multiHandedness ?? []) as Array<{ label: HandLabel }>;

  // Collect per-frame labels + detected rigs
  const rawLabels: HandLabel[] = [];
  const subjectLabels: HandLabel[] = [];
  let frameLeft: AngleMap | null = null;
  let frameRight: AngleMap | null = null;

  lms.forEach((lm: any, i: number) => {
    // Raw label as MediaPipe reports it
    const raw = (handednessList[i]?.label ?? "Right") as HandLabel;
    rawLabels.push(raw);

    // Subject-correct label: if NOT selfie view, flip the label
    const label: HandLabel = IS_SELFIE_VIEW ? raw : raw === "Left" ? "Right" : "Left";
    subjectLabels.push(label);

    // Solve rig
    const rig = KHand.solve(lm as any, label) as AngleMap | undefined;
    if (!rig) return;

    // Smooth + print + store for snapshot
    if (label === "Left") {
      lastLeftRig = smoothAngles(lastLeftRig, rig);
      leftPanel.textContent = prettyAngles(lastLeftRig);
      frameLeft = lastLeftRig;
    } else {
      lastRightRig = smoothAngles(lastRightRig, rig);
      rightPanel.textContent = prettyAngles(lastRightRig);
      frameRight = lastRightRig;
    }
  });

  // Update latest snapshot (sampler records this at fixed rate)
  latestSnapshot = {
    detectedHands: lms.length,
    rawHandedness: rawLabels,
    subjectHandedness: subjectLabels,
    left: frameLeft,
    right: frameRight,
    updatedAtPerfMs: performance.now(),
  };
}

// Listener (kept) + small debug
hands.onResults((res: any) => {
  const count = res?.multiHandLandmarks?.length ?? 0;
  leftPanel.textContent = `Detections: ${count}`;
  rightPanel.textContent = res?.multiHandedness?.map((h: any) => h.label).join(", ") || "—";
  onResults(res);
});

/** ---- Webcam → MediaPipe ---- */
const camera = new Camera(videoEl, {
  onFrame: async () => {
    await hands.send({ image: videoEl });
  },
  width: 960,
  height: 540,
});

// (async function start() {
//   try {
//     const stream = await navigator.mediaDevices.getUserMedia({ video: true });
//     videoEl.srcObject = stream;
//     await videoEl.play();
//   } catch (err) {
//     alert("Could not access the webcam. Please allow camera access and reload.");
//     throw err;
//   }
//   camera.start();
// })();

(async function start() {
  try {
    await camera.start();
  } catch (err) {
    alert("Could not access the webcam. Please allow camera access and reload.");
    console.error(err);
  }
})();
import './style.css';
import { parseMidiBuffer } from './midi/parser';
import { MidiInputManager } from './midi/input';
import { KeyboardVisualizer } from './components/keyboard';
import { NoteRenderer, type NoteWithMeta, type NoteOverlap } from './components/canvasRenderer';
import { TimelineMinimap, type LoopRegion } from './components/timeline';
import { generateBarLines, type BarLine } from './midi/conductor';
import { BackingTrackPlayer } from './audio/backingTrack';
import { extractWaveformData, type WaveformData } from './audio/waveform';
import { assignFingering, enforceHandTerritories } from './midi/fingering';
import { ParticleEngine } from './components/particles';
import { ScoreEngine, type HitRating } from './gameplay/scoreEngine';
import { getInstrumentIcon } from './components/icons';
import type { ParsedSong } from './midi/types';

const TRACK_PALETTE = ['#38bdf8', '#a855f7', '#f97316', '#22c55e', '#f43f5e', '#eab308'];

// -------------------------------------------------------------
// DOM Hooks
// -------------------------------------------------------------
const fileInput = document.getElementById('midi-upload') as HTMLInputElement;
const audioInput = document.getElementById('audio-upload') as HTMLInputElement;
const audioStatus = document.getElementById('audio-status') as HTMLDivElement;
const audioVolume = document.getElementById('audio-volume') as HTMLInputElement;
const volumeLabel = document.getElementById('volume-label') as HTMLSpanElement;
const volumeResetBtn = document.getElementById('volume-reset-btn') as HTMLButtonElement;

// Dual Sync Delay Sliders
const coarseSyncSlider = document.getElementById('coarse-sync-slider') as HTMLInputElement;
const coarseVal = document.getElementById('coarse-val') as HTMLSpanElement;
const coarseResetBtn = document.getElementById('coarse-reset-btn') as HTMLButtonElement;

const fineSyncSlider = document.getElementById('fine-sync-slider') as HTMLInputElement;
const fineVal = document.getElementById('fine-val') as HTMLSpanElement;
const fineResetBtn = document.getElementById('fine-reset-btn') as HTMLButtonElement;

const trackListEl = document.getElementById('track-list') as HTMLDivElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const loopBtn = document.getElementById('loop-btn') as HTMLButtonElement;
const autoFitBtn = document.getElementById('auto-fit-btn') as HTMLButtonElement;
const deviceInfo = document.getElementById('device-info') as HTMLDivElement;

// Toggles
const waitToggle = document.getElementById('wait-toggle') as HTMLInputElement;
const fingerToggle = document.getElementById('finger-toggle') as HTMLInputElement;
const foldToggle = document.getElementById('fold-toggle') as HTMLInputElement;
const noteLabelToggle = document.getElementById('note-label-toggle') as HTMLInputElement;
const keyLabelToggle = document.getElementById('key-label-toggle') as HTMLInputElement;

// Arcade HUD
const arcadeHudEl = document.getElementById('arcade-hud') as HTMLDivElement;
const hudScore = document.getElementById('hud-score') as HTMLDivElement;
const multiplierBadge = document.getElementById('multiplier-badge') as HTMLDivElement;
const streakVal = document.getElementById('streak-val') as HTMLSpanElement;
const ratingToast = document.getElementById('rating-toast') as HTMLDivElement;
const starIcons = document.querySelectorAll<HTMLSpanElement>('.star-icon');
// --- PASTE DIRECTLY UNDER starIcons ---
let starProgressBar = document.getElementById('star-progress-bar') as HTMLDivElement | null;
let starProgressFill = document.getElementById('star-progress-fill') as HTMLDivElement | null;
let starProgressText = document.getElementById('star-progress-text') as HTMLSpanElement | null;

if (!starProgressBar) {
  const starsContainer = arcadeHudEl.querySelector('.stars-container') || arcadeHudEl;
  const progressWrapper = document.createElement('div');
  progressWrapper.id = 'star-progress-bar';
  progressWrapper.style.cssText = `
  width: 140px;
  height: 6px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  overflow: hidden;
  margin: 4px auto 2px auto;
  position: relative;
  `;

  starProgressFill = document.createElement('div');
  starProgressFill.id = 'star-progress-fill';
  starProgressFill.style.cssText = `
  width: 0%;
  height: 100%;
  background: linear-gradient(90deg, #38bdf8, #facc15);
  border-radius: 999px;
  transition: width 0.12s ease-out;
  `;

  starProgressText = document.createElement('span');
  starProgressText.id = 'star-progress-text';
  starProgressText.style.cssText = `
  font-size: 10px;
  color: #94a3b8;
  display: block;
  text-align: center;
  font-weight: 600;
  letter-spacing: 0.04em;
  `;

  progressWrapper.appendChild(starProgressFill);
  starsContainer.appendChild(progressWrapper);
  starsContainer.appendChild(starProgressText);
}
// Summary Performance Modal
const summaryModal = document.getElementById('summary-modal') as HTMLDivElement;
const summaryStars = document.querySelectorAll<HTMLSpanElement>('.big-star');
const summaryFinalScore = document.getElementById('summary-final-score') as HTMLSpanElement;
const summaryAccuracy = document.getElementById('summary-accuracy') as HTMLElement;
const summaryMaxStreak = document.getElementById('summary-max-streak') as HTMLElement;
const summaryPerfect = document.getElementById('summary-perfect') as HTMLElement;
const summaryGreat = document.getElementById('summary-great') as HTMLElement;
const summaryGood = document.getElementById('summary-good') as HTMLElement;
const summaryMisses = document.getElementById('summary-misses') as HTMLElement;
const summaryStarReqs = document.getElementById('summary-star-reqs') as HTMLDivElement;
const summaryReplayBtn = document.getElementById('summary-replay-btn') as HTMLButtonElement;
const summaryCloseBtn = document.getElementById('summary-close-btn') as HTMLButtonElement;

// Speed Controls
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedLabel = document.getElementById('speed-label') as HTMLSpanElement;
const presetButtons = document.querySelectorAll<HTMLButtonElement>('.preset-btn');

// Canvas Stage for Pointer Interaction
const noteCanvasEl = document.getElementById('note-canvas') as HTMLCanvasElement;

// -------------------------------------------------------------
// Engine Instances
// -------------------------------------------------------------
const visualizer = new KeyboardVisualizer('keyboard-view');
const renderer = new NoteRenderer('note-canvas');
const minimap = new TimelineMinimap('timeline-canvas', 'timeline-playhead');
const midiInput = new MidiInputManager();
const backingTrack = new BackingTrackPlayer();
const particles = new ParticleEngine();
const scoreEngine = new ScoreEngine();

// -------------------------------------------------------------
// Application State
// -------------------------------------------------------------
let currentSong: ParsedSong | null = null;
let currentBarLines: BarLine[] = [];
let currentWaveform: WaveformData | null = null;

let coarseOffsetSec = 0;
let fineOffsetMs = 0;
let currentOffsetSeconds = 0;

const selectedTrackIds = new Set<number>();
const trackOctaveShifts = new Map<number, number>();
const trackHandMap = new Map<number, 'RH' | 'LH'>();
let foldTo2Octaves = true;
let showNoteLabels = true;
let showFingering = true;
let waitForNotes = false;

let combinedNotes: NoteWithMeta[] = [];
let detectedOverlaps: NoteOverlap[] = [];

// Physical pressed keys
const physicalPressedKeys = new Set<number>();

// Strike-To-Advance Precision Tolerances
const EARLY_HIT_WINDOW = 0.16;
const LATE_GRACE_WINDOW = 0.16;

// Anti-Double-Penalty & Late-Reaction Buffers
const EARLY_RUSH_BUFFER = 0.35; // 160ms to 350ms early: consumes note, 1 miss only
const LATE_GHOST_BUFFER = 0.40; // Up to 400ms late: absorbs late press with zero extra penalty
// Practice Mode State
const noteStruckMap = new Map<number, boolean>();
const currentWaitingNoteIds = new Set<number>();
const currentWaitingMidis = new Set<number>();
let isWaitingForInput = false;

// Star Unlock Tracking
let currentActiveStars = 0;

// Hardware Debounce Cache (40ms ghost packet filter)
const lastPhysicalNoteOnTimes = new Map<number, number>();

// Loop State
const loopState: LoopRegion = {
  start: 0,
  end: 8,
  enabled: false,
};

// Transport State
let isPlaying = false;
let playbackSpeed = 1.0;
let currentTransportTime = 0;
let lastFrameTimestamp = performance.now();
let toastTimeout: number | null = null;

// Canvas Drag State
let isCanvasDragging = false;
let dragStartY = 0;
let dragStartTime = 0;
let wasPlayingBeforeDrag = false;

// -------------------------------------------------------------
// 1. Arcade HUD, Ratings & Performance Summary
// -------------------------------------------------------------
function showRatingToast(rating: HitRating): void {
  if (toastTimeout) window.clearTimeout(toastTimeout);
  ratingToast.innerText = rating === 'PERFECT' ? 'PERFECT!' : rating === 'GREAT' ? 'GREAT!' : rating === 'GOOD' ? 'GOOD' : 'MISS';
  ratingToast.className = `rating-toast show ${rating.toLowerCase()}`;

  toastTimeout = window.setTimeout(() => {
    ratingToast.classList.remove('show');
  }, 450);
}

function triggerStarCelebration(starNumber: number): void {
  const targetStarEl = document.querySelector<HTMLSpanElement>(`.star-icon[data-star="${starNumber}"]`);
  if (targetStarEl) {
    targetStarEl.classList.remove('star-unlock-anim');
    void targetStarEl.offsetWidth; // Force layout reflow
    targetStarEl.classList.add('star-unlock-anim');

    arcadeHudEl.classList.add('star-flash');
    setTimeout(() => arcadeHudEl.classList.remove('star-flash'), 650);

    const starRect = targetStarEl.getBoundingClientRect();
    const canvasRect = noteCanvasEl.getBoundingClientRect();
    const emitX = starRect.left + starRect.width / 2 - canvasRect.left;
    const emitY = starRect.top + starRect.height / 2 - canvasRect.top;

    (particles as any).emitStarCelebration?.(emitX, Math.max(30, emitY));
  }
}

function updateArcadeHUD(): void {
  const state = scoreEngine.getState();
  hudScore.innerText = (state.score || 0).toString().padStart(6, '0');
  streakVal.innerText = (state.streak || 0).toString();

  const mult = typeof state.multiplier === 'number' ? state.multiplier : 1.0;
  multiplierBadge.innerText = `${mult.toFixed(1)}X`;

  const multTier = Math.min(4, Math.max(1, Math.floor(mult)));
  multiplierBadge.className = `multiplier-badge mult-${multTier}x`;

  if (typeof (backingTrack as any).updatePerformanceFilter === 'function') {
    (backingTrack as any).updatePerformanceFilter(mult);
  }

  // Live Star Celebrations
  if (state.stars > currentActiveStars) {
    for (let s = currentActiveStars + 1; s <= state.stars; s++) {
      triggerStarCelebration(s);
    }
    currentActiveStars = state.stars;
  } else if (state.stars < currentActiveStars) {
    currentActiveStars = state.stars;
  }

  // Update Star Icon states
  starIcons.forEach((starEl) => {
    const starIdx = parseInt(starEl.dataset.star || '0', 10);
    starEl.classList.toggle('filled', starIdx <= state.stars);
  });

  // Update Milestone Progress Bar
  if (starProgressFill && starProgressText) {
    starProgressFill.style.width = `${state.starProgressPercent}%`;
    if (state.stars >= 5) {
      starProgressText.innerText = 'MAX STARS!';
      starProgressText.style.color = '#facc15';
    } else {
      starProgressText.innerText = `★ Star ${state.nextStarNumber}: ${state.starProgressPercent}%`;
      starProgressText.style.color = '#94a3b8';
    }
  }
}

function showSummaryModal(): void {
  pausePlayback();
  const state = scoreEngine.getState();
  const reqs = scoreEngine.getStarRequirements();

  summaryFinalScore.innerText = state.score.toString().padStart(6, '0');
  summaryMaxStreak.innerText = state.maxStreak.toString();
  summaryPerfect.innerText = state.perfectHits.toString();
  summaryGreat.innerText = state.greatHits.toString();
  summaryGood.innerText = state.goodHits.toString();
  summaryMisses.innerText = state.misses.toString();

  // Rhythm Game Standard Metric: Hits / (Hits + Misses)
  const totalHits = state.perfectHits + state.greatHits + state.goodHits;
  const totalEvaluated = totalHits + state.misses;
  const accPct = totalEvaluated > 0 ? Math.round((totalHits / totalEvaluated) * 100) : 0;
  summaryAccuracy.innerText = `${accPct}%`;

  console.group('%c[TRACK COMPLETE] Performance Summary Metrics', 'color: #22c55e; font-weight: bold; font-size: 12px;');
  console.log(`Final Score: ${state.score} pts | Stars Achieved: ${state.stars}/5`);
  console.log(`Total Hits: ${totalHits} (Perfect: ${state.perfectHits}, Great: ${state.greatHits}, Good: ${state.goodHits})`);
  console.log(`Total Misses: ${state.misses}`);
  console.log(`Calculated Accuracy: ${totalHits} hits / ${totalEvaluated} evaluated notes = ${accPct}%`);
  console.groupEnd();

  summaryStars.forEach((starEl) => {
    const starIdx = parseInt(starEl.dataset.star || '0', 10);
    starEl.classList.toggle('filled', starIdx <= state.stars);
  });

  summaryStarReqs.innerHTML = '';
  reqs.forEach((r) => {
    const row = document.createElement('div');
    const isEarned = state.score >= r.scoreRequired;
    row.className = `star-req-row ${isEarned ? 'achieved' : ''}`;
    row.innerHTML = `
    <span class="star-req-badge">★ Star ${r.star} (${r.pctOfIdeal}%)</span>
    <span>${r.scoreRequired.toLocaleString()} pts</span>
    `;
    summaryStarReqs.appendChild(row);
  });

  summaryModal.classList.remove('hidden');
}

function closeSummaryModal(): void {
  summaryModal.classList.add('hidden');
}

// -------------------------------------------------------------
// Scorched-Earth State Reset
// -------------------------------------------------------------
function hardResetGameState(rewindToZero = true): void {
  isPlaying = false;
  isWaitingForInput = false;
  backingTrack.stop();

  if (rewindToZero) {
    currentTransportTime = 0;
    backingTrack.seek(0);
    lastFrameTimestamp = performance.now();
  }

  playBtn.innerText = 'Play (Space)';
  closeSummaryModal();

  noteStruckMap.clear();
  currentWaitingNoteIds.clear();
  currentWaitingMidis.clear();
  physicalPressedKeys.clear();
  particles.clear();
  currentActiveStars = 0;

  // Strict DOM Purge: strips both classes so gold stars vanish on restart
  arcadeHudEl.classList.remove('star-flash');
  starIcons.forEach((s) => {
    s.classList.remove('filled', 'star-unlock-anim');
  });
  summaryStars.forEach((s) => {
    s.classList.remove('filled');
  });

  scoreEngine.reset();
  updateArcadeHUD();
  visualizer.clearTargets();
  minimap.setProgress(currentTransportTime);
}

function seedPastNotes(upToTime: number): void {
  for (const n of combinedNotes) {
    if (n.time < upToTime - 0.15) {
      noteStruckMap.set(n.id, true);
    }
  }
}

// -------------------------------------------------------------
// 2. Hardware Input & Ballistic Particle Launch
// -------------------------------------------------------------
midiInput
.init()
.then((devices) => {
  deviceInfo.innerText = devices.length > 0 ? `Connected: ${devices.join(', ')}` : 'No MIDI keyboard found';
})
.catch((err) => {
  deviceInfo.innerText = `MIDI Error: ${err.message}`;
});

midiInput.subscribe((note, _vel, isNoteOn) => {
  visualizer.setUserNoteState(note, isNoteOn);

  if (isNoteOn) {
    // 40ms Debounce: Discards duplicate hardware packets from dual-endpoint controllers
    const now = performance.now();
    const lastTime = lastPhysicalNoteOnTimes.get(note) ?? 0;
    if (now - lastTime < 40) {
      return;
    }
    lastPhysicalNoteOnTimes.set(note, now);

    physicalPressedKeys.add(note);

    if (isPlaying) {
      let bestNote: NoteWithMeta | null = null;
      let bestAbsDiff = Infinity;
      const maxLate = isWaitingForInput ? 0.60 : LATE_GRACE_WINDOW;

      for (const n of combinedNotes) {
        if (n.midi !== note || n.midi < 48 || n.midi > 72) continue;
        if (noteStruckMap.get(n.id)) continue;

        const timeDiff = currentTransportTime - n.time;
        const isEligible = timeDiff >= -EARLY_HIT_WINDOW && timeDiff <= maxLate;

        if (isEligible) {
          const absDiff = Math.abs(timeDiff);
          if (absDiff < bestAbsDiff) {
            bestAbsDiff = absDiff;
            bestNote = n;
          }
        }
      }

      if (bestNote) {
        // --- 1. CLEAN HIT (PERFECT / GREAT / GOOD) ---
        noteStruckMap.set(bestNote.id, true);
        currentWaitingNoteIds.delete(bestNote.id);
        currentWaitingMidis.delete(bestNote.midi);

        for (const sibling of combinedNotes) {
          if (
            sibling.id !== bestNote.id &&
            sibling.midi === bestNote.midi &&
            Math.abs(sibling.time - bestNote.time) < 0.015
          ) {
            noteStruckMap.set(sibling.id, true);
            currentWaitingNoteIds.delete(sibling.id);
          }
        }

        const { rating, points, mult, multMilestoneCrossed } = scoreEngine.registerHit(
          currentTransportTime - bestNote.time
        );
        showRatingToast(rating);
        updateArcadeHUD();

        const geom = renderer.getNoteGeometry(bestNote.midi);
        if (geom) {
          const hitLineY = renderer.getHitLineY();
          const targetX = geom.x + geom.width / 2;

          particles.emitHit(targetX, hitLineY, bestNote.color || '#38bdf8', 28);
          particles.emitScorePopup(targetX, hitLineY, points);
          (particles as any).emitRatingPopup?.(targetX, hitLineY, rating);

          if (multMilestoneCrossed) {
            particles.emitMultiplierBurst(targetX, hitLineY, mult);
          }
        }
      } else if (!isWaitingForInput && note >= 48 && note <= 72) {
        // --- 2. CHECK: RUSHED EARLY STRIKE (PREVENTS DOUBLE PENALTY) ---
        let rushedNote: NoteWithMeta | null = null;
        let bestRushDiff = Infinity;

        for (const n of combinedNotes) {
          if (n.midi !== note || n.midi < 48 || n.midi > 72) continue;
          if (noteStruckMap.has(n.id)) continue;

          const timeDiff = currentTransportTime - n.time; // Negative for upcoming notes
          if (timeDiff >= -EARLY_RUSH_BUFFER && timeDiff < -EARLY_HIT_WINDOW) {
            const absDiff = Math.abs(timeDiff);
            if (absDiff < bestRushDiff) {
              bestRushDiff = absDiff;
              rushedNote = n;
            }
          }
        }

        if (rushedNote) {
          // Consume the upcoming note right now so renderLoop will NOT miss it a second time
          noteStruckMap.set(rushedNote.id, false);
          for (const sibling of combinedNotes) {
            if (
              sibling.id !== rushedNote.id &&
              sibling.midi === rushedNote.midi &&
              Math.abs(sibling.time - rushedNote.time) < 0.015
            ) {
              noteStruckMap.set(sibling.id, false);
            }
          }

          scoreEngine.registerMiss();
          showRatingToast('MISS');
          updateArcadeHUD();

          const geom = renderer.getNoteGeometry(note);
          if (geom) {
            const hitLineY = renderer.getHitLineY();
            (particles as any).emitRatingPopup?.(geom.x + geom.width / 2, hitLineY, 'MISS');
          }
          return;
        }

        // --- 3. CHECK: LATE REACTION (ABSORBS WITHOUT SECOND MISTAKE) ---
        let isLateReaction = false;
        for (const n of combinedNotes) {
          if (n.midi !== note || n.midi < 48 || n.midi > 72) continue;

          const timeDiff = currentTransportTime - n.time; // Positive for past notes
          if (timeDiff > maxLate && timeDiff <= LATE_GHOST_BUFFER) {
            isLateReaction = true;

            // If renderLoop hasn't logged the miss yet, record the 1 miss now and consume it
            if (!noteStruckMap.has(n.id)) {
              noteStruckMap.set(n.id, false);
              scoreEngine.registerMiss();
              showRatingToast('MISS');
              updateArcadeHUD();

              const geom = renderer.getNoteGeometry(note);
              if (geom) {
                const hitLineY = renderer.getHitLineY();
                (particles as any).emitRatingPopup?.(geom.x + geom.width / 2, hitLineY, 'MISS');
              }
            }
            // If already logged by renderLoop, do nothing—absorb harmlessly
            break;
          }
        }

        // --- 4. GENUINE STRAY KEYPRESS (NO NOTE ANYWHERE NEARBY) ---
        if (!isLateReaction) {
          scoreEngine.registerMiss();
          showRatingToast('MISS');
          updateArcadeHUD();

          const geom = renderer.getNoteGeometry(note);
          if (geom) {
            const hitLineY = renderer.getHitLineY();
            (particles as any).emitRatingPopup?.(geom.x + geom.width / 2, hitLineY, 'MISS');
          }
        }
      }

      if (isWaitingForInput && currentWaitingNoteIds.size === 0) {
        isWaitingForInput = false;
        lastFrameTimestamp = performance.now();
        backingTrack.play(currentTransportTime);
      }
    }
  } else {
    physicalPressedKeys.delete(note);
  }
});

// -------------------------------------------------------------
// 3. Track Aggregation & Multi-Track Pipeline
// -------------------------------------------------------------
function foldPitchToRange(pitch: number, min = 48, max = 72): number {
  let folded = pitch;
  while (folded < min) folded += 12;
  while (folded > max) folded -= 12;
  return folded;
}

function computeNoteOverlaps(notes: NoteWithMeta[]): NoteOverlap[] {
  const notesByPitch = new Map<number, NoteWithMeta[]>();
  for (const n of notes) {
    if (!notesByPitch.has(n.midi)) notesByPitch.set(n.midi, []);
    notesByPitch.get(n.midi)!.push(n);
  }

  const overlaps: NoteOverlap[] = [];

  for (const [midi, pitchNotes] of notesByPitch) {
    for (let i = 0; i < pitchNotes.length; i++) {
      const a = pitchNotes[i];
      const aEnd = a.time + a.duration;

      for (let j = i + 1; j < pitchNotes.length; j++) {
        const b = pitchNotes[j];
        if (b.time >= aEnd) break;

        if (a.color !== b.color) {
          const overlapStart = Math.max(a.time, b.time);
          const overlapEnd = Math.min(aEnd, b.time + b.duration);

          if (overlapEnd - overlapStart > 0.005) {
            overlaps.push({
              midi,
              time: overlapStart,
              duration: overlapEnd - overlapStart,
              baseColor: a.color || '#38bdf8',
              stripeColor: b.color || '#f97316',
            });
          }
        }
      }
    }
  }

  return overlaps;
}

function rebuildCombinedNotes(): void {
  if (!currentSong) {
    combinedNotes = [];
    detectedOverlaps = [];
    scoreEngine.recalculateTrackBenchmark(0);
    hardResetGameState(true);
    return;
  }

  // 1. Strict numeric filter prevents inactive tracks from leaking into notes
  const activeTracks = currentSong.tracks.filter((t) => selectedTrackIds.has(t.id));
  let noteIdCounter = 1;

  combinedNotes = activeTracks.flatMap((track) => {
    const color = TRACK_PALETTE[track.id % TRACK_PALETTE.length];
    const trackShift = trackOctaveShifts.get(track.id) ?? 0;
    const hand = trackHandMap.get(track.id) ?? 'RH';

  return track.notes.map((n) => {
    let finalPitch = n.midi + trackShift;
    if (foldTo2Octaves && !track.isDrum) {
      finalPitch = foldPitchToRange(finalPitch, 48, 72);
    }
    return {
      ...n,
      id: noteIdCounter++,
      midi: finalPitch,
      color,
      hand,
    };
  });
  });

  combinedNotes.sort((a, b) => a.time - b.time);

  if (foldTo2Octaves) {
    enforceHandTerritories(combinedNotes);
  }

  const playable = combinedNotes.filter((n) => n.midi >= 48 && n.midi <= 72);
  const rhNotes = playable.filter((n) => n.hand === 'RH');
  const lhNotes = playable.filter((n) => n.hand === 'LH');

  assignFingering(rhNotes, 'RH');
  assignFingering(lhNotes, 'LH');

  detectedOverlaps = computeNoteOverlaps(combinedNotes);

  // 2. Full engine reset & benchmark recalculation for active tracks
  scoreEngine.recalculateTrackBenchmark(playable.length);
  hardResetGameState(true);

  // 3. Deep Diagnostic Console Logging
  const starRequirements = scoreEngine.getStarRequirements();
  console.group('%c[TRACK RECONFIGURATION] Benchmark & Chart Recalculated', 'color: #38bdf8; font-weight: bold; font-size: 12px;');
  console.log('%cTrack Selection State:', 'font-weight: bold;');
  console.table(
    currentSong.tracks.map((t) => ({
      ID: t.id,
      Name: t.name || 'Unnamed',
      Active: selectedTrackIds.has(t.id) ? 'ENABLED' : 'OFF',
                                   Shift: `${(trackOctaveShifts.get(t.id) ?? 0) > 0 ? '+' : ''}${trackOctaveShifts.get(t.id) ?? 0}`,
                                   RawNotes: t.notes.length,
    }))
  );
  console.log(`Active Playable Notes (48-72): %c${playable.length}`, 'color: #facc15; font-weight: bold;');
  console.log('%cRecalculated Star Thresholds:', 'font-weight: bold;');
  console.table(
    starRequirements.map((r) => ({
      Star: `Star ${r.star}`,
      PointsRequired: r.scoreRequired,
      PctOfIdeal: `${r.pctOfIdeal}%`,
    }))
  );
  console.groupEnd();

  // 4. Viewport Refresh
  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform, currentOffsetSeconds);
  minimap.updateLoopMarkers(loopState);

  updateTargetCues(0);
  renderer.draw(
    0,
    combinedNotes,
    currentBarLines,
    currentWaveform,
    currentOffsetSeconds,
    detectedOverlaps,
    showNoteLabels,
    currentWaitingNoteIds,
    showFingering,
    particles
  );
}

// -------------------------------------------------------------
// 4. Target Cues & Transport Controls
// -------------------------------------------------------------
function updateTargetCues(time: number): void {
  const activeTargets = new Map<number, string>();
  const leadIn = 0.04;

  for (const note of combinedNotes) {
    if (note.time > time + leadIn) break;
    const noteEnd = note.time + Math.max(note.duration, 0.25);
    if (time >= note.time - leadIn && time <= noteEnd) {
      activeTargets.set(note.midi, note.color || '#38bdf8');
    }
  }

  visualizer.setTargetNotes(activeTargets, currentWaitingMidis);
}

function seekTransport(time: number): void {
  currentTransportTime = time;
  backingTrack.seek(time);
  lastFrameTimestamp = performance.now();
  seedPastNotes(time);
  updateTargetCues(currentTransportTime);
}

function scrubToTime(newTime: number): void {
  const songDur = currentSong?.duration || 100;
  const clampedTime = Math.max(0, Math.min(songDur, newTime));

  currentTransportTime = clampedTime;
  backingTrack.seek(clampedTime);
  lastFrameTimestamp = performance.now();

  hardResetGameState(false);
  seedPastNotes(clampedTime);
  updateTargetCues(currentTransportTime);
  minimap.setProgress(currentTransportTime);

  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels,
      currentWaitingNoteIds,
      showFingering,
      particles
    );
  }
}

function startPlayback() {
  if (combinedNotes.length === 0) return;
  closeSummaryModal();

  const isAtStart = currentTransportTime <= 0.05;
  const isPastEnd = currentSong !== null && currentTransportTime >= currentSong.duration;

  if (isAtStart || isPastEnd) {
    currentTransportTime = loopState.enabled && loopState.end > loopState.start ? loopState.start : 0;
    seekTransport(currentTransportTime);
    hardResetGameState(false);
  }

  isPlaying = true;
  isWaitingForInput = false;

  if (loopState.enabled && loopState.end > loopState.start) {
    if (currentTransportTime < loopState.start || currentTransportTime >= loopState.end) {
      currentTransportTime = loopState.start;
    }
  }

  lastFrameTimestamp = performance.now();
  backingTrack.play(currentTransportTime);
  playBtn.innerText = 'Pause (Space)';
}

function pausePlayback() {
  if (!isPlaying) return;
  isPlaying = false;
  isWaitingForInput = false;
  backingTrack.pause();
  playBtn.innerText = 'Resume (Space)';
}

function stopPlayback() {
  hardResetGameState(true);
}

playBtn.addEventListener('click', () => (isPlaying ? pausePlayback() : startPlayback()));
stopBtn.addEventListener('click', stopPlayback);

// -------------------------------------------------------------
// 5. Canvas Drag & Scroll Scrubbing
// -------------------------------------------------------------
noteCanvasEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  isCanvasDragging = true;
  dragStartY = e.clientY;
  dragStartTime = currentTransportTime;
  wasPlayingBeforeDrag = isPlaying;

  if (isPlaying) {
    pausePlayback();
  }

  noteCanvasEl.setPointerCapture(e.pointerId);
  noteCanvasEl.classList.add('dragging');
});

noteCanvasEl.addEventListener('pointermove', (e) => {
  if (!isCanvasDragging) return;

  const deltaY = e.clientY - dragStartY;
  const pps = renderer.getPixelsPerSecond();
  const deltaTime = deltaY / pps;
  scrubToTime(dragStartTime + deltaTime);
});

const endCanvasDrag = (e: PointerEvent) => {
  if (!isCanvasDragging) return;
  isCanvasDragging = false;

  try {
    noteCanvasEl.releasePointerCapture(e.pointerId);
  } catch {}

  noteCanvasEl.classList.remove('dragging');

  if (wasPlayingBeforeDrag) {
    startPlayback();
    wasPlayingBeforeDrag = false;
  }
};

noteCanvasEl.addEventListener('pointerup', endCanvasDrag);
noteCanvasEl.addEventListener('pointercancel', endCanvasDrag);

noteCanvasEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const scrollStepSeconds = (e.deltaY / 100) * 0.35;
    scrubToTime(currentTransportTime + scrollStepSeconds);
  },
  { passive: false }
);

// -------------------------------------------------------------
// 6. Loop & Minimap Handlers
// -------------------------------------------------------------
function updateLoopUI(): void {
  loopBtn.classList.toggle('active', loopState.enabled);
  minimap.updateLoopMarkers(loopState);
  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform, currentOffsetSeconds);
}

function toggleLoop(): void {
  loopState.enabled = !loopState.enabled;
  updateLoopUI();
}

loopBtn.addEventListener('click', toggleLoop);
minimap.onToggleLoop(() => toggleLoop());

minimap.onLoopChange((newA, newB) => {
  const songDur = currentSong?.duration || 100;
  if (newA >= 0) loopState.start = Math.max(0, Math.min(newA, loopState.end - 0.2));
  if (newB >= 0) loopState.end = Math.min(songDur, Math.max(newB, loopState.start + 0.2));

  minimap.updateLoopMarkers(loopState);
  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform, currentOffsetSeconds);
});

minimap.onSeek((targetTime) => {
  currentTransportTime = targetTime;
  backingTrack.seek(targetTime);
  hardResetGameState(false);
  seedPastNotes(targetTime);
  updateTargetCues(currentTransportTime);

  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels,
      currentWaitingNoteIds,
      showFingering,
      particles
    );
  }
});

// -------------------------------------------------------------
// 7. Practice Engine Render Loop
// -------------------------------------------------------------
function renderLoop() {
  const now = performance.now();
  const dt = (now - lastFrameTimestamp) / 1000;
  lastFrameTimestamp = now;

  particles.update(dt);

  if (isPlaying) {
    if (waitForNotes) {
      let mustWait = false;
      let pausePoint = currentTransportTime;
      const playable = combinedNotes.filter((n) => n.midi >= 48 && n.midi <= 72);
      const missingNotes: NoteWithMeta[] = [];

      for (const n of playable) {
        if (n.time > currentTransportTime + 0.01) break;

        if (!noteStruckMap.get(n.id)) {
          if (isWaitingForInput && physicalPressedKeys.has(n.midi)) {
            noteStruckMap.set(n.id, true);
            continue;
          }

          if (n.time + LATE_GRACE_WINDOW > currentTransportTime) {
            continue;
          }

          missingNotes.push(n);
          mustWait = true;
          pausePoint = n.time + LATE_GRACE_WINDOW;
        }
      }

      if (mustWait) {
        currentTransportTime = pausePoint;
        currentWaitingNoteIds.clear();
        currentWaitingMidis.clear();

        missingNotes.forEach((mn) => {
          currentWaitingNoteIds.add(mn.id);
          currentWaitingMidis.add(mn.midi);
        });

        if (!isWaitingForInput) {
          isWaitingForInput = true;
          backingTrack.pause();
        }
      } else {
        currentWaitingNoteIds.clear();
        currentWaitingMidis.clear();

        if (isWaitingForInput) {
          isWaitingForInput = false;
          lastFrameTimestamp = performance.now();
          backingTrack.play(currentTransportTime);
        }
      }
    }

    if (!isWaitingForInput) {
      if (backingTrack.hasTrack()) {
        const audioTime = backingTrack.getCurrentTime();
        if (audioTime !== null) {
          currentTransportTime = audioTime;
        } else {
          currentTransportTime += dt * playbackSpeed;
        }
      } else {
        currentTransportTime += dt * playbackSpeed;
      }
    }

    // Auto-expire notes that passed beyond the late threshold
    if (!waitForNotes) {
      for (const n of combinedNotes) {
        if (n.midi < 48 || n.midi > 72) continue;

        if (n.time < currentTransportTime - 0.22) {
          if (!noteStruckMap.has(n.id)) {
            noteStruckMap.set(n.id, false);
            scoreEngine.registerMiss();
            showRatingToast('MISS');
            updateArcadeHUD();

            const geom = renderer.getNoteGeometry(n.midi);
            if (geom) {
              (particles as any).emitRatingPopup?.(
                geom.x + geom.width / 2,
                renderer.getHitLineY(),
                                                   'MISS'
              );
            }
          }
        } else {
          break;
        }
      }
    }

    if (loopState.enabled && loopState.end > loopState.start) {
      if (currentTransportTime >= loopState.end) {
        seekTransport(loopState.start);
      }
    }

    updateTargetCues(currentTransportTime);
    minimap.setProgress(currentTransportTime);

    if (currentSong && currentTransportTime >= currentSong.duration && !loopState.enabled) {
      showSummaryModal();
    }
  }

  renderer.draw(
    currentTransportTime,
    combinedNotes,
    currentBarLines,
    currentWaveform,
    currentOffsetSeconds,
    detectedOverlaps,
    showNoteLabels,
    currentWaitingNoteIds,
    showFingering,
    particles
  );

  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// -------------------------------------------------------------
// 8. Toggles & Track Controls
// -------------------------------------------------------------
waitToggle.addEventListener('change', () => {
  waitForNotes = waitToggle.checked;
  if (!waitForNotes && isWaitingForInput) {
    isWaitingForInput = false;
    currentWaitingNoteIds.clear();
    currentWaitingMidis.clear();
    if (isPlaying) {
      lastFrameTimestamp = performance.now();
      backingTrack.play(currentTransportTime);
    }
  }
});

fingerToggle.addEventListener('change', () => {
  showFingering = fingerToggle.checked;
  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels,
      currentWaitingNoteIds,
      showFingering,
      particles
    );
  }
});

foldToggle.addEventListener('change', () => {
  foldTo2Octaves = foldToggle.checked;
  rebuildCombinedNotes();
});

noteLabelToggle.addEventListener('change', () => {
  showNoteLabels = noteLabelToggle.checked;
  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels,
      currentWaitingNoteIds,
      showFingering,
      particles
    );
  }
});

keyLabelToggle.addEventListener('change', () => {
  visualizer.setShowLabels(keyLabelToggle.checked);
});

autoFitBtn.addEventListener('click', () => {
  if (!currentSong) return;

  currentSong.tracks.forEach((track) => {
    trackOctaveShifts.set(track.id, 0);
    const label = document.getElementById(`track-shift-${track.id}`);
    if (label) {
      label.innerText = '+0';
    }
  });

  rebuildCombinedNotes();
});

function setPlaybackSpeed(speed: number): void {
  playbackSpeed = Math.round(speed * 100) / 100;
  speedSlider.value = playbackSpeed.toString();
  speedLabel.innerText = `${playbackSpeed.toFixed(2)}×`;

  backingTrack.setPlaybackRate(playbackSpeed);

  presetButtons.forEach((btn) => {
    const btnSpeed = parseFloat(btn.dataset.speed || '1.0');
    btn.classList.toggle('active', Math.abs(btnSpeed - playbackSpeed) < 0.02);
  });
}

speedSlider.addEventListener('input', () => {
  setPlaybackSpeed(parseFloat(speedSlider.value));
});

presetButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setPlaybackSpeed(parseFloat(btn.dataset.speed || '1.0'));
  });
});

function updateSyncOffsetCalibration(): void {
  currentOffsetSeconds = coarseOffsetSec + fineOffsetMs / 1000;

  coarseVal.innerText = `${coarseOffsetSec > 0 ? '+' : ''}${coarseOffsetSec.toFixed(1)}s`;
  fineVal.innerText = `${fineOffsetMs > 0 ? '+' : ''}${fineOffsetMs}ms`;

  backingTrack.setOffsetMs(currentOffsetSeconds * 1000);

  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform, currentOffsetSeconds);
  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels,
      currentWaitingNoteIds,
      showFingering,
      particles
    );
  }
}

audioVolume.addEventListener('input', () => {
  const vol = parseFloat(audioVolume.value);
  volumeLabel.innerText = `${Math.round(vol * 100)}%`;
  backingTrack.setVolume(vol);
});

volumeResetBtn.addEventListener('click', () => {
  audioVolume.value = '0.8';
  volumeLabel.innerText = '80%';
  backingTrack.setVolume(0.8);
});

coarseSyncSlider.addEventListener('input', () => {
  coarseOffsetSec = parseFloat(coarseSyncSlider.value);
  updateSyncOffsetCalibration();
});

function resetCoarseSync(): void {
  coarseOffsetSec = 0;
  coarseSyncSlider.value = '0';
  updateSyncOffsetCalibration();
}

coarseResetBtn.addEventListener('click', resetCoarseSync);
coarseSyncSlider.addEventListener('dblclick', resetCoarseSync);

fineSyncSlider.addEventListener('input', () => {
  fineOffsetMs = parseInt(fineSyncSlider.value, 10);
  updateSyncOffsetCalibration();
});

function resetFineSync(): void {
  fineOffsetMs = 0;
  fineSyncSlider.value = '0';
  updateSyncOffsetCalibration();
}

fineResetBtn.addEventListener('click', resetFineSync);
fineSyncSlider.addEventListener('dblclick', resetFineSync);

// -------------------------------------------------------------
// 9. Backing Audio Ingestion
// -------------------------------------------------------------
audioInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  audioStatus.innerText = 'Decoding waveform...';
  audioStatus.style.color = '#eab308';

try {
  await backingTrack.loadFile(file);
  backingTrack.setPlaybackRate(playbackSpeed);
  currentWaveform = await extractWaveformData(file, 100);

  audioStatus.innerText = `Ready: ${file.name.slice(0, 18)}...`;
  audioStatus.style.color = '#38bdf8';

  updateSyncOffsetCalibration();
} catch (err) {
  console.error(err);
  audioStatus.innerText = 'Error loading audio file';
  audioStatus.style.color = '#ef4444';
}
});

// -------------------------------------------------------------
// 10. Hotkeys (Space, L)
// -------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  if (activeEl?.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'text') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!summaryModal.classList.contains('hidden')) {
      hardResetGameState(true);
      startPlayback();
    } else if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  } else if (e.code === 'KeyL') {
    e.preventDefault();
    toggleLoop();
  }
});

function formatTrackInfo(rawName: string, noteCount: number, isDrum: boolean) {
  const cleanName = rawName.replace(/\s+/g, ' ').trim();
  let title = cleanName;
  let subtitle = `${noteCount} notes`;

  if (cleanName.includes('|')) {
    const parts = cleanName.split('|').map((s) => s.trim());
    if (parts.length >= 3) {
      title = parts[2];
      subtitle = `${parts[0]} • ${parts[1]} • ${noteCount} notes`;
    } else if (parts.length === 2) {
      title = parts[1];
      subtitle = `${parts[0]} • ${noteCount} notes`;
    }
  } else if (cleanName.includes(' - ')) {
    const parts = cleanName.split(' - ').map((s) => s.trim());
    title = parts[1];
    subtitle = `${parts[0]} • ${noteCount} notes`;
  }

  if (isDrum) subtitle += ' (Drums)';
  return { title, subtitle };
}

// -------------------------------------------------------------
// 11. MIDI File Ingestion & Track Setup
// -------------------------------------------------------------
fileInput.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const buffer = await file.arrayBuffer();
  currentSong = parseMidiBuffer(buffer);

  currentBarLines = generateBarLines(
    currentSong.ppq,
    currentSong.duration,
    currentSong.tempos,
    currentSong.timeSignatures
  );

  minimap.setDuration(currentSong.duration);
  minimap.setBarLines(currentBarLines);
  minimap.resize();
  renderer.resize();

  loopState.start = currentBarLines[0]?.time ?? 0;
  loopState.end = currentBarLines[2]?.time ?? Math.min(8, currentSong.duration);
  loopState.enabled = false;

  selectedTrackIds.clear();
  trackOctaveShifts.clear();
  trackHandMap.clear();

  trackListEl.innerHTML = '';

  // Explicit index ensures track.id is a guaranteed unique number (0, 1, 2, ...)
currentSong.tracks.forEach((track, index) => {
  track.id = typeof track.id === 'number' ? track.id : index;
  trackOctaveShifts.set(track.id, 0);

  const nameLower = track.name.toLowerCase();
  const isBassTrack = nameLower.includes('bass') || nameLower.includes('left');
  const defaultHand: 'RH' | 'LH' = isBassTrack ? 'LH' : 'RH';
  trackHandMap.set(track.id, defaultHand);

  const color = TRACK_PALETTE[track.id % TRACK_PALETTE.length];
  const row = document.createElement('div');
  row.className = 'track-row';
  row.style.setProperty('--track-color', color);

  // Default: select only the first melodic track
  const isDefault = selectedTrackIds.size === 0 && !track.isDrum && track.notes.length > 0;
  if (isDefault) {
    selectedTrackIds.add(track.id);
    row.classList.add('active');
  }

  const dot = document.createElement('div');
  dot.className = 'track-dot';

  const icon = document.createElement('div');
  icon.className = 'track-icon';
  icon.innerHTML = getInstrumentIcon(track.name, track.isDrum, track.instrumentNumber);

  const { title, subtitle } = formatTrackInfo(track.name, track.notes.length, track.isDrum);
  const textContainer = document.createElement('div');
  textContainer.className = 'track-text';

  const titleEl = document.createElement('span');
  titleEl.className = 'track-title';
  titleEl.innerText = title;
  titleEl.title = track.name;

  const subEl = document.createElement('span');
  subEl.className = 'track-subtitle';
  subEl.innerText = subtitle;

  textContainer.appendChild(titleEl);
  textContainer.appendChild(subEl);

  // Toggling track triggers immediate state reset and benchmark recalibration
  row.addEventListener('click', () => {
    const isActive = selectedTrackIds.has(track.id);
    if (isActive) {
      selectedTrackIds.delete(track.id);
      row.classList.remove('active');
      console.log(`%c[TRACK TOGGLE] Disabled Track #${track.id} (${track.name})`, 'color: #ef4444;');
    } else {
      selectedTrackIds.add(track.id);
      row.classList.add('active');
      console.log(`%c[TRACK TOGGLE] Enabled Track #${track.id} (${track.name})`, 'color: #22c55e;');
    }
    rebuildCombinedNotes();
  });

  row.appendChild(dot);
  row.appendChild(icon);
  row.appendChild(textContainer);

  if (!track.isDrum) {
    const handBtn = document.createElement('button');
    handBtn.type = 'button';
    handBtn.className = `hand-toggle-btn ${defaultHand.toLowerCase()}`;
    handBtn.innerText = defaultHand;
    handBtn.title = `Toggle hand (Currently ${defaultHand === 'RH' ? 'Right Hand' : 'Left Hand'})`;

    handBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentHand = trackHandMap.get(track.id) ?? 'RH';
      const nextHand: 'RH' | 'LH' = currentHand === 'RH' ? 'LH' : 'RH';
      trackHandMap.set(track.id, nextHand);

      handBtn.innerText = nextHand;
      handBtn.className = `hand-toggle-btn ${nextHand.toLowerCase()}`;
      handBtn.title = `Toggle hand (Currently ${nextHand === 'RH' ? 'Right Hand' : 'Left Hand'})`;

      rebuildCombinedNotes();
    });

    const stepper = document.createElement('div');
    stepper.className = 'track-stepper';

    const downBtn = document.createElement('button');
    downBtn.className = 'stepper-btn';
    downBtn.innerText = '-';

    const shiftLabel = document.createElement('span');
    shiftLabel.id = `track-shift-${track.id}`;
    shiftLabel.className = 'stepper-val';
    shiftLabel.innerText = '+0';

    const upBtn = document.createElement('button');
    upBtn.className = 'stepper-btn';
    upBtn.innerText = '+';

downBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = trackOctaveShifts.get(track.id) ?? 0;
  const next = current - 12;
  trackOctaveShifts.set(track.id, next);
  shiftLabel.innerText = `${next > 0 ? '+' : ''}${next}`;
  console.log(`[OCTAVE SHIFT] Track #${track.id} shifted to ${next}`);
  rebuildCombinedNotes();
});

upBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = trackOctaveShifts.get(track.id) ?? 0;
  const next = current + 12;
  trackOctaveShifts.set(track.id, next);
  shiftLabel.innerText = `${next > 0 ? '+' : ''}${next}`;
  console.log(`[OCTAVE SHIFT] Track #${track.id} shifted to ${next}`);
  rebuildCombinedNotes();
});

stepper.appendChild(downBtn);
stepper.appendChild(shiftLabel);
stepper.appendChild(upBtn);

row.appendChild(handBtn);
row.appendChild(stepper);
  }

  trackListEl.appendChild(row);
});

playBtn.disabled = false;
stopBtn.disabled = false;
autoFitBtn.disabled = false;

updateLoopUI();
updateSyncOffsetCalibration();
rebuildCombinedNotes();
});

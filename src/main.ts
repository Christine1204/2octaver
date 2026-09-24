import './style.css';
import { parseMidiBuffer } from './midi/parser';
import { MidiInputManager } from './midi/input';
import { KeyboardVisualizer } from './components/keyboard';
import { NoteRenderer, type NoteWithMeta, type NoteOverlap } from './components/canvasRenderer';
import { TimelineMinimap, type LoopRegion } from './components/timeline';
import { generateBarLines, type BarLine } from './midi/conductor';
import { BackingTrackPlayer } from './audio/backingTrack';
import { extractWaveformData, type WaveformData } from './audio/waveform';
import { getInstrumentIcon } from './components/icons';
import type { ParsedSong } from './midi/types';

const TRACK_PALETTE = ['#38bdf8', '#a855f7', '#f97316', '#22c55e', '#f43f5e', '#eab308'];

// DOM Hooks
const fileInput = document.getElementById('midi-upload') as HTMLInputElement;
const audioInput = document.getElementById('audio-upload') as HTMLInputElement;
const audioStatus = document.getElementById('audio-status') as HTMLDivElement;
const audioVolume = document.getElementById('audio-volume') as HTMLInputElement;
const volumeLabel = document.getElementById('volume-label') as HTMLSpanElement;
const volumeResetBtn = document.getElementById('volume-reset-btn') as HTMLButtonElement;

// Dual Sync Delay Sliders & Default Buttons
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

// Toggles & Live Accuracy HUD
const waitToggle = document.getElementById('wait-toggle') as HTMLInputElement;
const foldToggle = document.getElementById('fold-toggle') as HTMLInputElement;
const noteLabelToggle = document.getElementById('note-label-toggle') as HTMLInputElement;
const keyLabelToggle = document.getElementById('key-label-toggle') as HTMLInputElement;
const pitchAccVal = document.getElementById('pitch-acc-val') as HTMLSpanElement;
const rhythmAccVal = document.getElementById('rhythm-acc-val') as HTMLSpanElement;

const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedLabel = document.getElementById('speed-label') as HTMLSpanElement;
const presetButtons = document.querySelectorAll<HTMLButtonElement>('.preset-btn');

// Engine Instances
const visualizer = new KeyboardVisualizer('keyboard-view');
const renderer = new NoteRenderer('note-canvas');
const minimap = new TimelineMinimap('timeline-canvas', 'timeline-playhead');
const midiInput = new MidiInputManager();
const backingTrack = new BackingTrackPlayer();

// App State
let currentSong: ParsedSong | null = null;
let currentBarLines: BarLine[] = [];
let currentWaveform: WaveformData | null = null;

let coarseOffsetSec = 0;
let fineOffsetMs = 0;
let currentOffsetSeconds = 0;

const selectedTrackIds = new Set<number>();
const trackOctaveShifts = new Map<number, number>();
let foldTo2Octaves = true;
let showNoteLabels = true;
let waitForNotes = false;

let combinedNotes: NoteWithMeta[] = [];
let detectedOverlaps: NoteOverlap[] = [];

// Physical pressed keys on MIDI keyboard
const physicalPressedKeys = new Set<number>();

// -------------------------------------------------------------
// STRIKE-TO-ADVANCE PRACTICE TOLERANCES
// -------------------------------------------------------------
const LATE_GRACE_WINDOW = 0.22; // 220ms late window before pausing
const EARLY_HIT_WINDOW = 0.35;  // 350ms early strike buffer

// Practice Mode State
const noteStruckMap = new Map<number, boolean>();
const currentWaitingNoteIds = new Set<number>();
const currentWaitingMidis = new Set<number>();
let isWaitingForInput = false;

// Live Session Accuracy State
interface NoteEvaluation {
  evaluated: boolean;
  hit: boolean;
  timingScore: number;
}
const noteEvalMap = new Map<number, NoteEvaluation>();
let sessionEvaluatedCount = 0;
let sessionHitCount = 0;
let sessionRhythmScoreSum = 0;

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

// 1. Accuracy Metric Engine
function resetSessionAccuracy(): void {
  noteEvalMap.clear();
  noteStruckMap.clear();
  currentWaitingNoteIds.clear();
  currentWaitingMidis.clear();
  sessionEvaluatedCount = 0;
  sessionHitCount = 0;
  sessionRhythmScoreSum = 0;
  pitchAccVal.innerText = '--%';
  rhythmAccVal.innerText = '--%';
}

function updateAccuracyHUD(): void {
  if (sessionEvaluatedCount === 0) {
    pitchAccVal.innerText = '--%';
    rhythmAccVal.innerText = '--%';
    return;
  }

  const pitchPct = Math.round((sessionHitCount / sessionEvaluatedCount) * 100);
  pitchAccVal.innerText = `${pitchPct}%`;

  if (sessionHitCount > 0) {
    const rhythmPct = Math.round(sessionRhythmScoreSum / sessionHitCount);
    rhythmAccVal.innerText = `${rhythmPct}%`;
  } else {
    rhythmAccVal.innerText = '0%';
  }
}

// 2. Hardware Input & Strike-to-Advance Resolver
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
    physicalPressedKeys.add(note);

    if (isPlaying) {
      const maxLateWindow = waitForNotes ? 0.70 : 0.20;

      // Check all notes sharing this pitch in the hit window
      for (const n of combinedNotes) {
        if (n.midi !== note || n.midi < 48 || n.midi > 72) continue;

        const timeDiff = currentTransportTime - n.time;
        const isEligible = timeDiff >= -EARLY_HIT_WINDOW && timeDiff <= maxLateWindow;

        if (isEligible && !noteStruckMap.get(n.id)) {
          // Permanently satisfy this note: never freezes again!
          noteStruckMap.set(n.id, true);

          // Clear from red waiting alert
          currentWaitingNoteIds.delete(n.id);
          currentWaitingMidis.delete(n.midi);

          // Accuracy scoring
          const absDelta = Math.abs(timeDiff);
          let timingScore = 100;
          if (absDelta <= 0.06) timingScore = 100;
          else if (absDelta <= 0.12) timingScore = 85;
          else if (absDelta <= 0.20) timingScore = 65;
          else timingScore = 45;

          const existing = noteEvalMap.get(n.id);
          if (!existing || !existing.evaluated) {
            sessionEvaluatedCount++;
            sessionHitCount++;
            sessionRhythmScoreSum += timingScore;
            noteEvalMap.set(n.id, { evaluated: true, hit: true, timingScore });
            updateAccuracyHUD();
          }
        }
      }

      // If user hit the note while paused waiting, resume immediately!
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

// 3. Pitch Class Folding
function foldPitchToRange(pitch: number, min = 48, max = 72): number {
  let folded = pitch;
  while (folded < min) folded += 12;
  while (folded > max) folded -= 12;
  return folded;
}

// 4. Overlap Hazard Detection
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

// 5. Multi-Track Combiner
function rebuildCombinedNotes(): void {
  if (!currentSong) {
    combinedNotes = [];
    detectedOverlaps = [];
    return;
  }

  const activeTracks = currentSong.tracks.filter((t) => selectedTrackIds.has(t.id));

  combinedNotes = activeTracks.flatMap((track) => {
    const color = TRACK_PALETTE[track.id % TRACK_PALETTE.length];
    const trackShift = trackOctaveShifts.get(track.id) ?? 0;

    return track.notes.map((n) => {
      let finalPitch = n.midi + trackShift;
      if (foldTo2Octaves && !track.isDrum) {
        finalPitch = foldPitchToRange(finalPitch, 48, 72);
      }
      return { ...n, midi: finalPitch, color };
    });
  });

  combinedNotes.sort((a, b) => a.time - b.time);
  detectedOverlaps = computeNoteOverlaps(combinedNotes);

  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform, currentOffsetSeconds);
  minimap.updateLoopMarkers(loopState);

  if (!isPlaying) {
    updateTargetCues(currentTransportTime);
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels,
      currentWaitingNoteIds
    );
  }
}


// 6. Target Cues & Red Waiting Key Indicators
function updateTargetCues(time: number): void {
  const activeTargets = new Map<number, string>();
  const leadIn = 0.04;

  for (const note of combinedNotes) {
    if (note.time > time + leadIn) break;
    // Keep target active for the full duration of the note
    const noteEnd = note.time + Math.max(note.duration, 0.25);
    if (time >= note.time - leadIn && time <= noteEnd) {
      activeTargets.set(note.midi, note.color || '#38bdf8');
    }
  }

  visualizer.setTargetNotes(activeTargets, currentWaitingMidis);
}

// 7. Loop Handlers
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

// 8. Practice Mode & Display Toggles
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
      currentWaitingNoteIds
    );
  }
});

keyLabelToggle.addEventListener('change', () => {
  visualizer.setShowLabels(keyLabelToggle.checked);
});

autoFitBtn.addEventListener('click', () => {
  if (!currentSong) return;

  currentSong.tracks.forEach((track) => {
    trackOctaveShifts.set(track.id, track.defaultOctaveShift);
    const label = document.getElementById(`track-shift-${track.id}`);
    if (label) {
      const sign = track.defaultOctaveShift > 0 ? '+' : '';
      label.innerText = `${sign}${track.defaultOctaveShift}`;
    }
  });

  rebuildCombinedNotes();
});

// 9. Speed Controls
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

// 10. Volume & Two-Tier Sync Delay Calibration
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
      currentWaitingNoteIds
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

// 11. Audio File Loading
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

// 12. Scrubbing & Seek
minimap.onSeek((targetTime) => {
  currentTransportTime = targetTime;
  backingTrack.seek(targetTime);
  resetSessionAccuracy();
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
      currentWaitingNoteIds
    );
  }
});

function seekTransport(time: number): void {
  currentTransportTime = time;
  backingTrack.seek(time);
  lastFrameTimestamp = performance.now();
  updateTargetCues(currentTransportTime);
}

// 13. Pure Strike-To-Advance Practice Engine
function renderLoop() {
  const now = performance.now();
  const dt = (now - lastFrameTimestamp) / 1000;
  lastFrameTimestamp = now;

  if (isPlaying) {
    // -------------------------------------------------------------
    // PURE STRIKE-TO-ADVANCE ENGINE (NO SUSTAIN TRAPS)
    // -------------------------------------------------------------
    if (waitForNotes) {
      let mustWait = false;
      let pausePoint = currentTransportTime;
      const playable = combinedNotes.filter((n) => n.midi >= 48 && n.midi <= 72);

      // Collect notes that have reached the hit line and need strikes
      const missingNotes: NoteWithMeta[] = [];

      for (const n of playable) {
        if (n.time > currentTransportTime + 0.01) break;

        if (!noteStruckMap.get(n.id)) {
          // If the player is ALREADY physically holding this key down, satisfy immediately!
          if (physicalPressedKeys.has(n.midi)) {
            noteStruckMap.set(n.id, true);
            continue;
          }

          // If still within late grace period, glide forward naturally
          if (n.time + LATE_GRACE_WINDOW > currentTransportTime) {
            continue;
          }

          // Exceeded grace window: player missed this strike!
          missingNotes.push(n);
          mustWait = true;
          pausePoint = n.time + LATE_GRACE_WINDOW;
        }
      }

      if (mustWait) {
        // Halt and populate RED waiting alerts on keys and blocks
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

    // Transport Clock Advance
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

    // Normal Mode Miss Evaluation
    if (!waitForNotes) {
      for (const n of combinedNotes) {
        if (n.midi < 48 || n.midi > 72) continue;
        if (n.time < currentTransportTime - 0.20) {
          const evalState = noteEvalMap.get(n.id);
          if (!evalState) {
            sessionEvaluatedCount++;
            noteEvalMap.set(n.id, { evaluated: true, hit: false, timingScore: 0 });
            updateAccuracyHUD();
          }
        } else {
          break;
        }
      }
    }

    // Loop Jump
    if (loopState.enabled && loopState.end > loopState.start) {
      if (currentTransportTime >= loopState.end) {
        seekTransport(loopState.start);
      }
    }

    updateTargetCues(currentTransportTime);
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels,
      currentWaitingNoteIds
    );
    minimap.setProgress(currentTransportTime);

    if (currentSong && currentTransportTime > currentSong.duration && !loopState.enabled) {
      stopPlayback();
    }
  }
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// 14. Playback Controls
function startPlayback() {
  if (combinedNotes.length === 0) return;
  isPlaying = true;
  isWaitingForInput = false;
  resetSessionAccuracy();

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
  resetSessionAccuracy();
}

function stopPlayback() {
  isPlaying = false;
  isWaitingForInput = false;
  currentTransportTime = loopState.enabled && loopState.end > loopState.start ? loopState.start : 0;
  backingTrack.stop();
  if (currentTransportTime > 0) backingTrack.seek(currentTransportTime);

  playBtn.innerText = 'Play (Space)';
  minimap.setProgress(currentTransportTime);
  visualizer.clearTargets();
  resetSessionAccuracy();

  renderer.draw(
    currentTransportTime,
    combinedNotes,
    currentBarLines,
    currentWaveform,
    currentOffsetSeconds,
    detectedOverlaps,
    showNoteLabels,
    currentWaitingNoteIds
  );
}

playBtn.addEventListener('click', () => (isPlaying ? pausePlayback() : startPlayback()));
stopBtn.addEventListener('click', stopPlayback);

// Hotkeys: Space (Play/Pause), L (Loop Toggle)
window.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  if (activeEl?.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'text') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (isPlaying) pausePlayback();
    else startPlayback();
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

// 15. MIDI File Ingestion
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

  trackListEl.innerHTML = '';
currentSong.tracks.forEach((track) => {
  trackOctaveShifts.set(track.id, track.defaultOctaveShift);

  const color = TRACK_PALETTE[track.id % TRACK_PALETTE.length];
  const row = document.createElement('div');
  row.className = 'track-row';
  row.style.setProperty('--track-color', color);

  const isDefault = selectedTrackIds.size === 0 && !track.isDrum;
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

  row.addEventListener('click', () => {
    const isActive = selectedTrackIds.has(track.id);
    if (isActive) {
      selectedTrackIds.delete(track.id);
      row.classList.remove('active');
    } else {
      selectedTrackIds.add(track.id);
      row.classList.add('active');
    }
    rebuildCombinedNotes();
  });

  row.appendChild(dot);
  row.appendChild(icon);
  row.appendChild(textContainer);

  if (!track.isDrum) {
    const stepper = document.createElement('div');
    stepper.className = 'track-stepper';

    const downBtn = document.createElement('button');
    downBtn.className = 'stepper-btn';
    downBtn.innerText = '-';

    const shiftVal = track.defaultOctaveShift;
    const sign = shiftVal > 0 ? '+' : '';
    const shiftLabel = document.createElement('span');
    shiftLabel.id = `track-shift-${track.id}`;
    shiftLabel.className = 'stepper-val';
    shiftLabel.innerText = `${sign}${shiftVal}`;

    const upBtn = document.createElement('button');
    upBtn.className = 'stepper-btn';
    upBtn.innerText = '+';

downBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = trackOctaveShifts.get(track.id) ?? 0;
  const next = current - 12;
  trackOctaveShifts.set(track.id, next);
  shiftLabel.innerText = `${next > 0 ? '+' : ''}${next}`;
  rebuildCombinedNotes();
});

upBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = trackOctaveShifts.get(track.id) ?? 0;
  const next = current + 12;
  trackOctaveShifts.set(track.id, next);
  shiftLabel.innerText = `${next > 0 ? '+' : ''}${next}`;
  rebuildCombinedNotes();
});

stepper.appendChild(downBtn);
stepper.appendChild(shiftLabel);
stepper.appendChild(upBtn);
row.appendChild(stepper);
  }

  trackListEl.appendChild(row);
});

playBtn.disabled = false;
stopBtn.disabled = false;
autoFitBtn.disabled = false;

updateLoopUI();
rebuildCombinedNotes();
stopPlayback();
});

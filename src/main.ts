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
const syncOffset = document.getElementById('sync-offset') as HTMLInputElement;
const offsetLabel = document.getElementById('offset-label') as HTMLSpanElement;

const trackListEl = document.getElementById('track-list') as HTMLDivElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const loopBtn = document.getElementById('loop-btn') as HTMLButtonElement;
const deviceInfo = document.getElementById('device-info') as HTMLDivElement;
const octDownBtn = document.getElementById('oct-down-btn') as HTMLButtonElement;
const octUpBtn = document.getElementById('oct-up-btn') as HTMLButtonElement;
const autoFitBtn = document.getElementById('auto-fit-btn') as HTMLButtonElement;
const transposeLabel = document.getElementById('transpose-label') as HTMLSpanElement;

// Toggles
const foldToggle = document.getElementById('fold-toggle') as HTMLInputElement;
const noteLabelToggle = document.getElementById('note-label-toggle') as HTMLInputElement;
const keyLabelToggle = document.getElementById('key-label-toggle') as HTMLInputElement;

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
let currentOffsetSeconds = 0;

const selectedTrackIds = new Set<number>();
const trackOctaveShifts = new Map<number, number>();
let globalTranspose = 0;
let foldTo2Octaves = true;
let showNoteLabels = true;

let combinedNotes: NoteWithMeta[] = [];
let detectedOverlaps: NoteOverlap[] = [];

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

// 1. Hardware Input
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
});

// 2. Pitch Class Folding
function foldPitchToRange(pitch: number, min = 48, max = 72): number {
  let folded = pitch;
  while (folded < min) folded += 12;
  while (folded > max) folded -= 12;
  return folded;
}

// 3. Multi-Track Overlap Calculator
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

// 4. Multi-Track Combiner
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
    const totalShift = trackShift + globalTranspose;

    return track.notes.map((n) => {
      let finalPitch = n.midi + totalShift;
      if (foldTo2Octaves && !track.isDrum) {
        finalPitch = foldPitchToRange(finalPitch, 48, 72);
      }
      return { ...n, midi: finalPitch, color };
    });
  });

  combinedNotes.sort((a, b) => a.time - b.time);
  detectedOverlaps = computeNoteOverlaps(combinedNotes);

  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform);
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
      showNoteLabels
    );
  }
}

// 5. Target Cues
function updateTargetCues(time: number): void {
  const activeTargets = new Map<number, string>();
  const leadIn = 0.03;

  for (const note of combinedNotes) {
    if (note.time > time + leadIn) break;
    if (time >= note.time - leadIn && time <= note.time + note.duration) {
      activeTargets.set(note.midi, note.color || '#38bdf8');
    }
  }

  visualizer.setTargetNotes(activeTargets);
}

// 6. Loop Mode Controls
function updateLoopUI(): void {
  loopBtn.classList.toggle('active', loopState.enabled);
  minimap.updateLoopMarkers(loopState);
  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform);
}

function toggleLoop(): void {
  loopState.enabled = !loopState.enabled;
  updateLoopUI();
}

loopBtn.addEventListener('click', toggleLoop);

// Double-clicking either Marker A or B toggles loop
minimap.onToggleLoop(() => {
  toggleLoop();
});

// Dragging Marker A or B only repositions boundaries without force-activating loop mode
minimap.onLoopChange((newA, newB) => {
  const songDur = currentSong?.duration || 100;

  if (newA >= 0) {
    loopState.start = Math.max(0, Math.min(newA, loopState.end - 0.2));
  }
  if (newB >= 0) {
    loopState.end = Math.min(songDur, Math.max(newB, loopState.start + 0.2));
  }

  minimap.updateLoopMarkers(loopState);
  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform);
});

// 7. Speed Controls
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

// 8. Transpose & Feature Toggles
function updateGlobalTranspose(shift: number): void {
  globalTranspose = shift;
  const sign = globalTranspose > 0 ? '+' : '';
  transposeLabel.innerText = `${sign}${globalTranspose} st`;
  rebuildCombinedNotes();
}

octDownBtn.addEventListener('click', () => updateGlobalTranspose(globalTranspose - 12));
octUpBtn.addEventListener('click', () => updateGlobalTranspose(globalTranspose + 12));

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
      showNoteLabels
    );
  }
});

keyLabelToggle.addEventListener('change', () => {
  visualizer.setShowLabels(keyLabelToggle.checked);
});

autoFitBtn.addEventListener('click', () => {
  if (!currentSong) return;
  globalTranspose = 0;
  transposeLabel.innerText = '+0 st';

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

// 9. Backing Track Handlers & Waveform Ingestion
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

  minimap.draw(combinedNotes, currentBarLines, loopState, currentWaveform);
  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels
    );
  }
} catch (err) {
  console.error(err);
  audioStatus.innerText = 'Error loading audio file';
  audioStatus.style.color = '#ef4444';
}
});

audioVolume.addEventListener('input', () => {
  backingTrack.setVolume(parseFloat(audioVolume.value));
});

syncOffset.addEventListener('input', () => {
  const ms = parseInt(syncOffset.value, 10);
  currentOffsetSeconds = ms / 1000;
  offsetLabel.innerText = `${ms > 0 ? '+' : ''}${ms}ms`;
  backingTrack.setOffsetMs(ms);

  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels
    );
  }
});

// 10. Scrubbing & Master Transport Loop
minimap.onSeek((targetTime) => {
  currentTransportTime = targetTime;
  backingTrack.seek(targetTime);
  updateTargetCues(currentTransportTime);

  if (!isPlaying) {
    renderer.draw(
      currentTransportTime,
      combinedNotes,
      currentBarLines,
      currentWaveform,
      currentOffsetSeconds,
      detectedOverlaps,
      showNoteLabels
    );
  }
});

function seekTransport(time: number): void {
  currentTransportTime = time;
  backingTrack.seek(time);
  lastFrameTimestamp = performance.now();
  updateTargetCues(currentTransportTime);
}

function renderLoop() {
  const now = performance.now();
  const dt = (now - lastFrameTimestamp) / 1000;
  lastFrameTimestamp = now;

  if (isPlaying) {
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
      showNoteLabels
    );
    minimap.setProgress(currentTransportTime);

    if (currentSong && currentTransportTime > currentSong.duration && !loopState.enabled) {
      stopPlayback();
    }
  }
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

function startPlayback() {
  if (combinedNotes.length === 0) return;
  isPlaying = true;

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
  backingTrack.pause();
  playBtn.innerText = 'Resume (Space)';
}

function stopPlayback() {
  isPlaying = false;
  currentTransportTime = loopState.enabled && loopState.end > loopState.start ? loopState.start : 0;
  backingTrack.stop();
  if (currentTransportTime > 0) backingTrack.seek(currentTransportTime);

  playBtn.innerText = 'Play (Space)';
  minimap.setProgress(currentTransportTime);
  visualizer.clearTargets();
  renderer.draw(
    currentTransportTime,
    combinedNotes,
    currentBarLines,
    currentWaveform,
    currentOffsetSeconds,
    detectedOverlaps,
    showNoteLabels
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

// 11. MIDI File Upload
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

  // Set default initial loop window snapped to measure 1 and measure 3
  loopState.start = currentBarLines[0]?.time ?? 0;
  loopState.end = currentBarLines[2]?.time ?? Math.min(8, currentSong.duration);
  loopState.enabled = false;

  selectedTrackIds.clear();
  trackOctaveShifts.clear();
  globalTranspose = 0;
  transposeLabel.innerText = '+0 st';

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

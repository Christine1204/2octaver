import './style.css';
import { parseMidiBuffer } from './midi/parser';
import { MidiInputManager } from './midi/input';
import { KeyboardVisualizer } from './components/keyboard';
import { NoteRenderer, type NoteWithMeta } from './components/canvasRenderer';
import { TimelineMinimap } from './components/timeline';
import { generateBarLines, type BarLine } from './midi/conductor';
import { BackingTrackPlayer } from './audio/backingTrack';
import { extractWaveformData, type WaveformData } from './audio/waveform';
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
const deviceInfo = document.getElementById('device-info') as HTMLDivElement;
const octDownBtn = document.getElementById('oct-down-btn') as HTMLButtonElement;
const octUpBtn = document.getElementById('oct-up-btn') as HTMLButtonElement;
const autoFitBtn = document.getElementById('auto-fit-btn') as HTMLButtonElement;
const transposeLabel = document.getElementById('transpose-label') as HTMLSpanElement;
const foldToggle = document.getElementById('fold-toggle') as HTMLInputElement;

// Speed Controls
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
let combinedNotes: NoteWithMeta[] = [];

// Delta-Time Transport State
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

// 3. Multi-Track Combiner
function rebuildCombinedNotes(): void {
  if (!currentSong) {
    combinedNotes = [];
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

  minimap.draw(combinedNotes, currentBarLines);
  if (!isPlaying) {
    updateTargetCues(currentTransportTime);
    renderer.draw(currentTransportTime, combinedNotes, currentBarLines, currentWaveform, currentOffsetSeconds);
  }
}

// 4. Hit Line Target Detection (Song Cues)
function updateTargetCues(time: number): void {
  const activeTargets = new Map<number, string>();

  // Tolerance window: note is crossing the bottom hit line
  const leadIn = 0.03; // 30ms early visual cue
  for (const note of combinedNotes) {
    if (note.time > time + leadIn) break; // Sorted by start time
    if (time >= note.time - leadIn && time <= note.time + note.duration) {
      activeTargets.set(note.midi, note.color || '#38bdf8');
    }
  }

  visualizer.setTargetNotes(activeTargets);
}

// 5. Speed Controls
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
    const target = parseFloat(btn.dataset.speed || '1.0');
    setPlaybackSpeed(target);
  });
});

// 6. Transpose Controls
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

autoFitBtn.addEventListener('click', () => {
  if (!currentSong) return;
  globalTranspose = 0;
  transposeLabel.innerText = '+0 st';

currentSong.tracks.forEach((track) => {
  trackOctaveShifts.set(track.id, track.defaultOctaveShift);
  const label = document.getElementById(`track-shift-${track.id}`);
  if (label) {
    const sign = track.defaultOctaveShift > 0 ? '+' : '';
    label.innerText = `${sign}${track.defaultOctaveShift} st`;
  }
});

rebuildCombinedNotes();
});

// 7. Backing Track & Waveform Loader
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

if (!isPlaying) {
  renderer.draw(currentTransportTime, combinedNotes, currentBarLines, currentWaveform, currentOffsetSeconds);
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
    renderer.draw(currentTransportTime, combinedNotes, currentBarLines, currentWaveform, currentOffsetSeconds);
  }
});

// 8. Scrubbing & Master Transport
minimap.onSeek((targetTime) => {
  currentTransportTime = targetTime;
  backingTrack.seek(targetTime);
  updateTargetCues(currentTransportTime);

  if (!isPlaying) {
    renderer.draw(currentTransportTime, combinedNotes, currentBarLines, currentWaveform, currentOffsetSeconds);
  }
});

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

    updateTargetCues(currentTransportTime);
    renderer.draw(currentTransportTime, combinedNotes, currentBarLines, currentWaveform, currentOffsetSeconds);
    minimap.setProgress(currentTransportTime);

    if (currentSong && currentTransportTime > currentSong.duration) {
      stopPlayback();
    }
  }
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

function startPlayback() {
  if (combinedNotes.length === 0) return;
  isPlaying = true;
  lastFrameTimestamp = performance.now();
  backingTrack.play(currentTransportTime);
  playBtn.innerText = 'Pause';
}

function pausePlayback() {
  if (!isPlaying) return;
  isPlaying = false;
  backingTrack.pause();
  playBtn.innerText = 'Resume';
}

function stopPlayback() {
  isPlaying = false;
  currentTransportTime = 0;
  backingTrack.stop();
  playBtn.innerText = 'Play';
  minimap.setProgress(0);
  visualizer.clearTargets();
  renderer.draw(0, combinedNotes, currentBarLines, currentWaveform, currentOffsetSeconds);
}

playBtn.addEventListener('click', () => (isPlaying ? pausePlayback() : startPlayback()));
stopBtn.addEventListener('click', stopPlayback);

// 9. MIDI File Upload
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
  minimap.resize();
  renderer.resize();

  selectedTrackIds.clear();
  trackOctaveShifts.clear();
  globalTranspose = 0;
  transposeLabel.innerText = '+0 st';

  trackListEl.innerHTML = '';
currentSong.tracks.forEach((track) => {
  trackOctaveShifts.set(track.id, track.defaultOctaveShift);

  const item = document.createElement('div');
  item.className = 'track-item';
  const color = TRACK_PALETTE[track.id % TRACK_PALETTE.length];
  item.style.borderLeftColor = color;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = track.id.toString();

  if (selectedTrackIds.size === 0 && !track.isDrum) {
    checkbox.checked = true;
    selectedTrackIds.add(track.id);
  }

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedTrackIds.add(track.id);
    else selectedTrackIds.delete(track.id);
    rebuildCombinedNotes();
  });

  const meta = document.createElement('div');
  meta.className = 'track-meta';
  meta.innerHTML = `<strong>${track.name}</strong><br><small>${track.notes.length} notes</small>`;

  const shiftBox = document.createElement('div');
  shiftBox.className = 'track-shift-controls';

  const downBtn = document.createElement('button');
  downBtn.className = 'track-shift-btn';
  downBtn.innerText = '-8va';

  const shiftVal = track.defaultOctaveShift;
  const sign = shiftVal > 0 ? '+' : '';
  const shiftLabel = document.createElement('span');
  shiftLabel.id = `track-shift-${track.id}`;
  shiftLabel.className = 'track-shift-label';
  shiftLabel.innerText = `${sign}${shiftVal} st`;

  const upBtn = document.createElement('button');
  upBtn.className = 'track-shift-btn';
  upBtn.innerText = '+8va';

downBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = trackOctaveShifts.get(track.id) ?? 0;
  const next = current - 12;
  trackOctaveShifts.set(track.id, next);
  shiftLabel.innerText = `${next > 0 ? '+' : ''}${next} st`;
  rebuildCombinedNotes();
});

upBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = trackOctaveShifts.get(track.id) ?? 0;
  const next = current + 12;
  trackOctaveShifts.set(track.id, next);
  shiftLabel.innerText = `${next > 0 ? '+' : ''}${next} st`;
  rebuildCombinedNotes();
});

shiftBox.appendChild(downBtn);
shiftBox.appendChild(shiftLabel);
shiftBox.appendChild(upBtn);

item.appendChild(checkbox);
item.appendChild(meta);
if (!track.isDrum) item.appendChild(shiftBox);
trackListEl.appendChild(item);
});

playBtn.disabled = false;
stopBtn.disabled = false;
autoFitBtn.disabled = false;

rebuildCombinedNotes();
stopPlayback();
});

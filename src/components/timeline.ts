import type { ParsedNote } from '../midi/types';
import type { BarLine } from '../midi/conductor';
import type { WaveformData } from '../audio/waveform';

export interface LoopRegion {
    start: number;
    end: number;
    enabled: boolean;
}

export class TimelineMinimap {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private playhead: HTMLElement;
    private markerA: HTMLElement;
    private markerB: HTMLElement;
    private duration = 1;
    private barLines: BarLine[] = [];

    private onSeekCallback?: (timeSeconds: number) => void;
    private onLoopChangeCallback?: (start: number, end: number) => void;
    private onToggleLoopCallback?: () => void;

    private readonly MIN_MIDI = 36;
    private readonly MAX_MIDI = 84;
    private readonly PLAYABLE_MIN = 48;
    private readonly PLAYABLE_MAX = 72;

    constructor(canvasId: string, playheadId: string) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        this.container = this.canvas.parentElement as HTMLElement;
        this.playhead = document.getElementById(playheadId) as HTMLElement;
        this.markerA = document.getElementById('loop-marker-a') as HTMLElement;
        this.markerB = document.getElementById('loop-marker-b') as HTMLElement;

        const context = this.canvas.getContext('2d');
        if (!context) throw new Error('Minimap 2D context failed');
        this.ctx = context;

        this.setupInteractions();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    public setDuration(duration: number): void {
        this.duration = Math.max(duration, 0.1);
    }

    public setBarLines(bars: BarLine[]): void {
        this.barLines = bars;
    }

    public onSeek(cb: (timeSeconds: number) => void): void {
        this.onSeekCallback = cb;
    }

    public onLoopChange(cb: (start: number, end: number) => void): void {
        this.onLoopChangeCallback = cb;
    }

    public onToggleLoop(cb: () => void): void {
        this.onToggleLoopCallback = cb;
    }

    public resize(): void {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);
    }

    public setProgress(currentTime: number): void {
        const progress = Math.min(Math.max(currentTime / this.duration, 0), 1);
        const rect = this.canvas.getBoundingClientRect();
        this.playhead.style.left = `${progress * rect.width}px`;
    }

    public updateLoopMarkers(loop: LoopRegion): void {
        const rect = this.canvas.getBoundingClientRect();
        const posA = (Math.max(0, loop.start) / this.duration) * rect.width;
        const posB = (Math.min(this.duration, loop.end) / this.duration) * rect.width;

        this.markerA.style.left = `${posA}px`;
        this.markerB.style.left = `${posB}px`;
        this.container.classList.toggle('loop-active', loop.enabled);
    }

    private snapToBar(time: number, pixelRadius = 14): { time: number; snapped: boolean } {
        if (this.barLines.length === 0) return { time, snapped: false };

        const rect = this.canvas.getBoundingClientRect();
        const targetPx = (time / this.duration) * rect.width;

        let closestTime = time;
        let minPxDistance = Infinity;

        for (const bar of this.barLines) {
            const barPx = (bar.time / this.duration) * rect.width;
            const dist = Math.abs(barPx - targetPx);
            if (dist < minPxDistance) {
                minPxDistance = dist;
                closestTime = bar.time;
            }
        }

        if (Math.abs(targetPx) < minPxDistance) {
            minPxDistance = Math.abs(targetPx);
            closestTime = 0;
        }

        if (minPxDistance <= pixelRadius) {
            return { time: closestTime, snapped: true };
        }

        return { time, snapped: false };
    }

    private midiToY(midi: number, height: number): number {
        const clamped = Math.max(this.MIN_MIDI, Math.min(midi, this.MAX_MIDI));
        const norm = (clamped - this.MIN_MIDI) / (this.MAX_MIDI - this.MIN_MIDI);
        return height - norm * height;
    }

    public draw(
        notes: (ParsedNote & { color?: string })[],
                barLines: BarLine[] = [],
                loop: LoopRegion | null = null,
                waveform: WaveformData | null = null,
                syncOffsetSeconds = 0
    ): void {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.ctx.clearRect(0, 0, rect.width, rect.height);

        // 1. Shaded Background & Octave Band
        const yC5 = this.midiToY(this.PLAYABLE_MAX, rect.height);
        const yC3 = this.midiToY(this.PLAYABLE_MIN, rect.height);

        this.ctx.fillStyle = '#050811';
        this.ctx.fillRect(0, 0, rect.width, rect.height);

        this.ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
        this.ctx.fillRect(0, yC5, rect.width, yC3 - yC5);

        // 2. Full Audio Waveform (Shifted by Sync Offset)
        if (waveform && waveform.peaks.length > 0) {
            const centerY = rect.height / 2;
            const maxHalfHeight = (rect.height / 2) * 0.88;
            const totalWidth = rect.width;
            const samples = waveform.peaks;
            const totalPeaks = samples.length;

            this.ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';

            for (let px = 0; px < totalWidth; px++) {
                const tStart = (px / totalWidth) * this.duration;
                const tEnd = ((px + 1) / totalWidth) * this.duration;

                // Shift audio sampling time by current offset
                const audioStart = tStart + syncOffsetSeconds;
                const audioEnd = tEnd + syncOffsetSeconds;

                const idxStart = Math.floor(audioStart * waveform.peaksPerSecond);
                const idxEnd = Math.ceil(audioEnd * waveform.peaksPerSecond);

                if (idxEnd <= 0 || idxStart >= totalPeaks) continue;

                let maxAmp = 0;
                const start = Math.max(0, idxStart);
                const end = Math.min(idxEnd, totalPeaks);

                for (let i = start; i < end; i++) {
                    if (samples[i] > maxAmp) maxAmp = samples[i];
                }

                const h = Math.max(maxAmp * maxHalfHeight, 1);
                this.ctx.fillRect(px, centerY - h, 1, h * 2);
            }
        }

        // 3. Measure Bar Grid Ticks
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        this.ctx.lineWidth = 1;
        for (const bar of barLines) {
            const x = (bar.time / this.duration) * rect.width;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, rect.height);
            this.ctx.stroke();
        }

        // 4. Octave Dividers
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.ctx.lineWidth = 1;
        this.ctx.font = '9px monospace';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';

        [48, 60, 72].forEach((midi) => {
            const y = Math.floor(this.midiToY(midi, rect.height));
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(rect.width, y);
            this.ctx.stroke();

            const label = midi === 48 ? 'C3' : midi === 60 ? 'C4' : 'C5';
            this.ctx.fillText(label, 6, y - 2);
        });

        // 5. MIDI Notes Overview
        for (const note of notes) {
            const x = (note.time / this.duration) * rect.width;
            const w = Math.max((note.duration / this.duration) * rect.width, 2);
            const y = this.midiToY(note.midi, rect.height);

            this.ctx.fillStyle = note.color || '#38bdf8';
            this.ctx.fillRect(x, Math.max(y - 1.5, 0), w, 3);
        }

        // 6. Active Loop Shading Region
        if (loop && loop.end > loop.start) {
            const xA = (loop.start / this.duration) * rect.width;
            const xB = (loop.end / this.duration) * rect.width;

            this.ctx.save();
            this.ctx.fillStyle = loop.enabled
            ? 'rgba(34, 197, 94, 0.22)'
            : 'rgba(148, 163, 184, 0.12)';
            this.ctx.fillRect(xA, 0, xB - xA, rect.height);

            this.ctx.strokeStyle = loop.enabled ? '#22c55e' : '#64748b';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(xA, 1);
            this.ctx.lineTo(xB, 1);
            this.ctx.moveTo(xA, rect.height - 1);
            this.ctx.lineTo(xB, rect.height - 1);
            this.ctx.stroke();

            this.ctx.restore();
        }
    }

    private setupInteractions(): void {
        let activeDrag: 'seek' | 'markerA' | 'markerB' | null = null;

        const handleSeek = (e: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const targetTime = (x / rect.width) * this.duration;
            this.setProgress(targetTime);
            this.onSeekCallback?.(targetTime);
        };

        const handleDragMarker = (e: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const rawTime = (x / rect.width) * this.duration;

            const shouldSnap = !e.shiftKey;
            const { time: finalTime, snapped } = shouldSnap
            ? this.snapToBar(rawTime)
            : { time: rawTime, snapped: false };

            if (activeDrag === 'markerA') {
                this.markerA.classList.toggle('snapped', snapped);
                this.onLoopChangeCallback?.(finalTime, -1);
            } else if (activeDrag === 'markerB') {
                this.markerB.classList.toggle('snapped', snapped);
                this.onLoopChangeCallback?.(-1, finalTime);
            }
        };

        this.markerA.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            activeDrag = 'markerA';
        });

        this.markerB.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            activeDrag = 'markerB';
        });

        this.markerA.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.onToggleLoopCallback?.();
        });

        this.markerB.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.onToggleLoopCallback?.();
        });

        this.container.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('.loop-slider-marker')) return;
            activeDrag = 'seek';
            handleSeek(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (activeDrag === 'seek') {
                handleSeek(e);
            } else if (activeDrag === 'markerA' || activeDrag === 'markerB') {
                handleDragMarker(e);
            }
        });

        window.addEventListener('mouseup', () => {
            if (activeDrag === 'markerA') this.markerA.classList.remove('snapped');
            if (activeDrag === 'markerB') this.markerB.classList.remove('snapped');
            activeDrag = null;
        });
    }
}

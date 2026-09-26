import type { NoteWithMeta } from './canvasRenderer';
import type { BarLine } from '../midi/conductor';
import type { WaveformData } from '../audio/waveform';

export interface LoopRegion {
    start: number;
    end: number;
    enabled: boolean;
}

export class TimelineMinimap {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private playheadEl: HTMLElement;
    private markerA: HTMLElement | null = null;
    private markerB: HTMLElement | null = null;

    private duration = 1;
    private barLines: BarLine[] = [];

    // State cache for automatic, lossless repaints on resize
    private cachedNotes: NoteWithMeta[] = [];
    private cachedBarLines: BarLine[] = [];
    private cachedLoop: LoopRegion = { start: 0, end: 8, enabled: false };
    private cachedWaveform: WaveformData | null = null;
    private cachedOffsetSeconds = 0;

    private onSeekCb: ((time: number) => void) | null = null;
    private onLoopChangeCb: ((start: number, end: number) => void) | null = null;
    private onToggleLoopCb: (() => void) | null = null;

    private isDragging = false;

    constructor(canvasId: string, playheadId: string) {
        const el = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!el) throw new Error(`Timeline canvas #${canvasId} not found`);
        this.canvas = el;

        const playhead = document.getElementById(playheadId);
        if (!playhead) throw new Error(`Playhead #${playheadId} not found`);
        this.playheadEl = playhead;

        this.markerA = document.getElementById('loop-marker-a');
        this.markerB = document.getElementById('loop-marker-b');

        const context = this.canvas.getContext('2d');
        if (!context) throw new Error('Could not acquire timeline 2D context');
        this.ctx = context;

        this.initEvents();

        // Auto-resize observer prevents the timeline from dropping render on layout changes
        const ro = new ResizeObserver(() => {
            this.resize();
        });
        ro.observe(this.canvas);
        window.addEventListener('resize', () => this.resize());
    }

    public setDuration(dur: number): void {
        this.duration = Math.max(0.1, dur);
    }

    public setBarLines(bars: BarLine[]): void {
        this.barLines = bars;
    }

    public resize(): void {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.canvas.width = Math.floor(rect.width * dpr);
        this.canvas.height = Math.floor(rect.height * dpr);
        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        // Immediate repaint ensures no blank canvas flash
        this.redraw();
    }

    public redraw(): void {
        if (this.cachedNotes.length > 0 || this.cachedWaveform !== null) {
            this.draw(
                this.cachedNotes,
                this.cachedBarLines,
                this.cachedLoop,
                this.cachedWaveform,
                this.cachedOffsetSeconds
            );
        }
    }

    public draw(
        notes: NoteWithMeta[],
        barLines: BarLine[],
        loop: LoopRegion,
        waveform: WaveformData | null = null,
        syncOffsetSeconds = 0
    ): void {
        // Cache arguments for window/layout resize events
        this.cachedNotes = notes;
        this.cachedBarLines = barLines;
        this.cachedLoop = loop;
        this.cachedWaveform = waveform;
        this.cachedOffsetSeconds = syncOffsetSeconds;

        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w === 0 || h === 0 || this.duration <= 0) return;

        this.ctx.clearRect(0, 0, w, h);

        // 1. Measure bar grid lines
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        this.ctx.lineWidth = 1;
        for (const bar of barLines) {
            const x = (bar.time / this.duration) * w;
            if (x >= 0 && x <= w) {
                this.ctx.beginPath();
                this.ctx.moveTo(x, 0);
                this.ctx.lineTo(x, h);
                this.ctx.stroke();
            }
        }

        // 2. Audio Waveform Background
        if (waveform && waveform.peaks.length > 0) {
            const centerY = h / 2;
            const maxAmp = h * 0.42;

            this.ctx.beginPath();
            for (let x = 0; x < w; x++) {
                const timeAtX = (x / w) * this.duration + syncOffsetSeconds;
                const peakIdx = Math.floor(timeAtX * waveform.peaksPerSecond);

                let amp = 0;
                if (peakIdx >= 0 && peakIdx < waveform.peaks.length) {
                    amp = waveform.peaks[peakIdx];
                }

                const y = centerY - amp * maxAmp;
                if (x === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }

            for (let x = w - 1; x >= 0; x--) {
                const timeAtX = (x / w) * this.duration + syncOffsetSeconds;
                const peakIdx = Math.floor(timeAtX * waveform.peaksPerSecond);

                let amp = 0;
                if (peakIdx >= 0 && peakIdx < waveform.peaks.length) {
                    amp = waveform.peaks[peakIdx];
                }

                const y = centerY + amp * maxAmp;
                this.ctx.lineTo(x, y);
            }

            this.ctx.closePath();
            this.ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
            this.ctx.fill();
        }

        // 3. Mini Note Rectangles
        for (const note of notes) {
            const x = (note.time / this.duration) * w;
            const noteW = Math.max(2, (note.duration / this.duration) * w);
            // Pitch mapped from 48 (C3) to 72 (C5)
            const pitchNorm = Math.max(0, Math.min(1, (note.midi - 48) / 24));
            const y = h - 4 - pitchNorm * (h - 8);

            this.ctx.fillStyle = note.color || '#38bdf8';
            this.ctx.fillRect(x, y, noteW, 2.5);
        }

        // 4. Shaded Loop Inactive Regions
        if (loop.enabled && loop.end > loop.start) {
            const xA = (loop.start / this.duration) * w;
            const xB = (loop.end / this.duration) * w;

            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            this.ctx.fillRect(0, 0, Math.max(0, xA), h);
            this.ctx.fillRect(xB, 0, Math.max(0, w - xB), h);

            this.ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
            this.ctx.fillRect(xA, 0, xB - xA, h);
        }
    }

    public setProgress(time: number): void {
        if (this.duration <= 0) return;
        const pct = Math.max(0, Math.min(1, time / this.duration)) * 100;
        this.playheadEl.style.left = `${pct}%`;
    }

    public updateLoopMarkers(loop: LoopRegion): void {
        if (this.duration <= 0) return;
        const pctA = Math.max(0, Math.min(1, loop.start / this.duration)) * 100;
        const pctB = Math.max(0, Math.min(1, loop.end / this.duration)) * 100;

        if (this.markerA) {
            this.markerA.style.left = `${pctA}%`;
            this.markerA.style.display = loop.enabled ? 'block' : 'none';
        }
        if (this.markerB) {
            this.markerB.style.left = `${pctB}%`;
            this.markerB.style.display = loop.enabled ? 'block' : 'none';
        }
    }

    public onSeek(cb: (t: number) => void): void {
        this.onSeekCb = cb;
    }
    public onLoopChange(cb: (s: number, e: number) => void): void {
        this.onLoopChangeCb = cb;
    }
    public onToggleLoop(cb: () => void): void {
        this.onToggleLoopCb = cb;
    }

    private initEvents(): void {
        const handleSeek = (e: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const targetTime = (x / rect.width) * this.duration;
            this.onSeekCb?.(targetTime);
        };

        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            handleSeek(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) handleSeek(e);
        });

            window.addEventListener('mouseup', () => {
                this.isDragging = false;
            });

            this.markerA?.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.onToggleLoopCb?.();
            });

            this.markerB?.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.onToggleLoopCb?.();
            });
    }
}

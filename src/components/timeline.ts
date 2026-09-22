import type { ParsedNote } from '../midi/types';
import type { BarLine } from '../midi/conductor';

export class TimelineMinimap {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private playhead: HTMLElement;
    private duration = 1;
    private onSeekCallback?: (timeSeconds: number) => void;

    private readonly MIN_MIDI = 36;
    private readonly MAX_MIDI = 84;
    private readonly PLAYABLE_MIN = 48;
    private readonly PLAYABLE_MAX = 72;

    constructor(canvasId: string, playheadId: string) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        this.playhead = document.getElementById(playheadId) as HTMLElement;
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error('Minimap 2D context failed');
        this.ctx = context;

        this.setupEvents();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    public setDuration(duration: number): void {
        this.duration = Math.max(duration, 0.1);
    }

    public onSeek(cb: (timeSeconds: number) => void): void {
        this.onSeekCallback = cb;
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

    private midiToY(midi: number, height: number): number {
        const clamped = Math.max(this.MIN_MIDI, Math.min(midi, this.MAX_MIDI));
        const norm = (clamped - this.MIN_MIDI) / (this.MAX_MIDI - this.MIN_MIDI);
        return height - norm * height;
    }

    public draw(notes: (ParsedNote & { color?: string })[], barLines: BarLine[] = []): void {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.ctx.clearRect(0, 0, rect.width, rect.height);

        // 1. Octave Zones
        const yC5 = this.midiToY(this.PLAYABLE_MAX, rect.height);
        const yC3 = this.midiToY(this.PLAYABLE_MIN, rect.height);

        this.ctx.fillStyle = '#050811';
        this.ctx.fillRect(0, 0, rect.width, rect.height);

        this.ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        this.ctx.fillRect(0, yC5, rect.width, yC3 - yC5);

        // 2. Measure Grid Markers (Vertical Ticks)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        this.ctx.lineWidth = 1;
        for (const bar of barLines) {
            const x = (bar.time / this.duration) * rect.width;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, rect.height);
            this.ctx.stroke();
        }

        // 3. Octave Lines
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
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

        // 4. Notes
        for (const note of notes) {
            const x = (note.time / this.duration) * rect.width;
            const w = Math.max((note.duration / this.duration) * rect.width, 2);
            const y = this.midiToY(note.midi, rect.height);

            this.ctx.fillStyle = note.color || '#38bdf8';
            this.ctx.fillRect(x, Math.max(y - 1.5, 0), w, 3);
        }
    }

    private setupEvents(): void {
        const handleScrub = (e: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const targetTime = (x / rect.width) * this.duration;
            this.setProgress(targetTime);
            this.onSeekCallback?.(targetTime);
        };

        let isDragging = false;
        this.canvas.parentElement?.addEventListener('mousedown', (e) => {
            isDragging = true;
            handleScrub(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) handleScrub(e);
        });

            window.addEventListener('mouseup', () => {
                isDragging = false;
            });
    }
}

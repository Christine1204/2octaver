import type { ParsedNote } from '../midi/types';
import type { BarLine } from '../midi/conductor';
import type { WaveformData } from '../audio/waveform';

export type NoteWithMeta = ParsedNote & { color?: string };

export interface NoteOverlap {
    midi: number;
    time: number;
    duration: number;
    baseColor: string;
    stripeColor: string;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class NoteRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private startNote = 36;     // C2
    private numKeys = 49;       // C2 to C6
    private playableStart = 48; // C3
    private playableEnd = 72;   // C5
    private pixelsPerSecond = 200;

    // Visual breathing room above the physical keyboard border
    private readonly hitLineBuffer = 8;

    constructor(canvasId: string) {
        const el = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!el) throw new Error(`Canvas #${canvasId} not found`);
        this.canvas = el;
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error('Could not acquire 2D context');
        this.ctx = context;

        this.resize();
        window.addEventListener('resize', () => this.resize());
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

    public getNoteGeometry(midiPitch: number): { x: number; width: number } | null {
        const index = midiPitch - this.startNote;
        if (index < 0 || index >= this.numKeys) return null;

        const rect = this.canvas.getBoundingClientRect();
        const totalWhiteKeys = 29;
        const whiteKeyWidth = rect.width / totalWhiteKeys;
        const blackKeyWidth = whiteKeyWidth * 0.62;

        let whiteKeysBefore = 0;
        for (let n = this.startNote; n < midiPitch; n++) {
            if (![1, 3, 6, 8, 10].includes(n % 12)) whiteKeysBefore++;
        }

        const isBlack = [1, 3, 6, 8, 10].includes(midiPitch % 12);
        return isBlack
        ? { x: whiteKeysBefore * whiteKeyWidth - blackKeyWidth / 2, width: blackKeyWidth }
        : { x: whiteKeysBefore * whiteKeyWidth, width: whiteKeyWidth };
    }

    public draw(
        currentTime: number,
        notes: NoteWithMeta[],
        barLines: BarLine[] = [],
        waveform: WaveformData | null = null,
        syncOffsetSeconds = 0,
        overlaps: NoteOverlap[] = [],
        showNoteLabels = true
    ): void {
        const rect = this.canvas.getBoundingClientRect();
        const hitLineY = rect.height - this.hitLineBuffer;

        this.ctx.clearRect(0, 0, rect.width, rect.height);

        const totalWhiteKeys = 29;
        const whiteKeyWidth = rect.width / totalWhiteKeys;
        const leftInactiveWidth = 7 * whiteKeyWidth;
        const activeWidth = 15 * whiteKeyWidth;
        const rightInactiveX = leftInactiveWidth + activeWidth;
        const rightInactiveWidth = rect.width - rightInactiveX;

        // 1. Shaded Out-Of-Bounds Margins
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.fillRect(0, 0, leftInactiveWidth, rect.height);
        this.ctx.fillRect(rightInactiveX, 0, rightInactiveWidth, rect.height);

        this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(leftInactiveWidth, 0);
        this.ctx.lineTo(leftInactiveWidth, rect.height);
        this.ctx.moveTo(rightInactiveX, 0);
        this.ctx.lineTo(rightInactiveX, rect.height);
        this.ctx.stroke();

        const visibleTimeWindow = hitLineY / this.pixelsPerSecond;

        // 2. Vertical Waveform Monitor
        if (waveform && waveform.peaks.length > 0) {
            const centerX = rightInactiveX + rightInactiveWidth / 2;
            const maxHalfWidth = (rightInactiveWidth / 2) * 0.85;

            this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(centerX, 0);
            this.ctx.lineTo(centerX, rect.height);
            this.ctx.stroke();

            const timeStart = currentTime - 0.2;
            const timeEnd = currentTime + visibleTimeWindow + 0.2;
            const stepTime = 1 / waveform.peaksPerSecond;

            const leftPath: { x: number; y: number }[] = [];
            const rightPath: { x: number; y: number }[] = [];

            for (let t = timeStart; t <= timeEnd; t += stepTime) {
                const audioTime = t + syncOffsetSeconds;
                const peakIndex = Math.floor(audioTime * waveform.peaksPerSecond);

                let amp = 0;
                if (peakIndex >= 0 && peakIndex < waveform.peaks.length) {
                    amp = waveform.peaks[peakIndex];
                }

                const y = hitLineY - (t - currentTime) * this.pixelsPerSecond;
                const halfW = amp * maxHalfWidth;

                leftPath.push({ x: centerX - halfW, y });
                rightPath.push({ x: centerX + halfW, y });
            }

            if (leftPath.length > 1) {
                this.ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
                this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
                this.ctx.lineWidth = 1;

                this.ctx.beginPath();
                this.ctx.moveTo(leftPath[0].x, leftPath[0].y);
                for (let i = 1; i < leftPath.length; i++) this.ctx.lineTo(leftPath[i].x, leftPath[i].y);
                for (let i = rightPath.length - 1; i >= 0; i--) this.ctx.lineTo(rightPath[i].x, rightPath[i].y);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }
        }

        // 3. Conductor Bar Lines
        for (const bar of barLines) {
            const timeUntilHit = bar.time - currentTime;
            if (timeUntilHit < -0.1 || timeUntilHit > visibleTimeWindow) continue;

            const y = hitLineY - timeUntilHit * this.pixelsPerSecond;

            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(rect.width, y);
            this.ctx.stroke();

            this.ctx.font = '10px monospace';
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            this.ctx.fillText(`m.${bar.measureNumber} (${bar.timeSignature})`, 8, y - 4);
        }

        // 4. Falling Notes
        for (const note of notes) {
            const timeUntilHit = note.time - currentTime;
            if (timeUntilHit + note.duration < 0) continue;
            if (timeUntilHit > visibleTimeWindow) continue;

            const geom = this.getNoteGeometry(note.midi);
            if (!geom) continue;

            const noteHeight = Math.max(note.duration * this.pixelsPerSecond, 8);
            const noteY = hitLineY - timeUntilHit * this.pixelsPerSecond - noteHeight;
            const x = geom.x + 1.5;
            const w = geom.width - 3;

            const isPlayable = note.midi >= this.playableStart && note.midi <= this.playableEnd;
            const baseColor = note.color || '#38bdf8';

            this.ctx.save();
            this.ctx.beginPath();
            if ((this.ctx as any).roundRect) {
                (this.ctx as any).roundRect(x, noteY, w, noteHeight, [4, 4, 2, 2]);
            } else {
                this.ctx.rect(x, noteY, w, noteHeight);
            }

            this.ctx.fillStyle = isPlayable ? baseColor : 'rgba(100, 116, 139, 0.4)';
            this.ctx.fill();

            // Top gloss highlight
            if (isPlayable && noteHeight > 10) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
                this.ctx.fillRect(x + 1, noteY + 1, w - 2, 3);
            }

            // Crisp border
            this.ctx.strokeStyle = isPlayable ? '#ffffff' : 'rgba(255, 255, 255, 0.35)';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
            this.ctx.restore();
        }

        // 5. Candy-Stripe Overlaps
        for (const ov of overlaps) {
            const timeUntilHit = ov.time - currentTime;
            if (timeUntilHit + ov.duration < 0) continue;
            if (timeUntilHit > visibleTimeWindow) continue;

            const geom = this.getNoteGeometry(ov.midi);
            if (!geom) continue;

            const h = Math.max(ov.duration * this.pixelsPerSecond, 6);
            const y = hitLineY - timeUntilHit * this.pixelsPerSecond - h;
            const x = geom.x + 1.5;
            const w = geom.width - 3;

            this.ctx.save();
            this.ctx.beginPath();
            if ((this.ctx as any).roundRect) {
                (this.ctx as any).roundRect(x, y, w, h, [3, 3, 2, 2]);
            } else {
                this.ctx.rect(x, y, w, h);
            }
            this.ctx.clip();

            this.ctx.fillStyle = ov.baseColor;
            this.ctx.fill();

            this.ctx.strokeStyle = ov.stripeColor;
            this.ctx.lineWidth = 4;
            const step = 8;
            for (let offset = -h - w; offset < w + h; offset += step) {
                this.ctx.beginPath();
                this.ctx.moveTo(x + offset, y);
                this.ctx.lineTo(x + offset + h, y + h);
                this.ctx.stroke();
            }

            this.ctx.restore();

            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 1.5;
            this.ctx.strokeRect(x, y, w, h);
        }

        // 6. High-Contrast Note Pitch Badges
        if (showNoteLabels) {
            this.ctx.save();
            this.ctx.font = 'bold 10px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            for (const note of notes) {
                const timeUntilHit = note.time - currentTime;
                if (timeUntilHit + note.duration < 0 || timeUntilHit > visibleTimeWindow) continue;

                const geom = this.getNoteGeometry(note.midi);
                if (!geom) continue;

                const isPlayable = note.midi >= this.playableStart && note.midi <= this.playableEnd;
                if (!isPlayable) continue;

                const noteHeight = Math.max(note.duration * this.pixelsPerSecond, 8);
                const noteY = hitLineY - timeUntilHit * this.pixelsPerSecond - noteHeight;
                const x = geom.x + 1.5;
                const w = geom.width - 3;

                const noteName = NOTE_NAMES[note.midi % 12];
                const textX = Math.floor(x + w / 2);
                const textY = Math.floor(noteY + Math.max(noteHeight - 9, noteHeight / 2));

                const pillWidth = Math.min(w - 2, 22);
                const pillHeight = 13;
                const pillX = textX - pillWidth / 2;
                const pillY = textY - pillHeight / 2;

                this.ctx.fillStyle = 'rgba(6, 10, 18, 0.88)';
                this.ctx.beginPath();
                if ((this.ctx as any).roundRect) {
                    (this.ctx as any).roundRect(pillX, pillY, pillWidth, pillHeight, 3);
                } else {
                    this.ctx.rect(pillX, pillY, pillWidth, pillHeight);
                }
                this.ctx.fill();

                this.ctx.fillStyle = '#ffffff';
                this.ctx.fillText(noteName, textX, textY);
            }
            this.ctx.restore();
        }

        // 7. Hit-Line Threshold with Buffer Clearance
        // Subtle runway shadow in the buffer zone
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.fillRect(0, hitLineY, rect.width, this.hitLineBuffer);

        // Strike beam across active 2 octaves
        this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(0, hitLineY);
        this.ctx.lineTo(leftInactiveWidth, hitLineY);
        this.ctx.moveTo(rightInactiveX, hitLineY);
        this.ctx.lineTo(rect.width, hitLineY);
        this.ctx.stroke();

        this.ctx.strokeStyle = '#38bdf8';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(leftInactiveWidth, hitLineY);
        this.ctx.lineTo(rightInactiveX, hitLineY);
        this.ctx.stroke();
    }
}

export class BackingTrackPlayer {
    private ctx: AudioContext | null = null;
    private audioBuffer: AudioBuffer | null = null;
    private sourceNode: AudioBufferSourceNode | null = null;
    private masterGain: GainNode | null = null;

    // Audible Musical Sweetener Chain
    private lowpassNode: BiquadFilterNode | null = null;
    private lowShelfNode: BiquadFilterNode | null = null;
    private highShelfNode: BiquadFilterNode | null = null;

    // Stereo Spatial Expansion (Haas effect)
    private mergerNode: ChannelMergerNode | null = null;
    private splitterNode: ChannelSplitterNode | null = null;
    private leftDelayNode: DelayNode | null = null;
    private rightDelayNode: DelayNode | null = null;
    private wetStereoGain: GainNode | null = null;
    private dryStereoGain: GainNode | null = null;

    private isPlaying = false;
    private startTime = 0;
    private pausedAt = 0;
    private playbackRate = 1.0;
    private syncOffsetMs = 0;
    private volume = 0.8;

    constructor() {}

    private initContext(): void {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            this.ctx = new AudioCtx();

            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

            // 1. Dynamic Tone Cutoff (Base: 4,200 Hz - warm & vintage, NOT muffled)
            this.lowpassNode = this.ctx.createBiquadFilter();
            this.lowpassNode.type = 'lowpass';
            this.lowpassNode.frequency.setValueAtTime(4200, this.ctx.currentTime);
            this.lowpassNode.Q.setValueAtTime(0.65, this.ctx.currentTime);

            // 2. Sub-Bass Punch (0 dB baseline -> +3.5 dB chest thump at 5.0X)
            this.lowShelfNode = this.ctx.createBiquadFilter();
            this.lowShelfNode.type = 'lowshelf';
            this.lowShelfNode.frequency.setValueAtTime(90, this.ctx.currentTime);
            this.lowShelfNode.gain.setValueAtTime(0, this.ctx.currentTime);

            // 3. High Presence & Bite (-3.5 dB neutral -> +2.5 dB sparkle at 5.0X)
            this.highShelfNode = this.ctx.createBiquadFilter();
            this.highShelfNode.type = 'highshelf';
            this.highShelfNode.frequency.setValueAtTime(6500, this.ctx.currentTime);
            this.highShelfNode.gain.setValueAtTime(-3.5, this.ctx.currentTime);

            // 4. Stereo Widening Network
            this.splitterNode = this.ctx.createChannelSplitter(2);
            this.mergerNode = this.ctx.createChannelMerger(2);
            this.leftDelayNode = this.ctx.createDelay();
            this.rightDelayNode = this.ctx.createDelay();
            this.wetStereoGain = this.ctx.createGain();
            this.dryStereoGain = this.ctx.createGain();

            this.leftDelayNode.delayTime.value = 0.0;
            this.rightDelayNode.delayTime.value = 0.012; // 12ms delay creates distinct stereo separation

            this.dryStereoGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
            this.wetStereoGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

            // Routing: source -> lowpass -> lowShelf -> highShelf
            this.lowpassNode.connect(this.lowShelfNode);
            this.lowShelfNode.connect(this.highShelfNode);

            // Dry path direct to master
            this.highShelfNode.connect(this.dryStereoGain);
            this.dryStereoGain.connect(this.masterGain);

            // Wet Haas stereo path to master
            this.highShelfNode.connect(this.splitterNode);
            this.splitterNode.connect(this.leftDelayNode, 0);
            this.splitterNode.connect(this.rightDelayNode, 1);
            this.leftDelayNode.connect(this.mergerNode, 0, 0);
            this.rightDelayNode.connect(this.mergerNode, 0, 1);
            this.mergerNode.connect(this.wetStereoGain);
            this.wetStereoGain.connect(this.masterGain);

            this.masterGain.connect(this.ctx.destination);
        }
    }

    /**
     * Sweeps tone, sub-bass, air presence, and stereo width as multiplier builds (1.0X -> 5.0X)
     */
    public updatePerformanceFilter(multiplier: number): void {
        if (!this.ctx || !this.lowpassNode || !this.lowShelfNode || !this.highShelfNode) return;

        const t = this.ctx.currentTime;
        const clampedMult = Math.max(1.0, Math.min(5.0, multiplier));
        const norm = (clampedMult - 1.0) / 4.0; // 0.0 at 1.0X, 1.0 at 5.0X

        // 1. Cutoff: 4,200 Hz (warm/vintage) -> 20,000 Hz (full sheen & transients)
        const targetCutoff = 4200 * Math.pow(20000 / 4200, norm);
        this.lowpassNode.frequency.setTargetAtTime(targetCutoff, t, 0.08);

        // 2. Sub-Bass Shelf: 0 dB -> +3.5 dB (clean low-end thump)
        const targetBass = norm * 3.5;
        this.lowShelfNode.gain.setTargetAtTime(targetBass, t, 0.08);

        // 3. High-End Sparkle: -3.5 dB -> +2.5 dB
        const targetAir = -3.5 + norm * 6.0;
        this.highShelfNode.gain.setTargetAtTime(targetAir, t, 0.08);

        // 4. Stereo Width: 0% wet -> 32% wide room expansion
        if (this.wetStereoGain && this.dryStereoGain) {
            const wetAmount = norm * 0.32;
            this.wetStereoGain.gain.setTargetAtTime(wetAmount, t, 0.09);
            this.dryStereoGain.gain.setTargetAtTime(1.0, t, 0.09);
        }
    }

    public triggerComboBreakImpact(): void {
        // Smooth transition, no annoying tape dropouts
    }

    public async loadFile(file: File): Promise<void> {
        this.initContext();
        const arrayBuffer = await file.arrayBuffer();
        this.audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
    }

    public play(fromTimeSeconds = 0): void {
        this.initContext();
        if (!this.audioBuffer || !this.ctx) return;

        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.stopSource();

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.playbackRate.setValueAtTime(this.playbackRate, this.ctx.currentTime);

        this.sourceNode.connect(this.lowpassNode!);

        const offsetSeconds = fromTimeSeconds + this.syncOffsetMs / 1000;
        const safeOffset = Math.max(0, Math.min(offsetSeconds, this.audioBuffer.duration));

        this.sourceNode.start(0, safeOffset);
        this.startTime = this.ctx.currentTime - safeOffset / this.playbackRate;
        this.isPlaying = true;
    }

    public pause(): void {
        if (!this.isPlaying) return;
        this.pausedAt = this.getCurrentTime() ?? 0;
        this.stopSource();
        this.isPlaying = false;
    }

    public stop(): void {
        this.stopSource();
        this.pausedAt = 0;
        this.isPlaying = false;
        this.updatePerformanceFilter(1.0);
    }

    public seek(toSeconds: number): void {
        this.pausedAt = toSeconds;
        if (this.isPlaying) {
            this.play(toSeconds);
        }
    }

    private stopSource(): void {
        if (this.sourceNode) {
            try {
                this.sourceNode.stop();
                this.sourceNode.disconnect();
            } catch {}
            this.sourceNode = null;
        }
    }

    public getCurrentTime(): number | null {
        if (!this.isPlaying || !this.ctx) return null;
        return (this.ctx.currentTime - this.startTime) * this.playbackRate;
    }

    public setVolume(vol: number): void {
        this.volume = vol;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(vol, this.ctx.currentTime);
        }
    }

    public setPlaybackRate(rate: number): void {
        this.playbackRate = rate;
        if (this.sourceNode && this.ctx) {
            this.sourceNode.playbackRate.setValueAtTime(rate, this.ctx.currentTime);
        }
    }

    public setOffsetMs(ms: number): void {
        this.syncOffsetMs = ms;
    }

    public hasTrack(): boolean {
        return this.audioBuffer !== null;
    }
}

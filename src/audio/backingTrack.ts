export class BackingTrackPlayer {
    private audio: HTMLAudioElement;
    private offsetMs = 0;
    private isReady = false;
    private currentRate = 1.0;

    constructor() {
        this.audio = new Audio();
        this.audio.preload = 'auto';

        // Enable high-quality browser-native WSOLA time-stretching
        this.audio.preservesPitch = true;
        (this.audio as any).mozPreservesPitch = true;
        (this.audio as any).webkitPreservesPitch = true;
    }

    public loadFile(file: File): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            this.audio.src = url;
            this.audio.playbackRate = this.currentRate;
            this.audio.oncanplaythrough = () => {
                this.isReady = true;
                resolve();
            };
            this.audio.onerror = () => reject(new Error('Failed to load audio backing track.'));
        });
    }

    public setPlaybackRate(rate: number): void {
        this.currentRate = Math.max(0.2, Math.min(rate, 2.0));
        this.audio.playbackRate = this.currentRate;
    }

    public getPlaybackRate(): number {
        return this.currentRate;
    }

    public play(startTimeSeconds: number): void {
        if (!this.isReady) return;
        const target = Math.max(0, startTimeSeconds + this.offsetMs / 1000);
        this.audio.currentTime = target;
        this.audio.playbackRate = this.currentRate;
        this.audio.play().catch(console.error);
    }

    public pause(): void {
        if (!this.isReady) return;
        this.audio.pause();
    }

    public stop(): void {
        if (!this.isReady) return;
        this.audio.pause();
        this.audio.currentTime = Math.max(0, this.offsetMs / 1000);
    }

    public seek(timeSeconds: number): void {
        if (!this.isReady) return;
        this.audio.currentTime = Math.max(0, timeSeconds + this.offsetMs / 1000);
    }

    public getCurrentTime(): number | null {
        if (!this.isReady || this.audio.paused) return null;
        return Math.max(0, this.audio.currentTime - this.offsetMs / 1000);
    }

    public setVolume(volume: number): void {
        this.audio.volume = Math.max(0, Math.min(volume, 1));
    }

    public setOffsetMs(offset: number): void {
        this.offsetMs = offset;
    }

    public hasTrack(): boolean {
        return this.isReady;
    }
}

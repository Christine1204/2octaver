const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class KeyboardVisualizer {
    private container: HTMLElement;
    private startNote = 36;       // C2
    private numKeys = 49;         // C2 through C6
    private playableStart = 48;   // C3
    private playableEnd = 72;     // C5

    private userActiveNotes = new Set<number>();
    private currentTargets = new Map<number, string>();
    private currentWaiting = new Set<number>();
    private showLabels = true;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Element #${containerId} not found`);
        this.container = el;
        this.render();
    }

    public setUserNoteState(note: number, isPressed: boolean): void {
        if (isPressed) {
            this.userActiveNotes.add(note);
        } else {
            this.userActiveNotes.delete(note);
        }

        const keyEl = this.container.querySelector(`[data-note="${note}"]`);
        if (keyEl) {
            keyEl.classList.toggle('user-active', isPressed);
        }
    }

    public setTargetNotes(newTargets: Map<number, string>, waitingMidis: Set<number> = new Set()): void {
        // Clear old targets
        for (const [note] of this.currentTargets) {
            if (!newTargets.has(note)) {
                const keyEl = this.container.querySelector(`[data-note="${note}"]`) as HTMLElement | null;
                if (keyEl) {
                    keyEl.classList.remove('target-active', 'waiting-active');
                    keyEl.style.removeProperty('--cue-color');
                }
            }
        }

        // Apply new targets
        for (const [note, color] of newTargets) {
            const keyEl = this.container.querySelector(`[data-note="${note}"]`) as HTMLElement | null;
            if (keyEl) {
                keyEl.classList.add('target-active');
                keyEl.style.setProperty('--cue-color', color);
            }
        }

        // Apply or remove pulsing red alert for waiting notes
        for (let note = this.startNote; note < this.startNote + this.numKeys; note++) {
            const isWaiting = waitingMidis.has(note);
            const wasWaiting = this.currentWaiting.has(note);
            if (isWaiting !== wasWaiting) {
                const keyEl = this.container.querySelector(`[data-note="${note}"]`) as HTMLElement | null;
                if (keyEl) {
                    keyEl.classList.toggle('waiting-active', isWaiting);
                }
            }
        }

        this.currentTargets = new Map(newTargets);
        this.currentWaiting = new Set(waitingMidis);
    }

    public clearTargets(): void {
        this.setTargetNotes(new Map(), new Set());
    }

    public setShowLabels(enabled: boolean): void {
        this.showLabels = enabled;
        const wrapper = this.container.querySelector('.piano-wrapper');
        wrapper?.classList.toggle('show-all-labels', enabled);
    }

    private isBlackKey(noteNumber: number): boolean {
        return [1, 3, 6, 8, 10].includes(noteNumber % 12);
    }

    public render(): void {
        this.container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = `piano-wrapper ${this.showLabels ? 'show-all-labels' : ''}`;

        const totalWhiteKeys = 29;
        const whiteWidthPct = 100 / totalWhiteKeys;
        const blackWidthPct = whiteWidthPct * 0.62;

        wrapper.style.setProperty('--black-width', `${blackWidthPct}%`);

        for (let i = 0; i < this.numKeys; i++) {
            const note = this.startNote + i;
            const isBlack = this.isBlackKey(note);
            const isPlayable = note >= this.playableStart && note <= this.playableEnd;
            const isC = note % 12 === 0;

            const key = document.createElement('div');
            key.className = `key ${isBlack ? 'black' : 'white'} ${!isPlayable ? 'dimmed' : ''} ${isC ? 'is-c' : ''}`;
            key.dataset.note = note.toString();

            if (isBlack) {
                key.style.width = `${blackWidthPct}%`;
            } else {
                key.style.width = `${whiteWidthPct}%`;
            }

            const pip = document.createElement('div');
            pip.className = 'target-pip';
            key.appendChild(pip);

            const label = document.createElement('span');
            label.className = 'key-label';
            if (isC) {
                const octaveNumber = Math.floor(note / 12) - 1;
                label.innerText = `C${octaveNumber}`;
            } else {
                label.innerText = NOTE_NAMES[note % 12];
            }
            key.appendChild(label);

            wrapper.appendChild(key);
        }

        this.container.appendChild(wrapper);
    }
}

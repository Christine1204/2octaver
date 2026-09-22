export class KeyboardVisualizer {
    private container: HTMLElement;
    private startNote = 36;       // C2
    private numKeys = 49;         // C2 through C6
    private playableStart = 48;   // C3
    private playableEnd = 72;     // C5

    private userActiveNotes = new Set<number>();
    private currentTargets = new Map<number, string>(); // note -> color hex

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Element #${containerId} not found`);
        this.container = el;
        this.render();
    }

    // Physical hardware input
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

    // Dynamic song cue input (called every frame from the game loop)
    public setTargetNotes(newTargets: Map<number, string>): void {
        // 1. Clear keys that are no longer active
        for (const [note] of this.currentTargets) {
            if (!newTargets.has(note)) {
                const keyEl = this.container.querySelector(`[data-note="${note}"]`) as HTMLElement | null;
                if (keyEl) {
                    keyEl.classList.remove('target-active');
                    const pip = keyEl.querySelector('.target-pip') as HTMLElement | null;
                    if (pip) pip.style.backgroundColor = '';
                }
            }
        }

        // 2. Activate or update newly cued keys
        for (const [note, color] of newTargets) {
            const prevColor = this.currentTargets.get(note);
            if (prevColor !== color) {
                const keyEl = this.container.querySelector(`[data-note="${note}"]`) as HTMLElement | null;
                if (keyEl) {
                    keyEl.classList.add('target-active');
                    const pip = keyEl.querySelector('.target-pip') as HTMLElement | null;
                    if (pip) {
                        pip.style.backgroundColor = color;
                        pip.style.boxShadow = `0 0 10px ${color}`;
                    }
                }
            }
        }

        this.currentTargets = new Map(newTargets);
    }

    public clearTargets(): void {
        this.setTargetNotes(new Map());
    }

    private isBlackKey(noteNumber: number): boolean {
        return [1, 3, 6, 8, 10].includes(noteNumber % 12);
    }

    public render(): void {
        this.container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'piano-wrapper';

        const totalWhiteKeys = 29;
        const whiteWidthPct = 100 / totalWhiteKeys;
        const blackWidthPct = whiteWidthPct * 0.62;

        wrapper.style.setProperty('--black-width', `${blackWidthPct}%`);

        for (let i = 0; i < this.numKeys; i++) {
            const note = this.startNote + i;
            const isBlack = this.isBlackKey(note);
            const isPlayable = note >= this.playableStart && note <= this.playableEnd;

            const key = document.createElement('div');
            key.className = `key ${isBlack ? 'black' : 'white'} ${!isPlayable ? 'dimmed' : ''}`;
            key.dataset.note = note.toString();

            if (isBlack) {
                key.style.width = `${blackWidthPct}%`;
            } else {
                key.style.width = `${whiteWidthPct}%`;
            }

            // Top indicator pip (The target cue)
            const pip = document.createElement('div');
            pip.className = 'target-pip';
            key.appendChild(pip);

            // Octave label for C keys
            if (note % 12 === 0) {
                const label = document.createElement('span');
                label.className = 'key-label';
                const octaveNumber = Math.floor(note / 12) - 1;
                label.innerText = `C${octaveNumber}`;
                key.appendChild(label);
            }

            wrapper.appendChild(key);
        }

        this.container.appendChild(wrapper);
    }
}

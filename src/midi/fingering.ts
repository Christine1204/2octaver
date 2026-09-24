import type { NoteWithMeta } from '../components/canvasRenderer';

const isBlackKey = (midi: number): boolean => [1, 3, 6, 8, 10].includes(midi % 12);

/**
 * Enforces strict territorial separation:
 * Prevents LH from stepping onto RH ground by shifting colliding LH notes down an octave.
 */
export function enforceHandTerritories(notes: NoteWithMeta[]): void {
    notes.sort((a, b) => a.time - b.time);

    for (let i = 0; i < notes.length; i++) {
        const cur = notes[i];
        if (cur.hand !== 'LH') continue;

        const nearbyRH = notes.filter(
            (other) =>
            other.hand === 'RH' &&
            Math.abs(other.time - cur.time) < 0.35
        );

        if (nearbyRH.length > 0) {
            const minRHPitch = Math.min(...nearbyRH.map((n) => n.midi));
            while (cur.midi >= minRHPitch && cur.midi - 12 >= 48) {
                cur.midi -= 12;
            }
        } else {
            while (cur.midi > 59 && cur.midi - 12 >= 48) {
                cur.midi -= 12;
            }
        }
    }
}

export function assignFingering(notes: NoteWithMeta[], hand: 'RH' | 'LH' = 'RH'): void {
    if (notes.length === 0) return;

    // Split into melodic phrases by micro-rests (>350ms)
    const phrases: NoteWithMeta[][] = [];
    let currentPhrase: NoteWithMeta[] = [];

    for (let i = 0; i < notes.length; i++) {
        const cur = notes[i];
        const prev = notes[i - 1];

        if (prev && cur.time - (prev.time + prev.duration) > 0.35) {
            if (currentPhrase.length > 0) phrases.push(currentPhrase);
            currentPhrase = [cur];
        } else {
            currentPhrase.push(cur);
        }
    }
    if (currentPhrase.length > 0) phrases.push(currentPhrase);

    for (const phrase of phrases) {
        const uniquePitches = Array.from(new Set(phrase.map((n) => n.midi))).sort((a, b) => a - b);
        const count = uniquePitches.length;
        const pitchToFinger = new Map<number, number>();

        if (count === 1) {
            const pitch = uniquePitches[0];
            // Avoid thumb on black keys even for isolated single hits
            if (isBlackKey(pitch)) {
                pitchToFinger.set(pitch, 2);
            } else {
                pitchToFinger.set(pitch, hand === 'RH' ? 2 : 3);
            }
        } else if (hand === 'RH') {
            // -------------------------------------------------------------
            // RIGHT HAND: Thumb Avoidance on Low Black Keys & Reach Mapping
            // -------------------------------------------------------------
            const base = uniquePitches[0];
            const topPitch = uniquePitches[count - 1];
            const totalSpan = topPitch - base;

            // Avoid thumb on low black keys if span is compact
            const baseFinger = isBlackKey(base) && totalSpan <= 7 && count <= 4 ? 2 : 1;
            pitchToFinger.set(base, baseFinger);

            // Dedicated 3-note ostinato/rock pattern (e.g. G -> D -> D#)
            if (count === 3 && totalSpan <= 9 && isBlackKey(topPitch)) {
                pitchToFinger.set(uniquePitches[0], 1); // G  -> Thumb (1)
                pitchToFinger.set(uniquePitches[1], 3); // D  -> Middle (3)
                pitchToFinger.set(uniquePitches[2], 4); // D# -> Ring (4)
            } else {
                for (let i = 1; i < count; i++) {
                    const pitch = uniquePitches[i];
                    const semitones = pitch - base;
                    let finger = 5;

                    if (semitones <= 2) {
                        finger = 2;
                    } else if (semitones <= 4) {
                        finger = 3;
                    } else if (semitones <= 7) {
                        const nextPitch = uniquePitches[i + 1];
                        if (nextPitch && nextPitch - pitch <= 2 && isBlackKey(nextPitch)) {
                            finger = 3;
                        } else {
                            finger = 4;
                        }
                    } else {
                        if (isBlackKey(pitch) && semitones <= 8 && count <= 4) {
                            finger = 4;
                        } else {
                            finger = 5;
                        }
                    }

                    const prevFinger = pitchToFinger.get(uniquePitches[i - 1]) || baseFinger;
                    if (finger <= prevFinger) {
                        finger = Math.min(5, prevFinger + 1);
                    }
                    pitchToFinger.set(pitch, finger);
                }

                for (let i = count - 2; i >= 0; i--) {
                    const nextFinger = pitchToFinger.get(uniquePitches[i + 1])!;
                    const curFinger = pitchToFinger.get(uniquePitches[i])!;
                    if (curFinger >= nextFinger) {
                        pitchToFinger.set(uniquePitches[i], Math.max(1, nextFinger - 1));
                    }
                }
            }
        } else {
            // -------------------------------------------------------------
            // LEFT HAND: Strict Thumb Avoidance on High Black Keys
            // -------------------------------------------------------------
            const highest = uniquePitches[count - 1];
            const lowest = uniquePitches[0];
            const totalSpan = highest - lowest;

            // RULE: If highest note is an accidental (like A#) and span is manageable (<= 8),
            // START ON INDEX (2), NEVER THUMB (1)!
            const topFinger = isBlackKey(highest) && totalSpan <= 8 && count <= 4 ? 2 : 1;
            pitchToFinger.set(highest, topFinger);

            for (let i = count - 2; i >= 0; i--) {
                const pitch = uniquePitches[i];
                const semitonesDown = highest - pitch;
                let finger = 5;

                if (topFinger === 2) {
                    // Started on Index (2) for the high black key (e.g. A#)
                    if (semitonesDown <= 3) {
                        finger = 3; // e.g. G is 3 semitones down -> Middle (3)
                    } else if (semitonesDown <= 5) {
                        finger = 4; // e.g. F is 5 semitones down -> Ring (4)
                    } else {
                        finger = 5; // e.g. lower roots -> Pinky (5)
                    }
                } else {
                    // Started on Thumb (1) for high white key (e.g. B or C)
                    if (semitonesDown <= 2) finger = 2;
                    else if (semitonesDown <= 4) finger = 3;
                    else if (semitonesDown <= 7) finger = 4;
                    else finger = 5;

                    // Avoid pinky on bottom black key if ring can take it
                    if (isBlackKey(pitch) && semitonesDown <= 8 && finger === 5) {
                        finger = 4;
                    }
                }

                const prevFinger = pitchToFinger.get(uniquePitches[i + 1]) || topFinger;
                if (finger <= prevFinger) {
                    finger = Math.min(5, prevFinger + 1);
                }
                pitchToFinger.set(pitch, finger);
            }
        }

        for (const note of phrase) {
            note.finger = pitchToFinger.get(note.midi) ?? (hand === 'RH' ? 1 : 5);
            note.hand = hand;
        }
    }
}

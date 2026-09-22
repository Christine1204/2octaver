import type { TempoChange, TimeSignatureChange } from './types';

export interface BarLine {
    measureNumber: number;
    tick: number;
    time: number; // in seconds
    timeSignature: string; // e.g. "4/4", "6/4"
}

// Converts any arbitrary tick into absolute seconds across tempo changes
export function createTickToSecondsConverter(ppq: number, tempos: TempoChange[]) {
    const sorted = [...tempos].sort((a, b) => a.ticks - b.ticks);
    const segments: { ticks: number; bpm: number; time: number }[] = [];
    let accumulatedTime = 0;

    for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i];
        if (i > 0) {
            const prev = sorted[i - 1];
            const deltaTicks = cur.ticks - prev.ticks;
            accumulatedTime += (deltaTicks / ppq) * (60 / prev.bpm);
        }
        segments.push({
            ticks: cur.ticks,
            bpm: cur.bpm,
            time: accumulatedTime,
        });
    }

    return function tickToSeconds(tick: number): number {
        let activeSeg = segments[0];
        for (let i = segments.length - 1; i >= 0; i--) {
            if (tick >= segments[i].ticks) {
                activeSeg = segments[i];
                break;
            }
        }
        const deltaTicks = tick - activeSeg.ticks;
        return activeSeg.time + (deltaTicks / ppq) * (60 / activeSeg.bpm);
    };
}

// Generates every bar line up to song duration + 2 measures buffer
export function generateBarLines(
    ppq: number,
    duration: number,
    tempos: TempoChange[],
    timeSignatures: TimeSignatureChange[]
): BarLine[] {
    const tickToSeconds = createTickToSecondsConverter(ppq, tempos);
    const sortedSigs = [...timeSignatures].sort((a, b) => a.ticks - b.ticks);

    const barLines: BarLine[] = [];
    let currentTick = 0;
    let measureNumber = 1;
    let sigIndex = 0;

    while (tickToSeconds(currentTick) <= duration + 3) {
        // Advance time signature if next one is reached
        while (sigIndex + 1 < sortedSigs.length && currentTick >= sortedSigs[sigIndex + 1].ticks) {
            sigIndex++;
        }

        const activeSig = sortedSigs[sigIndex] || { numerator: 4, denominator: 4 };
        const timeSec = tickToSeconds(currentTick);

        barLines.push({
            measureNumber,
            tick: currentTick,
            time: timeSec,
            timeSignature: `${activeSig.numerator}/${activeSig.denominator}`,
        });

        const ticksPerBeat = ppq * (4 / activeSig.denominator);
        const measureTicks = activeSig.numerator * ticksPerBeat;

        currentTick += measureTicks;
        measureNumber++;
    }

    return barLines;
}

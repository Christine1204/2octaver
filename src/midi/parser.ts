import { Midi } from '@tonejs/midi';
import type { ParsedSong, ParsedTrack, ParsedNote, TempoChange, TimeSignatureChange } from './types';

function sanitizeText(text: string): string {
    if (!text) return '';
    try {
        const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        return text;
    }
}

// Calculates the optimal octave shift to place the track inside notes 48..72
function calculateTrackAutoFit(minPitch: number, maxPitch: number): number {
    if (minPitch > maxPitch) return 0;
    const trackCenter = (minPitch + maxPitch) / 2;
    const targetCenter = 60; // Middle C (C4)
    return Math.round((targetCenter - trackCenter) / 12) * 12;
}

export function parseMidiBuffer(buffer: ArrayBuffer): ParsedSong {
    const rawMidi = new Midi(buffer);
    (window as any).__RAW_MIDI__ = rawMidi;

    const tempos: TempoChange[] = rawMidi.header.tempos.map((t) => ({
        ticks: t.ticks,
        time: (t as any).time ?? 0,
                                                                    bpm: t.bpm,
    }));
    if (tempos.length === 0) tempos.push({ ticks: 0, time: 0, bpm: 120 });

    const timeSignatures: TimeSignatureChange[] = rawMidi.header.timeSignatures.map((ts) => ({
        ticks: ts.ticks,
        time: (ts as any).time ?? 0,
                                                                                             numerator: ts.timeSignature[0],
                                                                                             denominator: ts.timeSignature[1],
    }));
    if (timeSignatures.length === 0) timeSignatures.push({ ticks: 0, time: 0, numerator: 4, denominator: 4 });

    const tracks: ParsedTrack[] = [];
    const trackNameOccurrences = new Map<string, number>();
    let globalNoteId = 0;

    for (let i = 0; i < rawMidi.tracks.length; i++) {
        const rawTrack = rawMidi.tracks[i];
        if (rawTrack.notes.length === 0) continue;

        let cleanName = sanitizeText(rawTrack.name.trim());
        if (!cleanName && i > 0) {
            const prevTrack = rawMidi.tracks[i - 1];
            const prevName = sanitizeText(prevTrack.name.trim());
            if (prevName) {
                cleanName = prevTrack.notes.length === 0 ? prevName : `${prevName} (Staff 2)`;
            }
        }
        if (!cleanName) cleanName = `Track ${i + 1}`;

        const occurrence = trackNameOccurrences.get(cleanName) ?? 0;
        trackNameOccurrences.set(cleanName, occurrence + 1);
        const displayName = occurrence === 0 ? cleanName : `${cleanName} (${occurrence + 1})`;

        let minPitch = 127;
        let maxPitch = 0;

        const notes: ParsedNote[] = rawTrack.notes.map((n) => {
            if (n.midi < minPitch) minPitch = n.midi;
            if (n.midi > maxPitch) maxPitch = n.midi;

            return {
                id: globalNoteId++,
                midi: n.midi,
                time: n.time,
                duration: n.duration,
                ticks: n.ticks,
                durationTicks: n.durationTicks,
                velocity: n.velocity,
                channel: rawTrack.channel,
            };
        });

        const isDrum = rawTrack.channel === 9 || rawTrack.instrument.percussion === true;
        const defaultOctaveShift = isDrum ? 0 : calculateTrackAutoFit(minPitch, maxPitch);

        tracks.push({
            id: tracks.length,
            name: displayName,
            channel: rawTrack.channel,
            instrumentNumber: rawTrack.instrument.number,
            isDrum,
            notes,
            minPitch: notes.length > 0 ? minPitch : 0,
            maxPitch: notes.length > 0 ? maxPitch : 0,
            defaultOctaveShift,
        });
    }

    return {
        name: sanitizeText(rawMidi.name || 'Untitled Song'),
        ppq: rawMidi.header.ppq,
        duration: rawMidi.duration,
        tracks,
        tempos,
        timeSignatures,
    };
}

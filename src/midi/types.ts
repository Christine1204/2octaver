export interface ParsedNote {
    id: number;
    midi: number;
    time: number;
    duration: number;
    ticks: number;
    durationTicks: number;
    velocity: number;
    channel: number;
}

export interface ParsedTrack {
    id: number;
    name: string;
    channel: number;
    instrumentNumber: number;
    isDrum: boolean;
    notes: ParsedNote[];
    minPitch: number;
    maxPitch: number;
    defaultOctaveShift: number; // Auto-fit offset calculated on parse
}

export interface TempoChange {
    ticks: number;
    time: number;
    bpm: number;
}

export interface TimeSignatureChange {
    ticks: number;
    time: number;
    numerator: number;
    denominator: number;
}

export interface ParsedSong {
    name: string;
    ppq: number;
    duration: number;
    tracks: ParsedTrack[];
    tempos: TempoChange[];
    timeSignatures: TimeSignatureChange[];
}

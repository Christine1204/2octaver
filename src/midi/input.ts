export type NoteCallback = (note: number, velocity: number, isNoteOn: boolean) => void;

export class MidiInputManager {
    private midiAccess: MIDIAccess | null = null;
    private onNoteListeners: NoteCallback[] = [];

    async init(): Promise<string[]> {
        if (!navigator.requestMIDIAccess) {
            throw new Error('Web MIDI API is not supported in this browser.');
        }

        this.midiAccess = await navigator.requestMIDIAccess();
        const deviceNames: string[] = [];

        for (const input of this.midiAccess.inputs.values()) {
            deviceNames.push(input.name || 'Unknown Device');
            input.onmidimessage = this.handleMidiMessage.bind(this);
        }

        // Auto-detect when devices are plugged or unplugged
        this.midiAccess.onstatechange = (e: any) => {
            if (e.port.type === 'input' && e.port.state === 'connected') {
                e.port.onmidimessage = this.handleMidiMessage.bind(this);
            }
        };

        return deviceNames;
    }

    public subscribe(callback: NoteCallback): () => void {
        this.onNoteListeners.push(callback);
        return () => {
            this.onNoteListeners = this.onNoteListeners.filter((cb) => cb !== callback);
        };
    }

    private handleMidiMessage(event: MIDIMessageEvent): void {
        if (!event.data || event.data.length < 3) return;

        const [statusByte, note, velocity] = event.data;
        const command = statusByte >> 4; // High nibble gives message type (9 = On, 8 = Off)

        const isNoteOn = command === 9 && velocity > 0;
        const isNoteOff = command === 8 || (command === 9 && velocity === 0);

        if (isNoteOn || isNoteOff) {
            for (const listener of this.onNoteListeners) {
                listener(note, velocity, isNoteOn);
            }
        }
    }
}

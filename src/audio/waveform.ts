export interface WaveformData {
    peaks: Float32Array;
    duration: number;
    peaksPerSecond: number;
}

export async function extractWaveformData(
    file: File,
    peaksPerSecond = 100
): Promise<WaveformData> {
    const arrayBuffer = await file.arrayBuffer();

    // Use a temporary offline context to decode the raw binary audio
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    await audioCtx.close();

    const numChannels = audioBuffer.numberOfChannels;
    const channelData: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
        channelData.push(audioBuffer.getChannelData(c));
    }

    const duration = audioBuffer.duration;
    const totalPeaks = Math.ceil(duration * peaksPerSecond);
    const peaks = new Float32Array(totalPeaks);
    const samplesPerPeak = Math.floor(audioBuffer.sampleRate / peaksPerSecond);

    for (let i = 0; i < totalPeaks; i++) {
        const startSample = i * samplesPerPeak;
        const endSample = Math.min(startSample + samplesPerPeak, audioBuffer.length);
        let max = 0;

        for (let c = 0; c < numChannels; c++) {
            const data = channelData[c];
            for (let s = startSample; s < endSample; s++) {
                const val = Math.abs(data[s]);
                if (val > max) max = val;
            }
        }
        peaks[i] = max;
    }

    return { peaks, duration, peaksPerSecond };
}

export function getInstrumentIcon(trackName: string, isDrum: boolean, instrumentNumber: number): string {
    const name = trackName.toLowerCase();

    // 1. Drums & Percussion
    if (isDrum || name.includes('drum') || name.includes('percussion') || name.includes('bourdon')) {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="8" rx="8" ry="3"/>
        <path d="M4 8v7c0 1.66 3.58 3 8 3s8-1.34 8-3V8"/>
        <path d="m3 3 6 4M21 3l-6 4"/>
        </svg>`;
    }

    // 2. Bass Guitar (Songsterr-style 4-peg headstock)
    if (name.includes('bass') || (instrumentNumber >= 32 && instrumentNumber <= 39)) {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 22V13h4v9"/>
        <path d="M9.5 13c0-2-1-4-1-6 0-3 1.5-5 3.5-5s3.5 2 3.5 5c0 2-1 4-1 6"/>
        <circle cx="5.5" cy="5.5" r="1.3" fill="currentColor"/>
        <path d="M7 5.5h1.5"/>
        <circle cx="5.5" cy="9.5" r="1.3" fill="currentColor"/>
        <path d="M7 9.5h2"/>
        <circle cx="18.5" cy="5.5" r="1.3" fill="currentColor"/>
        <path d="M15.5 5.5h1.5"/>
        <circle cx="18.5" cy="9.5" r="1.3" fill="currentColor"/>
        <path d="M15 9.5h2"/>
        </svg>`;
    }

    // 3. Vocals & Microphone
    if (
        name.includes('vocal') ||
        name.includes('voice') ||
        name.includes('chester') ||
        name.includes('shinoda') ||
        name.includes('sing')
    ) {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="2" width="6" height="11" rx="3"/>
        <path d="M5 10a7 7 0 0 0 14 0"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        </svg>`;
    }

    // 4. Keyboard / Piano / Harpsichord / Organ
    if (
        name.includes('piano') ||
        name.includes('harpsi') ||
        name.includes('organ') ||
        name.includes('key') ||
        (instrumentNumber >= 0 && instrumentNumber <= 23)
    ) {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <rect x="5.5" y="5" width="2.5" height="7" fill="currentColor"/>
        <rect x="10.5" y="5" width="2.5" height="7" fill="currentColor"/>
        <rect x="16" y="5" width="2.5" height="7" fill="currentColor"/>
        <path d="M8.5 12v7M14 12v7M19 12v7"/>
        </svg>`;
    }

    // 5. Strings / Cello / Violin
    if (name.includes('cello') || name.includes('violin') || name.includes('string') || (instrumentNumber >= 40 && instrumentNumber <= 51)) {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 19c-2 0-3-1-3-3 0-3 2-4 2-7 0-2-1-3-1-5 0-1.5 1.5-2 3-2M15 19c2 0 3-1 3-3 0-3-2-4-2-7 0-2 1-3 1-5 0-1.5-1.5-2-3-2"/>
        <path d="M12 2v20"/>
        <circle cx="12" cy="11" r="1.5"/>
        </svg>`;
    }

    // 6. Electric Guitar (Songsterr-style Strat 6-in-line headstock)
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 22V14h3v8"/>
    <path d="M11 14C9.5 11 8.5 7.5 8.5 5 8.5 3 10 2 11.5 2c2 0 3 1.5 2.5 4-.5 2 0 4 1 8"/>
    <circle cx="6.5" cy="3.5" r="1" fill="currentColor"/>
    <circle cx="6.5" cy="5.8" r="1" fill="currentColor"/>
    <circle cx="7" cy="8" r="1" fill="currentColor"/>
    <circle cx="7.5" cy="10.2" r="1" fill="currentColor"/>
    <circle cx="8" cy="12.4" r="1" fill="currentColor"/>
    <circle cx="8.5" cy="14.5" r="1" fill="currentColor"/>
    </svg>`;
}

export type HitRating = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

export interface StarRequirement {
    star: number;
    scoreRequired: number;
    pctOfIdeal: number;
}

export interface ScoreState {
    score: number;
    streak: number;
    maxStreak: number;
    multiplier: number;
    stars: number;
    starFillPercent: number;
    rating: HitRating | null;
    perfectHits: number;
    greatHits: number;
    goodHits: number;
    misses: number;
    totalNotes: number;
}

export class ScoreEngine {
    private score = 0;
    private streak = 0;
    private maxStreak = 0;
    private benchmarkScore = 1;
    private lastRating: HitRating | null = null;
    private totalPlayableNotes = 0;

    private perfectHits = 0;
    private greatHits = 0;
    private goodHits = 0;
    private misses = 0;

    private starCutoffs = [0.20, 0.40, 0.60, 0.78, 0.92];

    public recalculateTrackBenchmark(totalNotes: number): void {
        this.reset();
        this.totalPlayableNotes = totalNotes;

        if (totalNotes <= 0) {
            this.benchmarkScore = 1;
            return;
        }

        const realisticTarget = totalNotes * 85 * 3.2;
        this.benchmarkScore = Math.max(100, Math.round(realisticTarget));
    }

    public registerHit(timingDeltaSeconds: number): {
        rating: HitRating;
        points: number;
        mult: number;
        multMilestoneCrossed: boolean;
    } {
        const prevMult = this.getMultiplier();
        const absDelta = Math.abs(timingDeltaSeconds);

        let basePoints = 80;
        let rating: HitRating = 'GOOD';

        if (absDelta <= 0.045) {
            rating = 'PERFECT';
            basePoints = 100;
            this.perfectHits++;
        } else if (absDelta <= 0.085) {
            rating = 'GREAT';
            basePoints = 90;
            this.greatHits++;
        } else {
            rating = 'GOOD';
            basePoints = 80;
            this.goodHits++;
        }

        this.streak++;
        if (this.streak > this.maxStreak) {
            this.maxStreak = this.streak;
        }

        const mult = this.getMultiplier();
        const points = Math.round(basePoints * mult);
        this.score += points;
        this.lastRating = rating;

        const multMilestoneCrossed = Math.floor(mult) > Math.floor(prevMult) || (mult === 5.0 && prevMult < 5.0);

        return { rating, points, mult, multMilestoneCrossed };
    }

    public registerMiss(): void {
        // Soft cushion: lose 3 notes of combo (-0.3x) rather than wiping to zero
        this.streak = Math.max(0, this.streak - 3);
        this.misses++;
        this.lastRating = 'MISS';
    }

    public getMultiplier(): number {
        // Ramps up by 0.1x on every single consecutive note, capped at 5.0x
        return Math.min(5.0, Math.round((1.0 + this.streak * 0.1) * 10) / 10);
    }

    public getStarRequirements(): StarRequirement[] {
        return this.starCutoffs.map((cutoff, idx) => ({
            star: idx + 1,
            scoreRequired: Math.round(this.benchmarkScore * cutoff),
                                                      pctOfIdeal: Math.round(cutoff * 100),
        }));
    }

    public getState(): ScoreState {
        let starsEarned = 0;
        for (let i = 0; i < this.starCutoffs.length; i++) {
            if (this.score >= this.benchmarkScore * this.starCutoffs[i]) {
                starsEarned = i + 1;
            }
        }

        const ratio = Math.min(1.0, this.score / (this.benchmarkScore * 0.92));

        return {
            score: this.score,
            streak: this.streak,
            maxStreak: this.maxStreak,
            multiplier: this.getMultiplier(),
            stars: starsEarned,
            starFillPercent: Math.round(ratio * 100),
            rating: this.lastRating,
            perfectHits: this.perfectHits,
            greatHits: this.greatHits,
            goodHits: this.goodHits,
            misses: this.misses,
            totalNotes: this.totalPlayableNotes,
        };
    }

    public reset(): void {
        this.score = 0;
        this.streak = 0;
        this.maxStreak = 0;
        this.perfectHits = 0;
        this.greatHits = 0;
        this.goodHits = 0;
        this.misses = 0;
        this.lastRating = null;
    }
}

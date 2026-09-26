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
    starProgressPercent: number; // 0% to 100% toward NEXT star
    nextStarNumber: number;      // 1 to 5 (or 5 if maxed)
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

    // Realistic arcade progression curve
    private starCutoffs = [0.18, 0.38, 0.58, 0.76, 0.90];

    public recalculateTrackBenchmark(totalNotes: number): void {
        this.reset();
        this.totalPlayableNotes = totalNotes;

        if (totalNotes <= 0) {
            this.benchmarkScore = 1;
            return;
        }

        // Dynamic multiplier target based on chart note density:
        // Solo / sparse lines (<350 notes) target ~2.1x average multiplier
        // Medium charts (350-600 notes) target ~2.5x
        // Dense polyphonic charts (>600 notes) target ~2.9x
        let expectedMult = 2.1;
        if (totalNotes >= 600) {
            expectedMult = 2.9;
        } else if (totalNotes >= 350) {
            expectedMult = 2.5;
        }

        const realisticTarget = totalNotes * 88 * expectedMult;
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

        const multMilestoneCrossed =
        Math.floor(mult) > Math.floor(prevMult) || (mult === 5.0 && prevMult < 5.0);

        return { rating, points, mult, multMilestoneCrossed };
    }

    public registerMiss(): void {
        this.streak = Math.max(0, this.streak - 3);
        this.misses++;
        this.lastRating = 'MISS';
    }

    public getMultiplier(): number {
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
        const reqs = this.getStarRequirements();
        let starsEarned = 0;

        for (let i = 0; i < reqs.length; i++) {
            if (this.score >= reqs[i].scoreRequired) {
                starsEarned = i + 1;
            }
        }

        // Milestone Progress: Calculate 0-100% fill toward the NEXT star
        let progressPercent = 0;
        let nextStarNumber = Math.min(5, starsEarned + 1);

        if (starsEarned === 5) {
            progressPercent = 100;
        } else {
            const prevThreshold = starsEarned > 0 ? reqs[starsEarned - 1].scoreRequired : 0;
            const nextThreshold = reqs[starsEarned].scoreRequired;
            const span = nextThreshold - prevThreshold;
            if (span > 0) {
                const currentInSpan = Math.max(0, this.score - prevThreshold);
                progressPercent = Math.min(100, Math.round((currentInSpan / span) * 100));
            }
        }

        return {
            score: this.score,
            streak: this.streak,
            maxStreak: this.maxStreak,
            multiplier: this.getMultiplier(),
            stars: starsEarned,
            starProgressPercent: progressPercent,
            nextStarNumber,
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

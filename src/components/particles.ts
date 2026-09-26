export interface SparkParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    alpha: number;
    life: number;
    maxLife: number;
    twinkleOffset: number;
}

export interface FlashGlow {
    x: number;
    y: number;
    color: string;
    radius: number;
    alpha: number;
    decay: number;
}



export interface FloatingText {
    x: number;
    y: number;
    vx: number;
    vy: number;
    gravity: number;
    text: string;
    color: string;
    size: number;
    alpha: number;
    life: number;
    maxLife: number;
    isMultiplier: boolean;
}

const ARCADE_COLORS = [
    '#38bdf8', // Electric Cyan
'#818cf8', // Indigo
'#c084fc', // Neon Purple
'#f43f5e', // Hot Coral
'#fb923c', // Warm Orange
'#facc15', // Cyber Yellow
'#4ade80', // Mint Green
'#2dd4bf', // Teal
];

export class ParticleEngine {
    private particles: SparkParticle[] = [];
    private flashes: FlashGlow[] = [];
    private floatingTexts: FloatingText[] = [];

    public emitRatingPopup(x: number, y: number, rating: HitRating): void {
        let color = '#38bdf8';
        let text = 'PERFECT!';
        let size = 16;

        switch (rating) {
            case 'PERFECT':
                color = '#38bdf8'; // Electric Cyan
                text = 'PERFECT!';
                size = 17;
                break;
            case 'GREAT':
                color = '#22c55e'; // Vibrant Green
                text = 'GREAT!';
                size = 16;
                break;
            case 'GOOD':
                color = '#eab308'; // Amber Yellow
                text = 'GOOD';
                size = 14;
                break;
            case 'MISS':
                color = '#ef4444'; // Red
                text = 'MISS';
                size = 15;
                break;
        }

        this.floatingTexts.push({
            x: x + (Math.random() - 0.5) * 8,
                                y: y - 24,
                                vx: (Math.random() - 0.5) * 30, // Minimal horizontal drift
                                vy: -150 - Math.random() * 40,   // Rapid upward kick
                                gravity: 0,                     // No downward gravity: floats straight UP
                                text,
                                color,
                                size,
                                alpha: 1.0,
                                life: 0,
                                maxLife: 0.75,
                                isMultiplier: false,
        });
    }

    public emitHit(x: number, y: number, color = '#38bdf8', count = 30): void {
        this.flashes.push({
            x,
            y,
            color,
            radius: 34,
            alpha: 0.95,
            decay: 4.8,
        });

        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.85;
            const speed = 90 + Math.random() * 240;
            const maxLife = 0.45 + Math.random() * 0.55;

            this.particles.push({
                x: x + (Math.random() - 0.5) * 16,
                                y: y - Math.random() * 6,
                                vx: Math.cos(angle) * speed * 0.35 + (Math.random() - 0.5) * 40,
                                vy: Math.sin(angle) * speed,
                                size: 1.2 + Math.random() * 2.6,
                                color: Math.random() > 0.3 ? color : '#ffffff',
                                alpha: 0.9,
                                life: 0,
                                maxLife,
                                twinkleOffset: Math.random() * Math.PI * 2,
            });
        }
    }

    public emitScorePopup(x: number, y: number, points: number): void {
        const randomColor = ARCADE_COLORS[Math.floor(Math.random() * ARCADE_COLORS.length)];
        const spreadX = (Math.random() - 0.5) * 180;
        const popUpVelocityY = -(180 + Math.random() * 90);

        this.floatingTexts.push({
            x: x + (Math.random() - 0.5) * 12,
                                y: y - 10,
                                vx: spreadX,
                                vy: popUpVelocityY,
                                gravity: 520,
                                text: `+${points}`,
                                color: randomColor,
                                size: 19 + Math.floor(Math.random() * 4),
                                alpha: 0.85,
                                life: 0,
                                maxLife: 1.25,
                                isMultiplier: false,
        });
    }

    // Clean badge burst without the word "MULTIPLIER"
    public emitMultiplierBurst(x: number, y: number, mult: number): void {
        const randomColor = ARCADE_COLORS[Math.floor(Math.random() * ARCADE_COLORS.length)];
        const spreadX = (Math.random() - 0.5) * 120;
        const popUpVelocityY = -(210 + Math.random() * 80);

        const multText = mult >= 5.0 ? '5.0X MAX!' : `${mult.toFixed(1)}X!`;

        this.floatingTexts.push({
            x,
            y: y - 20,
            vx: spreadX,
            vy: popUpVelocityY,
            gravity: 480,
            text: multText,
            color: randomColor,
            size: 21,
            alpha: 0.9,
            life: 0,
            maxLife: 1.3,
            isMultiplier: true,
        });
    }

    // Golden 360-degree shockwave burst when a star is unlocked
    public emitStarCelebration(x: number, y: number): void {
        this.flashes.push({
            x,
            y,
            color: '#facc15',
            radius: 48,
            alpha: 1.0,
            decay: 3.2,
        });

        for (let i = 0; i < 40; i++) {
            const angle = (Math.PI * 2 * i) / 40 + (Math.random() - 0.5) * 0.2;
            const speed = 120 + Math.random() * 220;
            this.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                                vy: Math.sin(angle) * speed,
                                size: 1.8 + Math.random() * 2.4,
                                color: Math.random() > 0.35 ? '#facc15' : '#ffffff',
                                alpha: 1.0,
                                life: 0,
                                maxLife: 0.65 + Math.random() * 0.45,
                                twinkleOffset: Math.random() * Math.PI * 2,
            });
        }
    }

    public update(dt: number): void {
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const f = this.flashes[i];
            f.alpha -= f.decay * dt;
            if (f.alpha <= 0) this.flashes.splice(i, 1);
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life += dt;
            if (p.life >= p.maxLife) {
                this.particles.splice(i, 1);
                continue;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += -25 * dt;
            p.vx *= 0.96;
            p.alpha = Math.max(0, 0.9 * (1 - Math.pow(p.life / p.maxLife, 1.4)));
        }

        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.life += dt;
            if (ft.life >= ft.maxLife) {
                this.floatingTexts.splice(i, 1);
                continue;
            }

            ft.x += ft.vx * dt;
            ft.y += ft.vy * dt;
            ft.vy += ft.gravity * dt;
            ft.vx *= 0.98;

            const progress = ft.life / ft.maxLife;
            ft.alpha = Math.max(0, 0.85 * (1 - Math.pow(progress, 1.8)));
        }
    }

    public draw(ctx: CanvasRenderingContext2D): void {
        if (this.particles.length === 0 && this.flashes.length === 0 && this.floatingTexts.length === 0) return;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        for (const f of this.flashes) {
            const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
            grad.addColorStop(0, `rgba(255, 255, 255, ${f.alpha.toFixed(2)})`);
            grad.addColorStop(0.35, f.color);
            grad.addColorStop(1, 'transparent');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const p of this.particles) {
            const twinkle = 0.75 + 0.25 * Math.sin(p.life * 20 + p.twinkleOffset);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha * twinkle));
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const ft of this.floatingTexts) {
            ctx.globalAlpha = ft.alpha;
            ctx.font = `900 ${ft.size}px monospace`;
            ctx.shadowColor = ft.color;
            ctx.shadowBlur = ft.isMultiplier ? 14 : 8;
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, ft.x, ft.y);
        }

        ctx.restore();
    }

    public clear(): void {
        this.particles = [];
        this.flashes = [];
        this.floatingTexts = [];
    }
}

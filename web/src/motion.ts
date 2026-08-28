import anime from 'animejs';

let processingPulse: anime.AnimeInstance | null = null;

function motionIsReduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initializeMotion(): void {
    if (motionIsReduced()) {
        document.documentElement.classList.add('reduced-motion');

        return;
    }

    anime.timeline({
        easing: 'easeOutExpo',
        duration: 850
    })
        .add({
            targets: '.site-header',
            opacity: [0, 1],
            translateY: [-18, 0]
        })
        .add({
            targets: '.system-strip',
            opacity: [0, 1],
            translateY: [12, 0],
            duration: 650
        }, '-=560')
        .add({
            targets: '.panel',
            opacity: [0, 1],
            translateY: [18, 0],
            delay: anime.stagger(95),
            duration: 720
        }, '-=480');

    anime({
        targets: '.wave-track-back',
        translateX: [-34, 28],
        opacity: [0.45, 0.9],
        duration: 9000,
        direction: 'alternate',
        easing: 'easeInOutSine',
        loop: true
    });

    anime({
        targets: '.wave-track-front',
        translateX: [26, -42],
        translateY: [-3, 7],
        opacity: [0.52, 1],
        duration: 6500,
        direction: 'alternate',
        easing: 'easeInOutSine',
        loop: true
    });

    anime({
        targets: '.ambient-glow-cyan',
        translateX: [-20, 55],
        translateY: [-10, 35],
        scale: [0.94, 1.08],
        duration: 11000,
        direction: 'alternate',
        easing: 'easeInOutSine',
        loop: true
    });

    anime({
        targets: '.ambient-glow-violet',
        translateX: [25, -45],
        translateY: [18, -28],
        scale: [1.06, 0.92],
        duration: 13000,
        direction: 'alternate',
        easing: 'easeInOutSine',
        loop: true
    });

    anime({
        targets: '.brand-core',
        scale: [0.85, 1.35],
        opacity: [0.65, 1],
        transformOrigin: 'center',
        duration: 1500,
        direction: 'alternate',
        easing: 'easeInOutSine',
        loop: true
    });

    anime({
        targets: '.system-signal span',
        scaleY: [0.45, 1],
        opacity: [0.35, 1],
        transformOrigin: 'center bottom',
        delay: anime.stagger(120, { from: 'center' }),
        duration: 800,
        direction: 'alternate',
        easing: 'easeInOutSine',
        loop: true
    });

    anime({
        targets: '.options-beacon span',
        translateX: [-38, 38],
        opacity: [0.4, 1],
        duration: 2200,
        direction: 'alternate',
        easing: 'easeInOutSine',
        loop: true
    });
}

export function animateModePanel(panel: HTMLElement): void {
    if (motionIsReduced()) {
        return;
    }

    anime.remove(panel);
    anime({
        targets: panel,
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 380,
        easing: 'easeOutCubic'
    });
}

export function setProcessingMotion(isProcessing: boolean): void {
    document.body.classList.toggle('is-processing', isProcessing);

    const activityOrb: HTMLElement | null = document.querySelector<HTMLElement>('#activity-orb');

    processingPulse?.pause();
    processingPulse = null;

    if (activityOrb === null || motionIsReduced()) {
        return;
    }

    anime.remove(activityOrb);

    if (isProcessing) {
        processingPulse = anime({
            targets: activityOrb,
            scale: [0.72, 1.5],
            opacity: [0.45, 1],
            duration: 720,
            direction: 'alternate',
            easing: 'easeInOutSine',
            loop: true
        });
    } else {
        anime.set(activityOrb, { scale: 1, opacity: 1 });
    }
}

export function animateResult(): void {
    if (motionIsReduced()) {
        return;
    }

    const targets: NodeListOf<HTMLElement> = document.querySelectorAll<HTMLElement>(
        '.result-panel .code-preview, .result-panel .result-actions, .result-panel .artifact-downloads'
    );

    anime.remove(targets);
    anime({
        targets,
        opacity: [0, 1],
        translateY: [10, 0],
        delay: anime.stagger(85),
        duration: 520,
        easing: 'easeOutCubic'
    });
}

'use client';

import { useEffect, useRef } from 'react';

/**
 * Decorative hero background: a field of dots laid out on a grid that is
 * seen in perspective, rising and falling like a sound wave. Colors follow
 * the site's CTA gradient (sky blue → brand blue → indigo).
 *
 * Kept cheap on purpose: one canvas, no libraries, paused when the hero is
 * off screen or the tab is hidden, and a single still frame when the visitor
 * prefers reduced motion.
 */

const STOPS: [number, number, number][] = [
  [111, 195, 255], // #6FC3FF
  [61, 125, 255], // #3D7DFF
  [87, 80, 232], // #5750E8
];

function gradientAt(t: number): [number, number, number] {
  const x = Math.min(Math.max(t, 0), 1) * (STOPS.length - 1);
  const i = Math.min(Math.floor(x), STOPS.length - 2);
  const f = x - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Wave height in "world" units for a point at (x, z) and time t.
function height(x: number, z: number, t: number): number {
  return (
    Math.sin(x * 0.9 + t * 0.55 + z * 0.35) * 0.55 +
    Math.sin(x * 1.7 - t * 0.4 + z * 0.8) * 0.3 +
    Math.sin(x * 0.35 + t * 0.25 - z * 0.5) * 0.65 +
    Math.cos(x * 2.6 + z * 1.3 + t * 0.7) * 0.12
  );
}

export default function HeroWaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let heightPx = 0;
    let dpr = 1;
    let frame = 0;
    let running = false;
    let visible = true;
    let start = performance.now();
    let elapsed = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      heightPx = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(heightPx * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, heightPx);
      const small = width < 640;
      const cols = Math.round(width / (small ? 9 : 12));
      const rows = small ? 22 : 30;
      const centerY = heightPx * (small ? 0.5 : 0.52);
      const amp = Math.min(heightPx * 0.1, small ? 48 : 85);
      const depth = small ? 110 : 170; // band thickness in px before perspective

      for (let r = 0; r < rows; r++) {
        const zn = r / (rows - 1); // 0 = far, 1 = near
        const z = zn * 3;
        // Near rows sit lower and are drawn bigger and stronger.
        const scale = 0.6 + zn * 0.55;
        const rowOffset = (zn - 0.5) * depth;
        const alphaRow = 0.18 + zn * 0.5;
        const size = (small ? 1.4 : 1.6) * scale;

        for (let c = 0; c <= cols; c++) {
          const xn = c / cols;
          const xWorld = xn * (small ? 8 : 15) - t * 0.3;
          const h = height(xWorld, z, t);
          // Perspective: far rows are pulled toward the center horizontally.
          const px = width / 2 + (xn - 0.5) * width * (0.92 + zn * 0.16);
          const py = centerY + rowOffset - h * amp * scale;
          // Crest dots are a little brighter, like light catching the wave.
          const alpha = Math.min(1, alphaRow * (0.75 + Math.max(h, 0) * 0.4));
          const [cr, cg, cb] = gradientAt(xn * 0.85 + Math.sin(t * 0.2 + zn) * 0.08 + 0.05);
          ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const loop = (now: number) => {
      elapsed = (now - start) / 1000;
      draw(elapsed);
      frame = requestAnimationFrame(loop);
    };

    const play = () => {
      if (running || reduceMotion.matches || !visible || document.hidden) return;
      running = true;
      start = performance.now() - elapsed * 1000;
      frame = requestAnimationFrame(loop);
    };

    const pause = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const refresh = () => {
      resize();
      if (!running) draw(elapsed || 4);
    };

    refresh();
    play();

    const ro = new ResizeObserver(refresh);
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) play();
      else pause();
    });
    io.observe(canvas);

    const onVisibility = () => (document.hidden ? pause() : play());
    const onMotionChange = () => {
      if (reduceMotion.matches) {
        pause();
        draw(elapsed || 4);
      } else play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    reduceMotion.addEventListener('change', onMotionChange);

    return () => {
      pause();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduceMotion.removeEventListener('change', onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}

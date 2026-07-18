import { useEffect, useRef } from "react";

/**
 * ConstellationBg — a Canvas 2D drifting node field (28 nodes, links under
 * 90px, one node periodically flashes red). Ported from the proven mockup
 * algorithm (scratchpad/onboarding-mockup.html). Purely decorative —
 * `aria-hidden` — and safe under jsdom (no real canvas: `getContext` can
 * return null; the effect no-ops in that case).
 */
export function ConstellationBg({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = ref.current;
    const ctx = cvs?.getContext("2d");
    if (!cvs || !ctx) return; // jsdom / no-canvas guard

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    let W = 0;
    let H = 0;
    let raf = 0;
    let redIdx = 0;
    let redTimer: number | undefined;
    let dots: { x: number; y: number; vx: number; vy: number; r: number; o: number }[] = [];

    const size = () => {
      const r = cvs.getBoundingClientRect();
      W = cvs.width = r.width * dpr;
      H = cvs.height = r.height * dpr;
    };
    const init = () => {
      dots = Array.from({ length: 28 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.72 * dpr,
        vy: (Math.random() - 0.5) * 0.72 * dpr,
        r: (0.8 + Math.random() * 1.8) * dpr,
        o: 0.15 + Math.random() * 0.15,
      }));
    };
    const hop = () => {
      redIdx = Math.floor(Math.random() * dots.length);
      redTimer = window.setTimeout(hop, 3000 + Math.random() * 4000);
    };
    const MAXD = 90 * dpr;
    const frame = () => {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.x = (d.x + d.vx + W) % W;
        d.y = (d.y + d.vy + H) % H;
        for (let j = i + 1; j < dots.length; j++) {
          const e = dots[j];
          const dist = Math.hypot(d.x - e.x, d.y - e.y);
          if (dist < MAXD) {
            ctx.strokeStyle = `rgba(255,255,255,${0.05 * (1 - dist / MAXD)})`;
            ctx.lineWidth = 0.5 * dpr;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(e.x, e.y);
            ctx.stroke();
          }
        }
      }
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        ctx.beginPath();
        if (i === redIdx) {
          ctx.fillStyle = "rgba(209,58,38,0.7)";
          ctx.shadowBlur = 6 * dpr;
          ctx.shadowColor = "#D13A26";
          ctx.arc(d.x, d.y, 3 * dpr, 0, 7);
        } else {
          ctx.fillStyle = `rgba(255,255,255,${d.o})`;
          ctx.shadowBlur = 0;
          ctx.arc(d.x, d.y, d.r, 0, 7);
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    };

    size();
    init();
    if (!reduce) {
      hop();
      frame();
    } else {
      // Reduced motion: paint one static frame, no rAF loop, no red-node hop.
      frame();
      cancelAnimationFrame(raf);
    }

    const onResize = () => {
      size();
      init();
    };
    window.addEventListener("resize", onResize);

    // React to container/canvas layout changes too — window resize alone
    // misses cases where only the surrounding layout changes.
    const ro = new ResizeObserver(onResize);
    ro.observe(cvs);

    return () => {
      cancelAnimationFrame(raf);
      if (redTimer) clearTimeout(redTimer);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, display: "block", zIndex: 0 }}
    />
  );
}

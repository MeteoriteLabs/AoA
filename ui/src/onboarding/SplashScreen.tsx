import { useEffect, useRef } from "react";
import { AoaLogo, ConstellationBg, usePrefersReducedMotion, useTypewriter } from "./motion";

const SPLASH_TEXT = "Assembling your workforce…";
const TYPE_MS_PER_CHAR = 55;
const DONE_DELAY_MS = 500;

/**
 * SplashScreen — the one-time boot sequence shown before the auth card on a
 * visitor's first visit to /auth: constellation background + the animated
 * AoA wordmark + a typewritten mono status line. Ported from screen S0 of
 * scratchpad/onboarding-mockup.html.
 *
 * Calls `onDone` once the sequence finishes so the caller can reveal the
 * auth card and persist the "seen" flag. Under `prefers-reduced-motion:
 * reduce`, `useTypewriter` returns the full string on the first render, so
 * `onDone` fires on the next tick instead of after the type + pause.
 */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const reduce = usePrefersReducedMotion();
  const typed = useTypewriter(SPLASH_TEXT, TYPE_MS_PER_CHAR);
  const firedRef = useRef(false);
  const typingDone = typed.length >= SPLASH_TEXT.length;

  useEffect(() => {
    if (firedRef.current || !typingDone) return;
    const delay = reduce ? 0 : DONE_DELAY_MS;
    const timer = setTimeout(() => {
      firedRef.current = true;
      onDone();
    }, delay);
    return () => clearTimeout(timer);
  }, [typingDone, reduce, onDone]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      <ConstellationBg />
      <div className="relative z-10 flex flex-col items-center gap-[22px]">
        <AoaLogo size={64} />
        <div className="font-mono text-sm" style={{ color: "var(--dim)", minHeight: 20 }}>
          <span>{typed}</span>
          <span aria-hidden="true" className="ml-0.5 animate-pulse" style={{ opacity: 0.7 }}>
            ▌
          </span>
        </div>
      </div>
    </div>
  );
}

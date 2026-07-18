/**
 * LoadingDots — 3-dot widget (red bounce while loading, green glow when
 * done). CSS rules for `.dots`/`.dots.loading`/`.dots.done` live in
 * motion.css. Decorative — aria-hidden (callers pair it with adjacent
 * status text, e.g. VerifyStep's "Verifying your engine…").
 */
export function LoadingDots({ state }: { state: "idle" | "loading" | "done" }) {
  return (
    <span className={`dots ${state}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

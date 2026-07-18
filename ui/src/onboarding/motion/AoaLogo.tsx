/**
 * AoaLogo — animated wordmark: "A" + a spinning "o" ring + "A" + a
 * breathing red dot. Decorative; carries its own accessible name via
 * role="img" + aria-label so the individual spans aren't exposed as text.
 */
export function AoaLogo({ size = 40, hideDot = false }: { size?: number; hideDot?: boolean }) {
  const s = `${size}px`;
  return (
    <span
      className="obd-logo"
      role="img"
      aria-label="AoA"
      style={{
        fontSize: s,
        display: "inline-flex",
        alignItems: "center",
        gap: ".06em",
        fontWeight: 800,
        letterSpacing: "-.03em",
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">A</span>
      <span
        data-part="ring"
        aria-hidden="true"
        style={{
          width: ".60em",
          height: ".60em",
          borderRadius: "50%",
          border: ".12em solid var(--text)",
          borderRightColor: "transparent",
          borderBottomColor: "transparent",
          animation: "obd-spin 5s linear infinite",
        }}
      />
      <span aria-hidden="true">A</span>
      {!hideDot && (
        <span
          data-part="dot"
          aria-hidden="true"
          style={{
            width: ".15em",
            height: ".15em",
            borderRadius: "50%",
            background: "var(--glow-red)",
            alignSelf: "flex-end",
            marginBottom: ".12em",
            animation: "obd-breathe 2s ease-in-out infinite",
          }}
        />
      )}
    </span>
  );
}

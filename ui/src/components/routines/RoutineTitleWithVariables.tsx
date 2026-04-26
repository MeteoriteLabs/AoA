interface Props {
  template: string;
  /**
   * Optional className applied to chip elements. Default uses primary tinting.
   */
  chipClassName?: string;
  /**
   * Optional className applied to the wrapping span.
   */
  className?: string;
}

const VARIABLE_TOKEN_RE = /(\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\})/g;
const VARIABLE_NAME_RE = /^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/;

export function RoutineTitleWithVariables({
  template,
  chipClassName,
  className,
}: Props) {
  if (!template) return null;
  const parts = template.split(VARIABLE_TOKEN_RE);
  return (
    <span className={className ?? "inline-flex flex-wrap items-baseline gap-1"}>
      {parts.map((part, i) => {
        const m = part.match(VARIABLE_NAME_RE);
        if (m) {
          return (
            <span
              key={i}
              className={
                chipClassName ??
                "inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
              }
            >
              {m[1]}
            </span>
          );
        }
        return part ? <span key={i}>{part}</span> : null;
      })}
    </span>
  );
}

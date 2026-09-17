/** A tile in the open-panels overview. Ordered by the immutable openedOrdinal
 * (creation order), never the controller's focus/z-order list. */
export interface OpenPanelTile {
  key: string;
  title: string;
  kind: string;
  openedOrdinal: number;
  minimized: boolean;
}

export function OpenPanelsOverview({
  panels,
  onOpen,
}: {
  panels: OpenPanelTile[];
  onOpen: (key: string) => void;
}) {
  const ordered = [...panels].sort((a, b) => a.openedOrdinal - b.openedOrdinal);
  if (ordered.length === 0)
    return (
      <p role="status" className="universe-overview-empty">
        No open panels.
      </p>
    );
  return (
    <ul className="universe-overview" role="list">
      {ordered.map((panel) => (
        <li key={panel.key}>
          <button
            type="button"
            className="universe-overview-tile"
            data-minimized={panel.minimized}
            onClick={() => onOpen(panel.key)}
          >
            {/* Android-recents-style thumbnail. Real authorized content capture
             * is the deferred E1.4/2 hover preview; this is a window proxy. */}
            <span
              className="universe-overview-thumb"
              data-kind={panel.kind}
              aria-hidden
            >
              <span className="universe-overview-thumb-bar" />
              <span className="universe-overview-thumb-lines">
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="universe-overview-meta">
              <span className="universe-overview-title">{panel.title}</span>
              <span className="universe-overview-kind">
                {panel.minimized ? `${panel.kind} · minimized` : panel.kind}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

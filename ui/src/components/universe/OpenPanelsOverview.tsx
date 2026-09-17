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
            <span className="universe-overview-title">{panel.title}</span>
            <span className="universe-overview-kind">
              {panel.minimized ? `${panel.kind} · minimized` : panel.kind}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

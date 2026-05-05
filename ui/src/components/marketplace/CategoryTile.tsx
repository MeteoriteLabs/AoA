import { Link } from "react-router-dom";

export interface CategoryTileProps {
  category: string;
  count: number;
}

export function CategoryTile({ category, count }: CategoryTileProps) {
  const label = category.charAt(0).toUpperCase() + category.slice(1);

  return (
    <Link
      to={`/marketplace/search?q=&category=${encodeURIComponent(category)}`}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h4 className="font-medium">{label}</h4>
      <p className="text-xs text-muted-foreground mt-1">{count}</p>
    </Link>
  );
}

import { useParams } from "@/lib/router";

export default function MarketplaceType() {
  const { type } = useParams<{ type: string }>();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Type: {type} (M.3a stub)</h1>
    </div>
  );
}

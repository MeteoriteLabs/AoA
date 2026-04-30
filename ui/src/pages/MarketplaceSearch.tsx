import { useSearchParams } from "@/lib/router";

export default function MarketplaceSearch() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Search: "{q}" (M.3a stub)</h1>
    </div>
  );
}

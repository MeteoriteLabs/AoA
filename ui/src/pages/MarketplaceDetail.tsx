import { useParams } from "@/lib/router";

export default function MarketplaceDetail() {
  const params = useParams<{ type: string; slug: string; "*": string }>();
  // Splat preserves slashes — combine slug + rest
  const fullSlug = params["*"] ? `${params.slug}/${params["*"]}` : params.slug;
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">
        {params.type}: {fullSlug} (M.3a stub)
      </h1>
    </div>
  );
}

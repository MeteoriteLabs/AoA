import { LLMProvidersSection } from "@/components/LLMProvidersSection";

export function LLMProvidersSectionWrapper() {
  return (
    <div>
      {/* Section header */}
      <div className="px-8 pt-6 pb-3 border-b border-border">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
          Settings · Operations
        </div>
        <h2 className="text-[1.4rem] font-bold tracking-tight mt-1">
          Memory<span className="text-brand">.</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          API key for the embeddings model — used only for semantic memory search.
        </p>
      </div>
      <div className="p-8">
        <LLMProvidersSection />
      </div>
    </div>
  );
}

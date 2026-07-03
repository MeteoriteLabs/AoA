export type ScopeCompilerEntry = {
  id: string;
  seq: number;
  inputType: string;
  rawContent: string | null;
};

export type ScopeCompilerExtractedItem = {
  id: string;
  discussionEntryId: string;
  type: string;
  title: string;
  description?: string | null;
  suggestedPriority?: string | null;
  suggestedAssigneeId?: string | null;
  suggestedDepartmentId?: string | null;
  suggestedProjectId?: string | null;
  suggestedLayer?: string | null;
  suggestedGoalId?: string | null;
  payload?: Record<string, unknown> | null;
  status?: string | null;
};

export type ScopeCompilerAttachment = {
  entryId: string;
  artifactId?: string | null;
  artifactVersionId?: string | null;
  assetId?: string | null;
  title?: string | null;
  contentType?: string | null;
  kind: "artifact" | "asset";
};

export type CompiledScopeItem = {
  kind:
    | "task_proposal"
    | "task_change"
    | "memory_candidate"
    | "artifact_link"
    | "decision"
    | "assumption"
    | "open_question"
    | "source_signal";
  title: string;
  description: string | null;
  payload: Record<string, unknown>;
  sourceEntryIds: string[];
  extractedItemId?: string | null;
  artifactId?: string | null;
  artifactVersionId?: string | null;
};

export type CompiledThreadScopeDraft = {
  summary: string;
  assumptions: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  openQuestions: Array<Record<string, unknown>>;
  items: CompiledScopeItem[];
};

type CompileInput = {
  threadTitle: string | null;
  summaryText: string | null;
  entries: ScopeCompilerEntry[];
  extractedItems: ScopeCompilerExtractedItem[];
  attachments?: ScopeCompilerAttachment[];
  /** Adjutant-supplied tasks (already role-resolved). When present + non-empty,
   *  these become the task_proposal items and suppress the synthetic placeholder. */
  proposedTasks?: Array<{ title: string; assigneeAgentId?: string | null }>;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function firstSentence(value: string): string {
  const match = value.match(/^(.{1,220}?)(?:[.!?]\s|$)/);
  return (match?.[1] ?? value.slice(0, 220)).trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, maxLength + 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function compactRangeSummary(values: string[], maxLength = 420): string {
  const highlights = values.map(firstSentence).filter(Boolean).slice(0, 4);
  return truncateAtWord(highlights.join(" "), maxLength);
}

function entryIds(entries: ScopeCompilerEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

function titleForGeneratedTask(entries: ScopeCompilerEntry[]): string {
  const combined = entries.map((entry) => cleanText(entry.rawContent)).join(" ").toLowerCase();
  if (combined.includes("scope")) return "Implement real multi-message scope generation";
  if (combined.includes("crew")) return "Implement crew discussion roundtable flow";
  return "Turn discussion into a scoped work package";
}

function memoryCandidateTitle(entries: ScopeCompilerEntry[]): string {
  const combined = entries.map((entry) => cleanText(entry.rawContent)).join(" ");
  if (/decision rule/i.test(combined)) return "Decision rule from scoped discussion";
  if (/durable memory/i.test(combined)) return "Durable memory from scoped discussion";
  return "Scoped discussion memory";
}

function shouldSynthesizeMemoryCandidate(input: {
  lower: string;
  items: CompiledScopeItem[];
}): boolean {
  if (input.items.some((item) => item.kind === "memory_candidate")) return false;

  const mentionsMemoryCandidate = /memory candidate/.test(input.lower);
  const mentionsDurableMemory = /durable memory/.test(input.lower);
  const asksToSaveMemory = /\b(save|store|preserve|remember)\b.{0,80}\bmemory\b/.test(input.lower);
  const asksToScopeMemory = /\bscope\b.{0,120}\bmemory\b/.test(input.lower);
  const hasDecisionSignal = /\b(decision|rule|preference|policy|principle)\b/.test(input.lower);

  return (
    mentionsMemoryCandidate ||
    mentionsDurableMemory ||
    asksToSaveMemory ||
    asksToScopeMemory
  ) && hasDecisionSignal;
}

function makeSummary(input: CompileInput): string {
  const explicit = cleanText(input.summaryText);
  const entryText = input.entries.map((entry) => cleanText(entry.rawContent)).filter(Boolean);
  if (explicit && entryText.length > 0) {
    return truncateAtWord(`${explicit} ${compactRangeSummary(entryText, 320)}`, 520);
  }
  if (explicit) return truncateAtWord(explicit, 520);

  if (entryText.length > 0) {
    return compactRangeSummary(entryText);
  }

  return cleanText(input.threadTitle) || "Draft scope from this thread";
}

function mapExtractedItem(item: ScopeCompilerExtractedItem): CompiledScopeItem {
  const sourceEntryIds = [item.discussionEntryId];
  if (item.type === "task") {
    return {
      kind: "task_proposal",
      title: item.title,
      description: item.description ?? null,
      sourceEntryIds,
      extractedItemId: item.id,
      payload: {
        priority: item.suggestedPriority ?? "medium",
        assigneeAgentId: item.suggestedAssigneeId ?? null,
        departmentId: item.suggestedDepartmentId ?? null,
        projectId: item.suggestedProjectId ?? null,
        goalId: item.suggestedGoalId ?? null,
      },
    };
  }

  if (item.type === "artifact") {
    // Extraction does not emit artifact ids today, and discussion_extracted_items
    // has no `payload` column to read one from — so an artifact-typed extracted
    // item always degrades to an evidence source_signal. Concrete artifact links
    // still flow through the attachment join (compileAttachmentItem).
    return {
      kind: "source_signal",
      title: item.title,
      description: item.description ?? null,
      sourceEntryIds,
      extractedItemId: item.id,
      payload: { role: "evidence", category: "artifact" },
    };
  }

  if (item.type === "decision") {
    return {
      kind: "decision",
      title: item.title,
      description: item.description ?? null,
      sourceEntryIds,
      extractedItemId: item.id,
      payload: {},
    };
  }

  return {
    kind: "memory_candidate",
    title: item.title,
    description: item.description ?? null,
    sourceEntryIds,
    extractedItemId: item.id,
    payload: {
      layer: item.suggestedLayer ?? "domain",
      category: item.type,
      departmentId: item.suggestedDepartmentId ?? null,
      goalId: item.suggestedGoalId ?? null,
    },
  };
}

function proposedTaskItems(
  proposedTasks: Array<{ title: string; assigneeAgentId?: string | null }>,
  entries: ScopeCompilerEntry[],
): CompiledScopeItem[] {
  const sourceEntryIds = entryIds(entries);
  return proposedTasks.map((t) => ({
    kind: "task_proposal" as const,
    title: cleanText(t.title),
    description: null,
    sourceEntryIds,
    payload: { priority: "medium", assigneeAgentId: t.assigneeAgentId ?? null },
  }));
}

function compileAttachmentItem(attachment: ScopeCompilerAttachment): CompiledScopeItem {
  if (attachment.kind === "artifact" && attachment.artifactId) {
    return {
      kind: "artifact_link",
      title: cleanText(attachment.title) || "Attached artifact",
      description: attachment.contentType ? `Attached ${attachment.contentType} artifact.` : "Attached artifact.",
      payload: {
        role: "reference",
        contentType: attachment.contentType ?? null,
      },
      sourceEntryIds: [attachment.entryId],
      artifactId: attachment.artifactId,
      artifactVersionId: attachment.artifactVersionId ?? null,
    };
  }

  return {
    kind: "source_signal",
    title: cleanText(attachment.title) || "Attached evidence",
    description: attachment.contentType ? `Attached ${attachment.contentType} source.` : "Attached source evidence.",
    payload: {
      role: "evidence",
      assetId: attachment.assetId ?? null,
      contentType: attachment.contentType ?? null,
    },
    sourceEntryIds: [attachment.entryId],
  };
}

function compileUrlSignalItems(entries: ScopeCompilerEntry[]): CompiledScopeItem[] {
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const byUrl = new Map<string, CompiledScopeItem>();

  for (const entry of entries) {
    const rawContent = entry.rawContent ?? "";
    const urls = rawContent.match(urlPattern) ?? [];
    for (const rawUrl of urls) {
      const url = rawUrl.replace(/[.,;:!?]+$/g, "");
      if (!url) continue;

      const existing = byUrl.get(url);
      if (existing) {
        if (!existing.sourceEntryIds.includes(entry.id)) {
          existing.sourceEntryIds.push(entry.id);
        }
        continue;
      }

      byUrl.set(url, {
        kind: "source_signal",
        title: `Source: ${url}`,
        description: "URL referenced in the scoped discussion.",
        payload: { role: "evidence", url },
        sourceEntryIds: [entry.id],
      });
    }
  }

  return [...byUrl.values()];
}

export function compileThreadScopeDraft(input: CompileInput): CompiledThreadScopeDraft {
  const scopedEntries = input.entries.filter((entry) => cleanText(entry.rawContent));
  const allEntryIds = entryIds(scopedEntries);
  const summary = makeSummary({ ...input, entries: scopedEntries });
  const combined = scopedEntries.map((entry) => cleanText(entry.rawContent)).join(" ");
  const lower = combined.toLowerCase();

  // D1: when proposedTasks are present + non-empty, they are the ONLY source of
  // task_proposal items — extracted task_proposals AND the placeholder are suppressed.
  const useProposedTasks = Boolean(input.proposedTasks && input.proposedTasks.length > 0);

  // Place 1: extracted-item mapping — skip items that would emit task_proposal when useProposedTasks.
  const extractedCompiled = input.extractedItems
    .map(mapExtractedItem)
    .filter((it) => !(useProposedTasks && it.kind === "task_proposal"));

  const items = [
    ...extractedCompiled,
    ...(input.attachments ?? []).map(compileAttachmentItem),
    ...compileUrlSignalItems(scopedEntries),
  ];

  const hasGeneratedWorkItem = items.some(
    (item) => item.kind !== "artifact_link" && item.kind !== "source_signal",
  );
  // Place 2: placeholder synthesis — guarded by !useProposedTasks.
  if (scopedEntries.length > 0 && !hasGeneratedWorkItem && !useProposedTasks) {
    items.push({
      kind: "task_proposal",
      title: titleForGeneratedTask(scopedEntries),
      description: summary,
      payload: { priority: "medium" },
      sourceEntryIds: allEntryIds,
    });
  }

  // Place 3: emit proposed tasks when useProposedTasks.
  if (useProposedTasks) {
    items.push(...proposedTaskItems(input.proposedTasks!, scopedEntries));
  }

  if (scopedEntries.length > 0 && shouldSynthesizeMemoryCandidate({ lower, items })) {
    items.push({
      kind: "memory_candidate",
      title: memoryCandidateTitle(scopedEntries),
      description: summary,
      payload: {
        layer: "domain",
        category: "decision",
      },
      sourceEntryIds: allEntryIds,
    });
  }

  const decisions: Array<Record<string, unknown>> = [];
  if (lower.includes("accepted scope") || lower.includes("v2") || lower.includes("source of truth")) {
    const matchingEntryIds = scopedEntries
      .filter((entry) => {
        const text = cleanText(entry.rawContent).toLowerCase();
        return text.includes("accepted scope") || text.includes("v2") || text.includes("source of truth");
      })
      .map((entry) => entry.id);
    decisions.push({
      title: "Use versioned scope as the accepted handoff source of truth",
      description: "Accepted scope versions should anchor downstream tasks and later re-scope cycles.",
      sourceEntryIds: matchingEntryIds.length > 0 ? matchingEntryIds : allEntryIds,
    });
    if (!items.some((item) => item.kind === "memory_candidate" && /accepted scope/i.test(item.title))) {
      items.push({
        kind: "memory_candidate",
        title: "Accepted scope versions are handoff source of truth",
        description: "Store accepted scope versions as durable context for future agent work.",
        payload: { layer: "domain", category: "decision" },
        sourceEntryIds: matchingEntryIds.length > 0 ? matchingEntryIds : allEntryIds,
      });
    }
  }

  const openQuestions: Array<Record<string, unknown>> = [];
  if (lower.includes("memory") && (lower.includes("retrievable") || lower.includes("agent"))) {
    const matchingEntryIds = scopedEntries
      .filter((entry) => {
        const text = cleanText(entry.rawContent).toLowerCase();
        return text.includes("memory") || text.includes("retrievable") || text.includes("agent");
      })
      .map((entry) => entry.id);
    openQuestions.push({
      title: "How will memory retrieval be verified during agent task execution?",
      description: "Scope should not write memory that later agents cannot retrieve and use.",
      sourceEntryIds: matchingEntryIds.length > 0 ? matchingEntryIds : allEntryIds,
    });
  }

  if (decisions.length === 0 && input.extractedItems.some((item) => item.type === "decision")) {
    decisions.push(
      ...input.extractedItems
        .filter((item) => item.type === "decision")
        .map((item) => ({
          title: item.title,
          description: item.description ?? null,
          sourceEntryIds: [item.discussionEntryId],
        })),
    );
  }

  return {
    summary,
    assumptions: [],
    decisions,
    openQuestions,
    items,
  };
}

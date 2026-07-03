import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RuntimeDecisionDetail } from "@armyofagents/shared";
import { agentRuntimeDecisionsApi } from "@/api/agent-runtime-decisions";
import type { HubItemListRow } from "@/api/hub-items";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";

export function RuntimeDecisionPanel({ item }: { item: HubItemListRow }) {
  const queryClient = useQueryClient();
  const [answerText, setAnswerText] = useState("");
  const decisionId = item.sourceId;
  const detailQuery = useQuery({
    queryKey: decisionId
      ? queryKeys.agentRuntimeDecisions.detail(item.companyId, decisionId)
      : ["agent-runtime-decisions", item.companyId, "missing"],
    queryFn: () => agentRuntimeDecisionsApi.detail(item.companyId, decisionId!),
    enabled: Boolean(decisionId),
  });
  const detail = detailQuery.data;
  const answerMutation = useMutation({
    mutationFn: (payload: Parameters<typeof agentRuntimeDecisionsApi.answer>[2]) =>
      agentRuntimeDecisionsApi.answer(item.companyId, decisionId!, payload),
    onSuccess: async () => {
      await Promise.all([
        decisionId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.agentRuntimeDecisions.detail(item.companyId, decisionId),
            })
          : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: ["hub-items", item.companyId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.hubItems.counts(item.companyId) }),
      ]);
    },
  });

  if (!decisionId) {
    return (
      <section className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
        Runtime decision source is unavailable.
      </section>
    );
  }
  if (detailQuery.isLoading) {
    return <section className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">Loading decision...</section>;
  }
  if (detailQuery.isError || !detail) {
    return <section className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">Decision details unavailable.</section>;
  }

  const disabled =
    answerMutation.isPending ||
    (detail.status !== "created" && detail.status !== "shown" && detail.status !== "relay_failed");
  const submitPermission = (decision: "allow_once" | "allow_always" | "deny") => {
    answerMutation.mutate({
      kind: "permission",
      decision,
      expectedSourceRevision: detail.sourceRevision,
      nonce: detail.nonce,
    });
  };
  const submitQuestion = () => {
    if (!answerText.trim()) return;
    answerMutation.mutate({
      kind: "work_question",
      answer: { text: answerText.trim() },
      expectedSourceRevision: detail.sourceRevision,
      nonce: detail.nonce,
    });
  };

  return (
    <section className="mt-5 border-t border-border pt-4" aria-label="Runtime decision">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {detail.kind === "permission" ? "Permission" : "Question"}
        </h3>
        <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {runtimeDecisionStatusLabel(detail.status)}
        </span>
      </div>
      {detail.promptText ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text">{detail.promptText}</p>
      ) : null}
      <RuntimeDecisionFacts detail={detail} />
      {detail.kind === "permission" ? (
        <div className="mt-4 grid gap-2">
          <Button type="button" size="sm" disabled={disabled} onClick={() => submitPermission("allow_once")}>
            Allow once
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => submitPermission("allow_always")}>
            Allow always
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => submitPermission("deny")}>
            Deny
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          <textarea
            aria-label="Work question answer"
            value={answerText}
            disabled={disabled}
            onChange={(event) => setAnswerText(event.target.value)}
            className="min-h-24 resize-y rounded border border-border bg-bg p-2 text-sm"
          />
          <Button type="button" size="sm" disabled={disabled || !answerText.trim()} onClick={submitQuestion}>
            Send answer
          </Button>
        </div>
      )}
      {answerMutation.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Failed to answer decision.
        </p>
      ) : null}
    </section>
  );
}

function RuntimeDecisionFacts({ detail }: { detail: RuntimeDecisionDetail }) {
  const rows = [
    ["Tool", detail.toolName],
    ["Command", detail.command],
    ["Path", detail.path],
    ["Network", detail.networkTarget],
    ["Risk", detail.riskClass],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  if (rows.length === 0) return null;
  return (
    <dl className="mt-4 grid gap-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function runtimeDecisionStatusLabel(status: string) {
  return status.replace(/_/g, " ");
}

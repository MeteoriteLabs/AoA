import { Link2 } from "lucide-react";
import type { CompanySecret, CompanySecretBinding } from "@armyofagents/shared";
import { Badge } from "@/components/ui/badge";

interface SecretBindingsTabProps {
  bindings: CompanySecretBinding[];
  secrets: CompanySecret[];
  errorMessage?: string | null;
}

function targetLabel(targetType: CompanySecretBinding["targetType"]) {
  return targetType.replace(/_/g, " ");
}

export function SecretBindingsTab({ bindings, secrets, errorMessage }: SecretBindingsTabProps) {
  const secretNameById = new Map(secrets.map((secret) => [secret.id, secret.name]));

  if (errorMessage) {
    return (
      <section className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <p>Failed to load bindings for this secret.</p>
        <p className="mt-1 text-xs text-destructive/80">{errorMessage}</p>
      </section>
    );
  }

  if (bindings.length === 0) {
    return (
      <section className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-border bg-card px-6 py-10 text-center">
        <Link2 className="mb-3 size-8 text-muted-foreground/40" />
        <h3 className="text-sm font-semibold">No bindings for this secret</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Bindings will appear here when agents, environments, routines, or other targets reference this secret.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-accent/20 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Target id</th>
              <th className="px-3 py-2 font-medium">Config path</th>
              <th className="px-3 py-2 font-medium">Secret</th>
              <th className="px-3 py-2 font-medium">Required</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((binding) => (
              <tr key={binding.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2">
                  <Badge variant="outline" className="capitalize">
                    {targetLabel(binding.targetType)}
                  </Badge>
                </td>
                <td className="max-w-[190px] px-3 py-2">
                  <div className="truncate font-mono text-xs">{binding.targetId}</div>
                </td>
                <td className="max-w-[220px] px-3 py-2">
                  <div className="truncate font-mono text-xs">{binding.configPath}</div>
                </td>
                <td className="max-w-[180px] px-3 py-2">
                  <div className="truncate">{secretNameById.get(binding.secretId) ?? binding.secretId}</div>
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{binding.required ? "Required" : "Optional"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

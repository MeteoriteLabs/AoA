import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanySecret,
  CompanySecretBinding,
  CompanySecretProviderConfig,
  SecretBindingTargetType,
  SecretProvider,
} from "@armyofagents/shared";
import {
  Activity,
  Cloud,
  CloudDownload,
  KeyRound,
  Link2,
  Plus,
  RotateCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { ImportFromVaultDialog } from "@/pages/secrets/ImportFromVaultDialog";
import { secretsApi } from "@/api/secrets";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const TARGET_TYPES: SecretBindingTargetType[] = [
  "agent",
  "project",
  "environment",
  "routine",
  "system",
  "plugin",
  "issue",
  "run",
];

type SecretWithCount = CompanySecret & { referenceCount?: number };

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function providerLabel(provider: SecretProvider) {
  if (provider === "aws_secrets_manager") return "AWS Secrets Manager";
  if (provider === "gcp_secret_manager") return "GCP Secret Manager";
  if (provider === "vault") return "HashiCorp Vault";
  return "Local encrypted";
}

function modeLabel(mode: CompanySecret["managedMode"]) {
  return mode === "external_reference" ? "External reference" : "AoA managed";
}

function configSummary(config: CompanySecretProviderConfig) {
  if (config.provider === "aws_secrets_manager") {
    const region = typeof config.config.region === "string" ? config.config.region : "region unset";
    const prefix = typeof config.config.secretNamePrefix === "string" ? config.config.secretNamePrefix : null;
    return prefix ? `${region} / ${prefix}` : region;
  }
  return providerLabel(config.provider);
}

function providerStatus(status: string | undefined) {
  if (status === "ready") return "active";
  if (status === "warning") return "pending";
  if (status === "coming_soon") return "planned";
  if (status === "disabled") return "archived";
  return status ?? "planned";
}

function secretStatus(status: string | undefined) {
  return status ?? "active";
}

export function Secrets() {
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [providerForm, setProviderForm] = useState({
    displayName: "Production AWS",
    region: "us-east-1",
    secretNamePrefix: "aoa/prod",
    kmsKeyId: "",
    ownerTag: "",
    environmentTag: "",
    isDefault: true,
  });
  const [secretForm, setSecretForm] = useState({
    name: "",
    key: "",
    value: "",
    description: "",
    providerConfigId: "local",
    managedMode: "aoa_managed" as CompanySecret["managedMode"],
    externalRef: "",
  });
  const [bindingForm, setBindingForm] = useState({
    targetType: "agent" as SecretBindingTargetType,
    targetId: "",
    configPath: "env.OPENAI_API_KEY",
    label: "",
    required: true,
  });
  const [rotationValue, setRotationValue] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Secrets" }]);
    setSubtitle("Provider vaults, bindings, and audit trail");
    setEntityColor(null);
    return () => {
      setBreadcrumbs([]);
      setSubtitle(null);
      setEntityColor(null);
    };
  }, [setBreadcrumbs, setEntityColor, setSubtitle]);

  const providersQuery = useQuery({
    queryKey: queryKeys.secrets.providers(selectedCompanyId ?? ""),
    queryFn: () => secretsApi.providers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const configsQuery = useQuery({
    queryKey: queryKeys.secrets.providerConfigs(selectedCompanyId ?? ""),
    queryFn: () => secretsApi.providerConfigs.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const secretsQuery = useQuery({
    queryKey: queryKeys.secrets.list(selectedCompanyId ?? ""),
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const secrets = (secretsQuery.data ?? []) as SecretWithCount[];
  const providerConfigs = configsQuery.data ?? [];
  const selectedSecret = useMemo(
    () => secrets.find((secret) => secret.id === selectedSecretId) ?? secrets[0] ?? null,
    [secrets, selectedSecretId],
  );

  useEffect(() => {
    if (!selectedSecretId && secrets.length > 0) setSelectedSecretId(secrets[0].id);
    if (selectedSecretId && secrets.length > 0 && !secrets.some((secret) => secret.id === selectedSecretId)) {
      setSelectedSecretId(secrets[0].id);
    }
  }, [secrets, selectedSecretId]);

  const bindingsQuery = useQuery({
    queryKey: queryKeys.secrets.bindings(selectedSecret?.id ?? ""),
    queryFn: () => secretsApi.bindings.list(selectedSecret!.id),
    enabled: !!selectedSecret,
  });
  const eventsQuery = useQuery({
    queryKey: queryKeys.secrets.accessEvents(selectedSecret?.id ?? ""),
    queryFn: () => secretsApi.accessEvents(selectedSecret!.id),
    enabled: !!selectedSecret,
  });

  const createProviderConfig = useMutation({
    mutationFn: () =>
      secretsApi.providerConfigs.create(selectedCompanyId!, {
        provider: "aws_secrets_manager",
        displayName: providerForm.displayName.trim(),
        isDefault: providerForm.isDefault,
        config: {
          region: providerForm.region.trim(),
          secretNamePrefix: providerForm.secretNamePrefix.trim() || null,
          kmsKeyId: providerForm.kmsKeyId.trim() || null,
          ownerTag: providerForm.ownerTag.trim() || null,
          environmentTag: providerForm.environmentTag.trim() || null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providerConfigs(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providers(selectedCompanyId!) });
      toast.success("Vault saved");
    },
    onError: (err) => toast.error("Vault save failed", { description: err instanceof Error ? err.message : undefined }),
  });

  const checkProviderConfig = useMutation({
    mutationFn: (id: string) => secretsApi.providerConfigs.check(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providerConfigs(selectedCompanyId!) });
      toast.success("Vault checked", { description: result.message ?? result.status });
    },
    onError: (err) => toast.error("Vault check failed", { description: err instanceof Error ? err.message : undefined }),
  });

  const deleteProviderConfig = useMutation({
    mutationFn: (id: string) => secretsApi.providerConfigs.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providerConfigs(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providers(selectedCompanyId!) });
      toast.success("Vault deleted");
    },
    onError: (err) => toast.error("Vault delete failed", { description: err instanceof Error ? err.message : undefined }),
  });

  const createSecret = useMutation({
    mutationFn: () => {
      const config = providerConfigs.find((row) => row.id === secretForm.providerConfigId) ?? null;
      return secretsApi.create(selectedCompanyId!, {
        name: secretForm.name.trim(),
        key: secretForm.key.trim() || null,
        value: secretForm.managedMode === "aoa_managed" ? secretForm.value : null,
        provider: config?.provider ?? "local_encrypted",
        providerConfigId: config?.id ?? null,
        managedMode: secretForm.managedMode,
        description: secretForm.description.trim() || null,
        externalRef: secretForm.managedMode === "external_reference" ? secretForm.externalRef.trim() : null,
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId!) });
      setSelectedSecretId(created.id);
      setSecretForm((current) => ({ ...current, name: "", key: "", value: "", description: "", externalRef: "" }));
      toast.success("Secret saved");
    },
    onError: (err) => toast.error("Secret save failed", { description: err instanceof Error ? err.message : undefined }),
  });

  const rotateSecret = useMutation({
    mutationFn: (secret: CompanySecret) =>
      secretsApi.rotate(secret.id, {
        value: rotationValue,
        externalRef: secret.externalRef,
        providerConfigId: secret.providerConfigId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId!) });
      setRotationValue("");
      toast.success("Secret rotated");
    },
    onError: (err) => toast.error("Rotation failed", { description: err instanceof Error ? err.message : undefined }),
  });

  const deleteSecret = useMutation({
    mutationFn: (id: string) => secretsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId!) });
      setSelectedSecretId(null);
      toast.success("Secret archived");
    },
    onError: (err) => toast.error("Delete failed", { description: err instanceof Error ? err.message : undefined }),
  });

  const createBinding = useMutation({
    mutationFn: (secret: CompanySecret) =>
      secretsApi.bindings.create(secret.id, {
        targetType: bindingForm.targetType,
        targetId: bindingForm.targetId.trim(),
        configPath: bindingForm.configPath.trim(),
        versionSelector: "latest",
        required: bindingForm.required,
        label: bindingForm.label.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.bindings(selectedSecret!.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId!) });
      setBindingForm((current) => ({ ...current, targetId: "", label: "" }));
      toast.success("Binding saved");
    },
    onError: (err) => toast.error("Binding failed", { description: err instanceof Error ? err.message : undefined }),
  });

  const deleteBinding = useMutation({
    mutationFn: (binding: CompanySecretBinding) => secretsApi.bindings.remove(binding.id),
    onSuccess: () => {
      if (selectedSecret) queryClient.invalidateQueries({ queryKey: queryKeys.secrets.bindings(selectedSecret.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId!) });
      toast.success("Binding removed");
    },
    onError: (err) => toast.error("Remove failed", { description: err instanceof Error ? err.message : undefined }),
  });

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <EmptyState icon={KeyRound} message="Select a company" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Secrets</h1>
          <p className="text-sm text-muted-foreground">Provider vaults, runtime bindings, and read audit events.</p>
        </div>
        <Button type="button" onClick={() => setImportOpen(true)} disabled={providerConfigs.length === 0}>
          <CloudDownload className="size-4" />
          Import
        </Button>
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <section className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Provider Vaults</h2>
              <Badge variant="outline">{providerConfigs.length}</Badge>
            </div>
            <div className="rounded-md border border-border">
              {(providersQuery.data ?? []).map((provider) => (
                <div key={provider.id} className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
                  <Cloud className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{provider.label}</div>
                    <div className="text-xs text-muted-foreground">{provider.id}</div>
                  </div>
                  <StatusBadge status={providerStatus(provider.status)} />
                </div>
              ))}
            </div>
          </div>

          <form
            className="space-y-3 rounded-md border border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              createProviderConfig.mutate();
            }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">AWS vault</h3>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vault-name">Name</Label>
              <Input
                id="vault-name"
                value={providerForm.displayName}
                onChange={(event) => setProviderForm((current) => ({ ...current, displayName: event.target.value }))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-2">
                <Label htmlFor="vault-region">Region</Label>
                <Input
                  id="vault-region"
                  value={providerForm.region}
                  onChange={(event) => setProviderForm((current) => ({ ...current, region: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vault-prefix">Prefix</Label>
                <Input
                  id="vault-prefix"
                  value={providerForm.secretNamePrefix}
                  onChange={(event) => setProviderForm((current) => ({ ...current, secretNamePrefix: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <Input
                aria-label="KMS key id"
                value={providerForm.kmsKeyId}
                onChange={(event) => setProviderForm((current) => ({ ...current, kmsKeyId: event.target.value }))}
                placeholder="KMS key id"
              />
              <Input
                aria-label="Owner tag"
                value={providerForm.ownerTag}
                onChange={(event) => setProviderForm((current) => ({ ...current, ownerTag: event.target.value }))}
                placeholder="Owner tag"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="vault-default"
                checked={providerForm.isDefault}
                onCheckedChange={(checked) => setProviderForm((current) => ({ ...current, isDefault: checked === true }))}
              />
              <Label htmlFor="vault-default">Default</Label>
            </div>
            <Button type="submit" size="sm" disabled={createProviderConfig.isPending}>
              <Plus className="size-3.5" />
              Save
            </Button>
          </form>

          <div className="rounded-md border border-border">
            {providerConfigs.length === 0 ? (
              <div className="px-3 py-5 text-sm text-muted-foreground">No vaults configured</div>
            ) : (
              providerConfigs.map((config) => (
                <div key={config.id} className="border-b border-border px-3 py-2 last:border-b-0">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{config.displayName}</div>
                      <div className="truncate text-xs text-muted-foreground">{configSummary(config)}</div>
                    </div>
                    <StatusBadge status={providerStatus(config.healthStatus ?? config.status)} />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => checkProviderConfig.mutate(config.id)}
                    >
                      Check
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => deleteProviderConfig.mutate(config.id)}
                      title="Delete vault"
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Delete vault</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <main className="min-w-0 space-y-4">
          <form
            className="grid gap-3 rounded-md border border-border p-3 lg:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              createSecret.mutate();
            }}
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:col-span-2">
              <Input
                aria-label="Secret name"
                value={secretForm.name}
                onChange={(event) => setSecretForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Name"
                required
              />
              <Input
                aria-label="Secret key"
                value={secretForm.key}
                onChange={(event) => setSecretForm((current) => ({ ...current, key: event.target.value }))}
                placeholder="Key"
              />
              <Select
                value={secretForm.providerConfigId}
                onValueChange={(value) => setSecretForm((current) => ({ ...current, providerConfigId: value }))}
              >
                <SelectTrigger aria-label="Secret provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local encrypted</SelectItem>
                  {providerConfigs.map((config) => (
                    <SelectItem key={config.id} value={config.id}>
                      {config.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={secretForm.managedMode}
                onValueChange={(value) =>
                  setSecretForm((current) => ({ ...current, managedMode: value as CompanySecret["managedMode"] }))
                }
              >
                <SelectTrigger aria-label="Managed mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aoa_managed">AoA managed</SelectItem>
                  <SelectItem value="external_reference">External reference</SelectItem>
                </SelectContent>
              </Select>
              <Input
                aria-label="Secret value"
                type="password"
                value={secretForm.value}
                onChange={(event) => setSecretForm((current) => ({ ...current, value: event.target.value }))}
                placeholder="Value"
                disabled={secretForm.managedMode === "external_reference"}
              />
              <Input
                aria-label="External reference"
                value={secretForm.externalRef}
                onChange={(event) => setSecretForm((current) => ({ ...current, externalRef: event.target.value }))}
                placeholder="External ref"
                disabled={secretForm.managedMode === "aoa_managed"}
              />
            </div>
            <Textarea
              className="lg:col-span-2"
              value={secretForm.description}
              onChange={(event) => setSecretForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Description"
            />
            <Button type="submit" className="self-start" disabled={createSecret.isPending}>
              <Plus className="size-4" />
              Add
            </Button>
          </form>

          <section className="min-w-0 rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h2 className="text-lg font-semibold">Inventory</h2>
              <Badge variant="outline">{secrets.length}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-accent/20 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Version</th>
                    <th className="px-3 py-2 font-medium">Bindings</th>
                    <th className="px-3 py-2 font-medium">Last read</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {secretsQuery.isLoading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading...</td>
                    </tr>
                  ) : secrets.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No secrets yet</td>
                    </tr>
                  ) : (
                    secrets.map((secret) => (
                      <tr
                        key={secret.id}
                        className={cn(
                          "cursor-pointer border-t border-border hover:bg-accent/50",
                          selectedSecret?.id === secret.id && "bg-accent/50",
                        )}
                        onClick={() => setSelectedSecretId(secret.id)}
                      >
                        <td className="max-w-[180px] px-3 py-2">
                          <div className="truncate font-medium">{secret.name}</div>
                          <div className="truncate font-mono text-xs text-muted-foreground">{secret.key ?? "no key"}</div>
                        </td>
                        <td className="px-3 py-2">{providerLabel(secret.provider)}</td>
                        <td className="px-3 py-2">{modeLabel(secret.managedMode)}</td>
                        <td className="px-3 py-2 font-mono text-xs">v{secret.latestVersion}</td>
                        <td className="px-3 py-2">{secret.referenceCount ?? 0}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(secret.lastResolvedAt)}</td>
                        <td className="px-3 py-2"><StatusBadge status={secretStatus(secret.status)} /></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!rotationValue.trim()) {
                                  toast.warning("Enter a rotation value");
                                  return;
                                }
                                rotateSecret.mutate(secret);
                              }}
                              title="Rotate"
                            >
                              <RotateCw className="size-3.5" />
                              <span className="sr-only">Rotate</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteSecret.mutate(secret.id);
                              }}
                              title="Archive"
                            >
                              <Trash2 className="size-3.5" />
                              <span className="sr-only">Archive</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>

        <aside className="min-w-0 space-y-4">
          {!selectedSecret ? (
            <div className="rounded-md border border-border">
              <EmptyState icon={KeyRound} message="No secret selected" />
            </div>
          ) : (
            <>
              <section className="rounded-md border border-border">
                <div className="border-b border-border px-3 py-2">
                  <h2 className="truncate text-lg font-semibold">{selectedSecret.name}</h2>
                  <div className="truncate font-mono text-xs text-muted-foreground">{selectedSecret.id}</div>
                </div>
                <div className="space-y-1 p-3">
                  <PropertyRow label="Provider" value={providerLabel(selectedSecret.provider)} />
                  <PropertyRow label="Mode" value={modeLabel(selectedSecret.managedMode)} />
                  <PropertyRow label="Latest" value={`v${selectedSecret.latestVersion}`} />
                  <PropertyRow label="Last read" value={formatDate(selectedSecret.lastResolvedAt)} />
                  <PropertyRow label="Status" value={<StatusBadge status={secretStatus(selectedSecret.status)} />} />
                  {selectedSecret.managedMode === "aoa_managed" && (
                    <div className="pt-2">
                      <Input
                        aria-label="Rotation value"
                        type="password"
                        value={rotationValue}
                        onChange={(event) => setRotationValue(event.target.value)}
                        placeholder="Rotation value"
                      />
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-md border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Link2 className="size-4 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Bindings</h2>
                </div>
                <form
                  className="grid gap-2 border-b border-border p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createBinding.mutate(selectedSecret);
                  }}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={bindingForm.targetType}
                      onValueChange={(value) =>
                        setBindingForm((current) => ({ ...current, targetType: value as SecretBindingTargetType }))
                      }
                    >
                      <SelectTrigger aria-label="Binding target type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label="Binding target id"
                      value={bindingForm.targetId}
                      onChange={(event) => setBindingForm((current) => ({ ...current, targetId: event.target.value }))}
                      placeholder="Target id"
                      required
                    />
                    <Input
                      aria-label="Binding config path"
                      value={bindingForm.configPath}
                      onChange={(event) => setBindingForm((current) => ({ ...current, configPath: event.target.value }))}
                      placeholder="Config path"
                      required
                    />
                    <Input
                      aria-label="Binding label"
                      value={bindingForm.label}
                      onChange={(event) => setBindingForm((current) => ({ ...current, label: event.target.value }))}
                      placeholder="Label"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={bindingForm.required}
                        onCheckedChange={(checked) =>
                          setBindingForm((current) => ({ ...current, required: checked === true }))
                        }
                      />
                      Required
                    </label>
                    <Button type="submit" size="sm" disabled={createBinding.isPending}>
                      Bind
                    </Button>
                  </div>
                </form>
                <div>
                  {(bindingsQuery.data ?? []).length === 0 ? (
                    <div className="px-3 py-5 text-sm text-muted-foreground">No bindings</div>
                  ) : (
                    (bindingsQuery.data ?? []).map((binding) => (
                      <div key={binding.id} className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0">
                        <KeyRound className="mt-0.5 size-3.5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{binding.configPath}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {binding.targetType}:{binding.targetId} / {binding.versionSelector}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => deleteBinding.mutate(binding)}
                          title="Remove binding"
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Remove binding</span>
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-md border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Activity className="size-4 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Audit</h2>
                </div>
                <div>
                  {(eventsQuery.data ?? []).length === 0 ? (
                    <div className="px-3 py-5 text-sm text-muted-foreground">No access events</div>
                  ) : (
                    (eventsQuery.data ?? []).map((event) => (
                      <div key={event.id} className="border-b border-border px-3 py-2 last:border-b-0">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={event.outcome === "failure" ? "failed" : "succeeded"} />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {event.consumerType}:{event.consumerId}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {event.actorType}:{event.actorId ?? "system"} / {event.configPath ?? "direct"} / {formatDate(event.createdAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </aside>
      </div>

      <ImportFromVaultDialog
        companyId={selectedCompanyId}
        open={importOpen}
        onOpenChange={setImportOpen}
        providerConfigs={providerConfigs}
      />
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm">{value}</span>
    </div>
  );
}

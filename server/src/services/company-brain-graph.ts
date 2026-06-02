import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  agentProjects,
  agents,
  artifacts,
  companyMemberships,
  goals,
  issues,
  memoryItems,
  memoryRelations,
  projects,
  userRoles,
} from "@armyofagents/db";
import {
  COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND,
  roleAtLeast,
  type CompanyBrainEdge,
  type CompanyBrainEdgeKind,
  type CompanyBrainNeighborsResponse,
  type CompanyBrainNode,
  type CompanyBrainNodeRef,
} from "@armyofagents/shared";
import { notFound } from "../errors.js";

export interface GraphActorScope {
  actorType: "user" | "agent";
  principalId: string;
  role: string;
  departmentIds: string[];
  activeCompanyMember: boolean;
}

export interface MemoryItemGraphRow {
  id: string;
  companyId: string;
  title: string;
  content?: string | null;
  status: string;
  category?: string | null;
  layer: string | null;
  visibility: string;
  departmentId: string | null;
  projectId: string | null;
  goalId: string | null;
  taskId: string | null;
  sourceArtifactId: string | null;
  agentId: string | null;
  folderPath?: string | null;
  createdBy: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface MemoryRelationGraphRow {
  id: string;
  fromItemId: string;
  toItemId: string;
  kind: string;
  createdBy: string;
  createdAt?: Date | string | null;
}

interface LinkedProjectRow {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface LinkedGoalRow {
  id: string;
  title: string;
  status: string;
}

interface LinkedTaskRow {
  id: string;
  title: string;
  status: string;
}

interface LinkedArtifactRow {
  id: string;
  title: string;
  status: string;
}

interface LinkedAgentRow {
  id: string;
  name: string;
  status: string;
}

export interface MemoryItemNeighborGraphInput {
  companyId: string;
  center: MemoryItemGraphRow;
  actor: GraphActorScope;
  relatedItems: MemoryItemGraphRow[];
  semanticRelations: MemoryRelationGraphRow[];
  linked: {
    departments?: LinkedProjectRow[];
    projects?: LinkedProjectRow[];
    goals?: LinkedGoalRow[];
    tasks?: LinkedTaskRow[];
    artifacts?: LinkedArtifactRow[];
    agents?: LinkedAgentRow[];
  };
}

function dateToIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function nodeKey(ref: CompanyBrainNodeRef): string {
  return `${ref.type}:${ref.id}`;
}

function edgeKey(edge: CompanyBrainEdge): string {
  return `${edge.kind}:${nodeKey(edge.from)}:${nodeKey(edge.to)}:${edge.id}`;
}

function isValidEdgeKind(kind: string): kind is CompanyBrainEdgeKind {
  return Object.prototype.hasOwnProperty.call(COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND, kind);
}

function addNode(nodes: Map<string, CompanyBrainNode>, node: CompanyBrainNode): void {
  nodes.set(nodeKey(node), node);
}

function addEdge(edges: Map<string, CompanyBrainEdge>, edge: CompanyBrainEdge): void {
  edges.set(edgeKey(edge), edge);
}

function derivedEdge(input: {
  companyId: string;
  from: CompanyBrainNodeRef;
  to: CompanyBrainNodeRef;
  kind: CompanyBrainEdgeKind;
  id?: string;
  evidence?: string | null;
  metadata?: Record<string, unknown>;
}): CompanyBrainEdge {
  return {
    id: input.id ?? `derived:${nodeKey(input.from)}:${input.kind}:${nodeKey(input.to)}`,
    companyId: input.companyId,
    from: input.from,
    to: input.to,
    kind: input.kind,
    sourceClass: "derived",
    editability: COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND[input.kind],
    evidence: input.evidence ?? null,
    metadata: input.metadata,
  };
}

export function canSeeMemoryItemForGraph(
  item: MemoryItemGraphRow,
  actor: GraphActorScope,
): boolean {
  if (!actor.activeCompanyMember) return false;
  if (item.status === "archived" || item.status === "rejected") return false;

  const privileged = roleAtLeast(actor.role, "team_lead");
  if (privileged) return true;

  if (item.agentId) {
    return actor.actorType === "agent" && actor.principalId === item.agentId;
  }

  const isCompanyWideIdentity =
    item.layer === "identity" &&
    item.visibility === "shared" &&
    !item.departmentId &&
    !item.projectId &&
    !item.goalId &&
    !item.taskId;
  if (isCompanyWideIdentity) return true;

  if (item.visibility === "shared") return true;

  if (item.departmentId) {
    return actor.departmentIds.includes(item.departmentId);
  }
  if (item.projectId) {
    return actor.departmentIds.includes(item.projectId);
  }

  return false;
}

function memoryNode(item: MemoryItemGraphRow): CompanyBrainNode {
  const isCompanyWide =
    item.layer === "identity" &&
    item.visibility === "shared" &&
    !item.departmentId &&
    !item.projectId &&
    !item.goalId &&
    !item.taskId;

  return {
    type: "memory_item",
    id: item.id,
    companyId: item.companyId,
    label: item.title,
    subtitle: item.category ?? item.layer ?? null,
    status: item.status,
    scope: {
      departmentId: item.departmentId,
      projectId: item.projectId,
      goalId: item.goalId,
      visibility: item.visibility,
      isCompanyWide,
    },
    href: `/memory/explore?item=${item.id}`,
    metadata: {
      layer: item.layer,
      folderPath: item.folderPath ?? "",
      createdBy: item.createdBy,
      createdAt: dateToIso(item.createdAt),
      updatedAt: dateToIso(item.updatedAt),
    },
  };
}

export function buildMemoryItemNeighborGraph(
  input: MemoryItemNeighborGraphInput,
): CompanyBrainNeighborsResponse {
  if (!canSeeMemoryItemForGraph(input.center, input.actor)) {
    throw notFound("Memory item not found");
  }

  const nodes = new Map<string, CompanyBrainNode>();
  const edges = new Map<string, CompanyBrainEdge>();
  const center = memoryNode(input.center);
  const centerRef: CompanyBrainNodeRef = { type: "memory_item", id: input.center.id };
  addNode(nodes, center);

  const visibleItems = new Map<string, MemoryItemGraphRow>([[input.center.id, input.center]]);
  for (const item of input.relatedItems) {
    if (canSeeMemoryItemForGraph(item, input.actor)) {
      visibleItems.set(item.id, item);
      addNode(nodes, memoryNode(item));
    }
  }

  for (const department of input.linked.departments ?? []) {
    const ref: CompanyBrainNodeRef = { type: "department", id: department.id };
    addNode(nodes, {
      ...ref,
      companyId: input.companyId,
      label: department.name,
      status: department.status,
      scope: { departmentId: department.id, isCompanyWide: false },
      href: `/memory/explore?dept=${department.id}`,
      metadata: { projectType: department.type },
    });
    addEdge(edges, derivedEdge({
      companyId: input.companyId,
      from: centerRef,
      to: ref,
      kind: "belongs_to",
    }));
  }

  for (const project of input.linked.projects ?? []) {
    const ref: CompanyBrainNodeRef = { type: "project", id: project.id };
    addNode(nodes, {
      ...ref,
      companyId: input.companyId,
      label: project.name,
      status: project.status,
      scope: { projectId: project.id, isCompanyWide: false },
      href: `/projects/${project.id}`,
      metadata: { projectType: project.type },
    });
    addEdge(edges, derivedEdge({
      companyId: input.companyId,
      from: centerRef,
      to: ref,
      kind: "belongs_to",
    }));
  }

  for (const goal of input.linked.goals ?? []) {
    const ref: CompanyBrainNodeRef = { type: "goal", id: goal.id };
    addNode(nodes, {
      ...ref,
      companyId: input.companyId,
      label: goal.title,
      status: goal.status,
      scope: { goalId: goal.id, isCompanyWide: false },
      href: `/goals/${goal.id}`,
    });
    addEdge(edges, derivedEdge({
      companyId: input.companyId,
      from: centerRef,
      to: ref,
      kind: "applies_to",
    }));
  }

  for (const task of input.linked.tasks ?? []) {
    const ref: CompanyBrainNodeRef = { type: "task", id: task.id };
    addNode(nodes, {
      ...ref,
      companyId: input.companyId,
      label: task.title,
      status: task.status,
      scope: { isCompanyWide: false },
      href: `/issues/${task.id}`,
    });
    addEdge(edges, derivedEdge({
      companyId: input.companyId,
      from: centerRef,
      to: ref,
      kind: "applies_to",
    }));
  }

  for (const artifact of input.linked.artifacts ?? []) {
    const ref: CompanyBrainNodeRef = { type: "artifact", id: artifact.id };
    addNode(nodes, {
      ...ref,
      companyId: input.companyId,
      label: artifact.title,
      status: artifact.status,
      href: `/artifacts/${artifact.id}`,
    });
    addEdge(edges, derivedEdge({
      companyId: input.companyId,
      from: centerRef,
      to: ref,
      kind: "derived_from",
    }));
  }

  for (const agent of input.linked.agents ?? []) {
    const ref: CompanyBrainNodeRef = { type: "agent", id: agent.id };
    addNode(nodes, {
      ...ref,
      companyId: input.companyId,
      label: agent.name,
      status: agent.status,
      href: `/agents/${agent.id}`,
    });
    addEdge(edges, derivedEdge({
      companyId: input.companyId,
      from: centerRef,
      to: ref,
      kind: "created_by",
    }));
  }

  for (const relation of input.semanticRelations) {
    if (!isValidEdgeKind(relation.kind)) continue;
    const from = visibleItems.get(relation.fromItemId);
    const to = visibleItems.get(relation.toItemId);
    if (!from || !to) continue;

    addEdge(edges, {
      id: relation.id,
      companyId: input.companyId,
      from: { type: "memory_item", id: relation.fromItemId },
      to: { type: "memory_item", id: relation.toItemId },
      kind: relation.kind,
      sourceClass: "semantic",
      editability: COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND[relation.kind],
      createdBy: relation.createdBy,
      createdAt: dateToIso(relation.createdAt),
    });
  }

  return {
    center,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

async function loadActorScope(
  db: Db,
  companyId: string,
  actor: { type: "user" | "agent"; principalId: string },
): Promise<GraphActorScope> {
  if (actor.type === "agent") {
    const membership = await db
      .select({ id: agents.id, role: agents.role })
      .from(agents)
      .where(and(eq(agents.id, actor.principalId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);

    const departmentRows = await db
      .select({ projectId: agentProjects.projectId })
      .from(agentProjects)
      .where(and(eq(agentProjects.companyId, companyId), eq(agentProjects.agentId, actor.principalId)));

    return {
      actorType: "agent",
      principalId: actor.principalId,
      role: membership?.role ?? "team_member",
      departmentIds: departmentRows.map((row) => row.projectId),
      activeCompanyMember: Boolean(membership),
    };
  }

  const membership = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.principalId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .then((rows) => rows[0] ?? null);

  const roleRows = await db
    .select({ role: userRoles.role, projectId: userRoles.projectId })
    .from(userRoles)
    .where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, actor.principalId)));

  const companyRole = roleRows.find((row) => row.projectId === null)?.role ?? "team_member";

  return {
    actorType: "user",
    principalId: actor.principalId,
    role: companyRole,
    departmentIds: uniqueIds(roleRows.map((row) => row.projectId)),
    activeCompanyMember: Boolean(membership),
  };
}

export function companyBrainGraphService(db: Db) {
  return {
    loadActorScope: (
      companyId: string,
      actor: { type: "user" | "agent"; principalId: string },
    ) => loadActorScope(db, companyId, actor),

    getMemoryItemNeighbors: async (
      companyId: string,
      memoryItemId: string,
      actor: { type: "user" | "agent"; principalId: string },
    ) => {
      const scope = await loadActorScope(db, companyId, actor);
      const center = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.companyId, companyId), eq(memoryItems.id, memoryItemId)))
        .then((rows) => rows[0] ?? null);
      if (!center) throw notFound("Memory item not found");

      const semanticRelations = await db
        .select({
          id: memoryRelations.id,
          fromItemId: memoryRelations.fromItemId,
          toItemId: memoryRelations.toItemId,
          kind: memoryRelations.kind,
          createdBy: memoryRelations.createdBy,
          createdAt: memoryRelations.createdAt,
        })
        .from(memoryRelations)
        .where(
          and(
            eq(memoryRelations.companyId, companyId),
            or(eq(memoryRelations.fromItemId, memoryItemId), eq(memoryRelations.toItemId, memoryItemId))!,
          ),
        );

      const relatedItemIds = uniqueIds(
        semanticRelations.flatMap((relation) => [
          relation.fromItemId === memoryItemId ? relation.toItemId : relation.fromItemId,
        ]),
      );

      const relatedItems = relatedItemIds.length > 0
        ? await db
            .select()
            .from(memoryItems)
            .where(and(eq(memoryItems.companyId, companyId), inArray(memoryItems.id, relatedItemIds)))
        : [];

      const departmentIds = uniqueIds([center.departmentId]);
      const projectIds = uniqueIds([center.projectId]);
      const goalIds = uniqueIds([center.goalId]);
      const taskIds = uniqueIds([center.taskId]);
      const artifactIds = uniqueIds([center.sourceArtifactId]);
      const agentIds = uniqueIds([center.agentId]);

      const [
        departmentRows,
        projectRows,
        goalRows,
        taskRows,
        artifactRows,
        agentRows,
      ] = await Promise.all([
        departmentIds.length
          ? db.select({
              id: projects.id,
              name: projects.name,
              type: projects.type,
              status: projects.status,
            }).from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, departmentIds)))
          : Promise.resolve([]),
        projectIds.length
          ? db.select({
              id: projects.id,
              name: projects.name,
              type: projects.type,
              status: projects.status,
            }).from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds)))
          : Promise.resolve([]),
        goalIds.length
          ? db.select({
              id: goals.id,
              title: goals.title,
              status: goals.status,
            }).from(goals).where(and(eq(goals.companyId, companyId), inArray(goals.id, goalIds)))
          : Promise.resolve([]),
        taskIds.length
          ? db.select({
              id: issues.id,
              title: issues.title,
              status: issues.status,
            }).from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, taskIds)))
          : Promise.resolve([]),
        artifactIds.length
          ? db.select({
              id: artifacts.id,
              title: artifacts.title,
              status: artifacts.status,
            }).from(artifacts).where(and(eq(artifacts.companyId, companyId), inArray(artifacts.id, artifactIds)))
          : Promise.resolve([]),
        agentIds.length
          ? db.select({
              id: agents.id,
              name: agents.name,
              status: agents.status,
            }).from(agents).where(and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)))
          : Promise.resolve([]),
      ]);

      return buildMemoryItemNeighborGraph({
        companyId,
        center,
        actor: scope,
        relatedItems,
        semanticRelations,
        linked: {
          departments: departmentRows,
          projects: projectRows,
          goals: goalRows,
          tasks: taskRows,
          artifacts: artifactRows,
          agents: agentRows,
        },
      });
    },
  };
}

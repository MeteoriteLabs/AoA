import { describe, expect, it, vi } from "vitest";
import { artifactService } from "../services/artifacts.js";
import { HttpError } from "../errors.js";

type Row = Record<string, unknown>;

function createDb(selects: Row[][], updates: Row[][] = []) {
  let selectIdx = 0;
  let updateIdx = 0;
  const deleteCalls: unknown[] = [];

  function makeChain(result: () => Row[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "set", "returning"]) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (value: Row[]) => unknown) => Promise.resolve(resolve(result()));
    return chain;
  }

  const ops = {
    select: vi.fn(() => makeChain(() => selects[selectIdx++] ?? [])),
    update: vi.fn(() => makeChain(() => updates[updateIdx++] ?? [])),
    delete: vi.fn((table: unknown) => {
      deleteCalls.push(table);
      return makeChain(() => []);
    }),
  };

  return {
    ...ops,
    deleteCalls,
    transaction: async (fn: (tx: typeof ops) => Promise<unknown>) => fn(ops),
  };
}

describe("artifact lifecycle service", () => {
  it("deletes an unreferenced artifact", async () => {
    const db = createDb([
      [{ id: "art-1", companyId: "co-1" }],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    const svc = artifactService(db as never);

    const result = await svc.deleteArtifact({
      companyId: "co-1",
      artifactId: "art-1",
      force: false,
    });

    expect(result).toEqual({ deleted: true, mode: "hard_delete", references: [] });
    expect(db.delete).toHaveBeenCalled();
  });

  it("returns a 409 when deleting a referenced artifact without force", async () => {
    const db = createDb([
      [{ id: "art-1", companyId: "co-1" }],
      [{ id: "attachment-1" }],
      [],
      [],
      [],
      [],
      [],
    ]);
    const svc = artifactService(db as never);

    await expect(
      svc.deleteArtifact({
        companyId: "co-1",
        artifactId: "art-1",
        force: false,
      }),
    ).rejects.toMatchObject({
      status: 409,
      details: {
        references: [{ type: "discussion_attachment", id: "attachment-1" }],
      },
    } satisfies Partial<HttpError>);
  });

  it("archives a referenced artifact without deleting it", async () => {
    const db = createDb(
      [[{ id: "art-1", companyId: "co-1" }]],
      [[{ id: "art-1", companyId: "co-1", status: "archived" }]],
    );
    const svc = artifactService(db as never);

    const result = await svc.archiveArtifact({
      companyId: "co-1",
      artifactId: "art-1",
    });

    expect(result.status).toBe("archived");
    expect(db.delete).not.toHaveBeenCalled();
  });
});

import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

/**
 * Artifact Lifecycle Phase 1 (P1) e2e coverage.
 *
 * Exercises the shipped thread-level artifact surface:
 *  - An asset-backed artifact attached to a discussion entry renders an inline
 *    file chip (InlineArtifactCard → `artifact-file-chip`) with a working
 *    download link and a founder-gated archive/unarchive control.
 *  - The founder file-artifact upload control in the composer
 *    (FileArtifactUpload → `file-artifact-upload`) uploads a file, attaches it
 *    as a tracked artifact, and the sent entry shows the inline chip.
 *
 * Founder gating note (load-bearing for the archive control): the e2e webServer
 * boots in local_trusted mode, where `ensureLocalTrustedBoardPrincipal`
 * (server/src/index.ts) seeds the `local-board` user as an `instance_admin`.
 * The team summary derives `instance_admin → founder`, so `useTeamAccess().role`
 * is "founder" and `canManageArtifacts` is true — the archive/unarchive testids
 * render. The server archive/unarchive routes additionally short-circuit on the
 * synthetic `local_implicit` actor, so the mutation succeeds.
 */

async function jsonOrThrow<T = unknown>(res: APIResponse, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

/**
 * Seed an asset-backed artifact attached to a fresh thread entry. Mirrors the
 * `uploadFileArtifact` client composition: upload an asset, create an
 * asset-backed artifact, then post an entry that attaches the artifact.
 */
async function seedFileArtifactThread(request: APIRequestContext, companyId: string, title: string) {
  const asset = await jsonOrThrow<{ assetId: string }>(
    await request.post(`/api/companies/${companyId}/assets/files`, {
      multipart: { file: { name: "deck.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") } },
    }),
    "upload asset",
  );
  const artifact = await jsonOrThrow<{ id: string }>(
    await request.post(`/api/companies/${companyId}/artifacts`, {
      data: {
        title: "Brand deck",
        type: "design",
        source: "founder",
        storageKind: "asset",
        assetId: asset.assetId,
        filename: "deck.pdf",
        contentType: "application/pdf",
        extension: "pdf",
        byteSize: 12,
      },
    }),
    "create artifact",
  );
  await jsonOrThrow(
    await request.patch(`/api/artifacts/${artifact.id}`, {
      data: { status: "active" },
    }),
    "activate artifact",
  );
  const thread = await jsonOrThrow<{ id: string }>(
    await request.post(`/api/companies/${companyId}/discussions`, { data: { title } }),
    "create thread",
  );
  await jsonOrThrow(
    await request.post(`/api/companies/${companyId}/discussions/${thread.id}/entries`, {
      data: { inputType: "write", rawContent: "Here is the brand deck.", attachments: [{ artifactId: artifact.id }] },
    }),
    "post entry with artifact attachment",
  );
  return { threadId: thread.id, artifactId: artifact.id };
}

test.describe("artifact lifecycle (Discussions)", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-Artifact-Life-/);
  });

  test("renders a file chip for an asset-backed artifact and archives it (founder)", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Artifact-Life-${Date.now()}`);
    const { threadId } = await seedFileArtifactThread(request, company.id, `File artifact ${Date.now()}`);

    await page.goto(`/${company.issuePrefix}/discussions/${threadId}`);

    const chip = page.getByTestId("artifact-file-chip").first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("deck.pdf").first()).toBeVisible();
    await expect(page.getByTestId("artifact-download").first()).toHaveAttribute("href", /\/api\/assets\/.+\/content/);

    await page.screenshot({ path: "artifact-file-chip-live.png", fullPage: false });

    await page.getByTestId("artifact-archive").first().click();
    await expect(page.getByTestId("artifact-unarchive").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("artifact-action-error")).toHaveCount(0);
  });

  test("founder uploads a file artifact through the composer", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Artifact-Life-${Date.now()}`);
    const thread = await jsonOrThrow<{ id: string }>(
      await request.post(`/api/companies/${company.id}/discussions`, { data: { title: `Upload ${Date.now()}` } }),
      "create thread",
    );
    await page.goto(`/${company.issuePrefix}/discussions/${thread.id}`);
    await expect(page.getByTestId("file-artifact-upload")).toBeVisible({ timeout: 15_000 });

    await page
      .getByTestId("file-artifact-input")
      .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("entry-composer-attachments")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("entry-composer-textarea").fill("Sharing my notes file.");
    await page.keyboard.press("Control+Enter");

    await expect(page.getByTestId("artifact-file-chip").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "artifact-founder-upload-live.png", fullPage: false });
  });
});

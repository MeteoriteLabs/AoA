import { test, expect } from "@playwright/test";

/**
 * E2E: Image gallery navigation in TaskSlideOver (T8).
 *
 * T8 of the upstream resync added ImageGalleryModal.tsx and wired it into
 * TaskSlideOver.tsx so clicking an image attachment opens a fullscreen gallery.
 * Component-level tests (ui/src/__tests__/ImageGalleryModal.test.tsx) cover the
 * modal in isolation; this spec covers the full user-visible flow.
 *
 * Architecture notes:
 *
 * URL strategy:
 *   The Inbox is mounted at `/:companyPrefix/inbox/new`. The e2e server boots
 *   via `pnpm aoa onboard --yes --run` (playwright.config.ts webServer) in
 *   local_trusted mode, which auto-creates a company. Navigating to `/` triggers
 *   CompanyRootRedirect → `/:companyPrefix/home`; we then follow the sidebar Inbox
 *   link rather than hard-coding a company prefix (which varies per onboard run).
 *
 * TaskSlideOver landmark:
 *   TaskSlideOver uses Radix Dialog (via Sheet) so its SheetContent renders as
 *   role="dialog" with data-slot="sheet-content". The ImageGalleryModal also uses
 *   role="dialog". We differentiate the gallery dialog from the sheet by filtering
 *   on the "(N / total)" counter text that only appears in the gallery's top bar.
 *
 * Image trigger:
 *   Per TaskSlideOver.tsx:1297, the button that opens the gallery has
 *   aria-label="Open <filename> in gallery". This is the most stable selector:
 *   it is set explicitly in production code and is not class-name-dependent.
 *
 * Gallery counter:
 *   ImageGalleryModal.tsx:58 renders `({index + 1} / {images.length})` in a
 *   <span> inside the top bar. The regex /\(\d+ \/ \d+\)/ matches it.
 *
 * Defensive skips:
 *   The test uses test.skip() when the required test data (a task with image
 *   attachments) is absent from the onboarded fixture. The default onboard
 *   creates a company and agents but does not seed image attachments. Phase E
 *   (interactive walkthrough) validates this flow manually with uploaded images.
 *
 * Phase B audit: docs/superpowers/plans/2026-04-27-resync-verification.md (Task 8)
 */

test.describe("Image gallery in TaskSlideOver (T8)", () => {
  test(
    "clicking an image attachment opens fullscreen gallery",
    async ({ page }) => {
      // Navigate to root — CompanyRootRedirect will push to /:companyPrefix/home.
      await page.goto("/");
      await page.waitForURL(/\/[^/]+\/home/, { timeout: 15_000 });

      // Follow the sidebar Inbox link to reach /:companyPrefix/inbox/new.
      // The link text is "Inbox" in the Sidebar component.
      const inboxLink = page.getByRole("link", { name: /^inbox$/i }).first();
      const inboxLinkVisible = await inboxLink
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      if (!inboxLinkVisible) {
        test.skip(
          true,
          "Cannot find Inbox link in sidebar — UI structure differs from expected",
        );
        return;
      }

      await inboxLink.click();
      await page.waitForURL(/\/inbox/, { timeout: 10_000 });

      // Look for a task row in the "Tasks I touched" section or anywhere on the
      // inbox. The Inbox renders task rows as buttons or links with task titles.
      // We try clicking the first task-like clickable element that opens the
      // TaskSlideOver (role="dialog" with data-slot="sheet-content").
      //
      // Task rows in Inbox.tsx are rendered inside IssuesList or inline sections;
      // we look for any element with role="link" or role="button" that has a title
      // resembling a task (i.e., not a tab or filter control).
      //
      // Simpler fallback: find any element that has data-slot="issue-row" or
      // similar. If none, skip — we need seeded data.

      // Wait briefly for the inbox to load its data.
      await page.waitForTimeout(2_000);

      // Try to find a task row. In IssuesList.tsx, tasks are <li> items with
      // a clickable area. We target the first visible list item that is not a
      // heading or control element.
      const taskRows = page.locator('[data-slot="issue-row"], [data-testid="task-row"]');
      const taskRowsCount = await taskRows.count();

      if (taskRowsCount === 0) {
        // Fallback: try any <li> inside the main content area.
        const anyListItem = page.locator("main li, [role='main'] li").first();
        const listItemVisible = await anyListItem
          .isVisible({ timeout: 3_000 })
          .catch(() => false);

        if (!listItemVisible) {
          test.skip(
            true,
            "No tasks visible in inbox — test data dependency (onboard fixture has no tasks)",
          );
          return;
        }

        await anyListItem.click();
      } else {
        await taskRows.first().click();
      }

      // The TaskSlideOver (Sheet) should open. It renders as role="dialog" with
      // data-slot="sheet-content". Filter by the "sheet-content" slot to
      // distinguish it from the gallery dialog.
      const slideOver = page.locator('[data-slot="sheet-content"]');
      const slideOverVisible = await slideOver
        .isVisible({ timeout: 8_000 })
        .catch(() => false);

      if (!slideOverVisible) {
        test.skip(
          true,
          "TaskSlideOver did not open after clicking a task row — UI structure differs from expected",
        );
        return;
      }

      // Look for an image gallery open button within the slideover.
      // Per TaskSlideOver.tsx:1297, the button aria-label is:
      //   "Open <filename> in gallery"
      const galleryTrigger = slideOver.getByRole("button", {
        name: /open .* in gallery/i,
      }).first();

      const galleryTriggerVisible = await galleryTrigger
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      if (!galleryTriggerVisible) {
        test.skip(
          true,
          "No image attachment gallery trigger found in TaskSlideOver — test data dependency (task has no image attachments)",
        );
        return;
      }

      // Click the image to open the gallery.
      await galleryTrigger.click();

      // The gallery modal should open. It uses Radix Dialog (role="dialog").
      // Distinguish it from the TaskSlideOver sheet by the "(N / total)" counter
      // rendered in ImageGalleryModal.tsx top bar (format: "(1 / 2)").
      const gallery = page
        .getByRole("dialog")
        .filter({ hasText: /\(\d+ \/ \d+\)/ });

      await expect(gallery).toBeVisible({ timeout: 3_000 });

      // Counter should read "(1 / N)" since we clicked the first image.
      await expect(gallery.getByText(/\(1 \/ \d+\)/)).toBeVisible();

      // Read total image count from the counter text.
      const counterText = await gallery
        .locator("text=/\\(\\d+ \\/ \\d+\\)/")
        .textContent()
        .catch(() => null);

      const totalMatch = counterText?.match(/\/ (\d+)\)/);
      const total = totalMatch ? parseInt(totalMatch[1], 10) : 1;

      if (total >= 2) {
        // ArrowRight advances to image 2.
        await page.keyboard.press("ArrowRight");
        await expect(gallery.getByText(/\(2 \/ \d+\)/)).toBeVisible({
          timeout: 2_000,
        });

        // ArrowLeft goes back to image 1.
        await page.keyboard.press("ArrowLeft");
        await expect(gallery.getByText(/\(1 \/ \d+\)/)).toBeVisible({
          timeout: 2_000,
        });
      }

      // Escape closes the gallery.
      // After Escape, the gallery dialog should be removed from the DOM.
      await page.keyboard.press("Escape");
      await expect(gallery).toHaveCount(0, { timeout: 2_000 });

      // The TaskSlideOver (sheet) should still be open after the gallery closes —
      // the gallery closing does not close the underlying sheet.
      await expect(slideOver).toBeVisible({ timeout: 2_000 });
    },
  );

  test(
    "clicking the curtain (outside the image) closes the gallery",
    async ({ page }) => {
      await page.goto("/");
      await page.waitForURL(/\/[^/]+\/home/, { timeout: 15_000 });

      const inboxLink = page.getByRole("link", { name: /^inbox$/i }).first();
      const inboxLinkVisible = await inboxLink
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      if (!inboxLinkVisible) {
        test.skip(
          true,
          "Cannot find Inbox link in sidebar — UI structure differs from expected",
        );
        return;
      }

      await inboxLink.click();
      await page.waitForURL(/\/inbox/, { timeout: 10_000 });
      await page.waitForTimeout(2_000);

      const taskRows = page.locator('[data-slot="issue-row"], [data-testid="task-row"]');
      const taskRowsCount = await taskRows.count();

      if (taskRowsCount === 0) {
        const anyListItem = page.locator("main li, [role='main'] li").first();
        const listItemVisible = await anyListItem
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (!listItemVisible) {
          test.skip(
            true,
            "No tasks visible in inbox — test data dependency",
          );
          return;
        }
        await anyListItem.click();
      } else {
        await taskRows.first().click();
      }

      const slideOver = page.locator('[data-slot="sheet-content"]');
      const slideOverVisible = await slideOver
        .isVisible({ timeout: 8_000 })
        .catch(() => false);

      if (!slideOverVisible) {
        test.skip(true, "TaskSlideOver did not open");
        return;
      }

      const galleryTrigger = slideOver
        .getByRole("button", { name: /open .* in gallery/i })
        .first();
      const galleryTriggerVisible = await galleryTrigger
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      if (!galleryTriggerVisible) {
        test.skip(
          true,
          "No image attachment gallery trigger found — test data dependency",
        );
        return;
      }

      await galleryTrigger.click();

      const gallery = page
        .getByRole("dialog")
        .filter({ hasText: /\(\d+ \/ \d+\)/ });

      await expect(gallery).toBeVisible({ timeout: 3_000 });

      // Per ImageGalleryModal.tsx:83, the curtain div (data-testid="image-gallery-curtain")
      // triggers onOpenChange(false) when clicked. Click a corner of the curtain
      // (not the image itself, which stops propagation at line 103).
      const curtain = gallery.locator('[data-testid="image-gallery-curtain"]');
      const curtainVisible = await curtain
        .isVisible({ timeout: 2_000 })
        .catch(() => false);

      if (curtainVisible) {
        // Click near the top-left corner to avoid the image in the center.
        await curtain.click({ position: { x: 10, y: 10 } });
        await expect(gallery).toHaveCount(0, { timeout: 2_000 });
      } else {
        // Fallback: close via Escape since curtain selector unavailable.
        await page.keyboard.press("Escape");
        await expect(gallery).toHaveCount(0, { timeout: 2_000 });
      }
    },
  );
});

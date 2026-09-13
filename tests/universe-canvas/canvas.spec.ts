import { test, expect, type Page, type Locator } from "@playwright/test";
import type { State, Rect } from "../../ui/src/components/universe/panel-state";
import path from "node:path";

const shotDir = path.resolve("test-results/universe-canvas");
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const frame = (page: Page, kind = "task") =>
  page.getByRole("region", { name: `${kind} fixture`, exact: true });
async function state(page: Page): Promise<State> {
  return JSON.parse(
    (await page.getByTestId("registry-state").textContent()) || "null"
  );
}
async function rect(page: Page, kind = "task") {
  return Object.values((await state(page)).panels).find(
    (p) => p.ref.id === kind
  )!.rect;
}
async function box(item: Locator) {
  const result = await item.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}
function near(actual: Rect, expected: Rect) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(actual[key], key).toBeCloseTo(expected[key], 1);
}
async function setup(page: Page, zoom = 1, kind = "task") {
  await page.goto("/universe-harness.html");
  await button(page, `Zoom ${zoom}`).click();
  await button(page, `Open ${kind}`).click();
  await expect(frame(page, kind)).toBeVisible();
  await expect(frame(page, kind).locator("header")).toBeFocused();
  await expect
    .poll(() =>
      page.locator(".react-flow__viewport").evaluate((e) => {
        const matrix = new DOMMatrix(getComputedStyle(e).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      })
    )
    .toEqual({ x: 0, y: 0, zoom });
  // Wait for the measured controlled ReactFlow viewport to reach a painted frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}
async function drag(
  page: Page,
  item: Locator,
  dx: number,
  dy: number,
  header = false
) {
  const b = await box(item);
  const x = b.x + (header ? 100 : b.width / 2),
    y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    if (
      !test.info().title.includes("throwing renderer") ||
      !error.message.includes("Deliberately unavailable fixture")
    )
      throw error;
  });
});

for (const kind of ["task", "artifact", "iframe"])
  for (const zoom of [0.5, 1, 2]) {
    test(`${kind} at ${zoom}: header and all eight resize directions`, async ({
      page,
    }) => {
      await setup(page, zoom, kind);
      const initial = await box(frame(page, kind));
      expect(initial.width).toBe(520);
      expect(initial.height).toBe(360);
      let previous = await rect(page, kind);
      await drag(page, frame(page, kind).locator("header"), 40, 20, true);
      near(await rect(page, kind), {
        ...previous,
        x: previous.x + 40 / zoom,
        y: previous.y + 20 / zoom,
      });
      near(await box(frame(page, kind)), {
        ...initial,
        x: initial.x + 40,
        y: initial.y + 20,
      });
      for (const direction of [
        "top",
        "bottom",
        "left",
        "right",
        "top.left",
        "top.right",
        "bottom.left",
        "bottom.right",
      ]) {
        const selector = `.react-flow__resize-control.${
          direction.includes(".") ? "handle" : "line"
        }.${direction}`;
        const control = page.locator(selector);
        await expect(control).toHaveCount(1);
        const dx = direction.includes("left")
          ? -20
          : direction.includes("right")
          ? 20
          : 0;
        const dy = direction.includes("top")
          ? -20
          : direction.includes("bottom")
          ? 20
          : 0;
        previous = await rect(page, kind);
        const visible = await box(frame(page, kind));
        await drag(page, control, dx, dy);
        const expected = {
          x: previous.x + (dx < 0 ? dx / zoom : 0),
          y: previous.y + (dy < 0 ? dy / zoom : 0),
          width: previous.width + Math.abs(dx) / zoom,
          height: previous.height + Math.abs(dy) / zoom,
        };
        await test.step(`${direction} resize`, async () => {
          near(await rect(page, kind), expected);
        });
        near(await box(frame(page, kind)), {
          x: visible.x + (dx < 0 ? dx : 0),
          y: visible.y + (dy < 0 ? dy : 0),
          width: visible.width + Math.abs(dx),
          height: visible.height + Math.abs(dy),
        });
        await button(page, "Undo geometry").click();
        near(await rect(page, kind), previous);
        await expect
          .poll(() => frame(page, kind).boundingBox())
          .toEqual(visible);
      }
      await expect(page.getByTestId("iframe-shield")).toHaveCount(0);
    });
    test(`${kind} at ${zoom}: maximize minimize restore preserves content and camera`, async ({
      page,
    }) => {
      await setup(page, zoom, kind);
      const normal = await rect(page, kind),
        visible = await box(frame(page, kind));
      const content = frame(page, kind).locator(".universe-panel-body");
      const marker = await content.elementHandle();
      if (kind === "task")
        await page
          .getByRole("textbox", { name: "Fixture draft" })
          .fill("persistent draft");
      if (kind === "iframe")
        await page
          .frameLocator("iframe")
          .getByPlaceholder("Embedded text input")
          .fill("persistent iframe");
      await frame(page, kind)
        .getByRole("button", { name: "Maximize panel", exact: true })
        .click();
      near(
        await box(frame(page, kind)),
        await box(page.getByTestId("universe-canvas"))
      );
      await button(page, "Zoom 2").click();
      expect(
        JSON.parse((await page.getByTestId("camera-state").textContent())!)
      ).toEqual({ x: 0, y: 0, zoom });
      await page.setViewportSize({ width: 1200, height: 800 });
      await expect
        .poll(async () => (await box(frame(page, kind))).width)
        .toBe(1200);
      near(
        await box(frame(page, kind)),
        await box(page.getByTestId("universe-canvas"))
      );
      near(await rect(page, kind), normal);
      await frame(page, kind)
        .getByRole("button", { name: "Minimize panel", exact: true })
        .click();
      await expect(page.locator("section[data-panel-key]")).toHaveAttribute(
        "inert",
        ""
      );
      await expect(frame(page, kind)).toHaveCount(0);
      expect(await marker!.evaluate((e) => e.isConnected)).toBe(true);
      await button(page, `Restore ${kind} fixture`).click();
      near(await rect(page, kind), normal);
      near(await box(frame(page, kind)), visible);
      await expect.soft(frame(page, kind).locator("header")).toBeFocused();
      await frame(page, kind)
        .getByRole("button", { name: "Maximize panel", exact: true })
        .click();
      await frame(page, kind)
        .getByRole("button", { name: "Restore panel", exact: true })
        .click();
      near(await rect(page, kind), normal);
      expect(await marker!.evaluate((e) => e.isConnected)).toBe(true);
      if (kind === "task")
        await expect(
          page.getByRole("textbox", { name: "Fixture draft" })
        ).toHaveValue("persistent draft");
      if (kind === "iframe")
        await expect(
          page.frameLocator("iframe").getByPlaceholder("Embedded text input")
        ).toHaveValue("persistent iframe");
    });
  }

test("body selection and scroll, overlap focus, pin and keyboard geometry", async ({
  page,
}) => {
  await setup(page);
  const task = frame(page);
  const original = await rect(page);
  const draft = page.getByRole("textbox", { name: "Fixture draft" });
  await draft.fill("select these words");
  await draft.press("Control+A");
  await draft.press("Alt+ArrowRight");
  near(await rect(page), original);
  expect(
    await draft.evaluate(
      (e: HTMLTextAreaElement) => e.selectionEnd - e.selectionStart
    )
  ).toBe(18);
  await task.getByRole("button", { name: "Pin panel", exact: true }).click();
  near(await rect(page), original);
  await button(page, "Commander arrange fixture").click();
  near(await rect(page), original);
  await drag(page, task.locator("header"), -80, -30, true);
  const dragged = await rect(page);
  await task.locator("header").focus();
  await page.keyboard.press("Alt+ArrowRight");
  near(await rect(page), { ...dragged, x: dragged.x + 10 });
  await page.keyboard.press("Alt+Shift+ArrowRight");
  near(await rect(page), {
    ...dragged,
    x: dragged.x + 10,
    width: dragged.width + 10,
  });
  const retained = await rect(page);
  await button(page, "Open artifact").click();
  const artifact = frame(page, "artifact");
  const artifactRect = await rect(page, "artifact");
  const body = artifact.locator(".universe-panel-body");
  await body.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => body.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  near(await rect(page, "artifact"), artifactRect);
  const b = await box(task);
  await page.mouse.click(b.x + 30, b.y + 20);
  expect((await state(page)).selected).toBe(
    await task.getAttribute("data-panel-key")
  );
  near(await rect(page), retained);
  await page.screenshot({ path: path.join(shotDir, "canvas-overlap.png") });
  await task
    .getByRole("button", { name: "Maximize panel", exact: true })
    .click();
  await page.screenshot({ path: path.join(shotDir, "canvas-maximized.png") });
});

for (const zoom of [0.5, 1, 2])
  test(`keyboard movement and resize use ten CSS pixels at ${zoom}`, async ({
    page,
  }) => {
    await setup(page, zoom);
    const header = frame(page).locator("header");
    await header.focus();
    const initial = await rect(page);
    const visible = await box(frame(page));
    await page.keyboard.press("Alt+ArrowRight");
    near(await rect(page), { ...initial, x: initial.x + 10 / zoom });
    near(await box(frame(page)), { ...visible, x: visible.x + 10 });
    await page.keyboard.press("Alt+Shift+ArrowDown");
    near(await rect(page), {
      ...initial,
      x: initial.x + 10 / zoom,
      height: initial.height + 10 / zoom,
    });
  });

for (const zoom of [0.5, 1, 2])
  test(`pointer text selection and body scroll isolate canvas at ${zoom}`, async ({
    page,
  }) => {
    await setup(page, zoom, "artifact");
    const original = await rect(page, "artifact");
    const camera = await page.getByTestId("camera-state").textContent();
    const paragraph = frame(page, "artifact").locator("article p").first();
    const b = await box(paragraph);
    await page.mouse.dblclick(b.x + 20 * zoom, b.y + b.height / 2);
    expect(
      (await page.evaluate(() => window.getSelection()?.toString()))?.length
    ).toBeGreaterThan(0);
    const body = frame(page, "artifact").locator(".universe-panel-body");
    await body.hover();
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => body.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(0);
    near(await rect(page, "artifact"), original);
    expect(await page.getByTestId("camera-state").textContent()).toBe(camera);
  });

for (const zoom of [0.5, 1, 2])
  test(`camera pans normally and freezes for maximized wheel and pointer at ${zoom}`, async ({
    page,
  }) => {
    await setup(page, zoom);
    const original = await rect(page);
    const canvas = await box(page.getByTestId("universe-canvas"));
    await page.mouse.move(canvas.x + 30, canvas.y + 100);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 70, canvas.y + 120, { steps: 8 });
    await page.mouse.up();
    try {
      await expect
        .poll(async () =>
          JSON.parse((await page.getByTestId("camera-state").textContent())!)
        )
        .toEqual({ x: 40, y: 20, zoom });
    } finally {
      await test.info().attach("pan-final-state", {
        contentType: "application/json",
        body: JSON.stringify({
          camera: JSON.parse(
            (await page.getByTestId("camera-state").textContent())!
          ),
          matrix: await page.locator(".react-flow__viewport").evaluate((e) => {
            const m = new DOMMatrix(getComputedStyle(e).transform);
            return { x: m.e, y: m.f, zoom: m.a };
          }),
          normal: await rect(page),
          screen: await box(frame(page)),
          original,
        }),
      });
    }
    near(await rect(page), original);
    await button(page, `Zoom ${zoom}`).click();
    await frame(page)
      .getByRole("button", { name: "Maximize panel", exact: true })
      .click();
    const frozen = await page.getByTestId("camera-state").textContent();
    const transform = await page
      .locator(".react-flow__viewport")
      .getAttribute("style");
    await frame(page).locator("header").hover();
    await page.mouse.wheel(0, -300);
    await drag(page, frame(page).locator("header"), 40, 20, true);
    expect(await page.getByTestId("camera-state").textContent()).toBe(frozen);
    expect(
      await page.locator(".react-flow__viewport").getAttribute("style")
    ).toBe(transform);
    near(await rect(page), original);
    near(
      await box(frame(page)),
      await box(page.getByTestId("universe-canvas"))
    );
  });

for (const zoom of [0.5, 1, 2])
  test(`pointer resize clamps explicit minimum and maximum at ${zoom}`, async ({
    page,
  }) => {
    await setup(page, zoom);
    await drag(page, page.locator(".handle.bottom.right"), -1000, -1000);
    const minimum = await rect(page);
    expect(minimum.width).toBeCloseTo(320 / zoom);
    expect(minimum.height).toBeCloseTo(240 / zoom);
    const canvas = await box(page.getByTestId("universe-canvas"));
    await drag(page, page.locator(".handle.bottom.right"), 2000, 2000);
    const maximum = await rect(page);
    expect(maximum.width).toBeCloseTo(canvas.width / zoom);
    expect(maximum.height).toBeCloseTo(canvas.height / zoom);
    expect(
      [maximum.x, maximum.y, maximum.width, maximum.height].every(
        Number.isFinite
      )
    ).toBe(true);
    await expect(page.getByTestId("iframe-shield")).toHaveCount(0);
  });

test("zero measured bounds refuse opening and recover with finite visible geometry", async ({
  page,
}) => {
  await page.route("**/universe-harness.html", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (
        await response.text()
      ).replace(
        "<head>",
        '<head><style id="zero-layout-fixture">.universe-canvas { flex: none !important; width: 0 !important; height: 0 !important; }</style>'
      ),
    });
  });
  await page.goto("/universe-harness.html");
  // Test-only initial physical layout; no controller or gesture operation is injected.
  await expect(page.getByTestId("universe-canvas")).toHaveCSS("width", "0px");
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await button(page, "Open task").click();
  await expect(page.locator("section[data-panel-key]")).toHaveCount(0);
  expect(await state(page)).toBeNull();
  await page.locator("#zero-layout-fixture").evaluate((e) => e.remove());
  await expect(page.locator(".react-flow")).toHaveCount(1);
  await button(page, "Open task").click();
  const visible = await box(frame(page)),
    canvas = await box(page.getByTestId("universe-canvas"));
  expect(Object.values(visible).every(Number.isFinite)).toBe(true);
  expect(visible.x).toBeGreaterThanOrEqual(canvas.x);
  expect(visible.y).toBeGreaterThanOrEqual(canvas.y);
  expect(visible.x + visible.width).toBeLessThanOrEqual(
    canvas.x + canvas.width
  );
  expect(visible.y + visible.height).toBeLessThanOrEqual(
    canvas.y + canvas.height
  );
});

test("history conflict fence and external edit during cancellation", async ({
  page,
}) => {
  await setup(page);
  await drag(page, frame(page).locator("header"), 40, 20, true);
  await button(page, "Commander arrange fixture").click();
  const external = await rect(page);
  await button(page, "Undo geometry").click();
  near(await rect(page), external);
  const b = await box(frame(page).locator("header"));
  await page.mouse.move(b.x + 100, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 150, b.y + b.height / 2 + 20);
  await button(page, "Commander arrange fixture").evaluate(
    (e: HTMLButtonElement) => e.click()
  );
  const concurrent = await rect(page);
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }))
  );
  await page.mouse.move(b.x + 200, b.y + 60);
  await page.mouse.up();
  near(await rect(page), concurrent);
  await expect(page.getByTestId("iframe-shield")).toHaveCount(0);
});

test("initial open focus and minimize recovery focus", async ({ page }) => {
  await setup(page);
  await expect.soft(frame(page).locator("header")).toBeFocused();
  await frame(page)
    .getByRole("button", { name: "Minimize panel", exact: true })
    .click();
  await expect(button(page, "Open task")).toBeFocused();
});

test("completed long drag is one undo; no-op and cancellation preserve history and release shields", async ({
  page,
}) => {
  await setup(page, 1, "iframe");
  const initial = await rect(page, "iframe");
  const header = frame(page, "iframe").locator("header");
  await drag(page, header, 60, 30, true);
  const completed = await rect(page, "iframe");
  await drag(page, header, 0, 0, true);
  for (const event of ["pointercancel", "blur"])
    for (const kind of ["drag", "resize"]) {
      const target =
        kind === "drag" ? header : page.locator(".handle.bottom.right");
      const b = await box(target);
      const x = b.x + (kind === "drag" ? 100 : b.width / 2),
        y = b.y + (kind === "drag" ? 20 : b.height / 2);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y + 20, { steps: 5 });
      await expect(page.getByTestId("iframe-shield")).toHaveCount(1);
      await page.evaluate(
        (event) =>
          window.dispatchEvent(
            event === "pointercancel"
              ? new PointerEvent(event, { bubbles: true })
              : new Event(event)
          ),
        event
      );
      near(await rect(page, "iframe"), completed);
      await page.mouse.move(x + 80, y + 40);
      await page.mouse.up();
      near(await rect(page, "iframe"), completed);
      await expect(page.getByTestId("iframe-shield")).toHaveCount(0);
    }
  await button(page, "Undo geometry").click();
  near(await rect(page, "iframe"), initial);
  await button(page, "Undo geometry").click();
  near(await rect(page, "iframe"), initial);
  await button(page, "Redo geometry").click();
  near(await rect(page, "iframe"), completed);
  const b = await box(header);
  await page.mouse.move(b.x + 100, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(1400, 950, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("iframe-shield")).toHaveCount(0);
});

test("close/reopen generation and scope replacement reject stale callbacks and history", async ({
  page,
}) => {
  await setup(page);
  const first = Object.values((await state(page)).panels)[0];
  const instance = await page.getByTestId("mount-count").textContent();
  await button(page, "Capture stale close").click();
  await frame(page)
    .getByRole("button", { name: "Close panel", exact: true })
    .click();
  await expect(button(page, "Open task")).toBeFocused();
  await button(page, "Open task").click();
  expect(
    Object.values((await state(page)).panels)[0].generation
  ).toBeGreaterThan(first.generation);
  expect(await page.getByTestId("mount-count").textContent()).not.toBe(
    instance
  );
  await button(page, "Replay stale close").click();
  await expect(frame(page)).toBeVisible();
  await drag(page, frame(page).locator("header"), 50, 20, true);
  await button(page, "Capture stale close").click();
  const b = await box(frame(page).locator("header"));
  await page.mouse.move(b.x + 100, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 140, b.y + 30);
  // Scope replacement is an intentional external lifecycle event, not the gesture under test.
  await button(page, "Switch scope").evaluate((e: HTMLButtonElement) =>
    e.click()
  );
  await page.mouse.up();
  await expect(page.locator("section[data-panel-key]")).toHaveCount(0);
  await expect(page.getByTestId("iframe-shield")).toHaveCount(0);
  await button(page, "Open task").click();
  const fresh = await rect(page);
  await button(page, "Undo geometry").click();
  near(await rect(page), fresh);
  await button(page, "Replay stale close").click();
  await expect(frame(page)).toBeVisible();
});

test("missing and throwing renderer keep an operable shell", async ({
  page,
}) => {
  await setup(page, 1, "missing");
  await expect(frame(page, "missing")).toContainText("unavailable");
  await frame(page, "missing")
    .getByRole("button", { name: "Close panel", exact: true })
    .click();
  await button(page, "Open throwing").click();
  await expect(frame(page, "throwing")).toContainText(
    "This view is unavailable"
  );
  await frame(page, "throwing")
    .getByRole("button", { name: "Minimize panel", exact: true })
    .click();
  await button(page, "Restore throwing fixture").click();
  await frame(page, "throwing")
    .getByRole("button", { name: "Close panel", exact: true })
    .click();
});

for (const zoom of [0.5, 1, 2])
  test(`narrow reduced-motion coarse targets at ${zoom}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => {
      throw e;
    });
    await page.goto("http://127.0.0.1:5183/universe-harness.html");
    await button(page, `Zoom ${zoom}`).click();
    await button(page, "Open task").click();
    const visible = await box(frame(page)),
      canvas = await box(page.getByTestId("universe-canvas"));
    expect(visible.x).toBeGreaterThanOrEqual(canvas.x);
    expect(visible.y).toBeGreaterThanOrEqual(canvas.y);
    expect(visible.width).toBeLessThanOrEqual(canvas.width);
    expect(visible.height).toBeLessThanOrEqual(canvas.height);
    const sizes = await page
      .locator(".react-flow__resize-control")
      .evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return e.classList.contains("handle")
            ? r.width
            : e.classList.contains("left") || e.classList.contains("right")
            ? r.width
            : r.height;
        })
      );
    expect(sizes).toEqual(Array(8).fill(24));
    await drag(page, page.locator(".handle.bottom.right"), -500, -500);
    const small = await rect(page);
    expect(small.width).toBeGreaterThan(0);
    expect(small.height).toBeGreaterThan(0);
    expect(Object.values(small).every(Number.isFinite)).toBe(true);
    await context.close();
  });

for (const count of [1, 10, 50])
  test(`${count} mounted panels: timing sample, drag and zoom preserve instances`, async ({
    page,
    browser,
  }, info) => {
    await page.goto("/universe-harness.html");
    const start = performance.now();
    await button(
      page,
      count === 1 ? "Open task" : `Open ${count} fixtures`
    ).click();
    await expect(page.locator("section[data-panel-key]")).toHaveCount(count);
    const openMs = performance.now() - start;
    const ids = await page.getByTestId("mount-count").allTextContents();
    const s = await state(page);
    const id = s.panels[s.selected!].ref.id;
    const r = await rect(page, id);
    const started = performance.now();
    await drag(page, frame(page, id).locator("header"), 30, 15, true);
    near(await rect(page, id), { ...r, x: r.x + 30, y: r.y + 15 });
    const dragMs = performance.now() - started;
    await button(page, "Zoom 0.5").click();
    await expect(page.getByTestId("camera-state")).toContainText("0.5");
    expect(await page.getByTestId("mount-count").allTextContents()).toEqual(
      ids
    );
    await info.attach("timing-sample", {
      body: JSON.stringify({
        count,
        openMs,
        dragMs,
        browser: browser.version(),
        node: process.version,
        platform: process.platform,
        viewport: page.viewportSize(),
        scope:
          "single local sample including Playwright overhead; not performance certification",
      }),
      contentType: "application/json",
    });
  });

import { expect as pwExpect, test, type Page, type Locator, type Download } from "@playwright/test";

const expect = pwExpect;

async function streamText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function section(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

/** 通过真实 UI（增加按钮 + 输入框）批量填入整数镜头编号。 */
async function fillList(page: Page, testId: string, values: (string | number)[]) {
  const sec = await section(page, testId);
  const addBtn = sec.getByRole("button", { name: "＋ 增加一项" });
  const inputs = sec.locator("input");
  if (values.length > 50) {
    // 超长序列走真实粘贴事件（编辑器按换行拆行），避免数百次点击。
    await inputs.first().click();
    await inputs.first().evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, values.map(String).join("\n"));
    return;
  }
  while ((await inputs.count()) < values.length) {
    await addBtn.click();
  }
  for (let i = 0; i < values.length; i += 1) {
    await inputs.nth(i).fill(String(values[i]));
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test.describe("镜头序列输入", () => {
  test("可以增加与删除编号输入行", async ({ page }) => {
    const src = page.getByTestId("source-editor");
    const addBtn = src.getByRole("button", { name: "＋ 增加一项" });
    expect(await src.locator("input")).toHaveCount(1);

    await addBtn.click();
    await addBtn.click();
    expect(await src.locator("input")).toHaveCount(3);

    await src.getByRole("button", { name: "删除第 1 项" }).click();
    expect(await src.locator("input")).toHaveCount(2);

    // 回车键在行尾快速追加并聚焦新行。
    await src.locator("input").last().fill("55");
    await src.locator("input").last().press("Enter");
    expect(await src.locator("input")).toHaveCount(3);
    await expect(src.locator("input").last()).toBeFocused();
  });

  test("空数组也是合法输入，距离为 0", async ({ page }) => {
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("distance")).toContainText("0");
    expect(await page.getByTestId("alignment-row").count()).toBe(0);
  });
});

test.describe("真实联调的变更轨迹", () => {
  test("输入两组编号，得到距离、零基下标，且轨迹重放精确等于目标", async ({ page }) => {
    await fillList(page, "source-editor", [1, 2, 3]);
    await fillList(page, "target-editor", [1, 4, 3]);
    await page.getByTestId("compare").click();

    await expect(page.getByTestId("distance")).toContainText("2");
    await expect(page.getByTestId("summary")).toContainText("源 3 项 → 目标 3 项");

    const rows = page.getByTestId("alignment-row");
    await expect(rows).toHaveCount(4);

    const table = await rows.evaluateAll((trs) =>
      trs.map((tr) => ({
        type: tr.querySelector('[data-testid="row-type"]')?.textContent,
        value: tr.querySelector('[data-testid="row-value"]')?.textContent,
        source: tr.querySelector('[data-testid="row-source"]')?.textContent,
        target: tr.querySelector('[data-testid="row-target"]')?.textContent,
      }))
    );
    expect(table).toEqual([
      { type: "保留", value: "1", source: "0", target: "0" },
      { type: "插入（目标）", value: "4", source: "—", target: "1" },
      { type: "删除（源）", value: "2", source: "1", target: "—" },
      { type: "保留", value: "3", source: "2", target: "2" },
    ]);

    // 最终轨迹重放：保留与插入顺序产出，删除不产出，必须精确得到目标序列。
    const replayed = table
      .filter((r) => r.type !== "删除（源）")
      .map((r) => Number(r.value));
    expect(replayed).toEqual([1, 4, 3]);
  });

  test("只删不改：纯删除轨迹距离等于删除条数", async ({ page }) => {
    await fillList(page, "source-editor", [10, 20, 30, 40]);
    await fillList(page, "target-editor", [10, 40]);
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("distance")).toContainText("2");
    expect(await page.getByTestId("alignment-row").filter({ hasText: "删除（源）" }).count()).toBe(2);
  });
});

test.describe("失败提示来自真实后端", () => {
  test("非整数与越界值显示 INVALID_INPUT 而不是固定文案", async ({ page }) => {
    // 小数：前端原样作为字符串发送，由 FastAPI 严格整数校验裁决。
    await fillList(page, "source-editor", ["3.5", 1]);
    await fillList(page, "target-editor", [1]);
    await page.getByTestId("compare").click();

    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("INVALID_INPUT");
    await expect(page.getByTestId("result-view")).toHaveCount(0);

    // 修正为合法输入后再次提交，失败提示消失、结果出现（接口确为实时调用）。
    const src = page.getByTestId("source-editor");
    await src.locator("input").first().fill("3");
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("error-banner")).toHaveCount(0);
    // 源 [3,1] -> 目标 [1]：删除一个源项，距离为 1。
    await expect(page.getByTestId("distance")).toContainText("1");
  });

  test("超过 2147483647 的编号返回 422 并展示 INVALID_INPUT", async ({ page }) => {
    await fillList(page, "source-editor", [2147483648]);
    await fillList(page, "target-editor", []);
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("error-banner")).toContainText("INVALID_INPUT");
  });

  test("编辑距离超过 800 时显示 DIFF_LIMIT", async ({ page }) => {
    // 401 个 1 对 401 个 2：完全不相交，距离 802 > 800，必须停止搜索。
    test.slow();
    await fillList(
      page,
      "source-editor",
      Array.from({ length: 401 }, () => 1)
    );
    await fillList(
      page,
      "target-editor",
      Array.from({ length: 401 }, () => 2)
    );
    await page.getByTestId("compare").click();
    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText("DIFF_LIMIT");
  });
});

test.describe("差异块批准与混合镜头序列", () => {
  async function compute(page: Page, source: (string | number)[], target: (string | number)[]) {
    await fillList(page, "source-editor", source);
    await fillList(page, "target-editor", target);
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("block-mixer")).toBeVisible();
  }

  async function mixedText(page: Page): Promise<string> {
    return (await page.getByTestId("mixed-sequence").textContent()) ?? "";
  }

  async function remainingDistance(page: Page): Promise<string | null> {
    const el = page.getByTestId("remaining-distance");
    await expect(el).toBeVisible();
    return el.textContent();
  }

  test("纯插入：单块，不选=source，勾选=target，剩余距离归零", async ({ page }) => {
    await compute(page, [1, 2], [1, 9, 8, 2]);

    const blocks = page.getByTestId("diff-block");
    await expect(blocks).toHaveCount(1);
    await expect(blocks).toContainText("插入");
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 2");

    await page.getByTestId("block-checkbox").check();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 9, 8, 2");
    await expect(page.getByTestId("mixed-is-target")).toBeVisible();
    expect(await remainingDistance(page)).toBe("0");

    // 撤销勾选：精确回到 source。
    await page.getByTestId("block-checkbox").uncheck();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 2");
    await expect(page.getByTestId("mixed-is-source")).toBeVisible();
    expect(await remainingDistance(page)).toBe("2");
  });

  test("可交付混合序列可下载；stale 后下载被撤销", async ({ page }) => {
    await compute(page, [1, 2, 3], [1, 4, 3]);
    await page.getByTestId("block-checkbox").check();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 4, 3");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-mixed").click(),
    ]);
    expect(download.suggestedFilename()).toBe("mixed-shots.txt");
    expect(await streamText(download)).toBe("1\n4\n3\n");

    // 改动原始输入后：下载按钮禁用，旧混合序列撤销。
    await page.getByTestId("source-editor").getByRole("button", { name: "＋ 增加一项" }).click();
    await page.getByTestId("source-editor").locator("input").last().fill("99");
    await expect(page.getByTestId("download-mixed")).toBeDisabled();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("");
  });

  test("纯删除：单块，勾选后删除项离开混合序列", async ({ page }) => {
    await compute(page, [1, 7, 8, 2], [1, 2]);

    await expect(page.getByTestId("diff-block")).toHaveCount(1);
    await expect(page.getByTestId("diff-block")).toContainText("删除");
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 7, 8, 2");

    await page.getByTestId("block-checkbox").check();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 2");
    expect(await remainingDistance(page)).toBe("0");
  });

  test("相邻改写：插入与删除同属不可拆分块，逐块选择无下标漂移", async ({ page }) => {
    await compute(page, [1, 2, 3, 4, 5], [1, 8, 3, 9, 5]);

    const blocks = page.getByTestId("diff-block");
    await expect(blocks).toHaveCount(2);
    await expect(blocks.nth(0)).toContainText("源 [1, 2)");
    await expect(blocks.nth(0)).toContainText("目标 [1, 2)");
    await expect(blocks.nth(1)).toContainText("源 [3, 4)");
    await expect(blocks.nth(1)).toContainText("目标 [3, 4)");

    const checkboxes = page.getByTestId("block-checkbox");
    await checkboxes.nth(0).check();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 8, 3, 4, 5");
    expect(await remainingDistance(page)).toBe("2");

    // 无论先应用哪一块，结果都由原始 source 坐标一次性重放。
    await checkboxes.nth(1).check();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 8, 3, 9, 5");
    expect(await remainingDistance(page)).toBe("0");

    await checkboxes.nth(0).uncheck();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 2, 3, 9, 5");
    expect(await remainingDistance(page)).toBe("2");
  });

  test("重复镜头：块编号/跨度稳定，枚举勾选均得到合法混合序列", async ({ page }) => {
    await compute(page, [5, 5, 1, 5, 5, 2, 5], [5, 1, 1, 5, 2, 2, 9]);

    const blocks = page.getByTestId("diff-block");
    await expect(blocks).toHaveCount(4);
    // 初始：精确等于 source。
    expect(await mixedText(page)).toBe("5, 5, 1, 5, 5, 2, 5");

    const checkboxes = page.getByTestId("block-checkbox");
    // 只采纳纯插入块（块 1：目标下标 2 的 1）。
    await checkboxes.nth(1).check();
    expect(await mixedText(page)).toBe("5, 5, 1, 1, 5, 5, 2, 5");
    expect(await remainingDistance(page)).toBe("5");

    // 全部采纳：精确等于 target。
    await page.getByTestId("accept-all").click();
    expect(await mixedText(page)).toBe("5, 1, 1, 5, 2, 2, 9");
    expect(await remainingDistance(page)).toBe("0");

    // 全部撤销：精确回到 source。
    await page.getByTestId("accept-none").click();
    expect(await mixedText(page)).toBe("5, 5, 1, 5, 5, 2, 5");
  });

  test("改动任一原始输入：撤销块选择与可下载混合序列，原始对齐仍保留", async ({ page }) => {
    await compute(page, [1, 2, 3], [1, 4, 3]);
    await page.getByTestId("block-checkbox").check();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("1, 4, 3");

    // 在源序列追加一项（原始输入被改动）。
    await page.getByTestId("source-editor").getByRole("button", { name: "＋ 增加一项" }).click();
    await page.getByTestId("source-editor").locator("input").last().fill("99");

    await expect(page.getByTestId("mixer-stale")).toBeVisible();
    await expect(page.getByTestId("block-checkbox")).not.toBeChecked();
    await expect(page.getByTestId("download-mixed")).toBeDisabled();
    await expect(page.getByTestId("mixed-sequence")).toHaveText("");
    await expect(page.getByTestId("remaining-stale")).toBeVisible();
    // 原始对齐轨迹不被剩余轨迹或输入改动覆盖。
    await expect(page.getByTestId("result-view")).toBeVisible();
    expect(await page.getByTestId("alignment-row").count()).toBe(4);
  });

  test("乱序响应：迟到的剩余计算不覆盖新选择", async ({ page }) => {
    // 块0（相邻改写，成本2）批准后剩余距离 1；块1（纯插入，成本1）后为 2。
    await compute(page, [1, 2, 3, 4, 5, 6, 7], [1, 9, 3, 4, 5, 6, 8, 7]);
    const checkboxes = page.getByTestId("block-checkbox");
    await expect(checkboxes).toHaveCount(2);

    // 拦截 /api/diff：把“只选块0”的剩余请求挂起，其余（含改选块1）立即放行。
    // 路由注册于初次差分之后，故这里只会计数剩余轨迹请求。
    let releaseSlow: () => void = () => {};
    const slowBlocked = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    await page.route("**/api/diff", async (route) => {
      const requestBody = route.request().postDataJSON() as { source: number[] };
      // 选块 0 的旧选择：source 含 9 但不含 8。
      if (requestBody.source.includes(9) && !requestBody.source.includes(8)) {
        await slowBlocked;
      }
      await route.continue();
    });

    await checkboxes.nth(0).check(); // 触发挂起请求
    await page.waitForTimeout(200);
    await checkboxes.nth(0).uncheck();
    await checkboxes.nth(1).check(); // 触发立即请求（新选择）
    await expect(page.getByTestId("remaining-distance")).toHaveText("2", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("mixed-sequence")).toHaveText(
      "1, 2, 3, 4, 5, 6, 8, 7"
    );

    // 迟到响应放行：属于旧选择的距离 1 不得覆盖当前的 2。
    releaseSlow();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("remaining-distance")).toHaveText("2");
    await expect(page.getByTestId("mixed-sequence")).toHaveText(
      "1, 2, 3, 4, 5, 6, 8, 7"
    );
  });
});

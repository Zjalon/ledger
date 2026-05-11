#!/usr/bin/env node
/**
 * 生成 README 用界面截图（真实运行 dev 页面）。
 *
 * 用法：
 *   1. 另开终端在项目根目录执行：pnpm dev
 *   2. 再执行本脚本：
 *        node scripts/capture-readme-screenshots.mjs
 *      若当前为登录页，会保存 login.png（无需 Token）。
 *
 *   若需首页 / 统计 / 资产 / 记一笔 等完整截图：在项目根目录复制 `.env.example`
 *   为 `.env.local` 并填写 `GITEE_TOKEN`（可选 `BASE_URL`），再运行本脚本。
 *   亦可通过环境变量传入：`GITEE_TOKEN=... node scripts/capture-readme-screenshots.mjs`
 *
 * 切勿把令牌提交到 Git（勿 add `.env.local`）；不要用 `git add -f` 强制加入。
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "docs", "screenshots");

/** 读取根目录 `.env.local`（gitignore），不覆盖已有环境变量 */
function loadEnvLocal() {
    const p = join(root, ".env.local");
    if (!existsSync(p)) {
        return;
    }
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) {
            continue;
        }
        const i = t.indexOf("=");
        if (i === -1) {
            continue;
        }
        const key = t.slice(0, i).trim();
        let val = t.slice(i + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined || process.env[key] === "") {
            process.env[key] = val;
        }
    }
}

loadEnvLocal();

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:5173").replace(
    /\/$/,
    "",
);
const TOKEN = process.env.GITEE_TOKEN?.trim() ?? "";

async function ensureDevServer() {
    try {
        const u = new URL(BASE_URL);
        await fetch(u, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    } catch {
        console.error(`无法连接 ${BASE_URL}。请先在本机运行：pnpm dev\n`);
        process.exit(1);
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    await mkdir(outDir, { recursive: true });
    await ensureDevServer();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        locale: "zh-CN",
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/`, {
        waitUntil: "networkidle",
        timeout: 60_000,
    });
    await sleep(500);

    const onLogin = await page
        .getByRole("button", { name: "进入家庭账本" })
        .isVisible()
        .catch(() => false);

    if (onLogin) {
        await page.screenshot({
            path: join(outDir, "login.png"),
            fullPage: false,
        });
        console.log("已保存 docs/screenshots/login.png");
    }

    if (!TOKEN) {
        if (!onLogin) {
            console.warn(
                "当前未检测到登录页，且未设置 GITEE_TOKEN；跳过其余截图。",
            );
        } else {
            console.log(
                "未设置 GITEE_TOKEN：仅导出登录页。完整截图请设置令牌后重新运行。",
            );
        }
        await browser.close();
        return;
    }

    if (!onLogin) {
        console.warn(
            "已设置 GITEE_TOKEN，但当前不是登录页。请清除站点数据或使用无痕上下文后再试。",
        );
        await browser.close();
        return;
    }

    await page
        .getByPlaceholder(/令牌|Token/i)
        .first()
        .fill(TOKEN);
    await page.getByRole("button", { name: "进入家庭账本" }).click();
    await sleep(2000);

    if (
        await page
            .getByText("Token 无效", { exact: false })
            .isVisible()
            .catch(() => false)
    ) {
        throw new Error(
            "Gitee 登录失败（Token 无效或已被作废）。请更新 .env.local 中的 GITEE_TOKEN。",
        );
    }

    await page.locator(".pick-page, .journal-page").first().waitFor({
        state: "visible",
        timeout: 120_000,
    });

    if (
        await page
            .getByText("还没有账本", { exact: false })
            .isVisible()
            .catch(() => false)
    ) {
        await page.getByRole("button", { name: "创建第一本账" }).click();
        await page
            .locator(".pick-dialog")
            .getByRole("button", { name: "创建" })
            .click();
        await sleep(12_000);
    }

    const pickFirst = page.locator(".pick-card").first();
    if (await pickFirst.isVisible({ timeout: 8000 }).catch(() => false)) {
        await pickFirst.click();
    }

    await page
        .locator(".main-entry-loading")
        .waitFor({ state: "hidden", timeout: 180_000 })
        .catch(() => {});

    await page.locator(".journal-section-title").first().waitFor({
        state: "visible",
        timeout: 120_000,
    });
    await sleep(800);

    await page.screenshot({
        path: join(outDir, "home.png"),
        fullPage: false,
    });
    console.log("已保存 docs/screenshots/home.png");

    const tabBar = page.locator("nav.app-tabbar");
    await tabBar.getByRole("button", { name: "统计" }).click();
    await sleep(900);
    await page.screenshot({
        path: join(outDir, "stat.png"),
        fullPage: false,
    });
    console.log("已保存 docs/screenshots/stat.png");

    await tabBar.getByRole("button", { name: "资产" }).click();
    await sleep(900);
    await page.screenshot({
        path: join(outDir, "assets.png"),
        fullPage: false,
    });
    console.log("已保存 docs/screenshots/assets.png");

    await tabBar.getByRole("button", { name: "账本" }).click();
    await sleep(400);

    await page.locator("button.app-record").click();
    await page.locator(".record-sheet-popup").waitFor({
        state: "visible",
        timeout: 15_000,
    });
    await sleep(500);
    await page.screenshot({
        path: join(outDir, "record.png"),
        fullPage: false,
    });
    console.log("已保存 docs/screenshots/record.png");

    await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

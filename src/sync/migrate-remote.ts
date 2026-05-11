import { v4 as uuidv4 } from "uuid";
import type { BaseItem, FullAction } from "@/database/stash";
import {
    PROFILE_ACCOUNTS_KEY,
    PROFILE_USERS_KEY,
} from "@/sync/book-remote-layout";

/** 旧版 meta 可能缺少 tags 等字段，补齐以免下游报错 */
export function normalizeMetaSnapshot(raw: unknown): Record<string, unknown> {
    const o =
        raw && typeof raw === "object" && !Array.isArray(raw)
            ? { ...(raw as Record<string, unknown>) }
            : {};
    if (!Array.isArray(o.tags)) {
        o.tags = [];
    }
    return o;
}

/** 新版 profile 含 centUsers / centAccounts；旧仓库可能只有用户资料等杂项 */
export function normalizeProfileSnapshot(
    raw: unknown,
): Record<string, unknown> {
    const o =
        raw && typeof raw === "object" && !Array.isArray(raw)
            ? { ...(raw as Record<string, unknown>) }
            : {};
    const users = o[PROFILE_USERS_KEY];
    if (!users || typeof users !== "object" || Array.isArray(users)) {
        o[PROFILE_USERS_KEY] = {};
    }
    if (!Array.isArray(o[PROFILE_ACCOUNTS_KEY])) {
        o[PROFILE_ACCOUNTS_KEY] = [];
    }
    return o;
}

/** 与账单上的 BillType（income/expense/…）区分，只认 stash 三种操作 */
function isFullActionShape(v: unknown): boolean {
    if (v === null || typeof v !== "object" || !("type" in v)) {
        return false;
    }
    const t = (v as { type: unknown }).type;
    return t === "update" || t === "delete" || t === "meta";
}

/**
 * 远端分片可能是：
 * - FullAction[]（当前格式）
 * - Bill[] / Item[]（无 type 包裹的旧数组）
 * - ExportedJSON 单对象 `{ items, meta }`（少数导出）
 */
export function chunkContentToActions<Item extends BaseItem>(
    raw: unknown,
): FullAction<Item>[] {
    if (raw === undefined || raw === null) {
        return [];
    }

    if (
        !Array.isArray(raw) &&
        typeof raw === "object" &&
        isFullActionShape(raw)
    ) {
        return [raw as FullAction<Item>];
    }

    if (Array.isArray(raw)) {
        if (raw.length === 0) {
            return [];
        }
        const first = raw[0];
        if (isFullActionShape(first)) {
            return raw as FullAction<Item>[];
        }
        return raw.map((item) => ({
            type: "update" as const,
            id: uuidv4(),
            timestamp:
                item !== null &&
                typeof item === "object" &&
                "time" in item &&
                typeof (item as { time: unknown }).time === "number"
                    ? (item as { time: number }).time
                    : Date.now(),
            value: item as Item,
        }));
    }

    if (typeof raw === "object" && raw !== null && "items" in raw) {
        const items = (raw as { items?: unknown }).items;
        if (!Array.isArray(items)) {
            return [];
        }
        return items.map((item) => ({
            type: "update" as const,
            id: uuidv4(),
            timestamp:
                item !== null &&
                typeof item === "object" &&
                "time" in item &&
                typeof (item as { time: unknown }).time === "number"
                    ? (item as { time: number }).time
                    : Date.now(),
            value: item as Item,
        }));
    }

    return [];
}

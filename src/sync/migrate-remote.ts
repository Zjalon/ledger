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

const LEGACY_PROFILE_USERS_KEY = "centUsers";
const LEGACY_PROFILE_ACCOUNTS_KEY = "centAccounts";

/** 新版 profile 含 ledgerUsers / ledgerAccounts；兼容旧键 centUsers / centAccounts */
export function normalizeProfileSnapshot(
    raw: unknown,
): Record<string, unknown> {
    const o =
        raw && typeof raw === "object" && !Array.isArray(raw)
            ? { ...(raw as Record<string, unknown>) }
            : {};

    const legacyUsers = o[LEGACY_PROFILE_USERS_KEY];
    if (
        legacyUsers &&
        typeof legacyUsers === "object" &&
        !Array.isArray(legacyUsers)
    ) {
        const next = o[PROFILE_USERS_KEY];
        if (!next || typeof next !== "object" || Array.isArray(next)) {
            o[PROFILE_USERS_KEY] = {
                ...(legacyUsers as Record<string, unknown>),
            };
        }
        delete o[LEGACY_PROFILE_USERS_KEY];
    }

    const legacyAccounts = o[LEGACY_PROFILE_ACCOUNTS_KEY];
    if (Array.isArray(legacyAccounts)) {
        const next = o[PROFILE_ACCOUNTS_KEY];
        if (!Array.isArray(next) || next.length === 0) {
            o[PROFILE_ACCOUNTS_KEY] = [...legacyAccounts];
        }
        delete o[LEGACY_PROFILE_ACCOUNTS_KEY];
    }

    const users = o[PROFILE_USERS_KEY];
    if (!users || typeof users !== "object" || Array.isArray(users)) {
        o[PROFILE_USERS_KEY] = {};
    }
    if (!Array.isArray(o[PROFILE_ACCOUNTS_KEY])) {
        o[PROFILE_ACCOUNTS_KEY] = [];
    }
    return o;
}

function profileUserMap(raw: unknown): Record<string, unknown> {
    const u = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return { ...(u as Record<string, unknown>) };
}

function accountUpdateAt(row: unknown): number {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
        return 0;
    }
    const t = (row as { __update_at?: unknown }).__update_at;
    return typeof t === "number" ? t : 0;
}

/**
 * 合并远端与本地 profile.json（users 按 id 并集，accounts 按 id 并集，同 id 取较新 __update_at）。
 * 用于同步上传与 init 拉取：避免 mergeMeta 在无 $$patch 时用整份 local 覆盖远端导致协作者数据丢失。
 */
export function mergeProfileForSync(
    remoteRaw: unknown,
    localRaw: unknown,
): Record<string, unknown> {
    const remote = normalizeProfileSnapshot(remoteRaw);
    const local = normalizeProfileSnapshot(localRaw);
    const ru = profileUserMap(remote[PROFILE_USERS_KEY]);
    const lu = profileUserMap(local[PROFILE_USERS_KEY]);
    const mergedUsers: Record<string, unknown> = { ...ru, ...lu };

    const ra = remote[PROFILE_ACCOUNTS_KEY];
    const la = local[PROFILE_ACCOUNTS_KEY];
    const accR = Array.isArray(ra) ? ra : [];
    const accL = Array.isArray(la) ? la : [];
    const byId = new Map<string, unknown>();
    for (const row of accR) {
        if (row !== null && typeof row === "object" && !Array.isArray(row)) {
            const id = (row as { id?: unknown }).id;
            if (id !== undefined && id !== null) {
                byId.set(String(id), row);
            }
        }
    }
    for (const row of accL) {
        if (row !== null && typeof row === "object" && !Array.isArray(row)) {
            const id = (row as { id?: unknown }).id;
            if (id === undefined || id === null) {
                continue;
            }
            const key = String(id);
            const prev = byId.get(key);
            if (!prev) {
                byId.set(key, row);
            } else {
                byId.set(
                    key,
                    accountUpdateAt(row) >= accountUpdateAt(prev) ? row : prev,
                );
            }
        }
    }

    return normalizeProfileSnapshot({
        ...remote,
        ...local,
        [PROFILE_USERS_KEY]: mergedUsers,
        [PROFILE_ACCOUNTS_KEY]: Array.from(byId.values()),
    });
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

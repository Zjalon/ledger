import type { PersonalMeta } from "@/ledger/extra-type";

/**
 * 将已保存顺序与当前账户 id 对齐：去掉已删账户，新账户排在末尾。
 */
export function normalizeAccountDisplayOrder(
    accounts: { id: string }[],
    saved: string[] | undefined,
): string[] {
    const ids = accounts.map((a) => a.id);
    const idSet = new Set(ids);
    const kept = (saved ?? []).filter((id) => idSet.has(id));
    const tail = ids.filter((id) => !kept.includes(id));
    return [...kept, ...tail];
}

export function applyAccountDisplayOrder<T extends { id: string }>(
    accounts: T[],
    preferredOrder: string[] | undefined,
): T[] {
    const order = normalizeAccountDisplayOrder(accounts, preferredOrder);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return order
        .map((id) => byId.get(id))
        .filter((x): x is T => x !== undefined);
}

export function mergeMetaPersonal(
    prevPersonal: Record<string, PersonalMeta> | undefined,
    userId: string,
    patch: Partial<PersonalMeta>,
): Record<string, PersonalMeta> {
    const base = { ...(prevPersonal ?? {}) };
    base[userId] = { ...(base[userId] ?? {}), ...patch };
    return base;
}

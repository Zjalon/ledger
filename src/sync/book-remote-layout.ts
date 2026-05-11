/**
 * 远端账本仓库约定：
 * - transactions → `ledger-*.json`（Tidal 分片）
 * - users → profile.json 中的 centUsers（按 id 映射）
 * - accounts → profile.json 中的 centAccounts（数组）
 */
export const PROFILE_USERS_KEY = "centUsers";
export const PROFILE_ACCOUNTS_KEY = "centAccounts";

export function createInitialBookProfile(): Record<string, unknown> {
    return {
        [PROFILE_USERS_KEY]: {},
        [PROFILE_ACCOUNTS_KEY]: [],
    };
}

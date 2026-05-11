/**
 * 远端账本仓库约定：
 * - transactions → `ledger-*.json`（Tidal 分片）
 * - users → profile.json 中的 ledgerUsers（按 id 映射）
 * - accounts → profile.json 中的 ledgerAccounts（数组）
 */
export const PROFILE_USERS_KEY = "ledgerUsers";
export const PROFILE_ACCOUNTS_KEY = "ledgerAccounts";

export function createInitialBookProfile(): Record<string, unknown> {
    return {
        [PROFILE_USERS_KEY]: {},
        [PROFILE_ACCOUNTS_KEY]: [],
    };
}

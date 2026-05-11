import type { Modal } from "@/components/modal";
import { Scheduler } from "@/database/scheduler";
import type { Action, BaseItem, Full } from "@/database/stash";
import { BillIndexedDBStorage } from "@/database/storage";
import type { Account } from "@/database/tables/account";
import type { Transaction } from "@/database/tables/transaction";
import type { User } from "@/database/tables/user";
import type { Bill } from "@/ledger/type";
import {
    PROFILE_ACCOUNTS_KEY,
    PROFILE_USERS_KEY,
} from "@/sync/book-remote-layout";
import { normalizeMetaSnapshot } from "@/sync/migrate-remote";
import { accountBalanceDeltasFromTransactionActions } from "@/sync/transaction-account-balance";
import { createTidal } from "@/tidal";
import { createGiteeSyncer } from "@/tidal/gitee";
import type { SyncEndpoint, SyncEndpointFactory } from "../type";
import { createLoginAPI } from "./login";

const config = {
    repoPrefix: "ledger-journal",
    entryName: "ledger",
    orderKeys: ["time"],
};

export const LoginAPI = createLoginAPI();

const manuallyLogin = async ({ modal }: { modal: Modal }) => {
    const token = await modal.prompt({
        title: "请输入 Gitee 访问令牌",
        input: { type: "text" },
    });
    if (!token) {
        return;
    }
    LoginAPI.manuallySetToken(token as string);
    location.reload();
};

export const GiteeEndpoint: SyncEndpointFactory = {
    type: "gitee",
    name: "Gitee",
    login: LoginAPI.login,
    manuallyLogin,
    init: ({ modal }) => {
        LoginAPI.afterLogin();
        const repo = createTidal<Bill>({
            storageFactory: (name) => new BillIndexedDBStorage(`book-${name}`),
            entryName: config.entryName,
            syncerFactory: () =>
                createGiteeSyncer({
                    auth: LoginAPI.getToken,
                    entryName: config.entryName,
                    repoPrefix: config.repoPrefix,
                }),
        });

        const toBookName = (bookId: string) => {
            const [, r] = bookId.split("/");
            const prefix = `${config.repoPrefix}-`;
            if (r.startsWith(prefix)) {
                return r.slice(prefix.length);
            }
            /* 兼容旧仓库名 cent-journal- */
            const legacy = "cent-journal-";
            if (r.startsWith(legacy)) {
                return r.slice(legacy.length);
            }
            return r;
        };

        const inviteForBook = async (bookId: string) => {
            await modal.prompt({
                title: "将打开 Gitee 仓库「成员」页面，请在网页中完成协作者邀请",
            });
            window.open(`https://gitee.com/${bookId}/team`, "_blank");
        };

        const deleteBook = async (bookId: string) => {
            await modal.prompt({
                title: "将打开 Gitee 仓库「删除仓库」设置，请在网页中确认删除",
            });
            window.open(
                `https://gitee.com/${bookId}/settings#remove`,
                "_blank",
            );
            return Promise.reject(new Error("cancelled"));
        };

        const scheduler = new Scheduler(async (signal) => {
            const [finished, cancel] = repo.sync();
            signal.onabort = cancel;
            await finished;
        });

        const readUsersMap = async (
            bookId: string,
        ): Promise<Record<string, User>> => {
            const profile = (await repo.getProfile(bookId)) as Record<
                string,
                unknown
            > | null;
            const raw = profile?.[PROFILE_USERS_KEY];
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
                return raw as Record<string, User>;
            }
            return {};
        };

        const readAccountsList = async (bookId: string): Promise<Account[]> => {
            const profile = (await repo.getProfile(bookId)) as Record<
                string,
                unknown
            > | null;
            const raw = profile?.[PROFILE_ACCOUNTS_KEY];
            if (Array.isArray(raw)) {
                return raw as Account[];
            }
            return [];
        };

        const writeUsersMap = async (
            bookId: string,
            users: Record<string, User>,
        ) => {
            const prev =
                ((await repo.getProfile(bookId)) as Record<string, unknown>) ??
                {};
            await repo.setProfile(bookId, {
                ...prev,
                [PROFILE_USERS_KEY]: users,
            });
            scheduler.schedule();
        };

        const writeAccountsList = async (
            bookId: string,
            accounts: Account[],
        ) => {
            const prev =
                ((await repo.getProfile(bookId)) as Record<string, unknown>) ??
                {};
            await repo.setProfile(bookId, {
                ...prev,
                [PROFILE_ACCOUNTS_KEY]: accounts,
            });
            scheduler.schedule();
        };

        const endpoint: SyncEndpoint = {
            logout: async () => {
                await repo.detach();
            },
            getUserInfo: repo.getUserInfo,
            getCollaborators: repo.getCollaborators,
            getOnlineAsset: (src, store) => repo.getAsset(src, store),

            fetchAllBooks: async (...args) => {
                const res = await repo.fetchAllStore(...args);
                return res.map((v) => ({ id: v, name: toBookName(v) }));
            },
            createBook: repo.create,
            initBook: repo.init,
            deleteBook,
            inviteForBook,

            tableBatch: async <T extends BaseItem>(
                bookId: string,
                tableName: string,
                actions: Action<T>[],
                overlap?: boolean,
            ) => {
                if (tableName === "transactions") {
                    const txActions = actions as Action<Transaction>[];
                    const existing = (await repo.getAllItems(
                        bookId,
                    )) as Full<Transaction>[];
                    const existingById = new Map(
                        existing.map((t) => [t.id, t as Transaction]),
                    );
                    const balanceDeltas =
                        accountBalanceDeltasFromTransactionActions(
                            txActions,
                            existingById,
                        );

                    await repo.batch(
                        bookId,
                        actions as Action<Bill>[],
                        overlap,
                    );

                    if (balanceDeltas.size > 0) {
                        const list = [...(await readAccountsList(bookId))];
                        let touched = false;
                        for (const [accId, d] of balanceDeltas) {
                            const idx = list.findIndex((x) => x.id === accId);
                            if (idx < 0) {
                                continue;
                            }
                            const prev = list[idx] as Account;
                            list[idx] = {
                                ...prev,
                                initialBalance: (prev.initialBalance ?? 0) + d,
                            };
                            touched = true;
                        }
                        if (touched) {
                            await writeAccountsList(bookId, list);
                        }
                    }

                    scheduler.schedule();
                    return;
                }
                if (tableName === "users") {
                    let users = await readUsersMap(bookId);
                    for (const a of actions) {
                        if (a.type === "update") {
                            users = {
                                ...users,
                                [a.id]: a.value as User,
                            };
                        } else if (a.type === "delete") {
                            const id = String(a.value);
                            users = { ...users };
                            delete users[id];
                        }
                    }
                    await writeUsersMap(bookId, users);
                    return;
                }
                if (tableName === "accounts") {
                    const list = [...(await readAccountsList(bookId))];
                    for (const a of actions) {
                        if (a.type === "update") {
                            const val = a.value as Account;
                            const idx = list.findIndex((x) => x.id === val.id);
                            if (idx >= 0) {
                                list[idx] = val;
                            } else {
                                list.push(val);
                            }
                        } else if (a.type === "delete") {
                            const id = String(a.value);
                            const i = list.findIndex((x) => x.id === id);
                            if (i >= 0) {
                                list.splice(i, 1);
                            }
                        }
                    }
                    await writeAccountsList(bookId, list);
                    return;
                }
            },

            tableGetAllItems: async <T extends BaseItem>(
                bookId: string,
                tableName: string,
            ) => {
                if (tableName === "transactions") {
                    return (await repo.getAllItems(bookId)) as Full<T>[];
                }
                if (tableName === "users") {
                    const users = await readUsersMap(bookId);
                    return Object.values(users) as Full<T>[];
                }
                if (tableName === "accounts") {
                    return (await readAccountsList(bookId)) as Full<T>[];
                }
                return [];
            },

            onChange: repo.onChange,

            getIsNeedSync: repo.hasStashes,
            onSync: scheduler.onProcess.bind(scheduler),
            toSync: async () => {
                scheduler.schedule();
            },

            forceNeedSync: repo.forceNeedSync,

            getProfile: repo.getProfile,
            setProfile: async (bookId: string, data: unknown) => {
                await repo.setProfile(bookId, data);
                scheduler.schedule();
            },

            getLedgerMeta: async (bookId: string) => {
                const raw = await repo.getMeta(bookId);
                return normalizeMetaSnapshot(raw);
            },

            patchLedgerMeta: async (
                bookId: string,
                patch: Record<string, unknown>,
            ) => {
                const prev = normalizeMetaSnapshot(await repo.getMeta(bookId));
                const next = {
                    ...prev,
                    ...patch,
                    tags: Array.isArray(patch.tags)
                        ? patch.tags
                        : Array.isArray(prev.tags)
                          ? prev.tags
                          : [],
                    /** 与 tags 一致：避免 patch 含 categories: undefined 时覆盖掉已有自定义分类 */
                    categories: Array.isArray(patch.categories)
                        ? patch.categories
                        : Array.isArray(prev.categories)
                          ? prev.categories
                          : undefined,
                };
                await repo.batch(bookId, [
                    {
                        type: "meta",
                        metaValue: next,
                    } as Action<Bill>,
                ]);
                scheduler.schedule();
            },
        };

        return endpoint;
    },
};

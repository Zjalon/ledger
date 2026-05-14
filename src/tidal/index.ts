// tidal/index.ts
import { sortBy } from "lodash-es";
import type { ChangeListener, UserInfo } from "@/api/endpoints/type";
import { type FileEntry, transformAssets } from "@/database/assets";
import { asyncSingleton } from "@/database/singleton";
import {
    type Action,
    type BaseItem,
    mergeMeta,
    StashBucket,
    type StashStorage,
} from "@/database/stash";
import {
    chunkContentToActions,
    mergeProfileForSync,
    normalizeMetaSnapshot,
    normalizeProfileSnapshot,
} from "@/sync/migrate-remote";

export type AssetKey = string;

export type FileLike = { path: string; sha: string };
export type FileWithContent = { path: string; sha: string; content: any };

export type StoreStructure<F = FileLike> = {
    chunks: (F & { startIndex: number })[];
    meta: F;
    assets: F[];
    profile?: F;
};

export type StoreDetail = {
    chunks: (FileWithContent & { startIndex: number; endIndex: number })[];
    meta: FileWithContent;
    assets: FileLike[];
    profile?: FileWithContent;
};

export type Syncer = {
    fetchStructure: (
        storeFullName: string,
        signal?: AbortSignal,
    ) => Promise<StoreStructure>;
    fetchContent: (
        storeFullName: string,
        paths: FileLike[],
        signal?: AbortSignal,
    ) => Promise<FileWithContent[]>;
    uploadContent: (
        storeFullName: string,
        files: {
            path: string;
            content: string | undefined;
        }[],
        signal?: AbortSignal,
    ) => Promise<StoreStructure>;
    transformAsset: (file: File, storeFullName: string) => AssetKey;
    createStore: (name: string) => Promise<{ id: string; name: string }>;

    getAsset: (fileKey: AssetKey, storeFullName: string) => Promise<Blob>;
    assetEntryToPath: (
        entry: FileEntry<string>,
        storeFullName: string,
    ) => string;
    getUserInfo: (id?: string) => Promise<UserInfo>;
    getCollaborators: (id: string) => Promise<UserInfo[]>;
    fetchAllStore: () => Promise<string[]>;
};

type Config = {
    structure?: StoreStructure;
};
/**
 * createTidal
 *
 * storageFactory: (storeFullName) => StashStorage
 * syncerFactory: () => Syncer
 * options: itemsPerChunk, entryName
 */
export const createTidal = <Item extends BaseItem>({
    storageFactory,
    syncerFactory,
    itemsPerChunk = 1000,
    entryName = "entry",
}: {
    storageFactory: (storeFullName: string) => StashStorage;
    syncerFactory: () => Syncer;
    itemsPerChunk?: number;
    entryName?: string;
}) => {
    const storeMap = new Map<
        string,
        { storage: StashStorage; itemBucket: StashBucket<Item> }
    >();

    // onChange
    const changeListeners: ChangeListener[] = [];
    const notifyChange = (storeFullName: string) => {
        changeListeners.forEach((p) => {
            p({ bookId: storeFullName });
        });
    };
    /**
     * 监听数据是否发生变化
     */
    const onChange = (listener: ChangeListener) => {
        changeListeners.push(listener);
        return () => {
            const i = changeListeners.indexOf(listener);
            changeListeners.splice(i, 1);
        };
    };

    const getSyncer = (() => {
        let syncer: Syncer | undefined;
        return () => {
            if (!syncer) {
                syncer = syncerFactory();
            }
            return syncer;
        };
    })();

    const getStore = (storeFullName: string) => {
        const storage =
            storeMap.get(storeFullName)?.storage ??
            storageFactory(storeFullName);
        const itemBucket =
            storeMap.get(storeFullName)?.itemBucket ??
            new StashBucket(
                storage.createArrayableStorage,
                storage.createStorage,
            );
        storeMap.set(storeFullName, { storage, itemBucket });
        return { storage, itemBucket };
    };

    // fetch structure singleton (to avoid many calls)
    const _fetchStructure = async (
        storeFullName: string,
        signal?: AbortSignal,
    ) => {
        const syncer = getSyncer();
        return await syncer.fetchStructure(storeFullName, signal);
    };
    const fetchStructure = asyncSingleton(_fetchStructure);

    const fetchContent = async (
        storeFullName: string,
        files: FileLike[],
        signal?: AbortSignal,
    ) => {
        const syncer = getSyncer();
        return await syncer.fetchContent(storeFullName, files, signal);
    };

    const fetchStoreDetail = async (
        storeFullName: string,
        _structure?: StoreStructure,
        signal?: AbortSignal,
    ) => {
        const remoteStructure =
            _structure === undefined
                ? await fetchStructure(storeFullName, signal)
                : _structure;
        const { itemBucket } = getStore(storeFullName);
        const localConfig = (await itemBucket.configStorage.getValue()) as
            | Config
            | undefined;
        const localStructure = localConfig?.structure;

        const { diff: structure, patch } = diffStructure(
            remoteStructure,
            localStructure,
        );
        /** 本次 diff 是否包含 meta.json；为 false 时不应写入本地 meta，否则会误用快照覆盖 categories */
        const metaInDiff = structure.meta !== undefined;
        const results = await fetchContent(
            storeFullName,
            Array.from(
                new Set(
                    [
                        structure.meta,
                        ...structure.chunks,
                        structure.profile,
                    ].filter((v) => v !== undefined),
                ),
            ),
        );
        const detail = Object.fromEntries(
            Array.from(Object.entries(structure))
                .filter(([k, v]) => v !== undefined)
                .map(([k, v]) => {
                    if (Array.isArray(v)) {
                        const withContents = v.map((f) => ({
                            ...f,
                            content: results.find((c) => c.sha === f.sha)
                                ?.content,
                        }));
                        return [k, withContents];
                    }
                    const value = v as FileLike;
                    (value as any).content = results.find(
                        (c) => c.sha === value.sha,
                    )?.content;
                    return [k, value];
                }),
        ) as StoreDetail;
        return { detail, remote: remoteStructure, patch, metaInDiff };
    };

    // init single store: pull remote structure+content -> patch/init local stash
    const init = async (storeFullName: string) => {
        const { itemBucket } = getStore(storeFullName);

        const { detail, remote, patch, metaInDiff } =
            await fetchStoreDetail(storeFullName);

        const detailChunks = Array.isArray(detail.chunks) ? detail.chunks : [];
        /*
         * diffStructure 在「每个分片 SHA 都与本地记录的相同」时不会把任何 chunk 放进 diff，
         * 此时 detail.chunks 为空，但仍可能IndexedDB 流水与远端不一致（与 profile 同类问题）。
         * 只要远端仍有分片文件，则拉取全部分片正文并 init 全量重建。
         */
        const missingAllChunks =
            remote.chunks.length > 0 && detailChunks.length === 0;
        let chunkSources = detailChunks;
        if (missingAllChunks) {
            chunkSources = (await fetchContent(
                storeFullName,
                remote.chunks,
            )) as typeof detailChunks;
        }

        const remoteItems = chunkSources.flatMap((v) =>
            chunkContentToActions<Item>(v.content),
        );
        let normalizedMeta = metaInDiff
            ? normalizeMetaSnapshot(detail.meta?.content)
            : undefined;
        if (missingAllChunks && normalizedMeta === undefined && remote.meta) {
            const [metaFile] = await fetchContent(storeFullName, [remote.meta]);
            normalizedMeta = normalizeMetaSnapshot(metaFile?.content);
        }
        if (missingAllChunks) {
            await itemBucket.init(remoteItems, normalizedMeta);
        } else if (patch) {
            await itemBucket.patch(remoteItems, normalizedMeta);
        } else {
            await itemBucket.init(remoteItems, normalizedMeta);
        }
        const config = (await itemBucket.configStorage.getValue()) ?? {};
        /*
         * diffStructure 仅在 profile SHA 变化时把 profile 放进 diff；若远端已有新账户但
         * 本地 structure 里记录的 SHA 已与远端一致（或漏更新），detail.profile 可能为空，
         * 此时误用旧 config.profileData 会导致界面只剩本机曾写入的数据。
         * 只要远端存在 profile.json，就在这里再拉一次正文。
         */
        let remoteProfileRaw: unknown = detail.profile?.content;
        if (
            (remoteProfileRaw === undefined || remoteProfileRaw === null) &&
            remote.profile
        ) {
            const [profFile] = await fetchContent(storeFullName, [
                remote.profile,
            ]);
            remoteProfileRaw = profFile?.content;
        }

        let profileData: Record<string, unknown>;
        if (remoteProfileRaw !== undefined && remoteProfileRaw !== null) {
            const normRemote = normalizeProfileSnapshot(remoteProfileRaw);
            if (await itemBucket.isProfileDirty()) {
                const localSnap = normalizeProfileSnapshot(
                    (await itemBucket.getProfile()) ?? {},
                );
                profileData = mergeProfileForSync(normRemote, localSnap);
            } else {
                profileData = normRemote;
            }
        } else {
            profileData = normalizeProfileSnapshot(config.profileData ?? {});
        }
        await itemBucket.configStorage.setValue({
            ...config,
            structure: remote,
            profileData,
        });
        notifyChange(storeFullName);
    };

    const create = async (name: string) => {
        const syncer = getSyncer();
        return await syncer.createStore(name);
    };

    const getAllItems = async (storeFullName: string) => {
        const { itemBucket } = getStore(storeFullName);
        const res = await itemBucket.getItems();
        return res ?? [];
    };

    const getMeta = async (storeFullName: string) => {
        const { itemBucket } = getStore(storeFullName);
        const res = (await itemBucket.getMeta()) ?? {};
        return res;
    };

    const batch = async (
        storeFullName: string,
        actions: Action<Item>[],
        overlap = false,
    ) => {
        const { itemBucket } = getStore(storeFullName);
        await itemBucket.batch(actions, overlap);
        notifyChange(storeFullName);
        // schedule sync immediately (we'll not use scheduler; user can call sync())
    };

    // core syncImmediate implementation (single run; supports abort)
    const syncImmediate = async (signal?: AbortSignal) => {
        const syncer = getSyncer();
        return Promise.all(
            Array.from(storeMap.entries()).map(
                async ([storeFullName, { itemBucket }]) => {
                    const stashes = await itemBucket.stashStorage.toArray();
                    const profileDirty = await itemBucket.isProfileDirty();
                    if (stashes.length === 0 && !profileDirty) {
                        return;
                    }
                    const isOverlap = Boolean(stashes[0]?.overlap);
                    // separate meta and item stashes
                    const metaStashes = stashes.filter(
                        (v) => v.type === "meta",
                    );
                    const itemStashes = stashes.filter(
                        (v) => v.type !== "meta",
                    );

                    const getRemoteStructure = (() => {
                        let struct: ReturnType<typeof fetchStructure>;
                        return () => {
                            if (!struct) {
                                struct = fetchStructure(storeFullName, signal);
                            }
                            return struct;
                        };
                    })();

                    // meta handler
                    const runMetaStashesHandler = async () => {
                        if (metaStashes.length === 0) return [];
                        const remoteStructure = await getRemoteStructure();
                        const [remoteMeta] = await fetchContent(
                            storeFullName,
                            [remoteStructure.meta],
                            signal,
                        );
                        const content = mergeMeta(
                            remoteMeta.content,
                            metaStashes[0].metaValue,
                        );
                        return [
                            {
                                path: "meta.json",
                                content,
                            },
                        ];
                    };

                    // items handler
                    const runItemStashesHandler = async () => {
                        if (itemStashes.length === 0) {
                            return { chunks: [], assets: [] };
                        }

                        const remoteStructure = await getRemoteStructure();
                        const structure = isOverlap
                            ? {
                                  chunks: [],
                                  assets: [],
                                  meta: remoteStructure.meta,
                              }
                            : remoteStructure;

                        const sortedChunk = sortBy(
                            structure.chunks,
                            (v) => v.startIndex,
                        );
                        const latestChunk = sortedChunk[sortedChunk.length - 1];
                        const latestChunkContent = latestChunk
                            ? (
                                  await fetchContent(
                                      storeFullName,
                                      [latestChunk],
                                      signal,
                                  )
                              )[0]
                            : undefined;

                        // transform assets: use syncer.transformAsset
                        const [transformed, assets] = transformAssets(
                            itemStashes,
                            (file: File) =>
                                syncer.transformAsset(file, storeFullName),
                        );

                        const newContent = [
                            ...(latestChunkContent?.content ?? []),
                            ...transformed,
                        ];

                        const startIndex = latestChunk?.startIndex ?? 0;
                        const chunks: {
                            path: string;
                            content: any | null;
                            sha?: string;
                        }[] = [];
                        for (
                            let i = 0;
                            i < newContent.length;
                            i += itemsPerChunk
                        ) {
                            const con = newContent.slice(i, i + itemsPerChunk);
                            const path = `${entryName}-${i + startIndex}.json`;
                            chunks.push({
                                path,
                                content: con,
                            });
                        }
                        // in overlap mode, ensure we mark remote files that are not in chunks as deleted (content null)
                        if (isOverlap) {
                            [
                                ...remoteStructure.chunks,
                                // ...remoteStructure.assets,// 暂时保留assets
                            ].forEach((rc) => {
                                if (
                                    chunks.findIndex(
                                        (c) => c.path === rc.path,
                                    ) === -1
                                ) {
                                    chunks.push({
                                        path: rc.path,
                                        content: null,
                                    });
                                }
                            });
                        }
                        return { chunks, assets };
                    };

                    const [itemResult, metaResult] = await Promise.all([
                        runItemStashesHandler(),
                        runMetaStashesHandler(),
                    ]);

                    // handle profile and account changes
                    const profileFiles: {
                        path: string;
                        content: any;
                    }[] = [];
                    const remoteStructure = await getRemoteStructure();

                    if (profileDirty) {
                        const localProfile = await itemBucket.getProfile();
                        if (localProfile) {
                            const remoteProfile = remoteStructure.profile
                                ? (
                                      await fetchContent(
                                          storeFullName,
                                          [remoteStructure.profile],
                                          signal,
                                      )
                                  )[0]?.content
                                : undefined;
                            const merged = remoteProfile
                                ? mergeProfileForSync(
                                      remoteProfile,
                                      localProfile,
                                  )
                                : normalizeProfileSnapshot(localProfile);
                            profileFiles.push({
                                path: "profile.json",
                                content: merged,
                            });
                        }
                    }

                    // prepare files for upload: we will call syncer.uploadContent with FileWithContent[]
                    const filesToUpload = [
                        ...itemResult.chunks,
                        ...metaResult,
                        ...profileFiles,
                    ];

                    // upload assets (actual upload of binary files) - the syncer.transformAsset above only transforms keys.
                    // For GitHub syncer we need to actually upload assets as blobs to assets/<name>
                    // We'll detect assets from itemResult.assets (transformAssets returns file list)
                    const assetFiles: { path: string; content: any }[] = [];
                    // itemResult.assets items are expected to have { file: File, formattedValue } shape (as transformAssets returns)
                    (itemResult.assets || []).forEach((a) => {
                        if (a.file) {
                            const assetPath = getSyncer().assetEntryToPath(
                                a,
                                storeFullName,
                            );
                            assetFiles.push({
                                path: assetPath,
                                content: a.file,
                            });
                        }
                    });

                    // combine assetFiles (binary) and filesToUpload (json blobs)
                    // For syncer.uploadContent we expect content either real content (for json) or File for binary - implementor should handle both.
                    const newStructure = await syncer.uploadContent(
                        storeFullName,
                        [...assetFiles, ...filesToUpload],
                        signal,
                    );

                    // after success, delete local stashes & update local meta
                    const config =
                        (await itemBucket.configStorage.getValue()) ?? {};
                    await Promise.all([
                        itemBucket.deleteStashes(
                            ...stashes.map((s: any) => s.id),
                        ),
                        itemBucket.configStorage.setValue({
                            ...config,
                            structure: newStructure,
                            ...(profileDirty ? { profileDirty: false } : {}),
                        }),
                        (async () => {
                            if (metaResult[0]) {
                                await itemBucket.metaStorage.setValue(
                                    metaResult[0].content,
                                );
                            }
                        })(),
                    ]);
                },
            ),
        );
    };

    const hasStashes = async () => {
        const somes = await Promise.all(
            Array.from(storeMap.values()).map(async ({ itemBucket }) => {
                const items = await itemBucket.stashStorage.toArray();
                const profileDirty = await itemBucket.isProfileDirty();
                return items.length > 0 || profileDirty;
            }),
        );
        return somes.some((v) => v);
    };

    const getProfile = async (storeFullName: string) => {
        const { itemBucket } = getStore(storeFullName);
        return (await itemBucket.getProfile()) ?? {};
    };

    const setProfile = async (storeFullName: string, data: any) => {
        const { itemBucket } = getStore(storeFullName);
        await itemBucket.setProfile(data);
        notifyChange(storeFullName);
    };

    // sync() returns [pendingPromise, cancelFn]
    const sync = () => {
        const ac = new AbortController();
        const p = syncImmediate(ac.signal);
        const cancel = () => ac.abort();
        return [p, cancel] as const;
    };

    const detach = async (stores?: string[]) => {
        const storeNames = stores ?? Array.from(storeMap.keys());
        return Promise.all(
            storeNames.map(async (name) => {
                const s = storeMap.get(name);
                await s?.storage.dangerousClearAll();
                storeMap.delete(name);
            }),
        );
    };

    const forceNeedSync = async (storeFullName: string) => {
        const { itemBucket } = getStore(storeFullName);
        await itemBucket.configStorage.setValue({
            structure: undefined,
        });
    };

    return {
        init,
        create,
        getAllItems,
        getMeta,
        batch,
        sync,
        detach,
        getAsset: (key: string, store: string) => {
            return getSyncer().getAsset(key, store);
        },
        getUserInfo: (id?: string) => getSyncer().getUserInfo(id),
        getCollaborators: (id: string) => getSyncer().getCollaborators(id),
        fetchAllStore: () => getSyncer().fetchAllStore(),
        onChange,
        hasStashes,
        forceNeedSync,
        getProfile,
        setProfile,
    };
};

type DiffedStructure = {
    meta?: StoreStructure["meta"];
    chunks: StoreStructure["chunks"];
    profile?: StoreStructure["profile"];
};
const diffStructure = (
    remote: StoreStructure,
    local?: StoreStructure,
): { diff: DiffedStructure; patch: boolean } => {
    if (!local) {
        return { diff: remote, patch: false };
    }
    const diff: DiffedStructure = {
        meta: remote.meta.sha !== local.meta.sha ? remote.meta : undefined,
        chunks: [],
        profile:
            remote.profile?.sha !== local.profile?.sha
                ? remote.profile
                : undefined,
    };
    const diffChunkIndex = remote.chunks.findIndex((c, i) => {
        if (c.sha !== local.chunks[i]?.sha) {
            return true;
        }
        return false;
    });
    if (diffChunkIndex !== -1) {
        diff.chunks = remote.chunks.slice(diffChunkIndex);
    }

    return { diff, patch: diffChunkIndex !== 0 };
};

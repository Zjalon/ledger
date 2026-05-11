import { decode, encode } from "js-base64";
import type { UserInfo } from "@/api/endpoints/type";
import type { FileEntry } from "@/database/assets";
import { shortId } from "@/database/id";
import { createInitialBookProfile } from "@/sync/book-remote-layout";
import type {
    AssetKey,
    FileLike,
    FileWithContent,
    StoreStructure,
    Syncer,
} from ".";

/**
 * createGiteeSyncer
 * config: { auth: ()=>Promise<{accessToken, refreshToken?}>, repoPrefix?: string, entryName?: string }
 */
export const createGiteeSyncer = (config: {
    auth: () => Promise<{ accessToken: string; refreshToken?: string }>;
    repoPrefix?: string;
    entryName?: string;
}): Syncer => {
    const {
        auth,
        repoPrefix = "gitray-db",
        entryName = "entry",
    } = config || {};

    const GITEE_API_BASE = "https://gitee.com/api/v5";

    const pathToName = (path: string) => {
        const splitted = path.split("/");
        return splitted[splitted.length - 1];
    };

    async function blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(",")[1];
                resolve(base64);
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(blob);
        });
    }

    const chunkPathPriority = (path: string) => {
        const name = pathToName(path);
        if (name.startsWith("ledger-")) {
            return 2;
        }
        if (name.startsWith("entry-")) {
            return 1;
        }
        return 0;
    };

    /** 兼容旧仓库 entry-* 与当前 ledger-* 两种分片前缀 */
    const parseLedgerChunkIndex = (
        path: string,
        entryNameLocal: string,
    ): number | null => {
        const name = pathToName(path);
        if (!name.endsWith(".json")) {
            return null;
        }
        const prefixes =
            entryNameLocal === "ledger"
                ? ["ledger", "entry"]
                : [entryNameLocal];
        for (const prefix of prefixes) {
            if (!name.startsWith(`${prefix}-`)) {
                continue;
            }
            const n = Number(
                name.replace(`${prefix}-`, "").replace(/\.json$/i, ""),
            );
            if (!Number.isNaN(n)) {
                return n;
            }
        }
        return null;
    };

    const treeDateToStructure = (
        tree: {
            path: string;
            mode: string;
            type: string;
            sha: string;
            size?: number;
            url?: string;
        }[],
        entryNameLocal: string,
    ) => {
        const structure = tree.reduce(
            (p, c) => {
                if (c.path === "meta.json") {
                    p.meta = c;
                } else if (c.path === "profile.json") {
                    p.profile = c;
                } else if (c.path.startsWith("assets/")) {
                    p.assets.push(c);
                } else {
                    const startIndex = parseLedgerChunkIndex(
                        c.path,
                        entryNameLocal,
                    );
                    if (startIndex !== null) {
                        p.chunks.push({ ...c, startIndex });
                    }
                }
                return p;
            },
            {
                chunks: [],
                assets: [],
                meta: { path: "", sha: "", size: 0 },
            } as StoreStructure,
        );

        const byIndex = new Map<number, (typeof structure.chunks)[number]>();
        for (const ch of structure.chunks) {
            const prev = byIndex.get(ch.startIndex);
            if (
                !prev ||
                chunkPathPriority(ch.path) > chunkPathPriority(prev.path)
            ) {
                byIndex.set(ch.startIndex, ch);
            }
        }
        structure.chunks = Array.from(byIndex.values()).sort(
            (a, b) => a.startIndex - b.startIndex,
        );

        // 对assets按路径排序，保持一致性
        structure.assets.sort((a, b) => a.path.localeCompare(b.path));

        return structure;
    };

    const parseRepoJsonFile = (
        filePath: string,
        base64: string | null | undefined,
    ): unknown => {
        const name = pathToName(filePath);
        const fallback = (): unknown => {
            if (name === "meta.json" || name === "profile.json") {
                return {};
            }
            if (/^(ledger|entry)-/i.test(name) && name.endsWith(".json")) {
                return [];
            }
            return {};
        };
        if (base64 === undefined || base64 === null || base64 === "") {
            return fallback();
        }
        try {
            const text = decode(base64).trim();
            if (!text) {
                return fallback();
            }
            return JSON.parse(text);
        } catch {
            return fallback();
        }
    };

    // generic helper to call gitee API with token
    const giteeRequest = async <T = any>(
        method: string,
        path: string,
        body?: any,
        signal?: AbortSignal,
    ): Promise<T> => {
        const { accessToken } = await auth();

        // 1. 使用 URL 对象构建完整的 URL
        const urlObj = new URL(`${GITEE_API_BASE}${path}`);

        // 2. 如果是 GET 请求，添加随机参数 t
        if (method.toUpperCase() === "GET") {
            urlObj.searchParams.set("t", Date.now().toString());
        }

        const headers: Record<string, string> = {
            Accept: "application/json",
            Authorization: `token ${accessToken}`,
        };

        const opts: RequestInit = {
            method,
            headers,
            signal,
        };

        if (body !== undefined) {
            opts.body = JSON.stringify(body);
            headers["Content-Type"] = "application/json";
        }

        // 3. 使用 urlObj.toString() 发起请求
        const res = await fetch(urlObj.toString(), opts);

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(
                `Gitee API ${method} ${path} failed: ${res.status} ${res.statusText} - ${txt}`,
            );
        }

        const txt = await res.text();
        return txt ? JSON.parse(txt) : ({} as any);
    };

    // fetch repo tree/structure
    const fetchStructure = async (
        storeFullName: string,
        signal?: AbortSignal,
    ) => {
        const [owner, repo] = storeFullName.split("/");
        if ([owner, repo].some((v) => v.length === 0))
            throw new Error(`invalid store name: ${storeFullName}`);
        // 1. repo info to get default branch
        const repoData = await giteeRequest<any>(
            "GET",
            `/repos/${owner}/${repo}`,
            undefined,
            signal,
        );
        const branch = repoData?.default_branch ?? "master";

        // 2. list root contents
        const rootList = await giteeRequest<any[]>(
            "GET",
            `/repos/${owner}/${repo}/contents?ref=${branch}`,
            undefined,
            signal,
        );

        // 3. list assets dir if exists
        let assetsList: any[] = [];
        try {
            assetsList = await giteeRequest<any[]>(
                "GET",
                `/repos/${owner}/${repo}/contents/assets?ref=${branch}`,
                undefined,
                signal,
            );
        } catch {
            assetsList = [];
        }

        // combine
        const combined = [
            ...(Array.isArray(rootList) ? rootList : []),
            ...(Array.isArray(assetsList) ? assetsList : []),
        ].map((f: any) => ({
            path: f.path,
            mode: "100644",
            type: f.type,
            sha: f.sha,
            size: f.size,
            url: f.url,
        }));

        return treeDateToStructure(combined, entryName);
    };

    // fetch content by file list (uses contents API to read file content base64)
    const fetchContent = async (
        storeFullName: string,
        files: FileLike[],
        signal?: AbortSignal,
    ) => {
        const [owner, repo] = storeFullName.split("/");
        if ([owner, repo].some((v) => v.length === 0))
            throw new Error(`invalid store name: ${storeFullName}`);

        const { accessToken } = await auth();

        const promises = files.map(async (f) => {
            const res = await fetch(
                `${GITEE_API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}`,
                {
                    headers: { Authorization: `token ${accessToken}` },
                    signal,
                },
            );
            if (!res.ok) {
                // file missing or error -> return undefined content but keep sha/path
                return {
                    path: f.path,
                    sha: f.sha,
                    content: undefined,
                } as FileWithContent;
            }
            const data = await res.json();
            const content = parseRepoJsonFile(f.path, data.content);
            return { path: f.path, sha: f.sha, content } as FileWithContent;
        });

        return Promise.all(promises);
    };

    // upload files: uses contents API per-file (create PUT/POST or DELETE)
    // files: { path, content } where content === null -> delete
    const uploadContent = async (
        storeFullName: string,
        files: { path: string; content: any }[],
        signal?: AbortSignal,
    ) => {
        const [owner, repo] = storeFullName.split("/");
        if ([owner, repo].some((v) => v.length === 0))
            throw new Error(`invalid store name: ${storeFullName}`);

        const { accessToken } = await auth();

        // get default branch
        const repoData = await giteeRequest<any>(
            "GET",
            `/repos/${owner}/${repo}`,
        );
        const branch = repoData?.default_branch ?? "master";

        // helper to get remote sha if exists
        const getRemoteSha = async (path: string) => {
            const res = await fetch(
                `${GITEE_API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
                {
                    headers: { Authorization: `token ${accessToken}` },
                    signal,
                },
            );
            if (!res.ok) return null;
            const d = await res.json();
            return d.sha as string | null;
        };

        // sequentially perform ops (create/update/delete)
        for (const f of files) {
            const remoteSha = await getRemoteSha(f.path);
            if (f.content === null || f.content === undefined) {
                // delete if exists
                if (remoteSha) {
                    await giteeRequest(
                        "DELETE",
                        `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}`,
                        {
                            message: `[Tidal] Delete ${f.path}`,
                            sha: remoteSha,
                            branch,
                        },
                        signal,
                    );
                }
                continue;
            }

            // prepare content as base64 string (Gitee expects base64 content in "content" field)
            let base64Content: string;
            if (f.content instanceof File || f.content instanceof Blob) {
                base64Content = await blobToBase64(f.content as Blob);
            } else {
                const contentStr =
                    typeof f.content === "string"
                        ? f.content
                        : JSON.stringify(f.content, null, 2);
                // convert string to blob then to base64
                const file = new File(
                    [new Blob([contentStr])],
                    pathToName(f.path),
                );
                base64Content = await blobToBase64(file);
            }

            const body = {
                message: `[Tidal] Update ${storeFullName}`,
                content: base64Content,
                branch,
                signal,
            };

            if (!remoteSha) {
                await giteeRequest(
                    "POST",
                    `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}`,
                    body,
                    signal,
                );
            } else {
                await giteeRequest(
                    "PUT",
                    `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}`,
                    { ...body, sha: remoteSha },
                    signal,
                );
            }
        }

        // after changes, return fresh structure
        return await fetchStructure(storeFullName);
    };

    // transformAsset: produce a gitee raw url for asset stored under assets/
    const transformAsset = (file: File, storeFullName: string) => {
        const [owner, repo] = storeFullName.split("/");
        // use master by default for simple static raw url
        const key = `https://gitee.com/${owner}/${repo}/master/assets/${shortId()}-${file.name}`;
        return key;
    };

    // getAsset: given a raw gitee url from transformAsset, fetch and return blob
    const getAsset = async (fileKey: AssetKey, storeFullName: string) => {
        if (!fileKey.startsWith("https://gitee.com")) {
            throw new Error("Unsupported asset key");
        }
        // raw url format: https://gitee.com/{owner}/{repo}/raw/{branch}/{path...}
        const splitted = fileKey.split("/");
        const owner = splitted[3];
        const repo = splitted[4];
        const path = splitted.slice(6).join("/"); // after /raw/{branch}/...
        const { accessToken } = await auth();
        const res = await fetch(
            `${GITEE_API_BASE}/repos/${owner}/${repo}/raw/${path}`,
            {
                headers: { Authorization: `token ${accessToken}` },
            },
        );
        if (!res.ok) throw new Error("Failed to fetch asset");
        const blob = await res.blob();
        return blob;
    };

    const assetEntryToPath = (v: FileEntry<string>) => {
        return v.formattedValue.split(`master/`)[1];
    };

    // createStore: create gitee repo and seed meta.json + profile.json（与 users / accounts / transactions 表布局一致）
    const createStore = async (name: string) => {
        // get current user
        const me = await giteeRequest<any>("GET", `/user`);
        const owner = me.login;
        const storeName = `${repoPrefix}-${name}`;

        // create repo
        await giteeRequest("POST", `/user/repos`, {
            name: storeName,
            description: `Created by Giteeray`,
            private: true,
            auto_init: true,
        });

        const { accessToken } = await auth();

        const postRootJson = async (filename: string, data: unknown) => {
            const path = `/repos/${owner}/${storeName}/contents/${filename}`;
            const res = await fetch(`${GITEE_API_BASE}${path}`, {
                method: "POST",
                headers: {
                    Authorization: `token ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message: "Initial commit by Giteeray",
                    content: encode(JSON.stringify(data)),
                    branch: "master",
                }),
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(
                    `Gitee create ${filename} failed: ${res.status} ${txt}`,
                );
            }
        };

        let retries = 3;
        while (retries > 0) {
            try {
                await postRootJson("meta.json", {});
                await postRootJson("profile.json", createInitialBookProfile());
                break;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                await new Promise((res) =>
                    setTimeout(res, 1000 * (2 - retries)),
                );
            }
        }

        return { id: `${owner}/${storeName}`, name: storeName };
    };

    const getUserInfo = async (id?: string) => {
        const { accessToken } = await auth();
        const path = id ? `/users/${id}` : "/user";
        const res = await fetch(`${GITEE_API_BASE}${path}`, {
            headers: { Authorization: `token ${accessToken}` },
        });
        if (!res.ok) throw new Error("Failed to fetch user info from gitee");
        const data = await res.json();
        return {
            avatar_url: data.avatar_url,
            name: data.login,
            id: data.id as unknown as string,
        } as UserInfo;
    };

    const getCollaborators = async (id: string) => {
        const { accessToken } = await auth();
        const [owner, repo] = id.split("/");
        const res = await fetch(
            `${GITEE_API_BASE}/repos/${owner}/${repo}/collaborators`,
            { headers: { Authorization: `token ${accessToken}` } },
        );
        if (!res.ok) throw new Error("Failed to fetch collaborators");
        const data = await res.json();
        return data.map((v: any) => ({
            avatar_url: v.avatar_url,
            name: v.login,
            id: v.id as unknown as string,
        })) as UserInfo[];
    };

    const fetchAllStore = async () => {
        const repos = await giteeRequest<any[]>("GET", `/user/repos`);
        return (repos || [])
            .filter((repo) => repo.name.startsWith(repoPrefix))
            .map((repo) => repo.full_name);
    };

    return {
        fetchAllStore,
        fetchStructure,
        fetchContent,
        uploadContent,

        transformAsset,
        getAsset,
        assetEntryToPath,

        createStore,
        getUserInfo,
        getCollaborators,
    };
};

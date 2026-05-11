import { showToast } from "vant";
import { onMounted, ref } from "vue";
import type { SyncEndpoint } from "@/api/endpoints/type";
import { useSync } from "@/composables/use-sync";

const LAST_SYNC_KEY = "ledger_last_sync_at";

export const syncing = ref(false);
export const pending = ref(false);
export const lastSyncAt = ref<number | null>(null);

let hookInstalled = false;
let endpointRef: SyncEndpoint | null = null;

/** 当前调度器这一轮同步的 Promise；供手动同步在 toSync 返回后继续 await 到真正结束 */
let latestRunningSync: Promise<void> | null = null;

const refreshPending = async () => {
    if (!endpointRef) return;
    try {
        pending.value = await endpointRef.getIsNeedSync();
    } catch {
        pending.value = false;
    }
};

const installSyncHooks = (ep: SyncEndpoint) => {
    if (hookInstalled) {
        endpointRef = ep;
        return;
    }
    hookInstalled = true;
    endpointRef = ep;

    const raw = localStorage.getItem(LAST_SYNC_KEY);
    lastSyncAt.value = raw ? Number(raw) : null;
    if (Number.isNaN(lastSyncAt.value ?? NaN)) {
        lastSyncAt.value = null;
    }

    ep.onSync((running) => {
        latestRunningSync = running;
        syncing.value = true;
        running
            .then(async () => {
                lastSyncAt.value = Date.now();
                localStorage.setItem(LAST_SYNC_KEY, String(lastSyncAt.value));
            })
            .catch(() => {
                showToast({
                    message: "同步失败，数据已保存在本机，联网后将同步到 Gitee",
                    duration: 3000,
                });
            })
            .finally(async () => {
                syncing.value = false;
                latestRunningSync = null;
                await refreshPending();
            });
    });
};

export function useSyncStatus() {
    const { ep, selectedBookId } = useSync();

    onMounted(async () => {
        installSyncHooks(ep);
        await refreshPending();
    });

    /**
     * 与入口一致：先 initBook 再 toSync。
     * 点击起即显示加载，直到本轮上传同步结束（toSync 本身不 await 调度回调）。
     */
    const triggerSync = async () => {
        syncing.value = true;
        try {
            const bookId = selectedBookId.value?.trim();
            if (bookId) {
                await ep.initBook(bookId);
            }
            await ep.toSync();
            const run = latestRunningSync;
            if (run) {
                await run.catch(() => {
                    /* 失败提示已在 onSync 链中 */
                });
            }
        } catch {
            showToast({
                message: "同步失败，数据已保存在本机，联网后将同步到 Gitee",
                duration: 3000,
            });
        } finally {
            syncing.value = false;
            await refreshPending();
        }
    };

    return {
        syncing,
        pending,
        lastSyncAt,
        triggerSync,
        refreshPending,
    };
}

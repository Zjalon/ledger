import { onUnmounted, type Ref, watch } from "vue";
import { useSync } from "@/composables/use-sync";
import { runBackgroundFullSync } from "@/composables/use-sync-status";

/** 主壳内定时全量同步间隔（毫秒） */
const FULL_SYNC_INTERVAL_MS = 10_000;

/**
 * 在账本入口就绪后，每 {@link FULL_SYNC_INTERVAL_MS} 拉取并推送一次全量数据：
 * profile（用户、资产账户）与分片流水（initBook + toSync）。
 */
export function usePeriodicBookFullSync(entryReady: Ref<boolean>) {
    const { ep, selectedBookId } = useSync();
    let timer: ReturnType<typeof setInterval> | null = null;

    const clearTimer = () => {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };

    const tick = async () => {
        if (!entryReady.value) {
            return;
        }
        const bookId = selectedBookId.value?.trim();
        if (!bookId) {
            return;
        }
        await runBackgroundFullSync(ep, bookId);
    };

    watch(
        () => [entryReady.value, selectedBookId.value] as const,
        ([ready, book]) => {
            clearTimer();
            if (!ready || !book?.trim()) {
                return;
            }
            void tick();
            timer = setInterval(() => {
                void tick();
            }, FULL_SYNC_INTERVAL_MS);
        },
        { immediate: true },
    );

    onUnmounted(() => {
        clearTimer();
    });
}

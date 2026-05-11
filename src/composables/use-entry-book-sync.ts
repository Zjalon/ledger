import { showToast } from "vant";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useSync } from "@/composables/use-sync";
import { runBookEntrySync } from "@/sync/book-entry-sync";

/**
 * 主布局挂载后：对已选账本执行一次入口同步，完成后才渲染子路由。
 * 账本列表页不负责 initBook，避免与首页重复拉取。
 */
export function useEntryBookSync() {
    const router = useRouter();
    const { ep, selectedBookId, clearSelectedBook } = useSync();
    const entryReady = ref(false);

    onMounted(async () => {
        const bookId = selectedBookId.value;
        if (!bookId) {
            entryReady.value = true;
            return;
        }

        try {
            await runBookEntrySync(ep, bookId);
            entryReady.value = true;
        } catch (e: unknown) {
            const msg =
                e instanceof Error ? e.message : String(e ?? "未知错误");
            const offlineHint =
                typeof navigator !== "undefined" && !navigator.onLine
                    ? "当前网络不可用。"
                    : "";
            clearSelectedBook();
            showToast({
                message: `${offlineHint}同步失败：${msg}。数据已保存在本机，联网后将同步到 Gitee`,
                duration: 3500,
            });
            router.replace({ name: "book-select" });
        }
    });

    return { entryReady };
}

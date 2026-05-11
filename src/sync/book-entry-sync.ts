import type { SyncEndpoint } from "@/api/endpoints/type";

/**
 * 进入主壳（已选定账本）时执行的单次同步：
 * 1. `initBook` 从远端拉取并合并当前账本数据；
 * 2. `toSync` 将本地待上传变更排入上传队列（与手动点同步图标一致）。
 */
export async function runBookEntrySync(
    ep: SyncEndpoint,
    bookId: string,
): Promise<void> {
    await ep.initBook(bookId);
    await ep.toSync();
}

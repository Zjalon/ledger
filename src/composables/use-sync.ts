import { ref } from "vue";
import { GiteeEndpoint } from "@/api/endpoints/gitee/index";
import type { SyncEndpoint } from "@/api/endpoints/type";
import type { Modal } from "@/components/modal";

const BOOK_KEY = "selected_book_id";

const noopModal: Modal = {
    prompt: async () => null,
};

let epSingleton: SyncEndpoint | null = null;

function getEndpoint(): SyncEndpoint {
    if (!epSingleton) {
        epSingleton = GiteeEndpoint.init({ modal: noopModal });
    }
    return epSingleton;
}

export function useSync() {
    const selectedBookId = ref(localStorage.getItem(BOOK_KEY) ?? "");
    const books = ref<{ id: string; name: string }[]>([]);
    const ep = getEndpoint();

    const selectBook = async (bookId: string) => {
        localStorage.setItem(BOOK_KEY, bookId);
        selectedBookId.value = bookId;
    };

    const clearSelectedBook = () => {
        localStorage.removeItem(BOOK_KEY);
        selectedBookId.value = "";
    };

    return { ep, books, selectedBookId, selectBook, clearSelectedBook };
}

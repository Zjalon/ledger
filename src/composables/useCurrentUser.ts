import { ref } from "vue";
import { LoginAPI } from "@/api/endpoints/gitee";
import type { SyncEndpoint } from "@/api/endpoints/type";
import type { User } from "@/database/tables/user";
import { useSync } from "./use-sync";

const PENDING_KEY = "pending_user_info";
const user = ref<User | null>(null);
let bound = false;

function getCurrentToken() {
    return LoginAPI.getLocalToken()?.accessToken;
}

async function loadUser(ep: SyncEndpoint, bookId: string) {
    const token = getCurrentToken();
    if (!token) return;
    try {
        const users = await ep.tableGetAllItems<User>(bookId, "users");
        const found = users.find((u) => u.id === token) ?? null;
        if (found) user.value = found;
    } catch {
        // table may not exist yet
    }
}

async function savePendingAndLoad(ep: SyncEndpoint, bookId: string) {
    const token = getCurrentToken();
    if (!token) return;

    // Try loading first
    await loadUser(ep, bookId);
    if (user.value) return;

    // No user found — check if there's pending info from login
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) {
        localStorage.removeItem(PENDING_KEY);
        try {
            const pending = JSON.parse(raw);
            await ep.tableBatch(bookId, "users", [
                {
                    type: "update",
                    timestamp: Date.now(),
                    id: pending.id,
                    value: pending,
                },
            ]);
            user.value = pending;
            await ep.toSync();
            return;
        } catch {
            // ignore
        }
    }

    // No pending info either — create user from Gitee API
    try {
        const info = await ep.getUserInfo();
        const newUser: User = {
            id: token,
            nickname: info.name,
            avatar: info.avatar_url,
        };
        await ep.tableBatch(bookId, "users", [
            {
                type: "update",
                timestamp: Date.now(),
                id: token,
                value: newUser,
            },
        ]);
        user.value = newUser;
        await ep.toSync();
    } catch {
        // ignore — user info unavailable
    }
}

export function useCurrentUser() {
    const { ep, selectedBookId } = useSync();

    const bookId = selectedBookId.value;
    if (bookId) {
        savePendingAndLoad(ep, bookId);
    }

    // Re-load after book data is synced (initBook triggers onChange)
    if (!bound) {
        bound = true;
        ep.onChange(async ({ bookId: id }) => {
            if (!user.value) {
                await savePendingAndLoad(ep, id);
            }
        });
    }

    const updateNickname = async (nickname: string) => {
        const bid = selectedBookId.value;
        const token = getCurrentToken();
        if (!bid || !token || !user.value) return;

        const updated = { ...user.value, nickname };
        await ep.tableBatch(bid, "users", [
            {
                type: "update",
                timestamp: Date.now(),
                id: token,
                value: updated,
            },
        ]);
        user.value = updated;
        await ep.toSync();
    };

    const reload = async () => {
        const bid = selectedBookId.value;
        if (bid) await savePendingAndLoad(ep, bid);
    };

    return { user, updateNickname, reload };
}

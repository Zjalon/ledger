import { computed, ref } from "vue";
import { LoginAPI } from "@/api/endpoints/gitee";

const TOKEN_KEY = "gitee_user_token";

const loggedIn = ref(!!localStorage.getItem(TOKEN_KEY));

export function useAuth() {
    const isLoggedIn = computed(() => loggedIn.value);

    const login = async (
        token: string,
    ): Promise<{ name: string; avatar_url: string }> => {
        const res = await fetch("https://gitee.com/api/v5/user", {
            headers: { Authorization: `token ${token}` },
        });
        if (!res.ok) {
            throw new Error("Token 无效");
        }
        const user = await res.json();
        LoginAPI.manuallySetToken(token);
        localStorage.setItem(
            "pending_user_info",
            JSON.stringify({
                id: token,
                nickname: user.name,
                avatar: user.avatar_url,
            }),
        );
        loggedIn.value = true;
        return { name: user.name, avatar_url: user.avatar_url };
    };

    const logout = () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem("SYNC_ENDPOINT");
        localStorage.removeItem("selected_book_id");
        loggedIn.value = false;
    };

    return { isLoggedIn, login, logout };
}

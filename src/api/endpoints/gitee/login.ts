import type { Modal } from "@/components/modal";
import { asyncOnce } from "@/utils/async";

const LOCAL_TOKEN_KEY = "gitee_user_token";

/**
 * Gitee 同步所需的令牌读写。
 * 本项目仅支持在登录页粘贴 **私人令牌**（Personal Access Token），不使用 OAuth 跳转与自建登录中转。
 */
export const createLoginAPI = () => {
    const login = (_ctx: { modal: Modal }) => {
        /* SyncEndpointFactory 占位：实际登录见 Login.vue 手动粘贴令牌 */
    };

    const afterLogin = () => {
        /* 不使用 OAuth 回调 */
    };

    const _getToken = async () => {
        const token = getLocalToken();
        if (!token?.accessToken) {
            throw new Error("token not found");
        }
        return token;
    };

    const getToken = asyncOnce(_getToken);

    const manuallySetToken = (token: string) => {
        localStorage.setItem("SYNC_ENDPOINT", "gitee");
        localStorage.setItem(
            LOCAL_TOKEN_KEY,
            JSON.stringify({
                accessToken: token,
            }),
        );
    };

    const getLocalToken = () => {
        const item = localStorage.getItem(LOCAL_TOKEN_KEY);
        if (!item) {
            return undefined;
        }
        return JSON.parse(item) as Token;
    };

    return {
        login,
        getToken,
        manuallySetToken,
        getLocalToken,
        afterLogin,
    };
};

type Token = {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    refreshTokenExpiresIn?: number;
};

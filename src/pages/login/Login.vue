<script setup lang="ts">
import { showToast } from "vant";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/use-auth";

const router = useRouter();
const { login } = useAuth();

const token = ref("");
const loading = ref(false);

const onSubmit = async () => {
    if (!token.value.trim()) {
        showToast("请输入 Gitee Token");
        return;
    }
    loading.value = true;
    try {
        const user = await login(token.value.trim());
        showToast(`欢迎，${user.name}`);
        router.replace("/");
    } catch {
        showToast("Token 无效，请检查后重试");
    } finally {
        loading.value = false;
    }
};
</script>

<template>
    <div class="login-page">
        <div class="login-atmosphere" aria-hidden="true">
            <div class="login-atmosphere__orb login-atmosphere__orb--a" />
            <div class="login-atmosphere__orb login-atmosphere__orb--b" />
            <div class="login-atmosphere__grain" />
        </div>

        <div class="login-inner">
            <header class="login-hero">
                <p class="login-kicker">家庭记账</p>
                <h1 class="login-brand">Ledger</h1>
                <p class="login-tagline">
                    一家人，一本账<br />每一笔都有迹可循
                </p>
            </header>

            <section class="login-card">
                <div class="login-card__intro">
                    <span class="login-card__label">连接你的账本仓库</span>
                    <p class="login-card__hint">
                        数据保存在你和家人共用的 Gitee 仓库中，离线也能记，联网再同步。
                    </p>
                </div>

                <van-form class="login-form" @submit="onSubmit">
                    <van-field
                        v-model="token"
                        class="login-field"
                        type="textarea"
                        rows="3"
                        autosize
                        name="token"
                        placeholder="在此粘贴 Gitee 私人令牌"
                        :rules="[{ required: true, message: '请输入 Token' }]"
                    />
                    <van-button
                        class="login-submit"
                        type="primary"
                        round
                        block
                        native-type="submit"
                        :loading="loading"
                        loading-text="正在验证…"
                    >
                        进入家庭账本
                    </van-button>
                </van-form>
            </section>

            <details class="login-details">
                <summary class="login-details__summary">
                    如何获取 Gitee 令牌？
                </summary>
                <ol class="login-details__list">
                    <li>
                        打开
                        <a
                            href="https://gitee.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            >gitee.com</a
                        >
                        并登录
                    </li>
                    <li>设置 → 私人令牌 → 生成新令牌</li>
                    <li>勾选 <strong>user_info</strong> 与 <strong>projects</strong></li>
                    <li>复制令牌，粘贴到上方输入框</li>
                </ol>
            </details>

            <p class="login-footnote">
                Ledger 不会上传你的令牌到我们的服务器；令牌仅在你的浏览器内用于访问
                Gitee API。
            </p>
        </div>
    </div>
</template>

<style scoped>
.login-page {
    --login-bg: var(--ledger-paper);
    --login-paper: var(--ledger-paper-card);
    --login-ink: var(--ledger-ink);
    --login-muted: var(--ledger-ink-subtle);
    --login-accent: var(--ledger-accent);
    --login-accent-hover: var(--ledger-accent-deep);
    --login-ring: var(--ledger-ring);

    flex: 1;
    min-height: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--login-bg);
    font-family: var(--ledger-font-ui);
    color: var(--login-ink);
}

.login-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.login-atmosphere__orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(64px);
    opacity: 0.55;
}

.login-atmosphere__orb--a {
    width: min(120vw, 520px);
    height: min(120vw, 520px);
    top: -18%;
    right: -25%;
    background: radial-gradient(
        circle,
        rgba(149, 213, 178, 0.45) 0%,
        transparent 68%
    );
    animation: login-float 14s ease-in-out infinite;
}

.login-atmosphere__orb--b {
    width: min(90vw, 380px);
    height: min(90vw, 380px);
    bottom: -8%;
    left: -18%;
    background: radial-gradient(
        circle,
        rgba(233, 196, 106, 0.28) 0%,
        transparent 70%
    );
    animation: login-float 18s ease-in-out infinite reverse;
}

.login-atmosphere__grain {
    position: absolute;
    inset: 0;
    opacity: 0.04;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

@keyframes login-float {
    0%,
    100% {
        transform: translate(0, 0) scale(1);
    }
    50% {
        transform: translate(2%, -3%) scale(1.05);
    }
}

.login-inner {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 28px 22px 36px;
    max-width: 440px;
    margin: 0 auto;
    width: 100%;
}

.login-hero {
    text-align: left;
    margin-bottom: 28px;
}

.login-kicker {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--login-accent);
    opacity: 0;
    animation: login-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.login-brand {
    margin: 0 0 12px;
    font-family: var(--ledger-font-display);
    font-size: clamp(2.75rem, 12vw, 3.5rem);
    font-weight: 400;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--login-ink);
    opacity: 0;
    animation: login-rise 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.08s forwards;
}

.login-tagline {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.55;
    color: var(--login-muted);
    opacity: 0;
    animation: login-rise 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.16s forwards;
}

@keyframes login-rise {
    from {
        opacity: 0;
        transform: translateY(16px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@media (prefers-reduced-motion: reduce) {
    .login-atmosphere__orb--a,
    .login-atmosphere__orb--b {
        animation: none;
    }

    .login-kicker,
    .login-brand,
    .login-tagline,
    .login-card,
    .login-details,
    .login-footnote {
        opacity: 1;
        animation: none;
        transform: none;
    }
}

.login-card {
    background: var(--login-paper);
    border-radius: 20px;
    padding: 22px 20px 24px;
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.65) inset,
        0 24px 48px -28px rgba(28, 25, 23, 0.18),
        0 8px 16px -12px rgba(var(--ledger-accent-rgb), 0.12);
    border: 1px solid rgba(231, 229, 228, 0.85);
    backdrop-filter: blur(10px);
    opacity: 0;
    animation: login-rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.22s forwards;
}

.login-card__intro {
    margin-bottom: 18px;
}

.login-card__label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--login-ink);
    letter-spacing: 0.02em;
}

.login-card__hint {
    margin: 8px 0 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--login-muted);
}

.login-form {
    margin: 0;
}

.login-submit.van-button--primary {
    margin-top: 18px;
    height: 48px;
    font-weight: 600;
    font-size: 15px;
    letter-spacing: 0.04em;
    border: none;
    background: linear-gradient(
        165deg,
        var(--login-accent) 0%,
        var(--login-accent-hover) 100%
    );
    box-shadow: 0 4px 14px -4px rgba(var(--ledger-accent-rgb), 0.55);
    transition:
        transform 0.2s ease,
        box-shadow 0.2s ease;
}

.login-submit.van-button--primary:active {
    transform: scale(0.98);
}

/* Vant Field：家庭账本纸质输入区 */
.login-field :deep(.van-field__body) {
    margin-top: 10px;
    padding: 14px 16px;
    background: rgba(250, 246, 240, 0.85);
    border-radius: 14px;
    border: 1px solid rgba(214, 211, 209, 0.95);
    transition:
        border-color 0.2s ease,
        box-shadow 0.2s ease;
}

.login-field :deep(.van-field__control) {
    font-family: var(--ledger-font-ui), ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.55;
    color: var(--login-ink);
}

.login-field :deep(.van-field__control::placeholder) {
    color: var(--ledger-ink-faint);
}

.login-field:focus-within :deep(.van-field__body) {
    border-color: var(--login-accent);
    box-shadow: 0 0 0 3px var(--login-ring);
}

.login-details {
    margin-top: 22px;
    padding: 14px 16px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.45);
    border: 1px dashed rgba(214, 211, 209, 0.95);
    opacity: 0;
    animation: login-rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.34s forwards;
}

.login-details__summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: var(--login-muted);
    list-style: none;
}

.login-details__summary::-webkit-details-marker {
    display: none;
}

.login-details__summary::after {
    content: " ▸";
    font-size: 11px;
    opacity: 0.7;
}

.login-details[open] .login-details__summary::after {
    content: " ▾";
}

.login-details__list {
    margin: 12px 0 0;
    padding-left: 18px;
    font-size: 13px;
    line-height: 1.75;
    color: var(--login-muted);
}

.login-details__list a {
    color: var(--login-accent);
    font-weight: 600;
    text-underline-offset: 3px;
}

.login-footnote {
    margin: 24px 0 0;
    font-size: 11px;
    line-height: 1.65;
    color: var(--ledger-ink-faint);
    text-align: center;
    opacity: 0;
    animation: login-rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) 0.42s forwards;
}
</style>

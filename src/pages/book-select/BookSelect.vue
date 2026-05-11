<script setup lang="ts">
import { closeToast, showLoadingToast, showToast } from "vant";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useSync } from "@/composables/use-sync";

const router = useRouter();
const { ep, books, selectBook } = useSync();

const loading = ref(true);
const newBookName = ref("");
const showCreateDialog = ref(false);

const shortBookId = (id: string) => {
    if (id.length <= 28) return id;
    return `${id.slice(0, 14)}…${id.slice(-10)}`;
};

const pickDialogOverlayStyle = {
    background: "rgba(28, 25, 23, 0.42)",
    backdropFilter: "blur(8px)",
} as const;

const bookCountLabel = computed(() => {
    const n = books.value.length;
    if (n <= 0) return "暂无账本";
    return `${n} 本家庭账本`;
});

const doSelectBook = async (bookId: string) => {
    await selectBook(bookId);
    router.replace("/");
};

const onCreateBook = async () => {
    const name = newBookName.value.trim() || "默认账本";
    showLoadingToast({ message: "创建中...", forbidClick: true, duration: 0 });
    try {
        const book = await ep.createBook(name);
        await selectBook(book.id);
        showCreateDialog.value = false;
        newBookName.value = "";
        closeToast();
        router.replace("/");
    } catch (e: unknown) {
        closeToast();
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        setTimeout(() => showToast(`创建失败：${msg}`), 100);
    }
};

onMounted(async () => {
    try {
        const list = await ep.fetchAllBooks();
        books.value = list;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        setTimeout(() => showToast(`获取账本失败：${msg}`), 100);
    } finally {
        loading.value = false;
    }
});
</script>

<template>
    <div class="pick-page">
        <div class="pick-atmosphere" aria-hidden="true">
            <div class="pick-atmosphere__orb pick-atmosphere__orb--a" />
            <div class="pick-atmosphere__orb pick-atmosphere__orb--b" />
            <div class="pick-atmosphere__grain" />
        </div>

        <div class="pick-inner">
            <header class="pick-hero">
                <p class="pick-kicker">接下来</p>
                <h1 class="pick-title">选一本家庭账</h1>
                <p class="pick-lede">
                    每个账本对应 Gitee 上的一个仓库；和家人共用同一仓库即可一起记。
                </p>
            </header>

            <div class="pick-toolbar">
                <span class="pick-count">{{ bookCountLabel }}</span>
                <button
                    type="button"
                    class="pick-new"
                    @click="showCreateDialog = true"
                >
                    <span class="pick-new__plus" aria-hidden="true">+</span>
                    新建账本
                </button>
            </div>

            <div class="pick-body">
                <div v-if="loading" class="pick-skeleton" aria-busy="true">
                    <div class="pick-skeleton__line pick-skeleton__line--long" />
                    <div class="pick-skeleton__line pick-skeleton__line--mid" />
                    <div class="pick-skeleton__cards">
                        <div v-for="n in 3" :key="n" class="pick-skeleton__card" />
                    </div>
                </div>

                <template v-else-if="books.length > 0">
                    <ul class="pick-list" role="list">
                        <li v-for="(book, index) in books" :key="book.id">
                            <button
                                type="button"
                                class="pick-card"
                                :style="{ '--stagger': `${index * 55}ms` }"
                                @click="doSelectBook(book.id)"
                            >
                                <span class="pick-card__spine" aria-hidden="true" />
                                <span class="pick-card__ledger" aria-hidden="true"
                                    >帐</span
                                >
                                <span class="pick-card__main">
                                    <span class="pick-card__name">{{
                                        book.name
                                    }}</span>
                                    <span class="pick-card__id">{{
                                        shortBookId(book.id)
                                    }}</span>
                                </span>
                                <van-icon
                                    name="arrow"
                                    class="pick-card__arrow"
                                />
                            </button>
                        </li>
                    </ul>
                </template>

                <div v-else class="pick-empty">
                    <div class="pick-empty__illu" aria-hidden="true">
                        <span class="pick-empty__sheet" />
                        <span class="pick-empty__sheet pick-empty__sheet--back" />
                    </div>
                    <p class="pick-empty__title">还没有账本</p>
                    <p class="pick-empty__text">
                        点右上角「新建账本」，Ledger 会在你的 Gitee
                        下创建一个仓库，家人加入仓库后即可一起记账。
                    </p>
                    <van-button
                        type="primary"
                        round
                        class="pick-empty__cta"
                        @click="showCreateDialog = true"
                    >
                        创建第一本账
                    </van-button>
                </div>
            </div>
        </div>

        <van-dialog
            v-model:show="showCreateDialog"
            class="pick-dialog"
            theme="round-button"
            show-cancel-button
            confirm-button-text="创建"
            cancel-button-text="取消"
            confirm-button-color="#2d6a4f"
            cancel-button-color="#78716c"
            :close-on-click-overlay="false"
            teleport="body"
            :overlay-style="pickDialogOverlayStyle"
            @confirm="onCreateBook"
        >
            <template #title>
                <div class="pick-dialog-title">
                    <p class="pick-dialog-title__kicker">家庭账本</p>
                    <h2 class="pick-dialog-title__main">新建账本</h2>
                    <p class="pick-dialog-title__lede">
                        为家人立一本新账，Ledger 会在 Gitee 为你生成仓库
                    </p>
                </div>
            </template>
            <div class="pick-dialog__body">
                <van-field
                    v-model="newBookName"
                    class="pick-dialog__field"
                    placeholder="例如：我们家的小账本"
                    label="账本名称"
                    label-align="top"
                />
                <p class="pick-dialog__hint">
                    名称可随时修改；也可在 Gitee 仓库设置里邀请家人协作。
                </p>
            </div>
        </van-dialog>
    </div>
</template>

<style scoped>
.pick-page {
    --pick-bg: var(--ledger-paper);
    --pick-ink: var(--ledger-ink);
    --pick-muted: var(--ledger-ink-subtle);
    --pick-accent: var(--ledger-accent);
    --pick-accent-soft: var(--ledger-accent-soft);
    --pick-paper: var(--ledger-paper-elevated);

    flex: 1;
    min-height: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--pick-bg);
    font-family: var(--ledger-font-ui);
    color: var(--pick-ink);
}

.pick-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.pick-atmosphere__orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(56px);
    opacity: 0.5;
}

.pick-atmosphere__orb--a {
    width: min(100vw, 480px);
    height: min(100vw, 480px);
    top: -22%;
    left: -30%;
    background: radial-gradient(
        circle,
        rgba(149, 213, 178, 0.42) 0%,
        transparent 68%
    );
    animation: pick-float 16s ease-in-out infinite;
}

.pick-atmosphere__orb--b {
    width: min(85vw, 360px);
    height: min(85vw, 360px);
    bottom: 5%;
    right: -25%;
    background: radial-gradient(
        circle,
        rgba(233, 196, 106, 0.26) 0%,
        transparent 72%
    );
    animation: pick-float 20s ease-in-out infinite reverse;
}

.pick-atmosphere__grain {
    position: absolute;
    inset: 0;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

@keyframes pick-float {
    0%,
    100% {
        transform: translate(0, 0) scale(1);
    }
    50% {
        transform: translate(3%, -2%) scale(1.04);
    }
}

.pick-inner {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 20px 32px;
    max-width: 480px;
    margin: 0 auto;
    width: 100%;
}

.pick-hero {
    margin-bottom: 22px;
}

.pick-kicker {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--pick-accent);
    opacity: 0;
    animation: pick-rise 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.pick-title {
    margin: 0 0 10px;
    font-family: var(--ledger-font-display);
    font-size: clamp(1.85rem, 8vw, 2.35rem);
    font-weight: 400;
    line-height: 1.12;
    letter-spacing: -0.02em;
    opacity: 0;
    animation: pick-rise 0.68s cubic-bezier(0.22, 1, 0.36, 1) 0.06s forwards;
}

.pick-lede {
    margin: 0;
    max-width: 36em;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.55;
    color: var(--pick-muted);
    opacity: 0;
    animation: pick-rise 0.68s cubic-bezier(0.22, 1, 0.36, 1) 0.12s forwards;
}

@keyframes pick-rise {
    from {
        opacity: 0;
        transform: translateY(14px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.pick-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
    opacity: 0;
    animation: pick-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.18s forwards;
}

.pick-count {
    font-size: 13px;
    font-weight: 600;
    color: var(--pick-muted);
}

.pick-new {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border: none;
    border-radius: 999px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: #fff;
    cursor: pointer;
    background: linear-gradient(
        165deg,
        var(--pick-accent) 0%,
        #1b4332 100%
    );
    box-shadow: 0 4px 14px -4px rgba(45, 106, 79, 0.45);
    transition: transform 0.18s ease;
}

.pick-new:active {
    transform: scale(0.97);
}

.pick-new__plus {
    font-size: 17px;
    font-weight: 500;
    line-height: 1;
    opacity: 0.95;
}

.pick-body {
    min-height: 120px;
}

.pick-list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.pick-card {
    display: flex;
    align-items: stretch;
    width: 100%;
    margin-bottom: 12px;
    padding: 0;
    border: none;
    border-radius: 18px;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    background: var(--pick-paper);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.65) inset,
        0 14px 36px -22px rgba(28, 25, 23, 0.2);
    border: 1px solid rgba(231, 229, 228, 0.95);
    overflow: hidden;
    opacity: 0;
    animation: pick-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: calc(0.22s + var(--stagger, 0ms));
    transition:
        transform 0.2s ease,
        box-shadow 0.2s ease;
}

.pick-card:active {
    transform: scale(0.985);
}

.pick-card:hover {
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.65) inset,
        0 18px 44px -20px rgba(45, 106, 79, 0.22);
}

.pick-card__spine {
    width: 6px;
    flex-shrink: 0;
    background: linear-gradient(
        180deg,
        #40916c 0%,
        var(--pick-accent) 48%,
        #1b4332 100%
    );
}

.pick-card__ledger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    flex-shrink: 0;
    font-family: var(--ledger-font-display);
    font-size: 17px;
    color: var(--pick-accent);
    background: var(--pick-accent-soft);
}

.pick-card__main {
    flex: 1;
    min-width: 0;
    padding: 14px 12px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.pick-card__name {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--pick-ink);
}

.pick-card__id {
    font-size: 11px;
    font-family: ui-monospace, monospace;
    color: var(--pick-muted);
    word-break: break-all;
    line-height: 1.35;
}

.pick-card__arrow {
    align-self: center;
    margin-right: 14px;
    color: #d6d3d1;
    font-size: 18px;
}

.pick-empty {
    padding: 28px 8px 16px;
    text-align: center;
}

.pick-empty__illu {
    position: relative;
    width: 88px;
    height: 72px;
    margin: 0 auto 20px;
}

.pick-empty__sheet {
    position: absolute;
    display: block;
    width: 56px;
    height: 72px;
    left: 50%;
    margin-left: -28px;
    border-radius: 4px;
    background: linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.95),
        rgba(250, 246, 240, 0.9)
    );
    border: 1px solid rgba(214, 211, 209, 0.9);
    box-shadow: 8px 10px 24px -12px rgba(28, 25, 23, 0.25);
    transform: rotate(-6deg);
}

.pick-empty__sheet--back {
    margin-left: -36px;
    opacity: 0.65;
    transform: rotate(8deg) translateX(-8px);
    z-index: -1;
}

.pick-empty__title {
    margin: 0 0 8px;
    font-family: var(--ledger-font-display);
    font-size: 1.35rem;
    font-weight: 400;
    color: var(--pick-ink);
}

.pick-empty__text {
    margin: 0 auto 22px;
    max-width: 28em;
    font-size: 13px;
    line-height: 1.65;
    color: var(--pick-muted);
}

.pick-empty__cta.van-button--primary {
    height: 44px;
    padding: 0 28px;
    font-weight: 600;
    border: none;
    background: linear-gradient(
        165deg,
        var(--pick-accent) 0%,
        #1b4332 100%
    );
    box-shadow: 0 4px 14px -4px rgba(45, 106, 79, 0.45);
}

.pick-skeleton__line {
    height: 12px;
    border-radius: 8px;
    background: linear-gradient(
        90deg,
        rgba(231, 229, 228, 0.65),
        rgba(245, 242, 239, 0.95),
        rgba(231, 229, 228, 0.65)
    );
    background-size: 200% 100%;
    animation: pick-shimmer 1.2s ease-in-out infinite;
    margin-bottom: 12px;
}

.pick-skeleton__line--long {
    width: 72%;
}

.pick-skeleton__line--mid {
    width: 48%;
    opacity: 0.85;
}

.pick-skeleton__cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 20px;
}

.pick-skeleton__card {
    height: 72px;
    border-radius: 18px;
    background: linear-gradient(
        90deg,
        rgba(231, 229, 228, 0.5),
        rgba(250, 246, 240, 0.85),
        rgba(231, 229, 228, 0.5)
    );
    background-size: 200% 100%;
    animation: pick-shimmer 1.2s ease-in-out infinite;
}

@keyframes pick-shimmer {
    0% {
        background-position: 100% 0;
    }
    100% {
        background-position: -100% 0;
    }
}

.pick-dialog__body {
    padding: 4px 2px 8px;
}

.pick-dialog__hint {
    margin: 14px 0 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--pick-muted);
}

.pick-dialog__field :deep(.van-field__label) {
    font-weight: 600;
    color: var(--pick-ink);
}

.pick-dialog__field :deep(.van-field__body) {
    margin-top: 8px;
    padding: 12px 14px;
    background: rgba(250, 246, 240, 0.9);
    border-radius: 12px;
    border: 1px solid rgba(214, 211, 209, 0.95);
}

.pick-dialog__field :deep(.van-field__control) {
    font-size: 15px;
}

@media (prefers-reduced-motion: reduce) {
    .pick-atmosphere__orb--a,
    .pick-atmosphere__orb--b {
        animation: none;
    }

    .pick-kicker,
    .pick-title,
    .pick-lede,
    .pick-toolbar,
    .pick-card {
        opacity: 1;
        animation: none;
        transform: none;
    }

    .pick-skeleton__line,
    .pick-skeleton__card {
        animation: none;
        background: rgba(231, 229, 228, 0.45);
    }
}
</style>

<style>
/*
 * van-dialog 挂载在 body：纸张质感、与选择页统一的字体与主色（Instrument Serif + 森林绿）
 */
.pick-dialog.van-dialog {
    width: min(100vw - 40px, 380px);
    max-width: 380px;
    overflow: hidden;
    font-family: var(--ledger-font-ui);
    background: linear-gradient(
        165deg,
        rgba(255, 254, 251, 0.98) 0%,
        rgba(250, 246, 240, 0.96) 100%
    );
    border-radius: 22px;
    border: 1px solid rgba(231, 229, 228, 0.95);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.75) inset,
        0 28px 56px -28px rgba(28, 25, 23, 0.35),
        0 12px 28px -18px rgba(var(--ledger-accent-rgb), 0.15);
}

.pick-dialog.van-dialog::before {
    content: "";
    display: block;
    height: 4px;
    margin: 0;
    background: linear-gradient(
        90deg,
        #40916c 0%,
        var(--ledger-accent) 45%,
        var(--ledger-accent-deep) 100%
    );
}

.pick-dialog .van-dialog__header {
    padding: 18px 22px 8px;
    text-align: left;
}

.pick-dialog-title__kicker {
    margin: 0 0 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--ledger-accent);
}

.pick-dialog-title__main {
    margin: 0 0 8px;
    font-family: var(--ledger-font-display);
    font-size: 1.65rem;
    font-weight: 400;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: var(--ledger-ink);
}

.pick-dialog-title__lede {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.5;
    color: var(--ledger-ink-subtle);
}

.pick-dialog .van-dialog__content {
    padding: 8px 22px 6px;
}

.pick-dialog .van-dialog__footer.van-dialog__footer {
    padding: 8px 14px 18px;
    gap: 10px;
    border-top: 1px solid rgba(231, 229, 228, 0.85);
    background: rgba(255, 252, 248, 0.55);
}

/* round-button 主题：底部 ActionBar */
.pick-dialog .van-action-bar {
    padding: 0;
    background: transparent;
}

.pick-dialog .van-dialog__cancel {
    flex: 1;
    margin: 0;
    height: 46px !important;
    border-radius: 999px !important;
    font-weight: 600 !important;
    font-size: 14px !important;
    background: rgba(255, 255, 255, 0.85) !important;
    border: 1px solid #d6d3d1 !important;
    color: var(--ledger-ink-muted) !important;
}

.pick-dialog .van-dialog__confirm {
    flex: 1.15;
    margin: 0;
    height: 46px !important;
    border-radius: 999px !important;
    font-weight: 600 !important;
    font-size: 14px !important;
    letter-spacing: 0.04em;
    border: none !important;
    color: #fff !important;
    background: linear-gradient(
        165deg,
        var(--ledger-accent) 0%,
        var(--ledger-accent-deep) 100%
    ) !important;
    box-shadow: 0 4px 14px -4px rgba(var(--ledger-accent-rgb), 0.45);
}

.pick-dialog .van-dialog__confirm:active {
    opacity: 0.92;
}

@media (prefers-reduced-motion: reduce) {
    .pick-dialog .van-dialog__confirm:active {
        opacity: 1;
    }
}
</style>

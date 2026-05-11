<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import RecordTransactionSheet from "@/components/RecordTransactionSheet.vue";
import { useEntryBookSync } from "@/composables/use-entry-book-sync";
import { usePeriodicBookFullSync } from "@/composables/use-periodic-book-sync";
import { useSyncStatus } from "@/composables/use-sync-status";

const router = useRouter();
const route = useRoute();
const active = ref(0);
const { entryReady } = useEntryBookSync();
const { syncing, pending, triggerSync } = useSyncStatus();
usePeriodicBookFullSync(entryReady);

const showRecordSheet = ref(false);

/** 分类设置页自带 van-nav-bar，隐藏外壳顶栏避免双层遮挡 */
const hideShellHeader = computed(() => route.name === "profile-categories");

const tabs = [
    { path: "/", icon: "records", label: "账本" },
    { path: "/stat", icon: "gem", label: "统计" },
    { path: "/assets", icon: "balance-list", label: "资产" },
    { path: "/profile", icon: "contact", label: "我的" },
];

const syncIndex = (path: string) => {
    const normalized = path === "/" ? "/" : path.replace(/\/$/, "") || "/";
    let idx = tabs.findIndex((t) => t.path === normalized);
    if (idx < 0 && normalized.startsWith("/profile")) {
        idx = 3;
    }
    if (idx >= 0) {
        active.value = idx;
    }
};

watch(
    () => route.path,
    (p) => syncIndex(p),
    { immediate: true },
);

const goTab = (index: number) => {
    router.push(tabs[index].path);
};

const onRecordClick = () => {
    showRecordSheet.value = true;
};

const onSyncClick = async () => {
    await triggerSync();
};
</script>

<template>
    <div class="layout-container">
        <header v-show="entryReady && !hideShellHeader" class="header">
            <div class="header-brand">
                <span class="header-title">Ledger</span>
                <span class="header-lede">家庭账本</span>
            </div>
            <button
                type="button"
                class="header-sync"
                aria-label="同步状态，点击同步"
                @click="onSyncClick"
            >
                <van-loading
                    v-if="syncing"
                    type="spinner"
                    size="18"
                    color="var(--ledger-accent)"
                />
                <van-icon
                    v-else-if="pending"
                    name="clock-o"
                    class="header-sync__icon header-sync__icon--pending"
                />
                <van-icon
                    v-else
                    name="passed"
                    class="header-sync__icon header-sync__icon--idle"
                />
            </button>
        </header>
        <div class="main">
            <div v-if="!entryReady" class="main-entry-loading">
                <van-loading vertical size="36px">正在同步账本…</van-loading>
            </div>
            <div v-else class="main-view">
                <router-view />
            </div>
        </div>
        <nav v-show="entryReady" class="app-tabbar" aria-label="主导航">
            <div class="app-tabbar__surface">
                <button
                    v-for="(tab, i) in tabs.slice(0, 2)"
                    :key="tab.path"
                    type="button"
                    class="app-tab"
                    :class="{ 'app-tab--active': active === i }"
                    @click="goTab(i)"
                >
                    <van-icon :name="tab.icon" class="app-tab__icon" />
                    <span class="app-tab__label">{{ tab.label }}</span>
                </button>

                <div class="app-tabbar__mid-spacer" aria-hidden="true" />

                <button
                    v-for="(tab, j) in tabs.slice(2, 4)"
                    :key="tab.path"
                    type="button"
                    class="app-tab"
                    :class="{ 'app-tab--active': active === j + 2 }"
                    @click="goTab(j + 2)"
                >
                    <van-icon :name="tab.icon" class="app-tab__icon" />
                    <span class="app-tab__label">{{ tab.label }}</span>
                </button>
            </div>

            <button
                type="button"
                class="app-record"
                aria-label="记一笔"
                @click="onRecordClick"
            >
                <span class="app-record__orb" aria-hidden="true">
                    <van-icon name="plus" class="app-record__plus" />
                </span>
            </button>
        </nav>

        <RecordTransactionSheet v-model:show="showRecordSheet" />
    </div>
</template>

<style scoped>
.layout-container {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--ledger-paper);
    overflow-x: hidden;
}
.header {
    --header-ink: var(--ledger-ink);
    --header-muted: var(--ledger-ink-subtle);
    --header-accent: var(--ledger-accent);
    --header-paper: rgba(255, 254, 251, 0.88);

    position: sticky;
    top: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 18px;
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
    flex-shrink: 0;
    background: linear-gradient(
        180deg,
        var(--header-paper) 0%,
        rgba(250, 246, 240, 0.96) 100%
    );
    border-bottom: 1px solid rgba(var(--ledger-accent-rgb), 0.09);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.65) inset,
        0 10px 28px -18px rgba(28, 25, 23, 0.07);
}

.header-brand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
}

.header-title {
    font-family: "Instrument Serif", Georgia, serif;
    font-size: clamp(1.35rem, 4.2vw, 1.55rem);
    font-weight: 400;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--header-ink);
}

.header-lede {
    font-family: var(--ledger-font-ui);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--header-accent);
    opacity: 0.85;
}

.header-sync {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.14);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.55);
    box-shadow: 0 2px 10px rgba(var(--ledger-accent-rgb), 0.06);
    cursor: pointer;
    transition:
        background 0.2s ease,
        transform 0.15s ease,
        box-shadow 0.2s ease;
}

.header-sync:active {
    transform: scale(0.96);
    background: rgba(255, 255, 255, 0.75);
}

.header-sync__icon {
    font-size: 20px;
}

.header-sync__icon--pending {
    color: var(--ledger-warm);
}

.header-sync__icon--idle {
    color: var(--header-accent);
    opacity: 0.55;
}
.main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* fixed 底栏脱离文档流，为内容预留与 tabbar+安全区一致的高度 */
    padding-bottom: var(--ledger-pwa-tabbar-h);
}
.main-entry-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 24px;
    background: var(--ledger-paper);
}

/* 让子页面根节点占满剩余高度并参与 min-height:0 收缩，否则内容撑开整页滚动 */
.main-view {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.main-view > :deep(*) {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.app-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    flex-shrink: 0;
    --tabbar-accent: var(--ledger-accent);
    --tabbar-ink: var(--ledger-ink-muted);
    --tabbar-paper: rgba(255, 254, 251, 0.97);
    --tabbar-row-h: 52px;
    /*
     * 底部安全区放在 nav 上并铺同色底，避免仅内层 padding 时 WebKit 在 Home
     * 条下方仍露出 body 的一条缝。
     */
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: constant(safe-area-inset-bottom, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--tabbar-paper);
    box-sizing: border-box;
}

.app-tabbar__surface {
    display: grid;
    grid-template-columns: 1fr 1fr 56px 1fr 1fr;
    align-items: center;
    gap: 0;
    box-sizing: border-box;
    padding: 8px;
    background: var(--tabbar-paper);
    border-top: 1px solid rgba(var(--ledger-accent-rgb), 0.1);
    box-shadow:
        0 -10px 32px rgba(28, 25, 23, 0.05),
        0 -1px 0 rgba(255, 255, 255, 0.92) inset;
}

.app-tabbar__mid-spacer {
    width: 56px;
    height: 1px;
    pointer-events: none;
    visibility: hidden;
}

.app-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: var(--tabbar-row-h);
    padding: 0 4px;
    border: none;
    background: transparent;
    font-family: var(--ledger-font-ui);
    color: var(--tabbar-ink);
    opacity: 0.72;
    cursor: pointer;
    transition:
        opacity 0.18s ease,
        color 0.18s ease;
}

.app-tab--active {
    opacity: 1;
    color: var(--tabbar-accent);
}

.app-tab__icon {
    font-size: 22px;
}

.app-tab__label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
}

.app-record {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    z-index: 2;
}

.app-record__orb {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: linear-gradient(
        165deg,
        var(--tabbar-accent) 0%,
        var(--ledger-accent-deep) 100%
    );
    box-shadow:
        0 8px 22px rgba(var(--ledger-accent-rgb), 0.38),
        0 1px 0 rgba(255, 255, 255, 0.22) inset;
    transform: translateY(-50%);
    transition: transform 0.18s ease;
}

.app-record:active .app-record__orb {
    transform: translateY(-50%) scale(0.94);
}

.app-record__plus {
    font-size: 24px;
    font-weight: 600;
}

/* 主屏幕 Web App：略加大底栏内边距，与 index.css 中 --ledger-pwa-tabbar-h 的 +4px 对齐 */
@media (display-mode: standalone) {
    .app-tabbar,
    .app-tabbar__surface {
        --tabbar-paper: rgb(255, 254, 251);
    }

    .app-tabbar {
        padding-bottom: calc(constant(safe-area-inset-bottom, 0px) + 4px);
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 4px);
    }
}
</style>

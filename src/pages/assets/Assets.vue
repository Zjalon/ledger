<script setup lang="ts">
import {
    closeToast,
    showConfirmDialog,
    showLoadingToast,
    showToast,
} from "vant";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { LoginAPI } from "@/api/endpoints/gitee";
import { useSync } from "@/composables/use-sync";
import { shortId } from "@/database/id";
import type { Full } from "@/database/stash";
import type { Account } from "@/database/tables/account";
import {
    ACCOUNT_TYPE_PRESETS,
    accountIconForDisplay,
    iconForAccountType,
    resolvedAccountType,
} from "@/ledger/account-display";
import { applyAccountDisplayOrder } from "@/ledger/account-order";
import { amountToNumber, numberToAmount } from "@/ledger/bill";
import type { PersonalMeta } from "@/ledger/extra-type";

const { selectedBookId, ep } = useSync();

const accounts = ref<Full<Account>[]>([]);
/** 当前用户在 meta.personal 中保存的账户排序；无则按余额排序 */
const ledgerAccountOrder = ref<string[] | undefined>(undefined);
let unsubscribe: (() => void) | undefined;

const fmt = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const COLOR_PRESETS = [
    "#2d6a4f",
    "#4ade80",
    "#60a5fa",
    "#1677ff",
    "#07c160",
    "#e9c46a",
    "#e76f51",
    "#606c38",
] as const;

const totalRaw = computed(() =>
    accounts.value.reduce((s, a) => s + (a.initialBalance ?? 0), 0),
);

const totalLabel = computed(() => fmt.format(amountToNumber(totalRaw.value)));

const sortedAccounts = computed(() => {
    const list = accounts.value;
    const ord = ledgerAccountOrder.value;
    if (ord !== undefined && ord.length > 0) {
        return applyAccountDisplayOrder(list, ord);
    }
    return [...list].sort(
        (a, b) => (b.initialBalance ?? 0) - (a.initialBalance ?? 0),
    );
});

const formVisible = ref(false);
const formEditingId = ref<string | null>(null);
const formName = ref("");
const formBalanceYuan = ref("0");
const formColor = ref(COLOR_PRESETS[0]);
const formAccountType = ref(ACCOUNT_TYPE_PRESETS[0].id);
const formSubmitting = ref(false);

const balancePopupVisible = ref(false);
const balanceTarget = ref<Full<Account> | null>(null);
const balanceYuanInput = ref("");
const balanceSubmitting = ref(false);

const formTitle = computed(() =>
    formEditingId.value ? "编辑账户" : "新建账户",
);

const actionSheetVisible = ref(false);
const menuAccount = ref<Full<Account> | null>(null);

const actionSheetActions = [
    { name: "编辑" },
    { name: "删除", color: "#ee0a24" },
];

function balanceLabel(raw?: number) {
    return fmt.format(amountToNumber(raw ?? 0));
}

function resetForm() {
    formEditingId.value = null;
    formName.value = "";
    formBalanceYuan.value = "0";
    formColor.value = COLOR_PRESETS[0];
    formAccountType.value = ACCOUNT_TYPE_PRESETS[0].id;
}

function openCreate() {
    const bookId = selectedBookId.value;
    if (!bookId) {
        showToast("请先选择账本");
        return;
    }
    resetForm();
    formVisible.value = true;
}

function openEdit(acc: Account) {
    formEditingId.value = acc.id;
    formName.value = acc.name;
    formBalanceYuan.value = String(amountToNumber(acc.initialBalance ?? 0));
    formColor.value = acc.color || COLOR_PRESETS[0];
    formAccountType.value = resolvedAccountType(acc);
    formVisible.value = true;
}

function openMenu(acc: Full<Account>) {
    menuAccount.value = acc;
    actionSheetVisible.value = true;
}

function onActionSelect(item: { name: string }) {
    const acc = menuAccount.value;
    menuAccount.value = null;
    if (!acc) return;
    if (item.name === "编辑") {
        openEdit(acc);
    } else if (item.name === "删除") {
        void confirmDelete(acc);
    }
}

function openAdjustBalance(acc: Full<Account>) {
    balanceTarget.value = acc;
    balanceYuanInput.value = String(amountToNumber(acc.initialBalance ?? 0));
    balancePopupVisible.value = true;
}

function resetBalancePopup() {
    balanceTarget.value = null;
    balanceYuanInput.value = "";
}

async function submitBalanceAdjust() {
    const bookId = selectedBookId.value;
    const acc = balanceTarget.value;
    if (!bookId || !acc) return;

    const yuan = Number(balanceYuanInput.value.replace(/,/g, ""));
    if (Number.isNaN(yuan)) {
        showToast("请输入有效金额");
        return;
    }

    const typeId = resolvedAccountType(acc);
    const payload: Account = {
        id: acc.id,
        name: acc.name,
        icon: iconForAccountType(typeId),
        color: acc.color,
        initialBalance: numberToAmount(yuan),
        accountType: typeId,
    };

    balanceSubmitting.value = true;
    showLoadingToast({ message: "保存中...", forbidClick: true, duration: 0 });
    try {
        await ep.tableBatch(bookId, "accounts", [
            { type: "update", value: payload },
        ]);
        await ep.toSync();
        closeToast();
        balancePopupVisible.value = false;
        resetBalancePopup();
    } catch (e: unknown) {
        closeToast();
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        showToast(`保存失败：${msg}`);
    } finally {
        balanceSubmitting.value = false;
    }
}

async function confirmDelete(acc: Account) {
    const bookId = selectedBookId.value;
    if (!bookId) return;
    try {
        await showConfirmDialog({
            title: "删除账户",
            message: `确定删除「${acc.name}」吗？`,
            confirmButtonColor: "#ee0a24",
        });
    } catch {
        return;
    }
    showLoadingToast({ message: "删除中...", forbidClick: true, duration: 0 });
    try {
        await ep.tableBatch(bookId, "accounts", [
            { type: "delete", value: acc.id },
        ]);
        await ep.toSync();
        closeToast();
    } catch (e: unknown) {
        closeToast();
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        showToast(`删除失败：${msg}`);
    }
}

async function submitForm() {
    const bookId = selectedBookId.value;
    if (!bookId) return;

    const name = formName.value.trim();
    if (!name) {
        showToast("请填写账户名称");
        return;
    }

    const yuan = Number(formBalanceYuan.value.replace(/,/g, ""));
    if (Number.isNaN(yuan)) {
        showToast("请输入有效金额");
        return;
    }

    const initialBalance = numberToAmount(yuan);

    const id = formEditingId.value ?? shortId();
    const typeId = formAccountType.value;
    const payload: Account = {
        id,
        name,
        icon: iconForAccountType(typeId),
        color: formColor.value,
        initialBalance,
        accountType: typeId,
    };

    formSubmitting.value = true;
    showLoadingToast({ message: "保存中...", forbidClick: true, duration: 0 });
    try {
        await ep.tableBatch(bookId, "accounts", [
            { type: "update", value: payload },
        ]);
        await ep.toSync();
        closeToast();
        formVisible.value = false;
        resetForm();
    } catch (e: unknown) {
        closeToast();
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        showToast(`保存失败：${msg}`);
    } finally {
        formSubmitting.value = false;
    }
}

async function loadAccounts() {
    const bookId = selectedBookId.value;
    if (!bookId) return;
    try {
        const uid = LoginAPI.getLocalToken()?.accessToken;
        const [list, meta] = await Promise.all([
            ep.tableGetAllItems<Account>(bookId, "accounts"),
            ep.getLedgerMeta(bookId),
        ]);
        accounts.value = list;
        if (uid) {
            ledgerAccountOrder.value = (
                meta.personal as Record<string, PersonalMeta> | undefined
            )?.[uid]?.accountDisplayOrder;
        } else {
            ledgerAccountOrder.value = undefined;
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        showToast(`加载账户失败：${msg}`);
    }
}

onMounted(async () => {
    await loadAccounts();
    unsubscribe = ep.onChange(async ({ bookId }) => {
        if (bookId === selectedBookId.value) {
            await loadAccounts();
        }
    });
});

onUnmounted(() => {
    unsubscribe?.();
});
</script>

<template>
    <div class="assets-page">
        <div class="assets-atmosphere" aria-hidden="true">
            <div class="assets-atmosphere__orb assets-atmosphere__orb--a" />
            <div class="assets-atmosphere__orb assets-atmosphere__orb--b" />
            <div class="assets-atmosphere__grain" />
        </div>

        <div class="assets-inner assets-inner--layout">
            <div class="assets-scroll-head">
                <header class="assets-hero">
                    <div class="assets-hero__top">
                        <p class="assets-kicker">资产总览</p>
                        <p class="assets-hero__note">
                            折合人民币汇总 · 左滑调余额 · 右滑删除
                        </p>
                    </div>
                    <div class="assets-total-wrap">
                        <p class="assets-total-label">折合总额（CNY）</p>
                        <p class="assets-total-value">{{ totalLabel }}</p>
                    </div>
                    <div class="assets-hero__accent" aria-hidden="true" />
                </header>
            </div>

            <section class="assets-section">
                <div class="assets-section-head">
                    <h2 class="assets-section-title">
                        <span class="assets-section-title__text">账户列表</span>
                    </h2>
                    <button
                        type="button"
                        class="assets-add-inline"
                        @click="openCreate"
                    >
                        添加
                    </button>
                </div>

                <div class="assets-list-scroll">
                    <ul
                        v-if="sortedAccounts.length > 0"
                        class="assets-list"
                        role="list"
                    >
                        <li
                            v-for="(acc, i) in sortedAccounts"
                            :key="acc.id"
                            class="assets-card-wrap"
                            :style="{ animationDelay: `${0.08 + i * 0.05}s` }"
                        >
                            <van-swipe-cell class="assets-swipe">
                                <template #left>
                                    <van-button
                                        square
                                        type="primary"
                                        class="swipe-side-btn swipe-side-btn--balance"
                                        @click.stop="openAdjustBalance(acc)"
                                    >
                                        调余额
                                    </van-button>
                                </template>
                                <button
                                    type="button"
                                    class="assets-card"
                                    :style="{
                                        '--asset-accent': acc.color || '#2d6a4f',
                                    }"
                                    @click="openMenu(acc)"
                                >
                                    <div
                                        class="assets-card__avatar"
                                        :style="{
                                            background: acc.color || '#2d6a4f',
                                        }"
                                    >
                                        <van-icon
                                            :name="accountIconForDisplay(acc)"
                                            class="assets-card__avatar-icon"
                                        />
                                    </div>
                                    <div class="assets-card__body">
                                        <p class="assets-card__name">
                                            {{ acc.name }}
                                        </p>
                                    </div>
                                    <p class="assets-card__amount">
                                        {{ balanceLabel(acc.initialBalance) }}
                                    </p>
                                </button>
                                <template #right>
                                    <van-button
                                        square
                                        type="danger"
                                        class="swipe-side-btn swipe-side-btn--del"
                                        @click.stop="confirmDelete(acc)"
                                    >
                                        删除
                                    </van-button>
                                </template>
                            </van-swipe-cell>
                        </li>
                    </ul>

                    <div v-else class="assets-empty">
                        <div class="assets-empty__frame">
                            <span class="assets-empty__glyph" aria-hidden="true">◇</span>
                            <p class="assets-empty__title">还没有账户</p>
                            <p class="assets-empty__hint">
                                点击下方按钮添加，或创建你的第一个账户。
                            </p>
                            <button
                                type="button"
                                class="assets-empty__cta"
                                @click="openCreate"
                            >
                                添加账户
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <van-action-sheet
            v-model:show="actionSheetVisible"
            :actions="actionSheetActions"
            cancel-text="取消"
            close-on-click-action
            @select="onActionSelect"
        />

        <van-popup
            v-model:show="balancePopupVisible"
            position="bottom"
            round
            closeable
            close-icon-position="top-right"
            @closed="resetBalancePopup"
        >
            <div class="balance-sheet">
                <h3 class="balance-sheet__title">调整余额</h3>
                <p v-if="balanceTarget" class="balance-sheet__account">
                    {{ balanceTarget.name }}
                </p>
                <p class="balance-sheet__hint">
                    修改的是账户当前余额（与资产列表展示一致）。
                </p>
                <van-field
                    v-model="balanceYuanInput"
                    label="余额（元）"
                    type="number"
                    placeholder="0.00"
                />
                <van-button
                    type="primary"
                    block
                    round
                    class="balance-sheet__submit"
                    :loading="balanceSubmitting"
                    @click="submitBalanceAdjust"
                >
                    保存
                </van-button>
            </div>
        </van-popup>

        <van-popup
            v-model:show="formVisible"
            position="bottom"
            round
            :style="{ maxHeight: '88%' }"
            closeable
            close-icon-position="top-right"
            @closed="resetForm"
        >
            <div class="form-sheet">
                <h3 class="form-sheet__title">{{ formTitle }}</h3>

                <van-field
                    v-model="formName"
                    label="名称"
                    placeholder="例如：招商银行"
                    maxlength="32"
                    required
                />
                <van-field
                    v-model="formBalanceYuan"
                    label="余额"
                    type="number"
                    placeholder="0.00"
                />

                <div class="form-block">
                    <p class="form-block__label">颜色</p>
                    <div class="form-colors">
                        <button
                            v-for="c in COLOR_PRESETS"
                            :key="c"
                            type="button"
                            class="form-color-dot"
                            :class="{ 'form-color-dot--active': formColor === c }"
                            :style="{ background: c }"
                            @click="formColor = c"
                        />
                    </div>
                </div>

                <div class="form-block">
                    <p class="form-block__label">账户类型</p>
                    <p class="form-block__hint">
                        图标随类型自动匹配（如现金为金币图标）。
                    </p>
                    <div class="form-icons form-icons--types">
                        <button
                            v-for="p in ACCOUNT_TYPE_PRESETS"
                            :key="p.id"
                            type="button"
                            class="form-type-chip"
                            :class="{
                                'form-type-chip--active':
                                    formAccountType === p.id,
                            }"
                            @click="formAccountType = p.id"
                        >
                            <van-icon
                                :name="p.icon"
                                class="form-type-chip__ico"
                            />
                            <span class="form-type-chip__txt">{{
                                p.label
                            }}</span>
                        </button>
                    </div>
                </div>

                <van-button
                    type="primary"
                    block
                    round
                    class="form-submit"
                    :loading="formSubmitting"
                    @click="submitForm"
                >
                    保存
                </van-button>
            </div>
        </van-popup>
    </div>
</template>

<style scoped>
.assets-page {
    --assets-bg: var(--ledger-paper);
    --assets-ink: var(--ledger-ink);
    --assets-muted: var(--ledger-ink-muted);
    --assets-accent: var(--ledger-accent);
    --assets-paper: var(--ledger-paper-elevated);

    flex: 1;
    min-height: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--assets-bg);
    font-family: var(--ledger-font-ui);
    color: var(--assets-ink);
}

.assets-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.assets-atmosphere__orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(52px);
    opacity: 0.48;
}

.assets-atmosphere__orb--a {
    width: min(92vw, 420px);
    height: min(92vw, 420px);
    top: -18%;
    right: -28%;
    background: radial-gradient(
        circle,
        rgba(var(--ledger-accent-rgb), 0.35) 0%,
        transparent 70%
    );
    animation: assets-float 18s ease-in-out infinite;
}

.assets-atmosphere__orb--b {
    width: min(70vw, 320px);
    height: min(70vw, 320px);
    bottom: 12%;
    left: -22%;
    background: radial-gradient(
        circle,
        rgba(233, 196, 106, 0.22) 0%,
        transparent 72%
    );
    animation: assets-float 22s ease-in-out infinite reverse;
}

.assets-atmosphere__grain {
    position: absolute;
    inset: 0;
    opacity: 0.04;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

@keyframes assets-float {
    0%,
    100% {
        transform: translate(0, 0) scale(1);
    }
    50% {
        transform: translate(-2%, 3%) scale(1.03);
    }
}

.assets-inner {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0 18px;
    max-width: 480px;
    margin: 0 auto;
    width: 100%;
}

.assets-inner--layout {
    gap: 16px;
}

.assets-scroll-head {
    flex-shrink: 0;
    padding-top: 16px;
}

.assets-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.assets-list-scroll {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding-bottom: calc(var(--ledger-pwa-tabbar-h, 68px) + 8px);
}

.assets-hero {
    position: relative;
    margin-bottom: 0;
    padding: 18px 16px 20px;
    border-radius: 22px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.09);
    background: linear-gradient(
        165deg,
        rgba(255, 254, 251, 0.98) 0%,
        var(--ledger-paper-card) 52%,
        var(--assets-paper) 100%
    );
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.9) inset,
        0 20px 48px -34px rgba(28, 25, 23, 0.38);
    overflow: hidden;
    opacity: 0;
    animation: assets-rise 0.72s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.assets-hero__top {
    margin-bottom: 16px;
    padding-left: 2px;
}

.assets-hero__note {
    margin: 8px 0 0;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.45;
    color: var(--ledger-ink-subtle);
}

.assets-hero__accent {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 5px;
    background: linear-gradient(
        180deg,
        var(--assets-accent) 0%,
        rgba(var(--ledger-accent-rgb), 0.35) 100%
    );
    border-radius: 20px 0 0 20px;
}

.assets-kicker {
    margin: 0;
    font-family: var(--ledger-font-display);
    font-size: clamp(1.35rem, 5vw, 1.65rem);
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: var(--assets-ink);
}

.assets-total-wrap {
    padding-left: 4px;
}

.assets-total-label {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--assets-muted);
    letter-spacing: 0.06em;
}

.assets-total-value {
    margin: 0;
    font-family: var(--ledger-font-display);
    font-size: clamp(2rem, 9vw, 2.65rem);
    font-weight: 400;
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    color: var(--assets-ink);
}

.assets-section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}

.assets-section-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-left: 14px;
    position: relative;
    opacity: 0;
    animation: assets-rise 0.65s cubic-bezier(0.22, 1, 0.36, 1) 0.12s forwards;
}

.assets-section-title::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.15em;
    bottom: 0.15em;
    width: 3px;
    border-radius: 999px;
    background: linear-gradient(
        180deg,
        var(--assets-accent) 0%,
        rgba(var(--ledger-accent-rgb), 0.35) 100%
    );
}

.assets-section-title__text {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--assets-muted);
}

.assets-add-inline {
    flex-shrink: 0;
    margin-top: 1px;
    padding: 9px 16px;
    border: none;
    border-radius: 999px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #fff;
    cursor: pointer;
    background: linear-gradient(
        165deg,
        var(--assets-accent) 0%,
        var(--ledger-accent-deep) 100%
    );
    box-shadow:
        0 4px 14px -6px rgba(var(--ledger-accent-rgb), 0.55),
        0 1px 0 rgba(255, 255, 255, 0.22) inset;
}

.assets-add-inline:active {
    transform: scale(0.97);
}

.assets-list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.assets-card-wrap {
    margin-bottom: 12px;
    opacity: 0;
    animation: assets-rise 0.58s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.assets-card-wrap:last-child {
    margin-bottom: 0;
}

.assets-swipe {
    border-radius: 17px;
    overflow: hidden;
}

.assets-swipe :deep(.van-swipe-cell__wrapper) {
    border-radius: 17px;
}

.assets-swipe :deep(.van-swipe-cell__left),
.assets-swipe :deep(.van-swipe-cell__right) {
    top: 0;
    bottom: 0;
}

.swipe-side-btn {
    height: 100%;
    width: 76px;
    padding: 0 6px;
    border: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.2;
    white-space: pre-line;
}

.swipe-side-btn--balance {
    background: linear-gradient(
        165deg,
        var(--assets-accent) 0%,
        var(--ledger-accent-deep) 100%
    ) !important;
    border: none !important;
}

.assets-card {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    margin: 0;
    padding: 14px 15px 14px 13px;
    border-radius: 17px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    background: var(--assets-paper);
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.09);
    border-left: 3px solid var(--asset-accent, rgba(var(--ledger-accent-rgb), 0.45));
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.82) inset,
        0 14px 32px -26px rgba(28, 25, 23, 0.42);
}

.assets-card:active {
    transform: scale(0.992);
    transition: transform 0.12s ease;
}

.assets-card__avatar {
    flex-shrink: 0;
    width: 46px;
    height: 46px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.02em;
    box-shadow: 0 6px 14px -6px rgba(0, 0, 0, 0.35);
}

.assets-card__avatar-icon {
    font-size: 22px;
    opacity: 0.98;
}

.assets-card__body {
    flex: 1;
    min-width: 0;
}

.assets-card__name {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.assets-card__amount {
    margin: 0;
    flex-shrink: 0;
    font-family: var(--ledger-font-display);
    font-size: clamp(1.05rem, 4.2vw, 1.2rem);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    color: var(--assets-ink);
}

.assets-empty {
    padding: 36px 16px 48px;
}

.assets-empty__frame {
    text-align: center;
    padding: 32px 22px;
    border-radius: 20px;
    border: 1px dashed rgba(87, 83, 78, 0.22);
    background: linear-gradient(
        165deg,
        rgba(255, 254, 251, 0.88) 0%,
        rgba(255, 254, 251, 0.52) 100%
    );
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.78) inset;
}

.assets-empty__glyph {
    display: block;
    margin-bottom: 12px;
    font-family: var(--ledger-font-display);
    font-size: 28px;
    color: var(--assets-accent);
    opacity: 0.55;
}

.assets-empty__title {
    margin: 0 0 8px;
    font-family: var(--ledger-font-display);
    font-size: 1.35rem;
    font-weight: 400;
}

.assets-empty__hint {
    margin: 0 0 18px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.55;
    color: var(--assets-muted);
}

.assets-empty__cta {
    padding: 12px 28px;
    border: none;
    border-radius: 999px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #fff;
    cursor: pointer;
    background: linear-gradient(
        165deg,
        var(--assets-accent) 0%,
        var(--ledger-accent-deep) 100%
    );
    box-shadow: 0 4px 14px -4px rgba(var(--ledger-accent-rgb), 0.45);
}

.balance-sheet {
    padding: 18px 18px calc(22px + env(safe-area-inset-bottom, 0px));
}

.balance-sheet__title {
    margin: 6px 0 8px;
    font-family: var(--ledger-font-display);
    font-size: 1.4rem;
    font-weight: 400;
    text-align: center;
    color: var(--assets-ink);
}

.balance-sheet__account {
    margin: 0 0 8px;
    text-align: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--assets-accent);
}

.balance-sheet__hint {
    margin: 0 0 16px;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.5;
    color: var(--assets-muted);
}

.balance-sheet__submit {
    margin-top: 12px;
}

.form-sheet {
    padding: 20px 18px calc(24px + env(safe-area-inset-bottom, 0px));
}

.form-sheet__title {
    margin: 8px 0 18px;
    font-family: var(--ledger-font-display);
    font-size: 1.45rem;
    font-weight: 400;
    text-align: center;
    color: var(--assets-ink);
}

.form-block {
    margin: 16px 0;
}

.form-block__label {
    margin: 0 0 10px;
    padding-left: 4px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--assets-muted);
}

.form-block__hint {
    margin: -4px 0 12px;
    padding-left: 4px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.45;
    color: var(--assets-muted);
    opacity: 0.85;
}

.form-colors {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.form-color-dot {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 3px solid transparent;
    cursor: pointer;
    padding: 0;
    transition:
        transform 0.15s ease,
        box-shadow 0.15s ease;
}

.form-color-dot--active {
    border-color: var(--assets-ink);
    box-shadow: 0 0 0 2px var(--assets-paper);
    transform: scale(1.06);
}

.form-icons--types {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}

.form-type-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 8px;
    border-radius: 12px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.18);
    background: rgba(255, 254, 251, 0.95);
    cursor: pointer;
    font-family: inherit;
    transition:
        border-color 0.15s ease,
        background 0.15s ease;
}

.form-type-chip__ico {
    font-size: 22px;
    color: var(--assets-accent);
}

.form-type-chip__txt {
    font-size: 11px;
    font-weight: 600;
    color: var(--assets-muted);
    line-height: 1.2;
    text-align: center;
}

.form-type-chip--active {
    border-color: var(--assets-accent);
    background: rgba(var(--ledger-accent-rgb), 0.12);
}

.form-type-chip--active .form-type-chip__ico {
    color: var(--assets-accent);
}

.form-type-chip--active .form-type-chip__txt {
    color: var(--assets-accent);
}

.form-submit {
    margin-top: 10px;
}

@keyframes assets-rise {
    from {
        opacity: 0;
        transform: translateY(16px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>

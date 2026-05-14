<script setup lang="ts">
import dayjs from "dayjs";
import {
    closeToast,
    showConfirmDialog,
    showLoadingToast,
    showToast,
} from "vant";
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { LoginAPI } from "@/api/endpoints/gitee";
import {
    type RangeUnit,
    useHistoryRange,
} from "@/composables/use-history-range";
import { buildCategoryLabelMap } from "@/composables/use-ledger-meta";
import { useSync } from "@/composables/use-sync";
import { useTxFilter } from "@/composables/use-tx-filter";
import type { Full } from "@/database/stash";
import type { Transaction } from "@/database/tables/transaction";
import type { User } from "@/database/tables/user";
import { amountToNumber } from "@/ledger/bill";
import type { BillCategory } from "@/ledger/type";

const { selectedBookId, ep } = useSync();
const history = useHistoryRange();

const startEdit = inject<(tx: Full<Transaction>) => void>("startEdit");

const bills = ref<Full<Transaction>[]>([]);
const usersList = ref<User[]>([]);
const metaCategories = ref<BillCategory[]>([]);

let unsubscribe: (() => void) | undefined;

const categoryLabelMap = computed(() =>
    buildCategoryLabelMap(metaCategories.value),
);

const fmt = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const showFilterSheet = ref(false);

const allRangeRows = computed(() => {
    const start = history.rangeStart.value.valueOf();
    const end = history.rangeEnd.value.valueOf();
    return bills.value
        .filter((b) => b.time >= start && b.time < end)
        .sort((a, b) => b.time - a.time);
});

const txFilter = useTxFilter(() => allRangeRows.value);

const visibleRows = computed(() => {
    if (txFilter.hasActiveFilters.value) {
        return txFilter.filteredRows.value;
    }
    return allRangeRows.value;
});

/** 顶部 hero：今日每位成员的收支合计（仅 income/expense，不含转账） */
type TodayHeroRow = {
    creatorKey: string;
    label: string;
    isSelf: boolean;
    expenseLabel: string;
    incomeLabel: string;
};

function creatorLabelFromKey(creatorKey: string): string {
    const u = usersList.value.find((x) => String(x.id) === creatorKey);
    const nick = u?.nickname?.trim();
    if (nick) {
        return nick;
    }
    if (creatorKey.length > 10) {
        return `成员 …${creatorKey.slice(-4)}`;
    }
    return "家庭成员";
}

const perCreatorHero = computed((): TodayHeroRow[] => {
    const start = history.rangeStart.value.valueOf();
    const end = history.rangeEnd.value.valueOf();
    const uid = LoginAPI.getLocalToken()?.accessToken?.trim() ?? "";

    const map = new Map<string, { expense: number; income: number }>();
    for (const b of bills.value) {
        if (b.time < start || b.time >= end) {
            continue;
        }
        if (b.type !== "expense" && b.type !== "income") {
            continue;
        }
        const k = String(b.creatorId);
        const cur = map.get(k) ?? { expense: 0, income: 0 };
        if (b.type === "expense") {
            cur.expense += b.amount;
        } else {
            cur.income += b.amount;
        }
        map.set(k, cur);
    }

    const rows: TodayHeroRow[] = [...map.entries()].map(
        ([creatorKey, sums]) => ({
            creatorKey,
            label: creatorLabelFromKey(creatorKey),
            isSelf: uid !== "" && creatorKey === uid,
            expenseLabel: fmt.format(amountToNumber(sums.expense)),
            incomeLabel: fmt.format(amountToNumber(sums.income)),
        }),
    );

    rows.sort((a, b) => {
        if (a.isSelf !== b.isSelf) {
            return a.isSelf ? -1 : 1;
        }
        return a.label.localeCompare(b.label, "zh-CN");
    });

    return rows;
});

function purposeLine(tx: Full<Transaction>): string {
    const cat = categoryLabelMap.value.get(tx.categoryId) ?? tx.categoryId;
    const comment = tx.comment?.trim();
    if (tx.type === "transfer") {
        return comment ? `转账 · ${comment}` : "转账";
    }
    if (comment) {
        return `${cat} · ${comment}`;
    }
    return cat;
}

function creatorLabel(tx: Full<Transaction>): string {
    return creatorLabelFromKey(String(tx.creatorId));
}

function timeLabel(ts: number): string {
    return dayjs(ts).format("HH:mm");
}

function amountLabel(tx: Full<Transaction>): string {
    const n = fmt.format(amountToNumber(tx.amount));
    if (tx.type === "expense") {
        return `− ${n}`;
    }
    if (tx.type === "income") {
        return `+ ${n}`;
    }
    return n;
}

function rowModifier(tx: Full<Transaction>): string {
    if (tx.type === "expense") {
        return "is-expense";
    }
    if (tx.type === "income") {
        return "is-income";
    }
    return "is-transfer";
}

function flowKindLabel(tx: Full<Transaction>): string {
    if (tx.type === "expense") {
        return "支出";
    }
    if (tx.type === "income") {
        return "收入";
    }
    return "转账";
}

async function confirmDeleteTransaction(tx: Full<Transaction>) {
    const bookId = selectedBookId.value?.trim();
    if (!bookId) {
        showToast("未选择账本");
        return;
    }
    try {
        await showConfirmDialog({
            title: "删除流水",
            message: `确定删除这笔${flowKindLabel(tx)}吗？删除后相关账户余额将恢复为删除前的状态。`,
            confirmButtonColor: "#ee0a24",
        });
    } catch {
        return;
    }
    showLoadingToast({ message: "删除中...", forbidClick: true, duration: 0 });
    try {
        await ep.tableBatch(bookId, "transactions", [
            { type: "delete", value: tx.id },
        ]);
        await ep.toSync();
        closeToast();
        showToast("已删除");
    } catch (e: unknown) {
        closeToast();
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        showToast(`删除失败：${msg}`);
    }
}

async function refreshData(bookId: string) {
    const [txs, users, meta] = await Promise.all([
        ep.tableGetAllItems<Transaction>(bookId, "transactions"),
        ep.tableGetAllItems<User>(bookId, "users"),
        ep.getLedgerMeta(bookId),
    ]);
    bills.value = txs;
    usersList.value = users;
    metaCategories.value = Array.isArray(meta.categories)
        ? (meta.categories as BillCategory[])
        : [];
}

onMounted(async () => {
    const bookId = selectedBookId.value;
    if (!bookId) return;

    try {
        await refreshData(bookId);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        showToast(`加载账单失败：${msg}`);
    }

    unsubscribe = ep.onChange(async ({ bookId: id }) => {
        try {
            await refreshData(id);
        } catch {
            /* ignore */
        }
    });
});

onUnmounted(() => {
    unsubscribe?.();
});
</script>

<template>
    <div class="journal-page">
        <div class="journal-atmosphere" aria-hidden="true">
            <div class="journal-atmosphere__orb journal-atmosphere__orb--a" />
            <div class="journal-atmosphere__orb journal-atmosphere__orb--b" />
            <div class="journal-atmosphere__grain" />
        </div>

        <div class="journal-inner journal-inner--layout">
            <div class="journal-scroll-head">
                <header class="journal-hero">
                    <div class="journal-hero__top">
                        <div class="journal-date-nav">
                            <button type="button" class="journal-date-nav__btn" @click="history.prev" aria-label="上一个">‹</button>
                            <button type="button" class="journal-date-nav__label" @click="history.goToday" :class="{ 'journal-date-nav__label--today': history.isToday.value }">{{ history.rangeLabel.value }}</button>
                            <button type="button" class="journal-date-nav__btn" @click="history.next" :disabled="history.isToday.value" aria-label="下一个">›</button>
                        </div>
                        <div class="journal-range-tabs">
                            <button v-for="u in (['day', 'week', 'month'] as RangeUnit[])" :key="u" type="button" class="journal-range-tab" :class="{ 'journal-range-tab--active': history.unit.value === u }" @click="history.setUnit(u)">{{ u === 'day' ? '日' : u === 'week' ? '周' : '月' }}</button>
                        </div>
                        <p class="journal-kicker">{{ history.isToday.value ? '今日概览' : history.rangeLabel.value }}</p>
                        <p class="journal-hero__note">各成员 · 仅收支 · 不含转账</p>
                    </div>
                    <div
                        v-if="perCreatorHero.length === 0"
                        class="journal-hero-empty"
                    >
                        <p class="journal-hero-empty__text">
                            {{ history.isToday.value ? '今日暂无收支（仅统计收入与支出）' : '该时段暂无收支（仅统计收入与支出）' }}
                        </p>
                    </div>
                    <div v-else class="journal-stats-by-user">
                        <div class="journal-stats-by-user__head" aria-hidden="true">
                            <span class="journal-stats-by-user__h-name">成员</span>
                            <span class="journal-stats-by-user__h-out">支出</span>
                            <span class="journal-stats-by-user__h-in">收入</span>
                        </div>
                        <ul class="journal-stats-by-user__list" role="list">
                            <li
                                v-for="row in perCreatorHero"
                                :key="row.creatorKey"
                                class="journal-stats-by-user__row"
                            >
                                <span class="journal-stats-by-user__name">
                                    {{ row.label }}
                                    <span
                                        v-if="row.isSelf"
                                        class="journal-stats-by-user__me"
                                    >
                                        我
                                    </span>
                                </span>
                                <span
                                    class="journal-stats-by-user__num journal-stats-by-user__num--out"
                                >
                                    {{ row.expenseLabel }}
                                </span>
                                <span
                                    class="journal-stats-by-user__num journal-stats-by-user__num--in"
                                >
                                    {{ row.incomeLabel }}
                                </span>
                            </li>
                        </ul>
                    </div>
                    <div class="journal-hero__accent" aria-hidden="true" />
                </header>
            </div>

            <div class="journal-search-bar">
                <button
                    type="button"
                    class="journal-search-btn"
                    :class="{ 'journal-search-btn--active': txFilter.hasActiveFilters.value }"
                    @click="showFilterSheet = true"
                >
                    <van-icon name="search" size="16" />
                    <span>{{ txFilter.filters.value.keyword || '搜索流水' }}</span>
                    <span v-if="txFilter.hasActiveFilters.value" class="journal-search-btn__badge" />
                </button>
            </div>

            <section class="journal-section">
                <h2 class="journal-section-title">
                    <span class="journal-section-title__text">
                        {{ history.isToday.value && !txFilter.hasActiveFilters.value ? '今日流水' : `流水 · ${visibleRows.length} 条` }}
                    </span>
                </h2>

                <div class="journal-list-scroll">
                    <div v-if="bills.length === 0" class="journal-empty">
                        <p class="journal-empty__title">账本还是空的</p>
                        <p class="journal-empty__hint">记下第一笔，从今天开始。</p>
                    </div>

                    <div
                        v-else-if="visibleRows.length === 0"
                        class="journal-empty journal-empty--soft"
                    >
                        <p class="journal-empty__title">{{ history.isToday.value ? '今日还没有收支' : '该时段没有流水' }}</p>
                        <p class="journal-empty__hint">{{ history.isToday.value ? '点击底部中间的「记一笔」。' : '换个时间看看，或记一笔新的。' }}</p>
                    </div>

                    <ol v-else class="journal-timeline" role="list">
                        <li
                            v-for="(tx, i) in visibleRows"
                            :key="tx.id"
                            class="journal-timeline__item"
                            :style="{ animationDelay: `${0.06 + i * 0.045}s` }"
                        >
                            <van-swipe-cell class="journal-swipe">
                                <div
                                    class="journal-row"
                                    :class="rowModifier(tx)"
                                >
                                    <div class="journal-row__card">
                                        <div class="journal-row__top">
                                            <span class="journal-row__who">{{
                                                creatorLabel(tx)
                                            }}</span>
                                            <span
                                                class="journal-row__pill"
                                                :class="`journal-row__pill--${tx.type}`"
                                            >
                                                {{ flowKindLabel(tx) }}
                                            </span>
                                            <time
                                                class="journal-row__when"
                                                :datetime="
                                                    new Date(
                                                        tx.time,
                                                    ).toISOString()
                                                "
                                            >
                                                {{ timeLabel(tx.time) }}
                                            </time>
                                        </div>
                                        <p class="journal-row__what">
                                            {{ purposeLine(tx) }}
                                        </p>
                                        <p class="journal-row__money">
                                            {{ amountLabel(tx) }}
                                        </p>
                                    </div>
                                </div>
                                <template #right>
                                    <van-button
                                        square
                                        type="primary"
                                        class="swipe-side-btn swipe-side-btn--edit"
                                        @click.stop="startEdit?.(tx)"
                                    >
                                        编辑
                                    </van-button>
                                    <van-button
                                        square
                                        type="danger"
                                        class="swipe-side-btn swipe-side-btn--del"
                                        @click.stop="
                                            confirmDeleteTransaction(tx)
                                        "
                                    >
                                        删除
                                    </van-button>
                                </template>
                            </van-swipe-cell>
                        </li>
                    </ol>
                </div>
            </section>
        </div>

        <van-popup
            v-model:show="showFilterSheet"
            position="bottom"
            round
            safe-area-inset-bottom
            class="filter-popup"
        >
            <div class="filter-panel">
                <div class="filter-panel__head">
                    <h2 class="filter-panel__title">筛选流水</h2>
                    <button type="button" class="filter-panel__reset" @click="txFilter.resetFilters()">重置</button>
                </div>
                <div class="filter-panel__body">
                    <div class="filter-field">
                        <label class="filter-field__label">关键词</label>
                        <input v-model="txFilter.filters.value.keyword" type="text" class="filter-field__input" placeholder="搜索备注…" autocomplete="off" />
                    </div>
                    <div class="filter-field">
                        <label class="filter-field__label">金额范围</label>
                        <div class="filter-field__row">
                            <input v-model.number="txFilter.filters.value.minAmount" type="number" inputmode="decimal" class="filter-field__input filter-field__input--half" placeholder="最小" min="0" />
                            <span class="filter-field__sep">–</span>
                            <input v-model.number="txFilter.filters.value.maxAmount" type="number" inputmode="decimal" class="filter-field__input filter-field__input--half" placeholder="最大" min="0" />
                        </div>
                    </div>
                    <div class="filter-field">
                        <label class="filter-field__label">类型</label>
                        <div class="filter-chips">
                            <button
                                v-for="t in ([{ v: 'expense', l: '支出' }, { v: 'income', l: '收入' }, { v: 'transfer', l: '转账' }] as const)"
                                :key="t.v"
                                type="button"
                                class="filter-chip"
                                :class="{ 'filter-chip--active': txFilter.filters.value.types.includes(t.v) }"
                                @click="txFilter.filters.value.types.includes(t.v) ? (txFilter.filters.value.types = txFilter.filters.value.types.filter((x) => x !== t.v)) : txFilter.filters.value.types.push(t.v)"
                            >
                                {{ t.l }}
                            </button>
                        </div>
                    </div>
                </div>
                <div class="filter-panel__foot">
                    <van-button type="primary" block round @click="showFilterSheet = false">
                        查看 {{ txFilter.filteredRows.value.length }} 条结果
                    </van-button>
                </div>
            </div>
        </van-popup>
    </div>
</template>

<style scoped>
.journal-page {
    --journal-bg: var(--ledger-paper);
    --journal-ink: var(--ledger-ink);
    --journal-muted: var(--ledger-ink-muted);
    --journal-accent: var(--ledger-accent);
    --journal-expense: var(--ledger-warm);
    --journal-income: var(--ledger-income);
    --journal-paper: var(--ledger-paper-elevated);

    flex: 1;
    min-height: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--journal-bg);
    font-family: var(--ledger-font-ui);
    color: var(--journal-ink);
}

.journal-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.journal-atmosphere__orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(54px);
    opacity: 0.46;
}

.journal-atmosphere__orb--a {
    width: min(88vw, 400px);
    height: min(88vw, 400px);
    top: -16%;
    left: -26%;
    background: radial-gradient(
        circle,
        rgba(var(--ledger-warm-rgb), 0.14) 0%,
        transparent 72%
    );
    animation: journal-float 19s ease-in-out infinite;
}

.journal-atmosphere__orb--b {
    width: min(72vw, 300px);
    height: min(72vw, 300px);
    bottom: 20%;
    right: -24%;
    background: radial-gradient(
        circle,
        rgba(var(--ledger-accent-rgb), 0.28) 0%,
        transparent 70%
    );
    animation: journal-float 21s ease-in-out infinite reverse;
}

.journal-atmosphere__grain {
    position: absolute;
    inset: 0;
    opacity: 0.038;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

@keyframes journal-float {
    0%,
    100% {
        transform: translate(0, 0) scale(1);
    }
    50% {
        transform: translate(2%, -2%) scale(1.03);
    }
}

.journal-inner {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0 16px;
    max-width: 480px;
    margin: 0 auto;
    width: 100%;
}

.journal-inner--layout {
    gap: 16px;
}

.journal-scroll-head {
    flex-shrink: 0;
    padding-top: 14px;
}

.journal-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.journal-list-scroll {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    /* 底栏 + 记一笔球占位 */
    padding-bottom: calc(var(--ledger-pwa-tabbar-h, 68px) + 8px);
}

.journal-hero {
    position: relative;
    margin-bottom: 0;
    padding: 18px 16px 18px;
    border-radius: 22px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.09);
    background: linear-gradient(
        165deg,
        rgba(255, 254, 251, 0.98) 0%,
        var(--ledger-paper-card) 55%,
        var(--journal-paper) 100%
    );
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.9) inset,
        0 20px 48px -34px var(--ledger-shadow-ink);
    overflow: hidden;
    opacity: 0;
    animation: journal-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.journal-hero__top {
    margin-bottom: 14px;
    padding-left: 2px;
    padding-right: 4px;
}

.journal-date-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 10px;
}
.journal-date-nav__btn {
    border: none;
    background: rgba(var(--ledger-accent-rgb), 0.08);
    color: var(--ledger-ink-muted);
    font-size: 20px;
    font-weight: 700;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease;
}
.journal-date-nav__btn:active {
    background: rgba(var(--ledger-accent-rgb), 0.16);
}
.journal-date-nav__btn:disabled {
    opacity: 0.35;
    cursor: default;
}
.journal-date-nav__label {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    font-family: var(--ledger-font-display);
    font-size: clamp(1.2rem, 4.5vw, 1.45rem);
    font-weight: 400;
    letter-spacing: -0.02em;
    color: var(--journal-ink);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 8px;
    transition: background 0.15s ease;
}
.journal-date-nav__label:active {
    background: rgba(var(--ledger-accent-rgb), 0.06);
}
.journal-date-nav__label--today {
    color: var(--journal-accent);
}
.journal-range-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
}
.journal-range-tab {
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.12);
    background: rgba(255, 254, 251, 0.7);
    color: var(--ledger-ink-muted);
    font-size: 12px;
    font-weight: 700;
    padding: 5px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.journal-range-tab--active {
    background: rgba(var(--ledger-accent-rgb), 0.12);
    color: var(--ledger-accent-deep);
    border-color: rgba(var(--ledger-accent-rgb), 0.25);
}

.journal-hero__note {
    margin: 8px 0 0;
    padding-left: 2px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--ledger-ink-subtle);
}

.journal-hero__accent {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 5px;
    background: linear-gradient(
        180deg,
        var(--journal-accent) 0%,
        rgba(var(--ledger-warm-rgb), 0.35) 100%
    );
    border-radius: 20px 0 0 20px;
}

.journal-kicker {
    margin: 0;
    font-family: var(--ledger-font-display);
    font-size: clamp(1.35rem, 5vw, 1.6rem);
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: var(--journal-ink);
}

.journal-hero-empty {
    padding: 10px 8px 14px;
}

.journal-hero-empty__text {
    margin: 0;
    padding-left: 6px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.45;
    color: var(--journal-muted);
}

.journal-stats-by-user {
    padding: 2px 2px 0;
}

.journal-stats-by-user__head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px 12px;
    align-items: baseline;
    padding: 10px 12px 10px 14px;
    margin-bottom: 6px;
    border-radius: 12px;
    background: rgba(var(--ledger-accent-rgb), 0.06);
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.08);
}

.journal-stats-by-user__h-name {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--journal-muted);
}

.journal-stats-by-user__h-out,
.journal-stats-by-user__h-in {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--journal-muted);
    text-align: right;
    min-width: 5.5rem;
}

.journal-stats-by-user__list {
    margin: 0;
    padding: 6px 4px 4px;
    list-style: none;
    max-height: min(38vh, 240px);
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: 14px;
    background: rgba(255, 254, 251, 0.65);
    border: 1px solid rgba(28, 25, 23, 0.05);
}

.journal-stats-by-user__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px 12px;
    align-items: baseline;
    padding: 11px 12px;
    border-bottom: 1px solid rgba(28, 25, 23, 0.05);
    transition: background 0.15s ease;
}

.journal-stats-by-user__row:last-child {
    border-bottom: none;
}

.journal-stats-by-user__row:active {
    background: rgba(var(--ledger-accent-rgb), 0.04);
}

.journal-stats-by-user__name {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--journal-ink);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.journal-stats-by-user__me {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    vertical-align: middle;
    color: var(--journal-accent);
    background: rgba(var(--ledger-accent-rgb), 0.12);
}

.journal-stats-by-user__num {
    font-family: var(--ledger-font-display);
    font-size: clamp(1rem, 4.2vw, 1.15rem);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    text-align: right;
    min-width: 5.5rem;
}

.journal-stats-by-user__num--out {
    color: var(--journal-expense);
}

.journal-stats-by-user__num--in {
    color: var(--journal-income);
}

.journal-section-title {
    flex-shrink: 0;
    margin: 0 0 14px;
    padding-left: 14px;
    position: relative;
    opacity: 0;
    animation: journal-rise 0.62s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
}

.journal-section-title::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.2em;
    bottom: 0.2em;
    width: 3px;
    border-radius: 999px;
    background: linear-gradient(
        180deg,
        var(--journal-accent) 0%,
        rgba(var(--ledger-accent-rgb), 0.35) 100%
    );
}

.journal-section-title__text {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--journal-muted);
}

.journal-empty {
    padding: 40px 18px 32px;
    text-align: center;
    border-radius: 20px;
    border: 1px dashed rgba(87, 83, 78, 0.22);
    background: linear-gradient(
        165deg,
        rgba(255, 254, 251, 0.85) 0%,
        rgba(255, 254, 251, 0.5) 100%
    );
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.75) inset;
}

.journal-empty--soft {
    border-style: solid;
    border-color: rgba(var(--ledger-accent-rgb), 0.14);
    background: rgba(255, 254, 251, 0.78);
}

.journal-empty__title {
    margin: 0 0 8px;
    font-family: var(--ledger-font-display);
    font-size: 1.28rem;
    font-weight: 400;
}

.journal-empty__hint {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.55;
    color: var(--journal-muted);
}

.journal-timeline {
    margin: 0;
    padding: 0;
    list-style: none;
}

.journal-timeline__item {
    margin-bottom: 14px;
    opacity: 0;
    animation: journal-rise 0.52s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.journal-timeline__item:last-child {
    margin-bottom: 0;
}

.journal-swipe {
    border-radius: 17px;
    overflow: hidden;
}

.journal-swipe :deep(.van-swipe-cell__wrapper) {
    border-radius: 17px;
}

.journal-swipe :deep(.van-swipe-cell__right) {
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

.swipe-side-btn--edit {
    background: var(--ledger-accent);
    color: #fff;
}

.journal-row__card {
    min-width: 0;
    padding: 14px 15px 14px 14px;
    border-radius: 17px;
    background: var(--journal-paper);
    border: 1px solid rgba(45, 106, 79, 0.08);
    border-left-width: 3px;
    border-left-color: rgba(var(--ledger-accent-rgb), 0.35);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.82) inset,
        0 14px 32px -26px rgba(28, 25, 23, 0.42);
}

.journal-row.is-expense .journal-row__card {
    border-left-color: rgba(var(--ledger-warm-rgb), 0.65);
}

.journal-row.is-income .journal-row__card {
    border-left-color: rgba(22, 101, 52, 0.55);
}

.journal-row.is-transfer .journal-row__card {
    border-left-color: rgba(87, 83, 78, 0.35);
}

.journal-row__top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px 10px;
    margin-bottom: 8px;
}

.journal-row__pill {
    flex-shrink: 0;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1.2;
}

.journal-row__pill--expense {
    color: var(--journal-expense);
    background: rgba(var(--ledger-warm-rgb), 0.12);
}

.journal-row__pill--income {
    color: var(--journal-income);
    background: rgba(22, 101, 52, 0.1);
}

.journal-row__pill--transfer {
    color: var(--journal-muted);
    background: rgba(87, 83, 78, 0.1);
}

.journal-row__who {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.journal-row__when {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--journal-muted);
}

.journal-row__what {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.45;
    color: var(--journal-muted);
}

.journal-row__money {
    margin: 0;
    font-family: var(--ledger-font-display);
    font-size: clamp(1.05rem, 4.5vw, 1.25rem);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    text-align: right;
}

.journal-row.is-expense .journal-row__money {
    color: var(--journal-expense);
}

.journal-row.is-income .journal-row__money {
    color: var(--journal-income);
}

.journal-row.is-transfer .journal-row__money {
    color: var(--journal-ink);
}

@keyframes journal-rise {
    from {
        opacity: 0;
        transform: translateY(14px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.journal-search-bar {
    flex-shrink: 0;
    padding: 0 2px;
    margin-bottom: 14px;
    opacity: 0;
    animation: journal-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.08s forwards;
}
.journal-search-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.1);
    border-radius: 14px;
    background: rgba(255, 254, 251, 0.85);
    color: var(--ledger-ink-faint);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 0.15s ease;
}
.journal-search-btn:active {
    border-color: rgba(var(--ledger-accent-rgb), 0.25);
}
.journal-search-btn--active {
    border-color: rgba(var(--ledger-accent-rgb), 0.35);
    color: var(--ledger-accent-deep);
}
.journal-search-btn__badge {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ledger-accent);
    margin-left: auto;
}
.filter-popup :deep(.van-popup__content) {
    border-radius: 20px 20px 0 0;
    background: var(--ledger-paper);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
}
.filter-panel {
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom, 12px);
}
.filter-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px 12px;
    border-bottom: 1px solid rgba(var(--ledger-accent-rgb), 0.08);
}
.filter-panel__title {
    margin: 0;
    font-family: var(--ledger-font-display);
    font-size: 20px;
    font-weight: 400;
}
.filter-panel__reset {
    border: none;
    background: transparent;
    color: var(--ledger-ink-muted);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
}
.filter-panel__body {
    flex: 1;
    padding: 14px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.filter-field__label {
    display: block;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--ledger-ink-muted);
    margin-bottom: 8px;
}
.filter-field__input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.12);
    border-radius: 12px;
    background: rgba(255, 254, 251, 0.9);
    font: inherit;
    font-size: 15px;
    color: var(--ledger-ink);
}
.filter-field__input:focus {
    outline: none;
    border-color: rgba(var(--ledger-accent-rgb), 0.35);
}
.filter-field__row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.filter-field__input--half {
    flex: 1;
    min-width: 0;
}
.filter-field__sep {
    color: var(--ledger-ink-faint);
    font-weight: 600;
}
.filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.filter-chip {
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.12);
    background: rgba(255, 254, 251, 0.7);
    color: var(--ledger-ink-muted);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 16px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.filter-chip--active {
    background: rgba(var(--ledger-accent-rgb), 0.12);
    color: var(--ledger-accent-deep);
    border-color: rgba(var(--ledger-accent-rgb), 0.25);
}
.filter-panel__foot {
    flex-shrink: 0;
    padding: 12px 18px 8px;
}
</style>

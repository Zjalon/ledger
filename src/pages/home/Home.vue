<script setup lang="ts">
import dayjs from "dayjs";
import {
    closeToast,
    showConfirmDialog,
    showLoadingToast,
    showToast,
} from "vant";
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { buildCategoryLabelMap } from "@/composables/use-ledger-meta";
import { useSync } from "@/composables/use-sync";
import { useTxFilter } from "@/composables/use-tx-filter";
import type { Full } from "@/database/stash";
import type { Account } from "@/database/tables/account";
import type { Transaction } from "@/database/tables/transaction";
import type { User } from "@/database/tables/user";
import { amountToNumber } from "@/ledger/bill";
import type { BillCategory } from "@/ledger/type";

const { selectedBookId, ep } = useSync();

const startEdit = inject<(tx: Full<Transaction>) => void>("startEdit");

const bills = ref<Full<Transaction>[]>([]);
const usersList = ref<User[]>([]);
const metaCategories = ref<BillCategory[]>([]);
const accountsList = ref<Full<Account>[]>([]);

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
const showCalendar = ref(false);
const calendarValue = ref<[number, number] | null>(null);

function onCalendarConfirm(dates: Date[]) {
    if (dates.length >= 2) {
        const start = dates[0].valueOf();
        const end = dates[1].valueOf() + 24 * 60 * 60 * 1000;
        calendarValue.value = [start, end];
        txFilter.filters.value.dateStart = start;
        txFilter.filters.value.dateEnd = end;
    }
    showCalendar.value = false;
}

function dateRangeLabel(): string {
    const f = txFilter.filters.value;
    if (f.dateStart === null || f.dateEnd === null) return "";
    const start = dayjs(f.dateStart);
    const end = dayjs(f.dateEnd - 24 * 60 * 60 * 1000);
    if (start.isSame(end, "day")) return start.format("M月D日");
    return `${start.format("M月D日")} – ${end.format("M月D日")}`;
}

const todayStart = computed(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).valueOf();
});

const todayEnd = computed(() => {
    return todayStart.value + 24 * 60 * 60 * 1000;
});

const allRangeRows = computed(() => {
    const f = txFilter.filters.value;
    if (f.dateStart !== null || f.dateEnd !== null) {
        return bills.value
            .filter((b) => {
                if (f.dateStart !== null && b.time < f.dateStart) return false;
                if (f.dateEnd !== null && b.time >= f.dateEnd) return false;
                return true;
            })
            .sort((a, b) => b.time - a.time);
    }
    return bills.value
        .filter((b) => b.time >= todayStart.value && b.time < todayEnd.value)
        .sort((a, b) => b.time - a.time);
});

const txFilter = useTxFilter(() => allRangeRows.value);

const visibleRows = computed(() => {
    if (txFilter.hasActiveFilters.value) {
        return txFilter.filteredRows.value;
    }
    return allRangeRows.value;
});

type DayGroup = { dateKey: string; label: string; items: Full<Transaction>[] };

const groupedRows = computed((): DayGroup[] => {
    const map = new Map<string, Full<Transaction>[]>();
    for (const tx of visibleRows.value) {
        const key = dayjs(tx.time).format("YYYY-MM-DD");
        const arr = map.get(key);
        if (arr) {
            arr.push(tx);
        } else {
            map.set(key, [tx]);
        }
    }
    return [...map.entries()].map(([dateKey, items]) => ({
        dateKey,
        label: dateKey,
        items,
    }));
});

const sectionTitle = computed(() => {
    const f = txFilter.filters.value;
    if (f.dateStart !== null && f.dateEnd !== null) {
        const start = dayjs(f.dateStart).format("YYYY-MM-DD");
        const end = dayjs(f.dateEnd - 24 * 60 * 60 * 1000).format("YYYY-MM-DD");
        if (start === end) return `${start} 流水`;
        return `${start} – ${end} 流水`;
    }
    return `${dayjs().format("YYYY-MM-DD")} 流水`;
});

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

function accountName(accountId: string): string {
    return accountsList.value.find((a) => a.id === accountId)?.name ?? "";
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
    const [txs, users, meta, accs] = await Promise.all([
        ep.tableGetAllItems<Transaction>(bookId, "transactions"),
        ep.tableGetAllItems<User>(bookId, "users"),
        ep.getLedgerMeta(bookId),
        ep.tableGetAllItems<Full<Account>>(bookId, "accounts"),
    ]);
    bills.value = txs;
    usersList.value = users;
    metaCategories.value = Array.isArray(meta.categories)
        ? (meta.categories as BillCategory[])
        : [];
    accountsList.value = accs;
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
        <div class="journal-inner journal-inner--layout">
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
                        {{ sectionTitle }}
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
                        <p class="journal-empty__title">今日还没有收支</p>
                        <p class="journal-empty__hint">点击底部中间的「记一笔」。</p>
                    </div>

                    <div v-else class="journal-groups">
                        <section v-for="group in groupedRows" :key="group.dateKey" class="journal-day-group">
                            <h3 class="journal-day-header">
                                <span class="journal-day-header__date">{{ group.label }}</span>
                                <span class="journal-day-header__count">{{ group.items.length }} 条</span>
                            </h3>
                            <ol class="journal-timeline" role="list">
                                <li
                                    v-for="(tx, i) in group.items"
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
                                                <div class="journal-row__bottom">
                                                    <div v-if="tx.type !== 'transfer' && tx.accountId" class="journal-row__account">
                                                        <span class="journal-row__account-tag">{{ accountName(tx.accountId) }}</span>
                                                    </div>
                                                    <div v-else-if="tx.type === 'transfer' && (tx.accountId || tx.transferTo)" class="journal-row__account">
                                                        <span v-if="tx.accountId" class="journal-row__account-tag">{{ accountName(tx.accountId) }}</span>
                                                        <span v-if="tx.accountId && tx.transferTo" class="journal-row__account-arrow">→</span>
                                                        <span v-if="tx.transferTo" class="journal-row__account-tag">{{ accountName(tx.transferTo) }}</span>
                                                    </div>
                                                    <p class="journal-row__money">
                                                        {{ amountLabel(tx) }}
                                                    </p>
                                                </div>
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
                        </section>
                    </div>
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
                    <button type="button" class="filter-panel__reset" @click="txFilter.resetFilters(); calendarValue = null">重置</button>
                </div>
                <div class="filter-panel__body">
                    <div class="filter-field">
                        <label class="filter-field__label">日期范围</label>
                        <div class="filter-field__row">
                            <button type="button" class="filter-field__input filter-field__date-btn" @click="showCalendar = true">
                                {{ dateRangeLabel() || '点击选择日期范围' }}
                            </button>
                            <button v-if="txFilter.filters.value.dateStart !== null" type="button" class="filter-field__clear" @click="txFilter.filters.value.dateStart = null; txFilter.filters.value.dateEnd = null; calendarValue = null">清除</button>
                        </div>
                    </div>
                    <div class="filter-field">
                        <label class="filter-field__label">成员</label>
                        <div class="filter-chips">
                            <button
                                v-for="u in usersList"
                                :key="u.id"
                                type="button"
                                class="filter-chip"
                                :class="{ 'filter-chip--active': txFilter.filters.value.creatorIds.includes(String(u.id)) }"
                                @click="txFilter.filters.value.creatorIds.includes(String(u.id)) ? (txFilter.filters.value.creatorIds = txFilter.filters.value.creatorIds.filter((x) => x !== String(u.id))) : txFilter.filters.value.creatorIds.push(String(u.id))"
                            >
                                {{ u.nickname || '成员' }}
                            </button>
                        </div>
                    </div>
                    <div class="filter-field">
                        <label class="filter-field__label">关键词</label>
                        <input v-model="txFilter.filters.value.keyword" type="text" class="filter-field__input" placeholder="搜索备注…" autocomplete="off" />
                    </div>
                    <div class="filter-field">
                        <label class="filter-field__label">金额范围</label>
                        <div class="filter-field__row">
                            <input :value="txFilter.filters.value.minAmount ?? ''" type="number" inputmode="decimal" class="filter-field__input filter-field__input--half" placeholder="最小" min="0" @input="txFilter.filters.value.minAmount = $event.target.value === '' ? null : Number($event.target.value)" />
                            <span class="filter-field__sep">–</span>
                            <input :value="txFilter.filters.value.maxAmount ?? ''" type="number" inputmode="decimal" class="filter-field__input filter-field__input--half" placeholder="最大" min="0" @input="txFilter.filters.value.maxAmount = $event.target.value === '' ? null : Number($event.target.value)" />
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

        <van-calendar
            v-model:show="showCalendar"
            type="range"
            :min-date="new Date(2020, 0, 1)"
            @confirm="onCalendarConfirm"
        />
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
    gap: 8px;
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

.journal-groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.journal-day-group {
    display: flex;
    flex-direction: column;
}

.journal-day-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 10px;
    padding: 0 2px;
}

.journal-day-header__date {
    font-family: var(--ledger-font-display);
    font-size: 0.95rem;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--journal-ink);
}

.journal-day-header__count {
    font-size: 11px;
    font-weight: 600;
    color: var(--journal-muted);
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
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.45;
    color: var(--journal-muted);
}

.journal-row__bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.journal-row__account {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.journal-row__account-tag {
    font-size: 10px;
    font-weight: 600;
    color: var(--journal-muted);
    background: rgba(87, 83, 78, 0.07);
    padding: 2px 7px;
    border-radius: 6px;
}

.journal-row__account-arrow {
    font-size: 11px;
    color: var(--ledger-ink-faint);
}

.journal-row__money {
    margin: 0;
    font-family: var(--ledger-font-display);
    font-size: clamp(1.05rem, 4.5vw, 1.25rem);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    flex-shrink: 0;
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
.filter-field__date-btn {
    text-align: left;
    cursor: pointer;
}
.filter-field__clear {
    border: none;
    background: transparent;
    color: var(--ledger-ink-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0 8px;
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

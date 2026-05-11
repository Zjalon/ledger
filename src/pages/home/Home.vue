<script setup lang="ts">
import dayjs from "dayjs";
import { showToast } from "vant";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { buildCategoryLabelMap } from "@/composables/use-ledger-meta";
import { useSync } from "@/composables/use-sync";
import type { Full } from "@/database/stash";
import type { Transaction } from "@/database/tables/transaction";
import type { User } from "@/database/tables/user";
import { amountToNumber } from "@/ledger/bill";
import type { BillCategory } from "@/ledger/type";

const { selectedBookId, ep } = useSync();

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

const todayRows = computed(() => {
    const start = dayjs().startOf("day").valueOf();
    const end = dayjs().add(1, "day").startOf("day").valueOf();
    return bills.value
        .filter((b) => b.time >= start && b.time < end)
        .sort((a, b) => b.time - a.time);
});

const todayExpenseRaw = computed(() =>
    todayRows.value
        .filter((b) => b.type === "expense")
        .reduce((s, b) => s + b.amount, 0),
);

const todayIncomeRaw = computed(() =>
    todayRows.value
        .filter((b) => b.type === "income")
        .reduce((s, b) => s + b.amount, 0),
);

const todayExpenseLabel = computed(() =>
    fmt.format(amountToNumber(todayExpenseRaw.value)),
);

const todayIncomeLabel = computed(() =>
    fmt.format(amountToNumber(todayIncomeRaw.value)),
);

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
    const u = usersList.value.find(
        (x) => String(x.id) === String(tx.creatorId),
    );
    const nick = u?.nickname?.trim();
    if (nick) {
        return nick;
    }
    const id = String(tx.creatorId);
    return id.length > 10 ? `成员 …${id.slice(-4)}` : "家庭成员";
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

        <div class="journal-inner">
            <header class="journal-hero">
                <p class="journal-kicker">今日</p>
                <div class="journal-stats">
                    <div class="journal-stat journal-stat--out">
                        <span class="journal-stat__label">支出</span>
                        <span class="journal-stat__value">{{
                            todayExpenseLabel
                        }}</span>
                    </div>
                    <div class="journal-stat-divider" aria-hidden="true" />
                    <div class="journal-stat journal-stat--in">
                        <span class="journal-stat__label">收入</span>
                        <span class="journal-stat__value">{{
                            todayIncomeLabel
                        }}</span>
                    </div>
                </div>
                <div class="journal-hero__accent" aria-hidden="true" />
            </header>

            <section class="journal-section">
                <h2 class="journal-section-title">今日流水</h2>

                <div v-if="bills.length === 0" class="journal-empty">
                    <p class="journal-empty__title">账本还是空的</p>
                    <p class="journal-empty__hint">记下第一笔，从今天开始。</p>
                </div>

                <div
                    v-else-if="todayRows.length === 0"
                    class="journal-empty journal-empty--soft"
                >
                    <p class="journal-empty__title">今日还没有收支</p>
                    <p class="journal-empty__hint">
                        点击底部中间的「记一笔」（即将上线）。
                    </p>
                </div>

                <ol v-else class="journal-timeline" role="list">
                    <li
                        v-for="(tx, i) in todayRows"
                        :key="tx.id"
                        class="journal-row"
                        :class="rowModifier(tx)"
                        :style="{ animationDelay: `${0.06 + i * 0.045}s` }"
                    >
                        <div class="journal-row__rail" aria-hidden="true">
                            <span class="journal-row__dot" />
                        </div>
                        <div class="journal-row__card">
                            <div class="journal-row__top">
                                <span class="journal-row__who">{{
                                    creatorLabel(tx)
                                }}</span>
                                <time
                                    class="journal-row__when"
                                    :datetime="new Date(tx.time).toISOString()"
                                    >{{ timeLabel(tx.time) }}</time
                                >
                            </div>
                            <p class="journal-row__what">{{ purposeLine(tx) }}</p>
                            <p class="journal-row__money">{{ amountLabel(tx) }}</p>
                        </div>
                    </li>
                </ol>
            </section>
        </div>
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
    overflow-y: auto;
    padding: 14px 16px;
    /* 底栏已 fixed 占位；此处主要为中部「记一笔」球上半部分留出滚动空间 */
    padding-bottom: 48px;
    max-width: 480px;
    margin: 0 auto;
    width: 100%;
}

.journal-hero {
    position: relative;
    margin-bottom: 22px;
    padding: 20px 18px 22px;
    border-radius: 20px;
    background: var(--journal-paper);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
    overflow: hidden;
    opacity: 0;
    animation: journal-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
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
    margin: 0 0 14px;
    padding-left: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--journal-accent);
}

.journal-stats {
    display: flex;
    align-items: stretch;
    gap: 0;
    padding-left: 6px;
}

.journal-stat {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.journal-stat__label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--journal-muted);
}

.journal-stat__value {
    font-family: var(--ledger-font-display);
    font-size: clamp(1.55rem, 7vw, 2rem);
    font-weight: 400;
    line-height: 1.08;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
}

.journal-stat--out .journal-stat__value {
    color: var(--journal-expense);
}

.journal-stat--in .journal-stat__value {
    color: var(--journal-income);
}

.journal-stat-divider {
    width: 1px;
    margin: 4px 12px;
    align-self: stretch;
    background: linear-gradient(
        180deg,
        transparent,
        rgba(87, 83, 78, 0.22),
        transparent
    );
}

.journal-section-title {
    margin: 0 0 14px;
    padding-left: 4px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--journal-muted);
    opacity: 0;
    animation: journal-rise 0.62s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
}

.journal-empty {
    padding: 36px 16px 28px;
    text-align: center;
    border-radius: 18px;
    border: 1px dashed rgba(87, 83, 78, 0.26);
    background: rgba(255, 254, 251, 0.55);
}

.journal-empty--soft {
    border-style: solid;
    border-color: rgba(45, 106, 79, 0.12);
    background: rgba(255, 254, 251, 0.72);
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

.journal-row {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;
    opacity: 0;
    animation: journal-rise 0.52s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.journal-row__rail {
    flex-shrink: 0;
    width: 14px;
    position: relative;
    display: flex;
    justify-content: center;
}

.journal-row__rail::before {
    content: "";
    position: absolute;
    top: 10px;
    bottom: -14px;
    width: 2px;
    border-radius: 2px;
    background: linear-gradient(
        180deg,
        rgba(45, 106, 79, 0.35),
        rgba(87, 83, 78, 0.12)
    );
}

.journal-row:last-child .journal-row__rail::before {
    bottom: 0;
    background: rgba(45, 106, 79, 0.22);
}

.journal-row__dot {
    position: relative;
    z-index: 1;
    margin-top: 8px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--journal-paper);
    border: 2px solid var(--journal-accent);
    box-shadow: 0 0 0 3px rgba(45, 106, 79, 0.12);
}

.journal-row.is-expense .journal-row__dot {
    border-color: var(--journal-expense);
    box-shadow: 0 0 0 3px rgba(154, 52, 18, 0.12);
}

.journal-row.is-income .journal-row__dot {
    border-color: var(--journal-income);
    box-shadow: 0 0 0 3px rgba(22, 101, 52, 0.12);
}

.journal-row.is-transfer .journal-row__dot {
    border-color: var(--journal-muted);
}

.journal-row__card {
    flex: 1;
    min-width: 0;
    padding: 14px 16px;
    border-radius: 16px;
    background: var(--journal-paper);
    border: 1px solid rgba(45, 106, 79, 0.07);
    box-shadow: 0 12px 28px -24px rgba(28, 25, 23, 0.45);
}

.journal-row__top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
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
    font-size: 17px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
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
</style>

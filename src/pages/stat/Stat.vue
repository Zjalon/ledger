<script setup lang="ts">
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { showToast } from "vant";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { buildCategoryLabelMap } from "@/composables/use-ledger-meta";
import { useSync } from "@/composables/use-sync";
import type { Full } from "@/database/stash";
import type { Transaction } from "@/database/tables/transaction";
import type { User } from "@/database/tables/user";
import { amountToNumber } from "@/ledger/bill";
import type { BillCategory } from "@/ledger/type";

dayjs.extend(isoWeek);

type RangeKind = "week" | "month" | "year";
type FlowKind = "income" | "expense";

const { selectedBookId, ep } = useSync();

const bills = ref<Full<Transaction>[]>([]);
const usersList = ref<Full<User>[]>([]);
const metaCategories = ref<BillCategory[]>([]);

/** Global time selector */
const rangeKind = ref<RangeKind>("month");

/** Trend chart: expense / income toggle */
const trendKind = ref<FlowKind>("expense");

/** Category ranking: expense / income toggle */
const rankKind = ref<FlowKind>("expense");

/** Category ranking: member filter (all or specific creator ID) */
const rankCreatorKey = ref<string>("all");

function rangeBounds(kind: RangeKind): { start: number; end: number } {
    const now = dayjs();
    if (kind === "week") {
        return {
            start: now.startOf("isoWeek").valueOf(),
            end: now.endOf("day").valueOf(),
        };
    }
    if (kind === "month") {
        return {
            start: now.startOf("month").valueOf(),
            end: now.endOf("day").valueOf(),
        };
    }
    return {
        start: now.startOf("year").valueOf(),
        end: now.endOf("day").valueOf(),
    };
}

const rowsInRange = computed(() => {
    const { start, end } = rangeBounds(rangeKind.value);
    return bills.value.filter((b) => b.time >= start && b.time <= end);
});

const expenseRaw = computed(() =>
    rowsInRange.value
        .filter((b) => b.type === "expense")
        .reduce((s, b) => s + b.amount, 0),
);

const incomeRaw = computed(() =>
    rowsInRange.value
        .filter((b) => b.type === "income")
        .reduce((s, b) => s + b.amount, 0),
);

const netRaw = computed(() => incomeRaw.value - expenseRaw.value);

const fmt = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const expenseLabel = computed(() =>
    fmt.format(amountToNumber(expenseRaw.value)),
);

const incomeLabel = computed(() => fmt.format(amountToNumber(incomeRaw.value)));

const netLabel = computed(() => {
    const n = amountToNumber(netRaw.value);
    return fmt.format(Math.abs(n));
});

const trendSeries = computed(() => {
    const { start, end } = rangeBounds(rangeKind.value);
    const kind = trendKind.value;
    const startDay = dayjs(start);
    const endDay = dayjs(end);

    if (rangeKind.value === "year") {
        const months: { label: string; amount: number }[] = [];
        let cursor = startDay.startOf("month");
        const endMonth = endDay.endOf("month");
        while (cursor.isBefore(endMonth) || cursor.isSame(endMonth, "month")) {
            const mStart = cursor.startOf("month").valueOf();
            const mEnd = cursor.endOf("month").valueOf();
            const amount = bills.value
                .filter(
                    (b) =>
                        b.type === kind && b.time >= mStart && b.time <= mEnd,
                )
                .reduce((s, b) => s + b.amount, 0);
            months.push({
                label: `${cursor.month() + 1}月`,
                amount,
            });
            cursor = cursor.add(1, "month");
        }
        return months;
    }

    const days: { label: string; amount: number }[] = [];
    let cursor = startDay.startOf("day");
    while (cursor.isBefore(endDay) || cursor.isSame(endDay, "day")) {
        const dStart = cursor.startOf("day").valueOf();
        const dEnd = cursor.endOf("day").valueOf();
        const amount = bills.value
            .filter(
                (b) => b.type === kind && b.time >= dStart && b.time <= dEnd,
            )
            .reduce((s, b) => s + b.amount, 0);

        let label: string;
        if (rangeKind.value === "week") {
            const dayNames = [
                "周一",
                "周二",
                "周三",
                "周四",
                "周五",
                "周六",
                "周日",
            ];
            label = dayNames[cursor.isoWeekday() - 1];
        } else {
            label = `${cursor.date()}`;
        }
        days.push({ label, amount });
        cursor = cursor.add(1, "day");
    }
    return days;
});

const trendTotalLabel = computed(() => {
    const raw = trendSeries.value.reduce((s, x) => s + x.amount, 0);
    return fmt.format(amountToNumber(raw));
});

const trendHasAny = computed(() => trendSeries.value.some((x) => x.amount > 0));

const trendFillColor = computed(() =>
    trendKind.value === "expense" ? "#9a3412" : "#166534",
);

const fmtAxis = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
});

const trendChart = computed(() => {
    const series = trendSeries.value;
    const n = series.length;
    if (n === 0) {
        return null;
    }
    const maxA = Math.max(...series.map((s) => s.amount), 1);
    const W = 300;
    const H = 138;
    const padL = 44;
    const padR = 8;
    const padT = 10;
    const padB = 26;
    const iw = W - padL - padR;
    const ih = H - padT - padB;

    const pts = series.map((s, i) => {
        const x = n <= 1 ? padL + iw / 2 : padL + (i / (n - 1)) * iw;
        const y = padT + ih * (1 - s.amount / maxA);
        return { x, y };
    });

    const linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const bottomY = padT + ih;
    const areaD = `M ${pts[0].x} ${bottomY} L ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} L ${pts[n - 1].x} ${bottomY} Z`;

    const tickIdxs = [
        0,
        Math.floor((n - 1) / 4),
        Math.floor((n - 1) / 2),
        Math.floor((3 * (n - 1)) / 4),
        n - 1,
    ];
    const xTickIdxs = [...new Set(tickIdxs)].sort((a, b) => a - b);

    return {
        viewW: W,
        viewH: H,
        linePoints,
        areaD,
        maxLabel: fmtAxis.format(amountToNumber(maxA)),
        midGridY: padT + ih / 2,
        gridX1: padL,
        gridX2: W - padR,
        xLabelY: H - 10,
        xTicks: xTickIdxs.map((i) => ({
            x: pts[i].x,
            label: series[i].label,
        })),
    };
});

const categoryLabelMap = computed(() =>
    buildCategoryLabelMap(metaCategories.value),
);

function memberCreatorLabel(creatorKey: string): string {
    const u = usersList.value.find((x) => String(x.id) === creatorKey);
    const nick = u?.nickname?.trim();
    if (nick) return nick;
    if (creatorKey.length > 10) return `成员 …${creatorKey.slice(-4)}`;
    return "成员";
}

const rankMemberTabList = computed(() => {
    const tabs: { key: string; title: string }[] = [
        { key: "all", title: "全部" },
    ];
    const seen = new Set<string>(["all"]);
    for (const u of usersList.value) {
        const k = String(u.id);
        if (seen.has(k)) continue;
        seen.add(k);
        const nick = u.nickname?.trim();
        const title =
            nick && nick.length > 0
                ? nick
                : k.length > 10
                  ? `成员 …${k.slice(-4)}`
                  : "成员";
        tabs.push({ key: k, title });
    }
    for (const b of bills.value) {
        const k = String(b.creatorId);
        if (seen.has(k)) continue;
        seen.add(k);
        tabs.push({ key: k, title: memberCreatorLabel(k) });
    }
    return tabs;
});

watch(rankMemberTabList, (tabs) => {
    const key = rankCreatorKey.value;
    if (key === "all") return;
    if (!tabs.some((t) => t.key === key)) {
        rankCreatorKey.value = "all";
    }
});

type CategoryRankItem = {
    categoryId: string;
    label: string;
    amount: number;
    share: number;
};

const categoryRanking = computed(() => {
    const kind = rankKind.value;
    const creator = rankCreatorKey.value;
    const { start, end } = rangeBounds(rangeKind.value);
    const map = new Map<string, number>();
    const labels = new Map<string, string>();

    for (const b of bills.value) {
        if (b.time < start || b.time > end) continue;
        if (b.type !== kind) continue;
        if (creator !== "all" && String(b.creatorId) !== creator) continue;
        const id = b.categoryId;
        map.set(id, (map.get(id) ?? 0) + b.amount);
        if (!labels.has(id)) {
            const name = categoryLabelMap.value.get(id)?.trim();
            labels.set(id, name && name.length > 0 ? name : "未命名分类");
        }
    }

    const rows: CategoryRankItem[] = [...map.entries()]
        .map(([key, amount]) => ({
            categoryId: key,
            label: labels.get(key) ?? key,
            amount,
            share: 0,
        }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount);

    const total = rows.reduce((s, x) => s + x.amount, 0);
    if (total > 0) {
        for (const row of rows) {
            row.share = row.amount / total;
        }
    }
    return { total, rows };
});

const categoryRankTotalLabel = computed(() => {
    const p = categoryRanking.value;
    if (p.rows.length === 0) return "—";
    return fmt.format(amountToNumber(p.total));
});

let unsubscribe: (() => void) | undefined;

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
    if (!bookId) {
        return;
    }

    try {
        await refreshData(bookId);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? "未知错误");
        showToast(`加载数据失败：${msg}`);
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
    <div class="stat-page">
        <div class="stat-atmosphere" aria-hidden="true">
            <div class="stat-atmosphere__orb stat-atmosphere__orb--a" />
            <div class="stat-atmosphere__orb stat-atmosphere__orb--b" />
            <div class="stat-atmosphere__grain" />
        </div>
        <div class="stat-inner">
            <div class="stat-scroll-body stat-scroll-body--stack">
                <template v-if="bills.length > 0">
                    <!-- Global time selector -->
                    <van-tabs
                        v-model:active="rangeKind"
                        type="card"
                        class="stat-global-tabs"
                    >
                        <van-tab title="本周" name="week" />
                        <van-tab title="本月" name="month" />
                        <van-tab title="今年" name="year" />
                    </van-tabs>

                    <!-- Overview cards -->
                    <section class="stat-overview">
                        <div class="stat-overview__card stat-overview__card--expense">
                            <span class="stat-overview__label">支出</span>
                            <span class="stat-overview__value stat-overview__value--expense">
                                −{{ expenseLabel }}
                            </span>
                        </div>
                        <div class="stat-overview__card stat-overview__card--income">
                            <span class="stat-overview__label">收入</span>
                            <span class="stat-overview__value stat-overview__value--income">
                                +{{ incomeLabel }}
                            </span>
                        </div>
                        <div class="stat-overview__card stat-overview__card--net">
                            <span class="stat-overview__label">结余</span>
                            <span
                                class="stat-overview__value"
                                :class="{
                                    'stat-overview__value--income': netRaw > 0,
                                    'stat-overview__value--expense': netRaw < 0,
                                    'stat-overview__value--zero': netRaw === 0,
                                }"
                            >
                                {{ netRaw >= 0 ? '+' : '−' }}{{ netLabel }}
                            </span>
                        </div>
                    </section>

                    <!-- Trend chart -->
                    <section class="stat-section stat-trend-card">
                        <div class="stat-trend-card__header">
                            <h2 class="stat-section__title">趋势</h2>
                            <span class="stat-trend-card__total">合计 {{ trendTotalLabel }}</span>
                        </div>
                        <van-tabs
                            v-model:active="trendKind"
                            type="card"
                            class="stat-trend-tabs"
                        >
                            <van-tab title="支出" name="expense" />
                            <van-tab title="收入" name="income" />
                        </van-tabs>

                        <div
                            v-if="trendHasAny && trendChart"
                            class="stat-line-svg-wrap"
                        >
                            <svg
                                class="stat-line-svg"
                                :viewBox="`0 0 ${trendChart.viewW} ${trendChart.viewH}`"
                                preserveAspectRatio="xMidYMid meet"
                                role="img"
                                :aria-label="`${trendKind === 'expense' ? '支出' : '收入'}趋势折线图`"
                            >
                                <defs>
                                    <linearGradient
                                        :id="`stat-trend-fill-${trendKind}`"
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                    >
                                        <stop
                                            offset="0%"
                                            :stop-color="trendFillColor"
                                            stop-opacity="0.24"
                                        />
                                        <stop
                                            offset="100%"
                                            :stop-color="trendFillColor"
                                            stop-opacity="0.03"
                                        />
                                    </linearGradient>
                                </defs>
                                <text
                                    class="stat-line-svg__ylabel"
                                    x="4"
                                    y="18"
                                >
                                    {{ trendChart.maxLabel }}
                                </text>
                                <line
                                    class="stat-line-svg__grid"
                                    :x1="trendChart.gridX1"
                                    :y1="trendChart.midGridY"
                                    :x2="trendChart.gridX2"
                                    :y2="trendChart.midGridY"
                                />
                                <path
                                    class="stat-line-svg__area"
                                    :d="trendChart.areaD"
                                    :fill="`url(#stat-trend-fill-${trendKind})`"
                                />
                                <polyline
                                    class="stat-line-svg__line"
                                    :class="{
                                        'stat-line-svg__line--expense': trendKind === 'expense',
                                        'stat-line-svg__line--income': trendKind === 'income',
                                    }"
                                    fill="none"
                                    :points="trendChart.linePoints"
                                />
                                <g
                                    v-for="(tk, i) in trendChart.xTicks"
                                    :key="`xt-${i}`"
                                >
                                    <text
                                        class="stat-line-svg__xlabel"
                                        :x="tk.x"
                                        :y="trendChart.xLabelY"
                                        text-anchor="middle"
                                    >
                                        {{ tk.label }}
                                    </text>
                                </g>
                            </svg>
                        </div>
                        <van-empty
                            v-else
                            class="stat-trend-empty"
                            image="search"
                            :description="`所选时间范围内暂无${trendKind === 'expense' ? '支出' : '收入'}`"
                        />
                    </section>

                    <!-- Category ranking -->
                    <section class="stat-section stat-rank-card">
                        <div class="stat-rank-card__header">
                            <h2 class="stat-section__title">分类排行</h2>
                            <span class="stat-rank-card__total">合计 {{ categoryRankTotalLabel }}</span>
                        </div>
                        <van-tabs
                            v-model:active="rankKind"
                            type="card"
                            class="stat-rank-tabs"
                        >
                            <van-tab title="支出" name="expense" />
                            <van-tab title="收入" name="income" />
                        </van-tabs>
                        <van-tabs
                            v-model:active="rankCreatorKey"
                            scrollable
                            shrink
                            type="card"
                            class="stat-rank-tabs stat-rank-tabs--members"
                        >
                            <van-tab
                                v-for="tab in rankMemberTabList"
                                :key="tab.key"
                                :title="tab.title"
                                :name="tab.key"
                            />
                        </van-tabs>

                        <ul v-if="categoryRanking.rows.length > 0" class="stat-rank-list">
                            <li
                                v-for="item in categoryRanking.rows"
                                :key="item.categoryId"
                                class="stat-rank-item"
                            >
                                <div class="stat-rank-item__top">
                                    <span class="stat-rank-item__name">{{ item.label }}</span>
                                    <span class="stat-rank-item__amount">
                                        {{ fmt.format(amountToNumber(item.amount)) }}
                                    </span>
                                </div>
                                <div class="stat-rank-item__bar-track">
                                    <div
                                        class="stat-rank-item__bar-fill"
                                        :class="`stat-rank-item__bar-fill--${rankKind}`"
                                        :style="{ width: `${Math.round(item.share * 100)}%` }"
                                    />
                                </div>
                                <span class="stat-rank-item__pct">
                                    {{ Math.round(item.share * 100) }}%
                                </span>
                            </li>
                        </ul>
                        <van-empty
                            v-else
                            class="stat-rank-empty"
                            image="search"
                            description="当前条件下暂无数据"
                        />
                    </section>
                </template>

                <van-empty
                    v-else
                    description="暂无账单数据"
                />
            </div>
        </div>
    </div>
</template>

<style scoped>
.stat-page {
    flex: 1;
    min-height: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--ledger-paper);
    font-family: var(--ledger-font-ui);
    color: var(--ledger-ink);
}

.stat-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.stat-atmosphere__orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(48px);
    opacity: 0.4;
}

.stat-atmosphere__orb--a {
    width: min(80vw, 360px);
    height: min(80vw, 360px);
    top: -12%;
    left: -20%;
    background: radial-gradient(
        circle,
        rgba(var(--ledger-accent-rgb), 0.22) 0%,
        transparent 72%
    );
}

.stat-atmosphere__orb--b {
    width: min(60vw, 280px);
    height: min(60vw, 280px);
    bottom: 25%;
    right: -18%;
    background: radial-gradient(
        circle,
        rgba(var(--ledger-warm-rgb), 0.08) 0%,
        transparent 70%
    );
}

.stat-atmosphere__grain {
    position: absolute;
    inset: 0;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.stat-inner {
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

.stat-scroll-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-top: 14px;
    padding-bottom: 48px;
    -webkit-overflow-scrolling: touch;
}

.stat-scroll-body--stack {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding-top: 14px;
    padding-bottom: calc(52px + env(safe-area-inset-bottom, 0px));
}

.stat-section {
    position: relative;
}

.stat-section__title {
    position: relative;
    margin: 0 0 8px;
    padding-left: 14px;
    font-family: var(--ledger-font-display);
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.2;
    color: var(--ledger-ink);
}

.stat-section__title::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.28em;
    bottom: 0.28em;
    width: 3px;
    border-radius: 999px;
    background: linear-gradient(
        180deg,
        var(--ledger-accent) 0%,
        rgba(var(--ledger-accent-rgb), 0.35) 100%
    );
}

.stat-section__lead {
    margin: 0 0 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ledger-ink-muted);
    line-height: 1.5;
}

.stat-compose-tabs :deep(.van-tabs__wrap) {
    overflow: visible;
    margin-bottom: 10px;
}

.stat-compose-tabs :deep(.van-tabs__nav--card) {
    width: 100%;
    margin: 0;
    border-radius: 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.16);
    background: rgba(255, 254, 251, 0.72);
    backdrop-filter: blur(8px);
}

.stat-compose-tabs :deep(.van-tab--card) {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 11px;
    padding: 12px 8px;
    color: var(--ledger-ink-muted);
    font-weight: 700;
    font-size: 14px;
    transition:
        color 0.18s ease,
        background 0.18s ease,
        box-shadow 0.18s ease;
}

.stat-compose-tabs :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-accent) 0%,
        var(--ledger-accent-deep) 100%
    );
    box-shadow: 0 10px 22px -14px rgba(var(--ledger-accent-rgb), 0.55);
}

.stat-compose-period {
    margin: 0 0 12px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ledger-ink-muted);
    letter-spacing: 0.02em;
}

.stat-compose-summary {
    display: flex;
    align-items: stretch;
    gap: 0;
    margin-bottom: 18px;
    padding: 14px 14px 16px;
    border-radius: 14px;
    background: rgba(var(--ledger-accent-rgb), 0.06);
    border: 1px solid rgba(28, 25, 23, 0.06);
}

.stat-stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.stat-stat__label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ledger-ink-subtle);
}

.stat-stat__value {
    font-family: var(--ledger-font-display);
    font-size: 22px;
    font-weight: 500;
    line-height: 1.15;
    letter-spacing: -0.02em;
}

.stat-stat--out .stat-stat__value {
    color: var(--ledger-warm);
}

.stat-stat--in .stat-stat__value {
    color: var(--ledger-income);
}

.stat-stat-divider {
    width: 1px;
    margin: 4px 12px;
    align-self: stretch;
    background: linear-gradient(
        to bottom,
        transparent,
        rgba(28, 25, 23, 0.12),
        transparent
    );
}

.stat-pie-card {
    padding: 20px 18px 22px;
    border-radius: 20px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.07);
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-split-card {
    margin-top: 0;
    padding: 20px 18px 22px;
    border-radius: 20px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.07);
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-split-card__title,
.stat-member-card__title,
.stat-line-card__title {
    margin: 0;
}

.stat-split-card__subtitle,
.stat-member-card__subtitle,
.stat-line-card__subtitle {
    margin: 0;
}

.stat-split-tabs {
    margin-bottom: 10px;
}

.stat-split-tabs--flow {
    margin-bottom: 10px;
}

.stat-split-tabs--members {
    margin-bottom: 14px;
}

.stat-split-tabs--members :deep(.van-tabs__nav--card) {
    flex-wrap: nowrap;
    margin: 0;
    border-radius: 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.16);
    background: rgba(255, 254, 251, 0.72);
    backdrop-filter: blur(8px);
}

.stat-split-tabs--members :deep(.van-tab--card) {
    flex: 0 0 auto;
    border-radius: 11px;
    padding: 9px 14px;
    color: var(--ledger-ink-muted);
    font-weight: 700;
    font-size: 13px;
    transition:
        color 0.18s ease,
        background 0.18s ease,
        box-shadow 0.18s ease;
}

.stat-split-tabs--members :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-accent) 0%,
        var(--ledger-accent-deep) 100%
    );
    box-shadow: 0 8px 18px -14px rgba(var(--ledger-accent-rgb), 0.5);
}

.stat-split-tabs :deep(.van-tabs__wrap) {
    margin-bottom: 0;
    overflow: visible;
}

.stat-split-tabs--range :deep(.van-tabs__nav--card),
.stat-split-tabs--flow :deep(.van-tabs__nav--card) {
    width: 100%;
    margin: 0;
    border-radius: 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.16);
    background: rgba(255, 254, 251, 0.72);
    backdrop-filter: blur(8px);
}

.stat-split-tabs--range :deep(.van-tab--card),
.stat-split-tabs--flow :deep(.van-tab--card) {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 11px;
    padding: 11px 8px;
    color: var(--ledger-ink-muted);
    font-weight: 700;
    font-size: 14px;
    transition:
        color 0.18s ease,
        background 0.18s ease,
        box-shadow 0.18s ease;
}

.stat-split-tabs--range :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-accent) 0%,
        var(--ledger-accent-deep) 100%
    );
    box-shadow: 0 10px 22px -14px rgba(var(--ledger-accent-rgb), 0.55);
}

.stat-split-tabs--flow :deep(.van-tab--card:nth-child(1).van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-warm) 0%,
        #7c2d12 100%
    );
    box-shadow: 0 10px 22px -14px rgba(var(--ledger-warm-rgb), 0.55);
}

.stat-split-tabs--flow :deep(.van-tab--card:nth-child(2).van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-income) 0%,
        #14532d 100%
    );
    box-shadow: 0 10px 22px -14px rgba(22, 101, 52, 0.42);
}

.stat-split-pie-wrap {
    display: flex;
    align-items: flex-start;
    gap: 16px;
}

.stat-split-pie-svg {
    flex-shrink: 0;
}

.stat-split-legend {
    list-style: none;
    margin: 0;
    padding: 0 4px 0 0;
    flex: 1;
    min-width: 0;
    max-height: 240px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}

.stat-split-legend__row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
}

.stat-split-legend__row:last-child {
    margin-bottom: 0;
}

.stat-split-legend__sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
}

.stat-split-legend__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ledger-ink-muted);
}

.stat-split-legend__amt {
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ledger-ink);
}

.stat-split-legend__pct {
    width: 38px;
    flex-shrink: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--ledger-ink-subtle);
    font-size: 12px;
}

.stat-split-empty {
    padding: 8px 0 4px;
}

.stat-member-card {
    margin-top: 0;
    padding: 20px 18px 22px;
    border-radius: 20px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.07);
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-member-tabs {
    margin-bottom: 14px;
}

.stat-member-tabs :deep(.van-tabs__wrap) {
    margin-bottom: 0;
}

.stat-member-tabs :deep(.van-tabs__wrap) {
    overflow: visible;
}

.stat-member-tabs :deep(.van-tabs__nav--card) {
    width: 100%;
    margin: 0;
    border-radius: 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.16);
    background: rgba(255, 254, 251, 0.72);
    backdrop-filter: blur(8px);
}

.stat-member-tabs :deep(.van-tab--card) {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 11px;
    padding: 11px 8px;
    color: var(--ledger-ink-muted);
    font-weight: 700;
    font-size: 14px;
    transition:
        color 0.18s ease,
        background 0.18s ease,
        box-shadow 0.18s ease;
}

.stat-member-tabs :deep(.van-tab--card:nth-child(1).van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-warm) 0%,
        #7c2d12 100%
    );
    box-shadow: 0 10px 22px -14px rgba(var(--ledger-warm-rgb), 0.55);
}

.stat-member-tabs :deep(.van-tab--card:nth-child(2).van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-income) 0%,
        #14532d 100%
    );
    box-shadow: 0 10px 22px -14px rgba(22, 101, 52, 0.42);
}

.stat-member-pie-wrap {
    display: flex;
    align-items: flex-start;
    gap: 16px;
}

.stat-member-pie-svg {
    flex-shrink: 0;
}

.stat-member-legend {
    list-style: none;
    margin: 0;
    padding: 0 4px 0 0;
    flex: 1;
    min-width: 0;
    max-height: 220px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}

.stat-member-legend__row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
}

.stat-member-legend__row:last-child {
    margin-bottom: 0;
}

.stat-member-legend__sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
}

.stat-member-legend__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ledger-ink-muted);
}

.stat-member-legend__amt {
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ledger-ink);
}

.stat-member-legend__pct {
    width: 38px;
    flex-shrink: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--ledger-ink-subtle);
    font-size: 12px;
}

.stat-member-empty {
    padding: 8px 0 4px;
}

.stat-line-card {
    margin-top: 0;
    padding: 20px 18px 22px;
    border-radius: 20px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.07);
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-trend-tabs {
    margin-bottom: 14px;
}

.stat-trend-tabs :deep(.van-tabs__wrap) {
    margin-bottom: 0;
}

.stat-trend-tabs :deep(.van-tabs__wrap) {
    overflow: visible;
}

.stat-trend-tabs :deep(.van-tabs__nav--card) {
    width: 100%;
    margin: 0;
    border-radius: 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.16);
    background: rgba(255, 254, 251, 0.72);
    backdrop-filter: blur(8px);
}

.stat-trend-tabs :deep(.van-tab--card) {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 11px;
    padding: 11px 8px;
    color: var(--ledger-ink-muted);
    font-weight: 700;
    font-size: 14px;
    transition:
        color 0.18s ease,
        background 0.18s ease,
        box-shadow 0.18s ease;
}

.stat-trend-tabs :deep(.van-tab--card:nth-child(1).van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-warm) 0%,
        #7c2d12 100%
    );
    box-shadow: 0 10px 22px -14px rgba(var(--ledger-warm-rgb), 0.55);
}

.stat-trend-tabs :deep(.van-tab--card:nth-child(2).van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-income) 0%,
        #14532d 100%
    );
    box-shadow: 0 10px 22px -14px rgba(22, 101, 52, 0.42);
}

.stat-line-svg-wrap {
    width: 100%;
    padding: 12px 10px 6px;
    border-radius: 16px;
    background: rgba(var(--ledger-accent-rgb), 0.045);
    border: 1px solid rgba(28, 25, 23, 0.06);
}

.stat-line-svg {
    display: block;
    width: 100%;
    height: auto;
    margin: 0 auto;
}

.stat-line-svg__ylabel {
    font-size: 10px;
    font-weight: 600;
    fill: var(--ledger-ink-subtle);
}

.stat-line-svg__xlabel {
    font-size: 10px;
    font-weight: 600;
    fill: var(--ledger-ink-muted);
}

.stat-line-svg__grid {
    stroke: rgba(28, 25, 23, 0.08);
    stroke-width: 1;
}

.stat-line-svg__area {
    stroke: none;
}

.stat-line-svg__line {
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.stat-line-svg__line--expense {
    stroke: var(--ledger-warm);
}

.stat-line-svg__line--income {
    stroke: var(--ledger-income);
}

.stat-line-empty {
    padding: 8px 0 4px;
}

.stat-pie-card .stat-section__title,
.stat-split-card .stat-section__title,
.stat-member-card .stat-section__title,
.stat-line-card .stat-section__title {
    font-size: 21px;
}

.stat-pie-card__title {
    margin: 0;
}

.stat-pie-card__subtitle {
    margin: 0;
}

.stat-compose-empty {
    padding: 8px 0 4px;
}

.stat-compose-empty :deep(.van-empty__description) {
    max-width: 260px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.45;
}

.stat-pie-wrap {
    display: flex;
    align-items: center;
    gap: 20px;
}

.stat-pie-svg {
    width: 140px;
    height: 140px;
    flex-shrink: 0;
}

.stat-pie-svg__empty {
    fill: rgba(var(--ledger-accent-rgb), 0.08);
    stroke: rgba(28, 25, 23, 0.06);
    stroke-width: 1;
}

.stat-pie-svg__expense {
    fill: var(--ledger-warm);
}

.stat-pie-svg__income {
    fill: var(--ledger-income);
}

.stat-pie-legend {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-width: 0;
}

.stat-pie-legend__row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    font-size: 14px;
    font-weight: 600;
}

.stat-pie-legend__row:last-child {
    margin-bottom: 0;
}

.stat-pie-legend__sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
}

.stat-pie-legend__sw--expense {
    background: var(--ledger-warm);
}

.stat-pie-legend__sw--income {
    background: var(--ledger-income);
}

.stat-pie-legend__name {
    flex: 1;
    color: var(--ledger-ink-muted);
}

.stat-pie-legend__pct {
    font-variant-numeric: tabular-nums;
    color: var(--ledger-ink);
}

.stat-pie-card__net {
    margin: 18px 0 0;
    padding-top: 14px;
    border-top: 1px solid rgba(28, 25, 23, 0.08);
    font-size: 14px;
    font-weight: 600;
    color: var(--ledger-ink-muted);
    text-align: center;
}

.stat-inner :deep(.van-empty__description) {
    color: var(--ledger-ink-muted);
    font-weight: 500;
    letter-spacing: 0.02em;
}

</style>

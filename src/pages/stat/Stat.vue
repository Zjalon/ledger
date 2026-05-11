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

type TrendKind = "income" | "expense";

const { selectedBookId, ep } = useSync();

const bills = ref<Full<Transaction>[]>([]);
const usersList = ref<Full<User>[]>([]);
const metaCategories = ref<BillCategory[]>([]);
const rangeKind = ref<RangeKind>("month");
/** 分类 / 成员 饼图的时间范围（独立于收支构成） */
const splitPieRange = ref<RangeKind>("month");
/** 支出 / 收入（饼图始终按分类，本组决定流水类型） */
const splitPieFlowKind = ref<TrendKind>("expense");
/** 全部 或 某位成员（按创建者筛选后再按分类聚合） */
const splitPieCreatorKey = ref<string>("all");
/** 本月折线图：收入 / 支出 */
const trendKind = ref<TrendKind>("expense");
/** 本月按成员饼图：收入 / 支出 */
const memberPieKind = ref<TrendKind>("expense");

const trendFillColor = computed(() =>
    trendKind.value === "expense" ? "#9a3412" : "#166534",
);

let unsubscribe: (() => void) | undefined;

const fmt = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function rangeBounds(kind: RangeKind): { start: number; end: number } {
    const now = dayjs();
    if (kind === "week") {
        return {
            start: now.startOf("isoWeek").valueOf(),
            end: now.endOf("isoWeek").valueOf(),
        };
    }
    if (kind === "month") {
        return {
            start: now.startOf("month").valueOf(),
            end: now.endOf("month").valueOf(),
        };
    }
    return {
        start: now.startOf("year").valueOf(),
        end: now.endOf("year").valueOf(),
    };
}

const periodLabel = computed(() => {
    const { start, end } = rangeBounds(rangeKind.value);
    const a = dayjs(start);
    const b = dayjs(end);
    if (rangeKind.value === "week") {
        return `${a.format("M月D日")} – ${b.format("M月D日")}`;
    }
    if (rangeKind.value === "month") {
        return a.format("YYYY年M月");
    }
    return a.format("YYYY年");
});

const rowsInRange = computed(() => {
    const { start, end } = rangeBounds(rangeKind.value);
    return bills.value
        .filter((b) => b.time >= start && b.time <= end)
        .sort((a, b) => b.time - a.time);
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

const expenseLabel = computed(() =>
    fmt.format(amountToNumber(expenseRaw.value)),
);

const incomeLabel = computed(() => fmt.format(amountToNumber(incomeRaw.value)));

const pieTotal = computed(() => expenseRaw.value + incomeRaw.value);

const expenseShare = computed(() => {
    const t = pieTotal.value;
    if (t <= 0) {
        return 0;
    }
    return expenseRaw.value / t;
});

/** 饼图扇区路径：从 12 点顺时针，expense 再 income */
const piePaths = computed(() => {
    const t = pieTotal.value;
    if (t <= 0) {
        return null;
    }
    const cx = 50;
    const cy = 50;
    const r = 42;
    const ex = expenseShare.value;
    if (ex <= 0) {
        return {
            expense: "",
            income: fullCircle(cx, cy, r),
        };
    }
    if (ex >= 1) {
        return {
            expense: fullCircle(cx, cy, r),
            income: "",
        };
    }
    const angle0 = -Math.PI / 2;
    const split = angle0 + ex * 2 * Math.PI;
    const expense = sectorPath(cx, cy, r, angle0, split);
    const income = sectorPath(cx, cy, r, split, angle0 + 2 * Math.PI);
    return { expense, income };
});

function polar(cx: number, cy: number, r: number, angle: number) {
    return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
    };
}

function sectorPath(cx: number, cy: number, r: number, a0: number, a1: number) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p0 = polar(cx, cy, r, a0);
    const p1 = polar(cx, cy, r, a1);
    return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
}

function fullCircle(cx: number, cy: number, r: number) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
}

/** 成员饼图：固定高对比色 + 超出后按黄金角铺色相 */
const MEMBER_PIE_COLORS_EXPENSE = [
    "#dc2626",
    "#ea580c",
    "#ca8a04",
    "#c2410c",
    "#e11d48",
    "#be185d",
    "#9333ea",
    "#b45309",
    "#991b1b",
    "#a16207",
    "#c026d3",
    "#7c2d12",
] as const;

const MEMBER_PIE_COLORS_INCOME = [
    "#14532d",
    "#0f766e",
    "#0369a1",
    "#047857",
    "#4d7c0f",
    "#0e7490",
    "#1d4ed8",
    "#15803d",
    "#0d9488",
    "#166534",
    "#1e40af",
    "#65a30d",
] as const;

function memberSliceColor(index: number, kind: TrendKind): string {
    const pal =
        kind === "expense"
            ? MEMBER_PIE_COLORS_EXPENSE
            : MEMBER_PIE_COLORS_INCOME;
    if (index < pal.length) {
        return pal[index];
    }
    const phase = kind === "expense" ? 12 : 118;
    const hue = (phase + index * 137.508) % 360;
    const sat = kind === "expense" ? "72%" : "62%";
    const light = kind === "expense" ? "44%" : "38%";
    return `hsl(${hue} ${sat} ${light})`;
}

const hasFlowInRange = computed(
    () => rowsInRange.value.length > 0 && pieTotal.value > 0,
);

const netRaw = computed(() => incomeRaw.value - expenseRaw.value);

const netLabel = computed(() => {
    const n = amountToNumber(netRaw.value);
    const abs = fmt.format(Math.abs(n));
    if (netRaw.value > 0) {
        return `结余 +${abs}`;
    }
    if (netRaw.value < 0) {
        return `结余 −${abs}`;
    }
    return "收支相抵";
});

const fmtAxis = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
});

const trendMonthLabel = computed(() => dayjs().format("YYYY年M月"));

const categoryLabelMap = computed(() =>
    buildCategoryLabelMap(metaCategories.value),
);

function memberCreatorLabel(creatorKey: string): string {
    const u = usersList.value.find((x) => String(x.id) === creatorKey);
    const nick = u?.nickname?.trim();
    if (nick) {
        return nick;
    }
    if (creatorKey.length > 10) {
        return `成员 …${creatorKey.slice(-4)}`;
    }
    return "成员";
}

/** 第三组：全部 + 账本成员 + 流水里出现但不在成员表中的创建者 */
const splitPieMemberTabList = computed(() => {
    const tabs: { key: string; title: string }[] = [
        { key: "all", title: "全部" },
    ];
    const seen = new Set<string>(["all"]);
    for (const u of usersList.value) {
        const k = String(u.id);
        if (seen.has(k)) {
            continue;
        }
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
        if (seen.has(k)) {
            continue;
        }
        seen.add(k);
        tabs.push({ key: k, title: memberCreatorLabel(k) });
    }
    return tabs;
});

watch(splitPieMemberTabList, (tabs) => {
    const key = splitPieCreatorKey.value;
    if (key === "all") {
        return;
    }
    if (!tabs.some((t) => t.key === key)) {
        splitPieCreatorKey.value = "all";
    }
});

const splitPiePeriodLabel = computed(() => {
    const rk = splitPieRange.value;
    const { start, end } = rangeBounds(rk);
    const a = dayjs(start);
    const b = dayjs(end);
    if (rk === "week") {
        return `${a.format("M月D日")} – ${b.format("M月D日")}`;
    }
    if (rk === "month") {
        return a.format("YYYY年M月");
    }
    return a.format("YYYY年");
});

const splitPieDimHint = computed(() => {
    const flow =
        splitPieFlowKind.value === "expense" ? "按支出分类" : "按收入分类";
    const member =
        splitPieCreatorKey.value === "all"
            ? "全部成员"
            : (splitPieMemberTabList.value.find(
                  (t) => t.key === splitPieCreatorKey.value,
              )?.title ?? "指定成员");
    return `${flow} · ${member} · 不含转账`;
});

type SplitPieSlice = {
    sliceKey: string;
    label: string;
    amount: number;
    share: number;
    pathD: string;
    fill: string;
};

const splitPie = computed(() => {
    const flow = splitPieFlowKind.value;
    const creator = splitPieCreatorKey.value;
    const { start, end } = rangeBounds(splitPieRange.value);
    const map = new Map<string, number>();
    const labels = new Map<string, string>();

    for (const b of bills.value) {
        if (b.time < start || b.time > end) {
            continue;
        }
        if (b.type !== flow) {
            continue;
        }
        if (creator !== "all" && String(b.creatorId) !== creator) {
            continue;
        }
        const id = b.categoryId;
        map.set(id, (map.get(id) ?? 0) + b.amount);
        if (!labels.has(id)) {
            const name = categoryLabelMap.value.get(id)?.trim();
            labels.set(id, name && name.length > 0 ? name : "未命名分类");
        }
    }

    const rows = [...map.entries()]
        .map(([key, amount]) => ({
            sliceKey: key,
            label: labels.get(key) ?? key,
            amount,
        }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount);

    const total = rows.reduce((s, x) => s + x.amount, 0);
    if (total <= 0 || rows.length === 0) {
        return null;
    }
    const cx = 50;
    const cy = 50;
    const r = 42;
    if (rows.length === 1) {
        const [only] = rows;
        return {
            total,
            slices: [
                {
                    sliceKey: only.sliceKey,
                    label: only.label,
                    amount: only.amount,
                    share: 1,
                    pathD: fullCircle(cx, cy, r),
                    fill: memberSliceColor(0, flow),
                } satisfies SplitPieSlice,
            ],
        };
    }
    let angle = -Math.PI / 2;
    const slices: SplitPieSlice[] = rows.map((row, i) => {
        const frac = row.amount / total;
        const next = angle + frac * 2 * Math.PI;
        const pathD = sectorPath(cx, cy, r, angle, next);
        angle = next;
        return {
            sliceKey: row.sliceKey,
            label: row.label,
            amount: row.amount,
            share: row.amount / total,
            pathD,
            fill: memberSliceColor(i, flow),
        };
    });
    return { total, slices };
});

const splitPieTotalLabel = computed(() => {
    const p = splitPie.value;
    if (!p) {
        return "—";
    }
    return fmt.format(amountToNumber(p.total));
});

type MemberMonthSlice = {
    creatorKey: string;
    label: string;
    amount: number;
    share: number;
    pathD: string;
    fill: string;
};

const memberMonthPie = computed(() => {
    const kind = memberPieKind.value;
    const { start, end } = currentMonthBounds();
    const map = new Map<string, number>();
    for (const b of bills.value) {
        if (b.type !== kind) {
            continue;
        }
        if (b.time < start || b.time > end) {
            continue;
        }
        const k = String(b.creatorId);
        map.set(k, (map.get(k) ?? 0) + b.amount);
    }
    const rows = [...map.entries()]
        .map(([creatorKey, amount]) => ({
            creatorKey,
            label: memberCreatorLabel(creatorKey),
            amount,
        }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, x) => s + x.amount, 0);
    if (total <= 0 || rows.length === 0) {
        return null;
    }
    const cx = 50;
    const cy = 50;
    const r = 42;
    if (rows.length === 1) {
        const [only] = rows;
        return {
            total,
            slices: [
                {
                    creatorKey: only.creatorKey,
                    label: only.label,
                    amount: only.amount,
                    share: 1,
                    pathD: fullCircle(cx, cy, r),
                    fill: memberSliceColor(0, kind),
                } satisfies MemberMonthSlice,
            ],
        };
    }
    let angle = -Math.PI / 2;
    const slices: MemberMonthSlice[] = rows.map((row, i) => {
        const frac = row.amount / total;
        const next = angle + frac * 2 * Math.PI;
        const pathD = sectorPath(cx, cy, r, angle, next);
        angle = next;
        return {
            creatorKey: row.creatorKey,
            label: row.label,
            amount: row.amount,
            share: row.amount / total,
            pathD,
            fill: memberSliceColor(i, kind),
        };
    });
    return { total, slices };
});

const memberMonthTotalLabel = computed(() => {
    const pie = memberMonthPie.value;
    if (!pie) {
        return "—";
    }
    return fmt.format(amountToNumber(pie.total));
});

/** 当前自然月 [start, end] 时间戳 */
function currentMonthBounds(): { start: number; end: number } {
    const m = dayjs().startOf("month");
    return {
        start: m.valueOf(),
        end: m.endOf("month").valueOf(),
    };
}

const dailyTrendSeries = computed(() => {
    const { start, end } = currentMonthBounds();
    const monthStart = dayjs(start);
    const days = monthStart.daysInMonth();
    const sums = new Array<number>(days).fill(0);
    const t = trendKind.value;

    for (const b of bills.value) {
        if (b.type !== t) {
            continue;
        }
        if (b.time < start || b.time > end) {
            continue;
        }
        const di = dayjs(b.time).date() - 1;
        if (di >= 0 && di < days) {
            sums[di] += b.amount;
        }
    }

    return sums.map((amount, i) => ({
        day: i + 1,
        amount,
    }));
});

const trendMonthTotalLabel = computed(() => {
    const raw = dailyTrendSeries.value.reduce((s, x) => s + x.amount, 0);
    return fmt.format(amountToNumber(raw));
});

const trendHasAny = computed(() =>
    dailyTrendSeries.value.some((x) => x.amount > 0),
);

const trendChart = computed(() => {
    const series = dailyTrendSeries.value;
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
            label: `${series[i].day}日`,
        })),
    };
});

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
            <div class="stat-scroll-body">
                <section v-if="bills.length > 0" class="stat-pie-card">
                    <h2 class="stat-pie-card__title">收支构成</h2>
                    <p class="stat-pie-card__subtitle">
                        不含转账 · 按金额占比
                    </p>
                    <van-tabs
                        v-model:active="rangeKind"
                        shrink
                        type="card"
                        class="stat-compose-tabs"
                    >
                        <van-tab title="本周" name="week" />
                        <van-tab title="本月" name="month" />
                        <van-tab title="本年" name="year" />
                    </van-tabs>
                    <p class="stat-compose-period">{{ periodLabel }}</p>
                    <div class="stat-compose-summary">
                        <div class="stat-stat stat-stat--out">
                            <span class="stat-stat__label">支出</span>
                            <span class="stat-stat__value">{{
                                expenseLabel
                            }}</span>
                        </div>
                        <div class="stat-stat-divider" aria-hidden="true" />
                        <div class="stat-stat stat-stat--in">
                            <span class="stat-stat__label">收入</span>
                            <span class="stat-stat__value">{{
                                incomeLabel
                            }}</span>
                        </div>
                    </div>

                    <template v-if="hasFlowInRange">
                        <div class="stat-pie-wrap">
                        <svg
                            class="stat-pie-svg"
                            viewBox="0 0 100 100"
                            role="img"
                            :aria-label="`支出 ${Math.round(expenseShare * 100)}%，收入 ${Math.round((1 - expenseShare) * 100)}%`"
                        >
                            <circle
                                v-if="!piePaths"
                                class="stat-pie-svg__empty"
                                cx="50"
                                cy="50"
                                r="42"
                            />
                            <template v-else>
                                <path
                                    v-if="piePaths.expense"
                                    class="stat-pie-svg__expense"
                                    :d="piePaths.expense"
                                />
                                <path
                                    v-if="piePaths.income"
                                    class="stat-pie-svg__income"
                                    :d="piePaths.income"
                                />
                            </template>
                        </svg>
                        <ul class="stat-pie-legend">
                            <li class="stat-pie-legend__row">
                                <span
                                    class="stat-pie-legend__sw stat-pie-legend__sw--expense"
                                />
                                <span class="stat-pie-legend__name">支出</span>
                                <span class="stat-pie-legend__pct">{{
                                    pieTotal > 0
                                        ? `${Math.round(expenseShare * 100)}%`
                                        : "—"
                                }}</span>
                            </li>
                            <li class="stat-pie-legend__row">
                                <span
                                    class="stat-pie-legend__sw stat-pie-legend__sw--income"
                                />
                                <span class="stat-pie-legend__name">收入</span>
                                <span class="stat-pie-legend__pct">{{
                                    pieTotal > 0
                                        ? `${Math.round((1 - expenseShare) * 100)}%`
                                        : "—"
                                }}</span>
                            </li>
                        </ul>
                        </div>
                        <p class="stat-pie-card__net">{{ netLabel }}</p>
                    </template>
                    <van-empty
                        v-else
                        class="stat-compose-empty"
                        image="search"
                        description="所选时间范围内暂无收支（转账不计入饼图）"
                    />
                </section>

                <section v-if="bills.length > 0" class="stat-split-card">
                    <h2 class="stat-split-card__title">分类与成员</h2>
                    <p class="stat-split-card__subtitle">
                        {{ splitPiePeriodLabel }} · {{ splitPieDimHint }} · 合计
                        {{ splitPieTotalLabel }}
                    </p>
                    <van-tabs
                        v-model:active="splitPieRange"
                        shrink
                        type="card"
                        class="stat-split-tabs stat-split-tabs--range"
                    >
                        <van-tab title="本周" name="week" />
                        <van-tab title="本月" name="month" />
                        <van-tab title="本年" name="year" />
                    </van-tabs>
                    <van-tabs
                        v-model:active="splitPieFlowKind"
                        shrink
                        type="card"
                        class="stat-split-tabs stat-split-tabs--flow"
                    >
                        <van-tab title="支出" name="expense" />
                        <van-tab title="收入" name="income" />
                    </van-tabs>
                    <van-tabs
                        v-model:active="splitPieCreatorKey"
                        scrollable
                        shrink
                        type="card"
                        class="stat-split-tabs stat-split-tabs--members"
                    >
                        <van-tab
                            v-for="tab in splitPieMemberTabList"
                            :key="tab.key"
                            :title="tab.title"
                            :name="tab.key"
                        />
                    </van-tabs>

                    <div v-if="splitPie" class="stat-split-pie-wrap">
                        <svg
                            class="stat-pie-svg stat-split-pie-svg"
                            viewBox="0 0 100 100"
                            role="img"
                            :aria-label="`统计饼图 ${splitPieDimHint}`"
                        >
                            <path
                                v-for="sl in splitPie.slices"
                                :key="sl.sliceKey"
                                :d="sl.pathD"
                                :fill="sl.fill"
                                stroke="rgba(255, 254, 251, 0.72)"
                                stroke-width="0.55"
                                vector-effect="non-scaling-stroke"
                            />
                        </svg>
                        <ul class="stat-split-legend">
                            <li
                                v-for="sl in splitPie.slices"
                                :key="sl.sliceKey"
                                class="stat-split-legend__row"
                            >
                                <span
                                    class="stat-split-legend__sw"
                                    :style="{ background: sl.fill }"
                                />
                                <span class="stat-split-legend__name">{{
                                    sl.label
                                }}</span>
                                <span class="stat-split-legend__amt">{{
                                    fmt.format(amountToNumber(sl.amount))
                                }}</span>
                                <span class="stat-split-legend__pct">{{
                                    `${Math.round(sl.share * 100)}%`
                                }}</span>
                            </li>
                        </ul>
                    </div>
                    <van-empty
                        v-else
                        class="stat-split-empty"
                        image="search"
                        description="当前条件下暂无数据"
                    />
                </section>

                <section v-if="bills.length > 0" class="stat-member-card">
                    <h2 class="stat-member-card__title">本月成员构成</h2>
                    <p class="stat-member-card__subtitle">
                        {{ trendMonthLabel }} · 按创建者 · 不含转账 · 合计
                        {{ memberMonthTotalLabel }}
                    </p>
                    <van-tabs
                        v-model:active="memberPieKind"
                        shrink
                        type="card"
                        class="stat-member-tabs"
                    >
                        <van-tab title="支出" name="expense" />
                        <van-tab title="收入" name="income" />
                    </van-tabs>

                    <div v-if="memberMonthPie" class="stat-member-pie-wrap">
                        <svg
                            class="stat-pie-svg stat-member-pie-svg"
                            viewBox="0 0 100 100"
                            role="img"
                            :aria-label="`本月${memberPieKind === 'expense' ? '支出' : '收入'}成员占比`"
                        >
                            <path
                                v-for="sl in memberMonthPie.slices"
                                :key="sl.creatorKey"
                                :d="sl.pathD"
                                :fill="sl.fill"
                                stroke="rgba(255, 254, 251, 0.72)"
                                stroke-width="0.55"
                                vector-effect="non-scaling-stroke"
                            />
                        </svg>
                        <ul class="stat-member-legend">
                            <li
                                v-for="sl in memberMonthPie.slices"
                                :key="sl.creatorKey"
                                class="stat-member-legend__row"
                            >
                                <span
                                    class="stat-member-legend__sw"
                                    :style="{ background: sl.fill }"
                                />
                                <span class="stat-member-legend__name">{{
                                    sl.label
                                }}</span>
                                <span class="stat-member-legend__amt">{{
                                    fmt.format(amountToNumber(sl.amount))
                                }}</span>
                                <span class="stat-member-legend__pct">{{
                                    `${Math.round(sl.share * 100)}%`
                                }}</span>
                            </li>
                        </ul>
                    </div>
                    <van-empty
                        v-else
                        class="stat-member-empty"
                        image="search"
                        :description="`本月暂无${memberPieKind === 'expense' ? '支出' : '收入'}（不含转账）`"
                    />
                </section>

                <van-empty
                    v-else
                    description="暂无账单数据"
                />

                <section v-if="bills.length > 0" class="stat-line-card">
                    <h2 class="stat-line-card__title">本月每日趋势</h2>
                    <p class="stat-line-card__subtitle">
                        {{ trendMonthLabel }} · 不含转账 · 合计
                        {{ trendMonthTotalLabel }}
                    </p>
                    <van-tabs
                        v-model:active="trendKind"
                        shrink
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
                            :aria-label="`${trendKind === 'expense' ? '支出' : '收入'}本月按日折线`"
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
                                    'stat-line-svg__line--expense':
                                        trendKind === 'expense',
                                    'stat-line-svg__line--income':
                                        trendKind === 'income',
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
                        class="stat-line-empty"
                        image="search"
                        description="本月暂无该项流水"
                    />
                </section>
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

.stat-compose-tabs :deep(.van-tabs__wrap) {
    margin-bottom: 8px;
}

.stat-compose-tabs :deep(.van-tabs__nav--card) {
    margin: 0;
    border-radius: 12px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.18);
    background: rgba(255, 254, 251, 0.65);
}

.stat-compose-tabs :deep(.van-tab--card) {
    border-radius: 10px;
    color: var(--ledger-ink-muted);
    font-weight: 600;
    font-size: 13px;
}

.stat-compose-tabs :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: var(--ledger-accent);
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
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-split-card {
    margin-top: 18px;
    padding: 20px 18px 22px;
    border-radius: 20px;
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-split-card__title {
    margin: 0 0 4px;
    font-family: var(--ledger-font-display);
    font-size: 20px;
    font-weight: 500;
    letter-spacing: -0.01em;
}

.stat-split-card__subtitle {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--ledger-ink-muted);
    font-weight: 500;
    line-height: 1.45;
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
}

.stat-split-tabs :deep(.van-tabs__wrap) {
    margin-bottom: 0;
}

.stat-split-tabs :deep(.van-tabs__nav--card) {
    margin: 0;
    border-radius: 12px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.18);
    background: rgba(255, 254, 251, 0.65);
}

.stat-split-tabs :deep(.van-tab--card) {
    border-radius: 10px;
    color: var(--ledger-ink-muted);
    font-weight: 600;
    font-size: 13px;
}

.stat-split-tabs :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: var(--ledger-accent);
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
    margin-top: 18px;
    padding: 20px 18px 22px;
    border-radius: 20px;
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-member-card__title {
    margin: 0 0 4px;
    font-family: var(--ledger-font-display);
    font-size: 20px;
    font-weight: 500;
    letter-spacing: -0.01em;
}

.stat-member-card__subtitle {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--ledger-ink-muted);
    font-weight: 500;
    line-height: 1.45;
}

.stat-member-tabs {
    margin-bottom: 14px;
}

.stat-member-tabs :deep(.van-tabs__wrap) {
    margin-bottom: 0;
}

.stat-member-tabs :deep(.van-tabs__nav--card) {
    margin: 0;
    border-radius: 12px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.18);
    background: rgba(255, 254, 251, 0.65);
}

.stat-member-tabs :deep(.van-tab--card) {
    border-radius: 10px;
    color: var(--ledger-ink-muted);
    font-weight: 600;
    font-size: 13px;
}

.stat-member-tabs :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: var(--ledger-accent);
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
    margin-top: 18px;
    padding: 20px 18px 22px;
    border-radius: 20px;
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 42px -30px var(--ledger-shadow-ink);
}

.stat-line-card__title {
    margin: 0 0 4px;
    font-family: var(--ledger-font-display);
    font-size: 20px;
    font-weight: 500;
    letter-spacing: -0.01em;
}

.stat-line-card__subtitle {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--ledger-ink-muted);
    font-weight: 500;
    line-height: 1.45;
}

.stat-trend-tabs {
    margin-bottom: 14px;
}

.stat-trend-tabs :deep(.van-tabs__wrap) {
    margin-bottom: 0;
}

.stat-trend-tabs :deep(.van-tabs__nav--card) {
    margin: 0;
    border-radius: 12px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.18);
    background: rgba(255, 254, 251, 0.65);
}

.stat-trend-tabs :deep(.van-tab--card) {
    border-radius: 10px;
    color: var(--ledger-ink-muted);
    font-weight: 600;
    font-size: 13px;
}

.stat-trend-tabs :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: var(--ledger-accent);
}

.stat-line-svg-wrap {
    width: 100%;
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

.stat-pie-card__title {
    margin: 0 0 4px;
    font-family: var(--ledger-font-display);
    font-size: 20px;
    font-weight: 500;
    letter-spacing: -0.01em;
}

.stat-pie-card__subtitle {
    margin: 0 0 12px;
    font-size: 12px;
    color: var(--ledger-ink-muted);
    font-weight: 500;
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

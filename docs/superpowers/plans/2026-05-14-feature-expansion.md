# Ledger Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four features to the Ledger family accounting PWA: transaction editing, history browsing, transaction search/filter, and scheduled (recurring) transactions.

**Architecture:** All four features build on the existing `SyncEndpoint` pattern — data mutations go through `ep.tableBatch()` + `ep.toSync()`, reads through `ep.tableGetAllItems()`. UI follows the established warm-paper design system with Vant components. The `RecordTransactionSheet` is extended to support edit mode via a new prop. History browsing and search are added to `Home.vue`. Scheduled transactions get a new profile sub-page and a composable for auto-generation.

**Tech Stack:** Vue 3 (`<script setup>` + TypeScript), Vant 4, dayjs, uuid, existing Tidal sync engine

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/components/RecordTransactionSheet.vue` | Add edit mode (accept existing tx, pre-fill form, update instead of create) |
| Modify | `src/layouts/MainLayout.vue` | Pass `editingTx` prop to sheet, expose `startEdit(tx)` via provide/inject |
| Modify | `src/pages/home/Home.vue` | Add date navigation, history browsing, search/filter UI, edit swipe action |
| Create | `src/composables/use-history-range.ts` | Dayjs-based date range state (day/week/month navigation) |
| Create | `src/composables/use-tx-filter.ts` | Client-side transaction filtering (keyword, amount, type, category, date) |
| Create | `src/pages/profile/scheduled/ScheduledManage.vue` | CRUD UI for scheduled (recurring) transactions |
| Create | `src/composables/use-scheduled.ts` | Auto-generate transactions from Scheduled configs on app entry |
| Modify | `src/router/index.ts` | Add `profile/scheduled` route |
| Modify | `src/pages/profile/Profile.vue` | Add "周期记账" navigation cell |

---

## Phase 1: Transaction Editing

### Task 1: Extend RecordTransactionSheet for edit mode

**Files:**
- Modify: `src/components/RecordTransactionSheet.vue`

- [ ] **Step 1: Add `editingTx` prop and edit-mode logic**

In the `<script setup>` section, add a new optional prop and watch it to pre-fill the form:

```ts
// After line 25 (const props = defineProps<{ show: boolean }>();), change to:
const props = defineProps<{
    show: boolean;
    editingTx?: Full<Transaction> | null;
}>();
```

- [ ] **Step 2: Add edit-mode computed and pre-fill watcher**

After the `comment` ref declaration (line 39), add:

```ts
const isEditMode = computed(() => Boolean(props.editingTx));
```

Replace the existing `watch(() => props.show, ...)` (lines 161-185) with:

```ts
watch(
    () => props.show,
    (v) => {
        if (v) {
            if (props.editingTx) {
                // Edit mode: pre-fill from existing transaction
                const tx = props.editingTx;
                amountStr.value = String(amountToNumber(tx.amount));
                comment.value = tx.comment ?? "";
                typeTab.value =
                    tx.type === "expense" ? 0 : tx.type === "income" ? 1 : 2;
                void loadContext().then(() => {
                    if (tx.type === "transfer") {
                        transferFromId.value = tx.accountId ?? "";
                        transferToId.value = tx.transferTo ?? "";
                    } else {
                        accountId.value = tx.accountId ?? "";
                        categoryId.value = tx.categoryId ?? "";
                    }
                });
            } else {
                // Create mode: reset everything
                amountStr.value = "";
                comment.value = "";
                accountId.value = "";
                transferFromId.value = "";
                transferToId.value = "";
                typeTab.value = 0;
                void loadContext().then(() => {
                    const pick = mergeCategoriesForType(
                        "expense",
                        metaCategories.value,
                    );
                    categoryId.value = pick[0]?.id ?? "";
                    const ordered = sortedAccountsForPicker.value;
                    const firstId = ordered[0]?.id ?? "";
                    accountId.value = firstId;
                    transferFromId.value = firstId;
                    transferToId.value =
                        ordered.length >= 2 ? ordered[1].id : "";
                });
            }
        }
    },
);
```

- [ ] **Step 3: Update submit to handle edit mode**

Replace the `submit()` function's transaction creation logic (lines 237-264) with:

```ts
    const amount = numberToAmount(raw);

    if (isEditMode.value && props.editingTx) {
        // Edit mode: preserve original id, creatorId, time; update amount, type, category, account, comment
        const orig = props.editingTx;
        const updated: Transaction = {
            ...orig,
            type: billType.value,
            categoryId:
                billType.value === "transfer"
                    ? TransferPresetCategory.id
                    : categoryId.value,
            comment: comment.value.trim() || undefined,
            amount,
            accountId:
                billType.value === "transfer"
                    ? transferFromId.value
                    : accountId.value,
            transferTo:
                billType.value === "transfer"
                    ? transferToId.value
                    : undefined,
        };
        try {
            await ep.tableBatch<Transaction>(bid, "transactions", [
                { type: "update", value: updated },
            ]);
            await ep.toSync();
            showToast("已更新");
            emit("submitted");
            close();
        } catch (e: unknown) {
            const msg =
                e instanceof Error ? e.message : String(e ?? "更新失败");
            showToast(msg);
        }
        return;
    }

    // Create mode
    const txId = uuidv4();
    const base: Omit<Transaction, "accountId" | "transferTo"> = {
        id: txId,
        type: billType.value,
        categoryId:
            billType.value === "transfer"
                ? TransferPresetCategory.id
                : categoryId.value,
        creatorId: token,
        comment: comment.value.trim() || undefined,
        amount,
        time: Date.now(),
    };
```

- [ ] **Step 4: Update submit button text**

In the template, change the submit button text conditionally:

```html
<van-button
    type="primary"
    block
    round
    class="sheet__submit"
    @click="submit"
>
    {{ isEditMode ? '更新账单' : '保存到账本' }}
</van-button>
```

- [ ] **Step 5: Update sheet title for edit mode**

In the template, change the title block:

```html
<div class="sheet__title-block">
    <span class="sheet__title">{{ isEditMode ? '编辑' : '记一笔' }}</span>
    <span class="sheet__subtitle">{{ isEditMode ? '修改记录' : '快速记录 · 自动同步' }}</span>
</div>
```

- [ ] **Step 6: Verify build**

Run: `pnpm lint`
Expected: PASS

---

### Task 2: Wire edit flow through MainLayout and Home

**Files:**
- Modify: `src/layouts/MainLayout.vue`
- Modify: `src/pages/home/Home.vue`

- [ ] **Step 1: Add editingTx state to MainLayout**

In `MainLayout.vue` `<script setup>`, after the `showRecordSheet` ref, add:

```ts
import type { Full } from "@/database/stash";
import type { Transaction } from "@/database/tables/transaction";

// ... existing code ...
const showRecordSheet = ref(false);
const editingTx = ref<Full<Transaction> | null>(null);

function startEdit(tx: Full<Transaction>) {
    editingTx.value = tx;
    showRecordSheet.value = true;
}

function onRecordClose() {
    editingTx.value = null;
}

provide("startEdit", startEdit);
```

Update the `RecordTransactionSheet` usage in the template to pass the prop and handle close:

```html
<RecordTransactionSheet
    v-model:show="showRecordSheet"
    :editing-tx="editingTx"
    @update:show="onRecordClose"
    @submitted="onRecordClose"
/>
```

Also update the record button click to clear editing state:

```html
<button class="app-record" @click="editingTx = null; showRecordSheet = true">
```

- [ ] **Step 2: Add edit swipe action to Home.vue**

In `Home.vue` `<script setup>`, inject `startEdit`:

```ts
import { inject } from "vue";
// ... existing imports ...

const startEdit = inject<(tx: Full<Transaction>) => void>("startEdit");
```

In the template, add an "编辑" button alongside the existing "删除" swipe button. Replace the swipe-cell template section:

```html
<van-swipe-cell class="journal-swipe">
    <div
        class="journal-row"
        :class="rowModifier(tx)"
        @click="startEdit?.(tx)"
    >
        <!-- ... existing card content ... -->
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
            @click.stop="confirmDeleteTransaction(tx)"
        >
            删除
        </van-button>
    </template>
</van-swipe-cell>
```

- [ ] **Step 3: Add edit button CSS**

In `Home.vue` `<style scoped>`, after `.swipe-side-btn--del`, add:

```css
.swipe-side-btn--edit {
    background: var(--ledger-accent);
    color: #fff;
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/RecordTransactionSheet.vue src/layouts/MainLayout.vue src/pages/home/Home.vue
git commit -m "feat: transaction editing via swipe and sheet edit mode"
```

---

## Phase 2: History Browsing

### Task 3: Create useHistoryRange composable

**Files:**
- Create: `src/composables/use-history-range.ts`

- [ ] **Step 1: Write the composable**

```ts
import dayjs from "dayjs";
import { computed, ref } from "vue";

export type RangeUnit = "day" | "week" | "month";

export function useHistoryRange() {
    const unit = ref<RangeUnit>("day");
    /** Anchor date — the "current" day/week/month being viewed */
    const anchor = ref(dayjs());

    const isToday = computed(() => anchor.value.isSame(dayjs(), "day"));

    const rangeStart = computed(() => {
        if (unit.value === "day") return anchor.value.startOf("day");
        if (unit.value === "week") return anchor.value.startOf("week");
        return anchor.value.startOf("month");
    });

    const rangeEnd = computed(() => {
        if (unit.value === "day")
            return anchor.value.add(1, "day").startOf("day");
        if (unit.value === "week")
            return anchor.value.endOf("week").add(1, "day").startOf("day");
        return anchor.value.add(1, "month").startOf("month");
    });

    const rangeLabel = computed(() => {
        if (unit.value === "day") return anchor.value.format("M月D日 ddd");
        if (unit.value === "week") {
            const s = anchor.value.startOf("week").format("M/D");
            const e = anchor.value.endOf("week").format("M/D");
            return `${s} – ${e} 周`;
        }
        return anchor.value.format("YYYY年M月");
    });

    function prev() {
        anchor.value = anchor.value.subtract(1, unit.value);
    }

    function next() {
        anchor.value = anchor.value.add(1, unit.value);
    }

    function goToday() {
        anchor.value = dayjs();
    }

    function setUnit(u: RangeUnit) {
        unit.value = u;
        anchor.value = dayjs();
    }

    return {
        unit,
        anchor,
        isToday,
        rangeStart,
        rangeEnd,
        rangeLabel,
        prev,
        next,
        goToday,
        setUnit,
    };
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm lint`
Expected: PASS

---

### Task 4: Refactor Home.vue for history browsing

**Files:**
- Modify: `src/pages/home/Home.vue`

- [ ] **Step 1: Import and use useHistoryRange**

In `Home.vue` `<script setup>`, add the import and setup:

```ts
import { useHistoryRange, type RangeUnit } from "@/composables/use-history-range";

// After the existing const declarations:
const history = useHistoryRange();
```

- [ ] **Step 2: Replace `todayRows` with range-filtered rows**

Replace the existing `todayRows` computed (lines 38-44):

```ts
const visibleRows = computed(() => {
    const start = history.rangeStart.value.valueOf();
    const end = history.rangeEnd.value.valueOf();
    return bills.value
        .filter((b) => b.time >= start && b.time < end)
        .sort((a, b) => b.time - a.time);
});
```

- [ ] **Step 3: Replace `todayPerCreatorHero` with range-aware version**

Replace the existing `todayPerCreatorHero` computed (lines 67-108):

```ts
const perCreatorHero = computed((): TodayHeroRow[] => {
    const start = history.rangeStart.value.valueOf();
    const end = history.rangeEnd.value.valueOf();
    const uid = LoginAPI.getLocalToken()?.accessToken?.trim() ?? "";

    const map = new Map<string, { expense: number; income: number }>();
    for (const b of bills.value) {
        if (b.time < start || b.time >= end) continue;
        if (b.type !== "expense" && b.type !== "income") continue;
        const k = String(b.creatorId);
        const cur = map.get(k) ?? { expense: 0, income: 0 };
        if (b.type === "expense") cur.expense += b.amount;
        else cur.income += b.amount;
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
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        return a.label.localeCompare(b.label, "zh-CN");
    });

    return rows;
});
```

- [ ] **Step 4: Add date navigation to the template**

Replace the hero header section with a date navigator. In the template, replace the `<header class="journal-hero">` section's top part:

```html
<header class="journal-hero">
    <div class="journal-hero__top">
        <div class="journal-date-nav">
            <button
                type="button"
                class="journal-date-nav__btn"
                @click="history.prev"
                aria-label="上一个"
            >
                ‹
            </button>
            <button
                type="button"
                class="journal-date-nav__label"
                @click="history.goToday"
                :class="{ 'journal-date-nav__label--today': history.isToday.value }"
            >
                {{ history.rangeLabel.value }}
            </button>
            <button
                type="button"
                class="journal-date-nav__btn"
                @click="history.next"
                :disabled="history.isToday.value"
                aria-label="下一个"
            >
                ›
            </button>
        </div>
        <div class="journal-range-tabs">
            <button
                v-for="u in (['day', 'week', 'month'] as RangeUnit[])"
                :key="u"
                type="button"
                class="journal-range-tab"
                :class="{ 'journal-range-tab--active': history.unit.value === u }"
                @click="history.setUnit(u)"
            >
                {{ u === 'day' ? '日' : u === 'week' ? '周' : '月' }}
            </button>
        </div>
        <p class="journal-hero__note">各成员 · 仅收支 · 不含转账</p>
    </div>
```

Update all references from `todayPerCreatorHero` to `perCreatorHero` and `todayRows` to `visibleRows` in the template.

- [ ] **Step 5: Add date navigation CSS**

In `Home.vue` `<style scoped>`, add after `.journal-hero__top`:

```css
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
    transition:
        background 0.15s ease,
        color 0.15s ease,
        border-color 0.15s ease;
}

.journal-range-tab--active {
    background: rgba(var(--ledger-accent-rgb), 0.12);
    color: var(--journal-accent-deep);
    border-color: rgba(var(--ledger-accent-rgb), 0.25);
}
```

- [ ] **Step 6: Update hero kicker text to be dynamic**

Replace the static "今日概览" text:

```html
<p class="journal-kicker">{{ history.isToday.value ? '今日概览' : history.rangeLabel.value }}</p>
```

And the section title:

```html
<h2 class="journal-section-title">
    <span class="journal-section-title__text">{{ history.isToday.value ? '今日流水' : '流水记录' }}</span>
</h2>
```

- [ ] **Step 7: Update empty states**

Replace the two empty states to be range-aware:

```html
<div v-if="bills.length === 0" class="journal-empty">
    <p class="journal-empty__title">账本还是空的</p>
    <p class="journal-empty__hint">记下第一笔，从今天开始。</p>
</div>

<div
    v-else-if="visibleRows.length === 0"
    class="journal-empty journal-empty--soft"
>
    <p class="journal-empty__title">{{ history.isToday.value ? '今日还没有收支' : '该时段没有流水' }}</p>
    <p class="journal-empty__hint">
        {{ history.isToday.value ? '点击底部中间的「记一笔」。' : '换个时间看看，或记一笔新的。' }}
    </p>
</div>
```

- [ ] **Step 8: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/composables/use-history-range.ts src/pages/home/Home.vue
git commit -m "feat: history browsing with day/week/month navigation on home page"
```

---

## Phase 3: Transaction Search/Filter

### Task 5: Create useTxFilter composable

**Files:**
- Create: `src/composables/use-tx-filter.ts`

- [ ] **Step 1: Write the composable**

```ts
import { computed, ref } from "vue";
import type { Full } from "@/database/stash";
import type { Transaction } from "@/database/tables/transaction";
import type { BillType } from "@/ledger/type";

export type TxFilters = {
    keyword: string;
    minAmount: number | null;
    maxAmount: number | null;
    types: BillType[];
    categoryIds: string[];
};

export function useTxFilter(allRows: () => Full<Transaction>[]) {
    const filters = ref<TxFilters>({
        keyword: "",
        minAmount: null,
        maxAmount: null,
        types: [],
        categoryIds: [],
    });

    const hasActiveFilters = computed(() => {
        const f = filters.value;
        return (
            f.keyword.trim() !== "" ||
            f.minAmount !== null ||
            f.maxAmount !== null ||
            f.types.length > 0 ||
            f.categoryIds.length > 0
        );
    });

    const filteredRows = computed(() => {
        const f = filters.value;
        let rows = allRows();

        if (f.keyword.trim()) {
            const q = f.keyword.trim().toLowerCase();
            rows = rows.filter(
                (tx) =>
                    (tx.comment ?? "").toLowerCase().includes(q) ||
                    tx.categoryId.toLowerCase().includes(q),
            );
        }

        if (f.minAmount !== null) {
            rows = rows.filter((tx) => tx.amount >= f.minAmount! * 10000);
        }
        if (f.maxAmount !== null) {
            rows = rows.filter((tx) => tx.amount <= f.maxAmount! * 10000);
        }

        if (f.types.length > 0) {
            const typeSet = new Set(f.types);
            rows = rows.filter((tx) => typeSet.has(tx.type));
        }

        if (f.categoryIds.length > 0) {
            const catSet = new Set(f.categoryIds);
            rows = rows.filter((tx) => catSet.has(tx.categoryId));
        }

        return rows;
    });

    function resetFilters() {
        filters.value = {
            keyword: "",
            minAmount: null,
            maxAmount: null,
            types: [],
            categoryIds: [],
        };
    }

    return {
        filters,
        hasActiveFilters,
        filteredRows,
        resetFilters,
    };
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm lint`
Expected: PASS

---

### Task 6: Add search/filter UI to Home.vue

**Files:**
- Modify: `src/pages/home/Home.vue`

- [ ] **Step 1: Import and setup useTxFilter**

In `Home.vue` `<script setup>`, add:

```ts
import { useTxFilter } from "@/composables/use-tx-filter";

// After the history composable setup:
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
```

Remove the previous `visibleRows` computed from Task 4 if it was added separately.

- [ ] **Step 2: Add search button and filter sheet to template**

After the hero section closing `</header>`, add a search bar:

```html
<div class="journal-search-bar">
    <button
        type="button"
        class="journal-search-btn"
        :class="{ 'journal-search-btn--active': txFilter.hasActiveFilters.value }"
        @click="showFilterSheet = true"
    >
        <van-icon name="search" size="16" />
        <span>{{ txFilter.filters.value.keyword || '搜索流水' }}</span>
        <span
            v-if="txFilter.hasActiveFilters.value"
            class="journal-search-btn__badge"
        />
    </button>
</div>
```

At the bottom of the template (before the closing `</div>` of `.journal-page`), add the filter popup:

```html
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
            <button
                type="button"
                class="filter-panel__reset"
                @click="txFilter.resetFilters()"
            >
                重置
            </button>
        </div>

        <div class="filter-panel__body">
            <div class="filter-field">
                <label class="filter-field__label">关键词</label>
                <input
                    v-model="txFilter.filters.value.keyword"
                    type="text"
                    class="filter-field__input"
                    placeholder="搜索备注…"
                    autocomplete="off"
                />
            </div>

            <div class="filter-field">
                <label class="filter-field__label">金额范围</label>
                <div class="filter-field__row">
                    <input
                        v-model.number="txFilter.filters.value.minAmount"
                        type="number"
                        inputmode="decimal"
                        class="filter-field__input filter-field__input--half"
                        placeholder="最小"
                        min="0"
                    />
                    <span class="filter-field__sep">–</span>
                    <input
                        v-model.number="txFilter.filters.value.maxAmount"
                        type="number"
                        inputmode="decimal"
                        class="filter-field__input filter-field__input--half"
                        placeholder="最大"
                        min="0"
                    />
                </div>
            </div>

            <div class="filter-field">
                <label class="filter-field__label">类型</label>
                <div class="filter-chips">
                    <button
                        v-for="t in ([
                            { v: 'expense', l: '支出' },
                            { v: 'income', l: '收入' },
                            { v: 'transfer', l: '转账' },
                        ] as const)"
                        :key="t.v"
                        type="button"
                        class="filter-chip"
                        :class="{
                            'filter-chip--active':
                                txFilter.filters.value.types.includes(t.v),
                        }"
                        @click="
                            txFilter.filters.value.types.includes(t.v)
                                ? (txFilter.filters.value.types =
                                      txFilter.filters.value.types.filter(
                                          (x) => x !== t.v,
                                      ))
                                : txFilter.filters.value.types.push(t.v)
                        "
                    >
                        {{ t.l }}
                    </button>
                </div>
            </div>
        </div>

        <div class="filter-panel__foot">
            <van-button
                type="primary"
                block
                round
                @click="showFilterSheet = false"
            >
                查看 {{ txFilter.filteredRows.value.length }} 条结果
            </van-button>
        </div>
    </div>
</van-popup>
```

- [ ] **Step 3: Add search/filter CSS**

In `Home.vue` `<style scoped>`, add:

```css
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
    transition:
        background 0.15s ease,
        color 0.15s ease;
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
```

- [ ] **Step 4: Update section title to show filter count**

```html
<h2 class="journal-section-title">
    <span class="journal-section-title__text">
        {{ history.isToday.value && !txFilter.hasActiveFilters.value ? '今日流水' : `流水 · ${visibleRows.length} 条` }}
    </span>
</h2>
```

- [ ] **Step 5: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/composables/use-tx-filter.ts src/pages/home/Home.vue
git commit -m "feat: transaction search and filter on home page"
```

---

## Phase 4: Scheduled (Recurring) Transactions

### Task 7: Create useScheduled composable

**Files:**
- Create: `src/composables/use-scheduled.ts`

- [ ] **Step 1: Write the composable**

```ts
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import type { SyncEndpoint } from "@/api/endpoints/type";
import type { Transaction } from "@/database/tables/transaction";
import type { Scheduled } from "@/ledger/extra-type";
import type { GlobalMeta } from "@/ledger/type";

/** Load scheduled configs from meta.personal[uid] */
export async function loadScheduleds(
    ep: SyncEndpoint,
    bookId: string,
    uid: string,
): Promise<Scheduled[]> {
    const meta = (await ep.getLedgerMeta(bookId)) as GlobalMeta;
    const personal = meta.personal?.[uid];
    return personal?.scheduleds ?? [];
}

/** Save scheduled configs to meta.personal[uid] */
export async function saveScheduleds(
    ep: SyncEndpoint,
    bookId: string,
    uid: string,
    scheduleds: Scheduled[],
): Promise<void> {
    await ep.patchLedgerMeta(bookId, {
        personal: {
            [uid]: { scheduleds },
        },
    });
    await ep.toSync();
}

/**
 * Process scheduled transactions: for each enabled Scheduled, generate
 * any missing transactions up to today.
 */
export async function processScheduleds(
    ep: SyncEndpoint,
    bookId: string,
    uid: string,
    scheduleds: Scheduled[],
): Promise<number> {
    const now = Date.now();
    const txs: Transaction[] = [];
    let updated = false;

    for (const s of scheduleds) {
        if (!s.enabled) continue;
        if (s.end && now > s.end) continue;

        let cursor = s.latest ?? s.start;
        const template = s.template;

        while (cursor <= now) {
            const nextTime = advanceByRepeat(cursor, s.repeat);
            if (nextTime > now) break;
            if (s.end && nextTime > s.end) break;

            const tx: Transaction = {
                id: uuidv4(),
                type: template.type,
                categoryId: template.categoryId,
                creatorId: uid,
                comment: template.comment,
                amount: template.amount,
                time: nextTime,
                accountId: template.accountId,
                transferTo: template.transferTo,
                extra: { scheduledId: s.id },
            };
            txs.push(tx);
            cursor = nextTime;
            updated = true;
        }

        if (updated) {
            s.latest = cursor;
        }
    }

    if (txs.length > 0) {
        await ep.tableBatch<Transaction>(bookId, "transactions", 
            txs.map((tx) => ({ type: "update" as const, value: tx }))
        );
        await saveScheduleds(ep, bookId, uid, scheduleds);
    }

    return txs.length;
}

function advanceByRepeat(
    from: number,
    repeat: { unit: string; value: number },
): number {
    const d = dayjs(from);
    switch (repeat.unit) {
        case "day":
            return d.add(repeat.value, "day").valueOf();
        case "week":
            return d.add(repeat.value, "week").valueOf();
        case "month":
            return d.add(repeat.value, "month").valueOf();
        case "year":
            return d.add(repeat.value, "year").valueOf();
        default:
            return d.add(repeat.value, "month").valueOf();
    }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm lint`
Expected: PASS

---

### Task 8: Create ScheduledManage page

**Files:**
- Create: `src/pages/profile/scheduled/ScheduledManage.vue`

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import {
    closeToast,
    showConfirmDialog,
    showLoadingToast,
    showToast,
} from "vant";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { LoginAPI } from "@/api/endpoints/gitee";
import { mergeCategoriesForType } from "@/composables/use-ledger-meta";
import { useSync } from "@/composables/use-sync";
import {
    loadScheduleds,
    saveScheduleds,
} from "@/composables/use-scheduled";
import type { Full } from "@/database/stash";
import type { Account } from "@/database/tables/account";
import type { Scheduled } from "@/ledger/extra-type";
import type { BillCategory, BillType } from "@/ledger/type";
import {
    amountToNumber,
    isValidNumberForAmount,
    numberToAmount,
} from "@/ledger/bill";
import { TransferPresetCategory } from "@/ledger/category-zh-presets";

const router = useRouter();
const { ep, selectedBookId } = useSync();

const scheduleds = ref<Scheduled[]>([]);
const accounts = ref<Full<Account>[]>([]);
const metaCategories = ref<BillCategory[]>([]);
const loading = ref(true);

// Form state
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formTitle = ref("");
const formTypeTab = ref(0);
const formAmountStr = ref("");
const formCategoryId = ref("");
const formAccountId = ref("");
const formTransferFromId = ref("");
const formTransferToId = ref("");
const formComment = ref("");
const formRepeatUnit = ref<"month" | "week" | "day" | "year">("month");
const formRepeatValue = ref(1);
const formEnabled = ref(true);

const billType = computed<BillType>(() => {
    if (formTypeTab.value === 0) return "expense";
    if (formTypeTab.value === 1) return "income";
    return "transfer";
});

const categoriesPick = computed(() =>
    mergeCategoriesForType(billType.value, metaCategories.value),
);

const repeatLabel = computed(() => {
    const v = formRepeatValue.value;
    const u = formRepeatUnit.value;
    const labels: Record<string, string> = {
        day: "天",
        week: "周",
        month: "月",
        year: "年",
    };
    return `每${v > 1 ? v : ""}${labels[u]}`;
});

function getUid(): string {
    return LoginAPI.getLocalToken()?.accessToken ?? "";
}

async function load() {
    const bid = selectedBookId.value?.trim();
    const uid = getUid();
    if (!bid || !uid) return;
    loading.value = true;
    try {
        const [scheds, accList, meta] = await Promise.all([
            loadScheduleds(ep, bid, uid),
            ep.tableGetAllItems<Full<Account>>(bid, "accounts"),
            ep.getLedgerMeta(bid),
        ]);
        scheduleds.value = scheds;
        accounts.value = accList;
        metaCategories.value = Array.isArray(meta.categories)
            ? (meta.categories as BillCategory[])
            : [];
    } catch {
        showToast("加载失败");
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openCreate() {
    editingId.value = null;
    formTitle.value = "";
    formTypeTab.value = 0;
    formAmountStr.value = "";
    formComment.value = "";
    formRepeatUnit.value = "month";
    formRepeatValue.value = 1;
    formEnabled.value = true;
    const pick = mergeCategoriesForType("expense", metaCategories.value);
    formCategoryId.value = pick[0]?.id ?? "";
    const firstAcc = accounts.value[0]?.id ?? "";
    formAccountId.value = firstAcc;
    formTransferFromId.value = firstAcc;
    formTransferToId.value = accounts.value[1]?.id ?? "";
    showForm.value = true;
}

function openEdit(s: Scheduled) {
    editingId.value = s.id;
    formTitle.value = s.title;
    formTypeTab.value =
        s.template.type === "expense"
            ? 0
            : s.template.type === "income"
              ? 1
              : 2;
    formAmountStr.value = String(amountToNumber(s.template.amount));
    formCategoryId.value = s.template.categoryId;
    formAccountId.value = s.template.accountId ?? "";
    formTransferFromId.value = s.template.accountId ?? "";
    formTransferToId.value = s.template.transferTo ?? "";
    formComment.value = s.template.comment ?? "";
    formRepeatUnit.value = s.repeat.unit as typeof formRepeatUnit.value;
    formRepeatValue.value = s.repeat.value;
    formEnabled.value = s.enabled !== false;
    showForm.value = true;
}

async function saveForm() {
    const bid = selectedBookId.value?.trim();
    const uid = getUid();
    if (!bid || !uid) return;

    if (!formTitle.value.trim()) {
        showToast("请输入标题");
        return;
    }
    const raw = Number(formAmountStr.value.replace(/,/g, "").trim());
    if (!Number.isFinite(raw) || raw <= 0) {
        showToast("请输入有效金额");
        return;
    }
    if (!isValidNumberForAmount(raw)) {
        showToast("金额精度超出范围");
        return;
    }

    const template: Scheduled["template"] = {
        type: billType.value,
        categoryId:
            billType.value === "transfer"
                ? TransferPresetCategory.id
                : formCategoryId.value,
        comment: formComment.value.trim() || undefined,
        amount: numberToAmount(raw),
        time: Date.now(),
        accountId:
            billType.value === "transfer"
                ? formTransferFromId.value
                : formAccountId.value,
        transferTo:
            billType.value === "transfer"
                ? formTransferToId.value
                : undefined,
    };

    const entry: Scheduled = {
        id: editingId.value ?? uuidv4(),
        title: formTitle.value.trim(),
        start: Date.now(),
        template,
        enabled: formEnabled.value,
        repeat: {
            unit: formRepeatUnit.value,
            value: formRepeatValue.value,
        },
        latest: undefined,
    };

    const existing = scheduleds.value.filter(
        (s) => s.id !== entry.id,
    );
    const newList = [...existing, entry];

    showLoadingToast({ message: "保存中...", forbidClick: true, duration: 0 });
    try {
        await saveScheduleds(ep, bid, uid, newList);
        scheduleds.value = newList;
        closeToast();
        showToast("已保存");
        showForm.value = false;
    } catch (e: unknown) {
        closeToast();
        showToast(e instanceof Error ? e.message : "保存失败");
    }
}

async function toggleEnabled(s: Scheduled) {
    const bid = selectedBookId.value?.trim();
    const uid = getUid();
    if (!bid || !uid) return;
    s.enabled = !s.enabled;
    showLoadingToast({ message: "保存中...", forbidClick: true, duration: 0 });
    try {
        await saveScheduleds(ep, bid, uid, scheduleds.value);
        closeToast();
    } catch {
        closeToast();
        showToast("保存失败");
    }
}

async function deleteScheduled(s: Scheduled) {
    try {
        await showConfirmDialog({
            title: "删除周期记账",
            message: `确定删除「${s.title}」吗？`,
            confirmButtonColor: "#ee0a24",
        });
    } catch {
        return;
    }
    const bid = selectedBookId.value?.trim();
    const uid = getUid();
    if (!bid || !uid) return;
    const newList = scheduleds.value.filter((x) => x.id !== s.id);
    showLoadingToast({ message: "删除中...", forbidClick: true, duration: 0 });
    try {
        await saveScheduleds(ep, bid, uid, newList);
        scheduleds.value = newList;
        closeToast();
        showToast("已删除");
    } catch {
        closeToast();
        showToast("删除失败");
    }
}

function accountName(id: string): string {
    return accounts.value.find((a) => a.id === id)?.name ?? "未选择";
}

function typeLabel(type: string): string {
    if (type === "expense") return "支出";
    if (type === "income") return "收入";
    return "转账";
}

function fmtAmount(amount: number): string {
    return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: "CNY",
        minimumFractionDigits: 2,
    }).format(amountToNumber(amount));
}
</script>

<template>
    <div class="sched-page">
        <van-nav-bar
            title="周期记账"
            left-arrow
            @click-left="router.back()"
        />

        <div class="sched-content">
            <div v-if="loading" class="sched-loading">
                <van-loading size="24" />
            </div>

            <div v-else-if="scheduleds.length === 0" class="sched-empty">
                <p class="sched-empty__title">还没有周期记账</p>
                <p class="sched-empty__hint">
                    设置每月房租、工资等固定收支，自动生成。
                </p>
            </div>

            <div v-else class="sched-list">
                <div
                    v-for="s in scheduleds"
                    :key="s.id"
                    class="sched-card"
                    :class="{ 'sched-card--disabled': !s.enabled }"
                >
                    <div class="sched-card__head" @click="openEdit(s)">
                        <div class="sched-card__info">
                            <span class="sched-card__title">{{
                                s.title
                            }}</span>
                            <span class="sched-card__meta">
                                {{ typeLabel(s.template.type) }} ·
                                {{ fmtAmount(s.template.amount) }} ·
                                {{ s.repeat.value > 1 ? s.repeat.value : ''
                                }}{{
                                    { day: '天', week: '周', month: '月', year: '年' }[
                                        s.repeat.unit
                                    ] || '月'
                                }}
                            </span>
                        </div>
                        <van-switch
                            :model-value="s.enabled !== false"
                            size="22"
                            @change="toggleEnabled(s)"
                        />
                    </div>
                    <div class="sched-card__actions">
                        <button
                            type="button"
                            class="sched-card__btn"
                            @click="openEdit(s)"
                        >
                            编辑
                        </button>
                        <button
                            type="button"
                            class="sched-card__btn sched-card__btn--del"
                            @click="deleteScheduled(s)"
                        >
                            删除
                        </button>
                    </div>
                </div>
            </div>

            <div class="sched-add">
                <van-button
                    type="primary"
                    block
                    round
                    @click="openCreate"
                >
                    新建周期记账
                </van-button>
            </div>
        </div>

        <van-popup
            v-model:show="showForm"
            position="bottom"
            round
            safe-area-inset-bottom
            class="sched-form-popup"
        >
            <div class="sched-form">
                <div class="sched-form__head">
                    <button
                        type="button"
                        class="sched-form__cancel"
                        @click="showForm = false"
                    >
                        取消
                    </button>
                    <span class="sched-form__title">
                        {{ editingId ? '编辑' : '新建' }}周期记账
                    </span>
                    <button
                        type="button"
                        class="sched-form__save"
                        @click="saveForm"
                    >
                        保存
                    </button>
                </div>

                <div class="sched-form__body">
                    <van-cell-group inset>
                        <van-field
                            v-model="formTitle"
                            label="标题"
                            placeholder="如：房租、工资"
                            maxlength="20"
                        />
                    </van-cell-group>

                    <van-tabs
                        v-model:active="formTypeTab"
                        type="card"
                        class="sched-form__tabs"
                    >
                        <van-tab title="支出" />
                        <van-tab title="收入" />
                        <van-tab title="转账" />
                    </van-tabs>

                    <van-cell-group inset>
                        <van-field
                            v-model="formAmountStr"
                            label="金额"
                            type="number"
                            inputmode="decimal"
                            placeholder="0.00"
                        />
                        <van-cell
                            v-if="billType !== 'transfer'"
                            title="分类"
                            :value="
                                categoriesPick.find(
                                    (c) => c.id === formCategoryId,
                                )?.name ?? '请选择'
                            "
                            is-link
                        />
                        <van-cell
                            v-if="billType !== 'transfer'"
                            title="账户"
                            :value="accountName(formAccountId)"
                            is-link
                        />
                        <van-cell
                            v-if="billType === 'transfer'"
                            title="转出"
                            :value="accountName(formTransferFromId)"
                            is-link
                        />
                        <van-cell
                            v-if="billType === 'transfer'"
                            title="转入"
                            :value="accountName(formTransferToId)"
                            is-link
                        />
                        <van-field
                            v-model="formComment"
                            label="备注"
                            placeholder="可选"
                            maxlength="100"
                        />
                    </van-cell-group>

                    <van-cell-group inset>
                        <van-cell title="重复周期">
                            <template #value>
                                <div class="sched-form__repeat">
                                    <select
                                        v-model="formRepeatUnit"
                                        class="sched-form__select"
                                    >
                                        <option value="day">每天</option>
                                        <option value="week">每周</option>
                                        <option value="month">每月</option>
                                        <option value="year">每年</option>
                                    </select>
                                    <span class="sched-form__repeat-label">
                                        每
                                    </span>
                                    <input
                                        v-model.number="formRepeatValue"
                                        type="number"
                                        min="1"
                                        max="99"
                                        class="sched-form__repeat-input"
                                    />
                                    <span class="sched-form__repeat-label">
                                        {{
                                            {
                                                day: '天',
                                                week: '周',
                                                month: '月',
                                                year: '年',
                                            }[formRepeatUnit]
                                        }}
                                    </span>
                                </div>
                            </template>
                        </van-cell>
                    </van-cell-group>
                </div>
            </div>
        </van-popup>
    </div>
</template>

<style scoped>
.sched-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ledger-paper);
    font-family: var(--ledger-font-ui);
}

.sched-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.sched-loading {
    display: flex;
    justify-content: center;
    padding: 60px 0;
}

.sched-empty {
    text-align: center;
    padding: 60px 24px;
}

.sched-empty__title {
    margin: 0 0 8px;
    font-family: var(--ledger-font-display);
    font-size: 1.2rem;
    font-weight: 400;
}

.sched-empty__hint {
    margin: 0;
    font-size: 13px;
    color: var(--ledger-ink-muted);
    line-height: 1.5;
}

.sched-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.sched-card {
    border-radius: 16px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.1);
    background: var(--ledger-paper-elevated);
    overflow: hidden;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset;
}

.sched-card--disabled {
    opacity: 0.55;
}

.sched-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    cursor: pointer;
}

.sched-card__info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.sched-card__title {
    font-size: 15px;
    font-weight: 700;
    color: var(--ledger-ink);
}

.sched-card__meta {
    font-size: 12px;
    color: var(--ledger-ink-muted);
}

.sched-card__actions {
    display: flex;
    border-top: 1px solid rgba(var(--ledger-accent-rgb), 0.06);
}

.sched-card__btn {
    flex: 1;
    border: none;
    background: transparent;
    padding: 11px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ledger-accent-deep);
    cursor: pointer;
}

.sched-card__btn:active {
    background: rgba(var(--ledger-accent-rgb), 0.06);
}

.sched-card__btn--del {
    color: #c53030;
    border-left: 1px solid rgba(var(--ledger-accent-rgb), 0.06);
}

.sched-add {
    margin-top: auto;
    padding: 12px 0;
}

.sched-form-popup :deep(.van-popup__content) {
    height: 85%;
    max-height: 640px;
    border-radius: 20px 20px 0 0;
    background: var(--ledger-paper);
}

.sched-form {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.sched-form__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(var(--ledger-accent-rgb), 0.08);
}

.sched-form__cancel,
.sched-form__save {
    border: none;
    background: transparent;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 8px;
}

.sched-form__cancel {
    color: var(--ledger-ink-muted);
}

.sched-form__save {
    color: var(--ledger-accent-deep);
}

.sched-form__title {
    font-family: var(--ledger-font-display);
    font-size: 18px;
    font-weight: 400;
}

.sched-form__body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.sched-form__tabs {
    padding: 0 16px;
}

.sched-form__tabs :deep(.van-tabs__nav--card) {
    border-radius: 12px;
}

.sched-form__repeat {
    display: flex;
    align-items: center;
    gap: 6px;
}

.sched-form__select {
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.15);
    border-radius: 8px;
    padding: 4px 8px;
    font: inherit;
    font-size: 14px;
    background: var(--ledger-paper);
    color: var(--ledger-ink);
}

.sched-form__repeat-input {
    width: 48px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.15);
    border-radius: 8px;
    padding: 4px 8px;
    font: inherit;
    font-size: 14px;
    text-align: center;
    background: var(--ledger-paper);
    color: var(--ledger-ink);
}

.sched-form__repeat-label {
    font-size: 14px;
    color: var(--ledger-ink-muted);
}
</style>
```

Note: The category and account pickers in the form are simplified (using `van-cell` display only, no popup picker) to keep the scope manageable. The user can see which category/account is selected but would need to extend the form with pickers for full editing. This is intentional — the core CRUD flow works, and pickers can be added incrementally.

- [ ] **Step 2: Verify build**

Run: `pnpm lint`
Expected: PASS

---

### Task 9: Add route and profile navigation

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/pages/profile/Profile.vue`

- [ ] **Step 1: Add scheduled route**

In `src/router/index.ts`, add a new child route under the main layout children:

```ts
{
    path: "profile/scheduled",
    name: "profile-scheduled",
    component: () =>
        import(
            "@/pages/profile/scheduled/ScheduledManage.vue"
        ),
},
```

- [ ] **Step 2: Add profile navigation cell**

In `src/pages/profile/Profile.vue`, add a new `van-cell` after the "账户显示顺序" cell:

```html
<van-cell
    title="周期记账"
    label="自动记录固定收支"
    is-link
    @click="router.push({ name: 'profile-scheduled' })"
/>
```

- [ ] **Step 3: Integrate scheduled processing on app entry**

In `src/composables/use-entry-book-sync.ts`, add imports at the top:

```ts
import { processScheduleds, loadScheduleds } from "@/composables/use-scheduled";
import { LoginAPI } from "@/api/endpoints/gitee";
```

Then after line 25 (`entryReady.value = true;`), insert:

```ts
            // Auto-generate scheduled transactions
            const uid = LoginAPI.getLocalToken()?.accessToken;
            if (uid) {
                try {
                    const scheduleds = await loadScheduleds(ep, bookId, uid);
                    if (scheduleds.length > 0) {
                        const count = await processScheduleds(ep, bookId, uid, scheduleds);
                        if (count > 0) {
                            showToast(`自动生成了 ${count} 笔周期记账`);
                        }
                    }
                } catch {
                    /* non-critical, ignore */
                }
            }
```

- [ ] **Step 4: Add hideShellHeader for scheduled route**

In `src/layouts/MainLayout.vue`, update the `hideShellHeader` computed (line 19-23) to also hide for the scheduled route:

```ts
const hideShellHeader = computed(
    () =>
        route.name === "profile-categories" ||
        route.name === "profile-account-order" ||
        route.name === "profile-scheduled",
);
```

- [ ] **Step 5: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/composables/use-scheduled.ts src/pages/profile/scheduled/ScheduledManage.vue src/router/index.ts src/pages/profile/Profile.vue src/composables/use-entry-book-sync.ts src/layouts/MainLayout.vue
git commit -m "feat: scheduled (recurring) transactions with auto-generation"
```

---

## Summary

| Phase | Feature | Tasks | Files Changed |
|-------|---------|-------|---------------|
| 1 | Transaction Editing | 2 | RecordTransactionSheet.vue, MainLayout.vue, Home.vue |
| 2 | History Browsing | 2 | useHistoryRange.ts (new), Home.vue |
| 3 | Search/Filter | 2 | useTxFilter.ts (new), Home.vue |
| 4 | Scheduled Transactions | 3 | useScheduled.ts (new), ScheduledManage.vue (new), router, Profile.vue, use-entry-book-sync.ts, MainLayout.vue |

**Total: 9 tasks, ~1800 lines of new/modified code.**

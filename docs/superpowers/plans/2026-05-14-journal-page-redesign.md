# 账本页面重新设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the journal page by removing the overview section, consolidating filters into a popup, and adding account info to transaction cards.

**Architecture:** Two files change: `use-tx-filter.ts` gains date range and creator filters, `Home.vue` removes the date nav + hero section, adds account display to cards, and extends the filter popup with a `van-calendar` and user chips.

**Tech Stack:** Vue 3 (`<script setup>` + TypeScript), Vant 4 (`van-calendar`, `van-popup`), dayjs

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/composables/use-tx-filter.ts` | Add `dateStart`, `dateEnd`, `creatorIds` to `TxFilters`; add filtering logic |
| Modify | `src/pages/home/Home.vue` | Remove date nav + hero, add account display to cards, extend filter popup |

---

### Task 1: Extend useTxFilter with date range and creator filters

**Files:**
- Modify: `src/composables/use-tx-filter.ts`

- [ ] **Step 1: Add new filter fields to TxFilters type**

Replace the `TxFilters` type (lines 6-12) with:

```ts
export type TxFilters = {
    keyword: string;
    minAmount: number | null;
    maxAmount: number | null;
    types: BillType[];
    categoryIds: string[];
    dateStart: number | null;
    dateEnd: number | null;
    creatorIds: string[];
};
```

- [ ] **Step 2: Update default filters in useTxFilter**

Replace the `filters` ref initialization (lines 15-21) with:

```ts
const filters = ref<TxFilters>({
    keyword: "",
    minAmount: null,
    maxAmount: null,
    types: [],
    categoryIds: [],
    dateStart: null,
    dateEnd: null,
    creatorIds: [],
});
```

- [ ] **Step 3: Update hasActiveFilters computed**

Replace the `hasActiveFilters` computed (lines 23-32) with:

```ts
const hasActiveFilters = computed(() => {
    const f = filters.value;
    return (
        f.keyword.trim() !== "" ||
        f.minAmount !== null ||
        f.maxAmount !== null ||
        f.types.length > 0 ||
        f.categoryIds.length > 0 ||
        f.dateStart !== null ||
        f.dateEnd !== null ||
        f.creatorIds.length > 0
    );
});
```

- [ ] **Step 4: Add date range and creator filtering logic**

In the `filteredRows` computed (after the existing `categoryIds` filter block, before `return rows;`), add:

```ts
if (f.dateStart !== null) {
    rows = rows.filter((tx) => tx.time >= f.dateStart!);
}
if (f.dateEnd !== null) {
    rows = rows.filter((tx) => tx.time < f.dateEnd!);
}

if (f.creatorIds.length > 0) {
    const creatorSet = new Set(f.creatorIds);
    rows = rows.filter((tx) => creatorSet.has(String(tx.creatorId)));
}
```

- [ ] **Step 5: Update resetFilters**

Replace the `resetFilters` function (lines 67-75) with:

```ts
function resetFilters() {
    filters.value = {
        keyword: "",
        minAmount: null,
        maxAmount: null,
        types: [],
        categoryIds: [],
        dateStart: null,
        dateEnd: null,
        creatorIds: [],
    };
}
```

- [ ] **Step 6: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/composables/use-tx-filter.ts
git commit -m "feat(filter): add date range and creator filters to useTxFilter"
```

---

### Task 2: Remove date navigation and hero section from Home.vue

**Files:**
- Modify: `src/pages/home/Home.vue`

- [ ] **Step 1: Remove useHistoryRange import and usage**

In `<script setup>`, remove the import of `useHistoryRange` and `RangeUnit` (lines 12-15):

```ts
import {
    type RangeUnit,
    useHistoryRange,
} from "@/composables/use-history-range";
```

Remove the `history` variable (line 26):

```ts
const history = useHistoryRange();
```

- [ ] **Step 2: Add default date filtering for "today"**

Replace the `allRangeRows` computed (lines 48-54) with a simpler version that defaults to today:

```ts
const todayStart = computed(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).valueOf();
});

const todayEnd = computed(() => {
    return todayStart.value + 24 * 60 * 60 * 1000;
});

const allRangeRows = computed(() => {
    const f = txFilter.filters.value;
    // If date filters are set, they take precedence
    if (f.dateStart !== null || f.dateEnd !== null) {
        return bills.value
            .filter((b) => {
                if (f.dateStart !== null && b.time < f.dateStart) return false;
                if (f.dateEnd !== null && b.time >= f.dateEnd) return false;
                return true;
            })
            .sort((a, b) => b.time - a.time);
    }
    // Default: today
    return bills.value
        .filter((b) => b.time >= todayStart.value && b.time < todayEnd.value)
        .sort((a, b) => b.time - a.time);
});
```

- [ ] **Step 3: Update visibleRows to use the new allRangeRows**

The `visibleRows` computed (lines 58-63) stays the same — it already delegates to `txFilter.filteredRows` when filters are active, and `allRangeRows` otherwise.

- [ ] **Step 4: Remove perCreatorHero computed and related functions**

Remove the `TodayHeroRow` type (lines 66-72), `creatorLabelFromKey` function (lines 74-84), and `perCreatorHero` computed (lines 86-127).

- [ ] **Step 5: Update section title logic**

Replace the section title text (line 333) from:

```ts
{{ history.isToday.value && !txFilter.hasActiveFilters.value ? '今日流水' : `流水 · ${visibleRows.length} 条` }}
```

To:

```ts
{{ txFilter.hasActiveFilters.value ? `流水 · ${visibleRows.length} 条` : '今日流水' }}
```

- [ ] **Step 6: Remove date navigation and hero template blocks**

Remove the entire `<div class="journal-scroll-head">` block (lines 257-315) which contains the date nav and hero card. This includes:
- `.journal-date-nav` (prev/next buttons + date label)
- `.journal-range-tabs` (day/week/month tabs)
- `.journal-kicker` and `.journal-hero__note`
- `.journal-hero-empty` / `.journal-stats-by-user` (the stats table)

- [ ] **Step 7: Remove unused CSS for removed sections**

Remove these CSS classes that are no longer used:
- `.journal-scroll-head`
- `.journal-hero` and all `.journal-hero__*` classes
- `.journal-date-nav` and all `.journal-date-nav__*` classes
- `.journal-range-tabs` and `.journal-range-tab` classes
- `.journal-kicker`
- `.journal-hero-empty` and `.journal-hero-empty__*`
- `.journal-stats-by-user` and all `.journal-stats-by-user__*` classes
- `.journal-atmosphere` and all `.journal-atmosphere__*` classes (decorative orbs, no longer needed without hero)
- `@keyframes journal-float`

- [ ] **Step 8: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/pages/home/Home.vue
git commit -m "feat(home): remove date navigation and hero overview section"
```

---

### Task 3: Add account display to transaction cards

**Files:**
- Modify: `src/pages/home/Home.vue`

- [ ] **Step 1: Add accounts data ref and load it**

In `<script setup>`, add the Account type import and a new ref:

```ts
import type { Account } from "@/database/tables/account";
```

Add a new ref alongside `bills`, `usersList`, `metaCategories` (line 30-31):

```ts
const accountsList = ref<Full<Account>[]>([]);
```

In `refreshData` (lines 210-221), add accounts to the fetch:

```ts
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
```

- [ ] **Step 2: Add account name lookup helper**

After the `creatorLabel` function (line 142), add:

```ts
function accountName(accountId: string): string {
    return accountsList.value.find((a) => a.id === accountId)?.name ?? "";
}
```

- [ ] **Step 3: Add account line to transaction card template**

In the template, inside the `.journal-row__card` div, after the `.journal-row__what` paragraph (line 387) and before the `.journal-row__money` paragraph (line 388), add:

```html
<div v-if="tx.type !== 'transfer' && tx.accountId" class="journal-row__account">
    <span class="journal-row__account-tag">{{ accountName(tx.accountId) }}</span>
</div>
<div v-else-if="tx.type === 'transfer' && (tx.accountId || tx.transferTo)" class="journal-row__account">
    <span v-if="tx.accountId" class="journal-row__account-tag">{{ accountName(tx.accountId) }}</span>
    <span v-if="tx.accountId && tx.transferTo" class="journal-row__account-arrow">→</span>
    <span v-if="tx.transferTo" class="journal-row__account-tag">{{ accountName(tx.transferTo) }}</span>
</div>
```

- [ ] **Step 4: Add CSS for account tags**

Add these CSS rules after `.journal-row__what` (around line 1038):

```css
.journal-row__account {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
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
```

- [ ] **Step 5: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pages/home/Home.vue
git commit -m "feat(home): show account info on transaction cards"
```

---

### Task 4: Extend filter popup with calendar and user chips

**Files:**
- Modify: `src/pages/home/Home.vue`

- [ ] **Step 1: Add van-calendar import and state**

In `<script setup>`, add the calendar state refs after `showFilterSheet` (line 46):

```ts
const showCalendar = ref(false);
const calendarValue = ref<[number, number] | null>(null);
```

Add calendar handlers:

```ts
function onCalendarConfirm({ selectedDates }: { selectedDates: Date[] }) {
    if (selectedDates.length >= 2) {
        const start = selectedDates[0].valueOf();
        const end = selectedDates[1].valueOf() + 24 * 60 * 60 * 1000; // end of selected day
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
```

- [ ] **Step 2: Add usersList to filter popup for member selection**

The `usersList` ref already exists (line 30). Add a helper for member display name:

```ts
function memberName(creatorId: string): string {
    const u = usersList.value.find((x) => String(x.id) === creatorId);
    return u?.nickname?.trim() || `成员 …${creatorId.slice(-4)}`;
}
```

- [ ] **Step 3: Add date range and user filter sections to filter popup template**

In the filter popup template, before the keyword field (before line 433), add:

```html
<div class="filter-field">
    <label class="filter-field__label">日期范围</label>
    <button type="button" class="filter-field__input" style="text-align: left; cursor: pointer;" @click="showCalendar = true">
        {{ dateRangeLabel() || '点击选择日期范围' }}
    </button>
    <button v-if="txFilter.filters.value.dateStart !== null" type="button" class="filter-field__clear" @click="txFilter.filters.value.dateStart = null; txFilter.filters.value.dateEnd = null; calendarValue = null">清除</button>
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
```

- [ ] **Step 4: Add van-calendar component to template**

After the filter popup's closing `</van-popup>` (after line 467), add:

```html
<van-calendar
    v-model:show="showCalendar"
    type="range"
    :default-calendar-value="calendarValue ? [new Date(calendarValue[0]), new Date(calendarValue[1] - 24 * 60 * 60 * 1000)] : undefined"
    @confirm="onCalendarConfirm"
/>
```

- [ ] **Step 5: Add CSS for clear button**

Add after `.filter-field__sep` (around line 1184):

```css
.filter-field__clear {
    border: none;
    background: transparent;
    color: var(--ledger-ink-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 6px;
}
```

- [ ] **Step 6: Update resetFilters to also clear calendar state**

In the filter popup's reset button click handler, add calendar state clearing. Change the reset button (line 430) to:

```html
<button type="button" class="filter-panel__reset" @click="txFilter.resetFilters(); calendarValue = null">重置</button>
```

- [ ] **Step 7: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/pages/home/Home.vue
git commit -m "feat(home): add calendar date range and user filters to filter popup"
```

---

### Task 5: Clean up unused code

**Files:**
- Modify: `src/pages/home/Home.vue`

- [ ] **Step 1: Remove unused imports**

Check and remove any unused imports after the previous changes. Likely candidates:
- `useHistoryRange` and `RangeUnit` (already removed in Task 2)
- `amountToNumber` — still used in `amountLabel`, keep it

- [ ] **Step 2: Verify build**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/home/Home.vue
git commit -m "chore(home): clean up unused imports"
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Extend useTxFilter with date range and creator filters | `use-tx-filter.ts` |
| 2 | Remove date navigation and hero section | `Home.vue` |
| 3 | Add account display to transaction cards | `Home.vue` |
| 4 | Extend filter popup with calendar and user chips | `Home.vue` |
| 5 | Clean up unused code | `Home.vue` |

**Total: 5 tasks, ~2 files modified.**

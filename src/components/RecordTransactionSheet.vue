<script setup lang="ts">
import { v4 as uuidv4 } from "uuid";
import { showToast } from "vant";
import { computed, ref, watch } from "vue";
import { LoginAPI } from "@/api/endpoints/gitee";
import { mergeCategoriesForType } from "@/composables/use-ledger-meta";
import { useSync } from "@/composables/use-sync";
import type { Full } from "@/database/stash";
import type { Account } from "@/database/tables/account";
import type { Transaction } from "@/database/tables/transaction";
import {
    accountColorForDisplay,
    accountIconForDisplay,
} from "@/ledger/account-display";
import { applyAccountDisplayOrder } from "@/ledger/account-order";
import {
    amountToNumber,
    isValidNumberForAmount,
    numberToAmount,
} from "@/ledger/bill";
import { TransferPresetCategory } from "@/ledger/category-zh-presets";
import type { PersonalMeta } from "@/ledger/extra-type";
import type { BillCategory, BillType } from "@/ledger/type";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
    "update:show": [v: boolean];
    submitted: [];
}>();

const { ep, selectedBookId } = useSync();

const typeTab = ref(0);
const amountStr = ref("");
const categoryId = ref("");
const accountId = ref("");
const transferFromId = ref("");
const transferToId = ref("");
const comment = ref("");

const accounts = ref<Full<Account>[]>([]);
/** 与资产页一致：meta.personal[用户].accountDisplayOrder */
const ledgerAccountOrder = ref<string[] | undefined>(undefined);
const metaCategories = ref<BillCategory[]>([]);

const showCategoryPicker = ref(false);
const showAccountPicker = ref(false);
const showFromPicker = ref(false);
const showToPicker = ref(false);
const categoryFilter = ref("");

const moneyFmt = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** 高于主「记一笔」弹层，便于次级弹层叠在主弹层之上 */
const PICK_POPUP_Z_INDEX = 3100;

/** 账户列表来自异步接口；加载完成前打开选择器会无内容且 flex 区域易塌陷 */
const accountsLoading = ref(false);

const billType = computed<BillType>(() => {
    if (typeTab.value === 0) return "expense";
    if (typeTab.value === 1) return "income";
    return "transfer";
});

const categoriesPick = computed(() =>
    mergeCategoriesForType(billType.value, metaCategories.value),
);

const filteredCategoriesPick = computed(() => {
    const q = categoryFilter.value.trim().toLowerCase();
    const list = categoriesPick.value;
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
});

const categoryLabel = computed(() => {
    const c = categoriesPick.value.find((x) => x.id === categoryId.value);
    return c?.name ?? "请选择";
});

function accountName(id: string) {
    return accounts.value.find((a) => a.id === id)?.name ?? "请选择";
}

function formatAccountBalance(raw?: number) {
    return moneyFmt.format(amountToNumber(raw ?? 0));
}

const amountHint = computed(() => {
    if (billType.value === "expense") return "支出金额";
    if (billType.value === "income") return "收入金额";
    return "转账金额";
});

watch(showCategoryPicker, (open) => {
    if (open) categoryFilter.value = "";
});

/** 账户选择列表顺序：用户自定义优先，否则按余额降序（与资产页一致） */
const sortedAccountsForPicker = computed(() => {
    const list = accounts.value;
    const ord = ledgerAccountOrder.value;
    if (ord !== undefined && ord.length > 0) {
        return applyAccountDisplayOrder(list, ord);
    }
    return [...list].sort(
        (a, b) => (b.initialBalance ?? 0) - (a.initialBalance ?? 0),
    );
});

async function loadContext() {
    const bid = selectedBookId.value?.trim();
    if (!bid) {
        accountsLoading.value = false;
        return;
    }
    accountsLoading.value = true;
    try {
        const [accList, meta] = await Promise.all([
            ep.tableGetAllItems<Account>(bid, "accounts"),
            ep.getLedgerMeta(bid),
        ]);
        accounts.value = accList;
        const uid = LoginAPI.getLocalToken()?.accessToken;
        if (uid) {
            ledgerAccountOrder.value = (
                meta.personal as Record<string, PersonalMeta> | undefined
            )?.[uid]?.accountDisplayOrder;
        } else {
            ledgerAccountOrder.value = undefined;
        }
        if (accList.length === 0) {
            showToast({
                message: "请先在「资产」页添加账户后再记账",
                duration: 2500,
            });
        }
        metaCategories.value = Array.isArray(meta.categories)
            ? (meta.categories as BillCategory[])
            : [];
        const pick = mergeCategoriesForType(
            billType.value,
            metaCategories.value,
        );
        if (!pick.some((c) => c.id === categoryId.value)) {
            categoryId.value = pick[0]?.id ?? "";
        }
    } catch {
        showToast("加载账户或分类失败");
    } finally {
        accountsLoading.value = false;
    }
}

watch(
    () => props.show,
    (v) => {
        if (v) {
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
                transferToId.value = ordered.length >= 2 ? ordered[1].id : "";
            });
        }
    },
);

watch(typeTab, () => {
    const pick = mergeCategoriesForType(billType.value, metaCategories.value);
    categoryId.value = pick[0]?.id ?? "";
});

function close() {
    emit("update:show", false);
}

async function submit() {
    const bid = selectedBookId.value?.trim();
    if (!bid) {
        showToast("未选择账本");
        return;
    }
    const raw = Number(amountStr.value.replace(/,/g, "").trim());
    if (!Number.isFinite(raw) || raw <= 0) {
        showToast("请输入有效金额");
        return;
    }
    if (!isValidNumberForAmount(raw)) {
        showToast("金额精度超出范围");
        return;
    }
    const token = LoginAPI.getLocalToken()?.accessToken;
    if (!token) {
        showToast("未登录");
        return;
    }

    if (billType.value === "transfer") {
        if (!transferFromId.value || !transferToId.value) {
            showToast("请选择转出与转入账户");
            return;
        }
        if (transferFromId.value === transferToId.value) {
            showToast("转出与转入不能相同");
            return;
        }
    } else {
        if (!accountId.value) {
            showToast("请选择账户");
            return;
        }
        if (!categoryId.value) {
            showToast("请选择分类");
            return;
        }
    }

    const txId = uuidv4();
    const amount = numberToAmount(raw);
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

    let row: Transaction;
    if (billType.value === "transfer") {
        row = {
            ...base,
            accountId: transferFromId.value,
            transferTo: transferToId.value,
        };
    } else {
        row = {
            ...base,
            accountId: accountId.value,
        };
    }

    try {
        await ep.tableBatch<Transaction>(bid, "transactions", [
            {
                type: "update",
                value: row,
            },
        ]);
        await ep.toSync();
        showToast("已记账");
        emit("submitted");
        close();
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? "保存失败");
        showToast(msg);
    }
}

function onPickCategory(cat: BillCategory) {
    categoryId.value = cat.id;
    showCategoryPicker.value = false;
}

function categoryIcon(c: BillCategory): string {
    return c.icon?.trim() ? c.icon : "apps-o";
}

function categorySwatch(c: BillCategory): string {
    return c.color?.trim() ? c.color : "var(--ledger-ink-muted)";
}

function pickAccount(id: string, which: "single" | "from" | "to") {
    if (which === "single") accountId.value = id;
    if (which === "from") transferFromId.value = id;
    if (which === "to") transferToId.value = id;
    showAccountPicker.value = false;
    showFromPicker.value = false;
    showToPicker.value = false;
}

function blurSheetFocus() {
    if (typeof document === "undefined") {
        return;
    }
    const el = document.activeElement;
    if (el instanceof HTMLElement) {
        el.blur();
    }
}

function openCategoryPicker() {
    blurSheetFocus();
    showCategoryPicker.value = true;
}

function openAccountPicker() {
    blurSheetFocus();
    showAccountPicker.value = true;
}

function openFromPickerFn() {
    blurSheetFocus();
    showFromPicker.value = true;
}

function openToPickerFn() {
    blurSheetFocus();
    showToPicker.value = true;
}
</script>

<template>
    <van-popup
        :show="show"
        position="bottom"
        round
        :style="{ height: '92%', maxHeight: '720px' }"
        safe-area-inset-bottom
        class="record-sheet-popup"
        @update:show="emit('update:show', $event)"
    >
        <div :class="['sheet', `sheet--kind-${typeTab}`]">
            <div class="sheet__grab" aria-hidden="true" />
            <div class="sheet__glow" aria-hidden="true" />

            <div class="sheet__header">
                <button type="button" class="sheet__cancel" @click="close">
                    取消
                </button>
                <div class="sheet__title-block">
                    <span class="sheet__title">记一笔</span>
                    <span class="sheet__subtitle">快速记录 · 自动同步</span>
                </div>
                <span class="sheet__header-spacer" aria-hidden="true" />
            </div>

            <van-tabs
                v-model:active="typeTab"
                type="card"
                class="sheet__tabs"
                :lazy-render="false"
            >
                <van-tab title="支出" />
                <van-tab title="收入" />
                <van-tab title="转账" />
            </van-tabs>

            <div class="sheet__body">
                <section class="sheet-amount" :aria-label="amountHint">
                    <span class="sheet-amount__label">{{ amountHint }}</span>
                    <div class="sheet-amount__row">
                        <span class="sheet-amount__currency" aria-hidden="true">¥</span>
                        <input
                            v-model="amountStr"
                            class="sheet-amount__input"
                            type="text"
                            inputmode="decimal"
                            enterkeyhint="done"
                            autocomplete="off"
                            placeholder="0.00"
                            aria-label="金额"
                        />
                    </div>
                </section>

                <section
                    v-if="billType !== 'transfer'"
                    class="sheet-card sheet-card--pick"
                    aria-label="分类与账户"
                >
                    <h3 class="sheet-card__heading">分类与账户</h3>
                    <van-cell-group class="sheet-picker-group" :border="false">
                        <van-cell
                            title="分类"
                            :value="categoryLabel"
                            is-link
                            class="sheet-picker-cell"
                            @click.stop="openCategoryPicker"
                        />
                        <van-cell
                            title="账户"
                            :value="accountName(accountId)"
                            is-link
                            class="sheet-picker-cell"
                            @click.stop="openAccountPicker"
                        />
                    </van-cell-group>
                </section>

                <section
                    v-else
                    class="sheet-card sheet-card--pick"
                    aria-label="转账方向"
                >
                    <h3 class="sheet-card__heading">转账方向</h3>
                    <van-cell-group class="sheet-picker-group" :border="false">
                        <van-cell
                            title="转出"
                            :value="accountName(transferFromId)"
                            is-link
                            class="sheet-picker-cell"
                            @click.stop="openFromPickerFn"
                        />
                        <van-cell
                            title="转入"
                            :value="accountName(transferToId)"
                            is-link
                            class="sheet-picker-cell"
                            @click.stop="openToPickerFn"
                        />
                    </van-cell-group>
                </section>

                <section class="sheet-card sheet-card--note" aria-label="备注">
                    <h3 class="sheet-card__heading">备注</h3>
                    <van-field
                        v-model="comment"
                        type="textarea"
                        rows="2"
                        autosize
                        maxlength="200"
                        show-word-limit
                        placeholder="想记点什么…"
                        class="sheet-field sheet-field--textarea"
                    />
                </section>
            </div>

            <div class="sheet__footer">
                <van-button
                    type="primary"
                    block
                    round
                    class="sheet__submit"
                    @click="submit"
                >
                    保存到账本
                </van-button>
            </div>
        </div>
    </van-popup>

    <van-popup
        v-model:show="showCategoryPicker"
        position="bottom"
        round
        safe-area-inset-bottom
        class="sheet-pick-popup"
        :z-index="PICK_POPUP_Z_INDEX"
    >
        <div class="pick-panel">
            <div class="pick-panel__chrome">
                <span class="pick-panel__grab" aria-hidden="true" />
                <div class="pick-panel__head">
                    <h2 class="pick-panel__title">选择分类</h2>
                    <button
                        type="button"
                        class="pick-panel__done"
                        @click="showCategoryPicker = false"
                    >
                        完成
                    </button>
                </div>
                <label class="pick-panel__search">
                    <van-icon name="search" class="pick-panel__search-icon" />
                    <input
                        v-model="categoryFilter"
                        type="search"
                        enterkeyhint="search"
                        class="pick-panel__search-input"
                        placeholder="搜索分类名称"
                        autocomplete="off"
                        autocorrect="off"
                    />
                </label>
            </div>
            <div class="sheet-pick-scroll">
                <p
                    v-if="filteredCategoriesPick.length === 0"
                    class="pick-panel__empty"
                >
                    没有匹配的分类，试试别的关键词
                </p>
                <div
                    v-else
                    class="sheet-pick-grid"
                    role="listbox"
                    aria-label="分类"
                >
                    <button
                        v-for="c in filteredCategoriesPick"
                        :key="c.id"
                        type="button"
                        class="sheet-pick-tile"
                        :class="{
                            'sheet-pick-tile--active': c.id === categoryId,
                        }"
                        role="option"
                        :aria-selected="c.id === categoryId"
                        @click="onPickCategory(c)"
                    >
                        <span
                            class="sheet-pick-icon sheet-pick-icon--category"
                            :style="{ color: categorySwatch(c) }"
                        >
                            <van-icon :name="categoryIcon(c)" size="22" />
                        </span>
                        <span class="sheet-pick-name">{{ c.name }}</span>
                    </button>
                </div>
            </div>
        </div>
    </van-popup>

    <van-popup
        v-model:show="showAccountPicker"
        position="bottom"
        round
        safe-area-inset-bottom
        class="sheet-pick-popup"
        :z-index="PICK_POPUP_Z_INDEX"
    >
        <div class="pick-panel">
            <div class="pick-panel__chrome">
                <span class="pick-panel__grab" aria-hidden="true" />
                <div class="pick-panel__head">
                    <h2 class="pick-panel__title">选择账户</h2>
                    <button
                        type="button"
                        class="pick-panel__done"
                        @click="showAccountPicker = false"
                    >
                        完成
                    </button>
                </div>
                <p class="pick-panel__hint">
                    顺序与「资产」页一致；余额仅供参考
                </p>
            </div>
            <div class="sheet-pick-scroll sheet-pick-scroll--accounts">
                <p
                    v-if="accountsLoading"
                    class="pick-panel__empty pick-panel__empty--muted"
                >
                    正在加载账户…
                </p>
                <p
                    v-else-if="sortedAccountsForPicker.length === 0"
                    class="pick-panel__empty"
                >
                    暂无账户，请先到「资产」页添加后再记账。
                </p>
                <div
                    v-else
                    class="sheet-pick-grid"
                    role="listbox"
                    aria-label="账户"
                >
                    <button
                        v-for="a in sortedAccountsForPicker"
                        :key="a.id"
                        type="button"
                        class="sheet-pick-tile sheet-pick-tile--account"
                        :class="{ 'sheet-pick-tile--active': a.id === accountId }"
                        role="option"
                        :aria-selected="a.id === accountId"
                        @click="pickAccount(a.id, 'single')"
                    >
                        <span
                            class="sheet-pick-icon sheet-pick-icon--account"
                            :style="{
                                background: accountColorForDisplay(a),
                            }"
                        >
                            <van-icon
                                :name="accountIconForDisplay(a)"
                                size="22"
                                color="#fff"
                            />
                        </span>
                        <span class="sheet-pick-name">{{ a.name }}</span>
                        <span class="sheet-pick-meta">{{
                            formatAccountBalance(a.initialBalance)
                        }}</span>
                    </button>
                </div>
            </div>
        </div>
    </van-popup>

    <van-popup
        v-model:show="showFromPicker"
        position="bottom"
        round
        safe-area-inset-bottom
        class="sheet-pick-popup"
        :z-index="PICK_POPUP_Z_INDEX"
    >
        <div class="pick-panel">
            <div class="pick-panel__chrome">
                <span class="pick-panel__grab" aria-hidden="true" />
                <div class="pick-panel__head">
                    <h2 class="pick-panel__title">转出账户</h2>
                    <button
                        type="button"
                        class="pick-panel__done"
                        @click="showFromPicker = false"
                    >
                        完成
                    </button>
                </div>
            </div>
            <div class="sheet-pick-scroll sheet-pick-scroll--accounts">
                <p
                    v-if="accountsLoading"
                    class="pick-panel__empty pick-panel__empty--muted"
                >
                    正在加载账户…
                </p>
                <p
                    v-else-if="sortedAccountsForPicker.length === 0"
                    class="pick-panel__empty"
                >
                    暂无账户，请先到「资产」页添加后再记账。
                </p>
                <div
                    v-else
                    class="sheet-pick-grid"
                    role="listbox"
                    aria-label="转出账户"
                >
                    <button
                        v-for="a in sortedAccountsForPicker"
                        :key="a.id"
                        type="button"
                        class="sheet-pick-tile sheet-pick-tile--account"
                        :class="{
                            'sheet-pick-tile--active': a.id === transferFromId,
                        }"
                        role="option"
                        :aria-selected="a.id === transferFromId"
                        @click="pickAccount(a.id, 'from')"
                    >
                        <span
                            class="sheet-pick-icon sheet-pick-icon--account"
                            :style="{
                                background: accountColorForDisplay(a),
                            }"
                        >
                            <van-icon
                                :name="accountIconForDisplay(a)"
                                size="22"
                                color="#fff"
                            />
                        </span>
                        <span class="sheet-pick-name">{{ a.name }}</span>
                        <span class="sheet-pick-meta">{{
                            formatAccountBalance(a.initialBalance)
                        }}</span>
                    </button>
                </div>
            </div>
        </div>
    </van-popup>

    <van-popup
        v-model:show="showToPicker"
        position="bottom"
        round
        safe-area-inset-bottom
        class="sheet-pick-popup"
        :z-index="PICK_POPUP_Z_INDEX"
    >
        <div class="pick-panel">
            <div class="pick-panel__chrome">
                <span class="pick-panel__grab" aria-hidden="true" />
                <div class="pick-panel__head">
                    <h2 class="pick-panel__title">转入账户</h2>
                    <button
                        type="button"
                        class="pick-panel__done"
                        @click="showToPicker = false"
                    >
                        完成
                    </button>
                </div>
            </div>
            <div class="sheet-pick-scroll sheet-pick-scroll--accounts">
                <p
                    v-if="accountsLoading"
                    class="pick-panel__empty pick-panel__empty--muted"
                >
                    正在加载账户…
                </p>
                <p
                    v-else-if="sortedAccountsForPicker.length === 0"
                    class="pick-panel__empty"
                >
                    暂无账户，请先到「资产」页添加后再记账。
                </p>
                <div
                    v-else
                    class="sheet-pick-grid"
                    role="listbox"
                    aria-label="转入账户"
                >
                    <button
                        v-for="a in sortedAccountsForPicker"
                        :key="a.id"
                        type="button"
                        class="sheet-pick-tile sheet-pick-tile--account"
                        :class="{
                            'sheet-pick-tile--active': a.id === transferToId,
                        }"
                        role="option"
                        :aria-selected="a.id === transferToId"
                        @click="pickAccount(a.id, 'to')"
                    >
                        <span
                            class="sheet-pick-icon sheet-pick-icon--account"
                            :style="{
                                background: accountColorForDisplay(a),
                            }"
                        >
                            <van-icon
                                :name="accountIconForDisplay(a)"
                                size="22"
                                color="#fff"
                            />
                        </span>
                        <span class="sheet-pick-name">{{ a.name }}</span>
                        <span class="sheet-pick-meta">{{
                            formatAccountBalance(a.initialBalance)
                        }}</span>
                    </button>
                </div>
            </div>
        </div>
    </van-popup>
</template>

<style scoped>
.record-sheet-popup :deep(.van-popup__content) {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 20px 20px 0 0;
    background: linear-gradient(
        165deg,
        rgba(255, 254, 251, 0.98) 0%,
        var(--ledger-paper-deep) 48%,
        var(--ledger-paper) 100%
    );
}

.sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    font-family: var(--ledger-font-ui);
    isolation: isolate;
}

.sheet__grab {
    width: 36px;
    height: 4px;
    margin: 8px auto 0;
    border-radius: 999px;
    background: rgba(28, 25, 23, 0.12);
    flex-shrink: 0;
}

.sheet__glow {
    pointer-events: none;
    position: absolute;
    inset: 0 0 auto 0;
    height: 120px;
    background: radial-gradient(
        ellipse 90% 80% at 50% -20%,
        rgba(var(--ledger-accent-rgb), 0.09) 0%,
        transparent 65%
    );
    z-index: 0;
}

.sheet__header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 8px 14px 10px;
    gap: 8px;
}

.sheet__cancel {
    border: none;
    background: rgba(255, 254, 251, 0.55);
    font-size: 15px;
    font-weight: 600;
    color: var(--ledger-ink-muted);
    padding: 8px 12px;
    margin: -4px 0 0 -8px;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s ease;
}

.sheet__cancel:active {
    background: rgba(var(--ledger-accent-rgb), 0.08);
}

.sheet__title-block {
    flex: 1;
    min-width: 0;
    text-align: center;
}

.sheet__title {
    display: block;
    font-family: var(--ledger-font-display);
    font-weight: 400;
    font-size: 22px;
    letter-spacing: -0.02em;
    line-height: 1.2;
    color: var(--ledger-ink);
}

.sheet__subtitle {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ledger-ink-faint);
}

.sheet__header-spacer {
    width: 56px;
    flex-shrink: 0;
}

.sheet__tabs {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    padding: 4px 14px 0;
}

.sheet__tabs :deep(.van-tabs__wrap) {
    overflow: visible;
}

/* 仅用作支出/收入/转账切换，无面板内容；避免空面板占位或盖住下方「账户」行 */
.sheet__tabs :deep(.van-tabs__content) {
    height: 0;
    min-height: 0;
    overflow: hidden;
}

.sheet__tabs :deep(.van-tabs__nav--card) {
    width: 100%;
    margin: 0;
    border-radius: 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.16);
    background: rgba(255, 254, 251, 0.72);
    backdrop-filter: blur(8px);
}

.sheet__tabs :deep(.van-tab--card) {
    flex: 1 1 0;
    min-width: 0;
    padding: 13px 8px;
    border-radius: 11px;
    font-size: 15px;
    font-weight: 700;
    color: var(--ledger-ink-muted);
    transition:
        color 0.18s ease,
        background 0.18s ease;
}

/* 选中态：支出 / 收入 / 转账 语义色 */
.sheet--kind-0 :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-warm) 0%,
        #7c2d12 100%
    );
    box-shadow: 0 8px 18px -10px rgba(var(--ledger-warm-rgb), 0.65);
}

.sheet--kind-1 :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-income) 0%,
        #14532d 100%
    );
    box-shadow: 0 8px 18px -10px rgba(22, 101, 52, 0.45);
}

.sheet--kind-2 :deep(.van-tab--card.van-tab--active) {
    color: #fff;
    background: linear-gradient(
        145deg,
        var(--ledger-accent) 0%,
        var(--ledger-accent-deep) 100%
    );
    box-shadow: 0 8px 18px -10px rgba(var(--ledger-accent-rgb), 0.55);
}

.sheet__body {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    /* 底部留白：避免备注输入框被固定「保存」按钮与渐变区盖住（需可滚动露出） */
    padding: 14px 14px
        calc(20px + 74px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    scroll-padding-bottom: calc(12px + 74px + env(safe-area-inset-bottom, 0px));
}

/*
 * PWA / standalone 视口更矮时，flex 子项默认 flex-shrink:1 会把底部「备注」压成 0 高度；
 * 浏览器宽屏下空间充足不易察觉。禁止主内容块收缩，由 overflow-y 滚动承载超出部分。
 */
.sheet__body > * {
    flex-shrink: 0;
}

.sheet-amount {
    padding: 18px 18px 20px;
    border-radius: 18px;
    border: 1px solid rgba(28, 25, 23, 0.06);
    background: var(--ledger-paper-card);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.88) inset,
        0 18px 40px -28px var(--ledger-shadow-ink);
}

.sheet-amount__label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ledger-ink-subtle);
    margin-bottom: 10px;
}

.sheet-amount__row {
    display: flex;
    align-items: baseline;
    gap: 6px;
}

.sheet-amount__currency {
    font-family: var(--ledger-font-display);
    font-size: 28px;
    font-weight: 400;
    color: var(--ledger-ink-faint);
    line-height: 1;
    padding-bottom: 4px;
}

.sheet-amount__input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    font-family: var(--ledger-font-display);
    font-size: clamp(2rem, 9vw, 2.75rem);
    font-weight: 400;
    letter-spacing: -0.03em;
    line-height: 1.05;
    color: var(--ledger-ink);
    caret-color: var(--ledger-accent);
}

.sheet-amount__input::placeholder {
    color: var(--ledger-ink-faint);
    opacity: 0.65;
}

.sheet-amount__input:focus {
    outline: none;
}

.sheet-card {
    border-radius: 16px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.1);
    background: rgba(255, 254, 251, 0.85);
    overflow: hidden;
}

/* 分类/账户等多行 Cell：hidden 在部分手机 WebKit 下会裁掉第二行 */
.sheet-card--pick {
    position: relative;
    z-index: 1;
    overflow: visible;
}

.sheet-card--note {
    position: relative;
    /* 与 pick 同级即可；备注区不再叠高层级，避免个别 WebView 叠层异常 */
    border-style: dashed;
    border-color: rgba(28, 25, 23, 0.1);
    background: rgba(255, 254, 251, 0.55);
}

.sheet-card__heading {
    margin: 0;
    padding: 12px 14px 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--ledger-ink-muted);
}

.sheet-field :deep(.van-field__label) {
    width: 3.2em;
    color: var(--ledger-ink-muted);
    font-weight: 600;
}

.sheet-field :deep(.van-field__control) {
    font-weight: 600;
    color: var(--ledger-ink);
}

.sheet-field :deep(.van-cell) {
    padding: 14px 16px;
    background: transparent;
}

.sheet-field :deep(.van-cell::after) {
    left: 16px;
    right: 16px;
}

.sheet-field--textarea :deep(.van-field__body) {
    padding-top: 4px;
}

.sheet-field--textarea :deep(.van-field__control) {
    min-height: 56px;
    font-weight: 500;
    line-height: 1.45;
}

.sheet__footer {
    flex-shrink: 0;
    /* 顶侧略加间距；底侧在浏览器（无安全区）时让保存按钮离视口下沿更远，PWA 仍叠加 safe-area */
    padding: 14px 16px calc(18px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(250, 246, 240, 0.92) 28%
    );
}

.sheet__submit {
    height: 50px;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.04em;
    box-shadow: 0 12px 28px -14px rgba(var(--ledger-accent-rgb), 0.85);
}

.sheet-pick-popup :deep(.van-popup__content) {
    padding: 0;
    padding-bottom: env(safe-area-inset-bottom, 12px);
    border-radius: 20px 20px 0 0;
    background: var(--ledger-paper);
    max-height: min(72vh, 520px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.pick-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
}

.pick-panel__chrome {
    flex-shrink: 0;
    padding: 8px 14px 10px;
    border-bottom: 1px solid rgba(var(--ledger-accent-rgb), 0.08);
    background: linear-gradient(
        180deg,
        rgba(255, 254, 251, 0.97) 0%,
        var(--ledger-paper) 100%
    );
}

.pick-panel__grab {
    display: block;
    width: 36px;
    height: 4px;
    margin: 0 auto 10px;
    border-radius: 999px;
    background: rgba(28, 25, 23, 0.12);
}

.pick-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
}

.pick-panel__title {
    margin: 0;
    font-family: var(--ledger-font-display);
    font-size: 20px;
    font-weight: 400;
    color: var(--ledger-ink);
}

.pick-panel__done {
    flex-shrink: 0;
    border: none;
    padding: 8px 14px;
    border-radius: 999px;
    background: rgba(var(--ledger-accent-rgb), 0.12);
    color: var(--ledger-accent-deep);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
}

.pick-panel__done:active {
    background: rgba(var(--ledger-accent-rgb), 0.2);
}

.pick-panel__hint {
    margin: 0 0 4px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ledger-ink-subtle);
}

.pick-panel__search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.12);
    background: rgba(255, 254, 251, 0.9);
}

.pick-panel__search-icon {
    flex-shrink: 0;
    font-size: 18px;
    color: var(--ledger-ink-faint);
}

.pick-panel__search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    font: inherit;
    font-size: 16px;
    color: var(--ledger-ink);
}

.pick-panel__search-input::placeholder {
    color: var(--ledger-ink-faint);
}

.pick-panel__search-input:focus {
    outline: none;
}

.pick-panel__empty {
    margin: 24px 12px;
    text-align: center;
    font-size: 14px;
    color: var(--ledger-ink-subtle);
    line-height: 1.5;
}

.pick-panel__empty--muted {
    color: var(--ledger-ink-faint);
}

.sheet-picker-group {
    margin: 0;
    overflow: visible;
    border-radius: 0 0 14px 14px;
}

.sheet-picker-group :deep(.van-cell) {
    padding: 14px 16px;
    background: transparent;
}

.sheet-picker-group :deep(.van-cell__title) {
    flex: none;
    width: 3.2em;
    font-weight: 600;
    color: var(--ledger-ink-muted);
}

.sheet-picker-group :deep(.van-cell__value) {
    font-weight: 600;
    color: var(--ledger-ink);
}

.sheet-picker-group :deep(.van-cell__right-icon) {
    color: var(--ledger-ink-muted);
}

.sheet-pick-scroll--accounts {
    min-height: min(42vh, 280px);
}

.sheet-pick-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 12px 14px 8px;
}

.sheet-pick-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px 8px;
}

.sheet-pick-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    min-width: 0;
    margin: 0;
    padding: 10px 4px 8px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.14);
    border-radius: 14px;
    background: var(--ledger-paper-elevated);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.78) inset;
    font: inherit;
    color: var(--ledger-ink);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
        border-color 0.15s ease,
        background 0.15s ease,
        transform 0.1s ease,
        box-shadow 0.15s ease;
}

.sheet-pick-tile--account {
    gap: 4px;
    padding-bottom: 10px;
}

.sheet-pick-tile:active {
    transform: scale(0.97);
}

.sheet-pick-tile--active {
    border-color: rgba(var(--ledger-accent-rgb), 0.55);
    background: rgba(var(--ledger-accent-rgb), 0.09);
    box-shadow:
        0 0 0 1px rgba(var(--ledger-accent-rgb), 0.15),
        0 10px 22px -16px rgba(var(--ledger-accent-rgb), 0.35);
}

.sheet-pick-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 13px;
    flex-shrink: 0;
}

.sheet-pick-icon--category {
    background: rgba(var(--ledger-accent-rgb), 0.06);
}

.sheet-pick-tile--active .sheet-pick-icon--category {
    background: rgba(var(--ledger-accent-rgb), 0.14);
}

.sheet-pick-icon--account {
    color: #fff;
    box-shadow: 0 6px 14px -6px rgba(0, 0, 0, 0.45);
}

.sheet-pick-name {
    width: 100%;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    word-break: break-all;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.sheet-pick-meta {
    width: 100%;
    font-size: 9px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--ledger-ink-subtle);
    line-height: 1.2;
}
</style>

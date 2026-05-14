<script setup lang="ts">
import { v4 as uuidv4 } from "uuid";
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
import { loadScheduleds, saveScheduleds } from "@/composables/use-scheduled";
import { useSync } from "@/composables/use-sync";
import type { Full } from "@/database/stash";
import type { Account } from "@/database/tables/account";
import {
    amountToNumber,
    isValidNumberForAmount,
    numberToAmount,
} from "@/ledger/bill";
import { TransferPresetCategory } from "@/ledger/category-zh-presets";
import type { Scheduled } from "@/ledger/extra-type";
import type { BillCategory, BillType } from "@/ledger/type";

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
            billType.value === "transfer" ? formTransferToId.value : undefined,
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

    const existing = scheduleds.value.filter((s) => s.id !== entry.id);
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

const repeatLabels: Record<string, string> = {
    day: "天",
    week: "周",
    month: "月",
    year: "年",
};
</script>

<template>
    <div class="sched-page">
        <van-nav-bar title="周期记账" left-arrow @click-left="router.back()" />

        <div class="sched-content">
            <div v-if="loading" class="sched-loading">
                <van-loading size="24" />
            </div>

            <div v-else-if="scheduleds.length === 0" class="sched-empty">
                <p class="sched-empty__title">还没有周期记账</p>
                <p class="sched-empty__hint">设置每月房租、工资等固定收支，自动生成。</p>
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
                            <span class="sched-card__title">{{ s.title }}</span>
                            <span class="sched-card__meta">
                                {{ typeLabel(s.template.type) }} ·
                                {{ fmtAmount(s.template.amount) }} ·
                                {{ s.repeat.value > 1 ? s.repeat.value : '' }}{{ repeatLabels[s.repeat.unit] || '月' }}
                            </span>
                        </div>
                        <van-switch
                            :model-value="s.enabled !== false"
                            size="22"
                            @change="toggleEnabled(s)"
                        />
                    </div>
                    <div class="sched-card__actions">
                        <button type="button" class="sched-card__btn" @click="openEdit(s)">编辑</button>
                        <button type="button" class="sched-card__btn sched-card__btn--del" @click="deleteScheduled(s)">删除</button>
                    </div>
                </div>
            </div>

            <div class="sched-add">
                <van-button type="primary" block round @click="openCreate">新建周期记账</van-button>
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
                    <button type="button" class="sched-form__cancel" @click="showForm = false">取消</button>
                    <span class="sched-form__title">{{ editingId ? '编辑' : '新建' }}周期记账</span>
                    <button type="button" class="sched-form__save" @click="saveForm">保存</button>
                </div>

                <div class="sched-form__body">
                    <van-cell-group inset>
                        <van-field v-model="formTitle" label="标题" placeholder="如：房租、工资" maxlength="20" />
                    </van-cell-group>

                    <van-tabs v-model:active="formTypeTab" type="card" class="sched-form__tabs">
                        <van-tab title="支出" />
                        <van-tab title="收入" />
                        <van-tab title="转账" />
                    </van-tabs>

                    <van-cell-group inset>
                        <van-field v-model="formAmountStr" label="金额" type="number" inputmode="decimal" placeholder="0.00" />
                        <van-cell
                            v-if="billType !== 'transfer'"
                            title="分类"
                            :value="categoriesPick.find((c) => c.id === formCategoryId)?.name ?? '请选择'"
                            is-link
                        />
                        <van-cell
                            v-if="billType !== 'transfer'"
                            title="账户"
                            :value="accountName(formAccountId)"
                            is-link
                        />
                        <van-cell v-if="billType === 'transfer'" title="转出" :value="accountName(formTransferFromId)" is-link />
                        <van-cell v-if="billType === 'transfer'" title="转入" :value="accountName(formTransferToId)" is-link />
                        <van-field v-model="formComment" label="备注" placeholder="可选" maxlength="100" />
                    </van-cell-group>

                    <van-cell-group inset>
                        <van-cell title="重复周期">
                            <template #value>
                                <div class="sched-form__repeat">
                                    <select v-model="formRepeatUnit" class="sched-form__select">
                                        <option value="day">每天</option>
                                        <option value="week">每周</option>
                                        <option value="month">每月</option>
                                        <option value="year">每年</option>
                                    </select>
                                    <span class="sched-form__repeat-label">每</span>
                                    <input v-model.number="formRepeatValue" type="number" min="1" max="99" class="sched-form__repeat-input" />
                                    <span class="sched-form__repeat-label">{{ repeatLabels[formRepeatUnit] }}</span>
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

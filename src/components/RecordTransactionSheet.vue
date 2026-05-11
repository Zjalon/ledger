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
import { isValidNumberForAmount, numberToAmount } from "@/ledger/bill";
import { TransferPresetCategory } from "@/ledger/category-zh-presets";
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
const metaCategories = ref<BillCategory[]>([]);

const showCategoryPicker = ref(false);
const showAccountPicker = ref(false);
const showFromPicker = ref(false);
const showToPicker = ref(false);

const billType = computed<BillType>(() => {
    if (typeTab.value === 0) return "expense";
    if (typeTab.value === 1) return "income";
    return "transfer";
});

const categoriesPick = computed(() =>
    mergeCategoriesForType(billType.value, metaCategories.value),
);

const categoryLabel = computed(() => {
    const c = categoriesPick.value.find((x) => x.id === categoryId.value);
    return c?.name ?? "请选择";
});

function accountName(id: string) {
    return accounts.value.find((a) => a.id === id)?.name ?? "请选择";
}

async function loadContext() {
    const bid = selectedBookId.value?.trim();
    if (!bid) return;
    try {
        const [accList, meta] = await Promise.all([
            ep.tableGetAllItems<Account>(bid, "accounts"),
            ep.getLedgerMeta(bid),
        ]);
        accounts.value = accList;
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
                if (accounts.value.length === 1) {
                    accountId.value = accounts.value[0].id;
                }
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

function pickAccount(id: string, which: "single" | "from" | "to") {
    if (which === "single") accountId.value = id;
    if (which === "from") transferFromId.value = id;
    if (which === "to") transferToId.value = id;
    showAccountPicker.value = false;
    showFromPicker.value = false;
    showToPicker.value = false;
}
</script>

<template>
    <van-popup
        :show="show"
        position="bottom"
        round
        :style="{ height: '88%', maxHeight: '640px' }"
        safe-area-inset-bottom
        @update:show="emit('update:show', $event)"
    >
        <div class="sheet">
            <div class="sheet__header">
                <button type="button" class="sheet__cancel" @click="close">
                    取消
                </button>
                <span class="sheet__title">记一笔</span>
                <span class="sheet__placeholder" aria-hidden="true" />
            </div>

            <van-tabs v-model:active="typeTab" shrink type="card" class="sheet__tabs">
                <van-tab title="支出" />
                <van-tab title="收入" />
                <van-tab title="转账" />
            </van-tabs>

            <div class="sheet__body">
                <van-field
                    v-model="amountStr"
                    label="金额"
                    type="number"
                    placeholder="0.00"
                    input-align="right"
                />

                <template v-if="billType !== 'transfer'">
                    <van-field
                        :model-value="categoryLabel"
                        label="分类"
                        readonly
                        is-link
                        input-align="right"
                        placeholder="请选择"
                        @click="showCategoryPicker = true"
                    />
                    <van-field
                        :model-value="accountName(accountId)"
                        label="账户"
                        readonly
                        is-link
                        input-align="right"
                        placeholder="请选择"
                        @click="showAccountPicker = true"
                    />
                </template>

                <template v-else>
                    <van-field
                        :model-value="accountName(transferFromId)"
                        label="转出"
                        readonly
                        is-link
                        input-align="right"
                        placeholder="请选择"
                        @click="showFromPicker = true"
                    />
                    <van-field
                        :model-value="accountName(transferToId)"
                        label="转入"
                        readonly
                        is-link
                        input-align="right"
                        placeholder="请选择"
                        @click="showToPicker = true"
                    />
                </template>

                <van-field
                    v-model="comment"
                    label="备注"
                    type="textarea"
                    rows="2"
                    autosize
                    maxlength="200"
                    show-word-limit
                    placeholder="选填"
                />
            </div>

            <div class="sheet__footer">
                <van-button type="primary" block round @click="submit">
                    保存
                </van-button>
            </div>
        </div>
    </van-popup>

    <van-popup
            v-model:show="showCategoryPicker"
            position="bottom"
            round
            safe-area-inset-bottom
        >
            <div class="pick-head">选择分类</div>
            <van-cell-group inset>
                <van-cell
                    v-for="c in categoriesPick"
                    :key="c.id"
                    :title="c.name"
                    clickable
                    @click="onPickCategory(c)"
                />
            </van-cell-group>
        </van-popup>

        <van-popup
            v-model:show="showAccountPicker"
            position="bottom"
            round
            safe-area-inset-bottom
        >
            <div class="pick-head">选择账户</div>
            <van-cell-group inset>
                <van-cell
                    v-for="a in accounts"
                    :key="a.id"
                    :title="a.name"
                    clickable
                    @click="pickAccount(a.id, 'single')"
                />
            </van-cell-group>
        </van-popup>

        <van-popup
            v-model:show="showFromPicker"
            position="bottom"
            round
            safe-area-inset-bottom
        >
            <div class="pick-head">转出账户</div>
            <van-cell-group inset>
                <van-cell
                    v-for="a in accounts"
                    :key="a.id"
                    :title="a.name"
                    clickable
                    @click="pickAccount(a.id, 'from')"
                />
            </van-cell-group>
        </van-popup>

        <van-popup
            v-model:show="showToPicker"
            position="bottom"
            round
            safe-area-inset-bottom
        >
            <div class="pick-head">转入账户</div>
            <van-cell-group inset>
                <van-cell
                    v-for="a in accounts"
                    :key="a.id"
                    :title="a.name"
                    clickable
                    @click="pickAccount(a.id, 'to')"
                />
            </van-cell-group>
        </van-popup>
</template>

<style scoped>
.sheet {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    font-family: var(--cent-font-ui);
}
.sheet__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
    border-bottom: 1px solid rgba(var(--cent-accent-rgb), 0.08);
}
.sheet__cancel {
    border: none;
    background: none;
    font-size: 15px;
    color: var(--cent-ink-muted);
    padding: 4px 8px;
    cursor: pointer;
}
.sheet__title {
    font-weight: 700;
    font-size: 16px;
    color: var(--cent-ink);
}
.sheet__placeholder {
    width: 48px;
}
.sheet__tabs {
    flex-shrink: 0;
    padding: 8px 12px 0;
}
.sheet__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 0 16px;
}
.sheet__footer {
    flex-shrink: 0;
    padding: 12px 16px 16px;
}
.pick-head {
    padding: 14px 16px 8px;
    font-weight: 600;
    font-size: 14px;
    color: var(--cent-ink-muted);
}
</style>

<script setup lang="ts">
import Sortable from "sortablejs";
import { showToast } from "vant";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { LoginAPI } from "@/api/endpoints/gitee";
import { useSync } from "@/composables/use-sync";
import { useCurrentUser } from "@/composables/useCurrentUser";
import type { Full } from "@/database/stash";
import type { Account } from "@/database/tables/account";
import {
    applyAccountDisplayOrder,
    mergeMetaPersonal,
    normalizeAccountDisplayOrder,
} from "@/ledger/account-order";
import { amountToNumber } from "@/ledger/bill";
import type { PersonalMeta } from "@/ledger/extra-type";

const router = useRouter();
const { ep, selectedBookId } = useSync();
const { user } = useCurrentUser();

const listEl = ref<HTMLElement | null>(null);
const orderedAccounts = ref<Full<Account>[]>([]);
const displayOrder = ref<string[]>([]);

let sortable: Sortable | null = null;
let unsub: (() => void) | undefined;

const fmt = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const currentUserId = computed(
    () => user.value?.id ?? LoginAPI.getLocalToken()?.accessToken ?? "",
);

function balanceLabel(raw?: number): string {
    return fmt.format(amountToNumber(raw ?? 0));
}

async function loadData() {
    const bid = selectedBookId.value?.trim();
    const uid = currentUserId.value;
    if (!bid || !uid) {
        orderedAccounts.value = [];
        displayOrder.value = [];
        return;
    }
    try {
        const [accs, meta] = await Promise.all([
            ep.tableGetAllItems<Account>(bid, "accounts"),
            ep.getLedgerMeta(bid),
        ]);
        const personal = (
            meta.personal as Record<string, PersonalMeta> | undefined
        )?.[uid];
        const order = normalizeAccountDisplayOrder(
            accs,
            personal?.accountDisplayOrder,
        );
        displayOrder.value = order;
        orderedAccounts.value = applyAccountDisplayOrder(accs, order);
    } catch {
        showToast("加载失败");
    }
}

async function persist() {
    const bid = selectedBookId.value?.trim();
    const uid = currentUserId.value;
    if (!bid || !uid) {
        return;
    }
    try {
        const meta = await ep.getLedgerMeta(bid);
        const prevPersonal =
            (meta.personal as Record<string, PersonalMeta> | undefined) ?? {};
        const merged = mergeMetaPersonal(prevPersonal, uid, {
            accountDisplayOrder: [...displayOrder.value],
        });
        await ep.patchLedgerMeta(bid, { personal: merged });
        await ep.toSync();
        showToast("排序已保存");
    } catch {
        showToast("保存失败");
    }
}

function destroySortable() {
    sortable?.destroy();
    sortable = null;
}

function initSortable() {
    destroySortable();
    const el = listEl.value;
    if (!el || orderedAccounts.value.length === 0) {
        return;
    }
    sortable = Sortable.create(el, {
        animation: 200,
        handle: ".acc-order-grip",
        delay: 0,
        scroll: true,
        bubbleScroll: true,
        ghostClass: "acc-sort-ghost",
        chosenClass: "acc-sort-chosen",
        dragClass: "acc-sort-drag",
        onEnd(evt) {
            const oi = evt.oldIndex;
            const ni = evt.newIndex;
            if (oi == null || ni == null || oi === ni) {
                return;
            }
            const next = [...orderedAccounts.value];
            const [moved] = next.splice(oi, 1);
            next.splice(ni, 0, moved);
            orderedAccounts.value = next;
            displayOrder.value = next.map((a) => a.id);
            destroySortable();
            void persist();
            void nextTick(() => {
                initSortable();
            });
        },
    });
}

async function reloadListAndSortable() {
    await loadData();
    await nextTick();
    initSortable();
}

onMounted(async () => {
    await reloadListAndSortable();
    unsub = ep.onChange(async ({ bookId }) => {
        if (bookId === selectedBookId.value?.trim()) {
            destroySortable();
            await reloadListAndSortable();
        }
    });
});

onUnmounted(() => {
    destroySortable();
    unsub?.();
});

watch([selectedBookId, currentUserId], () => {
    void reloadListAndSortable();
});
</script>

<template>
    <div class="acc-order-page">
        <van-nav-bar
            title="账户显示顺序"
            left-arrow
            fixed
            placeholder
            safe-area-inset-top
            @click-left="router.back()"
        />

        <div class="acc-order-main">
            <p class="acc-order-hint">
                按住左侧「≡」图标拖动可调整顺序；列表区域可上下滑动。仅影响你在「资产」页的列表，多人账本各自独立。
            </p>

            <div class="acc-order-scroll">
                <div
                    v-if="orderedAccounts.length > 0"
                    ref="listEl"
                    class="acc-order-list"
                >
                    <div
                        v-for="acc in orderedAccounts"
                        :key="acc.id"
                        class="acc-order-row"
                    >
                        <van-icon name="bars" class="acc-order-grip" />
                        <div class="acc-order-body">
                            <p class="acc-order-name">{{ acc.name }}</p>
                            <p class="acc-order-balance">
                                {{ balanceLabel(acc.initialBalance) }}
                            </p>
                        </div>
                    </div>
                </div>
                <van-empty
                    v-else
                    class="acc-order-empty"
                    description="暂无账户，请到「资产」页添加"
                />
            </div>
        </div>
    </div>
</template>

<style scoped>
.acc-order-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding-bottom: 24px;
    font-family: var(--ledger-font-ui);
    color: var(--ledger-ink);
    background: var(--ledger-paper);
}

.acc-order-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.acc-order-scroll {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
}

.acc-order-hint {
    flex-shrink: 0;
    margin: 12px 16px 14px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ledger-ink-muted);
}

.acc-order-list {
    margin: 0 16px 20px;
    border-radius: 14px;
    border: 1px solid rgba(var(--ledger-accent-rgb), 0.12);
    background: var(--ledger-paper-elevated);
    box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.82) inset,
        0 12px 32px -24px var(--ledger-shadow-ink);
}

.acc-order-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(28, 25, 23, 0.06);
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
}

.acc-order-row:last-child {
    border-bottom: none;
}

.acc-order-grip {
    flex-shrink: 0;
    font-size: 18px;
    color: var(--ledger-ink-faint);
    padding: 8px 10px;
    margin: -8px 0 -8px -6px;
    touch-action: none;
    cursor: grab;
}

.acc-order-grip:active {
    cursor: grabbing;
}

.acc-order-body {
    flex: 1;
    min-width: 0;
}

.acc-order-name {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
    color: var(--ledger-ink);
}

.acc-order-balance {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--ledger-ink-muted);
    font-variant-numeric: tabular-nums;
}

.acc-order-empty {
    padding: 32px 16px;
}
</style>

<style>
/* Sortable 挂载在列表 DOM 上，类名需全局生效 */
.acc-sort-ghost {
    opacity: 0.5;
    background: rgba(45, 106, 79, 0.12);
}

.acc-sort-chosen {
    background: rgba(45, 106, 79, 0.08);
}
</style>

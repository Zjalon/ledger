<script setup lang="ts">
import { v4 as uuidv4 } from "uuid";
import { showConfirmDialog, showToast } from "vant";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
    isUserCategory,
    mergeCategoriesForType,
} from "@/composables/use-ledger-meta";
import { useSync } from "@/composables/use-sync";
import {
    presetCategoryIds,
    ZhExpensePresets,
    ZhIncomePresets,
} from "@/ledger/category-zh-presets";
import type { BillCategory } from "@/ledger/type";

const route = useRoute();
const router = useRouter();
const { ep, selectedBookId } = useSync();

const kind = computed(() => {
    const k = route.params.kind as string;
    return k === "income" ? "income" : "expense";
});

const title = computed(() =>
    kind.value === "expense" ? "支出分类" : "收入分类",
);

/** 仅存自定义分类；保存时写回 meta.categories */
const customOnly = ref<BillCategory[]>([]);

const mergedList = computed(() =>
    mergeCategoriesForType(kind.value, customOnly.value),
);

const showAdd = ref(false);
const newName = ref("");

async function load() {
    const bid = selectedBookId.value?.trim();
    if (!bid) return;
    try {
        const meta = await ep.getLedgerMeta(bid);
        const raw = meta.categories;
        customOnly.value = Array.isArray(raw)
            ? (raw as BillCategory[]).filter(
                  (c) => isUserCategory(c) || !presetCategoryIds.has(c.id),
              )
            : [];
    } catch {
        showToast("加载分类失败");
    }
}

onMounted(() => void load());

watch(
    () => route.params.kind,
    () => {
        void load();
    },
);

function presetSource() {
    return kind.value === "expense" ? ZhExpensePresets : ZhIncomePresets;
}

async function persist(nextCustom: BillCategory[]) {
    const bid = selectedBookId.value?.trim();
    if (!bid) return;
    customOnly.value = nextCustom;
    await ep.patchLedgerMeta(bid, {
        categories: nextCustom.map((c) => ({
            ...c,
            customName: true as const,
        })),
    });
    await ep.toSync();
}

async function removeItem(cat: BillCategory) {
    if (!isUserCategory(cat) && presetCategoryIds.has(cat.id)) {
        showToast("内置分类不可删除");
        return;
    }
    try {
        await showConfirmDialog({
            title: "删除分类",
            message: `确定删除「${cat.name}」？`,
        });
    } catch {
        return;
    }
    const next = customOnly.value.filter((c) => c.id !== cat.id);
    try {
        await persist(next);
        showToast("已删除");
    } catch {
        showToast("删除失败");
    }
}

async function confirmAdd() {
    const name = newName.value.trim();
    if (!name) {
        showToast("请输入名称");
        return;
    }
    const cat: BillCategory = {
        id: `uc-${uuidv4()}`,
        name,
        type: kind.value,
        icon: "records",
        color: "#2d6a4f",
        customName: true,
    };
    try {
        await persist([...customOnly.value, cat]);
        showAdd.value = false;
        newName.value = "";
        showToast("已添加");
    } catch {
        showToast("保存失败");
    }
}
</script>

<template>
    <div class="cat-page">
        <van-nav-bar
            :title="title"
            left-arrow
            fixed
            placeholder
            safe-area-inset-top
            @click-left="router.back()"
        />

        <div class="cat-hint">
            以下为内置分类与你在本账本新增的自定义分类。自定义项会同步到
            Gitee。内置分类不可删除。
        </div>

        <van-cell-group inset>
            <van-cell
                v-for="c in mergedList"
                :key="c.id"
                :title="c.name"
                center
            >
                <template v-if="presetSource().some((p) => p.id === c.id)">
                    <span class="cat-tag cat-tag--preset">内置</span>
                </template>
                <template v-else>
                    <van-button
                        size="mini"
                        plain
                        type="danger"
                        @click="removeItem(c)"
                    >
                        删除
                    </van-button>
                </template>
            </van-cell>
        </van-cell-group>

        <div class="cat-add">
            <van-button type="primary" block round @click="showAdd = true">
                添加自定义分类
            </van-button>
        </div>

        <van-dialog
            v-model:show="showAdd"
            title="新分类"
            show-cancel-button
            :close-on-click-overlay="false"
            @confirm="confirmAdd"
        >
            <van-field
                v-model="newName"
                placeholder="例如：育儿、礼金"
                maxlength="12"
            />
        </van-dialog>
    </div>
</template>

<style scoped>
.cat-page {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 24px;
    font-family: var(--cent-font-ui);
    color: var(--cent-ink);
    background: var(--cent-paper);
}
.cat-hint {
    margin: 12px 16px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--cent-ink-muted);
}
.cat-tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
}
.cat-tag--preset {
    background: rgba(var(--cent-accent-rgb), 0.1);
    color: var(--cent-accent);
}
.cat-add {
    margin: 20px 16px 0;
}
</style>

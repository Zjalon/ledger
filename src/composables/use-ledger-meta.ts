import type { Ref } from "vue";
import { ref } from "vue";
import { useSync } from "@/composables/use-sync";
import {
    presetCategoryIds,
    TransferPresetCategory,
    ZhExpensePresets,
    ZhIncomePresets,
} from "@/ledger/category-zh-presets";
import type { BillCategory, BillType } from "@/ledger/type";

export function isUserCategory(c: BillCategory): boolean {
    return Boolean(c.customName) || !presetCategoryIds.has(c.id);
}

/** 合并内置分类与账本 meta 中的自定义分类 */
export function mergeCategoriesForType(
    type: BillType,
    customFromMeta: BillCategory[] | undefined,
): BillCategory[] {
    const custom = customFromMeta ?? [];
    const presets =
        type === "expense"
            ? ZhExpensePresets
            : type === "income"
              ? ZhIncomePresets
              : [TransferPresetCategory];
    const presetIds = new Set(presets.map((p) => p.id));
    const extra = custom.filter((c) => c.type === type && !presetIds.has(c.id));
    return [...presets, ...extra];
}

export function buildCategoryLabelMap(
    customFromMeta: BillCategory[] | undefined,
): Map<string, string> {
    const m = new Map<string, string>();
    const all = [
        ...ZhExpensePresets,
        ...ZhIncomePresets,
        TransferPresetCategory,
        ...(customFromMeta ?? []),
    ];
    for (const c of all) {
        m.set(c.id, c.name);
    }
    return m;
}

/**
 * 账本 meta.categories：仅存用户自定义分类（customName: true）
 */
export function useLedgerMetaCategories(): {
    customCategories: Ref<BillCategory[]>;
    loadCustomCategories: () => Promise<void>;
    saveCustomCategories: (list: BillCategory[]) => Promise<void>;
} {
    const { ep, selectedBookId } = useSync();
    const customCategories = ref<BillCategory[]>([]);

    const loadCustomCategories = async () => {
        const bid = selectedBookId.value?.trim();
        if (!bid) {
            customCategories.value = [];
            return;
        }
        const meta = await ep.getLedgerMeta(bid);
        const raw = meta.categories;
        customCategories.value = Array.isArray(raw)
            ? (raw as BillCategory[]).filter(
                  (c) => Boolean(c.customName) || !presetCategoryIds.has(c.id),
              )
            : [];
    };

    const saveCustomCategories = async (list: BillCategory[]) => {
        const bid = selectedBookId.value?.trim();
        if (!bid) return;
        await ep.patchLedgerMeta(bid, {
            categories: list.map((c) => ({
                ...c,
                customName: true as const,
            })),
        });
        await ep.toSync();
        customCategories.value = list;
    };

    return {
        customCategories,
        loadCustomCategories,
        saveCustomCategories,
    };
}

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

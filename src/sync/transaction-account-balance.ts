import type { Action } from "@/database/stash";
import type { Transaction } from "@/database/tables/transaction";

/** 单笔交易对各账户余额的贡献（与「增加该笔流水」一致；删除时取反） */
export function balanceDeltaForTransaction(
    tx: Transaction,
): Map<string, number> {
    const m = new Map<string, number>();
    const add = (id: string | undefined, delta: number) => {
        if (!id) {
            return;
        }
        m.set(id, (m.get(id) ?? 0) + delta);
    };
    if (tx.type === "expense") {
        add(tx.accountId, -tx.amount);
    } else if (tx.type === "income") {
        add(tx.accountId, tx.amount);
    } else if (tx.type === "transfer" && tx.transferTo) {
        add(tx.accountId, -tx.amount);
        add(tx.transferTo, tx.amount);
    }
    return m;
}

function mergeMapInto(
    target: Map<string, number>,
    part: Map<string, number>,
    sign: 1 | -1,
): void {
    for (const [id, d] of part) {
        target.set(id, (target.get(id) ?? 0) + d * sign);
    }
}

/**
 * 根据一批 transaction 操作计算账户 `initialBalance` 应叠加的增量（删除为撤销）。
 * `getExistingTx`：用于 delete 前从当前账本取回被删流水（与 batch 应用前快照一致）。
 */
export function accountBalanceDeltasFromTransactionActions(
    actions: Action<Transaction>[],
    getExistingTx: (id: string) => Transaction | undefined,
): Map<string, number> {
    const total = new Map<string, number>();
    for (const a of actions) {
        if (a.type === "delete") {
            const tx = getExistingTx(String(a.value));
            if (tx) {
                mergeMapInto(total, balanceDeltaForTransaction(tx), -1);
            }
        } else if (a.type === "update") {
            mergeMapInto(
                total,
                balanceDeltaForTransaction(a.value as Transaction),
                1,
            );
        }
    }
    return total;
}

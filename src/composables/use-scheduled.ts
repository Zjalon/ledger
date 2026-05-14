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
        await ep.tableBatch<Transaction>(
            bookId,
            "transactions",
            txs.map((tx) => ({ type: "update" as const, value: tx })),
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

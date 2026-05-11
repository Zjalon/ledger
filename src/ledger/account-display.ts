import type { Account } from "@/database/tables/account";

/** 账户类型与列表图标一一对应（Vant Icon name） */
export const ACCOUNT_TYPE_PRESETS: {
    id: string;
    label: string;
    icon: string;
}[] = [
    { id: "cash", label: "现金", icon: "gold-coin-o" },
    { id: "bank", label: "银行卡", icon: "credit-pay" },
    { id: "alipay", label: "支付宝", icon: "balance-pay" },
    { id: "wechat", label: "微信", icon: "chat-o" },
    { id: "wallet", label: "钱包", icon: "balance-o" },
    { id: "savings", label: "储蓄", icon: "gem-o" },
];

const DEFAULT_ACCOUNT_COLOR = "#2d6a4f";

/** 展示与保存均以 accountType 为准；缺失时回退默认类型 */
export function resolvedAccountType(acc: Account): string {
    return acc.accountType ?? ACCOUNT_TYPE_PRESETS[0].id;
}

export function iconForAccountType(typeId: string): string {
    const p = ACCOUNT_TYPE_PRESETS.find((x) => x.id === typeId);
    return p?.icon ?? ACCOUNT_TYPE_PRESETS[0].icon;
}

/** 列表头像：由账户类型决定图标 */
export function accountIconForDisplay(acc: Account): string {
    return iconForAccountType(resolvedAccountType(acc));
}

export function accountColorForDisplay(acc: Account): string {
    const c = acc.color?.trim();
    return c ? c : DEFAULT_ACCOUNT_COLOR;
}

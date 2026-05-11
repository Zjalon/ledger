import type { BaseItem } from "@/database/stash";

export type Account = BaseItem & {
    name: string;
    /** 列表头像：Vant Icon `name`；旧数据可能为 `mdi--*` 样式，展示时退回首字 */
    icon: string;
    color: string;
    /** 初始余额，10000:1 比率 */
    initialBalance?: number;
    /** 账户类型（现金/银行卡/支付宝…），与头像图标分离 */
    accountType?: string;
};

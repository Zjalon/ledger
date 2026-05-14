import type { BaseItem } from "@/database/stash";

/** 交易类型：收入、支出、转账 */
export type TransactionType = "income" | "expense" | "transfer";

/** 整数金额，10000:1 比率 */
export type Amount = number;

/** 地理位置 */
export type GeoLocation = {
    latitude: number;
    longitude: number;
    accuracy: number;
};

export type Transaction = BaseItem & {
    /** 交易类型 */
    type: TransactionType;
    /** 分类 ID */
    categoryId: string;
    /** 创建者 ID */
    creatorId: number | string;
    /** 备注 */
    comment?: string;
    /** 整数金额，10000:1 */
    amount: Amount;
    /** 交易时间（时间戳） */
    time: number;
    /** 图片附件 */
    images?: (File | string)[];
    /** 地址 */
    location?: GeoLocation;
    /** 关联账户 ID */
    accountId?: string;
    /** 转账目标账户 ID（仅 transfer 类型） */
    transferTo?: string;
    /** 额外信息 */
    extra?: {
        scheduledId?: string;
    };
};

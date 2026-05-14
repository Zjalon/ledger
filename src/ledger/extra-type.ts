import type { Bill, BillType } from "./type";

/**
 * 过滤器，不需要转换，可以略过
 */
export type BillFilter = Partial<{
    comment: string;
    recent?: {
        value: number;
        unit: "year" | "month" | "week" | "day";
    };
    start: number;
    end: number;
    type: BillType | undefined;
    creators: (string | number)[];
    categories: string[];
    minAmountNumber: number;
    maxAmountNumber: number;
    assets?: boolean;
    scheduled?: boolean;
}>;

export type BillFilterViewModule =
    | "base-analysis" // BaseAnalysis 模块，这个模块必须被包含在内
    | "top-words" // AnalysisCloud 高频词云展示模块
    | "map" // AnalysisMap 地图模块
    | "analysis" // AnalysisDetail 简易分析模块
    | "top-expense" // 最高支出模块
    | "top-income"; // 最高收入模块

export type BillFilterView = {
    id: string;
    filter: BillFilter;
    name: string;
    modules?: BillFilterViewModule[];
};

/** 周期记账配置 */
export type Scheduled = {
    id: string;
    title: string;
    start: number;
    end?: number;
    template: Omit<Bill, "id" | "creatorId">;
    enabled?: boolean;
    repeat: {
        unit: "week" | "day" | "month" | "year";
        value: number;
    };
    // 最新一条自动记账记录的时间
    latest?: number;
};

// 个人配置，不需要转换，可以略过
export type PersonalMeta = {
    names?: Record<string, string>;
    scheduleds?: Scheduled[];
    customCSS?: string;
    /** 资产页账户列表显示顺序（账户 id，前者靠前）；存于 meta.personal[当前用户 id] */
    accountDisplayOrder?: string[];
};

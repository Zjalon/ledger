import type { BillCategory } from "./type";

/** 内置支出分类（可与账本 meta.categories 中的自定义项合并展示） */
export const ZhExpensePresets: BillCategory[] = [
    {
        id: "zh-exp-dining",
        name: "餐饮",
        type: "expense",
        icon: "shop-o",
        color: "#c2410c",
    },
    {
        id: "zh-exp-shopping",
        name: "购物",
        type: "expense",
        icon: "shopping-cart-o",
        color: "#b45309",
    },
    {
        id: "zh-exp-apparel",
        name: "服饰",
        type: "expense",
        icon: "gem-o",
        color: "#7c3aed",
    },
    {
        id: "zh-exp-daily",
        name: "日用",
        type: "expense",
        icon: "records",
        color: "#78716c",
    },
    {
        id: "zh-exp-digital",
        name: "数码",
        type: "expense",
        icon: "phone-circle-o",
        color: "#0369a1",
    },
    {
        id: "zh-exp-beauty",
        name: "美妆",
        type: "expense",
        icon: "star-o",
        color: "#db2777",
    },
    {
        id: "zh-exp-housing",
        name: "住房",
        type: "expense",
        icon: "wap-home-o",
        color: "#57534e",
    },
    {
        id: "zh-exp-transport",
        name: "交通",
        type: "expense",
        icon: "logistics",
        color: "#2d6a4f",
    },
    {
        id: "zh-exp-entertainment",
        name: "娱乐",
        type: "expense",
        icon: "smile-o",
        color: "#9333ea",
    },
    {
        id: "zh-exp-medical",
        name: "医疗",
        type: "expense",
        icon: "like-o",
        color: "#dc2626",
    },
    {
        id: "zh-exp-telecom",
        name: "通讯",
        type: "expense",
        icon: "phone-o",
        color: "#0d9488",
    },
    {
        id: "zh-exp-auto",
        name: "汽车",
        type: "expense",
        icon: "guide-o",
        color: "#1e40af",
    },
    {
        id: "zh-exp-relation",
        name: "人情",
        type: "expense",
        icon: "gift-o",
        color: "#ea580c",
    },
    {
        id: "zh-exp-social",
        name: "社交",
        type: "expense",
        icon: "friends-o",
        color: "#0891b2",
    },
    {
        id: "zh-exp-parenting",
        name: "育儿",
        type: "expense",
        icon: "user-o",
        color: "#ca8a04",
    },
    {
        id: "zh-exp-pet",
        name: "宠物",
        type: "expense",
        icon: "service-o",
        color: "#65a30d",
    },
    {
        id: "zh-exp-travel",
        name: "旅行",
        type: "expense",
        icon: "location-o",
        color: "#0ea5e9",
    },
    {
        id: "zh-exp-tobacco",
        name: "烟酒",
        type: "expense",
        icon: "fire-o",
        color: "#991b1b",
    },
];

/** 内置收入分类 */
export const ZhIncomePresets: BillCategory[] = [
    {
        id: "zh-inc-salary",
        name: "工资",
        type: "income",
        icon: "gold-coin-o",
        color: "#2d6a4f",
    },
    {
        id: "zh-inc-bonus",
        name: "奖金",
        type: "income",
        icon: "gift-o",
        color: "#c2410c",
    },
    {
        id: "zh-inc-benefit",
        name: "福利",
        type: "income",
        icon: "gift-card-o",
        color: "#7c3aed",
    },
    {
        id: "zh-inc-provident",
        name: "公积金",
        type: "income",
        icon: "balance-list",
        color: "#0369a1",
    },
    {
        id: "zh-inc-redpacket",
        name: "红包",
        type: "income",
        icon: "coupon-o",
        color: "#ea580c",
    },
    {
        id: "zh-inc-tax-refund",
        name: "退税",
        type: "income",
        icon: "refund-o",
        color: "#0d9488",
    },
    {
        id: "zh-inc-invest",
        name: "投资",
        type: "income",
        icon: "chart-trending-o",
        color: "#b45309",
    },
    {
        id: "zh-inc-windfall",
        name: "意外收入",
        type: "income",
        icon: "point-gift-o",
        color: "#ca8a04",
    },
];

export const TransferPresetCategory: BillCategory = {
    id: "zh-transfer",
    name: "转账",
    type: "transfer",
    icon: "exchange",
    color: "#2d6a4f",
};

export const presetCategoryIds = new Set([
    ...ZhExpensePresets.map((c) => c.id),
    ...ZhIncomePresets.map((c) => c.id),
    TransferPresetCategory.id,
]);

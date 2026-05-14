// @annotation: Full 在这里并无实际作用，只是用于拓展一些额外内容，无需考虑，Full<T> 可视为等价于 T
import type { Full } from "@/database/stash";
// @annotation: 其他工具type，无需考虑
import type {
    BillFilter,
    BillFilterView,
    PersonalMeta,
    Scheduled,
} from "./extra-type";

export type { PersonalMeta, BillFilter, Scheduled };

/** 账单类型，代表收入、支出或转账 */
export type BillType = "income" | "expense" | "transfer";

/** 整数金额，10000:1 */
export type Amount = number;

/** 账户类型 */
export type BillAccount = {
    id: string;
    name: string;
    icon: string;
    color: string;
    /** 初始余额，单位同 Amount (10000:1) */
    initialBalance?: number;
    /** 账户类型（现金/银行卡等），与 icon 头像区分 */
    accountType?: string;
};

/** 用户资料 */
export type UserProfile = {
    nickname?: string;
    avatar?: string;
    signature?: string;
    phone?: string;
};

/** 地理位置类型 */
export type GeoLocation = {
    latitude: number;
    longitude: number;
    accuracy: number;
};

export type Bill = {
    /** 每笔账单的唯一标识 */
    id: string;
    /** 账单类型，代表收入或者支出 */
    type: BillType;
    /** 账单的类别，每笔账单只能有一个分类，可以是父类，也可以是子类 */
    categoryId: string;
    /** 创建者的id */
    creatorId: number | string;
    /** 备注，导入时不确定的信息也可以保存在这里 */
    comment?: string;
    /** 整数金额，10000:1 */
    amount: Amount;
    /** 账单发生的时间*/
    time: number;
    /** 账单的图片附件*/
    images?: (File | string)[];
    /** 账单的地址*/
    location?: GeoLocation;
    /** 关联的账户 ID */
    accountId?: string;
    /** 转账目标账户 ID（仅 type="transfer" 时有值） */
    transferTo?: string;
    /** 其他额外信息 */
    extra?: {
        scheduledId?: string;
    };
};

/** 每笔账单仅可以设置一个BillCategory，用于标记这些支出或者收入项属于某些分类
 * 分类也分为父类和子类，分别表示更加详细的类别
 * 一般来说，大部分账单分类都可以在默认的分类中找到，如果实在没有对应的分类，应该将新增的分类添加到GlobalMeta.categories中，新增分类只需要@required 标记的字段即可，并且新增的分类customName字段必须为true，其余字段可以根据需要设置为空字符串或者undefined
 * 应用内置默认分类见 `src/ledger/category-zh-presets.ts`（与账本 `meta.categories` 合并展示）
 */

export type BillCategory = {
    // @required 分类的消费类型，指定是支出还是收入
    type: BillType;
    // @required 分类的名称
    name: string;
    // @required 分类的id
    id: string;
    // 分类的图标
    icon: string;
    // 分类的颜色
    color: string;
    // 内部使用，分类的自定义名称，当用户修改了默认分类的名称后启用，非默认分类和新增的分类customName字段必须为true
    customName?: boolean;
    // 父类的id，如果为空，则该分类视为父类
    parent?: string;
    // 默认选中，仅对子类生效，如果为true，则该子类的父类在首次选中时，首先会选中该子类，再次点击父类可以选中父类
    defaultSelect?: boolean;
};

// 全局文件配置
export type GlobalMeta = {
    // 自定义过滤器，可以略过
    customFilters?: BillFilterView[];
    // 用户自定义配置，可以略过
    personal?: Record<string, PersonalMeta>;
    // 自定义分类，所有新增的分类都应该放在这里
    categories?: BillCategory[];
    // 账户列表
    accounts?: BillAccount[];
    map?: {
        amapKey?: string;
        amapSecurityCode?: string;
    };
};

// 这是最终导出的核心JSON数据结构，使用这个数据结构可以直接被解析成可以识别的数据
export type ExportedJSON = {
    // 所有的交易记录
    items: Full<Bill>[];
    // 额外的配置数据
    meta: GlobalMeta;
    // 用户资料
    profile?: UserProfile;
};

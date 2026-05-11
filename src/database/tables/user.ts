import type { BaseItem } from "@/database/stash";

export type User = BaseItem & {
    nickname?: string;
    avatar?: string;
    signature?: string;
    phone?: string;
};

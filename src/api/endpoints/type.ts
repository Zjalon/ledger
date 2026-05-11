import type { Modal } from "@/components/modal";
import type { Action, BaseItem, Full } from "@/database/stash";

export type ChangeListener = (args: { bookId: string }) => void;

export type UserInfo = {
    avatar_url: string;
    name: string;
    id: string;
};

export type Book = { id: string; name: string };

export type SyncEndpoint = {
    logout: () => Promise<any>;

    fetchAllBooks: () => Promise<Book[]>;
    createBook: (name: string) => Promise<{
        id: string;
        name: string;
    }>;
    initBook: (id: string) => Promise<any>;
    inviteForBook?: (bookId: string) => any;
    deleteBook: (bookId: string) => Promise<any>;

    onChange(listener: (args: { bookId: string }) => void): () => void;

    // Table-level API
    tableBatch: <T extends BaseItem>(
        bookId: string,
        tableName: string,
        actions: Action<T>[],
        overlap?: boolean,
    ) => Promise<void>;
    tableGetAllItems: <T extends BaseItem>(
        bookId: string,
        tableName: string,
    ) => Promise<Full<T>[]>;

    getIsNeedSync: () => Promise<boolean>;
    onSync: (processor: (finished: Promise<void>) => void) => () => void;
    toSync: () => Promise<any>;

    getUserInfo: (id?: string) => Promise<UserInfo>;
    getCollaborators: (id: string) => Promise<UserInfo[]>;

    getOnlineAsset?: (src: string, store: string) => Promise<Blob | undefined>;

    forceNeedSync?: (store: string) => void;

    getProfile: (bookId: string) => Promise<any>;
    setProfile: (bookId: string, data: any) => Promise<void>;

    /** ledger meta.json（分类标签等），与账单一并同步到 Git */
    getLedgerMeta: (bookId: string) => Promise<Record<string, unknown>>;
    patchLedgerMeta: (
        bookId: string,
        patch: Record<string, unknown>,
    ) => Promise<void>;
};

export type SyncEndpointFactory = {
    type: string;
    name: string;
    login: (ctx: { modal: Modal }) => void;
    manuallyLogin?: (ctx: { modal: Modal }) => void;
    init: (ctx: { modal: Modal }) => SyncEndpoint;
};

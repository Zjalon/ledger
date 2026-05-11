import { type DBSchema, deleteDB, openDB } from "idb";
import {
    type Action,
    type ArrayableStorageFactory,
    type Full,
    StashBucket,
    type StashStorage,
    type StorageFactory,
} from "./stash";

const DB_VERSION = 2;

interface GenericDBSchema extends DBSchema {
    [StashBucket.STASH_NAME]: {
        key: string;
        value: Action<Full<any>>;
        indexes: {
            timestamp: string;
        };
    };
    [StashBucket.ITEM_NAME]: {
        key: string;
        value: Full<any>;
        indexes: {
            time: string;
            creatorId: string;
        };
    };
    [StashBucket.META_NAME]: {
        key: string;
        value: { id: "metaKey"; value: any };
    };
    [StashBucket.CONFIG_NAME]: {
        key: string;
        value: { id: "metaKey"; value: any };
    };
}

export class BillIndexedDBStorage implements StashStorage {
    public readonly dbName: string;

    constructor(dbName: string) {
        this.dbName = dbName;
    }
    getDB() {
        return openDB<GenericDBSchema>(this.dbName, DB_VERSION, {
            upgrade: (db, _oldVersion, _newVersion, _transaction) => {
                if (!db.objectStoreNames.contains(StashBucket.STASH_NAME)) {
                    const store = db.createObjectStore(StashBucket.STASH_NAME, {
                        autoIncrement: true,
                        keyPath: "id",
                    });
                    store.createIndex("timestamp", "timestamp");
                }
                if (!db.objectStoreNames.contains(StashBucket.ITEM_NAME)) {
                    const store = db.createObjectStore(StashBucket.ITEM_NAME, {
                        keyPath: "id",
                    });
                    store.createIndex("time", "time");
                    store.createIndex("creatorId", "creatorId");
                }
                if (!db.objectStoreNames.contains(StashBucket.META_NAME)) {
                    db.createObjectStore(StashBucket.META_NAME, {
                        autoIncrement: true,
                        keyPath: "id",
                    });
                }
                if (!db.objectStoreNames.contains(StashBucket.CONFIG_NAME)) {
                    db.createObjectStore(StashBucket.CONFIG_NAME, {
                        autoIncrement: true,
                        keyPath: "id",
                    });
                }
            },
        });
    }

    createArrayableStorage: ArrayableStorageFactory = (name) => {
        return {
            put: async (...v) => {
                const db = await this.getDB();
                const tx = db.transaction(name, "readwrite");
                const store = tx.objectStore(name);
                await Promise.all(v.map((item) => store.put(item as any)));
                await tx.done;
                db.close();
            },
            delete: async (...ids) => {
                const db = await this.getDB();
                const tx = db.transaction(name, "readwrite");
                const store = tx.objectStore(name);
                await Promise.all(ids.map((id) => store.delete(id)));
                await tx.done;
                db.close();
            },
            clear: async () => {
                const db = await this.getDB();
                await db.clear(name);
                db.close();
            },
            toArray: async (limit?: number) => {
                const db = await this.getDB();
                const storeName =
                    name === StashBucket.STASH_NAME
                        ? StashBucket.STASH_NAME
                        : StashBucket.ITEM_NAME;
                const tx = db.transaction(storeName);
                const store = tx.objectStore(storeName);
                let items: any[];
                if (limit !== undefined) {
                    items = await store.getAll(undefined, limit);
                } else {
                    items = await store.getAll();
                }
                db.close();
                return items;
            },
        };
    };

    createStorage: StorageFactory = (name) => {
        return {
            setValue: async (v) => {
                const db = await this.getDB();
                const tx = db.transaction(name, "readwrite");
                const store = tx.objectStore(name);
                await store.put({ id: "metaKey", value: v });
                await tx.done;
                db.close();
            },
            getValue: async () => {
                const db = await this.getDB();
                const tx = db.transaction(name, "readonly");
                const store = tx.objectStore(name);
                const value = await store.get("metaKey");
                await tx.done;
                db.close();
                return value?.value;
            },
        };
    };
    dangerousClearAll = async () => {
        const databases = await indexedDB.databases();
        await Promise.all(
            databases.map((db) => {
                const dbName = db.name;
                if (dbName === undefined) {
                    return;
                }
                return deleteDB(dbName);
            }),
        );
    };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class StorageManager {
  private static DB_NAME = "AIRaceArena_AssetDB";
  private static STORE_NAME = "downloaded_assets";
  private static db: IDBDatabase | null = null;

  public static async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      request.onerror = () => {
        console.error("StorageManager: Failed to initialize IndexedDB");
        reject(request.error);
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };
    });
  }

  public static async saveAsset(id: string, blob: Blob): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject("DB not initialized");
      const transaction = this.db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(blob, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public static async getAsset(id: string): Promise<Blob | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject("DB not initialized");
      const transaction = this.db.transaction([this.STORE_NAME], "readonly");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve((request.result as Blob) || null);
      request.onerror = () => reject(request.error);
    });
  }

  public static async containsAsset(id: string): Promise<boolean> {
    const asset = await this.getAsset(id);
    return asset !== null;
  }

  public static async clear(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject("DB not initialized");
      const transaction = this.db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * IndexedDB wrapper for storing game assets (CLAW.REZ)
 * Provides persistent browser storage for large binary files
 */
export class AssetStorage {
  constructor() {
    this.dbName = 'ClawWebAssets';
    // Pre-rename database names across rebrands, NEWEST FIRST. Existing users
    // have their uploaded CLAW.REZ under one of these; init() migrates it once
    // so nobody has to re-upload ~113MB, regardless of which version they came
    // from (OpenClawAssets -> CaptainClawWebAssets -> ClawWebAssets).
    this.legacyDbNames = ['CaptainClawWebAssets', 'OpenClawAssets'];
    this.storeName = 'files';
    this.db = null;
    this.chunkSize = 1024 * 1024 * 5; // 5MB chunks to prevent memory issues
  }

  /**
   * Initialize IndexedDB connection, migrating from the legacy database on
   * first run so a returning user keeps their stored CLAW.REZ.
   * @returns {Promise<void>}
   */
  async init() {
    this.db = await this._open(this.dbName);
    await this._migrateFromLegacy();
  }

  /** Open (and create/upgrade) a database by name. */
  _open(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onerror = () => reject(new Error('Failed to open IndexedDB: ' + name));
      request.onsuccess = (event) => resolve(event.target.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'name' });
          objectStore.createIndex('name', 'name', { unique: true });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * One-time migration of all records from a legacy DB into the current DB.
   * Runs only when the current DB is empty; walks legacyDbNames newest-first
   * and migrates from the first one that holds data, so a user coming from ANY
   * prior version keeps their upload. No-op for new users and for anyone
   * already migrated. All prior DBs are deleted afterwards. Any failure is
   * swallowed: migration is best-effort and must never block startup (the user
   * can always re-upload as a fallback).
   */
  async _migrateFromLegacy() {
    try {
      // Skip if we already have data (already migrated or a fresh upload).
      const existing = await new Promise((resolve) => {
        const tx = this.db.transaction([this.storeName], 'readonly');
        const req = tx.objectStore(this.storeName).getAllKeys();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => resolve([]);
      });
      if (existing.length > 0) return;

      // If databases() is available (not in every browser), use it to skip
      // legacy names that don't exist and avoid creating empty phantom DBs.
      let present = null;
      if (indexedDB.databases) {
        try {
          const dbs = await indexedDB.databases();
          present = new Set(dbs.map((d) => d.name));
        } catch (e) { present = null; }
      }

      let migrated = false;
      for (const name of this.legacyDbNames) {
        if (present && !present.has(name)) continue;

        const legacy = await this._open(name);
        if (!legacy.objectStoreNames.contains(this.storeName)) {
          legacy.close();
          continue;
        }

        const records = await new Promise((resolve) => {
          const tx = legacy.transaction([this.storeName], 'readonly');
          const req = tx.objectStore(this.storeName).getAll();
          req.onsuccess = (e) => resolve(e.target.result || []);
          req.onerror = () => resolve([]);
        });
        legacy.close();

        if (!migrated && records.length > 0) {
          await new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            records.forEach((r) => store.put(r));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          console.info('[migrate] Moved ' + records.length + ' asset record(s) from ' + name + '.');
          migrated = true;
        }

        // Delete every legacy DB (whether or not it was the source) now that
        // the current DB is authoritative.
        indexedDB.deleteDatabase(name);
      }
    } catch (e) {
      console.warn('[migrate] Legacy IndexedDB migration skipped:', e);
    }
  }

  /**
   * Store a file in IndexedDB with progress tracking
   * @param {string} name - File name
   * @param {Blob} blob - File data
   * @param {Function} onProgress - Progress callback (loaded, total)
   * @returns {Promise<void>}
   */
  async storeFile(name, blob, onProgress = null, extraMeta = null) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    // Store metadata and blob. extraMeta lets callers persist extra fields
    // (e.g. a `version` tag used to detect a stale cached game binary).
    const fileData = Object.assign(
      {
        name: name,
        blob: blob,
        size: blob.size,
        type: blob.type,
        timestamp: Date.now()
      },
      extraMeta || {}
    );

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);

      const request = objectStore.put(fileData);

      request.onsuccess = () => {
        if (onProgress) {
          onProgress(blob.size, blob.size);
        }
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to store file: ${name}`));
      };
    });
  }

  /**
   * Retrieve a file from IndexedDB
   * @param {string} name - File name
   * @returns {Promise<Blob|null>}
   */
  async getFile(name) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(name);

      request.onsuccess = (event) => {
        const result = event.target.result;
        resolve(result ? result.blob : null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to retrieve file: ${name}`));
      };
    });
  }

  /**
   * Check if a file exists in IndexedDB
   * @param {string} name - File name
   * @returns {Promise<boolean>}
   */
  async hasFile(name) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(name);

      request.onsuccess = (event) => {
        resolve(!!event.target.result);
      };

      request.onerror = () => {
        reject(new Error(`Failed to check file existence: ${name}`));
      };
    });
  }

  /**
   * Delete a file from IndexedDB
   * @param {string} name - File name
   * @returns {Promise<void>}
   */
  async deleteFile(name) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.delete(name);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to delete file: ${name}`));
    });
  }

  /**
   * Get metadata about a file
   * @param {string} name - File name
   * @returns {Promise<Object|null>}
   */
  async getFileMetadata(name) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(name);

      request.onsuccess = (event) => {
        const result = event.target.result;
        if (result) {
          resolve({
            name: result.name,
            size: result.size,
            type: result.type,
            timestamp: result.timestamp,
            version: result.version || null
          });
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        reject(new Error(`Failed to retrieve metadata: ${name}`));
      };
    });
  }

  /**
   * List all stored files
   * @returns {Promise<Array>}
   */
  async listFiles() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAllKeys();

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = () => {
        reject(new Error('Failed to list files'));
      };
    });
  }

  /**
   * Get total storage size used
   * @returns {Promise<number>}
   */
  async getStorageSize() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAll();

      request.onsuccess = (event) => {
        const files = event.target.result;
        const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
        resolve(totalSize);
      };

      request.onerror = () => {
        reject(new Error('Failed to calculate storage size'));
      };
    });
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Keep window global for backward compatibility during transition
if (typeof window !== 'undefined') {
  window.AssetStorage = AssetStorage;
}

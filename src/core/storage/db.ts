import { EncryptedFileRecord, AuditLogEvent, PolicyRule, UserOverride, AnomalyReport } from '../../types';

const DB_NAME = 'aegis_privacy_vault_db';
const DB_VERSION = 1;

class VaultDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private auditListeners: ((event: AuditLogEvent) => void)[] = [];
  // In-memory fallback for test runners / environments without indexedDB
  private memFiles = new Map<string, EncryptedFileRecord>();
  private memLogs: AuditLogEvent[] = [];
  private memPolicies: PolicyRule[] = [];
  private memOverrides: UserOverride[] = [];
  private memSettings = new Map<string, any>();

  private isIndexedDBAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Encrypted Files Store
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('createdAt', 'createdAt', { unique: false });
          fileStore.createIndex('fileName', 'fileName', { unique: false });
        }

        // Audit Logs Store
        if (!db.objectStoreNames.contains('audit_logs')) {
          const logStore = db.createObjectStore('audit_logs', { keyPath: 'id' });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
          logStore.createIndex('eventType', 'eventType', { unique: false });
          logStore.createIndex('source', 'source', { unique: false });
        }

        // User Defined Policy Rules
        if (!db.objectStoreNames.contains('policies')) {
          const policyStore = db.createObjectStore('policies', { keyPath: 'id' });
          policyStore.createIndex('createdAt', 'createdAt', { unique: false });
          policyStore.createIndex('enabled', 'enabled', { unique: false });
        }

        // User Overrides (for self-correction heuristic)
        if (!db.objectStoreNames.contains('overrides')) {
          const overrideStore = db.createObjectStore('overrides', { keyPath: 'id' });
          overrideStore.createIndex('fileCategory', 'fileCategory', { unique: false });
          overrideStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Key Metadata & Auth Settings Store
        if (!db.objectStoreNames.contains('security_settings')) {
          db.createObjectStore('security_settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  // --- Encrypted Files Operations ---
  async saveFile(record: EncryptedFileRecord): Promise<void> {
    if (!this.isIndexedDBAvailable()) {
      this.memFiles.set(record.id, record);
      return;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getFile(id: string): Promise<EncryptedFileRecord | null> {
    if (!this.isIndexedDBAvailable()) {
      return this.memFiles.get(id) || null;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllFiles(): Promise<EncryptedFileRecord[]> {
    if (!this.isIndexedDBAvailable()) {
      return Array.from(this.memFiles.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const req = store.getAll();
      req.onsuccess = () => {
        const results = (req.result as EncryptedFileRecord[]) || [];
        results.sort((a, b) => b.createdAt - a.createdAt);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteFile(id: string): Promise<void> {
    if (!this.isIndexedDBAvailable()) {
      this.memFiles.delete(id);
      return;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- Audit Logs Operations ---
  async logEvent(event: Omit<AuditLogEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): Promise<AuditLogEvent> {
    const fullEvent: AuditLogEvent = {
      id: event.id || 'log_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
      timestamp: event.timestamp || Date.now(),
      eventType: event.eventType,
      severity: event.severity,
      source: event.source,
      fileId: event.fileId,
      fileName: event.fileName,
      actionTaken: event.actionTaken,
      details: event.details,
      riskScore: event.riskScore,
      tamperDetected: event.tamperDetected,
    };

    if (!this.isIndexedDBAvailable()) {
      this.memLogs.unshift(fullEvent);
    } else {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('audit_logs', 'readwrite');
        const store = tx.objectStore('audit_logs');
        const req = store.put(fullEvent);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    // Notify active listeners
    this.auditListeners.forEach(listener => {
      try {
        listener(fullEvent);
      } catch (e) {
        console.error('Audit listener error:', e);
      }
    });

    return fullEvent;
  }

  async getAuditLogs(limit = 200): Promise<AuditLogEvent[]> {
    if (!this.isIndexedDBAvailable()) {
      return [...this.memLogs].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audit_logs', 'readonly');
      const store = tx.objectStore('audit_logs');
      const req = store.getAll();
      req.onsuccess = () => {
        const results = (req.result as AuditLogEvent[]) || [];
        results.sort((a, b) => b.timestamp - a.timestamp);
        resolve(results.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  onAuditLog(listener: (event: AuditLogEvent) => void): () => void {
    this.auditListeners.push(listener);
    return () => {
      this.auditListeners = this.auditListeners.filter(l => l !== listener);
    };
  }

  // --- Policy Rules Operations ---
  async getPolicies(): Promise<PolicyRule[]> {
    const defaultPolicies: PolicyRule[] = [
      {
        id: 'rule_default_gov_id',
        naturalLanguage: 'Always encrypt government IDs and Aadhaar/PAN cards fully or selectively',
        condition: { categories: ['GOVERNMENT_ID'], piiTypes: ['PAN_CARD', 'AADHAAR', 'PASSPORT', 'SSN'] },
        action: 'ENCRYPT_REGION',
        enabled: true,
        createdAt: Date.now() - 100000,
      },
      {
        id: 'rule_default_credentials',
        naturalLanguage: 'Always fully encrypt code containing API keys and private credentials',
        condition: { categories: ['CODE_OR_CREDENTIALS'], piiTypes: ['API_KEY'] },
        action: 'ENCRYPT_FULL',
        enabled: true,
        createdAt: Date.now() - 90000,
      },
      {
        id: 'rule_default_gps',
        naturalLanguage: 'Always strip and redact GPS coordinates from photo metadata',
        condition: { hasGps: true },
        action: 'REDACT_METADATA',
        enabled: true,
        createdAt: Date.now() - 80000,
      },
    ];

    if (!this.isIndexedDBAvailable()) {
      if (this.memPolicies.length === 0) {
        this.memPolicies = defaultPolicies;
      }
      return this.memPolicies;
    }

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('policies', 'readonly');
      const store = tx.objectStore('policies');
      const req = store.getAll();
      req.onsuccess = () => {
        let results = (req.result as PolicyRule[]) || [];
        if (results.length === 0) {
          results = defaultPolicies;
          const writeTx = db.transaction('policies', 'readwrite');
          defaultPolicies.forEach(p => writeTx.objectStore('policies').put(p));
        }
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async savePolicy(policy: PolicyRule): Promise<void> {
    if (!this.isIndexedDBAvailable()) {
      const idx = this.memPolicies.findIndex(p => p.id === policy.id);
      if (idx >= 0) this.memPolicies[idx] = policy;
      else this.memPolicies.push(policy);
      return;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('policies', 'readwrite');
      const store = tx.objectStore('policies');
      const req = store.put(policy);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deletePolicy(id: string): Promise<void> {
    if (!this.isIndexedDBAvailable()) {
      this.memPolicies = this.memPolicies.filter(p => p.id !== id);
      return;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('policies', 'readwrite');
      const store = tx.objectStore('policies');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- Overrides Operations (for Self-Correction B5) ---
  async recordOverride(override: Omit<UserOverride, 'id' | 'timestamp'>): Promise<void> {
    const fullOverride: UserOverride = {
      ...override,
      id: 'ovr_' + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
    };

    if (!this.isIndexedDBAvailable()) {
      this.memOverrides.push(fullOverride);
      return;
    }

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('overrides', 'readwrite');
      const store = tx.objectStore('overrides');
      const req = store.put(fullOverride);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getOverrides(): Promise<UserOverride[]> {
    if (!this.isIndexedDBAvailable()) {
      return this.memOverrides;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('overrides', 'readonly');
      const store = tx.objectStore('overrides');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Security Settings & Master Keys ---
  async getSetting<T>(key: string): Promise<T | null> {
    if (!this.isIndexedDBAvailable()) {
      return this.memSettings.get(key) || null;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('security_settings', 'readonly');
      const store = tx.objectStore('security_settings');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveSetting<T>(key: string, value: T): Promise<void> {
    if (!this.isIndexedDBAvailable()) {
      this.memSettings.set(key, value);
      return;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('security_settings', 'readwrite');
      const store = tx.objectStore('security_settings');
      const req = store.put({ key, value, updatedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clearDatabase(): Promise<void> {
    if (!this.isIndexedDBAvailable()) {
      this.memFiles.clear();
      this.memLogs = [];
      this.memPolicies = [];
      this.memOverrides = [];
      return;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['files', 'audit_logs', 'policies', 'overrides'], 'readwrite');
      tx.objectStore('files').clear();
      tx.objectStore('audit_logs').clear();
      tx.objectStore('policies').clear();
      tx.objectStore('overrides').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const vaultDB = new VaultDatabase();

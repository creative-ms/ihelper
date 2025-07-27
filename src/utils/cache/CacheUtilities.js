// ===================================
// src/utils/cache/CacheUtilities.js - Fixed to remove duplicate updateSyncMetadata
// ===================================
import { 
  productsDB, 
  batchesDB, 
  searchCacheDB, 
  inventoryStatsDB, 
  syncMetadataDB, 
  purchasesDB,
  transactionsDB,
  returnsDB,
  transactionStatsDB,
  salesDB,
  salesStatsDB
} from './databases.js';

const CacheUtilities = {
  async clearDatabase(db) {
    try {
      const result = await db.allDocs({ include_docs: true });
      const docsToDelete = result.rows.map(row => ({
        _id: row.doc._id,
        _rev: row.doc._rev,
        _deleted: true
      }));
      
      if (docsToDelete.length > 0) {
        await db.bulkDocs(docsToDelete);
      }
    } catch (error) {
      console.error('Error clearing database:', error);
    }
  },

  async isCacheEmpty() {
    try {
      const results = await Promise.all([
        productsDB.allDocs({ limit: 1 }),
        transactionsDB.allDocs({ limit: 1 }),
        salesDB.allDocs({ limit: 1 })
      ]);
      
      return results.every(result => result.rows.length === 0);
    } catch (error) {
      console.error('Error checking cache status:', error);
      return true;
    }
  },

  async getCacheSize() {
    try {
      const results = await Promise.all([
        productsDB.allDocs(),
        batchesDB.allDocs(),
        searchCacheDB.allDocs(),
        inventoryStatsDB.allDocs(),
        purchasesDB.allDocs(),
        transactionsDB.allDocs(),
        returnsDB.allDocs(),
        transactionStatsDB.allDocs(),
        salesDB.allDocs(),
        salesStatsDB.allDocs()
      ]);
      
      const [products, batches, searches, stats, purchases, transactions, returns, transactionStats, sales, salesStats] = results.map(r => r.rows.length);
      
      return { 
        products, 
        batches, 
        searches, 
        stats, 
        purchases,
        transactions,
        returns,
        transactionStats,
        sales,
        salesStats,
        total: products + batches + searches + stats + purchases + transactions + returns + transactionStats + sales + salesStats
      };
    } catch (error) {
      console.error('Error getting cache size:', error);
      return { 
        products: 0, 
        batches: 0, 
        searches: 0, 
        stats: 0, 
        purchases: 0,
        transactions: 0,
        returns: 0,
        transactionStats: 0,
        sales: 0,
        salesStats: 0,
        total: 0 
      };
    }
  },

  async healthCheck() {
    try {
      const [cacheSize, isEmpty, lastSync, isStale, lastTransactionSync, lastSalesSync] = await Promise.all([
        this.getCacheSize(),
        this.isCacheEmpty(),
        this.getLastSyncTime('products'),
        this.isCacheStale(2),
        this.getLastSyncTime('transactions'),
        this.getLastSyncTime('sales')
      ]);
      
      return {
        healthy: true,
        isEmpty,
        isStale,
        lastSync,
        lastTransactionSync,
        lastSalesSync,
        productsCount: cacheSize.products,
        batchesCount: cacheSize.batches,
        purchasesCount: cacheSize.purchases,
        transactionsCount: cacheSize.transactions,
        returnsCount: cacheSize.returns,
        salesCount: cacheSize.sales,
        totalSize: cacheSize.total * 1024,
        ...cacheSize
      };
    } catch (error) {
      console.error('Error performing health check:', error);
      return {
        healthy: false,
        isEmpty: true,
        isStale: true,
        lastSync: null,
        lastTransactionSync: null,
        lastSalesSync: null,
        productsCount: 0,
        batchesCount: 0,
        purchasesCount: 0,
        transactionsCount: 0,
        returnsCount: 0,
        salesCount: 0,
        totalSize: 0,
        error: error.message
      };
    }
  },

  // Clear all cache databases including sales
  async clearAllCache() {
    try {
      const databases = [
        productsDB, 
        batchesDB, 
        searchCacheDB, 
        inventoryStatsDB, 
        purchasesDB, 
        syncMetadataDB,
        transactionsDB,
        returnsDB,
        transactionStatsDB,
        salesDB,
        salesStatsDB
      ];
      
      await Promise.all(databases.map(db => this.clearDatabase(db)));
      
      console.log('✅ All cache databases cleared');
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing all cache:', error);
      return { success: false, error: error.message };
    }
  },

  // Get last sync time from sync metadata
  async getLastSyncTime(key = 'products') {
    try {
      const syncMetadata = await syncMetadataDB.get(key);
      return syncMetadata ? new Date(syncMetadata.timestamp) : null;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting last sync time:', error);
      return null;
    }
  },

  // Check if cache is stale
  async isCacheStale(hours = 1, key = 'products') {
    try {
      const lastSync = await this.getLastSyncTime(key);
      if (!lastSync) return true;
      
      const now = new Date();
      const diffHours = (now - lastSync) / (1000 * 60 * 60);
      return diffHours > hours;
    } catch (error) {
      console.error('Error checking cache staleness:', error);
      return true;
    }
  },

  // Check if transaction cache is stale
  async isTransactionCacheStale(hours = 0.5) {
    try {
      const lastSync = await this.getLastSyncTime('transactions');
      if (!lastSync) return true;
      
      const now = new Date();
      const diffHours = (now - lastSync) / (1000 * 60 * 60);
      return diffHours > hours;
    } catch (error) {
      console.error('Error checking transaction cache staleness:', error);
      return true;
    }
  },

  // Check if sales cache is stale
  async isSalesCacheStale(hours = 0.5) {
    try {
      const lastSync = await this.getLastSyncTime('sales');
      if (!lastSync) return true;
      
      const now = new Date();
      const diffHours = (now - lastSync) / (1000 * 60 * 60);
      return diffHours > hours;
    } catch (error) {
      console.error('Error checking sales cache staleness:', error);
      return true;
    }
  },

  // Retry utility for operations with potential conflicts
  async _retryOperation(operation, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (error.name === 'conflict' && attempt < maxRetries - 1) {
          console.log(`⚠️ Conflict detected, retrying (${attempt + 1}/${maxRetries})...`);
          // Exponential backoff with jitter
          const delay = 100 * Math.pow(2, attempt) + Math.random() * 50;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  },

  // NOTE: updateSyncMetadata is now handled by SyncCache to avoid conflicts
  // Use SyncCache.updateSyncMetadata instead of this method

  // Helper to safely update any document with conflict resolution
  async safeDocumentUpdate(db, docId, updateFn, maxRetries = 3) {
    return this._retryOperation(async () => {
      let doc;
      try {
        doc = await db.get(docId);
      } catch (error) {
        if (error.name === 'not_found') {
          doc = { _id: docId };
        } else {
          throw error;
        }
      }

      const updatedDoc = updateFn(doc);
      return await db.put(updatedDoc);
    }, maxRetries);
  },

  // Bulk operations with conflict handling
  async safeBulkDocs(db, docs, maxRetries = 3) {
    return this._retryOperation(async () => {
      return await db.bulkDocs(docs);
    }, maxRetries);
  }
};

export default CacheUtilities;
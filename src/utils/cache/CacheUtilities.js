// ===================================
// src/utils/cache/CacheUtilities.js - Enhanced with better performance monitoring
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
  // Enhanced with performance monitoring
  async clearDatabase(db) {
    try {
      const startTime = performance.now();
      const result = await db.allDocs({ include_docs: true });
      
      if (result.rows.length === 0) {
        console.log(`📭 Database already empty`);
        return;
      }
      
      const docsToDelete = result.rows.map(row => ({
        _id: row.doc._id,
        _rev: row.doc._rev,
        _deleted: true
      }));
      
      await db.bulkDocs(docsToDelete);
      
      const duration = performance.now() - startTime;
      console.log(`🗑️ Cleared ${docsToDelete.length} documents in ${duration.toFixed(2)}ms`);
      
    } catch (error) {
      console.error('Error clearing database:', error);
    }
  },

  // Enhanced cache status with performance metrics
  async isCacheEmpty() {
    try {
      const startTime = performance.now();
      
      const results = await Promise.all([
        productsDB.allDocs({ limit: 1 }),
        transactionsDB.allDocs({ limit: 1 }),
        salesDB.allDocs({ limit: 1 })
      ]);
      
      const isEmpty = results.every(result => result.rows.length === 0);
      const duration = performance.now() - startTime;
      
      console.log(`🔍 Cache empty check completed in ${duration.toFixed(2)}ms - isEmpty: ${isEmpty}`);
      return isEmpty;
      
    } catch (error) {
      console.error('Error checking cache status:', error);
      return true;
    }
  },

  // Enhanced with detailed size breakdown
  async getCacheSize() {
    try {
      const startTime = performance.now();
      
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
      const total = products + batches + searches + stats + purchases + transactions + returns + transactionStats + sales + salesStats;
      
      const duration = performance.now() - startTime;
      console.log(`📊 Cache size calculated in ${duration.toFixed(2)}ms - Total: ${total} documents`);
      
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
        total,
        calculationTime: duration
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
        total: 0,
        calculationTime: 0
      };
    }
  },

  // Enhanced health check with more detailed metrics
  async healthCheck() {
    try {
      const startTime = performance.now();
      
      const [cacheSize, isEmpty, lastSync, isStale, lastTransactionSync, lastSalesSync] = await Promise.all([
        this.getCacheSize(),
        this.isCacheEmpty(),
        this.getLastSyncTime('products'),
        this.isCacheStale(2),
        this.getLastSyncTime('transactions'),
        this.getLastSyncTime('sales')
      ]);
      
      const duration = performance.now() - startTime;
      
      const health = {
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
        healthCheckDuration: duration,
        ...cacheSize
      };
      
      console.log(`🏥 Health check completed in ${duration.toFixed(2)}ms - Healthy: ${health.healthy}`);
      return health;
      
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
        healthCheckDuration: 0,
        error: error.message
      };
    }
  },

  // Enhanced clear all with progress tracking
  async clearAllCache() {
    try {
      const startTime = performance.now();
      console.log('🧹 Starting complete cache clear...');
      
      const databases = [
        { db: productsDB, name: 'products' },
        { db: batchesDB, name: 'batches' },
        { db: searchCacheDB, name: 'searches' },
        { db: inventoryStatsDB, name: 'inventory stats' },
        { db: purchasesDB, name: 'purchases' },
        { db: syncMetadataDB, name: 'sync metadata' },
        { db: transactionsDB, name: 'transactions' },
        { db: returnsDB, name: 'returns' },
        { db: transactionStatsDB, name: 'transaction stats' },
        { db: salesDB, name: 'sales' },
        { db: salesStatsDB, name: 'sales stats' }
      ];
      
      // Clear databases in parallel with progress tracking
      const clearPromises = databases.map(async ({ db, name }) => {
        const dbStartTime = performance.now();
        await this.clearDatabase(db);
        const dbDuration = performance.now() - dbStartTime;
        console.log(`✅ Cleared ${name} cache in ${dbDuration.toFixed(2)}ms`);
        return { name, duration: dbDuration };
      });
      
      const results = await Promise.all(clearPromises);
      const totalDuration = performance.now() - startTime;
      
      console.log(`✅ All cache databases cleared in ${totalDuration.toFixed(2)}ms`);
      console.log('📊 Clear results:', results);
      
      return { success: true, duration: totalDuration, results };
    } catch (error) {
      console.error('❌ Error clearing all cache:', error);
      return { success: false, error: error.message };
    }
  },

  // Enhanced retry with exponential backoff and jitter
  async _retryOperation(operation, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const startTime = performance.now();
        const result = await operation();
        const duration = performance.now() - startTime;
        
        if (attempt > 0) {
          console.log(`✅ Operation succeeded on attempt ${attempt + 1} in ${duration.toFixed(2)}ms`);
        }
        
        return result;
      } catch (error) {
        if (error.name === 'conflict' && attempt < maxRetries - 1) {
          // Exponential backoff with jitter
          const baseDelay = 100 * Math.pow(2, attempt);
          const jitter = Math.random() * 50;
          const delay = baseDelay + jitter;
          
          console.log(`⚠️ Conflict detected, retrying in ${delay.toFixed(0)}ms (${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        if (attempt === maxRetries - 1) {
          console.error(`❌ Operation failed after ${maxRetries} attempts:`, error);
        }
        throw error;
      }
    }
  },

  // Enhanced document update with better error handling
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
      const result = await db.put(updatedDoc);
      
      console.log(`✅ Document ${docId} updated successfully`);
      return result;
    }, maxRetries);
  },

  // Enhanced bulk operations with progress tracking
  async safeBulkDocs(db, docs, maxRetries = 3) {
    if (!docs.length) return [];
    
    return this._retryOperation(async () => {
      const startTime = performance.now();
      const result = await db.bulkDocs(docs);
      const duration = performance.now() - startTime;
      
      const successful = result.filter(r => !r.error).length;
      const errors = result.filter(r => r.error);
      
      console.log(`📦 Bulk operation: ${successful}/${docs.length} successful in ${duration.toFixed(2)}ms`);
      
      if (errors.length > 0) {
        console.warn(`⚠️ ${errors.length} bulk operation errors:`, errors);
      }
      
      return result;
    }, maxRetries);
  },

  // New: Cache performance analyzer
  async analyzeCachePerformance() {
    try {
      const startTime = performance.now();
      
      const [health, size] = await Promise.all([
        this.healthCheck(),
        this.getCacheSize()
      ]);
      
      const analysisTime = performance.now() - startTime;
      
      const analysis = {
        overall: {
          healthy: health.healthy,
          totalDocuments: size.total,
          analysisTime
        },
        breakdown: {
          products: size.products,
          batches: size.batches,
          transactions: size.transactions,
          sales: size.sales
        },
        performance: {
          avgDocSize: size.total > 0 ? (health.totalSize / size.total) : 0,
          lastSyncAge: health.lastSync ? (Date.now() - new Date(health.lastSync).getTime()) / 1000 : null
        }
      };
      
      console.log('📈 Cache performance analysis:', analysis);
      return analysis;
      
    } catch (error) {
      console.error('Error analyzing cache performance:', error);
      return null;
    }
  },

  // Existing methods with maintained compatibility
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

  async isTransactionCacheStale(hours = 0.5) {
    return this.isCacheStale(hours, 'transactions');
  },

  async isSalesCacheStale(hours = 0.5) {
    return this.isCacheStale(hours, 'sales');
  }
};

export default CacheUtilities;
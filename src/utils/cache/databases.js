// ===================================
// src/utils/cache/databases.js - PouchDB with Smart Index Management
// ===================================
import PouchDB from 'pouchdb-browser';
import PouchDBFind from 'pouchdb-find';

// Add the find plugin to PouchDB
PouchDB.plugin(PouchDBFind);

// =================================================================
//  DATABASE INSTANCES
// =================================================================

// Core product databases
export const productsDB = new PouchDB('pharmacy_products');
export const batchesDB = new PouchDB('pharmacy_batches');
export const inventoryStatsDB = new PouchDB('pharmacy_inventory_stats');

// Purchase databases
export const purchasesDB = new PouchDB('pharmacy_purchases');

// Sales databases
export const salesDB = new PouchDB('pharmacy_sales');
export const salesStatsDB = new PouchDB('pharmacy_sales_stats');

// Customer and Supplier databases
export const customersDB = new PouchDB('pharmacy_customers');
export const suppliersDB = new PouchDB('pharmacy_suppliers');

// Transaction databases
export const transactionsDB = new PouchDB('pharmacy_transactions');
export const returnsDB = new PouchDB('pharmacy_returns');
export const transactionStatsDB = new PouchDB('pharmacy_transaction_stats');

// Dashboard and analytics databases
export const dashboardStatsDB = new PouchDB('pharmacy_dashboard_stats');
export const chartDataDB = new PouchDB('pharmacy_chart_data');
export const productAnalyticsDB = new PouchDB('pharmacy_product_analytics');
export const peakHoursDB = new PouchDB('pharmacy_peak_hours');
export const heatmapDataDB = new PouchDB('pharmacy_heatmap_data');

// Cache and metadata databases
export const searchCacheDB = new PouchDB('pharmacy_search_cache');
export const syncMetadataDB = new PouchDB('pharmacy_sync_metadata');
export const dashboardMetadataDB = new PouchDB('pharmacy_dashboard_metadata');

// =================================================================
//  INITIALIZATION STATE MANAGEMENT
// =================================================================

let isInitialized = false;
let initializationPromise = null;
const INDEXES_VERSION = '1.0.0'; // Increment this when indexes change
const VERSION_KEY = 'pharmacy_indexes_version';

/**
 * Check if indexes are already initialized for current version
 */
const checkIndexesVersion = async () => {
  try {
    const versionDoc = await syncMetadataDB.get(VERSION_KEY);
    return versionDoc.version === INDEXES_VERSION;
  } catch (error) {
    if (error.name === 'not_found') {
      return false;
    }
    console.warn('⚠️ Error checking indexes version:', error);
    return false;
  }
};

/**
 * Save current indexes version
 */
const saveIndexesVersion = async () => {
  try {
    let versionDoc;
    try {
      versionDoc = await syncMetadataDB.get(VERSION_KEY);
      versionDoc.version = INDEXES_VERSION;
      versionDoc.updatedAt = new Date().toISOString();
    } catch (error) {
      if (error.name === 'not_found') {
        versionDoc = {
          _id: VERSION_KEY,
          version: INDEXES_VERSION,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      } else {
        throw error;
      }
    }
    
    await syncMetadataDB.put(versionDoc);
    console.log(`✅ Indexes version ${INDEXES_VERSION} saved`);
  } catch (error) {
    console.error('❌ Error saving indexes version:', error);
  }
};

// =================================================================
//  INDEX DEFINITIONS
// =================================================================

const INDEX_DEFINITIONS = {
  // PRODUCTS DATABASE INDEXES
  products: [
    {
      index: {
        fields: ['type', 'name', 'sku', 'barcode', 'category', 'totalQuantity'],
        name: 'pos-products-compound'
      }
    },
    {
      index: {
        fields: ['category', 'name'],
        name: 'product-category-filter',
        partial_filter_selector: {
          name: { $gt: null },
          retailPrice: { $gt: 0 },
          barcode: { $exists: true },
          totalQuantity: { $gte: 0 }
        }
      }
    },
    {
      index: {
        fields: ['name', 'category', 'sku', 'retailPrice', 'totalQuantity', 'type'],
        name: 'product-sorting-comprehensive'
      }
    },
    {
      index: {
        fields: ['type', 'name', 'category'],
        name: 'product-type-basic'
      }
    },
    {
      index: {
        fields: ['totalQuantity', 'name', 'category'],
        name: 'product-stock-levels'
      }
    },
    {
      index: {
        fields: ['batches.[].expDate', 'name', 'totalQuantity'],
        name: 'product-batch-expiry',
        partial_filter_selector: {
          name: { $gt: null },
          retailPrice: { $gt: 0 },
          barcode: { $exists: true },
          totalQuantity: { $gte: 0 }
        }
      }
    },
    {
      index: {
        fields: ['type', 'category'],
        name: 'type-category-index'
      }
    },
    {
      index: {
        fields: ['type', 'updatedAt'],
        name: 'type-updated-index'
      }
    },
    {
      index: {
        fields: ['type', 'name'],
        name: 'type-name-index'
      }
    },
    {
      index: {
        fields: ['type', 'createdAt'],
        name: 'type-created-index'
      }
    },
    {
      index: {
        fields: ['type', 'barcode'],
        name: 'type-barcode-index'
      }
    },
    {
      index: {
        fields: ['type', 'sku'],
        name: 'type-sku-index'
      }
    }
  ],

  // PURCHASES DATABASE INDEXES
  purchases: [
    {
      index: {
        fields: ['supplierId', 'type', 'createdAt'],
        name: 'purchases-by-supplier-index'
      }
    },
    {
      index: {
        fields: ['supplierId', 'amountDue', 'status', 'createdAt'],
        name: 'supplier-payments-index'
      }
    },
    {
      index: {
        fields: ['originalPurchaseId', 'type', 'createdAt'],
        name: 'purchase-returns-index'
      }
    },
    {
      index: {
        fields: ['type', 'status', 'amountDue', 'createdAt'],
        name: 'purchases-by-status-index'
      }
    },
    {
      index: {
        fields: ['createdAt', 'type', 'totals.grandTotal'],
        name: 'purchases-by-date-index'
      }
    },
    {
      index: {
        fields: ['type', 'createdAt'],
        name: 'purchases-type-date-index'
      }
    },
    {
      index: {
        fields: ['status', 'createdAt'],
        name: 'purchases-status-date-index'
      }
    },
    {
      index: {
        fields: ['amountDue', 'createdAt'],
        name: 'purchases-amount-due-index'
      }
    }
  ],

  // SALES DATABASE INDEXES
  sales: [
    {
      index: {
        fields: ['customerId', 'type', 'createdAt'],
        name: 'sales-by-customer-index'
      }
    },
    {
      index: {
        fields: ['createdAt'],
        name: 'sales-by-date-desc-index',
        sort: [{ createdAt: 'desc' }]
      }
    },
    {
      index: {
        fields: ['type', 'createdAt', 'total', 'profit', 'amountPaid'],
        name: 'dashboard-stats-index'
      }
    },
    {
      index: {
        fields: ['createdAt', 'type', 'total'],
        name: 'sales-by-date-index'
      }
    },
    {
      index: {
        fields: ['originalInvoiceId', 'type', 'returnedAt'],
        name: 'returns-by-invoice-index'
      }
    },
    {
      index: {
        fields: ['type', 'customerName', '_id', 'createdAt'],
        name: 'sales-customer-search-index'
      }
    },
    {
      index: {
        fields: ['_id', 'type'],
        name: 'invoice-id-search-index'
      }
    },
    {
      index: {
        fields: ['type', 'amountPaid', 'total', 'createdAt'],
        name: 'sales-by-payment-status-index'
      }
    },
    {
      index: {
        fields: ['type', 'total', 'createdAt'],
        name: 'sales-revenue-index'
      }
    },
    {
      index: {
        fields: ['profit', 'createdAt'],
        name: 'sales-profit-index'
      }
    }
  ],

  // CUSTOMERS DATABASE INDEXES
  customers: [
    {
      index: {
        fields: ['isActive', 'balance', 'lastTransactionDate'],
        name: 'customer-payments-index'
      }
    },
    {
      index: {
        fields: ['name', 'phone', 'isActive'],
        name: 'customers-search-index'
      }
    },
    {
      index: {
        fields: ['balance', 'isActive', 'name'],
        name: 'customer-balance-index'
      }
    },
    {
      index: {
        fields: ['isActive', 'createdAt'],
        name: 'customers-active-index'
      }
    },
    {
      index: {
        fields: ['phone'],
        name: 'customers-phone-index'
      }
    }
  ],

  // SUPPLIERS DATABASE INDEXES
  suppliers: [
    {
      index: {
        fields: ['name', 'phone', 'isActive'],
        name: 'suppliers-search-index'
      }
    },
    {
      index: {
        fields: ['isActive', 'balance', 'lastTransactionDate'],
        name: 'supplier-payments-index'
      }
    },
    {
      index: {
        fields: ['balance', 'isActive', 'name'],
        name: 'supplier-balance-index'
      }
    },
    {
      index: {
        fields: ['isActive', 'createdAt'],
        name: 'suppliers-active-index'
      }
    },
    {
      index: {
        fields: ['phone'],
        name: 'suppliers-phone-index'
      }
    }
  ],

  // TRANSACTIONS DATABASE INDEXES
  transactions: [
    {
      index: {
        fields: ['type', 'createdAt'],
        name: 'transactions-type-date-index'
      }
    },
    {
      index: {
        fields: ['customerId', 'type', 'createdAt'],
        name: 'transactions-customer-index'
      }
    },
    {
      index: {
        fields: ['supplierId', 'type', 'createdAt'],
        name: 'transactions-supplier-index'
      }
    },
    {
      index: {
        fields: ['amount', 'type', 'createdAt'],
        name: 'transactions-amount-index'
      }
    },
    {
      index: {
        fields: ['paymentMethod', 'createdAt'],
        name: 'transactions-payment-method-index'
      }
    }
  ],

  // BATCHES DATABASE INDEXES
  batches: [
    {
      index: {
        fields: ['productId', 'expDate', 'quantity'],
        name: 'batches-product-expiry-index'
      }
    },
    {
      index: {
        fields: ['expDate', 'quantity'],
        name: 'batches-expiry-index'
      }
    },
    {
      index: {
        fields: ['productId', 'batchNumber'],
        name: 'batches-product-batch-index'
      }
    },
    {
      index: {
        fields: ['quantity', 'expDate'],
        name: 'batches-stock-expiry-index'
      }
    }
  ],

  // DASHBOARD STATS DATABASE INDEXES
  dashboardStats: [
    {
      index: {
        fields: ['type', 'date', 'value'],
        name: 'dashboard-stats-type-date-index'
      }
    },
    {
      index: {
        fields: ['date', 'type'],
        name: 'dashboard-stats-date-index'
      }
    },
    {
      index: {
        fields: ['category', 'date'],
        name: 'dashboard-stats-category-index'
      }
    }
  ],

  // SEARCH CACHE DATABASE INDEXES
  searchCache: [
    {
      index: {
        fields: ['query', 'timestamp'],
        name: 'search-cache-query-index'
      }
    },
    {
      index: {
        fields: ['type', 'timestamp'],
        name: 'search-cache-type-index'
      }
    }
  ]
};

// =================================================================
//  SMART INDEX CREATION
// =================================================================

/**
 * Check if a specific index exists in a database
 */
const indexExists = async (database, indexName) => {
  try {
    const indexes = await database.getIndexes();
    return indexes.indexes.some(idx => idx.name === indexName);
  } catch (error) {
    console.warn(`⚠️ Error checking index existence for ${indexName}:`, error);
    return false;
  }
};

/**
 * Create indexes for a specific database (only if they don't exist)
 */
const createIndexesForDatabase = async (database, indexes, dbName) => {
  console.log(`🔄 Checking indexes for ${dbName}...`);
  
  const results = [];
  let createdCount = 0;
  let existingCount = 0;
  
  for (const indexDef of indexes) {
    try {
      const exists = await indexExists(database, indexDef.index.name);
      
      if (exists) {
        existingCount++;
        results.push({ 
          name: indexDef.index.name, 
          status: 'exists'
        });
      } else {
        const result = await database.createIndex(indexDef);
        createdCount++;
        results.push({ 
          name: indexDef.index.name, 
          status: 'created',
          result: result.result 
        });
        console.log(`✅ Index '${indexDef.index.name}' created for ${dbName}`);
      }
    } catch (error) {
      console.error(`❌ Failed to create index '${indexDef.index.name}' for ${dbName}:`, error);
      results.push({ 
        name: indexDef.index.name, 
        status: 'error', 
        error: error.message 
      });
    }
  }
  
  if (createdCount > 0) {
    console.log(`✅ ${dbName}: Created ${createdCount} new indexes, ${existingCount} already existed`);
  } else if (existingCount > 0) {
    console.log(`ℹ️ ${dbName}: All ${existingCount} indexes already exist`);
  }
  
  return results;
};

/**
 * Create all indexes for all databases (with smart checking)
 */
export const createAllIndexes = async (force = false) => {
  console.log('🚀 Starting smart index creation for all databases...');
  
  // Check if indexes are already up to date (unless forced)
  if (!force) {
    const isUpToDate = await checkIndexesVersion();
    if (isUpToDate) {
      console.log(`ℹ️ Indexes already up to date (version ${INDEXES_VERSION}), skipping creation`);
      return { success: true, skipped: true, message: 'Indexes already up to date' };
    }
  }
  
  const indexResults = {};
  let totalCreated = 0;
  let totalExisting = 0;
  
  try {
    // Create indexes for each database
    const databases = [
      { db: productsDB, name: 'products', indexes: INDEX_DEFINITIONS.products },
      { db: purchasesDB, name: 'purchases', indexes: INDEX_DEFINITIONS.purchases },
      { db: salesDB, name: 'sales', indexes: INDEX_DEFINITIONS.sales },
      { db: customersDB, name: 'customers', indexes: INDEX_DEFINITIONS.customers },
      { db: suppliersDB, name: 'suppliers', indexes: INDEX_DEFINITIONS.suppliers },
      { db: transactionsDB, name: 'transactions', indexes: INDEX_DEFINITIONS.transactions },
      { db: batchesDB, name: 'batches', indexes: INDEX_DEFINITIONS.batches },
      { db: dashboardStatsDB, name: 'dashboardStats', indexes: INDEX_DEFINITIONS.dashboardStats },
      { db: searchCacheDB, name: 'searchCache', indexes: INDEX_DEFINITIONS.searchCache }
    ];
    
    for (const { db, name, indexes } of databases) {
      const results = await createIndexesForDatabase(db, indexes, name);
      indexResults[name] = results;
      
      totalCreated += results.filter(r => r.status === 'created').length;
      totalExisting += results.filter(r => r.status === 'exists').length;
    }
    
    // Save the current version
    await saveIndexesVersion();
    
    console.log(`✅ Index creation completed! Created: ${totalCreated}, Existing: ${totalExisting}`);
    return { 
      success: true, 
      results: indexResults,
      totalCreated,
      totalExisting,
      message: `Created ${totalCreated} new indexes, ${totalExisting} already existed`
    };
    
  } catch (error) {
    console.error('❌ Error creating database indexes:', error);
    return { success: false, error: error.message, results: indexResults };
  }
};

/**
 * Get index information for a database
 */
export const getIndexInfo = async (database, dbName) => {
  try {
    const indexes = await database.getIndexes();
    console.log(`📊 Indexes for ${dbName}:`, indexes);
    return indexes;
  } catch (error) {
    console.error(`❌ Error getting indexes for ${dbName}:`, error);
    return null;
  }
};

/**
 * Get index information for all databases
 */
export const getAllIndexInfo = async () => {
  console.log('📊 Getting index information for all databases...');
  
  const indexInfo = {};
  
  const databases = [
    { db: productsDB, name: 'products' },
    { db: purchasesDB, name: 'purchases' },
    { db: salesDB, name: 'sales' },
    { db: customersDB, name: 'customers' },
    { db: suppliersDB, name: 'suppliers' },
    { db: transactionsDB, name: 'transactions' },
    { db: batchesDB, name: 'batches' },
    { db: dashboardStatsDB, name: 'dashboardStats' },
    { db: searchCacheDB, name: 'searchCache' }
  ];
  
  for (const { db, name } of databases) {
    indexInfo[name] = await getIndexInfo(db, name);
  }
  
  return indexInfo;
};

/**
 * Delete an index from a database
 */
export const deleteIndex = async (database, indexName, dbName) => {
  try {
    await database.deleteIndex(indexName);
    console.log(`🗑️ Index '${indexName}' deleted from ${dbName}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error deleting index '${indexName}' from ${dbName}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Rebuild all indexes (delete and recreate)
 */
export const rebuildAllIndexes = async () => {
  console.log('🔄 Rebuilding all indexes...');
  
  try {
    // Get current indexes for all databases
    const currentIndexes = await getAllIndexInfo();
    
    // Delete existing custom indexes (keep _all_docs)
    for (const [dbName, indexes] of Object.entries(currentIndexes)) {
      if (indexes && indexes.indexes) {
        for (const index of indexes.indexes) {
          if (index.name !== '_all_docs' && index.ddoc) {
            const database = getDatabaseByName(dbName);
            if (database) {
              await deleteIndex(database, index, dbName);
            }
          }
        }
      }
    }
    
    // Recreate all indexes (forced)
    const result = await createAllIndexes(true);
    
    console.log('✅ All indexes rebuilt successfully!');
    return result;
    
  } catch (error) {
    console.error('❌ Error rebuilding indexes:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get database instance by name
 */
const getDatabaseByName = (name) => {
  const dbMap = {
    products: productsDB,
    purchases: purchasesDB,
    sales: salesDB,
    customers: customersDB,
    suppliers: suppliersDB,
    transactions: transactionsDB,
    batches: batchesDB,
    dashboardStats: dashboardStatsDB,
    searchCache: searchCacheDB
  };
  
  return dbMap[name];
};

/**
 * Initialize all databases with indexes (smart initialization)
 */
export const initializeDatabases = async () => {
  if (isInitialized) {
    console.log('ℹ️ Databases already initialized, skipping...');
    return { success: true, message: 'Already initialized' };
  }
  
  console.log('🚀 Initializing all databases with indexes...');
  
  try {
    // Create all indexes (with smart checking)
    const result = await createAllIndexes();
    
    if (result.success) {
      isInitialized = true;
      
      if (result.skipped) {
        console.log('ℹ️ Database initialization completed (indexes were up to date)');
      } else {
        console.log('✅ All databases initialized successfully with indexes!');
        console.log(`📊 Summary: ${result.totalCreated} created, ${result.totalExisting} existing`);
      }
      
      return { success: true, message: 'Databases initialized successfully', ...result };
    } else {
      throw new Error(result.error);
    }
    
  } catch (error) {
    console.error('❌ Error initializing databases:', error);
    return { success: false, error: error.message };
  }
};

// =================================================================
//  DATABASE HEALTH CHECK
// =================================================================

/**
 * Check database health and index status
 */
export const checkDatabaseHealth = async () => {
  console.log('🏥 Checking database health...');
  
  const healthStatus = {
    databases: {},
    overall: 'healthy',
    totalIndexes: 0,
    issues: [],
    indexesVersion: await checkIndexesVersion() ? INDEXES_VERSION : 'outdated'
  };
  
  const databases = [
    { db: productsDB, name: 'products', expectedIndexes: INDEX_DEFINITIONS.products.length },
    { db: purchasesDB, name: 'purchases', expectedIndexes: INDEX_DEFINITIONS.purchases.length },
    { db: salesDB, name: 'sales', expectedIndexes: INDEX_DEFINITIONS.sales.length },
    { db: customersDB, name: 'customers', expectedIndexes: INDEX_DEFINITIONS.customers.length },
    { db: suppliersDB, name: 'suppliers', expectedIndexes: INDEX_DEFINITIONS.suppliers.length },
    { db: transactionsDB, name: 'transactions', expectedIndexes: INDEX_DEFINITIONS.transactions.length },
    { db: batchesDB, name: 'batches', expectedIndexes: INDEX_DEFINITIONS.batches.length },
    { db: dashboardStatsDB, name: 'dashboardStats', expectedIndexes: INDEX_DEFINITIONS.dashboardStats.length },
    { db: searchCacheDB, name: 'searchCache', expectedIndexes: INDEX_DEFINITIONS.searchCache.length }
  ];
  
  for (const { db, name, expectedIndexes } of databases) {
    try {
      const info = await db.info();
      const indexes = await db.getIndexes();
      
      const actualIndexes = indexes.indexes.filter(idx => idx.name !== '_all_docs').length;
      
      healthStatus.databases[name] = {
        docCount: info.doc_count,
        updateSeq: info.update_seq,
        diskSize: info.disk_size,
        expectedIndexes,
        actualIndexes,
        indexesHealthy: actualIndexes >= expectedIndexes,
        status: actualIndexes >= expectedIndexes ? 'healthy' : 'missing_indexes'
      };
      
      healthStatus.totalIndexes += actualIndexes;
      
      if (actualIndexes < expectedIndexes) {
        healthStatus.issues.push(`${name}: Missing ${expectedIndexes - actualIndexes} indexes`);
        healthStatus.overall = 'degraded';
      }
      
    } catch (error) {
      healthStatus.databases[name] = {
        status: 'error',
        error: error.message
      };
      healthStatus.issues.push(`${name}: Database error - ${error.message}`);
      healthStatus.overall = 'unhealthy';
    }
  }
  
  console.log('🏥 Database health check completed:', healthStatus);
  return healthStatus;
};

// =================================================================
//  SMART INITIALIZATION CONTROL
// =================================================================

/**
 * Ensure indexes are created (with proper singleton pattern)
 */
export const ensureIndexes = async () => {
  if (initializationPromise) {
    return initializationPromise;
  }
  
  initializationPromise = initializeDatabases();
  return initializationPromise;
};

/**
 * Force index recreation (useful for development/debugging)
 */
export const forceIndexRecreation = async () => {
  console.log('🔄 Forcing index recreation...');
  isInitialized = false;
  initializationPromise = null;
  
  const result = await createAllIndexes(true);
  if (result.success) {
    isInitialized = true;
  }
  
  return result;
};

/**
 * Reset initialization state (useful for testing)
 */
export const resetInitialization = () => {
  isInitialized = false;
  initializationPromise = null;
  console.log('🔄 Database initialization state reset');
};

// =================================================================
//  CONTROLLED AUTO-INITIALIZATION
// =================================================================

// Only auto-initialize in production or when explicitly requested
const shouldAutoInitialize = () => {
  // Check if we're in development mode
  const isDev = process.env.NODE_ENV === 'development' || 
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';
  
  // Check for explicit initialization flag
  const forceInit = localStorage.getItem('pharmacy_force_index_init') === 'true';
  
  return !isDev || forceInit;
};

// Auto-initialize with better control
if (shouldAutoInitialize()) {
  // Use a longer delay to avoid interfering with app startup
  setTimeout(() => {
    ensureIndexes().catch(error => {
      console.error('❌ Auto-initialization failed:', error);
    });
  }, 2000); // Increased delay to 2 seconds
} else {
  console.log('ℹ️ Skipping auto-initialization in development mode');
}

// =================================================================
//  EXPORT ALL DATABASES AND UTILITIES
// =================================================================

export default {
  // Database instances
  productsDB,
  batchesDB,
  inventoryStatsDB,
  purchasesDB,
  salesDB,
  salesStatsDB,
  customersDB,
  suppliersDB,
  transactionsDB,
  returnsDB,
  transactionStatsDB,
  dashboardStatsDB,
  chartDataDB,
  productAnalyticsDB,
  peakHoursDB,
  heatmapDataDB,
  searchCacheDB,
  syncMetadataDB,
  dashboardMetadataDB,
  
  // Index management functions
  createAllIndexes,
  getAllIndexInfo,
  getIndexInfo,
  deleteIndex,
  rebuildAllIndexes,
  initializeDatabases,
  ensureIndexes,
  checkDatabaseHealth,
  forceIndexRecreation,
  resetInitialization,
  
  // Index definitions (for reference)
  INDEX_DEFINITIONS,
  
  // Version info
  INDEXES_VERSION
};
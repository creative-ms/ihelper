// ===================================
// src/utils/cache/databases.js - PouchDB with Complete Indexing
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
//  INDEX CREATION FUNCTIONS
// =================================================================

/**
 * Create indexes for a specific database
 */
const createIndexesForDatabase = async (database, indexes, dbName) => {
  console.log(`🔄 Creating indexes for ${dbName}...`);
  
  const results = [];
  for (const indexDef of indexes) {
    try {
      const result = await database.createIndex(indexDef);
      results.push({ 
        name: indexDef.index.name, 
        status: 'created',
        result: result.result 
      });
      
      if (result.result === 'created') {
        console.log(`✅ Index '${indexDef.index.name}' created for ${dbName}`);
      } else {
        console.log(`ℹ️ Index '${indexDef.index.name}' already exists for ${dbName}`);
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
  
  return results;
};

/**
 * Create all indexes for all databases
 */
export const createAllIndexes = async () => {
  console.log('🚀 Starting index creation for all databases...');
  
  const indexResults = {};
  
  try {
    // Create indexes for each database
    indexResults.products = await createIndexesForDatabase(
      productsDB, 
      INDEX_DEFINITIONS.products, 
      'products'
    );
    
    indexResults.purchases = await createIndexesForDatabase(
      purchasesDB, 
      INDEX_DEFINITIONS.purchases, 
      'purchases'
    );
    
    indexResults.sales = await createIndexesForDatabase(
      salesDB, 
      INDEX_DEFINITIONS.sales, 
      'sales'
    );
    
    indexResults.customers = await createIndexesForDatabase(
      customersDB, 
      INDEX_DEFINITIONS.customers, 
      'customers'
    );
    
    indexResults.suppliers = await createIndexesForDatabase(
      suppliersDB, 
      INDEX_DEFINITIONS.suppliers, 
      'suppliers'
    );
    
    indexResults.transactions = await createIndexesForDatabase(
      transactionsDB, 
      INDEX_DEFINITIONS.transactions, 
      'transactions'
    );
    
    indexResults.batches = await createIndexesForDatabase(
      batchesDB, 
      INDEX_DEFINITIONS.batches, 
      'batches'
    );
    
    indexResults.dashboardStats = await createIndexesForDatabase(
      dashboardStatsDB, 
      INDEX_DEFINITIONS.dashboardStats, 
      'dashboardStats'
    );
    
    indexResults.searchCache = await createIndexesForDatabase(
      searchCacheDB, 
      INDEX_DEFINITIONS.searchCache, 
      'searchCache'
    );
    
    console.log('✅ All database indexes created successfully!');
    return { success: true, results: indexResults };
    
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
    
    // Recreate all indexes
    const result = await createAllIndexes();
    
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
 * Initialize all databases with indexes
 */
export const initializeDatabases = async () => {
  console.log('🚀 Initializing all databases with indexes...');
  
  try {
    // Create all indexes
    const result = await createAllIndexes();
    
    if (result.success) {
      console.log('✅ All databases initialized successfully with indexes!');
      
      // Log summary
      const totalIndexes = Object.values(result.results)
        .reduce((total, dbResults) => total + dbResults.length, 0);
      
      console.log(`📊 Total indexes created: ${totalIndexes}`);
      
      return { success: true, message: 'Databases initialized successfully' };
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
    issues: []
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
//  AUTO-INITIALIZATION
// =================================================================

// Automatically initialize databases when this module is imported
// This ensures indexes are created when the app starts
let initializationPromise = null;

export const ensureIndexes = async () => {
  if (!initializationPromise) {
    initializationPromise = initializeDatabases();
  }
  return initializationPromise;
};

// Initialize on module load (but don't block)
setTimeout(() => {
  ensureIndexes().catch(error => {
    console.error('❌ Auto-initialization failed:', error);
  });
}, 1000);

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
  
  // Index definitions (for reference)
  INDEX_DEFINITIONS
};
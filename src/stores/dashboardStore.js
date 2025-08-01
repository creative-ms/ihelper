// ===================================
// OPTIMIZED DASHBOARD STORE - POUCHDB ONLY VERSION
// File: src/stores/dashboardStore.js
// ===================================

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import {
  calculateStats,
  processChartData,
  processHeatmapData,
  processPeakHoursData,
  processProductAnalytics,
} from './dashboard/helpers';
import EnhancedDashboardCache from './dashboard/DashboardWorkerManager';
import CacheManager from '../utils/cache';

// Import PouchDB databases
import {
  salesDB,
  productsDB,
  customersDB,
  suppliersDB,
  purchasesDB,
  transactionsDB
} from '../utils/cache/databases';

// 🔥 POS-FRIENDLY CACHE CONFIGURATION
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes (longer for POS optimization)
const BACKGROUND_REFRESH_DELAY = 30 * 1000; // 30 seconds after POS transaction
const MAX_CACHE_AGE = 60 * 60 * 1000; // 1 hour maximum before forced refresh

// Smart cache with transaction-based invalidation
let persistentCache = {
  data: null,
  timestamp: 0,
  lastTransactionId: null,
  lastSaleId: null,
  backgroundUpdateScheduled: false
};

// Enhanced cache instance (lazy loaded)
let enhancedCache = null;
let backgroundRefreshTimeout = null;

// ========================================
// DEFAULT DATA STRUCTURES
// ========================================

const getDefaultStats = () => ({
  totalSales: 0,
  itemsSold: 0,
  revenue: 0,
  profit: 0,
  averageSale: 0,
  cashInflow: 0,
  cashOutflow: 0,
  netCashFlow: 0,
  totalSupplierRefund: 0,
  totalCustomerRefund: 0,
  totalReceivable: 0,
  totalPayable: 0,
  customerCredit: 0,
  supplierCredit: 0,
  totalPurchase: 0
});

const getDefaultChartData = () => ({
  daily: { labels: [], revenue: [], sales: [], profit: [] },
  weekly: { labels: [], revenue: [], sales: [], profit: [] },
  monthly: { labels: [], revenue: [], sales: [], profit: [] },
});

const getDefaultProductPerformance = () => ({
  topSellingProducts: [],
  slowMovingProducts: [],
  productPerformanceSummary: {
    topSellingProducts: [],
    slowMovingProducts: [],
    metrics: {
      totalActiveProducts: 0,
      productsWithSales: 0,
      slowMovingCount: 0,
      salesPerformanceRate: 0
    }
  }
});

// Validation functions
const validateAllDocs = (allDocs) => {
  if (!allDocs || typeof allDocs !== 'object') {
    return {
      isValid: false,
      counts: { sales: 0, products: 0, customers: 0, suppliers: 0, purchases: 0, transactions: 0, total: 0 },
      hasMinimumData: false,
      hasCompleteData: false
    };
  }

  const normalizedDocs = {
    sales: Array.isArray(allDocs.sales) ? allDocs.sales : [],
    products: Array.isArray(allDocs.products) ? allDocs.products : [],
    customers: Array.isArray(allDocs.customers) ? allDocs.customers : [],
    suppliers: Array.isArray(allDocs.suppliers) ? allDocs.suppliers : [],
    purchases: Array.isArray(allDocs.purchases) ? allDocs.purchases : [],
    transactions: Array.isArray(allDocs.transactions) ? allDocs.transactions : []
  };

  const counts = {
    sales: normalizedDocs.sales.length,
    products: normalizedDocs.products.length,
    customers: normalizedDocs.customers.length,
    suppliers: normalizedDocs.suppliers.length,
    purchases: normalizedDocs.purchases.length,
    transactions: normalizedDocs.transactions.length,
    total: Object.values(normalizedDocs).reduce((sum, arr) => sum + arr.length, 0)
  };
  
  return {
    isValid: true,
    counts,
    hasMinimumData: true,
    hasCompleteData: counts.sales >= 0 && counts.products >= 0,
    normalizedDocs
  };
};

// 🔥 NEW: PouchDB data fetching functions
const fetchFromPouchDB = async (database, limit = 1000) => {
  try {
    const result = await database.allDocs({
      include_docs: true,
      limit: limit,
      descending: true
    });
    
    return result.rows
      .map(row => row.doc)
      .filter(doc => doc && !doc._id.startsWith('_design'));
  } catch (error) {
    console.error(`Error fetching from PouchDB:`, error);
    return [];
  }
};

// 🔥 NEW: Smart background data refresh triggered by POS transactions
const scheduleBackgroundRefresh = (reason = 'unknown') => {
  if (persistentCache.backgroundUpdateScheduled) {
    console.log('🔄 Background refresh already scheduled, skipping');
    return;
  }

  if (backgroundRefreshTimeout) {
    clearTimeout(backgroundRefreshTimeout);
  }

  persistentCache.backgroundUpdateScheduled = true;
  
  backgroundRefreshTimeout = setTimeout(async () => {
    console.log(`🔄 Background refresh triggered by: ${reason}`);
    
    try {
      // Only refresh if someone might be interested in dashboard data
      const store = useDashboardStore.getState();
      if (document.visibilityState === 'visible' || store.lastFetch) {
        await refreshDashboardDataInBackground();
      } else {
        console.log('📱 App not visible, skipping background refresh');
      }
    } catch (error) {
      console.error('❌ Background refresh failed:', error);
    } finally {
      persistentCache.backgroundUpdateScheduled = false;
    }
  }, BACKGROUND_REFRESH_DELAY);
};

// 🔥 NEW: Background data refresh function
const refreshDashboardDataInBackground = async () => {
  try {
    console.log('🔄 Starting background data refresh...');
    
    // Fetch fresh data from PouchDB
    const [sales, products, customers, suppliers, purchases, transactions] = await Promise.all([
      fetchFromPouchDB(salesDB, 1000),
      fetchFromPouchDB(productsDB, 500),
      fetchFromPouchDB(customersDB, 500),
      fetchFromPouchDB(suppliersDB, 500),
      fetchFromPouchDB(purchasesDB, 1000),
      fetchFromPouchDB(transactionsDB, 1000)
    ]);

    const allDocs = {
      sales,
      products,
      customers,
      suppliers,
      purchases,
      transactions
    };

    // Update cache silently
    const validation = validateAllDocs(allDocs);
    if (validation.isValid) {
      persistentCache.data = validation.normalizedDocs || allDocs;
      persistentCache.timestamp = Date.now();
      
      // Track latest transaction IDs for smart invalidation
      const latestSale = sales?.[0];
      const latestTransaction = transactions?.[0];
      
      if (latestSale) persistentCache.lastSaleId = latestSale._id;
      if (latestTransaction) persistentCache.lastTransactionId = latestTransaction._id;

      console.log('✅ Background refresh completed, cache updated');
      
      // Update dashboard store if it's currently active
      const store = useDashboardStore.getState();
      if (store.lastFetch && (Date.now() - store.lastFetch) < 300000) { // Active in last 5 minutes
        store.processDataSilently(persistentCache.data);
      }
    }
    
  } catch (error) {
    console.error('❌ Background refresh failed:', error);
  }
};

// 🔥 NEW: Initialize enhanced cache lazily
const initializeEnhancedCache = async () => {
  if (enhancedCache) return enhancedCache;
  
  try {
    console.log('🚀 Initializing enhanced cache (lazy loading)...');
    enhancedCache = new EnhancedDashboardCache();
    console.log('✅ Enhanced cache initialized');
    return enhancedCache;
  } catch (error) {
    console.error('❌ Failed to initialize enhanced cache:', error);
    enhancedCache = null;
    return null;
  }
};

export const useDashboardStore = create(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        timeframe: 'today',
        customDateRange: { start: null, end: null },
        stats: getDefaultStats(),
        chartData: getDefaultChartData(),
        peakHoursData: {
          daily: { revenue: [], sales: [], profit: [] },
          weekly: { revenue: [], sales: [], profit: [] },
          monthly: { revenue: [], sales: [], profit: [] },
        },
        cashflowHeatmapData: {},
        productPerformance: getDefaultProductPerformance(),
        
        isLoading: false,
        error: null,
        lastFetch: null,
        connectionStatus: 'local', // Changed from 'unknown' to 'local'
        
        fetchStartTime: null,
        fetchDuration: null,
        
        isLoadingProducts: false,
        productError: null,
        isBackgroundProcessing: false,
        backgroundProgress: 0,

        // 🔥 NEW: POS-friendly state management
        isInitialized: false,
        initializationError: null,
        cacheAge: null,
        lastBackgroundRefresh: null,

        // 🔥 NEW: Lightweight initialization - no heavy operations
        initializeDashboard: async () => {
          console.log('🚀 Initializing dashboard (PouchDB-only mode)...');
          
          set({ 
            isInitialized: true,
            initializationError: null,
            connectionStatus: 'local'
          });

          // Load from cache immediately if available
          const cacheAge = persistentCache.timestamp ? Date.now() - persistentCache.timestamp : null;
          
          if (persistentCache.data && cacheAge < MAX_CACHE_AGE) {
            console.log(`📚 Loading from persistent cache (${Math.round(cacheAge / 1000)}s old)`);
            set({ cacheAge: Math.round(cacheAge / 1000) });
            get().processDataSilently(persistentCache.data);
          } else {
            console.log('🔄 Cache expired or empty, fetching fresh data...');
            get().fetchDashboardData();
          }
        },

        // 🔥 NEW: Silent cleanup - no immediate termination
        deactivateDashboard: () => {
          console.log('😴 Dashboard deactivated - data remains cached for fast re-access');
          
          // Don't clear data, just mark as inactive
          set({ 
            isLoading: false,
            isLoadingProducts: false,
            isBackgroundProcessing: false
          });
          
          // Enhanced cache can stay alive for better performance
        },

        // 🔥 OPTIMIZED: Smart cache-first data fetching from PouchDB
        fetchDashboardData: async () => {
          const state = get();
          if (state.isLoading) {
            console.log('⏸️ Already loading, skipping duplicate fetch');
            return;
          }

          const currentTime = Date.now();
          const cacheAge = persistentCache.timestamp ? currentTime - persistentCache.timestamp : null;
          
          // Use cache if fresh enough
          if (persistentCache.data && cacheAge < CACHE_DURATION) {
            console.log(`⚡ Using cached data (${Math.round(cacheAge / 1000)}s old)`);
            set({ 
              cacheAge: Math.round(cacheAge / 1000),
              lastFetch: currentTime,
              connectionStatus: 'local'
            });
            get().processDataSilently(persistentCache.data);
            return;
          }

          set({ 
            isLoading: true, 
            isLoadingProducts: true,
            error: null, 
            productError: null,
            fetchStartTime: currentTime 
          });

          try {
            console.log('🔄 Fetching fresh data from PouchDB...');
            
            // Fetch all data from PouchDB in parallel
            const [sales, products, customers, suppliers, purchases, transactions] = await Promise.all([
              fetchFromPouchDB(salesDB, 1000),
              fetchFromPouchDB(productsDB, 500),
              fetchFromPouchDB(customersDB, 500),
              fetchFromPouchDB(suppliersDB, 500),
              fetchFromPouchDB(purchasesDB, 1000),
              fetchFromPouchDB(transactionsDB, 1000)
            ]);

            const allDocs = {
              sales,
              products,
              customers,
              suppliers,
              purchases,
              transactions
            };

            console.log(`📊 Fetched data counts:`, {
              sales: sales.length,
              products: products.length,
              customers: customers.length,
              suppliers: suppliers.length,
              purchases: purchases.length,
              transactions: transactions.length
            });

            // Validate and cache data
            const validation = validateAllDocs(allDocs);
            if (validation.isValid) {
              persistentCache.data = validation.normalizedDocs || allDocs;
              persistentCache.timestamp = currentTime;
              
              // Track latest IDs for smart invalidation
              const latestSale = sales?.[0];
              const latestTransaction = transactions?.[0];
              
              if (latestSale) persistentCache.lastSaleId = latestSale._id;
              if (latestTransaction) persistentCache.lastTransactionId = latestTransaction._id;

              // Process data with enhanced cache if available
              if (!enhancedCache) {
                await initializeEnhancedCache();
              }

              if (enhancedCache) {
                await get().processDataWithEnhancedCache(persistentCache.data);
              } else {
                get().processDataSilently(persistentCache.data);
              }
            }

          } catch (error) {
            console.error("❌ Error fetching dashboard data from PouchDB:", error);
            set({ 
              isLoading: false, 
              isLoadingProducts: false,
              error: error.message || 'Failed to fetch dashboard data',
              productError: error.message || 'Failed to fetch product data',
              connectionStatus: 'error'
            });
          }
        },

        // 🔥 NEW: Silent data processing (no loading states)
        processDataSilently: (allDocs) => {
          try {
            const startTime = Date.now();
            const { timeframe, customDateRange } = get();
            
            const validation = validateAllDocs(allDocs);
            const dataToProcess = validation.normalizedDocs || allDocs;

            const newStats = calculateStats(dataToProcess, timeframe, customDateRange);
            const newChartData = processChartData(dataToProcess.sales || []);
            const newPeakHoursData = processPeakHoursData(dataToProcess.sales || []);
            const { cashflowHeatmap } = processHeatmapData(dataToProcess);

            let productAnalytics = getDefaultProductPerformance();
            try {
              if (dataToProcess.sales && dataToProcess.products) {
                productAnalytics = processProductAnalytics(dataToProcess, timeframe, customDateRange);
              }
            } catch (productError) {
              console.error('Error processing product analytics:', productError);
            }

            const processingTime = Date.now() - startTime;
            
            set({
              stats: newStats || getDefaultStats(),
              chartData: newChartData || getDefaultChartData(),
              peakHoursData: newPeakHoursData || get().peakHoursData,
              cashflowHeatmapData: cashflowHeatmap || {},
              productPerformance: productAnalytics || getDefaultProductPerformance(),
              isLoading: false,
              isLoadingProducts: false,
              isBackgroundProcessing: false,
              error: null,
              productError: null,
              lastFetch: Date.now(),
              fetchDuration: processingTime,
              connectionStatus: 'local',
              cacheAge: persistentCache.timestamp ? Math.round((Date.now() - persistentCache.timestamp) / 1000) : null
            });

            console.log(`✅ Data processed silently in ${processingTime}ms`);
            
          } catch (error) {
            console.error("❌ Error processing data silently:", error);
          }
        },

        // Enhanced cache processing (optimized)
        processDataWithEnhancedCache: async (allDocs) => {
          const startTime = Date.now();
          const { timeframe, customDateRange } = get();
          const validation = validateAllDocs(allDocs);
          
          if (!validation.isValid || !enhancedCache) {
            get().processDataSilently(allDocs);
            return;
          }

          try {
            const dataToProcess = validation.normalizedDocs || allDocs;
            
            const cachedResult = await enhancedCache.processDataInBackground(
              dataToProcess, 
              timeframe, 
              customDateRange
            );

            if (cachedResult) {
              const processingTime = Date.now() - startTime;
              
              set({
                stats: cachedResult.stats || getDefaultStats(),
                chartData: cachedResult.chartData || getDefaultChartData(),
                productPerformance: cachedResult.productPerformance || getDefaultProductPerformance(),
                isLoading: false,
                isLoadingProducts: false,
                isBackgroundProcessing: false,
                error: null,
                productError: null,
                lastFetch: Date.now(),
                fetchDuration: processingTime,
                connectionStatus: 'local',
                cacheAge: persistentCache.timestamp ? Math.round((Date.now() - persistentCache.timestamp) / 1000) : null
              });

              console.log(`✅ Enhanced processing completed in ${processingTime}ms${cachedResult.fromCache ? ' (cached)' : ' (fresh)'}`);
              return;
            }

            // Fallback to silent processing
            get().processDataSilently(dataToProcess);
            
          } catch (error) {
            console.error("❌ Enhanced processing failed:", error);
            get().processDataSilently(validation.normalizedDocs || allDocs);
          }
        },

        // 🔥 NEW: POS transaction event handler
        handlePOSTransaction: (transactionData) => {
          console.log('💰 POS transaction detected, scheduling background refresh...');
          
          // Update tracked IDs for smart invalidation
          if (transactionData.saleId && transactionData.saleId !== persistentCache.lastSaleId) {
            persistentCache.lastSaleId = transactionData.saleId;
            scheduleBackgroundRefresh('new_sale');
          }
          
          if (transactionData.transactionId && transactionData.transactionId !== persistentCache.lastTransactionId) {
            persistentCache.lastTransactionId = transactionData.transactionId;
            scheduleBackgroundRefresh('new_transaction');
          }
        },

        // Optimized timeframe changes
        setTimeframe: (newTimeframe) => {
          const currentState = get();
          if (currentState.timeframe === newTimeframe) return;
          
          set({ 
            timeframe: newTimeframe, 
            customDateRange: { start: null, end: null },
            error: null,
            productError: null 
          });
          
          // Process with cached data if available
          if (persistentCache.data) {
            setTimeout(() => {
              get().processDataSilently(persistentCache.data);
            }, 10);
          }
        },

        setCustomDateRange: (startDate, endDate) => {
          const currentState = get();
          if (currentState.customDateRange.start === startDate && 
              currentState.customDateRange.end === endDate) return;
          
          set({ 
            timeframe: 'custom', 
            customDateRange: { start: startDate, end: endDate },
            error: null,
            productError: null 
          });
          
          // Process with cached data if available
          if (persistentCache.data) {
            setTimeout(() => {
              get().processDataSilently(persistentCache.data);
            }, 10);
          }
        },

        // Manual refresh with cache invalidation
        refreshData: async () => {
          console.log('🔄 Manual refresh initiated');
          persistentCache.timestamp = 0; // Force refresh
          await get().fetchDashboardData();
        },

        // Get cache status
        getCacheStatus: async () => {
          try {
            const cacheAge = persistentCache.timestamp ? Date.now() - persistentCache.timestamp : null;
            const [dashboardCache] = await Promise.all([
              CacheManager.dashboardHealthCheck()
            ]);

            return {
              traditional: {
                hasCache: !!persistentCache.data,
                cacheAge,
                isExpired: cacheAge ? cacheAge > CACHE_DURATION : true,
                lastRefresh: persistentCache.timestamp
              },
              enhanced: dashboardCache,
              backgroundProcessing: get().isBackgroundProcessing,
              isDashboardActive: true,
              enhancedCacheAvailable: !!enhancedCache,
              lastBackgroundRefresh: get().lastBackgroundRefresh,
              storageMode: 'PouchDB-only'
            };
          } catch (error) {
            console.error('Error getting cache status:', error);
            return {
              traditional: { hasCache: false, cacheAge: null, isExpired: true },
              enhanced: { healthy: false, error: error.message },
              backgroundProcessing: false,
              isDashboardActive: true,
              enhancedCacheAvailable: false,
              storageMode: 'PouchDB-only'
            };
          }
        },

        // Product-specific actions (optimized)
        getTopSellingProducts: (count = 5) => {
          const { productPerformance } = get();
          return productPerformance?.topSellingProducts?.slice(0, count) || [];
        },

        getSlowMovingProducts: (count = 5) => {
          const { productPerformance } = get();
          return productPerformance?.slowMovingProducts?.slice(0, count) || [];
        },

        getProductPerformanceSummary: () => {
          const { productPerformance } = get();
          return productPerformance?.productPerformanceSummary || getDefaultProductPerformance().productPerformanceSummary;
        },

        // 🔥 NEW: Cleanup optimized for POS performance
        cleanup: () => {
          console.log('🧹 POS-friendly cleanup - keeping cache warm...');
          // Don't actually clean up much - keep data cached for fast access
          if (backgroundRefreshTimeout) {
            clearTimeout(backgroundRefreshTimeout);
            backgroundRefreshTimeout = null;
          }
        }
      }),
      {
        name: 'dashboard-store',
        partialize: (state) => ({
          timeframe: state.timeframe,
          customDateRange: state.customDateRange,
        })
      }
    )
  )
);

// 🔥 NEW: POS Integration - Listen for transaction events
if (typeof window !== 'undefined') {
  // Listen for custom POS transaction events
  window.addEventListener('pos:transaction:completed', (event) => {
    const store = useDashboardStore.getState();
    store.handlePOSTransaction(event.detail);
  });
  
  // Listen for sales completion
  window.addEventListener('pos:sale:completed', (event) => {
    const store = useDashboardStore.getState();
    store.handlePOSTransaction({ saleId: event.detail.saleId });
  });
  
  // Gentle cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (backgroundRefreshTimeout) {
      clearTimeout(backgroundRefreshTimeout);
    }
    // Don't terminate enhanced cache - let it persist
  });
}

// 🔥 NEW: Export function to trigger background refresh from POS
export const triggerDashboardBackgroundRefresh = (reason = 'manual') => {
  scheduleBackgroundRefresh(reason);
};

export default useDashboardStore;
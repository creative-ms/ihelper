// ===================================
// OPTIMIZED DASHBOARD STORE - FIXED LIFECYCLE MANAGEMENT
// File: src/stores/dashboardStore.js
// ===================================

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import axios from 'axios';
import {
  calculateStats,
  processChartData,
  processHeatmapData,
  processPeakHoursData,
  processProductAnalytics,
} from './dashboard/helpers';
import EnhancedDashboardCache from './dashboard/DashboardWorkerManager';
import CacheManager from '../utils/cache';

// Database URLs and Auth
const SALES_DB_URL = 'http://localhost:5984/sales';
const PRODUCTS_DB_URL = 'http://localhost:5984/products';
const CUSTOMERS_DB_URL = 'http://localhost:5984/customers';
const SUPPLIERS_DB_URL = 'http://localhost:5984/suppliers';
const PURCHASES_DB_URL = 'http://localhost:5984/purchases';
const TRANSACTIONS_DB_URL = 'http://localhost:5984/transactions';

const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

// Enhanced Cache management
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let dataCache = {};
let cacheTimestamp = 0;

// 🔥 FIXED: Better activation tracking with reference counting
let dashboardRefCount = 0;
let enhancedCache = null;
let initializationPromise = null;
let cleanupTimeout = null;

// Helper to check if dashboard should be active
const isDashboardActive = () => dashboardRefCount > 0;

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

const validateCachedStats = (stats) => {
  if (!stats || typeof stats !== 'object') return false;
  
  const requiredProps = ['revenue', 'profit', 'totalSales'];
  const hasRequiredProps = requiredProps.every(prop => 
    stats.hasOwnProperty(prop) && 
    typeof stats[prop] === 'number' &&
    !isNaN(stats[prop])
  );
  
  return hasRequiredProps;
};

// Create axios instance
const apiClient = axios.create({
  timeout: 15000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Add interceptors
apiClient.interceptors.request.use(
  (config) => {
    config.auth = DB_AUTH.auth;
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Response Error:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      status: error.response?.status,
    });
    
    if (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED') {
      error.message = 'Cannot connect to CouchDB server. Please check if CouchDB is running on localhost:5984';
    } else if (error.code === 'ERR_FAILED') {
      error.message = 'Request failed. Please check your network connection and CouchDB server status.';
    } else if (error.response?.status === 401) {
      error.message = 'Authentication failed. Please check your CouchDB credentials.';
    } else if (error.response?.status === 404) {
      error.message = 'Database not found. Please check if the database exists in CouchDB.';
    }
    
    return Promise.reject(error);
  }
);

// Test functions
const testConnection = async () => {
  try {
    const response = await apiClient.get('http://localhost:5984/');
    console.log('CouchDB connection successful:', response.data);
    return true;
  } catch (error) {
    console.error('CouchDB connection failed:', error.message);
    return false;
  }
};

const testDatabaseAccess = async (dbUrl) => {
  try {
    const response = await apiClient.get(`${dbUrl}/_all_docs?limit=1`);
    console.log(`Database access successful: ${dbUrl}`);
    return true;
  } catch (error) {
    console.error(`Database access failed for ${dbUrl}:`, error.message);
    return false;
  }
};

// 🔥 NEW: Enhanced cache initialization with proper error handling
const initializeEnhancedCache = async () => {
  if (enhancedCache) return enhancedCache;
  
  try {
    console.log('🚀 Initializing enhanced cache...');
    enhancedCache = new EnhancedDashboardCache();
    console.log('✅ Enhanced cache initialized successfully');
    return enhancedCache;
  } catch (error) {
    console.error('❌ Failed to initialize enhanced cache:', error);
    enhancedCache = null;
    return null;
  }
};

// 🔥 NEW: Proper cleanup with timeout
const scheduleCleanup = () => {
  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout);
  }
  
  cleanupTimeout = setTimeout(() => {
    if (!isDashboardActive()) {
      console.log('🧹 Auto-cleanup: Terminating enhanced cache after inactivity');
      if (enhancedCache) {
        try {
          enhancedCache.terminate();
        } catch (error) {
          console.warn('Warning during cache cleanup:', error);
        }
        enhancedCache = null;
      }
      initializationPromise = null;
    }
  }, 30000); // Clean up after 30 seconds of inactivity
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
        connectionStatus: 'unknown',
        
        fetchStartTime: null,
        fetchDuration: null,
        
        isLoadingProducts: false,
        productError: null,
        isBackgroundProcessing: false,
        backgroundProgress: 0,

        // 🔥 UPDATED: Better initialization tracking
        isInitialized: false,
        initializationError: null,

        // 🔥 FIXED: Proper dashboard initialization with reference counting
        initializeDashboard: async () => {
          const state = get();
          
          // Increment reference count
          dashboardRefCount++;
          console.log(`🚀 Dashboard reference count: ${dashboardRefCount}`);
          
          // Clear any pending cleanup
          if (cleanupTimeout) {
            clearTimeout(cleanupTimeout);
            cleanupTimeout = null;
          }
          
          // Return existing initialization promise if already in progress
          if (initializationPromise) {
            console.log('⏳ Dashboard initialization already in progress...');
            return initializationPromise;
          }
          
          // If already initialized, just fetch data
          if (state.isInitialized && isDashboardActive()) {
            console.log('✅ Dashboard already initialized, fetching fresh data...');
            get().fetchDashboardData();
            return Promise.resolve();
          }
          
          // Start new initialization
          initializationPromise = (async () => {
            try {
              console.log('🚀 Starting dashboard initialization...');
              
              set({ 
                isInitialized: false, 
                initializationError: null,
                isLoading: true 
              });
              
              // Initialize enhanced cache
              await initializeEnhancedCache();
              
              // Mark as initialized
              set({ 
                isInitialized: true, 
                initializationError: null 
              });
              
              console.log('✅ Dashboard initialization completed');
              
              // Auto-fetch data after successful initialization
              if (isDashboardActive()) {
                setTimeout(() => {
                  if (isDashboardActive()) {
                    get().fetchDashboardData();
                  }
                }, 100); // Small delay to ensure state is updated
              }
              
            } catch (error) {
              console.error('❌ Dashboard initialization failed:', error);
              set({ 
                isInitialized: false,
                initializationError: error.message || 'Failed to initialize dashboard',
                isLoading: false
              });
              throw error;
            }
          })();
          
          return initializationPromise;
        },

        // 🔥 FIXED: Proper deactivation with reference counting
        deactivateDashboard: () => {
          dashboardRefCount = Math.max(0, dashboardRefCount - 1);
          console.log(`🛑 Dashboard reference count: ${dashboardRefCount}`);
          
          if (dashboardRefCount === 0) {
            console.log('🛑 Deactivating dashboard (no active references)...');
            
            // Clear any ongoing processes
            set({ 
              isLoading: false,
              isLoadingProducts: false,
              isBackgroundProcessing: false,
              error: null,
              productError: null
            });
            
            // Schedule cleanup instead of immediate termination
            scheduleCleanup();
          }
        },

        // 🔥 UPDATED: Connection test with better state management
        testConnection: async () => {
          if (!isDashboardActive()) {
            console.log('⏸️ Dashboard not active, skipping connection test');
            return false;
          }
          
          set({ connectionStatus: 'testing' });
          
          const isConnected = await testConnection();
          
          if (!isDashboardActive()) {
            console.log('⏸️ Dashboard deactivated during connection test');
            return false;
          }
          
          if (isConnected) {
            const databases = [
              { name: 'sales', url: SALES_DB_URL },
              { name: 'products', url: PRODUCTS_DB_URL },
              { name: 'customers', url: CUSTOMERS_DB_URL },
              { name: 'suppliers', url: SUPPLIERS_DB_URL },
              { name: 'purchases', url: PURCHASES_DB_URL },
              { name: 'transactions', url: TRANSACTIONS_DB_URL },
            ];
            
            for (const db of databases) {
              if (!isDashboardActive()) {
                console.log('⏸️ Dashboard deactivated during database testing');
                return false;
              }
              
              const hasAccess = await testDatabaseAccess(db.url);
              if (!hasAccess) {
                set({ 
                  connectionStatus: 'disconnected',
                  error: `Cannot access ${db.name} database. Please check if the database exists and CORS is configured properly.`
                });
                return false;
              }
            }
            
            set({ connectionStatus: 'connected', error: null });
            return true;
          } else {
            set({ 
              connectionStatus: 'disconnected',
              error: 'Cannot connect to CouchDB server. Please check if CouchDB is running on localhost:5984'
            });
            return false;
          }
        },

        // 🔥 UPDATED: Enhanced actions with better activation checks
        setTimeframe: (newTimeframe) => {
          if (!isDashboardActive()) {
            console.log('⏸️ Dashboard not active, skipping timeframe change');
            return;
          }
          
          const currentState = get();
          if (!currentState.isInitialized) {
            console.log('⏸️ Dashboard not initialized, skipping timeframe change');
            return;
          }
          
          if (currentState.timeframe === newTimeframe) return;
          
          set({ 
            timeframe: newTimeframe, 
            customDateRange: { start: null, end: null },
            error: null,
            productError: null 
          });
          
          // Use setTimeout to ensure state update is complete
          setTimeout(() => {
            if (isDashboardActive() && get().isInitialized) {
              get().fetchDashboardData();
              
              // Preload if enhanced cache is available
              if (enhancedCache) {
                enhancedCache.preloadData(newTimeframe);
              }
            }
          }, 50);
        },

        setCustomDateRange: (startDate, endDate) => {
          if (!isDashboardActive()) {
            console.log('⏸️ Dashboard not active, skipping date range change');
            return;
          }
          
          const currentState = get();
          if (!currentState.isInitialized) {
            console.log('⏸️ Dashboard not initialized, skipping date range change');
            return;
          }
          
          if (currentState.customDateRange.start === startDate && 
              currentState.customDateRange.end === endDate) return;
          
          set({ 
            timeframe: 'custom', 
            customDateRange: { start: startDate, end: endDate },
            error: null,
            productError: null 
          });
          
          // Use setTimeout to ensure state update is complete
          setTimeout(() => {
            if (isDashboardActive() && get().isInitialized) {
              get().fetchDashboardData();
            }
          }, 50);
        },

        // 🔥 UPDATED: Enhanced fetch with better lifecycle management
        fetchDashboardData: async () => {
          if (!isDashboardActive()) {
            console.log('⏸️ Dashboard not active, skipping fetch');
            return;
          }

          const state = get();
          if (!state.isInitialized) {
            console.log('⏸️ Dashboard not initialized, skipping fetch');
            return;
          }

          if (state.isLoading) {
            console.log('⏸️ Already loading, skipping duplicate fetch');
            return;
          }

          const currentTime = Date.now();
          
          // Validate cached data
          const cacheValidation = validateAllDocs(dataCache.allDocs);
          
          console.log('🔍 Cache Validation:', {
            isValid: cacheValidation.isValid,
            counts: cacheValidation.counts,
            cacheAge: cacheTimestamp ? currentTime - cacheTimestamp : null,
            cacheExpired: cacheTimestamp ? (currentTime - cacheTimestamp) > CACHE_DURATION : true,
            dashboardActive: isDashboardActive(),
            enhancedCacheAvailable: !!enhancedCache
          });

          // Try enhanced cache first
          if (enhancedCache && cacheValidation.isValid && cacheTimestamp && (currentTime - cacheTimestamp) < CACHE_DURATION) {
            try {
              const cachedResult = await enhancedCache.processDataInBackground(
                cacheValidation.normalizedDocs || dataCache.allDocs, 
                state.timeframe, 
                state.customDateRange
              );

              if (cachedResult && isDashboardActive()) {
                console.log('✅ Using enhanced cached data');
                set({
                  stats: cachedResult.stats || getDefaultStats(),
                  chartData: cachedResult.chartData || getDefaultChartData(),
                  productPerformance: cachedResult.productPerformance || getDefaultProductPerformance(),
                  isLoading: false,
                  isLoadingProducts: false,
                  error: null,
                  productError: null,
                  lastFetch: Date.now(),
                  connectionStatus: 'connected'
                });
                return;
              }
            } catch (cacheError) {
              console.warn('Cache processing failed, fetching fresh data:', cacheError);
            }
          }

          set({ 
            isLoading: true, 
            isLoadingProducts: true,
            isBackgroundProcessing: true,
            error: null, 
            productError: null,
            fetchStartTime: currentTime 
          });

          try {
            // Test connection first
            const isConnected = await get().testConnection();
            if (!isConnected || !isDashboardActive()) {
              set({ 
                isLoading: false, 
                isLoadingProducts: false,
                isBackgroundProcessing: false,
                stats: getDefaultStats(),
                chartData: getDefaultChartData(),
                productPerformance: getDefaultProductPerformance()
              });
              return;
            }

            console.log('🔄 Fetching fresh data...');
            
            // Fetch with retry
            const fetchWithRetry = async (url, retries = 2) => {
              for (let i = 0; i <= retries; i++) {
                if (!isDashboardActive()) {
                  throw new Error('Dashboard deactivated during fetch');
                }
                
                try {
                  const response = await apiClient.get(url);
                  return response;
                } catch (error) {
                  if (i === retries) throw error;
                  console.log(`Retry ${i + 1} for ${url}`);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            };

            // Final activation check before data fetching
            if (!isDashboardActive()) {
              console.log('🛑 Dashboard deactivated before data fetch, aborting');
              set({ 
                isLoading: false, 
                isLoadingProducts: false,
                isBackgroundProcessing: false
              });
              return;
            }

            // Fetch all data in parallel
            const dataFetches = await Promise.allSettled([
              fetchWithRetry(`${SALES_DB_URL}/_all_docs?include_docs=true&limit=1000`),
              fetchWithRetry(`${PRODUCTS_DB_URL}/_all_docs?include_docs=true&limit=500`),
              fetchWithRetry(`${CUSTOMERS_DB_URL}/_all_docs?include_docs=true&limit=500`),
              fetchWithRetry(`${SUPPLIERS_DB_URL}/_all_docs?include_docs=true&limit=500`),
              fetchWithRetry(`${PURCHASES_DB_URL}/_all_docs?include_docs=true&limit=1000`),
              fetchWithRetry(`${TRANSACTIONS_DB_URL}/_all_docs?include_docs=true&limit=1000`),
            ]);

            // Process responses
            const [salesRes, productsRes, customersRes, suppliersRes, purchasesRes, transactionsRes] = dataFetches;
            
            const extractData = (result, name) => {
              if (result.status === 'fulfilled' && result.value?.data?.rows) {
                const data = result.value.data.rows
                  .map(r => r.doc)
                  .filter(doc => doc && !doc._id.startsWith('_design'));
                console.log(`✅ ${name}: ${data.length} documents`);
                return data;
              } else {
                console.warn(`⚠️ ${name}: Failed to fetch or no data`);
                return [];
              }
            };

            const allDocs = {
              sales: extractData(salesRes, 'Sales'),
              products: extractData(productsRes, 'Products'),
              customers: extractData(customersRes, 'Customers'),
              suppliers: extractData(suppliersRes, 'Suppliers'),
              purchases: extractData(purchasesRes, 'Purchases'),
              transactions: extractData(transactionsRes, 'Transactions')
            };

            // Final check before processing
            if (!isDashboardActive()) {
              console.log('🛑 Dashboard deactivated during processing, aborting');
              set({ 
                isLoading: false, 
                isLoadingProducts: false,
                isBackgroundProcessing: false
              });
              return;
            }

            // Validate and process data
            const finalValidation = validateAllDocs(allDocs);
            console.log('📈 Final Data Validation:', {
              isValid: finalValidation.isValid,
              counts: finalValidation.counts
            });

            // Cache the data
            dataCache.allDocs = finalValidation.normalizedDocs || allDocs;
            cacheTimestamp = currentTime;
            
            // Process data with enhanced cache (if available)
            if (enhancedCache && isDashboardActive()) {
              await get().processDataWithEnhancedCache(dataCache.allDocs);
            } else if (isDashboardActive()) {
              // Fallback to traditional processing
              get().processData(dataCache.allDocs);
            }

          } catch (error) {
            if (isDashboardActive()) {
              console.error("Error fetching dashboard data:", error);
              set({ 
                isLoading: false, 
                isLoadingProducts: false,
                isBackgroundProcessing: false,
                error: error.message || 'Failed to fetch dashboard data',
                productError: error.message || 'Failed to fetch product data',
                connectionStatus: 'disconnected',
                stats: getDefaultStats(),
                chartData: getDefaultChartData(),
                productPerformance: getDefaultProductPerformance()
              });
            }
          }
        },

        // Enhanced cache processing (rest of the methods remain similar but with better checks)
        processDataWithEnhancedCache: async (allDocs, isPartial = false) => {
          if (!isDashboardActive() || !enhancedCache) {
            console.log('🛑 Dashboard not active or no enhanced cache, using traditional processing');
            if (isDashboardActive()) {
              get().processData(allDocs, isPartial);
            }
            return;
          }

          const startTime = Date.now();
          const { timeframe, customDateRange } = get();
          const validation = validateAllDocs(allDocs);
          
          if (!validation.isValid) {
            console.error('❌ Invalid data structure for processing');
            if (isDashboardActive()) {
              set({
                stats: getDefaultStats(),
                chartData: getDefaultChartData(),
                productPerformance: getDefaultProductPerformance(),
                isLoading: false,
                isLoadingProducts: false,
                isBackgroundProcessing: false,
                error: 'Invalid data structure received'
              });
            }
            return;
          }

          try {
            const dataToProcess = validation.normalizedDocs || allDocs;
            
            const cachedResult = await enhancedCache.processDataInBackground(
              dataToProcess, 
              timeframe, 
              customDateRange
            );

            if (!isDashboardActive()) {
              console.log('🛑 Dashboard deactivated during enhanced processing');
              return;
            }

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
                connectionStatus: 'connected'
              });

              console.log(`✅ Enhanced data processing completed in ${processingTime}ms${isPartial ? ' (partial)' : ''}${cachedResult.fromCache ? ' (cached)' : ' (fresh)'}`);
              return;
            }

            console.log('🔄 Falling back to traditional processing');
            get().processData(dataToProcess, isPartial);
            
          } catch (error) {
            console.error("Error in enhanced data processing:", error);
            if (isDashboardActive()) {
              get().processData(validation.normalizedDocs || allDocs, isPartial);
            }
          }
        },

        // Traditional processing with activation checks
        processData: (allDocs, isPartial = false) => {
          if (!isDashboardActive()) {
            console.log('🛑 Dashboard not active, skipping traditional processing');
            return;
          }

          const startTime = Date.now();
          const { timeframe, customDateRange } = get();

          try {
            console.log('🔄 Using traditional data processing...');
            
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
                console.log('✅ Product analytics processed:', {
                  topSellersCount: productAnalytics.topSellingProducts?.length || 0,
                  slowMovingCount: productAnalytics.slowMovingProducts?.length || 0,
                  totalProducts: productAnalytics.productPerformanceSummary?.metrics?.totalActiveProducts || 0
                });
              }
            } catch (productError) {
              console.error('Error processing product analytics:', productError);
              if (isDashboardActive()) {
                set({ productError: 'Failed to analyze product performance' });
              }
            }

            const processingTime = Date.now() - startTime;
            
            if (isDashboardActive()) {
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
                connectionStatus: 'connected'
              });

              console.log(`✅ Traditional data processing completed in ${processingTime}ms${isPartial ? ' (partial)' : ''}`);
            }
            
          } catch (error) {
            console.error("Error processing data:", error);
            if (isDashboardActive()) {
              set({ 
                isLoading: false, 
                isLoadingProducts: false,
                isBackgroundProcessing: false,
                error: 'Error processing dashboard data',
                productError: 'Error processing product data',
                stats: getDefaultStats(),
                chartData: getDefaultChartData(),
                productPerformance: getDefaultProductPerformance()
              });
            }
          }
        },

        // Enhanced Cache Management
        clearCache: async () => {
          dataCache = {};
          cacheTimestamp = 0;
          
          try {
            await CacheManager.clearDashboardCache();
            console.log('🗑️ All dashboard cache cleared');
          } catch (error) {
            console.warn('Failed to clear enhanced dashboard cache:', error);
          }
        },

        // Manual Refresh - CONTINUATION FROM WHERE IT CUT OFF
        refreshData: async () => {
          if (!isDashboardActive()) {
            console.log('🛑 Dashboard not active, skipping refresh');
            return;
          }
          
          const state = get();
          if (!state.isInitialized) {
            console.log('🛑 Dashboard not initialized, skipping refresh');
            return;
          }
          
          console.log('🔄 Manual refresh initiated');
          await get().clearCache();
          await get().fetchDashboardData();
        },

        // Get Cache Status
        getCacheStatus: async () => {
          try {
            const [traditionalCache, dashboardCache] = await Promise.all([
              Promise.resolve({
                hasCache: !!dataCache.allDocs,
                cacheAge: cacheTimestamp ? Date.now() - cacheTimestamp : null,
                isExpired: cacheTimestamp ? (Date.now() - cacheTimestamp) > CACHE_DURATION : true
              }),
              CacheManager.dashboardHealthCheck()
            ]);

            return {
              traditional: traditionalCache,
              enhanced: dashboardCache,
              backgroundProcessing: get().isBackgroundProcessing,
              isDashboardActive: isDashboardActive(),
              enhancedCacheAvailable: !!enhancedCache
            };
          } catch (error) {
            console.error('Error getting cache status:', error);
            return {
              traditional: { hasCache: false, cacheAge: null, isExpired: true },
              enhanced: { healthy: false, error: error.message },
              backgroundProcessing: false,
              isDashboardActive: isDashboardActive(),
              enhancedCacheAvailable: false
            };
          }
        },

        // Product-specific actions (with activation check)
        getTopSellingProducts: (count = 5) => {
          if (!isDashboardActive()) return [];
          const { productPerformance } = get();
          return productPerformance?.topSellingProducts?.slice(0, count) || [];
        },

        getSlowMovingProducts: (count = 5) => {
          if (!isDashboardActive()) return [];
          const { productPerformance } = get();
          return productPerformance?.slowMovingProducts?.slice(0, count) || [];
        },

        getProductPerformanceSummary: () => {
          if (!isDashboardActive()) return getDefaultProductPerformance().productPerformanceSummary;
          const { productPerformance } = get();
          return productPerformance?.productPerformanceSummary || getDefaultProductPerformance().productPerformanceSummary;
        },

        // 🔥 NEW: Cleanup method with proper deactivation
        cleanup: () => {
          console.log('🧹 Cleaning up dashboard store...');
          get().deactivateDashboard();
        }
      }),
      {
        name: 'dashboard-store',
        partialize: (state) => ({
          timeframe: state.timeframe,
          customDateRange: state.customDateRange,
          // Don't persist data or loading states
        })
      }
    )
  )
);

// 🔥 NEW: Cleanup on page unload and route changes
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    dashboardRefCount = 0;
    if (enhancedCache) {
      try {
        enhancedCache.terminate();
      } catch (error) {
        console.warn('Error during cleanup:', error);
      }
      enhancedCache = null;
    }
  });
  
  // Listen for route changes (if using React Router)
  window.addEventListener('popstate', () => {
    const currentPath = window.location.hash || window.location.pathname;
    const isDashboardPath = currentPath.includes('dashboard') || currentPath === '#/' || currentPath === '/';
    
    if (!isDashboardPath && isDashboardActive()) {
      console.log('🔄 Route changed away from dashboard, deactivating...');
      const store = useDashboardStore.getState();
      store.deactivateDashboard();
    }
  });
}
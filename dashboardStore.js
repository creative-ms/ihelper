// src/stores/dashboardStore.js - WEB WORKER OPTIMIZED VERSION
import { create } from 'zustand';
import { getDashboardWorkerManager } from '../workers/DashboardWorkerManager';

// Performance monitoring utilities
const performanceLogger = {
  start: (label) => {
    console.time(`⚡ ${label}`);
    return performance.now();
  },
  end: (label, startTime) => {
    const duration = performance.now() - startTime;
    console.timeEnd(`⚡ ${label}`);
    if (duration > 100) {
      console.warn(`🐌 Slow operation: ${label} took ${duration.toFixed(2)}ms`);
    }
    return duration;
  }
};

// Memory-efficient data fetching with smaller batches
const BATCH_SIZES = {
  sales: 1000,      // Reduced from 5000
  products: 500,    // Reduced from 1000
  customers: 200,   // Added limit
  suppliers: 50,    // Added limit
  purchases: 500,   // Reduced from 2000
  transactions: 500 // Reduced from 2000
};

export const useDashboardStore = create((set, get) => ({
  // State
  timeframe: 'today',
  customDateRange: { start: null, end: null },
  stats: {},
  chartData: {
    daily: { labels: [], revenue: [], sales: [], profit: [] },
    weekly: { labels: [], revenue: [], sales: [], profit: [] },
    monthly: { labels: [], revenue: [], sales: [], profit: [] },
  },
  peakHoursData: {
    daily: { revenue: [], sales: [], profit: [] },
    weekly: { revenue: [], sales: [], profit: [] },
    monthly: { revenue: [], sales: [], profit: [] },
  },
  cashflowHeatmapData: {},
  isLoading: false,
  error: null,
  dbManager: null,
  lastRefreshed: null,
  isInitialized: false,
  isProcessing: false, // NEW: Background processing state
  
  // Performance metrics with worker status
  performanceMetrics: {
    lastFetchDuration: 0,
    lastProcessingDuration: 0,
    dataSize: 0,
    workerProcessingTime: 0,
    workerStatus: null
  },

  // Worker manager instance
  workerManager: null,

  // NEW: Sync service state
  syncService: null,
  syncStatus: {
    isEnabled: false,
    isRunning: false,
    lastSyncTime: null,
    hasErrors: false,
    errorCount: 0,
    nextSyncTime: null
  },

  // ENHANCED: Auto-initialize sync service when dashboard initializes
  initialize: async (databaseManager) => {
    const workerManager = getDashboardWorkerManager();
    
    try {
      await workerManager.initialize();
      console.log('Dashboard Worker Manager initialized');
      
      set({ 
        dbManager: databaseManager,
        workerManager: workerManager,
        performanceMetrics: {
          ...get().performanceMetrics,
          workerStatus: workerManager.getStatus()
        }
      });

      // Initialize sync service automatically
      await get().initializeSyncService(databaseManager);
      
      // Auto-start sync if configured to do so
      const autoStartSync = localStorage.getItem('dashboard_auto_sync') === 'true';
      if (autoStartSync) {
        console.log('Auto-starting dashboard sync...');
        await get().startSync();
      }
      
    } catch (error) {
      console.error('Failed to initialize worker manager:', error);
      set({ 
        dbManager: databaseManager,
        workerManager: null 
      });
    }
  },

  // ENHANCED: Better sync service initialization with retry logic
  initializeSyncService: async (databaseManager) => {
    const maxRetries = 3;
    let attempt = 1;
    
    while (attempt <= maxRetries) {
      try {
        if (window.electronAPI?.dashboardSync) {
          console.log(`Initializing dashboard sync service (attempt ${attempt})...`);
          
          const result = await Promise.race([
            window.electronAPI.dashboardSync.initialize(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Initialization timeout')), 5000)
            )
          ]);
          
          if (result.success) {
            set({
              syncStatus: {
                isEnabled: true,
                isRunning: false,
                lastSyncTime: null,
                hasErrors: false,
                errorCount: 0,
                nextSyncTime: null
              }
            });
            
            console.log('Dashboard sync service initialized successfully');
            
            // Get initial status
            await get().updateSyncStatus();
            
            // Set up periodic status updates
            get().startSyncStatusMonitoring();
            
            return; // Success, exit retry loop
          } else {
            throw new Error(result.error || 'Initialization failed');
          }
        } else {
          console.log('Dashboard sync service not available - running in offline mode');
          return; // Not an error, just not available
        }
      } catch (error) {
        console.error(`Dashboard sync initialization attempt ${attempt} failed:`, error);
        
        if (attempt === maxRetries) {
          console.error('All dashboard sync initialization attempts failed');
          set({
            syncStatus: {
              isEnabled: false,
              isRunning: false,
              lastSyncTime: null,
              hasErrors: true,
              errorCount: 1,
              nextSyncTime: null,
              lastError: error.message
            }
          });
        } else {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        
        attempt++;
      }
    }
  },

  

  // NEW: Start sync service
  startSync: async () => {
    try {
      if (!window.electronAPI?.dashboardSync) {
        throw new Error('Sync service not available');
      }

      const result = await window.electronAPI.dashboardSync.start();
      
      if (result.success) {
        console.log('Dashboard sync started');
        await get().updateSyncStatus();
      } else {
        throw new Error(result.error || 'Failed to start sync');
      }
    } catch (error) {
      console.error('Error starting sync:', error);
      set({
        syncStatus: {
          ...get().syncStatus,
          hasErrors: true,
          errorCount: get().syncStatus.errorCount + 1
        }
      });
    }
  },

  // NEW: Stop sync service
  stopSync: async () => {
    try {
      if (!window.electronAPI?.dashboardSync) {
        throw new Error('Sync service not available');
      }

      const result = await window.electronAPI.dashboardSync.stop();
      
      if (result.success) {
        console.log('Dashboard sync stopped');
        await get().updateSyncStatus();
      } else {
        throw new Error(result.error || 'Failed to stop sync');
      }
    } catch (error) {
      console.error('Error stopping sync:', error);
    }
  },

  // NEW: Monitor sync status periodically
  startSyncStatusMonitoring: () => {
    // Clear any existing interval
    if (get().syncStatusInterval) {
      clearInterval(get().syncStatusInterval);
    }
    
    const interval = setInterval(async () => {
      try {
        await get().updateSyncStatus();
      } catch (error) {
        console.warn('Sync status monitoring error:', error);
      }
    }, 30000); // Every 30 seconds
    
    set({ syncStatusInterval: interval });
  },

  // NEW: Stop sync status monitoring
  stopSyncStatusMonitoring: () => {
    const { syncStatusInterval } = get();
    if (syncStatusInterval) {
      clearInterval(syncStatusInterval);
      set({ syncStatusInterval: null });
    }
  },

  // ENHANCED: Better error handling and user feedback
  triggerManualSync: async (force = false, showProgress = true) => {
    try {
      if (!window.electronAPI?.dashboardSync) {
        throw new Error('Sync service not available');
      }

      // Show progress indicator if requested
      if (showProgress) {
        set({ isLoading: true, error: null });
      }

      // Check if manual sync is allowed (unless forced)
      if (!force) {
        const canSync = await window.electronAPI.dashboardSync.canSync();
        if (!canSync.allowed) {
          console.log('Manual sync blocked:', canSync.message);
          
          if (showProgress) {
            set({ isLoading: false });
          }
          
          return {
            success: false,
            blocked: true,
            message: canSync.message,
            remainingMinutes: canSync.remainingMinutes,
            nextAllowedSync: canSync.nextAllowedSync
          };
        }
      }

      console.log('Triggering manual dashboard sync...');
      const startTime = performance.now();
      
      const result = await Promise.race([
        window.electronAPI.dashboardSync.manualSync(force),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Manual sync timeout')), 30000)
        )
      ]);
      
      const duration = performance.now() - startTime;
      
      if (result.success) {
        console.log(`Manual sync completed in ${duration.toFixed(0)}ms`);
        
        if (result.skipped) {
          console.log('Manual sync completed - no data to sync');
        } else {
          console.log('Manual sync completed successfully');
        }
        
        // Update sync status
        await get().updateSyncStatus();
        
        // Optionally refresh dashboard data after successful sync
        const autoRefreshAfterSync = localStorage.getItem('dashboard_refresh_after_sync') !== 'false';
        if (autoRefreshAfterSync && !result.skipped) {
          console.log('Auto-refreshing dashboard after successful sync...');
          setTimeout(() => {
            get().manualRefresh();
          }, 1000);
        }
        
        if (showProgress) {
          set({ isLoading: false });
        }
        
        return {
          success: true,
          skipped: result.skipped,
          summaryId: result.summaryId,
          duration: Math.round(duration),
          syncType: result.syncType
        };
      } else {
        throw new Error(result.error || 'Manual sync failed');
      }
      
    } catch (error) {
      console.error('Error during manual sync:', error);
      
      if (showProgress) {
        set({ isLoading: false, error: `Sync failed: ${error.message}` });
      }
      
      // Update sync status to reflect error
      set({
        syncStatus: {
          ...get().syncStatus,
          hasErrors: true,
          errorCount: get().syncStatus.errorCount + 1,
          lastError: error.message
        }
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  },

  // NEW: Check if manual sync is available
  canManualSync: async () => {
    try {
      if (!window.electronAPI?.dashboardSync) {
        return { allowed: false, message: 'Sync service not available' };
      }

      const result = await window.electronAPI.dashboardSync.canSync();
      return result;
    } catch (error) {
      console.error('Error checking manual sync availability:', error);
      return { allowed: false, message: 'Error checking sync availability' };
    }
  },

  // NEW: Update sync status
  updateSyncStatus: async () => {
    try {
      if (!window.electronAPI?.dashboardSync) {
        return;
      }

      const status = await window.electronAPI.dashboardSync.getStatus();
      
      set({
        syncStatus: {
          isEnabled: true,
          isRunning: status.isRunning || false,
          lastSyncTime: status.lastSyncTime,
          hasErrors: status.hasErrors || false,
          errorCount: status.errorCount || 0,
          nextSyncTime: status.nextSyncTime
        }
      });
    } catch (error) {
      console.error('Error updating sync status:', error);
    }
  },

  // NEW: Get sync statistics
  getSyncStats: async () => {
    try {
      if (!window.electronAPI?.dashboardSync) {
        return null;
      }

      const stats = await window.electronAPI.dashboardSync.getStats();
      return stats;
    } catch (error) {
      console.error('Error getting sync stats:', error);
      return null;
    }
  },

  // Actions - NO AUTO REFRESH, JUST SET VALUES
  setTimeframe: (newTimeframe) => {
    console.log('🎯 Timeframe changed to:', newTimeframe, '(data will update on manual refresh)');
    set({ timeframe: newTimeframe, customDateRange: { start: null, end: null } });
  },

  setCustomDateRange: (startDate, endDate) => {
    console.log('📅 Custom date range set:', { startDate, endDate }, '(data will update on manual refresh)');
    set({ timeframe: 'custom', customDateRange: { start: startDate, end: endDate } });
  },

  // 🚀 WORKER-OPTIMIZED MAIN FETCH FUNCTION
  fetchDashboardData: async (forceFresh = false) => {
    const { isLoading, isProcessing, workerManager } = get();
    
    // Prevent multiple simultaneous requests
    if (isLoading || isProcessing) {
      console.log('⏳ Dashboard data already loading/processing, skipping...');
      return;
    }

    set({ isLoading: true, error: null });
    const fetchStartTime = performanceLogger.start('Dashboard Data Fetch');
    
    try {
      console.log('📊 Fetching dashboard data...', forceFresh ? '(forced refresh)' : '');

      // Clear cache only if forced refresh
      if (forceFresh) {
        console.log('🔥 Force refresh - clearing all caches');
        try {
          await Promise.all([
            window.electronAPI.database.clearCache('sales'),
            window.electronAPI.database.clearCache('products'),
            window.electronAPI.database.clearCache('customers'),
            window.electronAPI.database.clearCache('suppliers'),
            window.electronAPI.database.clearCache('purchases'),
            window.electronAPI.database.clearCache('transactions')
          ]);
        } catch (cacheError) {
          console.warn('⚠️ Cache clear warning:', cacheError);
        }
      }

      // 🎯 OPTIMIZATION 1: Reduced batch sizes and parallel fetching with error handling
      const fetchWithErrorHandling = async (collection, options) => {
        try {
          const result = await window.electronAPI.database[collection].find(options);
          return { docs: result.docs || [], error: null };
        } catch (error) {
          console.warn(`⚠️ Error fetching ${collection}:`, error);
          return { docs: [], error };
        }
      };

      const [salesResult, productsResult, customersResult, suppliersResult, purchasesResult, transactionsResult] = await Promise.all([
        fetchWithErrorHandling('sales', { 
          selector: { _id: { $gte: null } },
          limit: BATCH_SIZES.sales,
          sort: [{ createdAt: 'desc' }] // Most recent first for better relevance
        }),
        fetchWithErrorHandling('products', { 
          selector: { _id: { $gte: null } },
          limit: BATCH_SIZES.products 
        }),
        fetchWithErrorHandling('customers', { 
          selector: { _id: { $gte: null } },
          limit: BATCH_SIZES.customers
        }),
        fetchWithErrorHandling('suppliers', { 
          selector: { _id: { $gte: null } },
          limit: BATCH_SIZES.suppliers
        }),
        fetchWithErrorHandling('purchases', { 
          selector: { _id: { $gte: null } },
          limit: BATCH_SIZES.purchases,
          sort: [{ createdAt: 'desc' }]
        }),
        fetchWithErrorHandling('transactions', { 
          selector: { _id: { $gte: null } },
          limit: BATCH_SIZES.transactions,
          sort: [{ date: 'desc' }]
        })
      ]);

      // 🎯 OPTIMIZATION 2: Early validation and memory cleanup
      const allDocs = {
        sales: salesResult.docs.filter(doc => doc && doc._id),
        products: productsResult.docs.filter(doc => doc && doc._id),
        customers: customersResult.docs.filter(doc => doc && doc._id),
        suppliers: suppliersResult.docs.filter(doc => doc && doc._id),
        purchases: purchasesResult.docs.filter(doc => doc && doc._id),
        transactions: transactionsResult.docs.filter(doc => doc && doc._id),
      };

      const dataSize = Object.values(allDocs).reduce((sum, arr) => sum + arr.length, 0);
      console.log('📊 Dashboard data fetched:', {
        sales: allDocs.sales.length,
        products: allDocs.products.length,
        customers: allDocs.customers.length,
        suppliers: allDocs.suppliers.length,
        purchases: allDocs.purchases.length,
        transactions: allDocs.transactions.length,
        totalDocuments: dataSize
      });

      const fetchDuration = performanceLogger.end('Dashboard Data Fetch', fetchStartTime);
      
      // Update state to show we're now processing in background
      set({ 
        isLoading: false, 
        isProcessing: true,
        performanceMetrics: {
          ...get().performanceMetrics,
          lastFetchDuration: fetchDuration,
          dataSize,
          workerStatus: workerManager?.getStatus() || null
        }
      });

      const { timeframe, customDateRange } = get();

      // 🚀 NEW: Process data using Web Worker (NON-BLOCKING)
      if (workerManager) {
        try {
          console.log('🔧 Processing data in Web Worker...');
          const workerStartTime = performance.now();
          
          const workerResult = await workerManager.processDashboardData(
            allDocs, 
            timeframe, 
            customDateRange
          );
          
          const workerProcessingTime = performance.now() - workerStartTime;
          console.log(`✅ Worker processing completed in ${workerProcessingTime.toFixed(2)}ms`);

          if (workerResult) {
            set({
              stats: workerResult.stats,
              chartData: workerResult.chartData,
              peakHoursData: workerResult.peakHoursData,
              cashflowHeatmapData: workerResult.cashflowHeatmapData,
              isProcessing: false,
              error: null,
              lastRefreshed: new Date().toISOString(),
              isInitialized: true,
              performanceMetrics: {
                lastFetchDuration: fetchDuration,
                lastProcessingDuration: workerResult.processingTime || workerProcessingTime,
                dataSize,
                workerProcessingTime,
                workerStatus: workerManager.getStatus()
              }
            });

            console.log('✅ Dashboard data processed and cached via Web Worker');
            console.log('📈 Performance:', {
              fetchTime: `${fetchDuration.toFixed(2)}ms`,
              workerProcessingTime: `${workerProcessingTime.toFixed(2)}ms`,
              documents: dataSize,
              uiBlocking: '0ms (processed in worker)'
            });
          } else {
            throw new Error('Worker returned null result');
          }

        } catch (workerError) {
          console.error('❌ Worker processing failed, falling back to main thread:', workerError);
          
          // Fallback: Process on main thread (will block UI)
          console.warn('⚠️ FALLBACK: Processing on main thread - UI may become unresponsive');
          await get().processDataOnMainThread(allDocs, timeframe, customDateRange, fetchDuration, dataSize);
        }
      } else {
        console.warn('⚠️ No worker available, processing on main thread - UI may become unresponsive');
        await get().processDataOnMainThread(allDocs, timeframe, customDateRange, fetchDuration, dataSize);
      }

    } catch (error) {
      performanceLogger.end('Dashboard Data Fetch', fetchStartTime);
      console.error("❌ Error fetching dashboard data:", error);
      set({ 
        isLoading: false,
        isProcessing: false,
        error: error.message || 'Failed to fetch dashboard data'
      });
    }
  },

  // Fallback processing on main thread (imported from helpers.js)
  processDataOnMainThread: async (allDocs, timeframe, customDateRange, fetchDuration, dataSize) => {
    const processingStartTime = performanceLogger.start('Main Thread Data Processing');
    
    try {
      // Import helpers dynamically to avoid blocking initial load
      const { 
        calculateStats, 
        processChartData, 
        processPeakHoursData, 
        processHeatmapData 
      } = await import('./dashboard/helpers');

      const [newStats, newChartData, newPeakHoursData, heatmapResult] = await Promise.all([
        Promise.resolve(calculateStats(allDocs, timeframe, customDateRange)),
        Promise.resolve(processChartData(allDocs.sales)),
        Promise.resolve(processPeakHoursData(allDocs.sales)),
        Promise.resolve(processHeatmapData(allDocs))
      ]);

      const processingDuration = performanceLogger.end('Main Thread Data Processing', processingStartTime);

      set({
        stats: newStats,
        chartData: newChartData,
        peakHoursData: newPeakHoursData,
        cashflowHeatmapData: heatmapResult.cashflowHeatmap,
        isProcessing: false,
        error: null,
        lastRefreshed: new Date().toISOString(),
        isInitialized: true,
        performanceMetrics: {
          lastFetchDuration: fetchDuration,
          lastProcessingDuration: processingDuration,
          dataSize,
          workerProcessingTime: 0,
          workerStatus: get().workerManager?.getStatus() || null
        }
      });

      console.log('✅ Dashboard data processed on main thread (UI was blocked)');

    } catch (error) {
      console.error('❌ Main thread processing failed:', error);
      set({
        isProcessing: false,
        error: 'Failed to process dashboard data'
      });
    }
  },

  // 🎯 STATS-ONLY REFRESH - Faster, worker-optimized stats update
  refreshStats: async () => {
    const { workerManager, isProcessing, isLoading } = get();
    
    if (isProcessing || isLoading) {
      console.log('⏳ Already processing, skipping stats refresh');
      return;
    }

    console.log('🔄 Quick stats refresh requested...');
    set({ isProcessing: true });
    
    try {
      // Fetch only essential data for stats calculation
      const salesResult = await window.electronAPI.database.sales.find({
        selector: { _id: { $gte: null } },
        limit: BATCH_SIZES.sales,
        sort: [{ createdAt: 'desc' }]
      });

      const customersResult = await window.electronAPI.database.customers.find({
        selector: { balance: { $exists: true, $ne: 0 } },
        limit: BATCH_SIZES.customers
      });

      const suppliersResult = await window.electronAPI.database.suppliers.find({
        selector: { balance: { $exists: true, $ne: 0 } },
        limit: BATCH_SIZES.suppliers
      });

      const minimalDocs = {
        sales: salesResult.docs || [],
        customers: customersResult.docs || [],
        suppliers: suppliersResult.docs || [],
        products: [],
        purchases: [],
        transactions: []
      };

      const { timeframe, customDateRange } = get();

      if (workerManager) {
        console.log('🔧 Calculating stats in Web Worker...');
        const workerResult = await workerManager.processDashboardData(
          minimalDocs, 
          timeframe, 
          customDateRange
        );

        if (workerResult?.stats) {
          set({
            stats: workerResult.stats,
            isProcessing: false,
            lastRefreshed: new Date().toISOString(),
            performanceMetrics: {
              ...get().performanceMetrics,
              workerProcessingTime: workerResult.processingTime,
              workerStatus: workerManager.getStatus()
            }
          });
          
          console.log('✅ Stats refreshed via Web Worker');
        } else {
          throw new Error('Worker stats calculation failed');
        }
      } else {
        // Fallback to main thread
        const { calculateStats } = await import('./dashboard/helpers');
        const newStats = calculateStats(minimalDocs, timeframe, customDateRange);
        
        set({
          stats: newStats,
          isProcessing: false,
          lastRefreshed: new Date().toISOString()
        });
        
        console.log('✅ Stats refreshed on main thread (fallback)');
      }

    } catch (error) {
      console.error('❌ Stats refresh failed:', error);
      set({
        isProcessing: false,
        error: 'Failed to refresh stats'
      });
    }
  },

  // 🎯 MANUAL REFRESH - Only way to update data
  manualRefresh: async () => {
    console.log('🔄 Manual dashboard refresh requested by user...');
    await get().fetchDashboardData(true);
  },

  // 🎯 INITIAL LOAD - Only called once when dashboard component mounts
  initialLoad: async () => {
    const { isInitialized } = get();
    
    if (isInitialized) {
      console.log('📊 Dashboard already initialized, skipping initial load');
      return;
    }
    
    console.log('🚀 Dashboard initial load...');
    await get().fetchDashboardData(false);
  },

  // 🎯 NO AUTO REFRESH - Just log the action
  refreshAfterSale: () => {
    console.log('💰 Sale completed - dashboard will update on next manual refresh');
    // Do nothing - let user refresh manually when needed
  },

  // 🎯 NO CACHE INVALIDATION - Just log the action  
  invalidateCache: () => {
    console.log('💾 Cache invalidated - dashboard will update on next manual refresh');
    // Do nothing - let user refresh manually when needed
  },

  // 🎯 OPTIMIZED Helper functions for specific data queries (unchanged)
  fetchSalesForDateRange: async (startDate, endDate) => {
    const queryStartTime = performanceLogger.start('Sales Date Range Query');
    
    try {
      const salesResult = await window.electronAPI.database.sales.find({
        selector: {
          createdAt: {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString()
          },
          type: { $ne: 'RETURN' }
        },
        limit: 500
      });

      performanceLogger.end('Sales Date Range Query', queryStartTime);
      return salesResult.docs || [];
    } catch (error) {
      performanceLogger.end('Sales Date Range Query', queryStartTime);
      console.error("Error fetching sales for date range:", error);
      return [];
    }
  },

  fetchTransactionsForDateRange: async (startDate, endDate) => {
    const queryStartTime = performanceLogger.start('Transactions Date Range Query');
    
    try {
      const transactionsResult = await window.electronAPI.database.transactions.find({
        selector: {
          date: {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString()
          }
        },
        limit: 250
      });

      performanceLogger.end('Transactions Date Range Query', queryStartTime);
      return transactionsResult.docs || [];
    } catch (error) {
      performanceLogger.end('Transactions Date Range Query', queryStartTime);
      console.error("Error fetching transactions for date range:", error);
      return [];
    }
  },

  // 🎯 MEMOIZED Balance Summary Functions (unchanged but with worker option)
  getCustomerBalancesSummary: async () => {
    const { performanceMetrics } = get();
    
    // Skip if we just processed a lot of data
    if (performanceMetrics.dataSize > 2000) {
      console.log('⚡ Skipping balance summary due to large dataset');
      return {
        totalReceivable: 0,
        customerCredit: 0,
        customersWithBalance: 0,
        customersWithCredit: 0
      };
    }

    try {
      const customersResult = await window.electronAPI.database.customers.find({
        selector: { balance: { $exists: true, $ne: 0 } },
        limit: 200
      });
      
      const customers = customersResult.docs || [];
      return get().calculateBalanceSummary(customers);
    } catch (error) {
      console.error("Error getting customer balances summary:", error);
      return {
        totalReceivable: 0,
        customerCredit: 0,
        customersWithBalance: 0,
        customersWithCredit: 0
      };
    }
  },

  // 🎯 OPTIMIZED Balance Calculation (unchanged)
  calculateBalanceSummary: (customers) => {
    if (!Array.isArray(customers) || customers.length === 0) {
      return {
        totalReceivable: 0,
        customerCredit: 0,
        customersWithBalance: 0,
        customersWithCredit: 0
      };
    }

    return customers.reduce((summary, customer) => {
      const balance = Number(customer.balance) || 0;
      if (balance > 0) {
        summary.totalReceivable += balance;
        summary.customersWithBalance += 1;
      } else if (balance < 0) {
        summary.customerCredit += Math.abs(balance);
        summary.customersWithCredit += 1;
      }
      return summary;
    }, {
      totalReceivable: 0,
      customerCredit: 0,
      customersWithBalance: 0,
      customersWithCredit: 0
    });
  },

  getSupplierBalancesSummary: async () => {
    try {
      const suppliersResult = await window.electronAPI.database.suppliers.find({
        selector: { balance: { $exists: true, $ne: 0 } },
        limit: 50
      });

      const suppliers = suppliersResult.docs || [];
      return suppliers.reduce((summary, supplier) => {
        const balance = Number(supplier.balance) || 0;
        if (balance > 0) {
          summary.totalPayable += balance;
          summary.suppliersWithBalance += 1;
        } else if (balance < 0) {
          summary.supplierCredit += Math.abs(balance);
          summary.suppliersWithCredit += 1;
        }
        return summary;
      }, {
        totalPayable: 0,
        supplierCredit: 0,
        suppliersWithBalance: 0,
        suppliersWithCredit: 0
      });

    } catch (error) {
      console.error("Error getting supplier balances summary:", error);
      return {
        totalPayable: 0,
        supplierCredit: 0,
        suppliersWithBalance: 0,
        suppliersWithCredit: 0
      };
    }
  },

  getInventorySummary: async () => {
    try {
      const inventoryResult = await window.electronAPI.database.inventory.find({
        selector: { _id: { $gte: null } },
        limit: 500
      });

      const inventory = inventoryResult.docs || [];
      const summary = {
        totalProducts: inventory.length,
        lowStockItems: 0,
        outOfStockItems: 0,
        expiringSoonItems: 0,
        totalInventoryValue: 0
      };

      if (inventory.length === 0) return summary;

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      inventory.forEach(item => {
        const quantity = Number(item.quantity) || 0;
        const lowStockThreshold = Number(item.lowStockThreshold) || 0;
        const cost = Number(item.cost) || 0;

        if (quantity === 0) {
          summary.outOfStockItems += 1;
        } else if (quantity <= lowStockThreshold) {
          summary.lowStockItems += 1;
        }

        if (item.expiryDate) {
          const expiryDate = new Date(item.expiryDate);
          if (!isNaN(expiryDate.getTime()) && expiryDate <= thirtyDaysFromNow) {
            summary.expiringSoonItems += 1;
          }
        }

        summary.totalInventoryValue += quantity * cost;
      });

      return summary;
    } catch (error) {
      console.error("Error getting inventory summary:", error);
      return {
        totalProducts: 0,
        lowStockItems: 0,
        outOfStockItems: 0,
        expiringSoonItems: 0,
        totalInventoryValue: 0
      };
    }
  },

  // 🎯 OPTIMIZED Top Selling Products (unchanged)
  getTopSellingProducts: async (limit = 10, days = 30) => {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const salesResult = await window.electronAPI.database.sales.find({
        selector: {
          type: 'SALE',
          createdAt: {
            $gte: startDate.toISOString()
          }
        },
        limit: 200
      });

      const sales = salesResult.docs || [];
      if (sales.length === 0) return [];

      const productSales = new Map();

      sales.forEach(sale => {
        if (!Array.isArray(sale.items)) return;
        
        sale.items.forEach(item => {
          if (!item.productId) return;
          
          const productId = item.productId;
          const quantity = Number(item.quantity) || 0;
          const revenue = (Number(item.salePrice) || 0) * quantity;

          if (productSales.has(productId)) {
            const existing = productSales.get(productId);
            existing.quantity += quantity;
            existing.revenue += revenue;
            existing.orders += 1;
          } else {
            productSales.set(productId, {
              productId,
              productName: item.name || 'Unknown Product',
              quantity,
              revenue,
              orders: 1
            });
          }
        });
      });

      return Array.from(productSales.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);

    } catch (error) {
      console.error("Error getting top selling products:", error);
      return [];
    }
  },

  // 🎯 OPTIMIZED Recent Activity (unchanged)
  getRecentActivity: async (limit = 20) => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const activityLimit = Math.ceil(limit / 2);

      const [salesResult, transactionsResult] = await Promise.all([
        window.electronAPI.database.sales.find({
          selector: { 
            createdAt: { $gte: sevenDaysAgo }
          },
          limit: activityLimit,
          sort: [{ createdAt: 'desc' }]
        }),
        window.electronAPI.database.transactions.find({
          selector: { 
            date: { $gte: sevenDaysAgo }
          },
          limit: activityLimit,
          sort: [{ date: 'desc' }]
        })
      ]);

      const sales = (salesResult.docs || []).map(sale => ({
        ...sale,
        activityType: sale.type === 'RETURN' ? 'RETURN' : 'SALE',
        timestamp: sale.createdAt || sale.returnedAt
      }));

      const transactions = (transactionsResult.docs || []).map(tx => ({
        ...tx,
        activityType: 'TRANSACTION',
        timestamp: tx.date || tx.createdAt
      }));

      const allActivity = [...sales, ...transactions]
        .filter(item => item.timestamp)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);

      return allActivity;

    } catch (error) {
      console.error("Error getting recent activity:", error);
      return [];
    }
  },

  // Alias for manual refresh
  refreshDashboard: () => {
    return get().manualRefresh();
  },

  // Enhanced reset dashboard with sync cleanup
  resetDashboard: () => {
    const { workerManager } = get();
    
    // Terminate worker if exists
    if (workerManager) {
      workerManager.terminate();
    }
    
    // Stop sync service if running
    get().stopSync();
    
    set({
      timeframe: 'today',
      customDateRange: { start: null, end: null },
      stats: {},
      chartData: {
        daily: { labels: [], revenue: [], sales: [], profit: [] },
        weekly: { labels: [], revenue: [], sales: [], profit: [] },
        monthly: { labels: [], revenue: [], sales: [], profit: [] },
      },
      peakHoursData: {
        daily: { revenue: [], sales: [], profit: [] },
        weekly: { revenue: [], sales: [], profit: [] },
        monthly: { revenue: [], sales: [], profit: [] },
      },
      cashflowHeatmapData: {},
      isLoading: false,
      isProcessing: false,
      error: null,
      lastRefreshed: null,
      isInitialized: false,
      workerManager: null,
      syncService: null,
      syncStatus: {
        isEnabled: false,
        isRunning: false,
        lastSyncTime: null,
        hasErrors: false,
        errorCount: 0,
        nextSyncTime: null
      },
      performanceMetrics: {
        lastFetchDuration: 0,
        lastProcessingDuration: 0,
        dataSize: 0,
        workerProcessingTime: 0,
        workerStatus: null
      }
    });
  },

  // Get last refresh time for UI display
  getLastRefreshTime: () => {
    const { lastRefreshed } = get();
    if (!lastRefreshed) return 'Never';
    
    const refreshTime = new Date(lastRefreshed);
    const now = new Date();
    const diffMs = now - refreshTime;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes === 1) return '1 minute ago';
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    return refreshTime.toLocaleDateString();
  },

  // 🎯 NEW: Get performance metrics with worker status
  getPerformanceMetrics: () => {
    const { performanceMetrics, workerManager } = get();
    
    return {
      ...performanceMetrics,
      workerStatus: workerManager?.getStatus() || null,
      memoryUsage: window.performance?.memory ? {
        used: Math.round(window.performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(window.performance.memory.totalJSHeapSize / 1024 / 1024),
        limit: Math.round(window.performance.memory.jsHeapSizeLimit / 1024 / 1024)
      } : null
    };
  },

  // NEW: Configuration methods for sync behavior
  setSyncAutoStart: (enabled) => {
    localStorage.setItem('dashboard_auto_sync', enabled.toString());
    console.log('Dashboard auto-sync:', enabled ? 'enabled' : 'disabled');
  },

  setSyncAutoRefresh: (enabled) => {
    localStorage.setItem('dashboard_refresh_after_sync', enabled.toString());
    console.log('Dashboard auto-refresh after sync:', enabled ? 'enabled' : 'disabled');
  },

  getSyncConfig: () => ({
    autoStart: localStorage.getItem('dashboard_auto_sync') === 'true',
    autoRefreshAfterSync: localStorage.getItem('dashboard_refresh_after_sync') !== 'false'
  }),

  // NEW: Get comprehensive sync information for UI display
  getSyncInfo: async () => {
    try {
      const [status, stats, canSync] = await Promise.all([
        get().syncStatus.isEnabled ? window.electronAPI.dashboardSync.getStatus() : null,
        get().syncStatus.isEnabled ? window.electronAPI.dashboardSync.getStats() : null,
        get().syncStatus.isEnabled ? window.electronAPI.dashboardSync.canSync() : null
      ].filter(Boolean));

      return {
        status: status || get().syncStatus,
        stats: stats || null,
        canManualSync: canSync || { allowed: false, message: 'Sync not available' },
        isAvailable: !!window.electronAPI?.dashboardSync
      };
    } catch (error) {
      console.error('Error getting sync info:', error);
      return {
        status: get().syncStatus,
        stats: null,
        canManualSync: { allowed: false, message: 'Error checking sync' },
        isAvailable: false,
        error: error.message
      };
    }
  },

  // Cleanup method to terminate worker when store is destroyed
 // Enhanced cleanup method
  // ENHANCED: Better cleanup with sync service shutdown
  cleanup: () => {
    const { workerManager, syncStatusInterval } = get();
    
    // Stop sync service
    try {
      get().stopSync();
    } catch (error) {
      console.warn('Error stopping sync during cleanup:', error);
    }
    
    if (workerManager) {
      workerManager.terminate();
      console.log('Dashboard Worker terminated on cleanup');
    }
  },
}));
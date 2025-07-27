// purchaseStore.js - Fixed performance monitor with unique timer IDs
import { create } from 'zustand';
import axios from 'axios';
import { useProductStore } from './productStore.js';
import { useInventoryStore } from './inventoryStore.js';
import { useSupplierStore } from './supplierStore.js';
import { useAuditStore } from './auditStore.js';

// Performance Configuration
const PERFORMANCE_CONFIG = {
  BATCH_SIZE: 50,
  CONCURRENT_REQUESTS: 3,
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  DEBOUNCE_DELAY: 150,
  REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes
  STALE_TIME: 2 * 60 * 1000, // 2 minutes
};

const PURCHASES_DB_URL = 'http://localhost:5984/purchases';
const PRODUCTS_DB_URL = 'http://localhost:5984/products';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

// Fixed performance monitor with unique timer IDs
const perfMonitor = {
  activeTimers: new Set(),
  
  start: (operation) => {
    const timerId = `⚡ ${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Clean up any existing timer with the same operation name
    const existingTimer = Array.from(perfMonitor.activeTimers).find(id => id.includes(`⚡ ${operation}_`));
    if (existingTimer) {
      console.timeEnd(existingTimer);
      perfMonitor.activeTimers.delete(existingTimer);
    }
    
    perfMonitor.activeTimers.add(timerId);
    console.time(timerId);
    return timerId;
  },
  
  end: (timerId) => {
    if (perfMonitor.activeTimers.has(timerId)) {
      console.timeEnd(timerId);
      perfMonitor.activeTimers.delete(timerId);
    }
  },
  
  // Alternative method that doesn't require returning timer ID
  measure: (operation, fn) => {
    const timerId = perfMonitor.start(operation);
    const result = fn();
    
    if (result && typeof result.then === 'function') {
      // Handle async functions
      return result.finally(() => perfMonitor.end(timerId));
    } else {
      // Handle sync functions
      perfMonitor.end(timerId);
      return result;
    }
  }
};

// Optimized debounce utility
const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

// Simple cache for purchases
class PurchaseCache {
  constructor() {
    this.cache = new Map();
    this.timestamps = new Map();
  }

  set(key, data) {
    this.cache.set(key, data);
    this.timestamps.set(key, Date.now());
  }

  get(key) {
    const timestamp = this.timestamps.get(key);
    if (!timestamp || Date.now() - timestamp > PERFORMANCE_CONFIG.CACHE_DURATION) {
      this.cache.delete(key);
      this.timestamps.delete(key);
      return null;
    }
    return this.cache.get(key);
  }

  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }
}

const purchaseCache = new PurchaseCache();

// Batch processing utility
const processBatch = async (items, processor, batchSize = PERFORMANCE_CONFIG.BATCH_SIZE) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(processor)
    );
    results.push(...batchResults);
  }
  return results;
};

export const usePurchaseStore = create((set, get) => ({
  purchases: [],
  isLoading: false,
  lastFetchTime: null,
  
  // Lifecycle state
  isInitialized: false,
  initializationError: null,
  backgroundRefreshActive: false,
  connectionStatus: 'disconnected',
  performanceMetrics: {
    cacheHits: 0,
    cacheMisses: 0,
    totalRequests: 0,
    avgResponseTime: 0
  },

  // =================================================================
  //  LIFECYCLE MANAGEMENT METHODS
  // =================================================================

  initializePurchasePage: async () => {
    return perfMonitor.measure('initializePurchasePage', async () => {
      try {
        set({ 
          isLoading: true, 
          initializationError: null,
          connectionStatus: 'connecting'
        });

        // Initialize with cached data first if available
        const cached = purchaseCache.get('all_purchases');
        if (cached) {
          set({ purchases: cached });
          console.log('🚀 Loaded purchases from cache');
        }

        // Fetch fresh data
        await get().fetchPurchases(true);
        
        set({ 
          isInitialized: true,
          connectionStatus: 'connected',
          isLoading: false
        });

        console.log('✅ Purchase page initialized successfully');
        
      } catch (error) {
        console.error('❌ Failed to initialize purchase page:', error);
        set({ 
          initializationError: error.message || 'Failed to initialize',
          connectionStatus: 'disconnected',
          isLoading: false
        });
        throw error;
      }
    });
  },

  deactivatePurchasePage: () => {
    console.log('🔄 Deactivating purchase page');
    
    // Clear any ongoing intervals or timeouts
    if (get().refreshInterval) {
      clearInterval(get().refreshInterval);
    }
    
    // Reset state
    set({ 
      isInitialized: false,
      backgroundRefreshActive: false,
      connectionStatus: 'disconnected',
      refreshInterval: null
    });
    
    console.log('✅ Purchase page deactivated');
  },

  backgroundRefresh: async () => {
    const state = get();
    if (!state.isInitialized || state.backgroundRefreshActive) {
      return;
    }

    set({ backgroundRefreshActive: true });
    
    try {
      await get().fetchPurchases(true);
      console.log('🔄 Background refresh completed');
    } catch (error) {
      console.error('❌ Background refresh failed:', error);
      set({ connectionStatus: 'disconnected' });
    } finally {
      set({ backgroundRefreshActive: false });
    }
  },

  getPerformanceMetrics: () => {
    const state = get();
    return {
      ...state.performanceMetrics,
      totalPurchases: state.purchases.length,
      cacheStatus: purchaseCache.cache.size > 0 ? 'active' : 'empty',
      lastFetchTime: state.lastFetchTime,
      isInitialized: state.isInitialized
    };
  },

  // =================================================================
  //  OPTIMIZED FETCH WITH CACHING
  // =================================================================

  fetchPurchases: async (forceRefresh = false) => {
    return perfMonitor.measure('fetchPurchases', async () => {
      const startTime = Date.now();
      
      // Check cache first
      if (!forceRefresh) {
        const cached = purchaseCache.get('all_purchases');
        if (cached) {
          set({ 
            purchases: cached, 
            isLoading: false,
            connectionStatus: 'connected'
          });
          
          // Update performance metrics
          const state = get();
          set({
            performanceMetrics: {
              ...state.performanceMetrics,
              cacheHits: state.performanceMetrics.cacheHits + 1,
              totalRequests: state.performanceMetrics.totalRequests + 1
            }
          });
          
          return;
        }
      }

      set({ isLoading: true, connectionStatus: 'connecting' });
      
      try {
        const response = await axios.get(
          `${PURCHASES_DB_URL}/_all_docs?include_docs=true`,
          DB_AUTH
        );
        
        const allPurchases = response.data.rows
          .map(row => row.doc)
          .filter(doc => doc && !doc._deleted);
        
        // Optimized sorting - use single pass
        const sortedPurchases = allPurchases.sort((a, b) => 
          new Date(b.createdAt) - new Date(a.createdAt)
        );

        // Cache the results
        purchaseCache.set('all_purchases', sortedPurchases);
        
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        // Update performance metrics
        const state = get();
        const newAvgResponseTime = state.performanceMetrics.totalRequests > 0 
          ? (state.performanceMetrics.avgResponseTime * state.performanceMetrics.totalRequests + responseTime) / (state.performanceMetrics.totalRequests + 1)
          : responseTime;
        
        set({ 
          purchases: sortedPurchases, 
          isLoading: false,
          lastFetchTime: Date.now(),
          connectionStatus: 'connected',
          performanceMetrics: {
            ...state.performanceMetrics,
            cacheMisses: state.performanceMetrics.cacheMisses + 1,
            totalRequests: state.performanceMetrics.totalRequests + 1,
            avgResponseTime: newAvgResponseTime
          }
        });
        
      } catch (error) {
        console.error("Error fetching purchases:", error.response?.data || error.message);
        set({ 
          isLoading: false,
          connectionStatus: 'disconnected'
        });
        throw error;
      }
    });
  },

  // =================================================================
  //  OPTIMIZED ADD PURCHASE WITH BATCH PROCESSING
  // =================================================================

  addPurchase: async (purchaseData) => {
    return perfMonitor.measure('addPurchase', async () => {
      set({ isLoading: true });
      
      try {
        const { totals, amountPaid, supplierId, items } = purchaseData;
        const grandTotal = totals.grandTotal;
        const amountDue = grandTotal - amountPaid;

        const purchaseRecord = {
          ...purchaseData,
          amountPaid: amountPaid,
          amountDue: amountDue,
          createdAt: new Date().toISOString(),
          status: amountDue <= 0 ? 'Paid' : 'Partially Paid',
          type: 'PURCHASE'
        };

        // Save purchase record first
        const purchaseResponse = await axios.post(PURCHASES_DB_URL, purchaseRecord, DB_AUTH);

        // Update supplier balance in parallel with product updates
        const supplierUpdatePromise = supplierId 
          ? useSupplierStore.getState()._updateSupplierBalance(supplierId, amountDue)
          : Promise.resolve();

        // Process items in batches to avoid overwhelming the database
        const itemProcessor = async (item) => {
          try {
            const productRes = await axios.get(`${PRODUCTS_DB_URL}/${item.productId}`, DB_AUTH);
            const productToUpdate = productRes.data;

            const newBatch = {
              id: `batch-${Date.now()}-${Math.random()}`,
              batchNumber: item.batchNumber,
              quantity: Number(item.qty),
              purchasePrice: Number(item.rate),
              retailPrice: Number(item.retailPrice),
              mfgDate: item.mfgDate || null,
              expDate: item.expDate,
            };

            productToUpdate.batches = [...(productToUpdate.batches || []), newBatch];
            
            // Update retail price if higher
            if (!productToUpdate.retailPrice || Number(item.retailPrice) > productToUpdate.retailPrice) {
              productToUpdate.retailPrice = newBatch.retailPrice;
            }

            await useProductStore.getState().updateProduct(productToUpdate);

            return { success: true, item };
          } catch (error) {
            console.error(`Error processing item ${item.productId}:`, error);
            return { success: false, item, error };
          }
        };

        // Process items in parallel batches
        const itemResults = await processBatch(items, itemProcessor, PERFORMANCE_CONFIG.CONCURRENT_REQUESTS);
        
        // Log audit events in background (non-blocking)
        setTimeout(() => {
          items.forEach(item => {
            useAuditStore.getState().logEvent({
              eventType: 'PURCHASE',
              productId: item.productId,
              productName: item.productName,
              details: {
                quantity: Number(item.qty),
                rate: Number(item.rate),
                discount: Number(item.discount) || 0,
                salesTax: Number(item.salesTax) || 0,
                furtherTax: Number(item.furtherTax) || 0,
                advanceTax: Number(item.advanceTax) || 0,
                batchNumber: item.batchNumber,
                supplierName: purchaseData.supplierName,
                purchaseId: purchaseResponse.data.id
              }
            });
          });
        }, 0);

        // Wait for supplier update
        await supplierUpdatePromise;

        // Clear cache to force refresh
        purchaseCache.clear();

        // Refresh data in background
        setTimeout(() => {
          get().fetchPurchases(true);
          useInventoryStore.getState().fetchInventory?.();
          useProductStore.getState().backgroundSync?.();
          useSupplierStore.getState().fetchSuppliers?.();
        }, 100);

        set({ isLoading: false });
        
        return { success: true, id: purchaseResponse.data.id };

      } catch (error) {
        console.error("Error during add purchase:", error);
        set({ isLoading: false });
        
        // Refresh on error to ensure consistency
        get().fetchPurchases(true);
        return { 
          success: false, 
          message: "Failed to save purchase. Please check the data and try again." 
        };
      }
    });
  },

  // =================================================================
  //  OPTIMIZED RETURN PURCHASE
  // =================================================================

  returnPurchase: async (returnData, refundChoice) => {
    return perfMonitor.measure('returnPurchase', async () => {
      set({ isLoading: true });
      
      const { originalPurchase, returnedItems, reason, notes, supplier } = returnData;

      try {
        // Calculate return value efficiently
        const totalReturnValue = returnedItems.reduce((sum, returnedItem) => {
          const originalItem = originalPurchase.items.find(
            item => item.productId === returnedItem.productId && 
                    item.batchNumber === returnedItem.batchNumber
          );
          
          if (!originalItem) return sum;
          
          const grossAmount = (originalItem.rate || 0) * originalItem.qty;
          const netValue = grossAmount
            - (originalItem.discount || 0)
            + (originalItem.salesTax || 0)
            + (originalItem.furtherTax || 0)
            + (originalItem.advanceTax || 0);
          
          const netCostPerItem = originalItem.qty > 0 ? (netValue / originalItem.qty) : 0;
          return sum + (netCostPerItem * returnedItem.returnQty);
        }, 0);

        // Calculate balance change
        const currentPayable = supplier ? Math.max(0, supplier.balance || 0) : 0;
        let finalBalanceChange = 0;
        
        if (refundChoice.type === 'REFUND') {
          const adjustedAgainstPayable = Math.min(currentPayable, totalReturnValue);
          const creditNoteFromPartialRefund = refundChoice.creditNoteAmount || 0;
          finalBalanceChange = -(adjustedAgainstPayable + creditNoteFromPartialRefund);
        } else if (refundChoice.type === 'VOUCHER') {
          finalBalanceChange = -totalReturnValue;
        }

        // Create return record
        const returnRecord = {
          type: 'PURCHASE_RETURN',
          originalPurchaseId: originalPurchase._id,
          supplierId: originalPurchase.supplierId,
          supplierName: originalPurchase.supplierName,
          items: returnedItems.map(item => ({
            productId: item.productId,
            productName: item.productName,
            batchNumber: item.batchNumber,
            returnedQty: item.returnQty,
            rate: item.rate,
          })),
          reason,
          notes,
          totalReturnValue,
          settlement: {
            type: refundChoice.type,
            amountRefunded: refundChoice.amountRefunded || 0,
            creditNoteAmount: refundChoice.creditNoteAmount || 0,
          },
          createdAt: new Date().toISOString(),
        };

        // Save return record and update supplier in parallel
        const [returnResponse] = await Promise.all([
          axios.post(PURCHASES_DB_URL, returnRecord, DB_AUTH),
          supplier ? useSupplierStore.getState()._updateSupplierBalance(supplier._id, finalBalanceChange) : Promise.resolve()
        ]);

        // Update original purchase
        const purchaseToUpdate = { ...originalPurchase };
        purchaseToUpdate.items.forEach(origItem => {
          const itemToReturn = returnedItems.find(
            retItem => retItem.productId === origItem.productId && 
                      retItem.batchNumber === origItem.batchNumber
          );
          if (itemToReturn) {
            origItem.returnedQty = (origItem.returnedQty || 0) + itemToReturn.returnQty;
          }
        });

        // Update purchase status
        const totalReturnedQty = purchaseToUpdate.items.reduce((sum, item) => sum + (item.returnedQty || 0), 0);
        const totalOriginalQty = purchaseToUpdate.items.reduce((sum, item) => sum + item.qty, 0);
        purchaseToUpdate.status = totalReturnedQty >= totalOriginalQty ? 'Fully Returned' : 'Partially Returned';
        
        await axios.put(`${PURCHASES_DB_URL}/${purchaseToUpdate._id}`, purchaseToUpdate, DB_AUTH);

        // Process product updates in batches
        const productProcessor = async (item) => {
          try {
            const productRes = await axios.get(`${PRODUCTS_DB_URL}/${item.productId}`, DB_AUTH);
            const productToUpdate = productRes.data;
            
            if (!productToUpdate.batches) productToUpdate.batches = [];

            const batchToUpdate = productToUpdate.batches.find(b => b.batchNumber === item.batchNumber);
            if (batchToUpdate) {
              batchToUpdate.quantity = Math.max(0, (Number(batchToUpdate.quantity) || 0) - item.returnQty);
            }

            await useProductStore.getState().updateProduct(productToUpdate);
            return { success: true, item };
          } catch (error) {
            console.error(`Error updating product ${item.productId}:`, error);
            return { success: false, item, error };
          }
        };

        await processBatch(returnedItems, productProcessor, PERFORMANCE_CONFIG.CONCURRENT_REQUESTS);

        // Log audit events in background
        setTimeout(() => {
          returnedItems.forEach(item => {
            useAuditStore.getState().logEvent({
              eventType: 'RETURN_SUPPLIER',
              productId: item.productId,
              productName: item.productName,
              details: {
                quantity: item.returnQty,
                reason: reason,
                supplierName: originalPurchase.supplierName,
                purchaseId: originalPurchase._id
              }
            });
          });
        }, 0);

        // Clear cache and refresh data
        purchaseCache.clear();
        
        setTimeout(() => {
          get().fetchPurchases(true);
          useInventoryStore.getState().fetchInventory?.();
          if (supplier) useSupplierStore.getState().fetchSuppliers?.();
        }, 100);

        set({ isLoading: false });
        
        return { success: true };

      } catch (error) {
        console.error("Error processing purchase return:", error);
        set({ isLoading: false });
        
        return { success: false, message: 'Failed to process return.' };
      }
    });
  },

  // =================================================================
  //  UTILITY METHODS
  // =================================================================

  // Clear cache manually
  clearCache: () => {
    purchaseCache.clear();
  },

  // Get purchases by date range (optimized)
  getPurchasesByDateRange: (startDate, endDate) => {
    const { purchases } = get();
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return purchases.filter(purchase => {
      const purchaseDate = new Date(purchase.createdAt);
      return purchaseDate >= start && purchaseDate <= end;
    });
  }
}));
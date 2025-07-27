// inventoryStore.js - CLEAN & LIGHTWEIGHT VERSION
import { create } from 'zustand';
import CacheManager from '../utils/cache/index';
import { ProductOperations } from './inventory/productOperations';
import { 
  InventoryWorkerManager, 
  PerformanceMonitor, 
  PERFORMANCE_CONFIG 
} from './inventory/performanceManager';
import axios from 'axios';

// =================================================================
//  LIGHTWEIGHT INVENTORY STORE - MINIMAL & CLEAN
// =================================================================

// Initialize performance tools
const workerManager = new InventoryWorkerManager();
const perfMonitor = new PerformanceMonitor();

// Database Configuration
const DB_URL = 'http://localhost:5984/products';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useInventoryStore = create((set, get) => {
  // Initialize operations instance
  let operations = null;

  // Helper function to ensure operations is initialized
  const ensureOperationsInitialized = () => {
    if (!operations) {
      operations = new ProductOperations(get);
    }
    return operations;
  };

  // Direct fetch function for when operations are not available
  const directFetchProducts = async () => {
    try {
      const response = await axios.get(`${DB_URL}/_all_docs?include_docs=true`, DB_AUTH);
      return response.data.rows
        .filter(row => row.doc.type === 'product')
        .map(row => {
          const { _rev, type, ...product } = row.doc;
          return product;
        });
    } catch (error) {
      console.error('❌ Direct fetch failed:', error);
      throw error;
    }
  };

  return {
    // =================================================================
    //  🎯 CORE STATE - MINIMAL & FOCUSED
    // =================================================================
    inventory: [],
    filteredInventory: [],
    stats: {
      totalProducts: 0,
      outOfStock: 0,
      lowStock: 0,
      expired: 0,
      expiringSoon: 0,
      totalValue: 0,
      inStock: 0,
      healthyStock: 0
    },
    
    // Status flags
    isLoading: false,
    isInitialized: false,
    isOnline: navigator.onLine,
    lastSyncTime: null,
    error: null,
    
    // Filters
    filters: {
      stockStatus: 'all',
      expiryStatus: 'all',
      category: 'all',
      search: ''
    },

    // =================================================================
    //  🚀 INITIALIZATION - LIGHTWEIGHT & FAST
    // =================================================================

    initialize: async () => {
      if (get().isInitialized) return;
      
      perfMonitor.start('initialize');
      set({ isLoading: true, error: null });

      try {
        // Initialize operations
        operations = new ProductOperations(get);
        
        // Check cache first
        const isEmpty = await CacheManager.isCacheEmpty();
        
        if (isEmpty) {
          await get().fetchFromRemote();
        } else {
          await get().loadFromCache();
        }

        // Setup connectivity listeners
        get().setupConnectivityListeners();
        
        set({ isInitialized: true, isLoading: false });
        console.log('✅ Inventory store initialized');
        perfMonitor.end('initialize');

      } catch (error) {
        console.error('❌ Initialization failed:', error);
        set({ error: 'Failed to initialize inventory', isLoading: false });
        perfMonitor.end('initialize');
      }
    },

    loadFromCache: async () => {
      perfMonitor.start('loadFromCache');
      
      try {
        const cachedProducts = await CacheManager.getAllCachedProducts();
        
        if (cachedProducts.length > 0) {
          const processedProducts = await workerManager.executeTask('PROCESS_BATCH', { 
            products: cachedProducts 
          });
          
          const stats = await workerManager.executeTask('CALCULATE_STATS', { 
            products: processedProducts 
          });
          
          set({
            inventory: processedProducts,
            filteredInventory: processedProducts,
            stats,
            lastSyncTime: await CacheManager.getLastSyncTime()
          });
          
          console.log(`📦 Loaded ${processedProducts.length} products from cache`);
        }
        
        perfMonitor.end('loadFromCache');
      } catch (error) {
        console.error('❌ Cache load failed:', error);
        perfMonitor.end('loadFromCache');
        throw error;
      }
    },

    fetchFromRemote: async () => {
      perfMonitor.start('fetchFromRemote');
      
      try {
        let products = [];
        
        // Try to use operations if available, otherwise use direct fetch
        try {
          const ops = ensureOperationsInitialized();
          if (ops && typeof ops.fetchAllProducts === 'function') {
            products = await ops.fetchAllProducts();
          } else {
            console.log('⚠️ Operations not available, using direct fetch');
            products = await directFetchProducts();
          }
        } catch (operationsError) {
          console.log('⚠️ Operations fetch failed, using direct fetch:', operationsError.message);
          products = await directFetchProducts();
        }
        
        if (products.length > 0) {
          // Process products through worker
          const processedProducts = await workerManager.executeTask('PROCESS_BATCH', { 
            products 
          });
          
          const stats = await workerManager.executeTask('CALCULATE_STATS', { 
            products: processedProducts 
          });
          
          set({
            inventory: processedProducts,
            filteredInventory: processedProducts,
            stats,
            lastSyncTime: new Date()
          });
          
          // Background cache
          CacheManager.cacheProducts(processedProducts).catch(console.error);
          
          console.log(`✅ Fetched ${processedProducts.length} products from remote`);
        }
        
        perfMonitor.end('fetchFromRemote');
      } catch (error) {
        console.error('❌ Remote fetch failed:', error);
        perfMonitor.end('fetchFromRemote');
        throw error;
      }
    },

    // =================================================================
    //  🎯 SMART SYNC - ONLY WHEN NEEDED
    // =================================================================

    smartSync: async () => {
      const state = get();
      
      // Skip if not needed
      if (!state.isOnline || state.inventory.length === 0) return;
      
      const isStale = await CacheManager.isCacheStale(PERFORMANCE_CONFIG.CACHE_STALE_HOURS);
      if (!isStale) {
        console.log('✅ Cache is fresh, skipping sync');
        return;
      }
      
      // Background sync
      requestIdleCallback(async () => {
        try {
          await get().fetchFromRemote();
          console.log('✅ Background sync completed');
        } catch (error) {
          console.warn('⚠️ Background sync failed:', error);
        }
      });
    },

    // =================================================================
    //  🚀 OPTIMIZED PRODUCT OPERATIONS - DELEGATE TO OPERATIONS CLASS
    // =================================================================

    // Product CRUD
    createProduct: async (productData) => {
      const ops = ensureOperationsInitialized();
      return await ops.createProduct(productData);
    },

    updateProduct: async (productId, updates) => {
      const ops = ensureOperationsInitialized();
      return await ops.updateProduct(productId, updates);
    },

    deleteProduct: async (productId) => {
      const ops = ensureOperationsInitialized();
      return await ops.deleteProduct(productId);
    },

    // Batch CRUD
    createBatch: async (productId, batchData) => {
      const ops = ensureOperationsInitialized();
      return await ops.createProductBatch(productId, batchData);
    },

    updateBatch: async (productId, batchId, updates) => {
      const ops = ensureOperationsInitialized();
      return await ops.updateProductBatch(productId, batchId, updates);
    },

    deleteBatch: async (productId, batchId) => {
      const ops = ensureOperationsInitialized();
      return await ops.deleteBatch(productId, batchId);
    },

    // Bulk operations
    bulkCreateProducts: async (productsData) => {
      const ops = ensureOperationsInitialized();
      return await ops.bulkCreateProducts(productsData);
    },

    bulkUpdateProducts: async (updates) => {
      const ops = ensureOperationsInitialized();
      return await ops.bulkUpdateProducts(updates);
    },

    // =================================================================
    //  📊 INVENTORY UPDATES - SMART & SELECTIVE
    // =================================================================

    updateForSoldItems: async (soldItems) => {
      if (!soldItems || soldItems.length === 0) return { success: true };
      
      perfMonitor.start('updateForSoldItems');
      
      try {
        // Filter non-manual items only
        const inventoryItems = soldItems.filter(item => !item.isManual);
        if (inventoryItems.length === 0) {
          perfMonitor.end('updateForSoldItems');
          return { success: true, updatedProducts: 0 };
        }

        // Get unique product IDs
        const productIds = [...new Set(inventoryItems.map(item => item._id))];
        
        // Update only affected products
        const result = await get().updateSpecificProducts(productIds, inventoryItems);
        
        perfMonitor.end('updateForSoldItems');
        return result;

      } catch (error) {
        console.error('❌ Update for sold items failed:', error);
        perfMonitor.end('updateForSoldItems');
        return { success: false, error: error.message };
      }
    },

    updateSpecificProducts: async (productIds, soldItems) => {
      const state = get();
      const updatedInventory = [...state.inventory];
      let updatedCount = 0;

      // Process each affected product
      for (const productId of productIds) {
        const productIndex = updatedInventory.findIndex(p => p._id === productId);
        
        if (productIndex !== -1) {
          const product = updatedInventory[productIndex];
          const productSoldItems = soldItems.filter(item => item._id === productId);
          
          // Update batches for this product
          const updatedProduct = { ...product };
          
          if (updatedProduct.batches?.length > 0) {
            updatedProduct.batches = updatedProduct.batches.map(batch => {
              const batchSoldItems = productSoldItems.filter(
                item => item.sourceBatchInfo?.id === batch.id
              );
              
              if (batchSoldItems.length > 0) {
                const totalDeducted = batchSoldItems.reduce((sum, item) => 
                  sum + (item.quantity || 0), 0
                );
                
                const newQuantity = Math.max(0, (batch.quantity || 0) - totalDeducted);
                
                return {
                  ...batch,
                  quantity: newQuantity,
                  soldOutAt: newQuantity === 0 && !batch.soldOutAt ? 
                    new Date().toISOString() : batch.soldOutAt
                };
              }
              
              return batch;
            });
            
            updatedInventory[productIndex] = updatedProduct;
            updatedCount++;
          }
        }
      }

      if (updatedCount > 0) {
        // Recalculate stats
        const stats = await workerManager.executeTask('CALCULATE_STATS', { 
          products: updatedInventory 
        });
        
        set({
          inventory: updatedInventory,
          filteredInventory: updatedInventory,
          stats,
          lastSyncTime: new Date()
        });

        // Reapply filters
        await get().applyFilters();
        
        // Background cache update
        requestIdleCallback(() => {
          CacheManager.cacheProducts(updatedInventory).catch(console.error);
        });
      }

      return { success: true, updatedProducts: updatedCount };
    },

    // Helper methods for inventory management
    addProductToInventory: async (product) => {
      try {
        const state = get();
        const updatedInventory = [...state.inventory, product];
        
        const stats = await workerManager.executeTask('CALCULATE_STATS', { 
          products: updatedInventory 
        });
        
        set({
          inventory: updatedInventory,
          filteredInventory: updatedInventory,
          stats,
          lastSyncTime: new Date()
        });
        
        return { success: true };
      } catch (error) {
        console.error('❌ Error adding product to inventory:', error);
        return { success: false, error: error.message };
      }
    },

    updateProductInInventory: async (updatedProduct) => {
      try {
        const state = get();
        const updatedInventory = state.inventory.map(p => 
          p._id === updatedProduct._id ? updatedProduct : p
        );
        
        const stats = await workerManager.executeTask('CALCULATE_STATS', { 
          products: updatedInventory 
        });
        
        set({
          inventory: updatedInventory,
          filteredInventory: updatedInventory,
          stats,
          lastSyncTime: new Date()
        });
        
        return { success: true };
      } catch (error) {
        console.error('❌ Error updating product in inventory:', error);
        return { success: false, error: error.message };
      }
    },

    removeProductFromInventory: async (productId) => {
      try {
        const state = get();
        const updatedInventory = state.inventory.filter(p => p._id !== productId);
        
        const stats = await workerManager.executeTask('CALCULATE_STATS', { 
          products: updatedInventory 
        });
        
        set({
          inventory: updatedInventory,
          filteredInventory: updatedInventory,
          stats,
          lastSyncTime: new Date()
        });
        
        return { success: true };
      } catch (error) {
        console.error('❌ Error removing product from inventory:', error);
        return { success: false, error: error.message };
      }
    },

    // =================================================================
    //  🔍 FILTERING & SEARCH - WORKER-POWERED  
    // =================================================================

    updateFilters: (newFilters) => {
      set(state => ({
        filters: { ...state.filters, ...newFilters }
      }));
      
      // Debounced filter application
      clearTimeout(get().filterTimeout);
      const timeout = setTimeout(() => get().applyFilters(), PERFORMANCE_CONFIG.DEBOUNCE_DELAY);
      set({ filterTimeout: timeout });
    },

    applyFilters: async () => {
      const { inventory, filters } = get();
      
      try {
        const filteredProducts = await workerManager.executeTask('FILTER_PRODUCTS', {
          products: inventory,
          criteria: filters
        });

        set({ filteredInventory: filteredProducts });
      } catch (error) {
        console.error('❌ Filter failed:', error);
        set({ filteredInventory: inventory });
      }
    },

    searchProducts: async (keyword) => {
      if (!keyword?.trim()) {
        set({ filteredInventory: get().inventory });
        return;
      }

      try {
        const results = await workerManager.executeTask('FILTER_PRODUCTS', {
          products: get().inventory,
          criteria: { search: keyword.trim() }
        });

        set({ filteredInventory: results });
      } catch (error) {
        console.error('❌ Search failed:', error);
      }
    },

    // =================================================================
    //  📊 ANALYTICS - DELEGATE TO WORKER
    // =================================================================

    getLowStockProducts: async (threshold) => {
      try {
        return await workerManager.executeTask('GET_LOW_STOCK', {
          products: get().inventory,
          threshold
        });
      } catch (error) {
        console.error('❌ Low stock query failed:', error);
        return [];
      }
    },

    getExpiringBatches: async (days = 30) => {
      try {
        return await workerManager.executeTask('GET_EXPIRING_BATCHES', {
          products: get().inventory,
          days
        });
      } catch (error) {
        console.error('❌ Expiring batches query failed:', error);
        return [];
      }
    },

    getOutOfStockProducts: () => {
      return get().inventory.filter(p => p.stockStatus === 'out-of-stock');
    },

    getExpiredProducts: () => {
      return get().inventory.filter(p => p.expiryStatus === 'expired');
    },

    getRecentlySoldOutBatches: () => {
      const soldOutBatches = [];
      const now = new Date();
      const recentThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      
      get().inventory.forEach(product => {
        if (product.batches && Array.isArray(product.batches)) {
          product.batches.forEach(batch => {
            if (batch.quantity === 0 && 
                batch.soldOutAt && 
                new Date(batch.soldOutAt) >= recentThreshold) {
              soldOutBatches.push({
                ...batch,
                productName: product.name,
                productId: product._id
              });
            }
          });
        }
      });
      
      return soldOutBatches.sort((a, b) => new Date(b.soldOutAt) - new Date(a.soldOutAt));
    },

    // =================================================================
    //  🛠️ UTILITIES & HELPERS
    // =================================================================

    getProductById: (productId) => {
      return get().inventory.find(p => p._id === productId) || null;
    },

    getStats: () => get().stats,

    getConnectionStatus: () => ({
      isOnline: get().isOnline,
      isInitialized: get().isInitialized,
      isLoading: get().isLoading,
      lastSyncTime: get().lastSyncTime,
      error: get().error
    }),

    getOperationsStatus: () => {
      return operations ? operations.getQueueStatus() : null;
    },

    // =================================================================
    //  🔧 SETUP & CLEANUP
    // =================================================================

    setupConnectivityListeners: () => {
      const handleOnline = () => {
        set({ isOnline: true });
        get().smartSync();
      };

      const handleOffline = () => {
        set({ isOnline: false });
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    },

    forceSync: async () => {
      if (!get().isOnline) {
        throw new Error('Cannot sync while offline');
      }
      
      await get().fetchFromRemote();
      return { success: true };
    },

    clearCache: async () => {
      await CacheManager.clearAllCache();
      set({
        inventory: [],
        filteredInventory: [],
        stats: {
          totalProducts: 0, outOfStock: 0, lowStock: 0,
          expired: 0, expiringSoon: 0, totalValue: 0,
          inStock: 0, healthyStock: 0
        },
        lastSyncTime: null,
        isInitialized: false
      });
      
      return { success: true };
    },

    cleanup: () => {
      console.log('🧹 Cleaning up inventory store...');
      
      // Cleanup operations
      if (operations) {
        operations.cleanup();
      }
      
      // Cleanup worker
      if (workerManager) {
        workerManager.terminate();
      }
      
      // Clear timeouts
      clearTimeout(get().filterTimeout);
      
      console.log('✅ Inventory store cleanup completed');
    }
  };
});

// =================================================================
//  🔄 AUTO-INITIALIZATION & CLEANUP
// =================================================================

// Auto-initialize when store is first accessed
let isAutoInitialized = false;
const originalGetState = useInventoryStore.getState;
useInventoryStore.getState = () => {
  const state = originalGetState();
  
  if (!isAutoInitialized) {
    isAutoInitialized = true;
    state.initialize().catch(console.error);
  }
  
  return state;
};

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    useInventoryStore.getState().cleanup();
  });
}

// Export utilities
export { workerManager, perfMonitor };

export default useInventoryStore;
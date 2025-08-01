// inventoryStore.js - PouchDB ONLY VERSION (No Remote Sync)
import { create } from 'zustand';
import CacheManager from '../utils/cache/index';
import { ProductOperations } from './inventory/productOperations';
import { 
  InventoryWorkerManager, 
  PerformanceMonitor, 
  PERFORMANCE_CONFIG 
} from './inventory/performanceManager';

// =================================================================
//  POUCHDB-ONLY INVENTORY STORE - NO REMOTE SYNC
// =================================================================

// Initialize performance tools
const workerManager = new InventoryWorkerManager();
const perfMonitor = new PerformanceMonitor();

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
    lastUpdateTime: null,
    error: null,
    
    // Filters
    filters: {
      stockStatus: 'all',
      expiryStatus: 'all',
      category: 'all',
      search: ''
    },

    // =================================================================
    //  🚀 INITIALIZATION - POUCHDB ONLY
    // =================================================================

    initialize: async () => {
      if (get().isInitialized) return;
      
      perfMonitor.start('initialize');
      set({ isLoading: true, error: null });

      try {
        // Initialize operations
        operations = new ProductOperations(get);
        
        // Load from PouchDB cache
        await get().loadFromCache();
        
        set({ isInitialized: true, isLoading: false });
        console.log('✅ Inventory store initialized (PouchDB only)');
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
            lastUpdateTime: new Date()
          });
          
          console.log(`📦 Loaded ${processedProducts.length} products from PouchDB`);
        } else {
          console.log('📭 No products found in PouchDB cache');
        }
        
        perfMonitor.end('loadFromCache');
      } catch (error) {
        console.error('❌ Cache load failed:', error);
        perfMonitor.end('loadFromCache');
        throw error;
      }
    },

    // =================================================================
    //  🚀 PRODUCT OPERATIONS - POUCHDB ONLY
    // =================================================================

    // Product CRUD
    createProduct: async (productData) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.createProduct(productData);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    updateProduct: async (productId, updates) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.updateProduct(productId, updates);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    deleteProduct: async (productId) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.deleteProduct(productId);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    // Batch CRUD
    createBatch: async (productId, batchData) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.createProductBatch(productId, batchData);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    updateBatch: async (productId, batchId, updates) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.updateProductBatch(productId, batchId, updates);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    deleteBatch: async (productId, batchId) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.deleteBatch(productId, batchId);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    // Bulk operations
    bulkCreateProducts: async (productsData) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.bulkCreateProducts(productsData);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    bulkUpdateProducts: async (updates) => {
      const ops = ensureOperationsInitialized();
      const result = await ops.bulkUpdateProducts(updates);
      
      if (result.success) {
        // Update state immediately
        await get().refreshInventory();
      }
      
      return result;
    },

    // =================================================================
    //  📊 INVENTORY UPDATES - POUCHDB OPTIMIZED
    // =================================================================

    refreshInventory: async () => {
      try {
        perfMonitor.start('refreshInventory');
        
        // Load fresh data from PouchDB
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
            lastUpdateTime: new Date()
          });
          
          // Reapply filters
          await get().applyFilters();
        }
        
        perfMonitor.end('refreshInventory');
        return { success: true };
        
      } catch (error) {
        console.error('❌ Refresh inventory failed:', error);
        perfMonitor.end('refreshInventory');
        return { success: false, error: error.message };
      }
    },

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
        
        // Update products in PouchDB
        let updatedCount = 0;
        for (const productId of productIds) {
          const product = await CacheManager.getCachedProduct(productId);
          if (!product) continue;

          const productSoldItems = inventoryItems.filter(item => item._id === productId);
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
            
            // Save updated product to PouchDB
            await CacheManager.cacheProduct(updatedProduct);
            updatedCount++;
          }
        }

        if (updatedCount > 0) {
          // Refresh inventory from PouchDB
          await get().refreshInventory();
        }

        perfMonitor.end('updateForSoldItems');
        return { success: true, updatedProducts: updatedCount };

      } catch (error) {
        console.error('❌ Update for sold items failed:', error);
        perfMonitor.end('updateForSoldItems');
        return { success: false, error: error.message };
      }
    },

    // Helper methods for direct inventory management
    addProductToInventory: async (product) => {
      try {
        // Save to PouchDB first
        await CacheManager.cacheProduct(product);
        
        // Update state
        const state = get();
        const updatedInventory = [...state.inventory, product];
        
        const stats = await workerManager.executeTask('CALCULATE_STATS', { 
          products: updatedInventory 
        });
        
        set({
          inventory: updatedInventory,
          filteredInventory: updatedInventory,
          stats,
          lastUpdateTime: new Date()
        });
        
        return { success: true };
      } catch (error) {
        console.error('❌ Error adding product to inventory:', error);
        return { success: false, error: error.message };
      }
    },

    updateProductInInventory: async (updatedProduct) => {
      try {
        // Save to PouchDB first
        await CacheManager.cacheProduct(updatedProduct);
        
        // Update state
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
          lastUpdateTime: new Date()
        });
        
        return { success: true };
      } catch (error) {
        console.error('❌ Error updating product in inventory:', error);
        return { success: false, error: error.message };
      }
    },

    removeProductFromInventory: async (productId) => {
      try {
        // Remove from PouchDB first
        await CacheManager.removeCachedProduct(productId);
        
        // Update state
        const state = get();
        const updatedInventory = state.inventory.filter(p => p._id !== productId);
        
        const stats = await workerManager.executeTask('CALCULATE_STATS', { 
          products: updatedInventory 
        });
        
        set({
          inventory: updatedInventory,
          filteredInventory: updatedInventory,
          stats,
          lastUpdateTime: new Date()
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
      isInitialized: get().isInitialized,
      isLoading: get().isLoading,
      lastUpdateTime: get().lastUpdateTime,
      error: get().error,
      cacheHealthy: true // Always true for PouchDB-only
    }),

    getOperationsStatus: () => {
      return operations ? operations.getQueueStatus() : null;
    },

    // PouchDB Health Check
    checkPouchDBHealth: async () => {
      try {
        const health = await CacheManager.healthCheck();
        return {
          healthy: health.healthy,
          totalProducts: health.productsCount,
          totalBatches: health.batchesCount,
          cacheSize: health.totalSize
        };
      } catch (error) {
        console.error('❌ PouchDB health check failed:', error);
        return { healthy: false, error: error.message };
      }
    },

    // =================================================================
    //  🔧 SETUP & CLEANUP
    // =================================================================

    clearAllData: async () => {
      try {
        // Clear PouchDB cache
        await CacheManager.clearAllCache();
        
        // Reset state
        set({
          inventory: [],
          filteredInventory: [],
          stats: {
            totalProducts: 0, outOfStock: 0, lowStock: 0,
            expired: 0, expiringSoon: 0, totalValue: 0,
            inStock: 0, healthyStock: 0
          },
          lastUpdateTime: null,
          isInitialized: false
        });
        
        return { success: true };
      } catch (error) {
        console.error('❌ Error clearing all data:', error);
        return { success: false, error: error.message };
      }
    },

    // Import/Export functionality for data backup
    exportData: async () => {
      try {
        const products = await CacheManager.getAllCachedProducts();
        const exportData = {
          version: '1.0',
          timestamp: new Date().toISOString(),
          products: products,
          stats: get().stats
        };
        
        return { success: true, data: exportData };
      } catch (error) {
        console.error('❌ Error exporting data:', error);
        return { success: false, error: error.message };
      }
    },

    importData: async (importData) => {
      try {
        if (!importData.products || !Array.isArray(importData.products)) {
          throw new Error('Invalid import data format');
        }
        
        // Clear existing data
        await get().clearAllData();
        
        // Import products
        for (const product of importData.products) {
          await CacheManager.cacheProduct(product);
        }
        
        // Refresh inventory
        await get().refreshInventory();
        
        return { 
          success: true, 
          imported: importData.products.length,
          message: `Successfully imported ${importData.products.length} products`
        };
        
      } catch (error) {
        console.error('❌ Error importing data:', error);
        return { success: false, error: error.message };
      }
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
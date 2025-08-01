// productStore.js - PouchDB-Only Ultra-Optimized for Maximum Performance
import { create } from 'zustand';
import { useInventoryStore } from './inventoryStore';
import { useAuditStore } from './auditStore';
import CacheManager from '../utils/cache/index';

// === PERFORMANCE-FIRST CONFIGURATION ===
const ULTRA_PERFORMANCE_CONFIG = {
  DEBOUNCE_DELAY: 50, // Ultra-fast response
  BATCH_SIZE: 500, // Larger batches for better throughput
  CONCURRENT_REQUESTS: 8, // Higher concurrency
  IDLE_TIMEOUT: 5, // Faster processing
  CACHE_FIRST: true,
  USE_STREAMING: true,
  USE_INCREMENTAL_SYNC: true,
  ENABLE_COMPRESSION: true,
  // New ultra-optimizations
  USE_MEMORY_POOLING: true,
  ENABLE_LAZY_LOADING: true,
  USE_VIRTUAL_SCROLLING: true,
  OPTIMIZE_GARBAGE_COLLECTION: true
};

// === ULTRA-FAST SYNC MANAGER (PouchDB Only) ===
class UltraFastSyncManager {
  constructor() {
    this.hasInitialLoadCompleted = false;
    this.loadInProgress = false;
    this.lastLoadTime = null;
    this.loadErrors = [];
    this.loadStats = {
      totalLoaded: 0,
      lastLoadDuration: 0,
      avgLoadTime: 0,
      loadCount: 0,
      fastestLoad: Infinity,
      slowestLoad: 0
    };
    this.retryAttempts = 0;
    this.maxRetries = 3;
  }

  markLoadCompleted(stats = {}) {
    this.hasInitialLoadCompleted = true;
    this.loadInProgress = false;
    this.lastLoadTime = new Date();
    this.retryAttempts = 0; // Reset retry counter on success
    
    if (stats.duration) {
      this.loadStats.lastLoadDuration = stats.duration;
      this.loadStats.loadCount++;
      this.loadStats.fastestLoad = Math.min(this.loadStats.fastestLoad, stats.duration);
      this.loadStats.slowestLoad = Math.max(this.loadStats.slowestLoad, stats.duration);
      this.loadStats.avgLoadTime = 
        (this.loadStats.avgLoadTime * (this.loadStats.loadCount - 1) + stats.duration) / this.loadStats.loadCount;
    }
    
    if (stats.count) {
      this.loadStats.totalLoaded += stats.count;
    }
    
    console.log(`🚀 Ultra-fast PouchDB load completed - ${stats.count || 0} items in ${stats.duration || 0}ms`);
  }

  markLoadFailed(error) {
    this.loadInProgress = false;
    this.retryAttempts++;
    
    if (this.retryAttempts >= this.maxRetries) {
      this.loadErrors.push({ error: error.message, timestamp: new Date() });
      console.warn(`⚠️ Load failed after ${this.maxRetries} attempts`);
    } else {
      console.warn(`⚠️ Load failed (attempt ${this.retryAttempts}/${this.maxRetries}) - retrying...`);
    }
  }

  shouldLoad() {
    return !this.hasInitialLoadCompleted && !this.loadInProgress;
  }

  canRetry() {
    return this.retryAttempts < this.maxRetries;
  }

  getStatus() {
    return {
      hasInitialLoadCompleted: this.hasInitialLoadCompleted,
      loadInProgress: this.loadInProgress,
      lastLoadTime: this.lastLoadTime,
      errorCount: this.loadErrors.length,
      retryAttempts: this.retryAttempts,
      stats: this.loadStats
    };
  }
}

// === ULTRA-OPTIMIZED WORKER MANAGER ===
class UltraOptimizedWorkerManager {
  constructor() {
    this.worker = null;
    this.taskQueue = [];
    this.isProcessing = false;
    this.resultCache = new Map();
    this.initWorker();
  }

  initWorker() {
    const workerCode = `
  class UltraProductProcessor {
    static processProductsStream(products, batchSize = 100) {
      const results = [];
      const len = products.length;
      
      // Use typed arrays for better performance
      const quantities = new Float32Array(len);
      const prices = new Float32Array(len);
      
      // Process in optimized chunks
      for (let i = 0; i < len; i += batchSize) {
        const end = Math.min(i + batchSize, len);
        const chunk = products.slice(i, end);
        
        // Parallel processing within chunk
        const processed = chunk.map((product, idx) => {
          const totalQuantity = this.fastCalculateQuantity(product);
          quantities[i + idx] = totalQuantity;
          prices[i + idx] = this.fastCalculatePrice(product);
          
          return {
            ...product,
            totalQuantity,
            searchableName: (product.name || '').toLowerCase(),
            finalPrice: prices[i + idx],
            searchIndex: this.createFastSearchIndex(product),
            lastModified: Date.now(),
            processed: true
          };
        });
        
        results.push(...processed);
        
        // Yield control every chunk to prevent blocking
        if (i % (batchSize * 5) === 0) {
          self.postMessage({ type: 'progress', processed: results.length, total: len });
        }
      }
      
      return results;
    }

    static fastCalculateQuantity(product) {
      if (!product?.batches?.length) return 0;
      let total = 0;
      for (let i = 0; i < product.batches.length; i++) {
        total += (product.batches[i].quantity || 0);
      }
      return total;
    }

    static fastCalculatePrice(product) {
      const retail = parseFloat(product.retailPrice) || 0;
      const discount = parseFloat(product.discountRate) || 0;
      const tax = (product.taxRate === 'default' || isNaN(parseFloat(product.taxRate))) ? 0 : parseFloat(product.taxRate);
      
      const afterDiscount = retail * (1 - discount / 100);
      return afterDiscount * (1 + tax / 100);
    }

    static createFastSearchIndex(product) {
      return [
        product.name || '',
        product.sku || '',
        product.barcode || '',
        product.category || '',
        product.brand || ''
      ].filter(Boolean).join(' ').toLowerCase();
    }

    // Ultra-fast filtering with early termination
    static ultraFilterProducts(products, filters) {
      if (!filters.category && !filters.stock && !filters.search) return products;
      
      const results = [];
      const search = filters.search?.toLowerCase() || '';
      const category = filters.category;
      const stock = filters.stock;
      
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        
        if (search && !product.searchIndex?.includes(search)) continue;
        if (category !== 'all' && product.category !== category) continue;
        
        if (stock !== 'all') {
          const qty = product.totalQuantity || 0;
          if (stock === 'in' && qty <= 10) continue;
          if (stock === 'low' && (qty > 10 || qty === 0)) continue;
          if (stock === 'out' && qty !== 0) continue;
        }
        
        results.push(product);
      }
      
      return results;
    }

    // Optimized sorting with minimal allocations
    static ultraSortProducts(products, sortConfig) {
      if (!sortConfig.key) return products;
      
      const key = sortConfig.key;
      const desc = sortConfig.direction === 'desc';
      const isNumeric = ['retailPrice', 'totalQuantity', 'purchasePrice'].includes(key);
      
      // Use native sort with optimized comparator
      return products.sort((a, b) => {
        let aVal = a[key];
        let bVal = b[key];
        
        if (isNumeric) {
          aVal = parseFloat(aVal) || 0;
          bVal = parseFloat(bVal) || 0;
          return desc ? bVal - aVal : aVal - bVal;
        }
        
        if (typeof aVal === 'string') {
          aVal = aVal.toLowerCase();
          bVal = (bVal || '').toLowerCase();
        }
        
        const result = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return desc ? -result : result;
      });
    }
  }

  self.onmessage = function(e) {
    const { type, data, id } = e.data;
    const startTime = performance.now();
    
    try {
      let result;
      
      switch (type) {
        case 'PROCESS_PRODUCTS_STREAM':
          result = UltraProductProcessor.processProductsStream(data.products, data.batchSize);
          break;
        case 'ULTRA_FILTER_PRODUCTS':
          result = UltraProductProcessor.ultraFilterProducts(data.products, data.filters);
          break;
        case 'ULTRA_SORT_PRODUCTS':
          result = UltraProductProcessor.ultraSortProducts(data.products, data.sortConfig);
          break;
        default:
          throw new Error('Unknown task type: ' + type);
      }
      
      const duration = performance.now() - startTime;
      self.postMessage({ 
        success: true, 
        result, 
        id, 
        duration,
        type: 'complete'
      });
      
    } catch (error) {
      self.postMessage({ 
        success: false, 
        error: error.message, 
        id,
        type: 'error'
      });
    }
  };
`;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    
    this.worker.onmessage = (e) => {
      const { success, result, error, id, duration, type } = e.data;
      
      if (type === 'progress') {
        // Handle progress updates
        return;
      }
      
      const task = this.taskQueue.find(t => t.id === id);
      if (task) {
        this.taskQueue = this.taskQueue.filter(t => t.id !== id);
        
        if (success) {
          // Cache successful results
          if (task.cacheable) {
            this.resultCache.set(task.cacheKey, result);
          }
          task.resolve(result);
        } else {
          task.reject(new Error(error));
        }
        
        console.log(`⚡ Worker task ${task.type} completed in ${duration?.toFixed(2) || 'N/A'}ms`);
      }
      
      this.processNextTask();
    };
  }

  async executeTask(type, data, cacheable = false) {
    const cacheKey = cacheable ? `${type}_${JSON.stringify(data).slice(0, 100)}` : null;
    
    // Check cache first
    if (cacheable && this.resultCache.has(cacheKey)) {
      console.log(`📋 Cache hit for ${type}`);
      return this.resultCache.get(cacheKey);
    }
    
    return new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();
      const task = { id, type, data, resolve, reject, cacheable, cacheKey };
      this.taskQueue.push(task);
      
      if (!this.isProcessing) {
        this.processNextTask();
      }
    });
  }

  async processStream(products, batchSize = 500) {
    return this.executeTask('PROCESS_PRODUCTS_STREAM', { products, batchSize });
  }

  processNextTask() {
    if (this.taskQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const task = this.taskQueue[0];
    this.worker.postMessage({ type: task.type, data: task.data, id: task.id });
  }

  clearCache() {
    this.resultCache.clear();
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.resultCache.clear();
  }
}

// === ULTRA-FAST PERFORMANCE MONITOR ===
class UltraPerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.history = [];
    this.thresholds = {
      ultraFast: 100,
      fast: 250,
      acceptable: 500,
      slow: 1000
    };
  }

  start(operation) {
    this.metrics.set(operation, {
      startTime: performance.now(),
      memoryBefore: performance.memory?.usedJSHeapSize || 0
    });
  }

  end(operation) {
    const startData = this.metrics.get(operation);
    if (!startData) return 0;
    
    const duration = performance.now() - startData.startTime;
    const memoryAfter = performance.memory?.usedJSHeapSize || 0;
    const memoryDelta = memoryAfter - startData.memoryBefore;
    
    const metric = {
      operation,
      duration,
      memoryDelta,
      timestamp: new Date()
    };
    
    this.history.push(metric);
    
    // Keep only last 50 entries for better memory usage
    if (this.history.length > 50) {
      this.history.shift();
    }
    
    // Enhanced logging with performance indicators
    const memoryMB = (memoryDelta / 1024 / 1024).toFixed(2);
    if (duration < this.thresholds.ultraFast) {
      console.log(`🚀 ULTRA-FAST: ${operation}: ${duration.toFixed(2)}ms (${memoryMB}MB)`);
    } else if (duration < this.thresholds.fast) {
      console.log(`⚡ FAST: ${operation}: ${duration.toFixed(2)}ms (${memoryMB}MB)`);
    } else if (duration < this.thresholds.acceptable) {
      console.log(`✅ OK: ${operation}: ${duration.toFixed(2)}ms (${memoryMB}MB)`);
    } else if (duration < this.thresholds.slow) {
      console.warn(`⚠️ SLOW: ${operation}: ${duration.toFixed(2)}ms (${memoryMB}MB)`);
    } else {
      console.error(`🐌 VERY SLOW: ${operation}: ${duration.toFixed(2)}ms (${memoryMB}MB)`);
    }
    
    this.metrics.delete(operation);
    return duration;
  }

  getQuickStats() {
    const recent = this.history.slice(-10);
    const avgDuration = recent.reduce((sum, m) => sum + m.duration, 0) / recent.length || 0;
    const totalMemory = recent.reduce((sum, m) => sum + m.memoryDelta, 0);
    
    return {
      recentAvgDuration: avgDuration,
      totalMemoryDelta: totalMemory,
      operationCount: recent.length
    };
  }
}

// === POUCHDB-ONLY OPERATIONS ===
const ultraPouchDBOps = {
  async fetchAllDocumentsUltraFast() {
    const startTime = performance.now();
    
    try {
      console.log('📡 Loading all products from PouchDB...');
      
      // Load all products from PouchDB cache
      const products = await CacheManager.getAllCachedProducts();
      
      const duration = performance.now() - startTime;
      console.log(`📡 PouchDB load: ${products.length} documents in ${duration.toFixed(2)}ms`);
      
      return products;
        
    } catch (error) {
      console.error('❌ PouchDB load failed:', error);
      throw error;
    }
  }
};

// Initialize ultra-optimized components
const workerManager = new UltraOptimizedWorkerManager();
const perfMonitor = new UltraPerformanceMonitor();
const syncManager = new UltraFastSyncManager();

// === MAIN ULTRA-OPTIMIZED STORE (PouchDB Only) ===
export const useProductStore = create((set, get) => ({
  // Enhanced State
  allProducts: [],
  filteredProducts: [],
  posProducts: [],
  totalProducts: 0,
  productsPerPage: 50,
  isLoading: false,
  isCacheReady: false,
  lastLoadTime: null,
  
  // Filters and sorting
  filters: { category: 'all', stock: 'all', search: '' },
  sortConfig: { key: null, direction: 'asc' },

  // Enhanced load status (renamed from sync to load)
  loadStatus: syncManager.getStatus(),
  performanceStats: perfMonitor.getQuickStats(),

  // === ULTRA-FAST INITIALIZATION (PouchDB Only) ===
  initializeStore: async () => {
    perfMonitor.start('ultraFastInit');
    
    try {
      set({ isLoading: true });
      
      console.log('🚀 Ultra-fast PouchDB initialization starting...');
      
      // Load from PouchDB directly
      const cacheStartTime = performance.now();
      const cachedProducts = await ultraPouchDBOps.fetchAllDocumentsUltraFast();
      const cacheLoadTime = performance.now() - cacheStartTime;
      
      if (cachedProducts.length > 0) {
        console.log(`⚡ Loaded ${cachedProducts.length} products from PouchDB in ${cacheLoadTime.toFixed(2)}ms`);
        
        // Ultra-fast processing using streaming
        const processedProducts = await workerManager.processStream(
          cachedProducts, 
          ULTRA_PERFORMANCE_CONFIG.BATCH_SIZE
        );
        
        set({ 
          allProducts: processedProducts,
          filteredProducts: processedProducts,
          totalProducts: processedProducts.length,
          isCacheReady: true,
          isLoading: false,
          loadStatus: syncManager.getStatus()
        });
        
        syncManager.markLoadCompleted({ 
          count: processedProducts.length, 
          duration: perfMonitor.end('ultraFastInit') 
        });
      } else {
        console.log('📭 No products found in PouchDB');
        set({ 
          allProducts: [],
          filteredProducts: [],
          totalProducts: 0,
          isCacheReady: true,
          isLoading: false,
          loadStatus: syncManager.getStatus()
        });
        syncManager.markLoadCompleted({ count: 0, duration: perfMonitor.end('ultraFastInit') });
      }
      
    } catch (error) {
      console.error('❌ Ultra-fast initialization failed:', error);
      syncManager.markLoadFailed(error);
      set({ isLoading: false, loadStatus: syncManager.getStatus() });
      perfMonitor.end('ultraFastInit');
    }
  },

  // === ULTRA-FAST REFRESH FROM POUCHDB ===
  refreshFromPouchDB: async () => {
    perfMonitor.start('ultraFastRefresh');
    
    try {
      console.log('🔄 Refreshing from PouchDB...');
      set({ isLoading: true });
      
      const products = await ultraPouchDBOps.fetchAllDocumentsUltraFast();
      
      if (products.length > 0) {
        // Ultra-fast processing
        const processedProducts = await workerManager.processStream(
          products, 
          ULTRA_PERFORMANCE_CONFIG.BATCH_SIZE
        );
        
        set({ 
          allProducts: processedProducts,
          filteredProducts: processedProducts,
          totalProducts: processedProducts.length,
          isLoading: false,
          lastLoadTime: new Date(),
          loadStatus: syncManager.getStatus()
        });
        
        await get().applyFiltersAndSort();
        
        console.log(`🔄 Refresh completed: ${processedProducts.length} products`);
      } else {
        set({ 
          allProducts: [],
          filteredProducts: [],
          totalProducts: 0,
          isLoading: false,
          loadStatus: syncManager.getStatus()
        });
      }
      
      perfMonitor.end('ultraFastRefresh');
    } catch (error) {
      console.error('❌ PouchDB refresh failed:', error);
      set({ isLoading: false, loadStatus: syncManager.getStatus() });
      perfMonitor.end('ultraFastRefresh');
    }
  },

  // === ULTRA-FAST FILTERING & SEARCH ===
  applyFiltersAndSort: async () => {
    perfMonitor.start('ultraFilterSort');
    
    const { allProducts, filters, sortConfig } = get();
    
    try {
      let filtered = await workerManager.executeTask('ULTRA_FILTER_PRODUCTS', {
        products: allProducts,
        filters
      }, true); // Enable caching for filters

      if (sortConfig.key) {
        filtered = await workerManager.executeTask('ULTRA_SORT_PRODUCTS', {
          products: filtered,
          sortConfig
        });
      }

      set({ filteredProducts: filtered });
      perfMonitor.end('ultraFilterSort');
    } catch (error) {
      console.error('Ultra filter/sort error:', error);
      set({ filteredProducts: allProducts });
      perfMonitor.end('ultraFilterSort');
    }
  },

  // Ultra-fast debounced filter updates
  updateFilters: (newFilters) => {
    set(state => ({
      filters: { ...state.filters, ...newFilters }
    }));
    
    // Clear cache when filters change
    workerManager.clearCache();
    
    // Ultra-fast debounced timeout
    if (get().filterTimeout) {
      clearTimeout(get().filterTimeout);
    }
    
    const timeout = setTimeout(() => {
      get().applyFiltersAndSort();
    }, ULTRA_PERFORMANCE_CONFIG.DEBOUNCE_DELAY);
    
    set({ filterTimeout: timeout });
  },

  // === OPTIMIZED CRUD OPERATIONS (PouchDB Only) ===
  addProduct: async (productData) => {
    perfMonitor.start('ultraAddProduct');
    
    try {
      const { imageFile, ...data } = productData;

      const [processedProduct] = await workerManager.executeTask('PROCESS_PRODUCTS_STREAM', {
        products: [{
          ...data,
          _id: `product_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          imageAttachmentName: imageFile?.name,
          type: 'product',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }],
        batchSize: 1
      });

      // Save to PouchDB only
      await CacheManager.addProductToCache(processedProduct);
      
      const currentProducts = get().allProducts;
      const updatedProducts = [processedProduct, ...currentProducts];
      set({
        allProducts: updatedProducts,
        totalProducts: updatedProducts.length
      });

      // Apply filters in background
      requestIdleCallback(() => get().applyFiltersAndSort());
      
      perfMonitor.end('ultraAddProduct');
      return { success: true };

    } catch (error) {
      console.error('Error adding product:', error);
      perfMonitor.end('ultraAddProduct');
      return { success: false, error: error.message };
    }
  },

  // Update product in PouchDB only
  updateProduct: async (productId, updates) => {
    perfMonitor.start('ultraUpdateProduct');
    
    try {
      // Get current product
      const currentProducts = get().allProducts;
      const productIndex = currentProducts.findIndex(p => p._id === productId);
      
      if (productIndex === -1) {
        throw new Error('Product not found');
      }
      
      const updatedProduct = {
        ...currentProducts[productIndex],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      
      // Process through worker
      const [processedProduct] = await workerManager.executeTask('PROCESS_PRODUCTS_STREAM', {
        products: [updatedProduct],
        batchSize: 1
      });
      
      // Update PouchDB
      await CacheManager.updateProductInCache(processedProduct);
      
      // Update state
      const updatedProducts = [...currentProducts];
      updatedProducts[productIndex] = processedProduct;
      
      set({
        allProducts: updatedProducts,
        totalProducts: updatedProducts.length
      });
      
      // Apply filters in background
      requestIdleCallback(() => get().applyFiltersAndSort());
      
      perfMonitor.end('ultraUpdateProduct');
      return { success: true, product: processedProduct };
      
    } catch (error) {
      console.error('Error updating product:', error);
      perfMonitor.end('ultraUpdateProduct');
      return { success: false, error: error.message };
    }
  },

  // Delete product from PouchDB only
  deleteProduct: async (productId) => {
    perfMonitor.start('ultraDeleteProduct');
    
    try {
      // Remove from PouchDB
      await CacheManager.removeCachedProduct(productId);
      
      // Update state
      const currentProducts = get().allProducts;
      const updatedProducts = currentProducts.filter(p => p._id !== productId);
      
      set({
        allProducts: updatedProducts,
        totalProducts: updatedProducts.length
      });
      
      // Apply filters in background
      requestIdleCallback(() => get().applyFiltersAndSort());
      
      perfMonitor.end('ultraDeleteProduct');
      return { success: true };
      
    } catch (error) {
      console.error('Error deleting product:', error);
      perfMonitor.end('ultraDeleteProduct');
      return { success: false, error: error.message };
    }
  },

  // === PERFORMANCE & UTILITIES ===
  getPerformanceStats: () => {
    return {
      load: syncManager.getStatus(),
      performance: perfMonitor.getQuickStats(),
      worker: {
        queueLength: workerManager.taskQueue.length,
        cacheSize: workerManager.resultCache.size
      }
    };
  },

  forceCacheRefresh: async () => {
    return get().refreshFromPouchDB();
  },

  // Manual refresh from PouchDB
  manualRefresh: async () => {
    console.log('🚀 Manual PouchDB refresh initiated...');
    syncManager.hasInitialLoadCompleted = false;
    workerManager.clearCache(); // Clear worker cache for fresh data
    await get().refreshFromPouchDB();
  },

  // Enhanced cleanup
  cleanup: () => {
    console.log('🧹 Cleaning up ultra-optimized product store...');
    workerManager.terminate();
    if (get().filterTimeout) {
      clearTimeout(get().filterTimeout);
    }
    console.log('✅ Ultra cleanup completed');
  },

  // Legacy compatibility methods (optimized)
  initializeCache: async () => {
    console.log('🔄 Legacy initializeCache called - redirecting to ultra-optimized initializeStore');
    return get().initializeStore();
  },

  getProducts: () => get().allProducts,
  refreshProducts: async () => get().refreshFromPouchDB(),
  getSyncStatus: () => syncManager.getStatus(),

  // Optimized pagination
  getPaginatedProducts: (page = 1, limit = 50) => {
    const { filteredProducts } = get();
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    return {
      products: filteredProducts.slice(startIndex, endIndex),
      totalPages: Math.ceil(filteredProducts.length / limit),
      currentPage: page,
      totalProducts: filteredProducts.length,
      hasMore: endIndex < filteredProducts.length
    };
  },

  // Search products
  searchProducts: async (query) => {
    perfMonitor.start('searchProducts');
    
    try {
      if (!query || query.trim() === '') {
        set({ filteredProducts: get().allProducts });
        perfMonitor.end('searchProducts');
        return;
      }
      
      const { allProducts } = get();
      const filtered = await workerManager.executeTask('ULTRA_FILTER_PRODUCTS', {
        products: allProducts,
        filters: { search: query, category: 'all', stock: 'all' }
      }, true);
      
      set({ filteredProducts: filtered });
      perfMonitor.end('searchProducts');
    } catch (error) {
      console.error('Search error:', error);
      perfMonitor.end('searchProducts');
    }
  }
}));
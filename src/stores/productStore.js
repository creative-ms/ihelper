// productStore.js - Optimized version with Web Workers and performance improvements
import { create } from 'zustand';
import axios from 'axios';
import { useInventoryStore } from './inventoryStore';
import { useAuditStore } from './auditStore';
import CacheManager from '../utils/cache/index';

// --- Performance Configuration ---
const PERFORMANCE_CONFIG = {
  DEBOUNCE_DELAY: 200,
  VIRTUAL_LIST_BUFFER: 10,
  BATCH_SIZE: 100,
  CONCURRENT_REQUESTS: 3,
  IDLE_TIMEOUT: 16, // Target 60fps
};

// --- CouchDB Configuration ---
const DB_URL = 'http://localhost:5984/products';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

// Web Worker for heavy computations
class ProductWorkerManager {
  constructor() {
    this.worker = null;
    this.taskQueue = [];
    this.isProcessing = false;
    this.initWorker();
  }

  initWorker() {
    // Create inline worker to avoid external file dependency
    const workerCode = `
      // Product processing worker
      class ProductProcessor {
        static calculateTotalQuantity(product) {
          if (!product || !Array.isArray(product.batches)) {
            return 0;
          }
          return product.batches.reduce(
            (total, batch) => total + (Number(batch.quantity) || 0),
            0
          );
        }

        static processProducts(products) {
          return products.map(product => ({
            ...product,
            totalQuantity: this.calculateTotalQuantity(product),
            searchableName: (product.name || '').toLowerCase(),
            finalPrice: this.calculateFinalPrice(product)
          }));
        }

        static calculateFinalPrice(product) {
          const retail = parseFloat(product.retailPrice) || 0;
          const discount = parseFloat(product.discountRate) || 0;
          const tax = (product.taxRate === 'default' || isNaN(parseFloat(product.taxRate))) 
            ? 0 
            : parseFloat(product.taxRate);
          
          const priceAfterDiscount = retail - (retail * (discount / 100));
          return priceAfterDiscount + (priceAfterDiscount * (tax / 100));
        }

        static batchProcess(products, batchSize = 100) {
          const batches = [];
          for (let i = 0; i < products.length; i += batchSize) {
            batches.push(products.slice(i, i + batchSize));
          }
          return batches;
        }

        static filterProducts(products, filters) {
          return products.filter(product => {
            const categoryMatch = filters.category === 'all' || product.category === filters.category;
            const stockMatch = filters.stock === 'all' || 
              (filters.stock === 'in' && product.totalQuantity > 10) ||
              (filters.stock === 'low' && product.totalQuantity <= 10 && product.totalQuantity > 0) ||
              (filters.stock === 'out' && product.totalQuantity === 0);
            
            const searchMatch = !filters.search || 
              product.searchableName.includes(filters.search.toLowerCase()) ||
              (product.sku || '').toLowerCase().includes(filters.search.toLowerCase()) ||
              (product.barcode || '').includes(filters.search);
            
            return categoryMatch && stockMatch && searchMatch;
          });
        }

        static sortProducts(products, sortConfig) {
          if (!sortConfig.key) return products;
          
          return [...products].sort((a, b) => {
            let aVal = a[sortConfig.key];
            let bVal = b[sortConfig.key];
            
            // Handle numeric values
            if (sortConfig.key === 'retailPrice' || sortConfig.key === 'totalQuantity') {
              aVal = parseFloat(aVal) || 0;
              bVal = parseFloat(bVal) || 0;
            }
            
            // Handle string values
            if (typeof aVal === 'string') {
              aVal = aVal.toLowerCase();
              bVal = (bVal || '').toLowerCase();
            }
            
            let result = 0;
            if (aVal < bVal) result = -1;
            if (aVal > bVal) result = 1;
            
            return sortConfig.direction === 'desc' ? -result : result;
          });
        }
      }

      self.onmessage = function(e) {
        const { type, data, id } = e.data;
        let result;

        try {
          switch (type) {
            case 'PROCESS_PRODUCTS':
              result = ProductProcessor.processProducts(data.products);
              break;
            case 'FILTER_PRODUCTS':
              result = ProductProcessor.filterProducts(data.products, data.filters);
              break;
            case 'SORT_PRODUCTS':
              result = ProductProcessor.sortProducts(data.products, data.sortConfig);
              break;
            case 'BATCH_PROCESS':
              const batches = ProductProcessor.batchProcess(data.products, data.batchSize);
              result = batches.map(batch => ProductProcessor.processProducts(batch));
              break;
            default:
              throw new Error('Unknown task type: ' + type);
          }

          self.postMessage({ success: true, result, id });
        } catch (error) {
          self.postMessage({ success: false, error: error.message, id });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    
    this.worker.onmessage = (e) => {
      const { success, result, error, id } = e.data;
      const task = this.taskQueue.find(t => t.id === id);
      
      if (task) {
        this.taskQueue = this.taskQueue.filter(t => t.id !== id);
        if (success) {
          task.resolve(result);
        } else {
          task.reject(new Error(error));
        }
      }
      
      this.processNextTask();
    };

    this.worker.onerror = (error) => {
      console.error('Worker error:', error);
      this.processNextTask();
    };
  }

  async executeTask(type, data) {
    return new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();
      const task = { id, type, data, resolve, reject };
      
      this.taskQueue.push(task);
      
      if (!this.isProcessing) {
        this.processNextTask();
      }
    });
  }

  processNextTask() {
    if (this.taskQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const task = this.taskQueue[0];
    
    this.worker.postMessage({
      type: task.type,
      data: task.data,
      id: task.id
    });
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Performance monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }

  start(operation) {
    this.metrics.set(operation, performance.now());
  }

  end(operation) {
    const startTime = this.metrics.get(operation);
    if (startTime) {
      const duration = performance.now() - startTime;
      console.log(`⚡ ${operation}: ${duration.toFixed(2)}ms`);
      this.metrics.delete(operation);
      return duration;
    }
  }
}

// Optimized debounce with requestIdleCallback
const createOptimizedDebounce = (func, delay) => {
  let timeoutId;
  let lastExecution = 0;
  
  return function executedFunction(...args) {
    const later = () => {
      const now = Date.now();
      const timeSinceLastExecution = now - lastExecution;
      
      if (timeSinceLastExecution >= delay) {
        lastExecution = now;
        
        // Use requestIdleCallback for non-critical operations
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => func.apply(this, args), {
            timeout: PERFORMANCE_CONFIG.IDLE_TIMEOUT
          });
        } else {
          // Fallback for browsers without requestIdleCallback
          setTimeout(() => func.apply(this, args), 0);
        }
      }
    };

    clearTimeout(timeoutId);
    timeoutId = setTimeout(later, delay);
  };
};

// Optimized Meilisearch functions
const searchMeiliProducts = async (searchTerm, options = {}) => {
  if (!window.electronAPI?.search) return [];
  
  try {
    const results = await window.electronAPI.search({
      indexName: 'products',
      searchTerm,
      options: {
        limit: 50,
        attributesToSearchOn: ['name', 'sku', 'searchableName', 'category', 'brand'],
        ...options
      }
    });
    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error('Meilisearch search failed:', error);
    return [];
  }
};

// Optimized sync with batching
const syncToMeiliProducts = async (documents, batchSize = PERFORMANCE_CONFIG.BATCH_SIZE) => {
  if (!window.electronAPI?.sync || !documents.length) {
    return { success: false, error: 'No documents or API unavailable' };
  }

  try {
    const batches = [];
    for (let i = 0; i < documents.length; i += batchSize) {
      batches.push(documents.slice(i, i + batchSize));
    }

    // Process batches sequentially to avoid overwhelming Meilisearch
    const results = [];
    for (const batch of batches) {
      try {
        const result = await window.electronAPI.sync({
          indexName: 'products',
          documents: batch.map(product => ({
            _id: product._id,
            name: product.name || '',
            sku: product.sku || '',
            saleUnits: product.saleUnits || [],
            category: product.category || '',
            brand: product.brand || '',
            searchableName: (product.name || '').toLowerCase(),
            retailPrice: product.retailPrice || 0,
            totalQuantity: product.totalQuantity || 0,
            barcode: product.barcode || ''
          }))
        });
        
        results.push({ status: 'fulfilled', value: result });
        
        // Small delay between batches to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.warn('Batch sync failed:', error);
        results.push({ status: 'rejected', reason: error });
      }
    }

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`${failed.length} batches failed to sync`);
    }

    return { 
      success: failed.length < results.length, 
      synced: results.length - failed.length,
      total: results.length 
    };
  } catch (error) {
    console.error('Batch sync failed:', error);
    return { success: false, error: error.message };
  }
};


// Optional: Add a separate initialization function in productStore.js
// This should be called once when the app starts, not on every sync
const initializeMeilisearchIndex = async () => {
  try {
    if (!window.electronAPI?.initIndex) {
      console.warn('Meilisearch initialization not available');
      return { success: false };
    }

    const result = await window.electronAPI.initIndex({
      indexName: 'products',
      primaryKey: '_id'
    });

    return result;
  } catch (error) {
    console.error('Index initialization failed:', error);
    return { success: false, error: error.message };
  }
};

// Updated syncAllProductsToMeili function
const syncAllProductsToMeili = async () => {
  perfMonitor.start('syncAllProductsToMeili');
  
  try {
    const { allProducts } = get();
    
    // If no products in memory, fetch from database first
    if (allProducts.length === 0) {
      await get().syncCacheWithDatabase();
    }
    
    const productsToSync = get().allProducts;
    
    if (productsToSync.length === 0) {
      throw new Error('No products found to sync');
    }

    console.log(`Starting sync of ${productsToSync.length} products to Meilisearch...`);
    
    // Initialize index if needed (only once)
    await initializeMeilisearchIndex();
    
    // Sync all products in smaller batches to avoid overwhelming Meilisearch
    const result = await syncToMeiliProducts(productsToSync, 50); // Reduced batch size
    
    if (!result.success) {
      throw new Error(result.error || 'Sync failed');
    }
    
    console.log(`Successfully synced ${result.synced}/${result.total} batches to Meilisearch`);
    
    // Update last sync time
    set({ lastSyncTime: new Date() });
    
    perfMonitor.end('syncAllProductsToMeili');
    
    return {
      success: true,
      message: `Successfully synced ${productsToSync.length} products to search engine`,
      syncedProducts: productsToSync.length,
      syncedBatches: result.synced,
      totalBatches: result.total
    };
    
  } catch (error) {
    console.error('Error syncing all products to Meili:', error);
    perfMonitor.end('syncAllProductsToMeili');
    
    return {
      success: false,
      error: error.message || 'Unknown error occurred during sync'
    };
  }
};

// Initialize worker and performance monitor
const workerManager = new ProductWorkerManager();
const perfMonitor = new PerformanceMonitor();

// Optimized debounced search
const debouncedSearch = createOptimizedDebounce(async (searchTerm, callback, options = {}) => {
  try {
    perfMonitor.start('search');
    
    if (!searchTerm || searchTerm.length < 2) {
      callback([]);
      return;
    }

    const results = await searchMeiliProducts(searchTerm, {
      limit: 20,
      attributesToSearchOn: ['name', 'sku', 'barcode'],
      ...options
    });
    
    callback(results);
    perfMonitor.end('search');
  } catch (error) {
    console.error('Search error:', error);
    callback([]);
  }
}, PERFORMANCE_CONFIG.DEBOUNCE_DELAY);

export const useProductStore = create((set, get) => ({
  // State
  allProducts: [],
  filteredProducts: [],
  posProducts: [],
  totalProducts: 0,
  productsPerPage: 50,
  isLoading: false,
  isCacheReady: false,
  lastSyncTime: null,
  
  // Filters and sorting
  filters: {
    category: 'all',
    stock: 'all',
    search: ''
  },
  sortConfig: {
    key: null,
    direction: 'asc'
  },

  // =================================================================
  //  PERFORMANCE-OPTIMIZED INITIALIZATION
  // =================================================================

  initializeCache: async () => {
    perfMonitor.start('initializeCache');
    
    try {
      // Initialize in parallel
      const [initResult] = await Promise.allSettled([
        window.electronAPI?.initIndex?.({
          indexName: 'products',
          primaryKey: '_id'
        })
      ]);

      const isEmpty = await CacheManager.isCacheEmpty();
      const isStale = await CacheManager.isCacheStale(1);
      
      if (isEmpty || isStale) {
        await get().syncCacheWithDatabase();
      } else {
        const cachedProducts = await CacheManager.getAllCachedProducts();
        
        // Process products in worker
        const processedProducts = await workerManager.executeTask('PROCESS_PRODUCTS', {
          products: cachedProducts
        });
        
        set({ 
          allProducts: processedProducts,
          filteredProducts: processedProducts,
          totalProducts: processedProducts.length,
          isCacheReady: true,
          lastSyncTime: await CacheManager.getLastSyncTime()
        });
      }
      
      perfMonitor.end('initializeCache');
    } catch (error) {
      console.error('Error initializing cache:', error);
      await get().fetchProducts();
    }
  },

  syncCacheWithDatabase: async () => {
    perfMonitor.start('syncCache');
    
    try {
      const response = await axios.get(
        `${DB_URL}/_all_docs?include_docs=true`,
        DB_AUTH
      );
      
      const rawProducts = response.data.rows
        .map((row) => row.doc)
        .filter(doc => doc && doc.type === 'product' && !doc._deleted);

      // Process products in batches using worker
      const processedProducts = await workerManager.executeTask('BATCH_PROCESS', {
        products: rawProducts,
        batchSize: PERFORMANCE_CONFIG.BATCH_SIZE
      });

      const flattenedProducts = processedProducts.flat();

      // Cache and sync in parallel
      await Promise.all([
        CacheManager.cacheProducts(flattenedProducts),
        syncToMeiliProducts(flattenedProducts)
      ]);
      
      set({ 
        allProducts: flattenedProducts,
        filteredProducts: flattenedProducts,
        totalProducts: flattenedProducts.length,
        isCacheReady: true,
        lastSyncTime: new Date()
      });

      perfMonitor.end('syncCache');
    } catch (error) {
      console.error('Error syncing cache:', error);
      throw error;
    }
  },

  // =================================================================
  //  OPTIMIZED FILTERING AND SORTING
  // =================================================================

  applyFiltersAndSort: async () => {
    perfMonitor.start('filterAndSort');
    
    const { allProducts, filters, sortConfig } = get();
    
    try {
      // Use worker for heavy filtering and sorting
      let filtered = await workerManager.executeTask('FILTER_PRODUCTS', {
        products: allProducts,
        filters
      });

      if (sortConfig.key) {
        filtered = await workerManager.executeTask('SORT_PRODUCTS', {
          products: filtered,
          sortConfig
        });
      }

      set({ filteredProducts: filtered });
      perfMonitor.end('filterAndSort');
    } catch (error) {
      console.error('Filter/sort error:', error);
      set({ filteredProducts: allProducts });
    }
  },

  updateFilters: (newFilters) => {
    set(state => ({
      filters: { ...state.filters, ...newFilters }
    }));
    // Debounce filter application
    createOptimizedDebounce(() => get().applyFiltersAndSort(), 100)();
  },

  updateSort: (key) => {
    set(state => {
      const direction = state.sortConfig.key === key && state.sortConfig.direction === 'asc' 
        ? 'desc' 
        : 'asc';
      return { sortConfig: { key, direction } };
    });
    get().applyFiltersAndSort();
  },

  // =================================================================
  //  OPTIMIZED SEARCH
  // =================================================================

  fetchPosProducts: async ({ searchTerm = '', page = 1 }) => {
    set({ isLoading: true });
    perfMonitor.start('fetchPosProducts');
    
    try {
      if (searchTerm) {
        // Try cache first
        const cachedResults = await CacheManager.getSearchResults(searchTerm);
        if (cachedResults?.length > 0) {
          const startIndex = (page - 1) * 50;
          const endIndex = startIndex + 50;
          const paginatedResults = cachedResults.slice(startIndex, endIndex);
          
          set({ posProducts: paginatedResults, isLoading: false });
          perfMonitor.end('fetchPosProducts');
          return;
        }

        // Search with Meilisearch
        const searchResults = await searchMeiliProducts(searchTerm, {
          limit: 50,
          page,
          attributesToSearchOn: ['name', 'sku', 'searchableName', 'category', 'brand']
        });
        
        set({ posProducts: searchResults, isLoading: false });
        
        // Cache results asynchronously
        CacheManager.cacheSearchResults(searchTerm, searchResults).catch(console.error);
      } else {
        // Use filtered products for pagination
        const { filteredProducts } = get();
        const startIndex = (page - 1) * 50;
        const endIndex = startIndex + 50;
        const paginatedResults = filteredProducts.slice(startIndex, endIndex);
        
        set({ posProducts: paginatedResults, isLoading: false });
      }
      
      perfMonitor.end('fetchPosProducts');
    } catch (error) {
      console.error('Error fetching POS products:', error);
      set({ posProducts: [], isLoading: false });
    }
  },

  // =================================================================
  //  OPTIMIZED CRUD OPERATIONS
  // =================================================================

  addProduct: async (productData) => {
    perfMonitor.start('addProduct');
    
    try {
      const { imageFile, ...data } = productData;

      // Process product data in worker
      const [processedProduct] = await workerManager.executeTask('PROCESS_PRODUCTS', {
        products: [{
          ...data,
          imageAttachmentName: imageFile?.name,
          type: 'product',
        }]
      });

      // Save to database
      const response = await axios.post(DB_URL, processedProduct, DB_AUTH);
      const savedProduct = { ...processedProduct, _id: response.data.id };

      // Update cache and sync in parallel
      await Promise.all([
        CacheManager.updateProductInCache(savedProduct),
        syncToMeiliProducts([savedProduct])
      ]);

      // Update state
      const currentProducts = get().allProducts;
      set({
        allProducts: [savedProduct, ...currentProducts],
        totalProducts: currentProducts.length + 1
      });

      // Reapply filters
      await get().applyFiltersAndSort();

      // Log audit event asynchronously
      if (productData.batches?.length > 0) {
        const firstBatch = productData.batches[0];
        setTimeout(() => {
          useAuditStore.getState().logEvent({
            eventType: 'CREATE',
            productId: savedProduct._id,
            productName: productData.name,
            details: {
              message: 'Product created with initial stock.',
              batchNumber: firstBatch.batchNumber || 'N/A',
              quantity: firstBatch.quantity,
              purchasePrice: firstBatch.purchasePrice,
              retailPrice: firstBatch.retailPrice,
              expDate: firstBatch.expDate || 'N/A'
            }
          });
        }, 0);
      }

      perfMonitor.end('addProduct');
      return { success: true };

    } catch (error) {
      console.error('Error adding product:', error);
      perfMonitor.end('addProduct');
      return { success: false, error: error.message };
    }
  },

  updateProduct: async (productToUpdate) => {
    perfMonitor.start('updateProduct');
    
    try {
      const { imageFile, ...data } = productToUpdate;
      const { _attachments, imageUrl, ...docToSave } = data;
      
      if (imageFile) {
        docToSave.imageAttachmentName = imageFile.name;
      }
      
      // Process in worker
      const [processedProduct] = await workerManager.executeTask('PROCESS_PRODUCTS', {
        products: [{ ...docToSave, type: 'product' }]
      });

      // Update database
      await axios.put(`${DB_URL}/${processedProduct._id}`, processedProduct, DB_AUTH);

      // Update cache and sync in parallel
      await Promise.all([
        CacheManager.updateProductInCache(processedProduct),
        syncToMeiliProducts([processedProduct])
      ]);

      // Update state
      const currentProducts = get().allProducts;
      const updatedProducts = currentProducts.map(p => 
        p._id === processedProduct._id ? processedProduct : p
      );
      set({ allProducts: updatedProducts });

      // Reapply filters
      await get().applyFiltersAndSort();

      // Background sync after delay
      setTimeout(() => get().backgroundSync(), 1000);

      perfMonitor.end('updateProduct');
    } catch (error) {
      console.error('Error updating product:', error);
      perfMonitor.end('updateProduct');
    }
  },

  // Background sync - runs with low priority
  backgroundSync: async () => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(async () => {
        try {
          const response = await axios.get(
            `${DB_URL}/_all_docs?include_docs=true`,
            DB_AUTH
          );
          
          const rawProducts = response.data.rows
            .map((row) => row.doc)
            .filter(doc => doc && doc.type === 'product' && !doc._deleted);

          const processedProducts = await workerManager.executeTask('PROCESS_PRODUCTS', {
            products: rawProducts
          });

          await CacheManager.cacheProducts(processedProducts);
          
          set({ 
            allProducts: processedProducts,
            totalProducts: processedProducts.length,
            lastSyncTime: new Date()
          });

          await get().applyFiltersAndSort();
        } catch (error) {
          console.error('Background sync failed:', error);
        }
      }, { timeout: 5000 });
    }
  },

  // Cleanup function
  cleanup: () => {
    workerManager.terminate();
  },

  // Replace your syncAllProductsToMeili function with this fixed version

syncAllProductsToMeili: async () => {
  perfMonitor.start('syncAllProductsToMeili');
  
  try {
    const { allProducts } = get();
    
    // If no products in memory, fetch from database first
    if (allProducts.length === 0) {
      await get().syncCacheWithDatabase();
    }
    
    const productsToSync = get().allProducts;
    
    if (productsToSync.length === 0) {
      throw new Error('No products found to sync');
    }

    console.log(`Starting sync of ${productsToSync.length} products to Meilisearch...`);
    
    // Optional: Clear index first (comment out if handler not available)
    // if (window.electronAPI?.clearIndex) {
    //   const clearResult = await window.electronAPI.clearIndex({ indexName: 'products' });
    //   if (!clearResult.success) {
    //     console.warn('Failed to clear index:', clearResult.error);
    //   }
    // }
    
    // Sync all products in batches
    const result = await syncToMeiliProducts(productsToSync, PERFORMANCE_CONFIG.BATCH_SIZE);
    
    if (!result.success) {
      throw new Error(result.error || 'Sync failed');
    }
    
    console.log(`Successfully synced ${result.synced}/${result.total} batches to Meilisearch`);
    
    // Update last sync time
    set({ lastSyncTime: new Date() });
    
    perfMonitor.end('syncAllProductsToMeili');
    
    return {
      success: true,
      message: `Successfully synced ${productsToSync.length} products to search engine`,
      syncedProducts: productsToSync.length,
      syncedBatches: result.synced,
      totalBatches: result.total
    };
    
  } catch (error) {
    console.error('Error syncing all products to Meili:', error);
    perfMonitor.end('syncAllProductsToMeili');
    
    return {
      success: false,
      error: error.message || 'Unknown error occurred during sync'
    };
  }
},

  // Also add a function to check Meilisearch connection
  checkMeiliConnection: async () => {
    try {
      if (!window.electronAPI?.search) {
        return { connected: false, error: 'Electron API not available' };
      }
      
      // Try a simple search to test connection
      const testResult = await window.electronAPI.search({
        indexName: 'products',
        searchTerm: '',
        options: { limit: 1 }
      });
      
      return { connected: true, indexExists: true };
    } catch (error) {
      return { connected: false, error: error.message };
    }
  },
  
  deleteProduct: async (productToDelete) => {
    try {
      if (!productToDelete._id) return;

      await axios.delete(
        `${DB_URL}/${productToDelete._id}?rev=${productToDelete._rev}`,
        DB_AUTH
      );

      // Parallel operations
      await Promise.all([
        CacheManager.updateProductInCache({ ...productToDelete, _deleted: true }),
        window.electronAPI?.delete?.({
          indexName: 'products',
          documentId: productToDelete._id
        })
      ]);

      const currentProducts = get().allProducts;
      const updatedProducts = currentProducts.filter(p => p._id !== productToDelete._id);
      set({ 
        allProducts: updatedProducts,
        totalProducts: updatedProducts.length
      });

      await get().applyFiltersAndSort();
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  },

  findProductByBarcode: async (barcode) => {
    try {
      const cachedProducts = await CacheManager.getAllCachedProducts();
      const cachedResult = cachedProducts.find(p => p.barcode === barcode);
      
      if (cachedResult) return cachedResult;

      const query = {
        selector: { barcode: { $eq: barcode } },
        limit: 1,
        use_index: 'barcode-lookup-index',
      };
      const response = await axios.post(`${DB_URL}/_find`, query, DB_AUTH);
      const result = response.data.docs.length > 0 ? response.data.docs[0] : null;
      
      if (result) {
        await CacheManager.updateProductInCache(result);
      }
      
      return result;
    } catch (error) {
      console.error('Error finding product by barcode:', error);
      return null;
    }
  }
}));
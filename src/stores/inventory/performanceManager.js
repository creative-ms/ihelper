// src/stores/inventory/performanceManager.js - Web Worker and Performance utilities
import CacheManager from '../../utils/cache/index';

// --- Performance Configuration ---
export const PERFORMANCE_CONFIG = {
  DEBOUNCE_DELAY: 200,
  BATCH_SIZE: 100,
  CONCURRENT_REQUESTS: 3,
  IDLE_TIMEOUT: 16,
  CACHE_STALE_HOURS: 2,
  SYNC_RETRY_ATTEMPTS: 3,
  SYNC_RETRY_DELAY: 1000,
};

// Web Worker for heavy inventory computations
export class InventoryWorkerManager {
  constructor() {
    this.worker = null;
    this.taskQueue = [];
    this.isProcessing = false;
    this.initWorker();
  }

  initWorker() {
    const workerCode = `
      // Inventory processing worker
      class InventoryProcessor {
        static calculateTotalQuantity(product) {
          if (!product || !Array.isArray(product.batches)) {
            return 0;
          }
          return product.batches.reduce(
            (total, batch) => total + (Number(batch.quantity) || 0),
            0
          );
        }

        static calculateInventoryStats(products) {
          const now = new Date();
          const expiringSoonDate = new Date();
          expiringSoonDate.setDate(now.getDate() + 30);

          let outOfStockCount = 0;
          let lowStockCount = 0;
          let expiredProductsCount = 0;
          let expiringSoonProductsCount = 0;
          let totalValue = 0;
          let totalProducts = products.length;

          products.forEach(p => {
            const totalQuantity = p.totalQuantity || this.calculateTotalQuantity(p);
            
            if (totalQuantity <= 0) {
              outOfStockCount++;
            } else if (totalQuantity > 0 && totalQuantity <= (p.lowStockThreshold || 0)) {
              lowStockCount++;
            }

            if (p.batches && p.batches.length > 0) {
              const hasExpiredBatch = p.batches.some(b =>
                b.expDate && new Date(b.expDate) < now
              );
              if (hasExpiredBatch) {
                expiredProductsCount++;
              }

              const hasExpiringSoonBatch = p.batches.some(b => {
                if (!b.expDate) return false;
                const expiryDate = new Date(b.expDate);
                return expiryDate > now && expiryDate <= expiringSoonDate;
              });
              if (hasExpiringSoonBatch) {
                expiringSoonProductsCount++;
              }

              p.batches.forEach(batch => {
                const batchValue = (Number(batch.quantity) || 0) * (Number(batch.purchasePrice) || 0);
                totalValue += batchValue;
              });
            }
          });

          return {
            totalProducts,
            outOfStock: outOfStockCount,
            lowStock: lowStockCount,
            expired: expiredProductsCount,
            expiringSoon: expiringSoonProductsCount,
            totalValue: Math.round(totalValue * 100) / 100,
            inStock: totalProducts - outOfStockCount,
            healthyStock: totalProducts - outOfStockCount - lowStockCount
          };
        }

        static processInventoryBatch(products) {
          return products.map(product => ({
            ...product,
            totalQuantity: this.calculateTotalQuantity(product),
            stockStatus: this.getStockStatus(product),
            expiryStatus: this.getExpiryStatus(product)
          }));
        }

        static getStockStatus(product) {
          const totalQuantity = this.calculateTotalQuantity(product);
          if (totalQuantity <= 0) return 'out-of-stock';
          if (totalQuantity <= (product.lowStockThreshold || 0)) return 'low-stock';
          return 'in-stock';
        }

        static getExpiryStatus(product) {
          if (!product.batches || product.batches.length === 0) return 'no-expiry';
          
          const now = new Date();
          const expiringSoonDate = new Date();
          expiringSoonDate.setDate(now.getDate() + 30);

          const hasExpired = product.batches.some(b =>
            b.expDate && new Date(b.expDate) < now
          );
          if (hasExpired) return 'expired';

          const expiringSoon = product.batches.some(b => {
            if (!b.expDate) return false;
            const expiryDate = new Date(b.expDate);
            return expiryDate > now && expiryDate <= expiringSoonDate;
          });
          if (expiringSoon) return 'expiring-soon';

          return 'fresh';
        }

        static filterProducts(products, criteria) {
          return products.filter(product => {
            const { stockStatus, expiryStatus, category, search } = criteria;
            
            let matches = true;
            
            if (stockStatus && stockStatus !== 'all') {
              matches = matches && product.stockStatus === stockStatus;
            }
            
            if (expiryStatus && expiryStatus !== 'all') {
              matches = matches && product.expiryStatus === expiryStatus;
            }
            
            if (category && category !== 'all') {
              matches = matches && product.category === category;
            }
            
            if (search) {
              const searchLower = search.toLowerCase();
              matches = matches && (
                (product.name || '').toLowerCase().includes(searchLower) ||
                (product.sku || '').toLowerCase().includes(searchLower) ||
                (product.barcode || '').includes(search)
              );
            }
            
            return matches;
          });
        }

        static getLowStockProducts(products, threshold = null) {
          return products.filter(product => {
            const totalQuantity = product.totalQuantity || this.calculateTotalQuantity(product);
            const stockThreshold = threshold || product.lowStockThreshold || 10;
            return totalQuantity > 0 && totalQuantity <= stockThreshold;
          });
        }

        static getExpiringBatches(products, days = 30) {
          const expiringBatches = [];
          const now = new Date();
          const expiringSoonDate = new Date();
          expiringSoonDate.setDate(now.getDate() + days);

          products.forEach(product => {
            if (product.batches && Array.isArray(product.batches)) {
              product.batches.forEach(batch => {
                if (batch.expDate) {
                  const expiryDate = new Date(batch.expDate);
                  if (expiryDate > now && expiryDate <= expiringSoonDate) {
                    expiringBatches.push({
                      productName: product.name,
                      productId: product._id,
                      productSku: product.sku,
                      daysUntilExpiry: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
                      ...batch
                    });
                  }
                }
              });
            }
          });

          return expiringBatches.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
        }
      }

      self.onmessage = function(e) {
        const { type, data, id } = e.data;
        let result;

        try {
          switch (type) {
            case 'CALCULATE_STATS':
              result = InventoryProcessor.calculateInventoryStats(data.products);
              break;
            case 'PROCESS_BATCH':
              result = InventoryProcessor.processInventoryBatch(data.products);
              break;
            case 'FILTER_PRODUCTS':
              result = InventoryProcessor.filterProducts(data.products, data.criteria);
              break;
            case 'GET_LOW_STOCK':
              result = InventoryProcessor.getLowStockProducts(data.products, data.threshold);
              break;
            case 'GET_EXPIRING_BATCHES':
              result = InventoryProcessor.getExpiringBatches(data.products, data.days);
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
      console.error('Inventory Worker error:', error);
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
export class PerformanceMonitor {
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
      console.log(`⚡ Inventory ${operation}: ${duration.toFixed(2)}ms`);
      this.metrics.delete(operation);
      return duration;
    }
  }
}

// Optimized debounce with requestIdleCallback
export const createOptimizedDebounce = (func, delay) => {
  let timeoutId;
  let lastExecution = 0;
  
  return function executedFunction(...args) {
    const later = () => {
      const now = Date.now();
      const timeSinceLastExecution = now - lastExecution;
      
      if (timeSinceLastExecution >= delay) {
        lastExecution = now;
        
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => func.apply(this, args), {
            timeout: PERFORMANCE_CONFIG.IDLE_TIMEOUT
          });
        } else {
          setTimeout(() => func.apply(this, args), 0);
        }
      }
    };

    clearTimeout(timeoutId);
    timeoutId = setTimeout(later, delay);
  };
};

// Retry mechanism for network operations
export const withRetry = async (operation, maxRetries = PERFORMANCE_CONFIG.SYNC_RETRY_ATTEMPTS) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      console.warn(`Retry attempt ${attempt}/${maxRetries} failed:`, error.message);
      await new Promise(resolve => 
        setTimeout(resolve, PERFORMANCE_CONFIG.SYNC_RETRY_DELAY * attempt)
      );
    }
  }
};

// Optimized batch processing
export const processBatches = async (products, processor, batchSize = PERFORMANCE_CONFIG.BATCH_SIZE) => {
  const results = [];
  
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const processed = await processor(batch);
    results.push(...processed);
    
    // Yield control to prevent blocking
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return results;
};
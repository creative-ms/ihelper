// src/stores/inventory/productOperations.js - Cache-Optimized Product CRUD Operations
import axios from 'axios';
import CacheManager from '../../utils/cache/index';
import { InventoryWorkerManager, PerformanceMonitor, withRetry, processBatches, PERFORMANCE_CONFIG } from './performanceManager';
import { validateProduct, validateBatch, generateProductId, generateBatchId } from '../validationService';

// --- Database Configuration ---
const DB_URL = 'http://localhost:5984/products';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

// --- Initialize Performance Tools ---
const workerManager = new InventoryWorkerManager();
const perfMonitor = new PerformanceMonitor();

// =================================================================
//  🚀 CACHE-INTEGRATED PRODUCT OPERATIONS CLASS
// =================================================================

export class ProductOperations {
  constructor(getInventoryState) {
    this.getState = getInventoryState;
    this.pendingOperations = new Map();
    this.operationQueue = [];
    this.isProcessingQueue = false;
  }

  // =================================================================
  //  PRODUCT CREATION OPERATIONS
  // =================================================================

  async createProduct(productData) {
    const operationId = `create_${Date.now()}`;
    perfMonitor.start(`createProduct_${operationId}`);
    
    try {
      console.log('🆕 Creating new product:', productData.name);
      
      // Validate product data
      const validation = validateProduct(productData);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Generate unique ID and prepare product
      const newProduct = {
        ...productData,
        _id: productData._id || generateProductId(),
        type: 'product',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        batches: productData.batches || [],
        totalQuantity: 0,
        stockStatus: 'out-of-stock',
        expiryStatus: 'no-expiry'
      };

      // Process batches if provided
      if (newProduct.batches.length > 0) {
        newProduct.batches = newProduct.batches.map(batch => ({
          ...batch,
          id: batch.id || generateBatchId(),
          createdAt: new Date().toISOString(),
          quantity: Number(batch.quantity) || 0
        }));
      }

      // Process product through worker for calculations
      const [processedProduct] = await workerManager.executeTask('PROCESS_BATCH', { 
        products: [newProduct] 
      });

      // Update cache immediately
      await CacheManager.cacheProduct(processedProduct);
      
      // Cache batches if any
      if (processedProduct.batches?.length > 0) {
        await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);
      }

      // Update inventory state
      const state = this.getState();
      await state.addProductToInventory(processedProduct);

      // Background database sync
      this.queueOperation({
        type: 'CREATE',
        productId: processedProduct._id,
        product: processedProduct,
        operationId
      });

      console.log(`✅ Product created: ${processedProduct.name} (${processedProduct._id})`);
      perfMonitor.end(`createProduct_${operationId}`);
      
      return { success: true, product: processedProduct };

    } catch (error) {
      console.error('❌ Error creating product:', error);
      perfMonitor.end(`createProduct_${operationId}`);
      return { success: false, error: error.message };
    }
  }

  async createProductBatch(productId, batchData) {
    const operationId = `create_batch_${Date.now()}`;
    perfMonitor.start(`createBatch_${operationId}`);
    
    try {
      console.log(`📦 Adding batch to product: ${productId}`);
      
      // Validate batch data
      const validation = validateBatch(batchData);
      if (!validation.isValid) {
        throw new Error(`Batch validation failed: ${validation.errors.join(', ')}`);
      }

      // Get current product from cache first, then state
      let currentProduct = await CacheManager.getCachedProduct(productId);
      if (!currentProduct) {
        currentProduct = this.getState().getProductById(productId);
      }
      
      if (!currentProduct) {
        throw new Error('Product not found');
      }

      // Prepare new batch
      const newBatch = {
        ...batchData,
        id: batchData.id || generateBatchId(),
        createdAt: new Date().toISOString(),
        quantity: Number(batchData.quantity) || 0,
        purchasePrice: Number(batchData.purchasePrice) || 0
      };

      // Update product with new batch
      const updatedProduct = {
        ...currentProduct,
        batches: [...(currentProduct.batches || []), newBatch],
        updatedAt: new Date().toISOString(),
        version: (currentProduct.version || 1) + 1
      };

      // Process through worker
      const [processedProduct] = await workerManager.executeTask('PROCESS_BATCH', { 
        products: [updatedProduct] 
      });

      // Update cache
      await CacheManager.cacheProduct(processedProduct);
      await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

      // Queue remote sync
      this.queueOperation({
        type: 'UPDATE',
        productId: processedProduct._id,
        product: processedProduct,
        operationId
      });

      console.log(`✅ Batch added to ${processedProduct.name}: ${newBatch.batchNumber}`);
      perfMonitor.end(`createBatch_${operationId}`);
      
      return { success: true, product: processedProduct, batch: newBatch };

    } catch (error) {
      console.error('❌ Error creating batch:', error);
      perfMonitor.end(`createBatch_${operationId}`);
      return { success: false, error: error.message };
    }
  }

  // =================================================================
  //  PRODUCT UPDATE OPERATIONS
  // =================================================================

  async updateProduct(productId, updates) {
    const operationId = `update_${Date.now()}`;
    perfMonitor.start(`updateProduct_${operationId}`);
    
    try {
      console.log(`🔄 Updating product: ${productId}`);
      
      // Prevent duplicate operations
      if (this.pendingOperations.has(`update_${productId}`)) {
        console.log('⚠️ Update already in progress for this product');
        return { success: false, error: 'Update already in progress' };
      }
      
      this.pendingOperations.set(`update_${productId}`, operationId);

      // Get current product from cache first
      let currentProduct = await CacheManager.getCachedProduct(productId);
      if (!currentProduct) {
        currentProduct = this.getState().getProductById(productId);
      }
      
      if (!currentProduct) {
        throw new Error('Product not found');
      }

      // Merge updates
      const updatedProduct = {
        ...currentProduct,
        ...updates,
        _id: productId, // Ensure ID doesn't change
        updatedAt: new Date().toISOString(),
        version: (currentProduct.version || 1) + 1
      };

      // Validate updated product
      const validation = validateProduct(updatedProduct);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Validate batches if updated
      if (updates.batches) {
        for (const batch of updates.batches) {
          const batchValidation = validateBatch(batch);
          if (!batchValidation.isValid) {
            throw new Error(`Batch validation failed: ${batchValidation.errors.join(', ')}`);
          }
        }
      }

      // Process through worker
      const [processedProduct] = await workerManager.executeTask('PROCESS_BATCH', { 
        products: [updatedProduct] 
      });

      // Update cache
      await CacheManager.cacheProduct(processedProduct);
      if (processedProduct.batches?.length > 0) {
        await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);
      }

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

      // Queue remote sync
      this.queueOperation({
        type: 'UPDATE',
        productId: processedProduct._id,
        product: processedProduct,
        operationId
      });

      console.log(`✅ Product updated: ${processedProduct.name}`);
      perfMonitor.end(`updateProduct_${operationId}`);
      
      return { success: true, product: processedProduct };

    } catch (error) {
      console.error('❌ Error updating product:', error);
      perfMonitor.end(`updateProduct_${operationId}`);
      return { success: false, error: error.message };
    } finally {
      this.pendingOperations.delete(`update_${productId}`);
    }
  }

  async updateProductBatch(productId, batchId, updates) {
    const operationId = `update_batch_${Date.now()}`;
    perfMonitor.start(`updateBatch_${operationId}`);
    
    try {
      console.log(`🔄 Updating batch: ${batchId} in product: ${productId}`);
      
      // Get current product from cache first
      let currentProduct = await CacheManager.getCachedProduct(productId);
      if (!currentProduct) {
        currentProduct = this.getState().getProductById(productId);
      }
      
      if (!currentProduct) {
        throw new Error('Product not found');
      }

      // Find and update batch
      const batchIndex = currentProduct.batches?.findIndex(b => b.id === batchId);
      if (batchIndex === -1 || batchIndex === undefined) {
        throw new Error('Batch not found');
      }

      const updatedBatches = [...(currentProduct.batches || [])];
      updatedBatches[batchIndex] = {
        ...updatedBatches[batchIndex],
        ...updates,
        id: batchId, // Ensure ID doesn't change
        updatedAt: new Date().toISOString()
      };

      // Validate updated batch
      const validation = validateBatch(updatedBatches[batchIndex]);
      if (!validation.isValid) {
        throw new Error(`Batch validation failed: ${validation.errors.join(', ')}`);
      }

      // Update product
      const updatedProduct = {
        ...currentProduct,
        batches: updatedBatches,
        updatedAt: new Date().toISOString(),
        version: (currentProduct.version || 1) + 1
      };

      // Process through worker
      const [processedProduct] = await workerManager.executeTask('PROCESS_BATCH', { 
        products: [updatedProduct] 
      });

      // Update cache
      await CacheManager.cacheProduct(processedProduct);
      await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

      // Queue remote sync
      this.queueOperation({
        type: 'UPDATE',
        productId: processedProduct._id,
        product: processedProduct,
        operationId
      });

      console.log(`✅ Batch updated: ${batchId}`);
      perfMonitor.end(`updateBatch_${operationId}`);
      
      return { success: true, product: processedProduct, batch: updatedBatches[batchIndex] };

    } catch (error) {
      console.error('❌ Error updating batch:', error);
      perfMonitor.end(`updateBatch_${operationId}`);
      return { success: false, error: error.message };
    }
  }

  // =================================================================
  //  PRODUCT DELETION OPERATIONS
  // =================================================================

  async deleteProduct(productId) {
    const operationId = `delete_${Date.now()}`;
    perfMonitor.start(`deleteProduct_${operationId}`);
    
    try {
      console.log(`🗑️ Deleting product: ${productId}`);
      
      // Get current product from cache first
      let currentProduct = await CacheManager.getCachedProduct(productId);
      if (!currentProduct) {
        currentProduct = this.getState().getProductById(productId);
      }
      
      if (!currentProduct) {
        throw new Error('Product not found');
      }

      // Remove from cache
      await CacheManager.removeCachedProduct(productId);

      // Remove from inventory state
      const state = this.getState();
      await state.removeProductFromInventory(productId);

      // Queue remote deletion
      this.queueOperation({
        type: 'DELETE',
        productId: productId,
        product: currentProduct,
        operationId
      });

      console.log(`✅ Product deleted: ${currentProduct.name}`);
      perfMonitor.end(`deleteProduct_${operationId}`);
      
      return { success: true, deletedProduct: currentProduct };

    } catch (error) {
      console.error('❌ Error deleting product:', error);
      perfMonitor.end(`deleteProduct_${operationId}`);
      return { success: false, error: error.message };
    }
  }

  async deleteBatch(productId, batchId) {
    const operationId = `delete_batch_${Date.now()}`;
    perfMonitor.start(`deleteBatch_${operationId}`);
    
    try {
      console.log(`🗑️ Deleting batch: ${batchId} from product: ${productId}`);
      
      // Get current product from cache first
      let currentProduct = await CacheManager.getCachedProduct(productId);
      if (!currentProduct) {
        currentProduct = this.getState().getProductById(productId);
      }
      
      if (!currentProduct) {
        throw new Error('Product not found');
      }

      // Find batch
      const batchToDelete = currentProduct.batches?.find(b => b.id === batchId);
      if (!batchToDelete) {
        throw new Error('Batch not found');
      }

      // Remove batch
      const updatedBatches = currentProduct.batches.filter(b => b.id !== batchId);
      
      const updatedProduct = {
        ...currentProduct,
        batches: updatedBatches,
        updatedAt: new Date().toISOString(),
        version: (currentProduct.version || 1) + 1
      };

      // Process through worker
      const [processedProduct] = await workerManager.executeTask('PROCESS_BATCH', { 
        products: [updatedProduct] 
      });

      // Update cache
      await CacheManager.cacheProduct(processedProduct);
      await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

      // Queue remote sync
      this.queueOperation({
        type: 'UPDATE',
        productId: processedProduct._id,
        product: processedProduct,
        operationId
      });

      console.log(`✅ Batch deleted: ${batchId}`);
      perfMonitor.end(`deleteBatch_${operationId}`);
      
      return { success: true, product: processedProduct, deletedBatch: batchToDelete };

    } catch (error) {
      console.error('❌ Error deleting batch:', error);
      perfMonitor.end(`deleteBatch_${operationId}`);
      return { success: false, error: error.message };
    }
  }

  // =================================================================
  //  BULK OPERATIONS WITH CACHE OPTIMIZATION
  // =================================================================

  async bulkCreateProducts(productsData) {
    const operationId = `bulk_create_${Date.now()}`;
    perfMonitor.start(`bulkCreateProducts_${operationId}`);
    
    try {
      console.log(`📦 Bulk creating ${productsData.length} products...`);
      
      const results = [];
      const validProducts = [];
      const errors = [];

      // Validate all products first
      for (let i = 0; i < productsData.length; i++) {
        const productData = productsData[i];
        const validation = validateProduct(productData);
        
        if (validation.isValid) {
          const newProduct = {
            ...productData,
            _id: productData._id || generateProductId(),
            type: 'product',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
            batches: productData.batches || []
          };
          
          validProducts.push(newProduct);
        } else {
          errors.push({
            index: i,
            product: productData.name || `Product ${i}`,
            errors: validation.errors
          });
        }
      }

      if (validProducts.length === 0) {
        throw new Error('No valid products to create');
      }

      // Process products in batches using worker
      const processedProducts = await processBatches(
        validProducts,
        async (batch) => await workerManager.executeTask('PROCESS_BATCH', { products: batch }),
        PERFORMANCE_CONFIG.BATCH_SIZE
      );

      // Cache products in bulk
      await CacheManager.cacheProducts(processedProducts);

      // Add to inventory state
      const state = this.getState();
      for (const product of processedProducts) {
        const result = await state.addProductToInventory(product);
        results.push({
          product: product,
          success: result.success,
          error: result.error
        });
      }

      // Queue bulk remote sync
      this.queueOperation({
        type: 'BULK_CREATE',
        products: processedProducts,
        operationId
      });

      console.log(`✅ Bulk creation completed: ${processedProducts.length} products created`);
      perfMonitor.end(`bulkCreateProducts_${operationId}`);
      
      return { 
        success: true, 
        created: processedProducts.length,
        results: results,
        errors: errors
      };

    } catch (error) {
      console.error('❌ Error in bulk create:', error);
      perfMonitor.end(`bulkCreateProducts_${operationId}`);
      return { success: false, error: error.message };
    }
  }

  // =================================================================
  //  FETCH OPERATIONS WITH CACHE-FIRST STRATEGY
  // =================================================================

  async fetchAllProducts() {
    perfMonitor.start('fetchAllProducts');
    
    try {
      console.log('📡 Fetching all products from remote...');
      
      const response = await axios.get(`${DB_URL}/_all_docs?include_docs=true`, DB_AUTH);
      const products = response.data.rows
        .filter(row => row.doc.type === 'product')
        .map(row => {
          const { _rev, type, ...product } = row.doc;
          return product;
        });

      console.log(`✅ Fetched ${products.length} products from remote`);
      perfMonitor.end('fetchAllProducts');
      
      return products;

    } catch (error) {
      console.error('❌ Error fetching products from remote:', error);
      perfMonitor.end('fetchAllProducts');
      throw error;
    }
  }

  async fetchProductById(productId) {
    try {
      // Try cache first
      const cachedProduct = await CacheManager.getCachedProduct(productId);
      if (cachedProduct) {
        console.log(`📋 Product found in cache: ${productId}`);
        return cachedProduct;
      }

      // Fetch from remote if not in cache
      console.log(`📡 Fetching product from remote: ${productId}`);
      const response = await axios.get(`${DB_URL}/${productId}`, DB_AUTH);
      const { _rev, type, ...product } = response.data;

      // Cache the fetched product
      await CacheManager.cacheProduct(product);
      
      return product;

    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('❌ Error fetching product:', error);
      throw error;
    }
  }

  // =================================================================
  //  OPERATION QUEUE AND REMOTE SYNC (UNCHANGED)
  // =================================================================

  queueOperation(operation) {
    this.operationQueue.push({
      ...operation,
      timestamp: Date.now(),
      retries: 0
    });

    if (!this.isProcessingQueue) {
      this.processOperationQueue();
    }
  }

  async processOperationQueue() {
    if (this.isProcessingQueue || this.operationQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    console.log(`🔄 Processing ${this.operationQueue.length} queued operations...`);

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift();
      
      try {
        await this.executeRemoteOperation(operation);
        console.log(`✅ Remote operation completed: ${operation.type} - ${operation.operationId}`);
      } catch (error) {
        console.error(`❌ Remote operation failed: ${operation.type} - ${operation.operationId}`, error);
        
        if (operation.retries < PERFORMANCE_CONFIG.SYNC_RETRY_ATTEMPTS) {
          operation.retries++;
          this.operationQueue.push(operation);
          console.log(`🔄 Retrying operation: ${operation.operationId} (attempt ${operation.retries})`);
        } else {
          console.error(`💀 Operation failed permanently: ${operation.operationId}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.isProcessingQueue = false;
    console.log('✅ Operation queue processing completed');
  }

  async executeRemoteOperation(operation) {
    const { type, productId, product, products } = operation;

    switch (type) {
      case 'CREATE':
        return await withRetry(async () => {
          await axios.post(DB_URL, product, DB_AUTH);
        });

      case 'UPDATE':
        return await withRetry(async () => {
          const currentDoc = await axios.get(`${DB_URL}/${productId}`, DB_AUTH);
          const updatedProduct = {
            ...product,
            _rev: currentDoc.data._rev
          };
          await axios.put(`${DB_URL}/${productId}`, updatedProduct, DB_AUTH);
        });

      case 'DELETE':
        return await withRetry(async () => {
          const currentDoc = await axios.get(`${DB_URL}/${productId}`, DB_AUTH);
          await axios.delete(`${DB_URL}/${productId}?rev=${currentDoc.data._rev}`, DB_AUTH);
        });

      case 'BULK_CREATE':
        return await withRetry(async () => {
          const docs = products.map(p => ({ ...p, type: 'product' }));
          await axios.post(`${DB_URL}/_bulk_docs`, { docs }, DB_AUTH);
        });

      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  }

  // =================================================================
  //  UTILITY METHODS
  // =================================================================

  getQueueStatus() {
    return {
      queueLength: this.operationQueue.length,
      isProcessing: this.isProcessingQueue,
      pendingOperations: this.pendingOperations.size,
      nextOperation: this.operationQueue[0] || null
    };
  }

  clearQueue() {
    this.operationQueue.length = 0;
    this.pendingOperations.clear();
    this.isProcessingQueue = false;
    console.log('🧹 Operation queue cleared');
  }

  async forceProcessQueue() {
    if (this.isProcessingQueue) {
      console.log('⚠️ Queue is already being processed');
      return;
    }
    await this.processOperationQueue();
  }

  cleanup() {
    this.clearQueue();
    if (workerManager) {
      workerManager.terminate();
    }
    console.log('🧹 ProductOperations cleanup completed');
  }
}

export default ProductOperations;

// Export utility functions
export {
  workerManager as productWorkerManager,
  perfMonitor as productPerfMonitor
};

export const createProductOperations = (inventoryStore) => {
  return new ProductOperations(inventoryStore);
};
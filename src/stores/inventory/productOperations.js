// src/stores/inventory/productOperations.js - PouchDB-Only Product CRUD Operations
import CacheManager from '../../utils/cache/index';
import { InventoryWorkerManager, PerformanceMonitor, processBatches, PERFORMANCE_CONFIG } from './performanceManager';
import { validateProduct, validateBatch, generateProductId, generateBatchId } from '../validationService';

// --- Initialize Performance Tools ---
const workerManager = new InventoryWorkerManager();
const perfMonitor = new PerformanceMonitor();

// =================================================================
//  🚀 POUCHDB-ONLY PRODUCT OPERATIONS CLASS
// =================================================================

export class ProductOperations {
  constructor(getInventoryState) {
    this.getState = getInventoryState;
    this.pendingOperations = new Map();
    this.isProcessing = false;
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

      // Cache to PouchDB
      await CacheManager.cacheProduct(processedProduct);
      
      // Cache batches if any
      if (processedProduct.batches?.length > 0) {
        await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);
      }

      // Update inventory state
      const state = this.getState();
      await state.addProductToInventory(processedProduct);

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

      // Update PouchDB cache
      await CacheManager.cacheProduct(processedProduct);
      await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

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

      // Update PouchDB cache
      await CacheManager.cacheProduct(processedProduct);
      if (processedProduct.batches?.length > 0) {
        await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);
      }

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

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

      // Update PouchDB cache
      await CacheManager.cacheProduct(processedProduct);
      await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

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

      // Remove from PouchDB cache
      await CacheManager.removeCachedProduct(productId);

      // Remove from inventory state
      const state = this.getState();
      await state.removeProductFromInventory(productId);

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

      // Update PouchDB cache
      await CacheManager.cacheProduct(processedProduct);
      await CacheManager.cacheBatches(processedProduct._id, processedProduct.batches);

      // Update inventory state
      const state = this.getState();
      await state.updateProductInInventory(processedProduct);

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
  //  BULK OPERATIONS - POUCHDB OPTIMIZED
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
          
          // Process batches if provided
          if (newProduct.batches.length > 0) {
            newProduct.batches = newProduct.batches.map(batch => ({
              ...batch,
              id: batch.id || generateBatchId(),
              createdAt: new Date().toISOString(),
              quantity: Number(batch.quantity) || 0
            }));
          }
          
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

      // Cache products in bulk to PouchDB
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

  async bulkUpdateProducts(updates) {
    const operationId = `bulk_update_${Date.now()}`;
    perfMonitor.start(`bulkUpdateProducts_${operationId}`);
    
    try {
      console.log(`🔄 Bulk updating ${updates.length} products...`);
      
      const results = [];
      const updatedProducts = [];

      for (const { productId, updates: productUpdates } of updates) {
        try {
          // Get current product from cache
          let currentProduct = await CacheManager.getCachedProduct(productId);
          if (!currentProduct) {
            currentProduct = this.getState().getProductById(productId);
          }
          
          if (!currentProduct) {
            results.push({
              productId,
              success: false,
              error: 'Product not found'
            });
            continue;
          }

          // Merge updates
          const updatedProduct = {
            ...currentProduct,
            ...productUpdates,
            _id: productId,
            updatedAt: new Date().toISOString(),
            version: (currentProduct.version || 1) + 1
          };

          // Validate updated product
          const validation = validateProduct(updatedProduct);
          if (!validation.isValid) {
            results.push({
              productId,
              success: false,
              error: `Validation failed: ${validation.errors.join(', ')}`
            });
            continue;
          }

          updatedProducts.push(updatedProduct);
          results.push({
            productId,
            success: true,
            product: updatedProduct
          });

        } catch (error) {
          results.push({
            productId,
            success: false,
            error: error.message
          });
        }
      }

      if (updatedProducts.length > 0) {
        // Process through worker
        const processedProducts = await processBatches(
          updatedProducts,
          async (batch) => await workerManager.executeTask('PROCESS_BATCH', { products: batch }),
          PERFORMANCE_CONFIG.BATCH_SIZE
        );

        // Update PouchDB cache in bulk
        await CacheManager.cacheProducts(processedProducts);

        // Update inventory state
        const state = this.getState();
        for (const product of processedProducts) {
          await state.updateProductInInventory(product);
        }
      }

      console.log(`✅ Bulk update completed: ${updatedProducts.length} products updated`);
      perfMonitor.end(`bulkUpdateProducts_${operationId}`);
      
      return { 
        success: true, 
        updated: updatedProducts.length,
        results: results
      };

    } catch (error) {
      console.error('❌ Error in bulk update:', error);
      perfMonitor.end(`bulkUpdateProducts_${operationId}`);
      return { success: false, error: error.message };
    }
  }

  // =================================================================
  //  FETCH OPERATIONS - POUCHDB ONLY
  // =================================================================

  async fetchAllProducts() {
    perfMonitor.start('fetchAllProducts');
    
    try {
      console.log('📡 Fetching all products from PouchDB...');
      
      const products = await CacheManager.getAllCachedProducts();
      
      console.log(`✅ Fetched ${products.length} products from PouchDB`);
      perfMonitor.end('fetchAllProducts');
      
      return products;

    } catch (error) {
      console.error('❌ Error fetching products from PouchDB:', error);
      perfMonitor.end('fetchAllProducts');
      throw error;
    }
  }

  async fetchProductById(productId) {
    try {
      // Get from PouchDB cache
      const cachedProduct = await CacheManager.getCachedProduct(productId);
      if (cachedProduct) {
        console.log(`📋 Product found in PouchDB: ${productId}`);
        return cachedProduct;
      }

      console.log(`📭 Product not found in PouchDB: ${productId}`);
      return null;

    } catch (error) {
      console.error('❌ Error fetching product:', error);
      throw error;
    }
  }

  // =================================================================
  //  SEARCH OPERATIONS - POUCHDB ONLY
  // =================================================================

  async searchProducts(query) {
    try {
      console.log(`🔍 Searching products in PouchDB: "${query}"`);
      
      const results = await CacheManager.searchProductsOffline(query);
      
      console.log(`✅ Found ${results.length} products matching "${query}"`);
      return { success: true, products: results };

    } catch (error) {
      console.error('❌ Error searching products:', error);
      return { success: false, error: error.message, products: [] };
    }
  }

  // =================================================================
  //  UTILITY METHODS
  // =================================================================

  getQueueStatus() {
    return {
      queueLength: 0, // No queue in PouchDB-only mode
      isProcessing: this.isProcessing,
      pendingOperations: this.pendingOperations.size,
      nextOperation: null // No queue in PouchDB-only mode
    };
  }

  cleanup() {
    this.pendingOperations.clear();
    this.isProcessing = false;
    
    if (workerManager) {
      workerManager.terminate();
    }
    
    console.log('🧹 ProductOperations cleanup completed (PouchDB-only)');
  }

  // =================================================================
  //  POUCHDB HEALTH CHECK
  // =================================================================

  async checkHealth() {
    try {
      const health = await CacheManager.checkPouchDBHealth();
      return {
        healthy: health.healthy,
        totalProducts: health.totalProducts || 0,
        totalBatches: health.totalBatches || 0,
        cacheSize: health.cacheSize || 0,
        pendingOperations: this.pendingOperations.size,
        isProcessing: this.isProcessing
      };
    } catch (error) {
      console.error('❌ ProductOperations health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        pendingOperations: this.pendingOperations.size,
        isProcessing: this.isProcessing
      };
    }
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
// ===================================
// src/utils/cache/ProductCache.js - FIXED VERSION
// ===================================
import { productsDB, batchesDB } from './databases.js';
import CacheUtilities from './CacheUtilities.js';
import SyncCache from './SyncCache.js';

const ProductCache = {
  // Enhanced batch processing with streaming
  async cacheProducts(products = []) {
    if (!products.length) return;
    
    try {
      console.log(`🔄 Starting to cache ${products.length} products...`);
      const startTime = performance.now();
      
      // Clear databases in parallel
      await Promise.all([
        CacheUtilities.clearDatabase(productsDB),
        CacheUtilities.clearDatabase(batchesDB)
      ]);
      
      const { processedProducts, batchesToStore } = this._processProductsForCache(products);
      
      // Use chunked processing for large datasets
      const CHUNK_SIZE = 100;
      const productPromises = [];
      const batchPromises = [];
      
      // Process products in chunks
      for (let i = 0; i < processedProducts.length; i += CHUNK_SIZE) {
        const chunk = processedProducts.slice(i, i + CHUNK_SIZE);
        productPromises.push(productsDB.bulkDocs(chunk));
      }
      
      // Process batches in chunks
      for (let i = 0; i < batchesToStore.length; i += CHUNK_SIZE) {
        const chunk = batchesToStore.slice(i, i + CHUNK_SIZE);
        batchPromises.push(batchesDB.bulkDocs(chunk));
      }
      
      // Execute all chunks in parallel
      await Promise.all([...productPromises, ...batchPromises]);
      
      // Update sync metadata
      await SyncCache.updateSyncMetadata('products', products.length);
      
      const duration = performance.now() - startTime;
      console.log(`✅ Cached ${processedProducts.length} products with ${batchesToStore.length} batches in ${duration.toFixed(2)}ms`);
      
    } catch (error) {
      console.error('Error caching products:', error);
      throw error;
    }
  },

  // Enhanced retrieval with lazy loading
  async getAllCachedProducts() {
    try {
      const startTime = performance.now();
      
      const [productsResult, batchesResult] = await Promise.all([
        productsDB.allDocs({ include_docs: true }),
        batchesDB.allDocs({ include_docs: true })
      ]);
      
      const products = this._reconstructProductsWithBatches(
        productsResult.rows.map(row => row.doc),
        batchesResult.rows.map(row => row.doc)
      );
      
      const duration = performance.now() - startTime;
      console.log(`📦 Loaded ${products.length} products from cache in ${duration.toFixed(2)}ms`);
      
      return products;
    } catch (error) {
      console.error('Error getting cached products:', error);
      return [];
    }
  },

  // Enhanced with better conflict resolution
  async addProductToCache(product) {
    if (!product?._id) {
      console.error('Invalid product data for cache');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      const productData = this._cleanProductData(product);
      await productsDB.put(productData);
      
      if (product.batches?.length) {
        await this._updateProductBatches(product._id, product.batches);
      }
      
      console.log(`✅ Added product ${product._id} to cache`);
      return true;
    }, 3);
  },

  // Enhanced search with indexing
  async searchProductsOffline(keyword = '') {
    if (!keyword) return [];
    
    try {
      const startTime = performance.now();
      
      // Use more efficient search with indexed fields
      const products = await this._getFilteredProductsOptimized(keyword);
      const enrichedProducts = await this._enrichProductsWithBatches(products);
      
      const duration = performance.now() - startTime;
      console.log(`🔍 Search completed in ${duration.toFixed(2)}ms - found ${enrichedProducts.length} products`);
      
      return enrichedProducts;
    } catch (error) {
      console.error('Error searching products offline:', error);
      return [];
    }
  },

  // New: Batch update method for better performance
  async updateMultipleProducts(products) {
    if (!products?.length) return false;

    try {
      const startTime = performance.now();
      
      const updatePromises = products.map(product => 
        this.updateProductInCache(product)
      );
      
      const results = await Promise.allSettled(updatePromises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      
      const duration = performance.now() - startTime;
      console.log(`✅ Updated ${successful}/${products.length} products in ${duration.toFixed(2)}ms`);
      
      return successful === products.length;
    } catch (error) {
      console.error('Error updating multiple products:', error);
      return false;
    }
  },

  // Enhanced helper methods
  _processProductsForCache(products) {
    const processedProducts = [];
    const batchesToStore = [];
    
    for (const product of products) {
      const cleanProduct = this._cleanProductData(product);
      processedProducts.push(cleanProduct);
      
      if (product.batches?.length) {
        batchesToStore.push(...product.batches.map(batch => ({
          _id: `${product._id}_${batch.id || Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          productId: product._id,
          ...batch
        })));
      }
    }
    
    return { processedProducts, batchesToStore };
  },

  _reconstructProductsWithBatches(products, batches) {
    // Create a map for faster batch lookup
    const batchMap = new Map();
    
    batches.forEach(batch => {
      if (!batchMap.has(batch.productId)) {
        batchMap.set(batch.productId, []);
      }
      
      const { _id, _rev, productId, ...cleanBatch } = batch;
      batchMap.get(batch.productId).push(cleanBatch);
    });
    
    return products.map(product => ({
      ...product,
      batches: batchMap.get(product._id) || []
    }));
  },

  // Optimized search with better indexing
  async _getFilteredProductsOptimized(keyword) {
    const result = await productsDB.allDocs({ include_docs: true });
    const lower = keyword.toLowerCase();
    
    // Use more efficient filtering with the stored searchIndex field
    return result.rows
      .map(row => row.doc)
      .filter(p => {
        // Use the stored searchIndex field or create it on-the-fly
        const searchText = p.searchIndex || this._createSearchIndex(p);
        return searchText.includes(lower);
      });
  },

  // Enhanced data cleaning with validation - FIXED: Removed _searchIndex field
  _cleanProductData(product) {
    return {
      _id: product._id,
      name: product.name || '',
      sku: product.sku || '',
      category: product.category || '',
      barcode: product.barcode || '',
      brand: product.brand || '',
      retailPrice: parseFloat(product.retailPrice) || 0,
      purchasePrice: parseFloat(product.purchasePrice) || 0,
      lowStockThreshold: parseInt(product.lowStockThreshold) || 0,
      totalQuantity: parseInt(product.totalQuantity) || 0,
      type: product.type || 'product',
      imageAttachmentName: product.imageAttachmentName || null,
      createdAt: product.createdAt || new Date().toISOString(),
      updatedAt: product.updatedAt || new Date().toISOString(),
      // FIXED: Changed from _searchIndex to searchIndex (no underscore prefix)
      searchIndex: this._createSearchIndex(product)
    };
  },

  // Create search index for faster searches
  _createSearchIndex(product) {
    return [
      product.name,
      product.sku,
      product.barcode,
      product.category,
      product.brand
    ].filter(Boolean).join(' ').toLowerCase();
  },

  // Rest of the existing methods remain the same...
  async getProductById(id) {
    try {
      const product = await productsDB.get(id);
      if (!product) return null;
      
      const batches = await this._getBatchesForProduct(id);
      return { ...product, batches };
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting product by ID:', error);
      return null;
    }
  },

  async updateProductInCache(product) {
    if (!product?._id) {
      console.error('Invalid product data for cache update');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      if (product._deleted) {
        await this.removeProductFromCache(product._id);
        return true;
      }

      const productData = this._cleanProductData(product);
      await this._updateProductDocument(productData);
      await this._updateProductBatches(product._id, product.batches || []);
      
      console.log(`✅ Successfully updated product ${product._id} in cache`);
      return true;
    }, 3);
  },

  async removeProductFromCache(productId) {
  try {
    // FIXED: Ensure productId is a string and validate it
    if (!productId) {
      console.error('removeProductFromCache: productId is required');
      return false;
    }
    
    const cleanProductId = String(productId).trim();
    if (!cleanProductId) {
      console.error('removeProductFromCache: invalid productId after cleaning:', productId);
      return false;
    }
    
    // Remove product document
    try {
      const existingProduct = await productsDB.get(cleanProductId);
      await productsDB.remove(existingProduct);
    } catch (error) {
      if (error.name !== 'not_found') throw error;
    }
    
    // Remove all batches for this product
    await this._removeProductBatches(cleanProductId);
    
    console.log(`✅ Removed product ${cleanProductId} from cache`);
    return true;
  } catch (error) {
    console.error('Error removing product from cache:', error);
    return false;
  }
},

  async _updateProductDocument(productData) {
    try {
      const existingProduct = await productsDB.get(productData._id);
      productData._rev = existingProduct._rev;
    } catch (error) {
      if (error.name !== 'not_found') throw error;
    }
    
    await productsDB.put(productData);
  },

  async _updateProductBatches(productId, batches) {
    try {
      await this._removeProductBatches(productId);
      
      if (batches?.length) {
        const batchesToStore = batches.map((batch, index) => ({
          _id: `${productId}_${batch.id || Date.now()}_${index}`,
          productId: productId,
          ...batch
        }));
        
        await batchesDB.bulkDocs(batchesToStore);
      }
    } catch (error) {
      console.error('Error updating product batches:', error);
      throw error;
    }
  },

  async _removeProductBatches(productId) {
  try {
    const cleanProductId = String(productId).trim();
    
    const result = await batchesDB.allDocs({
      include_docs: true,
      startkey: `${cleanProductId}_`,
      endkey: `${cleanProductId}_\ufff0`
    });
    
    if (result.rows.length > 0) {
      const batchesToDelete = result.rows.map(row => ({
        _id: row.doc._id,
        _rev: row.doc._rev,
        _deleted: true
      }));
      
      await batchesDB.bulkDocs(batchesToDelete);
    }
  } catch (error) {
    console.error('Error removing product batches:', error);
    throw error;
  }
},

  async _getBatchesForProduct(productId) {
    try {
      const result = await batchesDB.allDocs({
        include_docs: true,
        startkey: `${productId}_`,
        endkey: `${productId}_\ufff0`
      });
      
      return result.rows.map(row => {
        const { _id, _rev, productId, ...cleanBatch } = row.doc;
        return cleanBatch;
      });
    } catch (error) {
      console.error('Error getting batches for product:', error);
      return [];
    }
  },

  async _enrichProductsWithBatches(products) {
    return Promise.all(products.map(async product => {
      const batches = await this._getBatchesForProduct(product._id);
      return { ...product, batches };
    }));
  }
};

export default ProductCache;
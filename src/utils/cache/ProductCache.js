// ===================================
// src/utils/cache/ProductCache.js
// ===================================
import { productsDB, batchesDB } from './databases.js';
import CacheUtilities from './CacheUtilities.js';

const ProductCache = {
  async cacheProducts(products = []) {
    if (!products.length) return;
    
    try {
      await CacheUtilities.clearDatabase(productsDB);
      await CacheUtilities.clearDatabase(batchesDB);
      
      const { processedProducts, batchesToStore } = this._processProductsForCache(products);
      
      if (processedProducts.length > 0) {
        await productsDB.bulkDocs(processedProducts);
      }
      if (batchesToStore.length > 0) {
        await batchesDB.bulkDocs(batchesToStore);
      }
      
      await this.updateSyncMetadata('products', products.length);
      console.log(`✅ Cached ${processedProducts.length} products with ${batchesToStore.length} batches`);
      
    } catch (error) {
      console.error('Error caching products:', error);
      throw error;
    }
  },

  async getAllCachedProducts() {
    try {
      const [productsResult, batchesResult] = await Promise.all([
        productsDB.allDocs({ include_docs: true }),
        batchesDB.allDocs({ include_docs: true })
      ]);
      
      return this._reconstructProductsWithBatches(
        productsResult.rows.map(row => row.doc),
        batchesResult.rows.map(row => row.doc)
      );
    } catch (error) {
      console.error('Error getting cached products:', error);
      return [];
    }
  },

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
      // Remove product document
      try {
        const existingProduct = await productsDB.get(productId);
        await productsDB.remove(existingProduct);
      } catch (error) {
        if (error.name !== 'not_found') throw error;
      }
      
      // Remove all batches for this product
      await this._removeProductBatches(productId);
      
      console.log(`✅ Removed product ${productId} from cache`);
      return true;
    } catch (error) {
      console.error('Error removing product from cache:', error);
      return false;
    }
  },

  async searchProductsOffline(keyword = '') {
    if (!keyword) return [];
    
    try {
      const products = await this._getFilteredProducts(keyword);
      return this._enrichProductsWithBatches(products);
    } catch (error) {
      console.error('Error searching products offline:', error);
      return [];
    }
  },

  // Private helper methods
  _processProductsForCache(products) {
    const processedProducts = [];
    const batchesToStore = [];
    
    for (const product of products) {
      processedProducts.push(this._cleanProductData(product));
      
      if (product.batches?.length) {
        batchesToStore.push(...product.batches.map(batch => ({
          _id: `${product._id}_${batch.id}`,
          productId: product._id,
          ...batch
        })));
      }
    }
    
    return { processedProducts, batchesToStore };
  },

  _reconstructProductsWithBatches(products, batches) {
    return products.map(product => {
      const productBatches = batches
        .filter(batch => batch.productId === product._id)
        .map(batch => {
          const { _id, _rev, productId, ...cleanBatch } = batch;
          return cleanBatch;
        });
      
      return { ...product, batches: productBatches };
    });
  },

  _cleanProductData(product) {
    return {
      _id: product._id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      barcode: product.barcode,
      retailPrice: product.retailPrice,
      purchasePrice: product.purchasePrice,
      lowStockThreshold: product.lowStockThreshold,
      totalQuantity: product.totalQuantity || 0,
      type: product.type,
      imageAttachmentName: product.imageAttachmentName,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt || new Date().toISOString()
    };
  },

  async _updateProductDocument(productData) {
    try {
      // Get existing product to preserve _rev
      const existingProduct = await productsDB.get(productData._id);
      productData._rev = existingProduct._rev;
    } catch (error) {
      if (error.name !== 'not_found') throw error;
      // Product doesn't exist, no _rev needed
    }
    
    await productsDB.put(productData);
  },

  async _updateProductBatches(productId, batches) {
    try {
      // Remove existing batches for this product
      await this._removeProductBatches(productId);
      
      // Add new batches
      if (batches?.length) {
        const batchesToStore = batches.map(batch => ({
          _id: `${productId}_${batch.id}`,
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
      const result = await batchesDB.allDocs({
        include_docs: true,
        startkey: `${productId}_`,
        endkey: `${productId}_\ufff0`
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

  async _getFilteredProducts(keyword) {
    const result = await productsDB.allDocs({ include_docs: true });
    const lower = keyword.toLowerCase();
    
    return result.rows
      .map(row => row.doc)
      .filter(p => 
        p.name?.toLowerCase().includes(lower) ||
        p.sku?.toLowerCase().includes(lower) ||
        p.barcode?.toLowerCase().includes(lower) ||
        p.category?.toLowerCase().includes(lower)
      );
  },

  async _enrichProductsWithBatches(products) {
    return Promise.all(products.map(async product => {
      const batches = await this._getBatchesForProduct(product._id);
      return { ...product, batches };
    }));
  }
};

export default ProductCache;
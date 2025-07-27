// ===================================
// src/utils/cache/BatchCache.js
// ===================================
import { batchesDB, productsDB } from './databases.js';

const BatchCache = {
  async getBatchesByProductId(productId) {
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
      console.error('Error getting batches by product ID:', error);
      return [];
    }
  },

  async getExpiringBatches(days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() + days);
      
      const batchesResult = await batchesDB.allDocs({ include_docs: true });
      const expiringBatches = batchesResult.rows
        .map(row => row.doc)
        .filter(batch => batch.expDate && new Date(batch.expDate) <= cutoffDate);
      
      return this._enrichBatchesWithProductNames(expiringBatches);
    } catch (error) {
      console.error('Error getting expiring batches:', error);
      return [];
    }
  },

  async _enrichBatchesWithProductNames(batches) {
    return Promise.all(batches.map(async batch => {
      try {
        const product = await productsDB.get(batch.productId);
        const { _id, _rev, productId, ...cleanBatch } = batch;
        return { ...cleanBatch, productName: product?.name || 'Unknown Product' };
      } catch (error) {
        const { _id, _rev, productId, ...cleanBatch } = batch;
        return { ...cleanBatch, productName: 'Unknown Product' };
      }
    }));
  }
};

export default BatchCache;
// ===================================
// src/utils/cache/SearchCache.js
// ===================================
import { productsDB, batchesDB, searchCacheDB } from './databases.js';

const SearchCache = {
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

  async cacheSearchResults(query, results) {
    try {
      const cacheEntry = {
        _id: `search_${query.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        query: query.toLowerCase(),
        results,
        timestamp: new Date().toISOString()
      };
      
      await searchCacheDB.put(cacheEntry);
      await this._cleanOldSearchCache();
    } catch (error) {
      console.error('Error caching search results:', error);
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
  }
};

export default SearchCache;
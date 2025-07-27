// ===================================
// src/utils/cache/StatsCache.js
// ===================================
import { inventoryStatsDB, productsDB } from './databases.js';

const StatsCache = {
  async cacheInventoryStats(stats) {
    try {
      const statsEntry = {
        _id: 'inventory_stats',
        ...stats,
        timestamp: new Date().toISOString()
      };
      
      // Get existing stats to preserve _rev
      try {
        const existingStats = await inventoryStatsDB.get('inventory_stats');
        statsEntry._rev = existingStats._rev;
      } catch (error) {
        // Stats don't exist, no _rev needed
      }
      
      await inventoryStatsDB.put(statsEntry);
      
    } catch (error) {
      console.error('Error caching inventory stats:', error);
    }
  },

  async getCachedInventoryStats() {
    try {
      const stats = await inventoryStatsDB.get('inventory_stats');
      const { _id, _rev, ...cleanStats } = stats;
      return cleanStats;
    } catch (error) {
      if (error.name === 'not_found') {
        return null;
      }
      console.error('Error getting cached inventory stats:', error);
      return null;
    }
  },

  async getLowStockProducts() {
    try {
      const productsResult = await productsDB.allDocs({ include_docs: true });
      const products = productsResult.rows.map(row => row.doc);
      
      return products.filter(product => 
        product.totalQuantity <= (product.lowStockThreshold || 0)
      );
    } catch (error) {
      console.error('Error getting low stock products:', error);
      return [];
    }
  }
};

export default StatsCache;
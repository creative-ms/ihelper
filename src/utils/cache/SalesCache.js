// ===================================
// src/utils/cache/SalesCache.js - Fixed to use SyncCache for metadata updates
// ===================================
import { salesDB, salesStatsDB } from './databases.js';
import CacheUtilities from './CacheUtilities.js';
import SyncCache from './SyncCache.js';

const SalesCache = {
  // Cache recent sales for POS operations
  async cacheRecentSales(sales = []) {
    if (!sales.length) return;
    
    try {
      await CacheUtilities.clearDatabase(salesDB);
      
      const processedSales = sales.map(sale => SalesCache._cleanSaleData(sale));
      
      if (processedSales.length > 0) {
        await salesDB.bulkDocs(processedSales);
      }
      
      // Use SyncCache to avoid conflicts
      await SyncCache.updateSyncMetadata('sales', sales.length);
      console.log(`✅ Cached ${processedSales.length} recent sales`);
      
    } catch (error) {
      console.error('Error caching sales:', error);
      throw error;
    }
  },

  // Get cached sales with filtering
  async getCachedSales({ 
    limit = 100, 
    type = 'SALE', 
    customerId = null,
    dateFrom = null,
    dateTo = null 
  } = {}) {
    try {
      const result = await salesDB.allDocs({ 
        include_docs: true,
        limit: 500 // Get more for filtering
      });
      
      let sales = result.rows.map(row => row.doc);
      
      // Apply filters
      sales = sales.filter(sale => {
        if (type && sale.type !== type) return false;
        if (customerId && sale.customerId !== customerId) return false;
        
        if (dateFrom || dateTo) {
          const saleDate = new Date(sale.createdAt);
          if (dateFrom && saleDate < new Date(dateFrom)) return false;
          if (dateTo && saleDate > new Date(dateTo)) return false;
        }
        
        return true;
      });
      
      // Sort by creation date (newest first)
      sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      return sales.slice(0, limit);
      
    } catch (error) {
      console.error('Error getting cached sales:', error);
      return [];
    }
  },

  // Add new sale to cache immediately after creation
  async addSaleToCache(sale) {
    if (!sale?._id) {
      console.error('Invalid sale data for cache');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      const saleData = SalesCache._cleanSaleData(sale);
      await salesDB.put(saleData);
      
      console.log(`✅ Added sale ${sale._id} to cache`);
      return true;
    }, 3);
  },

  // Get sale by ID from cache (for quick lookups)
  async getCachedSaleById(saleId) {
    try {
      const sale = await salesDB.get(saleId);
      return sale || null;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached sale by ID:', error);
      return null;
    }
  },

  // Cache sales metrics for dashboard
  async cacheSalesMetrics(metrics) {
    try {
      return await CacheUtilities.safeDocumentUpdate(
        salesStatsDB,
        'sales_metrics',
        (doc) => ({
          ...doc,
          ...metrics,
          timestamp: new Date().toISOString()
        })
      );
    } catch (error) {
      console.error('Error caching sales metrics:', error);
    }
  },

  // Get cached sales metrics
  async getCachedSalesMetrics() {
    try {
      const metrics = await salesStatsDB.get('sales_metrics');
      const { _id, _rev, ...cleanMetrics } = metrics;
      return cleanMetrics;
    } catch (error) {
      if (error.name === 'not_found') {
        return SalesCache._getDefaultMetrics();
      }
      console.error('Error getting cached sales metrics:', error);
      return SalesCache._getDefaultMetrics();
    }
  },

  // Search sales offline (for invoice lookups)
  async searchSalesOffline(keyword = '') {
    if (!keyword) return [];
    
    try {
      const result = await salesDB.allDocs({ include_docs: true });
      const lower = keyword.toLowerCase();
      
      return result.rows
        .map(row => row.doc)
        .filter(sale => 
          sale._id?.toLowerCase().includes(lower) ||
          sale.customerName?.toLowerCase().includes(lower) ||
          sale.customerId?.toLowerCase().includes(lower)
        )
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
    } catch (error) {
      console.error('Error searching sales offline:', error);
      return [];
    }
  },

  // Update sale in cache (for returns processing)
  async updateSaleInCache(sale) {
    if (!sale?._id) {
      console.error('Invalid sale data for cache update');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      const saleData = SalesCache._cleanSaleData(sale);
      
      try {
        // Get existing sale to preserve _rev
        const existingSale = await salesDB.get(saleData._id);
        saleData._rev = existingSale._rev;
      } catch (error) {
        if (error.name !== 'not_found') throw error;
      }
      
      await salesDB.put(saleData);
      
      console.log(`✅ Updated sale ${sale._id} in cache`);
      return true;
    }, 3);
  },

  // Calculate metrics from cached data
  async calculateMetricsFromCache() {
    try {
      const today = new Date().toDateString();
      const sales = await SalesCache.getCachedSales({ limit: 1000 });
      
      const todaySales = sales.filter(sale => 
        sale.type === 'SALE' && 
        new Date(sale.createdAt).toDateString() === today
      );
      
      const totalRevenue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);
      const totalProfit = todaySales.reduce((sum, sale) => sum + (sale.profit || 0), 0);
      const totalCogs = todaySales.reduce((sum, sale) => sum + (sale.totalCogs || 0), 0);
      
      const metrics = {
        todaySalesCount: todaySales.length,
        totalRevenue,
        totalProfit,
        totalCogs,
        averageSaleValue: todaySales.length > 0 ? totalRevenue / todaySales.length : 0,
        profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
        timestamp: new Date().toISOString()
      };
      
      // Cache the calculated metrics
      await SalesCache.cacheSalesMetrics(metrics);
      
      return metrics;
    } catch (error) {
      console.error('Error calculating metrics from cache:', error);
      return SalesCache._getDefaultMetrics();
    }
  },

  // Clear sales cache
  async clearSalesCache() {
    try {
      await CacheUtilities.clearDatabase(salesDB);
      await CacheUtilities.clearDatabase(salesStatsDB);
      
      // Clear sales sync metadata
      await SyncCache.clearSyncMetadata('sales');
      
      console.log('✅ Sales cache cleared');
      return true;
    } catch (error) {
      console.error('Error clearing sales cache:', error);
      return false;
    }
  },

  // Get sales cache health
  async getSalesCacheHealth() {
    try {
      const [salesCount, statsCount, lastSync, isStale] = await Promise.all([
        salesDB.allDocs().then(result => result.rows.length),
        salesStatsDB.allDocs().then(result => result.rows.length),
        SyncCache.getLastSyncTime('sales'),
        SyncCache.isCacheStale(1, 'sales')
      ]);

      return {
        healthy: true,
        salesCount,
        statsCount,
        lastSync,
        isStale,
        isEmpty: salesCount === 0
      };
    } catch (error) {
      return {
        healthy: false,
        salesCount: 0,
        statsCount: 0,
        lastSync: null,
        isStale: true,
        isEmpty: true,
        error: error.message
      };
    }
  },

  // Private helper methods
  _cleanSaleData(sale) {
    return {
      _id: sale._id,
      type: sale.type || 'SALE',
      customerId: sale.customerId,
      customerName: sale.customerName,
      items: sale.items || [],
      subtotal: sale.subtotal || 0,
      totalDiscountAmount: sale.totalDiscountAmount || 0,
      totalTaxAmount: sale.totalTaxAmount || 0,
      flatDiscount: sale.flatDiscount || null,
      total: sale.total || 0,
      profit: sale.profit || 0,
      totalCogs: sale.totalCogs || 0,
      amountPaid: sale.amountPaid || 0,
      changeDue: sale.changeDue || 0,
      paymentMethod: sale.paymentMethod,
      soldBy: sale.soldBy || {},
      createdAt: sale.createdAt,
      updatedAt: sale.updatedAt || new Date().toISOString(),
      // Preserve offline/sync flags if they exist
      isOfflineSale: sale.isOfflineSale,
      isOfflineReturn: sale.isOfflineReturn,
      needsSync: sale.needsSync
    };
  },

  _getDefaultMetrics() {
    return {
      todaySalesCount: 0,
      totalRevenue: 0,
      totalProfit: 0,
      totalCogs: 0,
      averageSaleValue: 0,
      profitMargin: 0,
      timestamp: new Date().toISOString()
    };
  }
};

export default SalesCache;
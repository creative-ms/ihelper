// ===================================
// src/utils/cache/DashboardCache.js - Dashboard-specific cache utilities
// ===================================
import { 
  dashboardStatsDB, 
  chartDataDB, 
  productAnalyticsDB, 
  peakHoursDB, 
  heatmapDataDB, 
  dashboardMetadataDB 
} from './databases.js';

const DashboardCache = {
  // Cache dashboard stats
  async cacheDashboardStats(timeframe, stats) {
    try {
      const cacheId = `stats_${timeframe}_${this._getDateKey()}`;
      const cacheData = {
        _id: cacheId,
        timeframe,
        stats,
        timestamp: new Date().toISOString(),
        version: Date.now()
      };

      // Get existing to preserve _rev
      try {
        const existing = await dashboardStatsDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document, no _rev needed
      }

      await dashboardStatsDB.put(cacheData);
      console.log(`✅ Dashboard stats cached for ${timeframe}`);
    } catch (error) {
      console.error('Error caching dashboard stats:', error);
    }
  },

  // Get cached dashboard stats
  async getCachedDashboardStats(timeframe) {
    try {
      const cacheId = `stats_${timeframe}_${this._getDateKey()}`;
      const cached = await dashboardStatsDB.get(cacheId);
      
      // Check if cache is still valid (30 minutes)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge > 30 * 60 * 1000) { // 30 minutes
        return null;
      }
      
      return cached.stats;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached dashboard stats:', error);
      return null;
    }
  },

  // Cache chart data
  async cacheChartData(chartData) {
    try {
      const cacheId = `charts_${this._getDateKey()}`;
      const cacheData = {
        _id: cacheId,
        chartData,
        timestamp: new Date().toISOString(),
        version: Date.now()
      };

      try {
        const existing = await chartDataDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await chartDataDB.put(cacheData);
      console.log('✅ Chart data cached');
    } catch (error) {
      console.error('Error caching chart data:', error);
    }
  },

  // Get cached chart data
  async getCachedChartData() {
    try {
      const cacheId = `charts_${this._getDateKey()}`;
      const cached = await chartDataDB.get(cacheId);
      
      // Check cache validity (1 hour for charts)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge > 60 * 60 * 1000) { // 1 hour
        return null;
      }
      
      return cached.chartData;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached chart data:', error);
      return null;
    }
  },

  // Cache product analytics (most important for performance)
  async cacheProductAnalytics(timeframe, analytics) {
    try {
      const cacheId = `product_analytics_${timeframe}_${this._getDateKey()}`;
      const cacheData = {
        _id: cacheId,
        timeframe,
        analytics,
        timestamp: new Date().toISOString(),
        version: Date.now()
      };

      try {
        const existing = await productAnalyticsDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await productAnalyticsDB.put(cacheData);
      console.log(`✅ Product analytics cached for ${timeframe}`);
    } catch (error) {
      console.error('Error caching product analytics:', error);
    }
  },

  // Get cached product analytics
  async getCachedProductAnalytics(timeframe) {
    try {
      const cacheId = `product_analytics_${timeframe}_${this._getDateKey()}`;
      const cached = await productAnalyticsDB.get(cacheId);
      
      // Check cache validity (45 minutes for product analytics)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge > 45 * 60 * 1000) { // 45 minutes
        return null;
      }
      
      return cached.analytics;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached product analytics:', error);
      return null;
    }
  },

  // Cache peak hours data
  async cachePeakHoursData(peakHoursData) {
    try {
      const cacheId = `peak_hours_${this._getDateKey()}`;
      const cacheData = {
        _id: cacheId,
        peakHoursData,
        timestamp: new Date().toISOString(),
        version: Date.now()
      };

      try {
        const existing = await peakHoursDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await peakHoursDB.put(cacheData);
      console.log('✅ Peak hours data cached');
    } catch (error) {
      console.error('Error caching peak hours data:', error);
    }
  },

  // Get cached peak hours data
  async getCachedPeakHoursData() {
    try {
      const cacheId = `peak_hours_${this._getDateKey()}`;
      const cached = await peakHoursDB.get(cacheId);
      
      // Check cache validity (2 hours for peak hours)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge > 2 * 60 * 60 * 1000) { // 2 hours
        return null;
      }
      
      return cached.peakHoursData;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached peak hours data:', error);
      return null;
    }
  },

  // Cache heatmap data
  async cacheHeatmapData(heatmapData) {
    try {
      const cacheId = `heatmap_${this._getDateKey()}`;
      const cacheData = {
        _id: cacheId,
        heatmapData,
        timestamp: new Date().toISOString(),
        version: Date.now()
      };

      try {
        const existing = await heatmapDataDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await heatmapDataDB.put(cacheData);
      console.log('✅ Heatmap data cached');
    } catch (error) {
      console.error('Error caching heatmap data:', error);
    }
  },

  // Get cached heatmap data
  async getCachedHeatmapData() {
    try {
      const cacheId = `heatmap_${this._getDateKey()}`;
      const cached = await heatmapDataDB.get(cacheId);
      
      // Check cache validity (1 hour for heatmap)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge > 60 * 60 * 1000) { // 1 hour
        return null;
      }
      
      return cached.heatmapData;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached heatmap data:', error);
      return null;
    }
  },

  // Check if dashboard cache is stale
  async isDashboardCacheStale(hours = 0.5) {
    try {
      const lastSync = await this.getDashboardLastSyncTime();
      if (!lastSync) return true;
      
      const now = new Date();
      const diffHours = (now - lastSync) / (1000 * 60 * 60);
      return diffHours > hours;
    } catch (error) {
      console.error('Error checking dashboard cache staleness:', error);
      return true;
    }
  },

  // Get dashboard last sync time
  async getDashboardLastSyncTime() {
    try {
      const metadata = await dashboardMetadataDB.get('last_sync');
      return metadata ? new Date(metadata.timestamp) : null;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting dashboard last sync time:', error);
      return null;
    }
  },

  // Update dashboard sync metadata
  async updateDashboardSyncTime() {
    try {
      const metadata = {
        _id: 'last_sync',
        timestamp: new Date().toISOString(),
        version: Date.now()
      };
      
      try {
        const existing = await dashboardMetadataDB.get('last_sync');
        metadata._rev = existing._rev;
      } catch (error) {
        // New document
      }
      
      await dashboardMetadataDB.put(metadata);
    } catch (error) {
      console.error('Error updating dashboard sync time:', error);
    }
  },

  // Clear dashboard cache (for manual refresh)
  async clearDashboardCache() {
    try {
      const databases = [
        dashboardStatsDB,
        chartDataDB,
        productAnalyticsDB,
        peakHoursDB,
        heatmapDataDB
      ];
      
      await Promise.all(databases.map(async (db) => {
        const result = await db.allDocs({ include_docs: true });
        const docsToDelete = result.rows.map(row => ({
          _id: row.doc._id,
          _rev: row.doc._rev,
          _deleted: true
        }));
        
        if (docsToDelete.length > 0) {
          await db.bulkDocs(docsToDelete);
        }
      }));
      
      console.log('✅ Dashboard cache cleared');
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing dashboard cache:', error);
      return { success: false, error: error.message };
    }
  },

  // Get dashboard cache size
  async getDashboardCacheSize() {
    try {
      const results = await Promise.all([
        dashboardStatsDB.allDocs(),
        chartDataDB.allDocs(),
        productAnalyticsDB.allDocs(),
        peakHoursDB.allDocs(),
        heatmapDataDB.allDocs()
      ]);
      
      const [stats, charts, analytics, peakHours, heatmaps] = results.map(r => r.rows.length);
      
      return { 
        stats,
        charts,
        analytics,
        peakHours,
        heatmaps,
        total: stats + charts + analytics + peakHours + heatmaps
      };
    } catch (error) {
      console.error('Error getting dashboard cache size:', error);
      return { 
        stats: 0,
        charts: 0,
        analytics: 0,
        peakHours: 0,
        heatmaps: 0,
        total: 0
      };
    }
  },

  // Helper method to generate date-based cache keys
  _getDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  },

  // Health check for dashboard cache
  async dashboardHealthCheck() {
    try {
      const [cacheSize, isStale, lastSync] = await Promise.all([
        this.getDashboardCacheSize(),
        this.isDashboardCacheStale(),
        this.getDashboardLastSyncTime()
      ]);
      
      return {
        healthy: true,
        isStale,
        lastSync,
        cacheSize,
        totalCachedItems: cacheSize.total
      };
    } catch (error) {
      console.error('Error performing dashboard health check:', error);
      return {
        healthy: false,
        isStale: true,
        lastSync: null,
        cacheSize: { total: 0 },
        totalCachedItems: 0,
        error: error.message
      };
    }
  }
};

export default DashboardCache;
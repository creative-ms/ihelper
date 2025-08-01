// ===================================
// src/utils/cache/DashboardCache.js - Dashboard-specific cache utilities - PouchDB ONLY
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
        version: Date.now(),
        type: 'dashboard_stats'
      };

      // Get existing to preserve _rev for PouchDB
      try {
        const existing = await dashboardStatsDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document, no _rev needed
      }

      await dashboardStatsDB.put(cacheData);
      console.log(`✅ Dashboard stats cached for ${timeframe} (PouchDB)`);
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
        console.log(`⏰ Dashboard stats cache expired for ${timeframe}`);
        return null;
      }
      
      console.log(`📊 Retrieved cached dashboard stats for ${timeframe}`);
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
        version: Date.now(),
        type: 'chart_data'
      };

      try {
        const existing = await chartDataDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await chartDataDB.put(cacheData);
      console.log('✅ Chart data cached (PouchDB)');
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
        console.log('⏰ Chart data cache expired');
        return null;
      }
      
      console.log('📈 Retrieved cached chart data');
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
        version: Date.now(),
        type: 'product_analytics'
      };

      try {
        const existing = await productAnalyticsDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await productAnalyticsDB.put(cacheData);
      console.log(`✅ Product analytics cached for ${timeframe} (PouchDB)`);
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
        console.log(`⏰ Product analytics cache expired for ${timeframe}`);
        return null;
      }
      
      console.log(`🔍 Retrieved cached product analytics for ${timeframe}`);
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
        version: Date.now(),
        type: 'peak_hours'
      };

      try {
        const existing = await peakHoursDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await peakHoursDB.put(cacheData);
      console.log('✅ Peak hours data cached (PouchDB)');
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
        console.log('⏰ Peak hours cache expired');
        return null;
      }
      
      console.log('⏰ Retrieved cached peak hours data');
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
        version: Date.now(),
        type: 'heatmap_data'
      };

      try {
        const existing = await heatmapDataDB.get(cacheId);
        cacheData._rev = existing._rev;
      } catch (error) {
        // New document
      }

      await heatmapDataDB.put(cacheData);
      console.log('✅ Heatmap data cached (PouchDB)');
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
        console.log('⏰ Heatmap cache expired');
        return null;
      }
      
      console.log('🗺️ Retrieved cached heatmap data');
      return cached.heatmapData;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached heatmap data:', error);
      return null;
    }
  },

  // Check if dashboard cache is stale - PouchDB only check
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

  // Get dashboard last sync time from PouchDB metadata
  async getDashboardLastSyncTime() {
    try {
      const metadata = await dashboardMetadataDB.get('last_cache_update');
      return metadata ? new Date(metadata.timestamp) : null;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting dashboard last sync time:', error);
      return null;
    }
  },

  // Update dashboard cache timestamp (replaces sync metadata)
  async updateDashboardSyncTime() {
    try {
      const metadata = {
        _id: 'last_cache_update',
        timestamp: new Date().toISOString(),
        version: Date.now(),
        type: 'cache_metadata',
        source: 'pouchdb_only'
      };
      
      try {
        const existing = await dashboardMetadataDB.get('last_cache_update');
        metadata._rev = existing._rev;
      } catch (error) {
        // New document
      }
      
      await dashboardMetadataDB.put(metadata);
      console.log('✅ Dashboard cache timestamp updated (PouchDB)');
    } catch (error) {
      console.error('Error updating dashboard cache timestamp:', error);
    }
  },

  // Clear dashboard cache (for manual refresh) - PouchDB only
  async clearDashboardCache() {
    try {
      const databases = [
        { db: dashboardStatsDB, name: 'dashboard_stats' },
        { db: chartDataDB, name: 'chart_data' },
        { db: productAnalyticsDB, name: 'product_analytics' },
        { db: peakHoursDB, name: 'peak_hours' },
        { db: heatmapDataDB, name: 'heatmap_data' }
      ];
      
      const clearResults = await Promise.allSettled(databases.map(async ({ db, name }) => {
        try {
          const result = await db.allDocs({ include_docs: true });
          const docsToDelete = result.rows
            .filter(row => !row.doc._id.startsWith('_design'))
            .map(row => ({
              _id: row.doc._id,
              _rev: row.doc._rev,
              _deleted: true
            }));
          
          if (docsToDelete.length > 0) {
            await db.bulkDocs(docsToDelete);
            console.log(`🗑️ Cleared ${docsToDelete.length} documents from ${name}`);
          }
          
          return { database: name, cleared: docsToDelete.length, success: true };
        } catch (error) {
          console.error(`❌ Error clearing ${name}:`, error);
          return { database: name, cleared: 0, success: false, error: error.message };
        }
      }));
      
      const totalCleared = clearResults
        .filter(result => result.status === 'fulfilled' && result.value.success)
        .reduce((sum, result) => sum + result.value.cleared, 0);
      
      console.log(`✅ Dashboard cache cleared: ${totalCleared} total documents (PouchDB)`);
      
      // Update metadata to reflect cache clear
      await this.updateDashboardSyncTime();
      
      return { 
        success: true, 
        totalCleared,
        results: clearResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason })
      };
    } catch (error) {
      console.error('❌ Error clearing dashboard cache:', error);
      return { success: false, error: error.message };
    }
  },

  // Get dashboard cache size - PouchDB only
  async getDashboardCacheSize() {
    try {
      const databases = [
        { db: dashboardStatsDB, name: 'stats' },
        { db: chartDataDB, name: 'charts' },
        { db: productAnalyticsDB, name: 'analytics' },
        { db: peakHoursDB, name: 'peakHours' },
        { db: heatmapDataDB, name: 'heatmaps' }
      ];
      
      const sizeResults = await Promise.allSettled(databases.map(async ({ db, name }) => {
        try {
          const info = await db.info();
          const allDocs = await db.allDocs();
          const actualDocs = allDocs.rows.filter(row => !row.id.startsWith('_design')).length;
          
          return {
            name,
            docCount: actualDocs,
            diskSize: info.disk_size || 0,
            updateSeq: info.update_seq || 0
          };
        } catch (error) {
          console.error(`Error getting size for ${name}:`, error);
          return { name, docCount: 0, diskSize: 0, updateSeq: 0, error: error.message };
        }
      }));
      
      const results = sizeResults.reduce((acc, result) => {
        if (result.status === 'fulfilled') {
          const { name, docCount, diskSize, updateSeq } = result.value;
          acc[name] = docCount;
          acc.totalDiskSize = (acc.totalDiskSize || 0) + diskSize;
          acc.details = acc.details || {};
          acc.details[name] = { docCount, diskSize, updateSeq };
        }
        return acc;
      }, {});
      
      const totalDocs = Object.keys(results)
        .filter(key => !['total', 'totalDiskSize', 'details'].includes(key))
        .reduce((sum, key) => sum + (results[key] || 0), 0);
      
      results.total = totalDocs;
      
      console.log(`📊 Dashboard cache size: ${totalDocs} documents, ${Math.round((results.totalDiskSize || 0) / 1024)} KB`);
      
      return results;
    } catch (error) {
      console.error('Error getting dashboard cache size:', error);
      return { 
        stats: 0, charts: 0, analytics: 0, peakHours: 0, heatmaps: 0, 
        total: 0, totalDiskSize: 0, error: error.message 
      };
    }
  },

  // Batch cache multiple items efficiently
  async batchCacheItems(items) {
    if (!Array.isArray(items) || items.length === 0) return { success: true, cached: 0 };
    
    const results = await Promise.allSettled(items.map(async (item) => {
      const { type, timeframe, data } = item;
      
      switch (type) {
        case 'stats':
          return this.cacheDashboardStats(timeframe, data);
        case 'charts':
          return this.cacheChartData(data);
        case 'analytics':
          return this.cacheProductAnalytics(timeframe, data);
        case 'peakHours':
          return this.cachePeakHoursData(data);
        case 'heatmap':
          return this.cacheHeatmapData(data);
        default:
          throw new Error(`Unknown cache type: ${type}`);
      }
    }));
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - successful;
    
    console.log(`✅ Batch cached ${successful}/${results.length} items${failed > 0 ? ` (${failed} failed)` : ''}`);
    
    return { 
      success: failed === 0, 
      cached: successful, 
      failed,
      total: results.length 
    };
  },

  // Helper method to generate date-based cache keys
  _getDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  },

  // Health check for dashboard cache - PouchDB only
  async dashboardHealthCheck() {
    try {
      const [cacheSize, isStale, lastSync] = await Promise.all([
        this.getDashboardCacheSize(),
        this.isDashboardCacheStale(),
        this.getDashboardLastSyncTime()
      ]);
      
      // Check if all database connections are working
      const dbHealthChecks = await Promise.allSettled([
        dashboardStatsDB.info(),
        chartDataDB.info(),
        productAnalyticsDB.info(),
        peakHoursDB.info(),
        heatmapDataDB.info(),
        dashboardMetadataDB.info()
      ]);
      
      const healthyDbs = dbHealthChecks.filter(result => result.status === 'fulfilled').length;
      const totalDbs = dbHealthChecks.length;
      
      const isHealthy = healthyDbs === totalDbs && !cacheSize.error;
      
      return {
        healthy: isHealthy,
        isStale,
        lastSync,
        cacheSize,
        totalCachedItems: cacheSize.total || 0,
        databaseStatus: {
          healthy: healthyDbs,
          total: totalDbs,
          allHealthy: healthyDbs === totalDbs
        },
        storageMode: 'PouchDB-only',
        recommendations: this._getHealthRecommendations(isStale, cacheSize.total || 0)
      };
    } catch (error) {
      console.error('Error performing dashboard health check:', error);
      return {
        healthy: false,
        isStale: true,
        lastSync: null,
        cacheSize: { total: 0 },
        totalCachedItems: 0,
        error: error.message,
        storageMode: 'PouchDB-only'
      };
    }
  },

  // Helper to provide health recommendations
  _getHealthRecommendations(isStale, totalCachedItems) {
    const recommendations = [];
    
    if (isStale) {
      recommendations.push('Cache is stale - consider refreshing dashboard data');
    }
    
    if (totalCachedItems === 0) {
      recommendations.push('No cached data found - first dashboard load may be slower');
    } else if (totalCachedItems > 1000) {    
      recommendations.push('Large cache detected - consider clearing old cache entries');
    }
    
    return recommendations;
  },

  // Optimize cache by removing old entries
  async optimizeCache(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days default
    try {
      console.log('🔧 Starting cache optimization...');
      
      const databases = [
        { db: dashboardStatsDB, name: 'dashboard_stats' },
        { db: chartDataDB, name: 'chart_data' },
        { db: productAnalyticsDB, name: 'product_analytics' },
        { db: peakHoursDB, name: 'peak_hours' },
        { db: heatmapDataDB, name: 'heatmap_data' }
      ];
      
      let totalRemoved = 0;
      const cutoffDate = new Date(Date.now() - maxAge);
      
      for (const { db, name } of databases) {
        try {
          const result = await db.allDocs({ include_docs: true });
          const oldDocs = result.rows
            .filter(row => {
              if (row.doc._id.startsWith('_design')) return false;
              const docDate = new Date(row.doc.timestamp);
              return docDate < cutoffDate;
            })
            .map(row => ({
              _id: row.doc._id,
              _rev: row.doc._rev,
              _deleted: true
            }));
          
          if (oldDocs.length > 0) {
            await db.bulkDocs(oldDocs);
            totalRemoved += oldDocs.length;
            console.log(`🗑️ Removed ${oldDocs.length} old documents from ${name}`);
          }
        } catch (error) {
          console.error(`Error optimizing ${name}:`, error);
        }
      }
      
      console.log(`✅ Cache optimization complete: removed ${totalRemoved} old documents`);
      
      return { success: true, removedDocuments: totalRemoved };
    } catch (error) {
      console.error('Error optimizing cache:', error);
      return { success: false, error: error.message };
    }
  }
};

export default DashboardCache;
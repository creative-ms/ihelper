// src/utils/cache/index.js - Updated main entry point with sales and dashboard caching
import ProductCache from './ProductCache.js';
import BatchCache from './BatchCache.js';
import SearchCache from './SearchCache.js';
import StatsCache from './StatsCache.js';
import SyncCache from './SyncCache.js';
import PurchaseCache from './PurchaseCache.js';
import TransactionCache from './TransactionCache.js';
import SalesCache from './SalesCache.js'; // Add this import
import CacheUtilities from './CacheUtilities.js';
import DashboardCache from './DashboardCache.js';

const CacheManager = {
  ...ProductCache,
  ...BatchCache,
  ...SearchCache,
  ...StatsCache,
  ...SyncCache,
  ...PurchaseCache,
  ...TransactionCache,
  ...SalesCache, // Add sales cache methods
  ...CacheUtilities,
  ...DashboardCache
};

export default CacheManager;
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useInventoryStore } from '../stores/inventoryStore.js';
import { useProductStore } from '../stores/productStore.js';
import { applyInventoryFilters } from '../stores/inventory/inventoryFilters.js';
import StatCard from '../components/inventory/StatCard.jsx';
import InventoryTable from '../components/inventory/InventoryTable.jsx';
import FilterBar from '../components/inventory/FilterBar.jsx';
import EditBatchModal from '../components/inventory/EditBatchModal.jsx';
import SoldOutBatchesModal from '../components/inventory/SoldOutBatchesModal.jsx';
import Pagination from '../components/common/Pagination.jsx';
import {
  Search,
  ShoppingCart,
  Box,
  ArchiveX,
  AlertTriangle,
  CalendarClock,
  Clock,
  RefreshCw,
  Database,
  Wifi,
  WifiOff,
  CheckCircle,
  AlertCircle,
  Loader2,
  HardDrive,
  Zap,
  Activity
} from 'lucide-react';

// Debounce hook for search optimization
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Memoized Cache Status Component
const CacheStatusIndicator = React.memo(({ 
  cacheStats, 
  isLoading, 
  lastSyncTime, 
  onRefresh, 
  isRefreshing, 
  isOnline 
}) => {
  const [showDetails, setShowDetails] = useState(false);
  
  const getCacheStatusColor = useCallback(() => {
    if (isLoading) return 'text-blue-500';
    if (cacheStats?.isStale) return 'text-orange-500';
    if (cacheStats?.healthy) return 'text-green-500';
    return 'text-gray-500';
  }, [isLoading, cacheStats]);

  const getCacheStatusText = useCallback(() => {
    if (isLoading) return 'Syncing...';
    if (cacheStats?.isStale) return 'Cache Stale';
    if (cacheStats?.healthy) return 'Cache Fresh';
    return 'No Cache';
  }, [isLoading, cacheStats]);

  const formatBytes = useCallback((bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const formatTime = useCallback((date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  }, []);

  const handleRefreshClick = useCallback((e) => {
    e.stopPropagation();
    onRefresh();
  }, [onRefresh]);

  const toggleDetails = useCallback(() => {
    setShowDetails(prev => !prev);
  }, []);

  return (
    <div className="relative">
      <div 
        className="flex items-center space-x-3 bg-white dark:bg-dark-secondary rounded-xl px-4 py-3 shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer hover:shadow-md transition-all duration-200"
        onClick={toggleDetails}
      >
        <div className={`p-2 rounded-lg ${getCacheStatusColor()} bg-opacity-10`}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : cacheStats?.isStale ? (
            <AlertCircle className="h-4 w-4" />
          ) : cacheStats?.healthy ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <Database className="h-4 w-4" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className={`text-sm font-medium ${getCacheStatusColor()}`}>
              {getCacheStatusText()}
            </span>
            {isLoading && (
              <div className="flex items-center space-x-1 text-xs text-slate-500 dark:text-slate-400">
                <Activity className="h-3 w-3 animate-pulse" />
                <span>Updating inventory...</span>
              </div>
            )}
          </div>
          
          {lastSyncTime && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Last sync: {formatTime(lastSyncTime)}
            </p>
          )}
        </div>

        <button
          onClick={handleRefreshClick}
          disabled={isRefreshing}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          title="Refresh Cache"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {showDetails && (
        <div className="absolute top-full mt-2 right-0 w-80 bg-white dark:bg-dark-secondary rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-dark-text">
                Cache Status
              </h3>
              <button
                onClick={() => setShowDetails(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {isOnline ? (
                    <Wifi className="h-4 w-4 text-green-500" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-red-500" />
                  )}
                  <span className="text-sm text-slate-600 dark:text-slate-300">Connection</span>
                </div>
                <span className={`text-sm font-medium ${
                  isOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              {cacheStats && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <HardDrive className="h-4 w-4 text-blue-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-300">Cache Size</span>
                  </div>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {formatBytes(cacheStats.totalSize || 0)}
                  </span>
                </div>
              )}

              {cacheStats && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Box className="h-4 w-4 text-purple-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-300">Products</span>
                  </div>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {cacheStats.productsCount || 0}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Zap className="h-4 w-4 text-orange-500" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">Sync Status</span>
                </div>
                <span className={`text-sm font-medium ${
                  isLoading ? 'text-blue-600' : 
                  cacheStats?.isStale ? 'text-orange-600' : 'text-green-600'
                }`}>
                  {isLoading ? 'Syncing' : cacheStats?.isStale ? 'Stale' : 'Fresh'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">Last Sync</span>
                </div>
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {formatTime(lastSyncTime)}
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center space-x-2">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Performance</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {cacheStats?.isStale ? 'Needs Update' : 'Optimized'}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        cacheStats?.isStale ? 'bg-orange-500 w-3/4' : 'bg-green-500 w-full'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// Memoized Sync Status Bar
const SyncStatusBar = React.memo(({ isLoading, error, onDismissError }) => {
  if (!isLoading && !error) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 ${
      error ? 'bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800' :
      'bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800'
    }`}>
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {error ? (
              <AlertTriangle className="h-5 w-5 text-red-500" />
            ) : (
              <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
            )}
            <span className={`text-sm font-medium ${
              error ? 'text-red-700 dark:text-red-300' : 'text-blue-700 dark:text-blue-300'
            }`}>
              {error || 'Syncing inventory data...'}
            </span>
          </div>
          
          {error && (
            <button
              onClick={onDismissError}
              className="text-red-500 hover:text-red-700 dark:hover:text-red-300"
            >
              <span className="sr-only">Dismiss</span>
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

const InventoryPage = () => {
  // Fixed: Use the correct function name from your store
  const { 
    inventory, 
    stats, 
    isLoading, 
    isOnline,
    initialize, // Use initialize instead of initializeFromCache
    fetchFromRemote, // Use fetchFromRemote instead of fetchInventory
    forceSync, // Use forceSync instead of syncWithDatabase
    getProductById, // For getting individual products
    getRecentlySoldOutBatches, // You'll need to implement this if it doesn't exist
    getConnectionStatus, // For getting cache stats and sync time
    error 
  } = useInventoryStore();
  
  const { updateProduct } = useProductStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({});
  const [editingModalData, setEditingModalData] = useState({ product: null, batch: null });
  const [isSoldOutModalOpen, setIsSoldOutModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheStats, setCacheStats] = useState(null);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const cacheStatsIntervalRef = useRef(null);
  const itemsPerPage = 50;

  // Fixed: Use the correct initialization function
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Fixed: Update cache stats using the available store methods
  useEffect(() => {
    const updateCacheStats = async () => {
      try {
        const connectionStatus = getConnectionStatus();
        
        // Create mock cache stats based on available data
        const mockCacheStats = {
          healthy: connectionStatus.isInitialized && !connectionStatus.error,
          isStale: !connectionStatus.lastSyncTime || 
                   (new Date() - new Date(connectionStatus.lastSyncTime)) > (2 * 60 * 60 * 1000), // 2 hours
          productsCount: inventory.length,
          totalSize: inventory.length * 1024, // Rough estimate
        };
        
        setCacheStats(mockCacheStats);
        setLastSyncTime(connectionStatus.lastSyncTime);
      } catch (error) {
        console.error('Error fetching cache stats:', error);
        setCacheStats({
          healthy: false,
          isStale: true,
          productsCount: 0,
          totalSize: 0
        });
      }
    };

    updateCacheStats();
    cacheStatsIntervalRef.current = setInterval(updateCacheStats, 30000);

    return () => {
      if (cacheStatsIntervalRef.current) {
        clearInterval(cacheStatsIntervalRef.current);
      }
    };
  }, [getConnectionStatus, inventory.length]);

  const filteredInventory = useMemo(() => {
    let result = inventory;

    if (debouncedSearchTerm) {
      const term = debouncedSearchTerm.toLowerCase();
      result = result.filter(p =>
        p.name?.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term) ||
        p.category?.toLowerCase().includes(term)
      );
    }

    if (Object.keys(filters).length > 0) {
      result = applyInventoryFilters(result, filters);
    }

    return result;
  }, [inventory, debouncedSearchTerm, filters]);
  
  // Fixed: Create a fallback for recently sold out batches
  const recentlySoldOutBatches = useMemo(() => {
    try {
      // If the function exists, use it
      if (typeof getRecentlySoldOutBatches === 'function') {
        return getRecentlySoldOutBatches();
      }
      
      // Otherwise, create a fallback implementation
      const soldOutBatches = [];
      const now = new Date();
      const recentThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      
      inventory.forEach(product => {
        if (product.batches && Array.isArray(product.batches)) {
          product.batches.forEach(batch => {
            if (batch.quantity === 0 && 
                batch.soldOutAt && 
                new Date(batch.soldOutAt) >= recentThreshold) {
              soldOutBatches.push({
                ...batch,
                productName: product.name,
                productId: product._id
              });
            }
          });
        }
      });
      
      return soldOutBatches;
    } catch (error) {
      console.error('Error getting recently sold out batches:', error);
      return [];
    }
  }, [inventory, getRecentlySoldOutBatches]);

  const { totalPages, currentItems } = useMemo(() => {
    const totalPages = Math.ceil(filteredInventory.length / itemsPerPage);
    const currentItems = filteredInventory.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );
    return { totalPages, currentItems };
  }, [filteredInventory, currentPage, itemsPerPage]);

  const statCardsData = useMemo(() => [
    { title: 'Total Products', value: stats.totalProducts || 0, icon: Box, color: 'blue' },
    { title: 'Out of Stock', value: stats.outOfStock || 0, icon: ArchiveX, color: 'red' },
    { title: 'Low Stock', value: stats.lowStock || 0, icon: AlertTriangle, color: 'yellow' },
    { title: 'Expired', value: stats.expired || 0, icon: CalendarClock, color: 'purple' },
    { title: 'Expiring Soon', value: stats.expiringSoon || 0, icon: Clock, color: 'orange' },
  ], [stats]);

  const soldOutCard = useMemo(() => ({
    title: 'Recently Sold Out',
    value: recentlySoldOutBatches.length || 0,
    icon: ShoppingCart,
    color: 'gray',
    onClick: () => setIsSoldOutModalOpen(true)
  }), [recentlySoldOutBatches.length]);

  const handleSearchChange = useCallback((e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  }, []);

  const handleFiltersChange = useCallback((newFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  }, []);

  const handleOpenEditModal = useCallback((product, batch) => {
    setEditingModalData({ product, batch });
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setEditingModalData({ product: null, batch: null });
  }, []);

  const handleSaveBatch = useCallback(async (updatedBatch) => {
    if (editingModalData.product) {
      const productToUpdate = { ...editingModalData.product };
      const batchIndex = productToUpdate.batches.findIndex(b => b.id === updatedBatch.id);
      if (batchIndex !== -1) {
        productToUpdate.batches[batchIndex] = updatedBatch;
        
        try {
          // Update using the store's updateProduct method
          await updateProduct(productToUpdate._id, { batches: productToUpdate.batches });
          handleCloseEditModal();
        } catch (error) {
          console.error('Error updating product:', error);
        }
      }
    }
  }, [editingModalData.product, updateProduct, handleCloseEditModal]);

  // Fixed: Use the correct sync function
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await forceSync();
      
      // Update cache stats after sync
      const connectionStatus = getConnectionStatus();
      const mockCacheStats = {
        healthy: connectionStatus.isInitialized && !connectionStatus.error,
        isStale: false, // Just synced, so not stale
        productsCount: inventory.length,
        totalSize: inventory.length * 1024,
      };
      
      setCacheStats(mockCacheStats);
      setLastSyncTime(connectionStatus.lastSyncTime);
    } catch (error) {
      console.error('Error refreshing inventory:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [forceSync, getConnectionStatus, inventory.length]);

  const handleDismissError = useCallback(() => {
    setShowErrorDetails(false);
  }, []);

  const handlePageChange = useCallback((page) => {
    setCurrentPage(page);
  }, []);

  if (isLoading && inventory.length === 0) {
    return (
      <div className="flex justify-center items-center h-full dark:text-white">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          <p>Loading Inventory...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SyncStatusBar 
        isLoading={isLoading && inventory.length === 0} 
        error={error && showErrorDetails ? error : null}
        onDismissError={handleDismissError}
      />

      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-dark-text">
            Inventory Management
          </h1>
          <p className="text-slate-500 dark:text-dark-text-secondary">
            Track stock levels, expirations, and more.
          </p>
        </div>
        
        <CacheStatusIndicator 
          cacheStats={cacheStats}
          isLoading={isLoading}
          lastSyncTime={lastSyncTime}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          isOnline={isOnline}
        />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-5">
        {statCardsData.map(card => (
          <StatCard key={card.title} {...card} />
        ))}
        <div onClick={soldOutCard.onClick} className="cursor-pointer">
          <StatCard {...soldOutCard} />
        </div>
      </div>

      <FilterBar 
        inventory={inventory} 
        onFiltersChange={handleFiltersChange}
        activeFilters={filters}
      />

      <div className="bg-white dark:bg-dark-secondary rounded-2xl shadow-lg p-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 dark:text-dark-text-secondary" />
            <input
              type="text"
              placeholder="Search products by name, SKU, or barcode..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full pl-12 pr-4 py-2.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-dark-primary rounded-lg text-slate-800 dark:text-dark-text focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />
          </div>
          
          {isLoading && inventory.length > 0 && (
            <div className="flex items-center space-x-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                Updating inventory data...
              </span>
            </div>
          )}
        </div>

        {(debouncedSearchTerm || Object.keys(filters).length > 0) && (
          <div className="mb-4 px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Found {filteredInventory.length} products
              {debouncedSearchTerm && ` matching "${debouncedSearchTerm}"`}
              {Object.keys(filters).length > 0 && ` with ${Object.keys(filters).length} filter(s) applied`}
            </p>
          </div>
        )}

        {filteredInventory.length === 0 && !isLoading ? (
          <div className="text-center py-12">
            <Box className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
            <h3 className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              {debouncedSearchTerm || Object.keys(filters).length > 0 ? 'No products found' : 'No inventory data'}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {debouncedSearchTerm || Object.keys(filters).length > 0 
                ? 'Try adjusting your search terms or filters' 
                : 'Start by adding some products to your inventory'
              }
            </p>
          </div>
        ) : (
          <>
            <InventoryTable products={currentItems} onEditBatch={handleOpenEditModal} />

            {totalPages > 1 && (
              <div className="mt-6">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </>
        )}
      </div>

      <EditBatchModal
        isOpen={!!editingModalData.batch}
        onClose={handleCloseEditModal}
        batch={editingModalData.batch}
        onSave={handleSaveBatch}
      />

      <SoldOutBatchesModal
        isOpen={isSoldOutModalOpen}
        onClose={() => setIsSoldOutModalOpen(false)}
        batches={recentlySoldOutBatches}
      />
    </div>
  );
};

export default InventoryPage;
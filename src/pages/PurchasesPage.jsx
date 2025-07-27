// src/pages/PurchasesPage.jsx - Updated with proper lifecycle integration
import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from 'react';
import { usePurchaseStore } from '../stores/purchaseStore.js';
import { useAuthStore } from '../stores/authStore.js';
import PurchasesHeader from '../components/purchases/PurchasesHeader.jsx';
import PurchasesControls from '../components/purchases/PurchasesControls.jsx';
import PurchasesTable from '../components/purchases/PurchasesTable.jsx';
import PurchasesModals from '../components/purchases/PurchasesModals.jsx';
import { usePurchasesLogic } from '../hooks/usePurchasesLogic.js';

// Constants for performance optimization
const PERFORMANCE_CONFIG = {
  ITEMS_PER_PAGE: 20,
  SEARCH_DEBOUNCE: 300,
  REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes
  CACHE_STALE_TIME: 2 * 60 * 1000, // 2 minutes
};

// Error boundary component
class PurchasesErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('PurchasesPage Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center p-8">
            <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
              Something went wrong
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              There was an error loading the purchases page.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Loading component
const PageSkeleton = React.memo(() => (
  <div className="space-y-6">
    <div className="h-16 bg-slate-200 dark:bg-slate-700 rounded-2xl animate-pulse"></div>
    <div className="bg-white dark:bg-dark-secondary rounded-2xl shadow-sm border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
      <div className="h-20 bg-slate-100 dark:bg-slate-800 animate-pulse"></div>
      <div className="p-6 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
        ))}
      </div>
    </div>
  </div>
));

PageSkeleton.displayName = 'PageSkeleton';

// Performance monitor component (development only)
const PerformanceMonitor = React.memo(({ performanceMetrics, initializationStatus }) => {
  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <div className="text-xs text-slate-500 dark:text-slate-400 p-2 bg-slate-100 dark:bg-slate-800 rounded mb-4">
      <div className="flex flex-wrap gap-4">
        <span>Status: {initializationStatus.isInitialized ? '✅ Ready' : '⏳ Initializing'}</span>
        <span>Total: {performanceMetrics.totalPurchases}</span>
        <span>Filtered: {performanceMetrics.filteredCount}</span>
        <span>Cache: {performanceMetrics.cacheHits}H/{performanceMetrics.cacheMisses}M</span>
        {!performanceMetrics.isOptimalLoad && <span className="text-amber-600">⚠️ Large dataset</span>}
        {initializationStatus.backgroundRefreshActive && <span className="text-blue-600">🔄 Syncing</span>}
      </div>
    </div>
  );
});

PerformanceMonitor.displayName = 'PerformanceMonitor';

// Connection status indicator
const ConnectionStatus = React.memo(({ status, lastFetchTime }) => {
  const getStatusInfo = () => {
    switch (status) {
      case 'connected':
        return { 
          color: 'text-green-500', 
          icon: '●', 
          text: 'Connected' 
        };
      case 'disconnected':
        return { 
          color: 'text-red-500', 
          icon: '●', 
          text: 'Disconnected' 
        };
      default:
        return { 
          color: 'text-yellow-500', 
          icon: '●', 
          text: 'Connecting...' 
        };
    }
  };

  const { color, icon, text } = getStatusInfo();
  const lastUpdate = lastFetchTime ? 
    new Date(lastFetchTime).toLocaleTimeString() : 'Never';

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className={color}>{icon}</span>
      <span>{text}</span>
      <span>•</span>
      <span>Last update: {lastUpdate}</span>
    </div>
  );
});

ConnectionStatus.displayName = 'ConnectionStatus';

// Main component
const PurchasesPageContent = React.memo(() => {
  // 🔥 LIFECYCLE MANAGEMENT - Initialize/deactivate purchase page
  const { 
    purchases, 
    isLoading,
    lastFetchTime,
    backgroundRefreshActive,
    connectionStatus,
    performanceMetrics,
    isInitialized,
    initializationError,
    // Methods
    initializePurchasePage,
    deactivatePurchasePage,
    fetchPurchases,
    returnPurchase,
    backgroundRefresh,
    getPerformanceMetrics
  } = usePurchaseStore();
  
  const { privileges } = useAuthStore();
  const initializeCallRef = useRef(false);
  const [localError, setLocalError] = useState(null);

  // 🔥 LIFECYCLE HOOKS - Initialize on mount, cleanup on unmount
  useEffect(() => {
    let mounted = true;
    
    const initializePage = async () => {
      if (initializeCallRef.current) return;
      initializeCallRef.current = true;
      
      try {
        setLocalError(null);
        await initializePurchasePage();
      } catch (error) {
        console.error('Failed to initialize purchases page:', error);
        if (mounted) {
          setLocalError(error.message || 'Failed to initialize page');
        }
      }
    };

    initializePage();

    // Cleanup on unmount
    return () => {
      mounted = false;
      if (initializeCallRef.current) {
        deactivatePurchasePage();
        initializeCallRef.current = false;
      }
    };
  }, [initializePurchasePage, deactivatePurchasePage]);

  // Enhanced performance metrics with lifecycle info
  const enhancedPerformanceMetrics = useMemo(() => {
    const baseMetrics = getPerformanceMetrics?.() || performanceMetrics || {};
    
    return {
      totalPurchases: purchases.length,
      filteredCount: purchases.length, // Will be updated by logic hook
      loadTime: lastFetchTime ? Date.now() - lastFetchTime : 0,
      isOptimalLoad: purchases.length <= PERFORMANCE_CONFIG.ITEMS_PER_PAGE * 5,
      ...baseMetrics
    };
  }, [purchases.length, lastFetchTime, performanceMetrics, getPerformanceMetrics]);

  // Initialization status for UI feedback
  const initializationStatus = useMemo(() => ({
    isInitialized,
    hasError: !!initializationError || !!localError,
    errorMessage: initializationError || localError,
    backgroundRefreshActive,
    connectionStatus
  }), [isInitialized, initializationError, localError, backgroundRefreshActive, connectionStatus]);

  // Performance optimization: Memoize expensive computations
  const {
    // States
    modals,
    view,
    currentPage,
    appliedFilters,
    quickSearch,
    returnDetails,
    cacheStatus,
    isRefreshing,
    
    // Computed values (already memoized in the hook)
    filteredPurchases,
    currentItems,
    totalPages,
    activeFiltersCount,
    
    // Handlers (already memoized in the hook)
    openModal,
    closeModal,
    setView,
    setCurrentPage,
    setQuickSearch,
    handleRefresh,
    handleApplyFilters,
    handleClearFilters,
    handleProceedToRefund,
    handleFinalConfirm
  } = usePurchasesLogic(purchases, fetchPurchases, returnPurchase);

  // Update performance metrics with filtered count
  useEffect(() => {
    enhancedPerformanceMetrics.filteredCount = filteredPurchases.length;
  }, [filteredPurchases.length, enhancedPerformanceMetrics]);

  // Enhanced refresh handler that respects lifecycle
  const handleLifecycleAwareRefresh = useCallback(async () => {
    if (!isInitialized) {
      console.warn('Cannot refresh: Page not initialized');
      return;
    }
    
    try {
      await handleRefresh();
    } catch (error) {
      console.error('Refresh failed:', error);
      setLocalError('Failed to refresh data');
    }
  }, [handleRefresh, isInitialized]);

  // Auto-refresh logic for live data with lifecycle awareness
  useEffect(() => {
    if (!isInitialized) return;

    let refreshInterval;
    
    const shouldAutoRefresh = () => {
      if (!lastFetchTime) return true;
      return Date.now() - lastFetchTime > PERFORMANCE_CONFIG.REFRESH_INTERVAL;
    };

    const setupAutoRefresh = () => {
      if (document.visibilityState === 'visible' && shouldAutoRefresh() && isInitialized) {
        backgroundRefresh?.();
      }
    };

    // Setup interval for background refresh
    refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && isInitialized) {
        backgroundRefresh?.();
      }
    }, PERFORMANCE_CONFIG.REFRESH_INTERVAL);

    // Listen for page visibility changes
    document.addEventListener('visibilitychange', setupAutoRefresh);

    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', setupAutoRefresh);
    };
  }, [backgroundRefresh, lastFetchTime, isInitialized]);

  // Memoized handlers to prevent unnecessary re-renders
  const handleOpenFilter = useCallback(() => openModal('filter'), [openModal]);
  const handleOpenReturn = useCallback(() => openModal('returnPurchase'), [openModal]);
  const handleOpenAdd = useCallback(() => openModal('addPurchase'), [openModal]);
  const handleViewPurchase = useCallback((purchase) => openModal('viewPurchase', purchase), [openModal]);

  // Error state rendering
  if (initializationStatus.hasError) {
    return (
      <div className="min-h-96 flex items-center justify-center">
        <div className="text-center p-8">
          <h3 className="text-xl font-semibold text-red-600 dark:text-red-400 mb-2">
            Initialization Error
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            {initializationStatus.errorMessage}
          </p>
          <button
            onClick={() => {
              setLocalError(null);
              window.location.reload();
            }}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Loading state during initialization
  if (!initializationStatus.isInitialized) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-slate-600 dark:text-slate-400">Initializing purchases...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Performance Monitor - Development only */}
      <PerformanceMonitor 
        performanceMetrics={enhancedPerformanceMetrics}
        initializationStatus={initializationStatus}
      />

      {/* Connection Status */}
      <div className="flex justify-between items-start">
        <ConnectionStatus 
          status={connectionStatus}
          lastFetchTime={lastFetchTime}
        />
        
        {/* Quick stats */}
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {purchases.length} purchases loaded
          {activeFiltersCount > 0 && ` • ${filteredPurchases.length} filtered`}
        </div>
      </div>

      {/* Header Section - Enhanced with lifecycle status */}
      <PurchasesHeader 
        cacheStatus={cacheStatus}
        isRefreshing={isRefreshing || backgroundRefreshActive}
        onRefresh={handleLifecycleAwareRefresh}
        onOpenFilter={handleOpenFilter}
        onOpenReturn={handleOpenReturn}
        onOpenAdd={handleOpenAdd}
        activeFiltersCount={activeFiltersCount}
        privileges={privileges}
        connectionStatus={connectionStatus}
        isInitialized={isInitialized}
      />

      {/* Main Content */}
      <div className="bg-white dark:bg-dark-secondary rounded-2xl shadow-sm border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {/* Controls Section - Optimized for frequent updates */}
        <PurchasesControls
          quickSearch={quickSearch}
          onSearchChange={setQuickSearch}
          view={view}
          onViewChange={setView}
          activeFiltersCount={activeFiltersCount}
          filteredCount={filteredPurchases.length}
          onClearFilters={handleClearFilters}
          isInitialized={isInitialized}
        />
        
        {/* Table - Enhanced with lifecycle awareness */}
        <PurchasesTable
          currentItems={currentItems}
          isLoading={isLoading}
          activeFiltersCount={activeFiltersCount}
          onClearFilters={handleClearFilters}
          onViewPurchase={handleViewPurchase}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          performanceMode={!enhancedPerformanceMetrics.isOptimalLoad}
          isInitialized={isInitialized}
          connectionStatus={connectionStatus}
        />
      </div>
      
      {/* Modals - Enhanced with initialization check */}
      <PurchasesModals
        modals={modals}
        returnDetails={returnDetails}
        appliedFilters={appliedFilters}
        onCloseModal={closeModal}
        onApplyFilters={handleApplyFilters}
        onProceedToRefund={handleProceedToRefund}
        onFinalConfirm={handleFinalConfirm}
        isInitialized={isInitialized}
      />
    </div>
  );
});

PurchasesPageContent.displayName = 'PurchasesPageContent';

// Main component with error boundary and suspense
const PurchasesPage = React.memo(() => {
  return (
    <PurchasesErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>
        <PurchasesPageContent />
      </Suspense>
    </PurchasesErrorBoundary>
  );
});

// Display name for debugging
PurchasesPage.displayName = 'PurchasesPage';

export default PurchasesPage;
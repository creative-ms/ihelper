// src/pages/Dashboard.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import { useSalesStore } from '../stores/salesStore';
import DashboardStatsGrid from '../components/dashboard/DashboardStatsGrid';
import SalesTrendChart from '../components/dashboard/SalesTrendChart';
import PeakHoursHeatmap from '../components/dashboard/PeakHoursHeatmap';
import CashflowHeatmap from '../components/dashboard/CashflowHeatmap';
import CustomDateRangeModal from '../components/dashboard/CustomDateRangeModal';
import ProductPerformanceDashboard from '../components/dashboard/ProductPerformanceDashboard';
import { Calendar, Activity, RefreshCw, Zap, TrendingUp, Package, BarChart3, Clock } from 'lucide-react';

// Loading skeleton component
const LoadingSkeleton = () => (
  <div className="space-y-8 animate-pulse">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      ))}
    </div>
    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded"></div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>
    </div>
  </div>
);

// Performance indicator component
const PerformanceIndicator = ({ fetchDuration, lastFetch }) => {
  if (!fetchDuration) return null;
  
  const isRecent = lastFetch && (Date.now() - lastFetch) < 60000;
  const isSlowLoad = fetchDuration > 2000;
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
      isSlowLoad 
        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700' 
        : 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-700'
    }`}>
      <Zap className="h-3 w-3" />
      <span>{fetchDuration}ms</span>
      {isRecent && <span className="text-xs opacity-70 hidden md:inline">• just now</span>}
    </div>
  );
};

// Tab Navigation Component
const TabNavigation = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'products', label: 'Products', icon: Package }
  ];

  return (
    <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-900/50 p-1 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === id
              ? 'bg-white dark:bg-gray-700 text-sky-600 dark:text-sky-400 shadow-sm border border-sky-200 dark:border-sky-500/30'
              : 'text-gray-600 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-gray-800/50'
          }`}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
};

// Time Controls Component
const TimeControls = ({ 
  timeframe, 
  onTimeframeChange, 
  onCustomDateOpen, 
  onRefresh, 
  isRefreshing 
}) => {
  const timeButtons = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' }
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Time Range Buttons */}
      <div className="flex items-center bg-gray-50 dark:bg-gray-900/50 p-1 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600">
        {timeButtons.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onTimeframeChange(value)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              timeframe === value 
                ? 'bg-white dark:bg-gray-700 text-sky-600 dark:text-sky-400 shadow-sm border border-sky-200 dark:border-sky-500/30' 
                : 'text-gray-600 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-gray-800/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      
      {/* Custom Date Button */}
      <button 
        onClick={onCustomDateOpen}
        className="flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-700 text-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 text-sm font-medium border border-sky-600 dark:border-sky-500"
      >
        <Calendar className="h-4 w-4" />
        <span className="hidden sm:inline">Custom</span>
      </button>
      
      {/* Refresh Button */}
      <button 
        onClick={onRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium border border-emerald-600 dark:border-emerald-500"
      >
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
      </button>
    </div>
  );
};

// 🔥 NEW: Dashboard initialization hook
const useDashboardInitialization = () => {
  const initializeDashboard = useDashboardStore(state => state.initializeDashboard);
  const deactivateDashboard = useDashboardStore(state => state.deactivateDashboard);
  const isInitialized = useDashboardStore(state => state.isInitialized);

  useEffect(() => {
    // Initialize dashboard when component mounts
    console.log('🚀 Dashboard component mounted, initializing...');
    initializeDashboard();

    // Cleanup when component unmounts
    return () => {
      console.log('🛑 Dashboard component unmounting, deactivating...');
      deactivateDashboard();
    };
  }, [initializeDashboard, deactivateDashboard]);

  return isInitialized;
};

// 🔥 UPDATED: Enhanced cache status with new optimized store features
const EnhancedCacheStatus = ({ cacheStatus, activeTab }) => {
  if (!cacheStatus || activeTab !== 'overview') return null;

  const { traditional, enhanced, isDashboardActive, enhancedCacheAvailable } = cacheStatus;

  if (!traditional?.hasCache && !enhanced?.healthy) return null;

  return (
    <div className="flex items-center gap-4">
      {/* Traditional Cache Status */}
      {traditional?.hasCache && !traditional?.isExpired && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-full border border-green-200 dark:border-green-700">
          <div className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full"></div>
          <span className="hidden lg:inline">
            Cached ({Math.round(traditional.cacheAge / 1000)}s ago)
          </span>
          <span className="lg:hidden">Cached</span>
        </div>
      )}

      {/* Enhanced Cache Status */}
      {enhancedCacheAvailable && enhanced?.healthy && (
        <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full border border-blue-200 dark:border-blue-700">
          <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full animate-pulse"></div>
          <span className="hidden lg:inline">Enhanced Cache Active</span>
          <span className="lg:hidden">Enhanced</span>
        </div>
      )}

      {/* Dashboard Status Indicator */}
      {isDashboardActive && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-700">
          <div className="w-2 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full"></div>
          <span className="hidden lg:inline">Active</span>
        </div>
      )}
    </div>
  );
};

const DashboardPage = () => {
  // 🔥 UPDATED: Use new dashboard initialization hook
  const isInitialized = useDashboardInitialization();

  const { 
    stats, 
    isLoading, 
    error, 
    fetchDashboardData, 
    refreshData,
    setTimeframe, 
    setCustomDateRange, 
    timeframe,
    fetchDuration,
    lastFetch,
    getCacheStatus,
    productPerformance,
    isLoadingProducts,
    productError
  } = useDashboardStore();
  
  const { sales, fetchSales } = useSalesStore();
  
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [cacheStatus, setCacheStatus] = useState(null);

  // 🔥 UPDATED: Get cache status with new enhanced features
  useEffect(() => {
    const updateCacheStatus = async () => {
      try {
        const status = await getCacheStatus();
        setCacheStatus(status);
      } catch (error) {
        console.error('Error getting cache status:', error);
        setCacheStatus(null);
      }
    };

    if (isInitialized) {
      updateCacheStatus();
      const interval = setInterval(updateCacheStatus, 5000); // Update every 5 seconds
      return () => clearInterval(interval);
    }
  }, [getCacheStatus, isInitialized]);

  // 🔥 UPDATED: Only fetch sales data after dashboard is initialized
  useEffect(() => {
    if (isInitialized) {
      fetchSales();
    }
  }, [fetchSales, isInitialized]);

  const handleTimeframeChange = useCallback((newTimeframe) => {
    if (!isInitialized) return;
    setTimeframe(newTimeframe);
  }, [setTimeframe, isInitialized]);

  const handleCustomDateRange = useCallback((start, end) => {
    if (!isInitialized) return;
    setCustomDateRange(start, end);
    setIsDatePickerOpen(false);
  }, [setCustomDateRange, isInitialized]);

  const handleRefresh = useCallback(async () => {
    if (!isInitialized) return;
    
    setIsRefreshing(true);
    await Promise.all([
      refreshData(),
      fetchSales()
    ]);
    setIsRefreshing(false);
  }, [refreshData, fetchSales, isInitialized]);

  const headerContent = useMemo(() => (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-sky-500/3 via-transparent to-emerald-500/3 dark:from-sky-400/5 dark:via-transparent dark:to-emerald-400/5 pointer-events-none"></div>
      
      <div className="relative p-6">
        {/* Header Title Section */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-sky-500 to-emerald-600 dark:from-sky-400 dark:to-emerald-500 rounded-xl shadow-lg border border-sky-200 dark:border-sky-600">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Business Dashboard
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                Real-time insights into your business performance
              </p>
            </div>
          </div>
          
          {/* Right side indicators */}
          <div className="flex items-center gap-4">
            <PerformanceIndicator fetchDuration={fetchDuration} lastFetch={lastFetch} />
            <EnhancedCacheStatus cacheStatus={cacheStatus} activeTab={activeTab} />
          </div>
        </div>
        
        {/* Navigation and Controls Section */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Left side - Tab Navigation */}
          <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
          
          {/* Right side - Controls */}
          <div className="flex items-center gap-3">
            {activeTab === 'overview' ? (
              <TimeControls
                timeframe={timeframe}
                onTimeframeChange={handleTimeframeChange}
                onCustomDateOpen={() => setIsDatePickerOpen(true)}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
              />
            ) : (
              <button 
                onClick={handleRefresh}
                disabled={isRefreshing || !isInitialized}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium border border-emerald-600 dark:border-emerald-500"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ), [
    fetchDuration, 
    lastFetch, 
    handleRefresh, 
    isRefreshing, 
    cacheStatus,
    activeTab,
    timeframe,
    handleTimeframeChange,
    isInitialized
  ]);

  // 🔥 UPDATED: Show initialization status
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-gray-950 dark:via-gray-900 dark:to-gray-800 p-4 lg:p-6">
        <div className="max-w-screen-2xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Initializing Dashboard
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Setting up optimized data processing and cache systems...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (isLoading) {
      return <LoadingSkeleton />;
    }

    if (error) {
      return (
        <div className="text-center py-20">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
            <div className="text-red-500 dark:text-red-400 text-lg font-semibold mb-4">{error}</div>
            <button 
              onClick={handleRefresh}
              disabled={!isInitialized}
              className="px-6 py-3 bg-sky-500 hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-700 text-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-sky-600 dark:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    if (activeTab === 'products') {
      // Show product-specific loading state
      if (isLoadingProducts) {
        return (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading product performance data...</p>
            </div>
          </div>
        );
      }

      // Show product-specific error
      if (productError) {
        return (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-8 text-center">
              <div className="text-red-500 dark:text-red-400 text-lg font-semibold mb-4">{productError}</div>
              <button 
                onClick={handleRefresh}
                disabled={!isInitialized}
                className="px-6 py-3 bg-sky-500 hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-700 text-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-sky-600 dark:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Retry Product Analysis
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <ProductPerformanceDashboard 
            salesData={sales} 
            productPerformanceData={productPerformance}
            isLoading={isLoadingProducts}
            error={productError}
          />
        </div>
      );
    }

    return (
      <>
        {/* Stats Grid */}
        <DashboardStatsGrid stats={stats} />
        
        {/* Sales Trend Chart - Full Width */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-green-600 dark:from-emerald-400 dark:to-green-500 rounded-xl shadow-lg border border-emerald-200 dark:border-emerald-600">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    Sales Trend Analysis
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Revenue & sales performance over time
                  </p>
                </div>
              </div>
            </div>
            <div className="relative">
              <SalesTrendChart />
            </div>
          </div>
        </div>
        
        {/* Heatmaps Grid - Side by Side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Peak Hours Heatmap */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-gradient-to-br from-purple-500 to-indigo-600 dark:from-purple-400 dark:to-indigo-500 rounded-xl shadow-lg border border-purple-200 dark:border-purple-600">
                  <Clock className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Peak Hours
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Busiest times of the day
                  </p>
                </div>
              </div>
              <PeakHoursHeatmap />
            </div>
          </div>
          
          {/* Cashflow Heatmap */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-gradient-to-br from-cyan-500 to-blue-600 dark:from-cyan-400 dark:to-blue-500 rounded-xl shadow-lg border border-cyan-200 dark:border-cyan-600">
                  <BarChart3 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Cashflow Heatmap
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Money flow patterns
                  </p>
                </div>
              </div>
              <CashflowHeatmap />
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-gray-950 dark:via-gray-900 dark:to-gray-800 p-4 lg:p-6">
      <div className="max-w-screen-2xl mx-auto space-y-8">
        {headerContent}
        {renderContent()}

        {/* Custom Date Range Modal */}
        {activeTab === 'overview' && (
          <CustomDateRangeModal 
            isOpen={isDatePickerOpen}
            onClose={() => setIsDatePickerOpen(false)}
            onApply={handleCustomDateRange}
          />
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
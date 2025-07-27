import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { FileText, ScanLine, Receipt, RefreshCw } from 'lucide-react';
import { useTransactionStore } from '../../stores/transactionStore';

const Invoices = lazy(() => import('../../components/transactions/Invoices'));
const ScanInvoices = lazy(() => import('../../components/transactions/ScanInvoices'));
const ReturnsAndRefunds = lazy(() => import('../../components/transactions/ReturnsAndRefunds'));

const LoadingSpinner = ({ className = "w-4 h-4" }) => (
  <div className={`${className} animate-spin rounded-full border-2 border-slate-300 border-t-slate-600`}></div>
);

const tabs = [
  { name: 'Invoices', icon: FileText },
  { name: 'Scan Invoices', icon: ScanLine },
  { name: 'Returns & Refunds', icon: Receipt }
];

const TransactionsPage = () => {
  const [activeTab, setActiveTab] = useState('Invoices');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const {
    initializeFromCache,
    refreshInvoices,
    clearCache,
    isInitialized,
    lastFetchTimestamp
  } = useTransactionStore();

  useEffect(() => {
    // Initialize immediately with cached data - no loading screen
    initializeFromCache();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshInvoices();
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleClearCache = async () => {
    if (confirm('Are you sure you want to clear cached data?')) {
      clearCache();
      // Re-initialize
      setTimeout(() => {
        initializeFromCache();
      }, 100);
    }
  };

  const getTabClass = (tabName) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-200 ${
      activeTab === tabName
        ? 'text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white'
        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
    }`;

  const renderTabContent = useMemo(() => {
    switch (activeTab) {
      case 'Invoices':
        return <Invoices />;
      case 'Scan Invoices':
        return <ScanInvoices />;
      case 'Returns & Refunds':
        return <ReturnsAndRefunds />;
      default:
        return null;
    }
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
                Transactions
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mt-1 text-sm">
                Manage your sales and payment history
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isInitialized && lastFetchTimestamp && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Updated {new Date(lastFetchTimestamp).toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleClearCache}
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                className={getTabClass(tab.name)}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.name}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Suspense fallback={
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <LoadingSpinner className="w-6 h-6 mx-auto mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Loading {activeTab}...
              </p>
            </div>
          </div>
        }>
          {renderTabContent}
        </Suspense>
      </div>
    </div>
  );
};

export default TransactionsPage;
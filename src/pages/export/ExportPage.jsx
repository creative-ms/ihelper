// src/pages/export/ExportPage.jsx

import React, { useEffect } from 'react';
import { useSalesStore } from '../../stores/salesStore.js';
import { usePurchaseStore } from '../../stores/purchaseStore.js';
import { useSupplierStore } from '../../stores/supplierStore.js';
import { useProductStore } from '../../stores/productStore.js';
import { exportSalesReportPDF, exportPurchaseReportPDF, exportSupplierReportPDF } from '../../lib/pdfGenerator.js';
import ReportCard from './ReportCard.jsx';
import ItemHistoryReportCard from './ItemHistoryReportCard.jsx';
import SupplierHistoryReportCard from './SupplierHistoryReportCard.jsx';
import CustomerReportCard from './CustomerReportCard.jsx';
import { 
  FileText, Package, Truck, Users, TrendingUp, History, 
  FileSpreadsheet, Download, BarChart3, PieChart,
  Building, ShoppingCart, UserCheck, Receipt
} from 'lucide-react';
import { startOfToday, startOfWeek, startOfMonth, endOfToday, endOfWeek, endOfMonth, parseISO } from 'date-fns';

const SectionHeader = ({ icon: Icon, title, description, gradient }) => (
  <div className="relative mb-8">
    <div className={`absolute inset-0 opacity-5 rounded-2xl ${gradient}`} />
    <div className="relative bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-xl ${gradient} bg-opacity-10`}>
          <Icon className={`h-7 w-7 ${gradient.replace('bg-gradient-to-br from-', 'text-').split(' ')[0]}`} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            {title}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {description}
          </p>
        </div>
      </div>
    </div>
  </div>
);

const ExportPage = () => {
  const sales = useSalesStore(state => state.sales);
  const fetchSales = useSalesStore(state => state.fetchSales);
  const purchases = usePurchaseStore(state => state.purchases);
  const fetchPurchases = usePurchaseStore(state => state.fetchPurchases);
  const suppliers = useSupplierStore(state => state.suppliers);
  const fetchSuppliers = useSupplierStore(state => state.fetchSuppliers);
  const products = useProductStore(state => state.products);
  
  // Use the correct methods from the optimized product store
  const initializeCache = useProductStore(state => state.initializeCache);
  const syncCacheWithDatabase = useProductStore(state => state.syncCacheWithDatabase);
  const isCacheReady = useProductStore(state => state.isCacheReady);

  useEffect(() => {
    const initializeData = async () => {
      try {
        // Initialize all stores in parallel
        await Promise.all([
          fetchSales(),
          fetchPurchases(),
          fetchSuppliers(),
          // Initialize the product store cache instead of fetchProducts
          initializeCache ? initializeCache() : Promise.resolve()
        ]);
        
        // If cache is not ready, try to sync with database
        if (!isCacheReady && syncCacheWithDatabase) {
          await syncCacheWithDatabase();
        }
      } catch (error) {
        console.error('Error initializing export page data:', error);
      }
    };

    initializeData();
  }, [fetchSales, fetchPurchases, fetchSuppliers, initializeCache, syncCacheWithDatabase, isCacheReady]);

  const filterDataByTime = (data, timeRange, includeReturns = false) => {
    let filteredData = data || [];
    if (!includeReturns) {
      filteredData = filteredData.filter(item => item.type !== 'RETURN');
    }

    if (timeRange === 'all') return filteredData;

    let start, end;
    if (timeRange === 'today') {
      start = startOfToday();
      end = endOfToday();
    } else if (timeRange === 'week') {
      start = startOfWeek(new Date(), { weekStartsOn: 1 });
      end = endOfWeek(new Date(), { weekStartsOn: 1 });
    } else if (timeRange === 'month') {
      start = startOfMonth(new Date());
      end = endOfMonth(new Date());
    } else if (typeof timeRange === 'object') {
      start = parseISO(timeRange.start);
      end = parseISO(timeRange.end);
      end.setHours(23, 59, 59, 999);
    } else {
      return filteredData;
    }

    return filteredData.filter(item => {
      const itemDate = new Date(item.returnedAt || item.createdAt);
      return itemDate >= start && itemDate <= end;
    });
  };

  const handleExportSalesPDF = (timeRange, includeReturns = false) => {
    const filteredSales = filterDataByTime(sales, timeRange, includeReturns);
    if (filteredSales.length === 0) {
      alert('No sales data found for the selected period.');
      return;
    }
    exportSalesReportPDF(filteredSales, typeof timeRange === 'object' ? 'Custom' : timeRange);
  };

  const handleExportPurchasesPDF = (timeRange, includeReturns = false) => {
    const filteredPurchases = filterDataByTime(purchases, timeRange, includeReturns);
    if (filteredPurchases.length === 0) {
      alert('No purchase data found for the selected period.');
      return;
    }
    exportPurchaseReportPDF(filteredPurchases, typeof timeRange === 'object' ? 'Custom' : timeRange);
  };

  const handleExportSuppliersPDF = () => {
    if (suppliers.length === 0) {
      alert('No supplier data found.');
      return;
    }
    exportSupplierReportPDF(suppliers);
  };

  const prepareSalesCSV = (timeRange, includeReturns = false) => {
    const filteredSales = filterDataByTime(sales, timeRange, includeReturns);
    return {
      data: filteredSales.map(s => ({ ...s, items_count: s.items.length })),
      headers: [
        { label: "Invoice ID", key: "_id" },
        { label: "Date", key: "createdAt" },
        { label: "Customer", key: "customerName" },
        { label: "Items Count", key: "items_count" },
        { label: "Total", key: "total" },
        { label: "Profit", key: "profit" },
      ],
      filename: `sales_report_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const preparePurchasesCSV = (timeRange, includeReturns = false) => {
    const filteredPurchases = filterDataByTime(purchases, timeRange, includeReturns);
    return {
      data: filteredPurchases.map(p => ({
        ...p,
        total: p.totals?.grandTotal ?? 0,
        items_count: p.items.length
      })),
      headers: [
        { label: "Date", key: "createdAt" },
        { label: "Invoice #", key: "invoiceNumber" },
        { label: "Supplier", key: "supplierName" },
        { label: "Items Count", key: "items_count" },
        { label: "Total", key: "total" },
        { label: "Status", key: "status" },
      ],
      filename: `purchase_report_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareSuppliersCSV = () => {
    return {
      data: suppliers,
      headers: [
        { label: "Name", key: "name" },
        { label: "Contact Person", key: "contactPerson" },
        { label: "Phone", key: "phone" },
        { label: "Balance", key: "balance" },
      ],
      filename: `suppliers_list_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-800 dark:to-gray-900 opacity-50" />
        <div className="relative px-6 py-12">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl">
                <Download className="h-8 w-8 text-white" />
              </div>
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">
              Export Center
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 leading-relaxed">
              Generate comprehensive reports and export your business data
              <span className="inline-block ml-2">📊</span>
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12 space-y-16">
        
        {/* General Reports Section */}
        <div>
          <SectionHeader
            icon={BarChart3}
            title="General Reports"
            description="Export comprehensive business reports for sales, purchases, and suppliers"
            gradient="bg-gradient-to-br from-emerald-500 to-green-600"
          />
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <ReportCard
                title="Sales Report"
                description="Export a detailed list of all sales and returns."
                onExportPDF={handleExportSalesPDF}
                onPrepareCSV={prepareSalesCSV}
                showReturnCheckbox={true}
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <ReportCard
                title="Purchase Report"
                description="Export a list of all purchases and returns."
                onExportPDF={handleExportPurchasesPDF}
                onPrepareCSV={preparePurchasesCSV}
                showReturnCheckbox={true}
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <ReportCard
                title="Supplier List"
                description="Export a complete list of all your suppliers."
                onExportPDF={handleExportSuppliersPDF}
                onPrepareCSV={prepareSuppliersCSV}
              />
            </div>
          </div>
        </div>

        {/* Item History Reports Section */}
        <div>
          <SectionHeader
            icon={History}
            title="Item History Reports"
            description="Detailed movement and transaction history for individual products"
            gradient="bg-gradient-to-br from-cyan-500 to-blue-600"
          />
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <ItemHistoryReportCard
                reportType="item-sales"
                title="Item Sales History"
                description="Export detailed sales history for a specific item."
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <ItemHistoryReportCard
                reportType="item-purchases"
                title="Item Purchase History"
                description="Export detailed purchase history for a specific item."
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <ItemHistoryReportCard
                reportType="item-movement"
                title="Item Movement Report"
                description="Export complete movement history (purchases & sales) for an item."
              />
            </div>
          </div>
        </div>

        {/* Supplier Reports Section */}
        <div>
          <SectionHeader
            icon={Building}
            title="Supplier Reports"
            description="Comprehensive supplier transaction and payment reports"
            gradient="bg-gradient-to-br from-amber-500 to-orange-600"
          />
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <SupplierHistoryReportCard
                reportType="supplier-history"
                title="Supplier Transaction History"
                description="Export detailed transaction history for a specific supplier."
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <SupplierHistoryReportCard
                reportType="supplier-purchases"
                title="Supplier Purchase History"
                description="Export purchase history for a specific supplier."
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <SupplierHistoryReportCard
                reportType="supplier-payments"
                title="Supplier Payment History"
                description="Export payment history for a specific supplier."
              />
            </div>
          </div>
        </div>

        {/* Customer Reports Section */}
        <div>
          <SectionHeader
            icon={Users}
            title="Customer Reports"
            description="Customer balance, transaction history, and comprehensive summaries"
            gradient="bg-gradient-to-br from-rose-500 to-pink-600"
          />
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <CustomerReportCard
                reportType="customer-balance"
                title="Customer Balance Report"
                description="Export customer balances and account status."
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <CustomerReportCard
                reportType="customer-transactions"
                title="Customer Transaction History"
                description="Export transaction history for a specific customer."
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <CustomerReportCard
                reportType="customer-sales"
                title="Customer Sales History"
                description="Export sales history for a specific customer."
              />
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 md:col-span-2 lg:col-span-1">
              <CustomerReportCard
                reportType="customer-summary"
                title="Customer Summary Report"
                description="Export comprehensive customer summary with sales and payment data."
              />
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-center pt-8">
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-100 dark:border-gray-700">
            <FileSpreadsheet className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Last updated: {new Date().toLocaleString('en-PK')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportPage;
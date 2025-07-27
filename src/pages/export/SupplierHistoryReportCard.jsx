// src/pages/export/SupplierHistoryReportCard.jsx
import React, { useState, useEffect } from 'react';
import { CSVLink } from 'react-csv';
import { useSalesStore } from '../../stores/salesStore.js';
import { usePurchaseStore } from '../../stores/purchaseStore.js';
import { useProductStore } from '../../stores/productStore.js';
import { exportSupplierHistoryPDF } from '../../lib/pdfGenerator.js';
import { startOfToday, startOfWeek, startOfMonth, endOfToday, endOfWeek, endOfMonth, parseISO } from 'date-fns';

const SupplierHistoryReportCard = ({ reportType, title, description }) => {
  const [timeframe, setTimeframe] = useState('month');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [selectedSupplierName, setSelectedSupplierName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [csvData, setCsvData] = useState({ headers: [], data: [], filename: 'report.csv' });
  const [suppliers, setSuppliers] = useState([]);

  // Store states
  const sales = useSalesStore(state => state.sales) || [];
  const purchases = usePurchaseStore(state => state.purchases) || [];
  const allProducts = useProductStore(state => state.allProducts) || [];

  // Extract unique suppliers from purchases
  useEffect(() => {
    const uniqueSuppliers = [...new Set(purchases.map(p => p.supplierName))].filter(Boolean);
    setSuppliers(uniqueSuppliers);
  }, [purchases]);

  // Filter suppliers based on search term
  const filteredSuppliers = suppliers.filter(supplier =>
    supplier.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter functions
  const filterDataByTime = (data, timeRange) => {
    if (timeRange === 'all') return data;

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
      return data;
    }

    return data.filter(item => {
      const itemDate = new Date(item.returnedAt || item.createdAt);
      return itemDate >= start && itemDate <= end;
    });
  };

  // Handle supplier selection
  const handleSupplierSelect = (supplierName) => {
    setSelectedSupplier(supplierName);
    setSelectedSupplierName(supplierName);
    setSearchTerm(supplierName);
    setShowDropdown(false);
  };

  // Handle search input change
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    setShowDropdown(true);
    
    // If search term is empty, clear selection
    if (!value) {
      setSelectedSupplier('');
      setSelectedSupplierName('');
    }
  };

  // Handle input focus
  const handleInputFocus = () => {
    setShowDropdown(true);
  };

  // Handle input blur with delay to allow click on dropdown
  const handleInputBlur = () => {
    setTimeout(() => {
      setShowDropdown(false);
    }, 200);
  };

  // Clear selected supplier
  const clearSelectedSupplier = () => {
    setSelectedSupplier('');
    setSelectedSupplierName('');
    setSearchTerm('');
  };

  // Report generation functions
  const generateSupplierPurchaseHistory = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const filteredPurchases = filterDataByTime(purchases, range);
    
    const supplierPurchases = filteredPurchases.filter(purchase => 
      purchase.supplierName === selectedSupplier
    );

    const detailedPurchases = [];
    supplierPurchases.forEach(purchase => {
      purchase.items?.forEach(item => {
        detailedPurchases.push({
          purchaseId: purchase._id,
          date: purchase.createdAt,
          supplierName: purchase.supplierName,
          itemName: item.productName || item.name,
          quantity: item.qty || item.quantity,
          rate: item.rate,
          discount: item.discount || 0,
          totalAmount: (item.rate * (item.qty || item.quantity)) - (item.discount || 0),
          batchNumber: item.batchNumber,
          expDate: item.expDate,
          status: purchase.status,
          type: purchase.type,
          invoiceNumber: purchase.invoiceNumber,
          paymentMethod: purchase.paymentMethod
        });
      });
    });

    return detailedPurchases;
  };

  const generateSupplierSalesHistory = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const filteredSales = filterDataByTime(sales, range);
    
    // Filter sales that contain products from the selected supplier
    const supplierSales = [];
    filteredSales.forEach(sale => {
      sale.items?.forEach(item => {
        // Find the product to check its supplier
        const product = allProducts.find(p => p._id === item.productId || p._id === item._id);
        if (product && product.supplier === selectedSupplier) {
          supplierSales.push({
            saleId: sale._id,
            date: sale.createdAt,
            customerName: sale.customerName,
            supplierName: selectedSupplier,
            itemName: item.name,
            quantity: item.quantity,
            sellingUnit: item.sellingUnit,
            unitPrice: item.sellingPrice,
            totalAmount: item.sellingPrice * item.quantity,
            discount: ((item.discountRate || 0) + (item.extraDiscount || 0)),
            profit: ((item.sellingPrice * item.quantity) - (item.costPrice || 0) * item.quantity),
            paymentMethod: sale.paymentMethod,
            type: sale.type
          });
        }
      });
    });

    return supplierSales;
  };

  const generateSupplierPaymentHistory = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const filteredPurchases = filterDataByTime(purchases, range);
    
    const supplierPayments = filteredPurchases
      .filter(purchase => purchase.supplierName === selectedSupplier)
      .map(purchase => ({
        purchaseId: purchase._id,
        date: purchase.createdAt,
        supplierName: purchase.supplierName,
        invoiceNumber: purchase.invoiceNumber,
        totalAmount: purchase.totalAmount,
        paidAmount: purchase.paidAmount || 0,
        pendingAmount: (purchase.totalAmount || 0) - (purchase.paidAmount || 0),
        paymentMethod: purchase.paymentMethod,
        paymentStatus: purchase.paymentStatus,
        dueDate: purchase.dueDate,
        status: purchase.status,
        type: purchase.type
      }));

    return supplierPayments;
  };

  const generateSupplierSummaryReport = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const filteredPurchases = filterDataByTime(purchases, range);
    
    const supplierPurchases = filteredPurchases.filter(purchase => 
      purchase.supplierName === selectedSupplier
    );

    // Calculate summary statistics
    const totalPurchases = supplierPurchases.length;
    const totalAmount = supplierPurchases.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
    const totalPaid = supplierPurchases.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
    const totalPending = totalAmount - totalPaid;
    
    const itemsSummary = {};
    supplierPurchases.forEach(purchase => {
      purchase.items?.forEach(item => {
        const itemName = item.productName || item.name;
        if (!itemsSummary[itemName]) {
          itemsSummary[itemName] = {
            itemName,
            totalQuantity: 0,
            totalValue: 0,
            purchaseCount: 0
          };
        }
        itemsSummary[itemName].totalQuantity += item.qty || item.quantity || 0;
        itemsSummary[itemName].totalValue += (item.rate * (item.qty || item.quantity)) - (item.discount || 0);
        itemsSummary[itemName].purchaseCount += 1;
      });
    });

    return {
      summary: {
        supplierName: selectedSupplier,
        totalPurchases,
        totalAmount,
        totalPaid,
        totalPending,
        period: timeframe === 'custom' ? `${customRange.start} to ${customRange.end}` : timeframe
      },
      items: Object.values(itemsSummary)
    };
  };

  // CSV preparation functions
  const prepareSupplierPurchaseCSV = () => {
    const data = generateSupplierPurchaseHistory();
    
    return {
      data,
      headers: [
        { label: "Purchase ID", key: "purchaseId" },
        { label: "Date", key: "date" },
        { label: "Supplier", key: "supplierName" },
        { label: "Item Name", key: "itemName" },
        { label: "Quantity", key: "quantity" },
        { label: "Rate", key: "rate" },
        { label: "Discount", key: "discount" },
        { label: "Total Amount", key: "totalAmount" },
        { label: "Batch Number", key: "batchNumber" },
        { label: "Expiry Date", key: "expDate" },
        { label: "Status", key: "status" },
        { label: "Invoice Number", key: "invoiceNumber" },
        { label: "Payment Method", key: "paymentMethod" }
      ],
      filename: `${selectedSupplier}_purchase_history_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareSupplierSalesCSV = () => {
    const data = generateSupplierSalesHistory();
    
    return {
      data,
      headers: [
        { label: "Sale ID", key: "saleId" },
        { label: "Date", key: "date" },
        { label: "Customer", key: "customerName" },
        { label: "Supplier", key: "supplierName" },
        { label: "Item Name", key: "itemName" },
        { label: "Quantity", key: "quantity" },
        { label: "Unit", key: "sellingUnit" },
        { label: "Unit Price", key: "unitPrice" },
        { label: "Total Amount", key: "totalAmount" },
        { label: "Discount %", key: "discount" },
        { label: "Profit", key: "profit" },
        { label: "Payment Method", key: "paymentMethod" }
      ],
      filename: `${selectedSupplier}_sales_history_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareSupplierPaymentCSV = () => {
    const data = generateSupplierPaymentHistory();
    
    return {
      data,
      headers: [
        { label: "Purchase ID", key: "purchaseId" },
        { label: "Date", key: "date" },
        { label: "Supplier", key: "supplierName" },
        { label: "Invoice Number", key: "invoiceNumber" },
        { label: "Total Amount", key: "totalAmount" },
        { label: "Paid Amount", key: "paidAmount" },
        { label: "Pending Amount", key: "pendingAmount" },
        { label: "Payment Method", key: "paymentMethod" },
        { label: "Payment Status", key: "paymentStatus" },
        { label: "Due Date", key: "dueDate" },
        { label: "Status", key: "status" }
      ],
      filename: `${selectedSupplier}_payment_history_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareSupplierSummaryCSV = () => {
    const reportData = generateSupplierSummaryReport();
    
    return {
      data: reportData.items,
      headers: [
        { label: "Item Name", key: "itemName" },
        { label: "Total Quantity", key: "totalQuantity" },
        { label: "Total Value", key: "totalValue" },
        { label: "Purchase Count", key: "purchaseCount" }
      ],
      filename: `${selectedSupplier}_summary_report_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  // Handle CSV preparation based on report type
  const handlePrepareCSVClick = async () => {
    let data;
    switch (reportType) {
      case 'supplier-purchases':
        data = prepareSupplierPurchaseCSV();
        break;
      case 'supplier-sales':
        data = prepareSupplierSalesCSV();
        break;
      case 'supplier-payments':
        data = prepareSupplierPaymentCSV();
        break;
      case 'supplier-summary':
        data = prepareSupplierSummaryCSV();
        break;
      default:
        data = { headers: [], data: [], filename: 'report.csv' };
    }
    setCsvData(data);
  };

  // Handle PDF export
  const handleExportPDF = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    
    switch (reportType) {
      case 'supplier-purchases':
        if (!selectedSupplier) {
          alert('Please select a supplier first.');
          return;
        }
        const purchaseData = generateSupplierPurchaseHistory();
        exportSupplierHistoryPDF(purchaseData, selectedSupplier, 'Purchase History', range);
        break;
        
      case 'supplier-sales':
        if (!selectedSupplier) {
          alert('Please select a supplier first.');
          return;
        }
        const salesData = generateSupplierSalesHistory();
        exportSupplierHistoryPDF(salesData, selectedSupplier, 'Sales History', range);
        break;
        
      case 'supplier-payments':
        if (!selectedSupplier) {
          alert('Please select a supplier first.');
          return;
        }
        const paymentData = generateSupplierPaymentHistory();
        exportSupplierHistoryPDF(paymentData, selectedSupplier, 'Payment History', range);
        break;
        
      case 'supplier-summary':
        if (!selectedSupplier) {
          alert('Please select a supplier first.');
          return;
        }
        const summaryData = generateSupplierSummaryReport();
        exportSupplierHistoryPDF(summaryData.items, selectedSupplier, 'Summary Report', range);
        break;
    }
  };

  // Debug effect
  useEffect(() => {
  }, [suppliers, selectedSupplier, selectedSupplierName]);

  return (
    <div className="bg-white dark:bg-dark-secondary p-6 rounded-2xl shadow-lg border-l-4 border-green-500">
      <h3 className="text-xl font-bold text-slate-800 dark:text-white">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>
      
      <div className="mt-4 space-y-3">
        {/* Supplier Search */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Search Supplier
          </label>
          
          {/* Show selected supplier if any */}
          {selectedSupplier && (
            <div className="mb-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700 flex justify-between items-center">
              <span className="text-sm font-medium text-green-800 dark:text-green-300">
                Selected: {selectedSupplierName}
              </span>
              <button
                onClick={clearSelectedSupplier}
                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm"
              >
                Clear
              </button>
            </div>
          )}
          
          {/* Search Input */}
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            placeholder="Type to search suppliers..."
            className="input-style w-full"
          />
          
          {/* Dropdown */}
          {showDropdown && filteredSuppliers.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-dark-secondary border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filteredSuppliers.map((supplier, index) => (
                <button
                  key={index}
                  onClick={() => handleSupplierSelect(supplier)}
                  className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
                >
                  {supplier}
                </button>
              ))}
            </div>
          )}
          
          {/* No results message */}
          {showDropdown && searchTerm && filteredSuppliers.length === 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-dark-secondary border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">No suppliers found matching "{searchTerm}"</p>
            </div>
          )}
        </div>

        {/* Timeframe Selector */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Time Period
          </label>
          <select
            onChange={(e) => setTimeframe(e.target.value)}
            value={timeframe}
            className="input-style w-full"
          >
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {timeframe === 'custom' && (
          <div className="flex gap-2">
            <input
              type="date"
              value={customRange.start}
              onChange={e => setCustomRange(p => ({...p, start: e.target.value}))}
              className="input-style w-full"
            />
            <input
              type="date"
              value={customRange.end}
              onChange={e => setCustomRange(p => ({...p, end: e.target.value}))}
              className="input-style w-full"
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={handleExportPDF}
          className="btn-secondary flex-1"
          disabled={!selectedSupplier}
        >
          Export as PDF
        </button>
        <CSVLink
          data={csvData.data}
          headers={csvData.headers}
          filename={csvData.filename}
          className="btn-secondary flex-1 text-center"
          target="_blank"
          onClick={handlePrepareCSVClick}
        >
          Export as CSV
        </CSVLink>
      </div>
    </div>
  );
};

export default SupplierHistoryReportCard;
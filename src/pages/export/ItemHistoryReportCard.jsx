// src/pages/export/ItemHistoryReportCard.jsx
import React, { useState, useEffect } from 'react';
import { CSVLink } from 'react-csv';
import { useSalesStore } from '../../stores/salesStore.js';
import { usePurchaseStore } from '../../stores/purchaseStore.js';
import { useProductStore } from '../../stores/productStore.js';
import { exportItemHistoryPDF } from '../../lib/pdfGenerator.js';
import { startOfToday, startOfWeek, startOfMonth, endOfToday, endOfWeek, endOfMonth, parseISO } from 'date-fns';
import ProductSearch from '../../components/purchases/ProductSearch.jsx';

const ItemHistoryReportCard = ({ reportType, title, description }) => {
  const [timeframe, setTimeframe] = useState('month');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [selectedItem, setSelectedItem] = useState('');
  const [selectedItemName, setSelectedItemName] = useState('');
  const [csvData, setCsvData] = useState({ headers: [], data: [], filename: 'report.csv' });

  // Store states - Fixed: Use allProducts instead of products
  const sales = useSalesStore(state => state.sales) || [];
  const purchases = usePurchaseStore(state => state.purchases) || [];
  const allProducts = useProductStore(state => state.allProducts) || [];

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

  // Handle product selection from ProductSearch component
  const handleProductSelect = (product) => {
    console.log('Selected product:', product); // Debug log
    setSelectedItem(product._id || product.id);
    setSelectedItemName(product.name);
  };

  // Clear selected item
  const clearSelectedItem = () => {
    setSelectedItem('');
    setSelectedItemName('');
  };

  // Report generation functions
  const generateItemSaleHistory = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const filteredSales = filterDataByTime(sales, range);
    
    const itemSales = [];
    filteredSales.forEach(sale => {
      sale.items?.forEach(item => {
        // Fixed: Check multiple possible ID fields
        const itemId = item._id || item.productId || item.id;
        if (itemId === selectedItem) {
          itemSales.push({
            saleId: sale._id,
            date: sale.createdAt,
            customerName: sale.customerName,
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

    return itemSales;
  };

  const generateItemPurchaseHistory = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const filteredPurchases = filterDataByTime(purchases, range);
    
    const itemPurchases = [];
    filteredPurchases.forEach(purchase => {
      purchase.items?.forEach(item => {
        // Fixed: Check multiple possible ID fields
        const itemId = item.productId || item._id || item.id;
        if (itemId === selectedItem) {
          itemPurchases.push({
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
            type: purchase.type
          });
        }
      });
    });

    return itemPurchases;
  };

  const generateItemMovementReport = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const filteredSales = filterDataByTime(sales, range);
    const filteredPurchases = filterDataByTime(purchases, range);
    
    const movements = [];
    
    // Add purchase movements
    filteredPurchases.forEach(purchase => {
      purchase.items?.forEach(item => {
        const itemId = item.productId || item._id || item.id;
        if (itemId === selectedItem) {
          movements.push({
            date: purchase.createdAt,
            type: 'PURCHASE',
            reference: purchase._id,
            supplier: purchase.supplierName,
            customer: '',
            quantityIn: item.qty || item.quantity,
            quantityOut: 0,
            rate: item.rate,
            batchNumber: item.batchNumber
          });
        }
      });
    });

    // Add sale movements
    filteredSales.forEach(sale => {
      sale.items?.forEach(item => {
        const itemId = item._id || item.productId || item.id;
        if (itemId === selectedItem) {
          movements.push({
            date: sale.createdAt,
            type: 'SALE',
            reference: sale._id,
            supplier: '',
            customer: sale.customerName,
            quantityIn: 0,
            quantityOut: item.quantity,
            rate: item.sellingPrice,
            batchNumber: item.sourceBatchInfo?.batchNumber || ''
          });
        }
      });
    });

    return movements.sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  // Fixed: Helper function to find product by ID
  const findProductById = (productId) => {
    return allProducts.find(p => p._id === productId || p.id === productId);
  };

  // CSV preparation functions
  const prepareItemSaleCSV = () => {
    const data = generateItemSaleHistory();
    const selectedProduct = findProductById(selectedItem);
    
    return {
      data,
      headers: [
        { label: "Sale ID", key: "saleId" },
        { label: "Date", key: "date" },
        { label: "Customer", key: "customerName" },
        { label: "Quantity", key: "quantity" },
        { label: "Unit", key: "sellingUnit" },
        { label: "Unit Price", key: "unitPrice" },
        { label: "Total Amount", key: "totalAmount" },
        { label: "Discount %", key: "discount" },
        { label: "Profit", key: "profit" },
        { label: "Payment Method", key: "paymentMethod" }
      ],
      filename: `${selectedProduct?.name || selectedItemName || 'item'}_sales_history_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareItemPurchaseCSV = () => {
    const data = generateItemPurchaseHistory();
    const selectedProduct = findProductById(selectedItem);
    
    return {
      data,
      headers: [
        { label: "Purchase ID", key: "purchaseId" },
        { label: "Date", key: "date" },
        { label: "Supplier", key: "supplierName" },
        { label: "Quantity", key: "quantity" },
        { label: "Rate", key: "rate" },
        { label: "Discount", key: "discount" },
        { label: "Total Amount", key: "totalAmount" },
        { label: "Batch Number", key: "batchNumber" },
        { label: "Expiry Date", key: "expDate" },
        { label: "Status", key: "status" }
      ],
      filename: `${selectedProduct?.name || selectedItemName || 'item'}_purchase_history_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareItemMovementCSV = () => {
    const data = generateItemMovementReport();
    const selectedProduct = findProductById(selectedItem);
    
    return {
      data,
      headers: [
        { label: "Date", key: "date" },
        { label: "Type", key: "type" },
        { label: "Reference", key: "reference" },
        { label: "Supplier", key: "supplier" },
        { label: "Customer", key: "customer" },
        { label: "Quantity In", key: "quantityIn" },
        { label: "Quantity Out", key: "quantityOut" },
        { label: "Rate", key: "rate" },
        { label: "Batch Number", key: "batchNumber" }
      ],
      filename: `${selectedProduct?.name || selectedItemName || 'item'}_movement_history_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  // Handle CSV preparation based on report type
  const handlePrepareCSVClick = async () => {
    let data;
    switch (reportType) {
      case 'item-sales':
        data = prepareItemSaleCSV();
        break;
      case 'item-purchases':
        data = prepareItemPurchaseCSV();
        break;
      case 'item-movement':
        data = prepareItemMovementCSV();
        break;
      default:
        data = { headers: [], data: [], filename: 'report.csv' };
    }
    setCsvData(data);
  };

  // Handle PDF export
  const handleExportPDF = () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const selectedProduct = findProductById(selectedItem);
    const productName = selectedProduct?.name || selectedItemName || 'Unknown Item';
    
    switch (reportType) {
      case 'item-sales':
        if (!selectedItem) {
          alert('Please select an item first.');
          return;
        }
        const salesData = generateItemSaleHistory();
        exportItemHistoryPDF(salesData, productName, 'Sales', range);
        break;
        
      case 'item-purchases':
        if (!selectedItem) {
          alert('Please select an item first.');
          return;
        }
        const purchaseData = generateItemPurchaseHistory();
        exportItemHistoryPDF(purchaseData, productName, 'Purchase', range);
        break;
        
      case 'item-movement':
        if (!selectedItem) {
          alert('Please select an item first.');
          return;
        }
        const movementData = generateItemMovementReport();
        exportItemHistoryPDF(movementData, productName, 'Movement', range);
        break;
    }
  };

  // Debug effect to log product data
  useEffect(() => {
    
  }, [allProducts, selectedItem, selectedItemName]);

  return (
    <div className="bg-white dark:bg-dark-secondary p-6 rounded-2xl shadow-lg border-l-4 border-blue-500">
      <h3 className="text-xl font-bold text-slate-800 dark:text-white">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>
      
      <div className="mt-4 space-y-3">
        {/* Item Selection with ProductSearch */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Select Item
          </label>
          
          {/* Show selected item if any */}
          {selectedItem && (
            <div className="mb-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 flex justify-between items-center">
              <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Selected: {selectedItemName}
              </span>
              <button
                onClick={clearSelectedItem}
                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm"
              >
                Clear
              </button>
            </div>
          )}
          
          {/* Product Search Component */}
          <ProductSearch onProductSelect={handleProductSelect} />
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
          disabled={!selectedItem}
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

export default ItemHistoryReportCard;
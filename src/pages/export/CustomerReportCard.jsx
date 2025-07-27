// src/pages/export/CustomerReportCard.jsx
import React, { useState } from 'react';
import { CSVLink } from 'react-csv';
import { useCustomerStore } from '../../stores/customerStore.js';
import { useTransactionStore } from '../../stores/transactionStore.js';
import { useSalesStore } from '../../stores/salesStore.js';
import { exportCustomerReportPDF } from '../../lib/pdfGenerator.js';
import { startOfToday, startOfWeek, startOfMonth, endOfToday, endOfWeek, endOfMonth, parseISO } from 'date-fns';

const CustomerReportCard = ({ title, description, reportType }) => {
  const [timeframe, setTimeframe] = useState('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [csvData, setCsvData] = useState({ headers: [], data: [], filename: 'customer_report.csv' });
  const [isLoading, setIsLoading] = useState(false);
  
  const customers = useCustomerStore(state => state.customers);
  const fetchCustomers = useCustomerStore(state => state.fetchCustomers);
  const fetchCustomerTransactions = useCustomerStore(state => state.fetchCustomerTransactions);
  const sales = useSalesStore(state => state.sales);
  const fetchSales = useSalesStore(state => state.fetchSales);

  React.useEffect(() => {
    fetchCustomers();
    fetchSales();
  }, [fetchCustomers, fetchSales]);

  // Filter customers based on search
  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (customer.phone && customer.phone.includes(customerSearch)) ||
    (customer.email && customer.email.toLowerCase().includes(customerSearch.toLowerCase()))
  );

  // Get selected customer object
  const selectedCustomerObj = customers.find(c => c._id === selectedCustomer);

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
      const itemDate = new Date(item.createdAt || item.date);
      return itemDate >= start && itemDate <= end;
    });
  };

  const prepareCustomerBalanceCSV = async () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    
    // Get customers with their balances
    const customersData = customers.map(customer => ({
      id: customer._id,
      name: customer.name,
      phone: customer.phone || 'N/A',
      email: customer.email || 'N/A',
      address: customer.address || 'N/A',
      balance: customer.balance || 0,
      balanceStatus: (customer.balance || 0) > 0 ? 'Credit' : (customer.balance || 0) < 0 ? 'Debit' : 'Clear',
      createdAt: customer.createdAt || new Date().toISOString()
    }));

    // Filter by time if needed
    const filteredCustomers = filterDataByTime(customersData, range);

    return {
      data: filteredCustomers,
      headers: [
        { label: "Customer ID", key: "id" },
        { label: "Name", key: "name" },
        { label: "Phone", key: "phone" },
        { label: "Email", key: "email" },
        { label: "Address", key: "address" },
        { label: "Balance", key: "balance" },
        { label: "Status", key: "balanceStatus" },
        { label: "Created Date", key: "createdAt" }
      ],
      filename: `customer_balances_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareCustomerTransactionsCSV = async () => {
    if (!selectedCustomer) {
      alert('Please select a customer first.');
      return { data: [], headers: [], filename: 'customer_transactions.csv' };
    }

    const range = timeframe === 'custom' ? customRange : timeframe;
    const customer = customers.find(c => c._id === selectedCustomer);
    
    if (!customer) {
      alert('Customer not found.');
      return { data: [], headers: [], filename: 'customer_transactions.csv' };
    }

    // Fetch transactions for the selected customer
    const transactions = await fetchCustomerTransactions(selectedCustomer);
    const filteredTransactions = filterDataByTime(transactions, range);

    const transactionsData = filteredTransactions.map(transaction => ({
      id: transaction._id,
      date: transaction.date,
      type: transaction.type,
      amount: transaction.amount,
      description: transaction.description || 'N/A',
      referenceId: transaction.referenceId || 'N/A',
      customerName: customer.name
    }));

    return {
      data: transactionsData,
      headers: [
        { label: "Transaction ID", key: "id" },
        { label: "Date", key: "date" },
        { label: "Type", key: "type" },
        { label: "Amount", key: "amount" },
        { label: "Description", key: "description" },
        { label: "Reference ID", key: "referenceId" },
        { label: "Customer Name", key: "customerName" }
      ],
      filename: `${customer.name.replace(/\s+/g, '_')}_transactions_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareCustomerSalesCSV = async () => {
    if (!selectedCustomer) {
      alert('Please select a customer first.');
      return { data: [], headers: [], filename: 'customer_sales.csv' };
    }

    const range = timeframe === 'custom' ? customRange : timeframe;
    const customer = customers.find(c => c._id === selectedCustomer);
    
    if (!customer) {
      alert('Customer not found.');
      return { data: [], headers: [], filename: 'customer_sales.csv' };
    }

    // Filter sales for the selected customer
    const customerSales = sales.filter(sale => 
      sale.customerId === selectedCustomer && sale.type === 'SALE'
    );
    
    const filteredSales = filterDataByTime(customerSales, range);

    const salesData = filteredSales.map(sale => ({
      invoiceId: sale._id,
      date: sale.createdAt,
      customerName: sale.customerName,
      itemsCount: sale.items.length,
      subtotal: sale.subtotal || 0,
      totalDiscount: sale.totalDiscountAmount || 0,
      totalTax: sale.totalTaxAmount || 0,
      total: sale.total || 0,
      amountPaid: sale.amountPaid || 0,
      balance: (sale.total || 0) - (sale.amountPaid || 0),
      paymentMethod: sale.paymentMethod || 'N/A',
      profit: sale.profit || 0
    }));

    return {
      data: salesData,
      headers: [
        { label: "Invoice ID", key: "invoiceId" },
        { label: "Date", key: "date" },
        { label: "Customer Name", key: "customerName" },
        { label: "Items Count", key: "itemsCount" },
        { label: "Subtotal", key: "subtotal" },
        { label: "Total Discount", key: "totalDiscount" },
        { label: "Total Tax", key: "totalTax" },
        { label: "Total", key: "total" },
        { label: "Amount Paid", key: "amountPaid" },
        { label: "Balance", key: "balance" },
        { label: "Payment Method", key: "paymentMethod" },
        { label: "Profit", key: "profit" }
      ],
      filename: `${customer.name.replace(/\s+/g, '_')}_sales_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const prepareCustomerSummaryCSV = async () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    
    // Calculate summary for each customer
    const customerSummaries = await Promise.all(
      customers.map(async (customer) => {
        const customerSales = sales.filter(sale => 
          sale.customerId === customer._id && sale.type === 'SALE'
        );
        
        const filteredSales = filterDataByTime(customerSales, range);
        const transactions = await fetchCustomerTransactions(customer._id);
        const filteredTransactions = filterDataByTime(transactions, range);

        const totalSales = filteredSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
        const totalPaid = filteredTransactions
          .filter(t => t.type === 'PAYMENT')
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const totalPurchases = filteredTransactions
          .filter(t => t.type === 'SALE')
          .reduce((sum, t) => sum + (t.amount || 0), 0);

        return {
          name: customer.name,
          phone: customer.phone || 'N/A',
          currentBalance: customer.balance || 0,
          totalSales,
          totalPaid,
          totalPurchases,
          salesCount: filteredSales.length,
          transactionCount: filteredTransactions.length,
          averageSale: filteredSales.length > 0 ? totalSales / filteredSales.length : 0,
          lastSaleDate: filteredSales.length > 0 ? filteredSales[filteredSales.length - 1].createdAt : 'N/A'
        };
      })
    );

    return {
      data: customerSummaries,
      headers: [
        { label: "Customer Name", key: "name" },
        { label: "Phone", key: "phone" },
        { label: "Current Balance", key: "currentBalance" },
        { label: "Total Sales", key: "totalSales" },
        { label: "Total Paid", key: "totalPaid" },
        { label: "Total Purchases", key: "totalPurchases" },
        { label: "Sales Count", key: "salesCount" },
        { label: "Transaction Count", key: "transactionCount" },
        { label: "Average Sale", key: "averageSale" },
        { label: "Last Sale Date", key: "lastSaleDate" }
      ],
      filename: `customer_summary_${new Date().toISOString().split('T')[0]}.csv`
    };
  };

  const handlePrepareCSVClick = async () => {
    setIsLoading(true);
    try {
      let data;
      
      switch (reportType) {
        case 'customer-balance':
          data = await prepareCustomerBalanceCSV();
          break;
        case 'customer-transactions':
          data = await prepareCustomerTransactionsCSV();
          break;
        case 'customer-sales':
          data = await prepareCustomerSalesCSV();
          break;
        case 'customer-summary':
          data = await prepareCustomerSummaryCSV();
          break;
        default:
          data = { data: [], headers: [], filename: 'report.csv' };
      }
      
      setCsvData(data);
    } catch (error) {
      console.error('Error preparing CSV:', error);
      alert('Error preparing CSV data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPDF = async () => {
    setIsLoading(true);
    try {
      const range = timeframe === 'custom' ? customRange : timeframe;
      let data;
      
      switch (reportType) {
        case 'customer-balance':
          data = await prepareCustomerBalanceCSV();
          break;
        case 'customer-transactions':
          data = await prepareCustomerTransactionsCSV();
          break;
        case 'customer-sales':
          data = await prepareCustomerSalesCSV();
          break;
        case 'customer-summary':
          data = await prepareCustomerSummaryCSV();
          break;
        default:
          data = { data: [], headers: [], filename: 'report.pdf' };
      }
      
      if (data.data.length === 0) {
        alert('No data found for the selected criteria.');
        return;
      }
      
      // Call PDF export function with proper error handling
      await exportCustomerReportPDF(data.data, reportType, timeframe);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Error exporting PDF. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomerSelect = (customer) => {
    setSelectedCustomer(customer._id);
    setCustomerSearch(customer.name);
    setShowCustomerDropdown(false);
  };

  const handleCustomerSearchChange = (e) => {
    const value = e.target.value;
    setCustomerSearch(value);
    setShowCustomerDropdown(value.length > 0);
    
    // If search is cleared, also clear selection
    if (value === '') {
      setSelectedCustomer('');
    }
  };

  return (
    <div className="bg-white dark:bg-dark-secondary p-6 rounded-2xl shadow-lg border-l-4 border-blue-500">
      <h3 className="text-xl font-bold text-slate-800 dark:text-white">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>
      
      <div className="mt-4 space-y-3">
        {/* Customer Search for specific customer reports */}
        {(reportType === 'customer-transactions' || reportType === 'customer-sales') && (
          <div className="relative">
            <input
              type="text"
              placeholder="Search customer by name, phone, or email..."
              value={customerSearch}
              onChange={handleCustomerSearchChange}
              onFocus={() => setShowCustomerDropdown(customerSearch.length > 0)}
              className="input-style w-full"
            />
            
            {showCustomerDropdown && filteredCustomers.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white dark:bg-dark-secondary border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredCustomers.slice(0, 10).map(customer => (
                  <div
                    key={customer._id}
                    onClick={() => handleCustomerSelect(customer)}
                    className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-200 dark:border-gray-600 last:border-b-0"
                  >
                    <div className="font-medium text-slate-800 dark:text-white">
                      {customer.name}
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      {customer.phone && `${customer.phone} • `}
                      Balance: {customer.balance || 0}
                    </div>
                  </div>
                ))}
                {filteredCustomers.length === 0 && (
                  <div className="p-3 text-slate-500 dark:text-slate-400 text-center">
                    No customers found
                  </div>
                )}
              </div>
            )}
            
            {selectedCustomerObj && (
              <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <span className="text-sm text-blue-600 dark:text-blue-400">
                  Selected: {selectedCustomerObj.name} (Balance: {selectedCustomerObj.balance || 0})
                </span>
              </div>
            )}
          </div>
        )}

        {/* Timeframe Selector */}
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

        {/* Custom Date Range */}
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

      {/* Click outside to close dropdown */}
      {showCustomerDropdown && (
        <div 
          className="fixed inset-0 z-5" 
          onClick={() => setShowCustomerDropdown(false)}
        />
      )}

      <div className="mt-6 flex gap-3">
        <button 
          onClick={handleExportPDF}
          disabled={isLoading}
          className="btn-secondary flex-1 disabled:opacity-50"
        >
          {isLoading ? 'Loading...' : 'Export as PDF'}
        </button>
        <CSVLink
          data={csvData.data}
          headers={csvData.headers}
          filename={csvData.filename}
          className="btn-secondary flex-1 text-center"
          target="_blank"
          onClick={handlePrepareCSVClick}
        >
          {isLoading ? 'Loading...' : 'Export as CSV'}
        </CSVLink>
      </div>
    </div>
  );
};

export default CustomerReportCard;
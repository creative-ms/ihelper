// src/stores/dashboard/helpers.js - PERFORMANCE OPTIMIZED VERSION
// =================================================================================
// OPTIMIZED FILE: Reduced CPU usage and memory consumption
// =================================================================================

// Performance monitoring
const perfLog = {
  time: (label) => {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      if (duration > 50) console.warn(`🐌 ${label}: ${duration.toFixed(2)}ms`);
      return duration;
    };
  }
};

// --- Optimized Helper Functions for Date Operations ---
const dateCache = new Map();

const getDayKey = (date) => {
  if (!date) return null;
  
  // Use string if already ISO format
  if (typeof date === 'string' && date.includes('T')) {
    return date.split('T')[0];
  }
  
  const cacheKey = date.toString();
  if (dateCache.has(cacheKey)) {
    return dateCache.get(cacheKey);
  }
  
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    
    const result = d.toISOString().split('T')[0];
    dateCache.set(cacheKey, result);
    return result;
  } catch (error) {
    return null;
  }
};

const getWeekKey = (date) => {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    
    // Simplified week calculation
    const year = d.getFullYear();
    const start = new Date(year, 0, 1);
    const days = Math.floor((d - start) / (24 * 60 * 60 * 1000));
    const week = Math.ceil((days + start.getDay() + 1) / 7);
    
    return `${year}-W${week.toString().padStart(2, '0')}`;
  } catch (error) {
    return null;
  }
};

const getMonthKey = (date) => {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  } catch (error) {
    return null;
  }
};

// Optimized numeric conversion with caching
const numericCache = new Map();
const safeNumeric = (value, defaultValue = 0) => {
  if (typeof value === 'number') return isNaN(value) ? defaultValue : value;
  if (value === null || value === undefined) return defaultValue;
  
  const cacheKey = String(value);
  if (numericCache.has(cacheKey)) {
    return numericCache.get(cacheKey);
  }
  
  const num = Number(value);
  const result = isNaN(num) ? defaultValue : num;
  
  // Only cache small numbers to prevent memory issues
  if (numericCache.size < 1000) {
    numericCache.set(cacheKey, result);
  }
  
  return result;
};

// Optimized date parsing
const safeParseDate = (dateValue) => {
  if (!dateValue) return null;
  if (dateValue instanceof Date) return dateValue;
  
  try {
    const date = new Date(dateValue);
    return isNaN(date.getTime()) ? null : date;
  } catch (error) {
    return null;
  }
};

// --- OPTIMIZED Stats Calculation Logic ---
export const calculateStats = (allDocs, timeframe, customDateRange) => {
  const endTimer = perfLog.time('Calculate Stats');
  
  try {
    console.log('📊 Calculating stats for timeframe:', timeframe);
    
    // Validate input
    if (!allDocs || typeof allDocs !== 'object') {
      console.error('Invalid allDocs provided to calculateStats');
      return getDefaultStats();
    }

    // Ensure all doc arrays exist and are valid
    const {
      sales = [],
      products = [],
      customers = [],
      suppliers = [],
      purchases = [],
      transactions = []
    } = allDocs;

    // Early exit if no data
    if (!Array.isArray(sales) || sales.length === 0) {
      console.log('⚡ No sales data, returning default stats');
      endTimer();
      return getDefaultStats();
    }

    // --- 1. Optimized Date Filtering ---
    let statsStartDate, statsEndDate = new Date();
    const now = new Date();
    
    switch (timeframe) {
      case 'custom':
        if (customDateRange?.start && customDateRange?.end) {
          statsStartDate = new Date(customDateRange.start);
          statsEndDate = new Date(customDateRange.end);
        } else {
          statsStartDate = new Date(new Date().setHours(0, 0, 0, 0));
        }
        break;
      case 'today':
        statsStartDate = new Date(new Date().setHours(0, 0, 0, 0));
        break;
      case 'week':
        const firstDay = now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1);
        statsStartDate = new Date(new Date().setDate(firstDay));
        statsStartDate.setHours(0, 0, 0, 0);
        break;
      default: // month
        statsStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    
    statsEndDate.setHours(23, 59, 59, 999);

    // Optimized filtering with early bailout
    const filterByDate = (doc) => {
      const dateValue = doc.createdAt || doc.returnedAt || doc.date;
      if (!dateValue) return false;
      
      const docDate = safeParseDate(dateValue);
      return docDate && docDate >= statsStartDate && docDate <= statsEndDate;
    };

    // Pre-filter data to reduce processing load
    const filteredSalesAndReturns = sales.filter(filterByDate);
    const filteredPurchasesAndReturns = Array.isArray(purchases) ? purchases.filter(filterByDate) : [];
    const filteredTransactions = Array.isArray(transactions) ? transactions.filter(filterByDate) : [];
    
    console.log('🔍 Filtered data:', {
      sales: filteredSalesAndReturns.length,
      purchases: filteredPurchasesAndReturns.length,
      transactions: filteredTransactions.length
    });

    // Early exit if no filtered data
    if (filteredSalesAndReturns.length === 0) {
      console.log('⚡ No filtered sales data, returning default stats');
      endTimer();
      return getDefaultStats();
    }

    // --- 2. 🚀 OPTIMIZED Sales, Profit, and Items Sold Calculations ---
    let totalGrossRevenue = 0;
    let totalReturnValue = 0;
    let totalGrossProfit = 0;
    let totalReturnedProfit = 0;
    let itemsSold = 0;
    let itemsReturned = 0;
    let totalSalesCount = 0;
    let totalReturnCount = 0;

    // 🚀 OPTIMIZATION: Create optimized map for original sales
    const originalSalesMap = new Map();
    
    // Single pass through all sales to build map and process sales data
    const salesProcessTimer = perfLog.time('Process Sales Data');
    
    sales.forEach(doc => {
      if (!doc || !doc._id) return; // Skip invalid docs
      
      if (doc.type === 'SALE') {
        originalSalesMap.set(doc._id, {
          profit: safeNumeric(doc.profit),
          total: safeNumeric(doc.total)
        });
      }
    });

    // Process filtered sales and returns
    filteredSalesAndReturns.forEach(doc => {
      if (!doc || !doc._id) return;
      
      try {
        if (doc.type === 'SALE') {
          totalSalesCount += 1;
          const revenue = safeNumeric(doc.total);
          const profit = safeNumeric(doc.profit);
          
          totalGrossRevenue += revenue;
          totalGrossProfit += profit;
          
          // Count items sold - optimized
          if (Array.isArray(doc.items) && doc.items.length > 0) {
            itemsSold += doc.items.reduce((sum, item) => sum + safeNumeric(item.quantity), 0);
          }
          
        } else if (doc.type === 'RETURN') {
          totalReturnCount += 1;
          const returnValue = Math.abs(safeNumeric(doc.totalReturnValue));
          totalReturnValue += returnValue;
          
          // Count returned items
          if (Array.isArray(doc.items) && doc.items.length > 0) {
            itemsReturned += doc.items.reduce((sum, item) => 
              sum + safeNumeric(item.returnQuantity || item.quantity), 0);
          }
          
          // 🚀 OPTIMIZED: Calculate returned profit based on original sale proportion
          const originalSale = originalSalesMap.get(doc.originalInvoiceId);
          if (originalSale && originalSale.total > 0) {
            const returnProportion = Math.min(returnValue / originalSale.total, 1); // Cap at 100%
            const returnedProfit = originalSale.profit * returnProportion;
            totalReturnedProfit += returnedProfit;
          }
        }
      } catch (error) {
        // Skip problematic documents without logging in production
        if (process.env.NODE_ENV === 'development') {
          console.warn('Error processing sales document:', doc._id, error);
        }
      }
    });
    
    salesProcessTimer();

    // Calculate net values
    const totalNetRevenue = totalGrossRevenue - totalReturnValue;
    const totalNetProfit = totalGrossProfit - totalReturnedProfit;
    const netItemsSold = itemsSold - itemsReturned;

    // --- 3. 🚀 OPTIMIZED Purchase Value Calculations ---
    let grossPurchases = 0, totalSupplierRefundValue = 0;
    
    if (filteredPurchasesAndReturns.length > 0) {
      filteredPurchasesAndReturns.forEach(doc => {
        if (!doc) return;
        
        try {
          if (doc.type === 'PURCHASE') {
            grossPurchases += safeNumeric(doc.totals?.grandTotal || doc.total);
          } else if (doc.type === 'PURCHASE_RETURN') {
            totalSupplierRefundValue += safeNumeric(doc.totalReturnValue);
          }
        } catch (error) {
          // Skip silently
        }
      });
    }
    
    // --- 4. 🚀 OPTIMIZED Cash Flow Calculations ---
    let cashInflow = 0, cashOutflow = 0, totalCustomerRefundValue = 0;

    // Process sales and returns for cash flow
    filteredSalesAndReturns.forEach(doc => {
      if (!doc) return;
      
      try {
        if (doc.type === 'SALE') {
          cashInflow += safeNumeric(doc.amountPaid);
        } else if (doc.type === 'RETURN') {
          const returnValue = Math.abs(safeNumeric(doc.totalReturnValue));
          totalCustomerRefundValue += returnValue;
          
          // Only count actual cash refunds
          if (doc.settlement?.type === 'REFUND' || doc.refundType === 'REFUND') {
            const cashRefundAmount = safeNumeric(doc.settlement?.amountRefunded || returnValue);
            cashOutflow += cashRefundAmount;
          }
        }
      } catch (error) {
        // Skip silently
      }
    });
    
    // Process purchases for cash flow
    if (filteredPurchasesAndReturns.length > 0) {
      filteredPurchasesAndReturns.forEach(doc => {
        if (!doc) return;
        
        try {
          if (doc.type === 'PURCHASE') {
            cashOutflow += safeNumeric(doc.amountPaid);
          } else if (doc.type === 'PURCHASE_RETURN' && doc.settlement?.type === 'REFUND') {
            cashInflow += safeNumeric(doc.settlement.amountRefunded);
          }
        } catch (error) {
          // Skip silently
        }
      });
    }
    
    // Process standalone transactions
    if (filteredTransactions.length > 0) {
      filteredTransactions.forEach(tx => {
        if (!tx) return;
        
        try {
          if (tx.type === 'SUPPLIER_PAYMENT') {
            const amount = safeNumeric(tx.amountPaid);
            if (tx.direction === 'out') {
              cashOutflow += amount;
            } else if (tx.direction === 'in') {
              cashInflow += amount;
            }
          } else if (tx.type === 'PAYMENT' && tx.description?.includes?.('Payment received')) {
            cashInflow += Math.abs(safeNumeric(tx.amount));
          }
        } catch (error) {
          // Skip silently
        }
      });
    }

    const netCashFlow = cashInflow - cashOutflow;

    // --- 5. 🚀 OPTIMIZED Customer and Supplier Balance Calculations ---
    let totalReceivable = 0, customerCredit = 0;
    let totalPayable = 0, supplierCredit = 0;

    try {
      // Use batch processing for better performance
      if (Array.isArray(customers) && customers.length > 0) {
        const balanceCalcTimer = perfLog.time('Calculate Customer Balances');
        
        customers.forEach(customer => {
          if (!customer) return;
          const balance = safeNumeric(customer.balance);
          if (balance > 0) {
            totalReceivable += balance;
          } else if (balance < 0) {
            customerCredit += Math.abs(balance);
          }
        });
        
        balanceCalcTimer();
      }

      if (Array.isArray(suppliers) && suppliers.length > 0) {
        suppliers.forEach(supplier => {
          if (!supplier) return;
          const balance = safeNumeric(supplier.balance);
          if (balance > 0) {
            totalPayable += balance;
          } else if (balance < 0) {
            supplierCredit += Math.abs(balance);
          }
        });
      }
    } catch (error) {
      console.warn('Error calculating balances:', error);
    }

    // --- 6. Final Aggregation ---
    const netTotalPurchase = grossPurchases - totalSupplierRefundValue;
    const averageSale = totalSalesCount > 0 ? totalNetRevenue / totalSalesCount : 0;

    const finalStats = {
      totalSales: Math.max(0, totalSalesCount),
      itemsSold: Math.max(0, netItemsSold),
      revenue: totalNetRevenue,
      profit: totalNetProfit,
      averageSale: Math.max(0, averageSale),
      cashInflow: Math.max(0, cashInflow),
      cashOutflow: Math.max(0, cashOutflow),
      netCashFlow: netCashFlow,
      totalSupplierRefund: Math.max(0, totalSupplierRefundValue),
      totalCustomerRefund: Math.max(0, totalCustomerRefundValue),
      totalReceivable: Math.max(0, totalReceivable),
      totalPayable: Math.max(0, totalPayable),
      customerCredit: Math.max(0, customerCredit),
      supplierCredit: Math.max(0, supplierCredit),
      totalPurchase: Math.max(0, netTotalPurchase),
    };

    console.log('✅ Stats calculated successfully');
    endTimer();
    return finalStats;

  } catch (error) {
    console.error('❌ Error calculating stats:', error);
    endTimer();
    return getDefaultStats();
  }
};

// Default stats object
const getDefaultStats = () => ({
  totalSales: 0,
  itemsSold: 0,
  revenue: 0,
  profit: 0,
  averageSale: 0,
  cashInflow: 0,
  cashOutflow: 0,
  netCashFlow: 0,
  totalSupplierRefund: 0,
  totalCustomerRefund: 0,
  totalReceivable: 0,
  totalPayable: 0,
  customerCredit: 0,
  supplierCredit: 0,
  totalPurchase: 0,
});

// --- 🚀 OPTIMIZED Chart Data Processing Logic ---
export const processChartData = (salesDocs) => {
  const endTimer = perfLog.time('Process Chart Data');
  
  try {
    if (!Array.isArray(salesDocs) || salesDocs.length === 0) {
      console.log('⚡ No sales data for charts, returning default');
      endTimer();
      return getDefaultChartData();
    }

    console.log('📈 Processing chart data for', salesDocs.length, 'sales documents');

    const dailyData = {}, weeklyData = {}, monthlyData = {};

    // Initialize data structures more efficiently
    const initializeData = () => {
      const now = new Date();
      
      // Initialize daily data (14 days)
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = getDayKey(d);
        if (key) dailyData[key] = { revenue: 0, sales: 0, profit: 0 };
      }
      
      // Initialize weekly data (12 weeks)
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - (i * 7));
        const key = getWeekKey(d);
        if (key) weeklyData[key] = { revenue: 0, sales: 0, profit: 0 };
      }
      
      // Initialize monthly data (12 months)
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - i, 1);
        const key = getMonthKey(d);
        if (key) monthlyData[key] = { revenue: 0, sales: 0, profit: 0 };
      }
    };

    initializeData();

    // Build original sales map for return calculations
    const originalSalesMap = new Map();
    salesDocs.forEach(doc => {
      if (doc?.type === 'SALE' && doc._id) {
        originalSalesMap.set(doc._id, {
          profit: safeNumeric(doc.profit),
          total: safeNumeric(doc.total)
        });
      }
    });

    // Process each sales document
    salesDocs.forEach(doc => {
      if (!doc) return;
      
      try {
        const date = safeParseDate(doc.createdAt || doc.returnedAt);
        if (!date) return;
        
        const dayKey = getDayKey(date);
        const weekKey = getWeekKey(date);
        const monthKey = getMonthKey(date);

        let revenue = 0, profit = 0, salesCount = 0;
        
        if (doc.type === 'SALE') {
          revenue = safeNumeric(doc.subtotal) - safeNumeric(doc.totalDiscountAmount) - safeNumeric(doc.flatDiscount?.amount);
          salesCount = 1;
          profit = safeNumeric(doc.profit);
          
        } else if (doc.type === 'RETURN') {
          const returnValue = Math.abs(safeNumeric(doc.totalReturnValue));
          revenue = -returnValue;
          
          // Calculate returned profit proportionally
          const originalSale = originalSalesMap.get(doc.originalInvoiceId);
          if (originalSale && originalSale.total > 0) {
            const returnProportion = Math.min(returnValue / originalSale.total, 1);
            profit = -(originalSale.profit * returnProportion);
          } else {
            profit = -returnValue * 0.2; // Fallback estimate
          }
        }

        // Update data points efficiently
        const updateData = (dataObj, key) => {
          if (key && dataObj[key]) {
            dataObj[key].revenue += revenue;
            dataObj[key].sales += salesCount;
            dataObj[key].profit += profit;
          }
        };

        updateData(dailyData, dayKey);
        updateData(weeklyData, weekKey);
        updateData(monthlyData, monthKey);
        
      } catch (error) {
        // Skip problematic documents
      }
    });

    const processGroupedData = (groupedData) => {
      const sortedKeys = Object.keys(groupedData).sort();
      return {
        labels: sortedKeys,
        revenue: sortedKeys.map(k => groupedData[k].revenue),
        sales: sortedKeys.map(k => Math.max(0, groupedData[k].sales)),
        profit: sortedKeys.map(k => groupedData[k].profit),
      };
    };
    
    const result = {
      daily: processGroupedData(dailyData),
      weekly: processGroupedData(weeklyData),
      monthly: processGroupedData(monthlyData),
    };

    console.log('✅ Chart data processed successfully');
    endTimer();
    return result;

  } catch (error) {
    console.error('❌ Error processing chart data:', error);
    endTimer();
    return getDefaultChartData();
  }
};

// Default chart data structure
const getDefaultChartData = () => ({
  daily: { labels: [], revenue: [], sales: [], profit: [] },
  weekly: { labels: [], revenue: [], sales: [], profit: [] },
  monthly: { labels: [], revenue: [], sales: [], profit: [] },
});

// --- 🚀 OPTIMIZED Heatmap Data Processing Logic ---
export const processHeatmapData = (allDocs) => {
  const endTimer = perfLog.time('Process Heatmap Data');
  
  try {
    if (!allDocs || typeof allDocs !== 'object') {
      endTimer();
      return { cashflowHeatmap: {} };
    }

    const { sales = [], purchases = [] } = allDocs;
    
    // Early exit if no data
    if (!Array.isArray(sales) && !Array.isArray(purchases)) {
      endTimer();
      return { cashflowHeatmap: {} };
    }

    console.log('🔥 Processing heatmap data...');
    const cashflowHeatmap = {};

    const recordCashflow = (dateValue, inflow = 0, outflow = 0) => {
      if (inflow === 0 && outflow === 0) return; // Skip empty entries
      
      try {
        const date = safeParseDate(dateValue);
        if (!date) return;
        
        const key = getDayKey(date);
        if (!key) return;
        
        if (!cashflowHeatmap[key]) {
          cashflowHeatmap[key] = { inflow: 0, outflow: 0 };
        }
        cashflowHeatmap[key].inflow += Math.max(0, inflow);
        cashflowHeatmap[key].outflow += Math.max(0, outflow);
      } catch (error) {
        // Skip silently
      }
    };

    // Process sales and customer refunds
    if (Array.isArray(sales) && sales.length > 0) {
      sales.forEach(doc => {
        if (!doc) return;
        
        try {
          if (doc.type === 'SALE') {
            const amountPaid = safeNumeric(doc.amountPaid);
            if (amountPaid > 0) {
              recordCashflow(doc.createdAt, amountPaid, 0);
            }
          } else if (doc.type === 'RETURN' && (doc.refundType === 'REFUND' || doc.settlement?.type === 'REFUND')) {
            const refundAmount = safeNumeric(doc.settlement?.amountRefunded || doc.totalReturnValue);
            if (refundAmount > 0) {
              recordCashflow(doc.returnedAt, 0, refundAmount);
            }
          }
        } catch (error) {
          // Skip silently
        }
      });
    }

    // Process purchases
    if (Array.isArray(purchases) && purchases.length > 0) {
      purchases.forEach(doc => {
        if (!doc) return;
        
        try {
          if (doc.type === 'PURCHASE') {
            const amountPaid = safeNumeric(doc.amountPaid);
            if (amountPaid > 0) {
              recordCashflow(doc.createdAt, 0, amountPaid);
            }
          } else if (doc.type === 'PURCHASE_RETURN' && doc.settlement?.type === 'REFUND') {
            const refundAmount = safeNumeric(doc.settlement.amountRefunded);
            if (refundAmount > 0) {
              recordCashflow(doc.returnedAt, refundAmount, 0);
            }
          }
        } catch (error) {
          // Skip silently
        }
      });
    }

    console.log('✅ Heatmap data processed successfully');
    endTimer();
    return { cashflowHeatmap };

  } catch (error) {
    console.error('❌ Error processing heatmap data:', error);
    endTimer();
    return { cashflowHeatmap: {} };
  }
};

// --- 🚀 OPTIMIZED Peak Hours Data Processing Logic ---
export const processPeakHoursData = (salesDocs) => {
  const endTimer = perfLog.time('Process Peak Hours Data');
  
  try {
    if (!Array.isArray(salesDocs) || salesDocs.length === 0) {
      endTimer();
      return getDefaultPeakHoursData();
    }

    console.log('⏰ Processing peak hours data for', salesDocs.length, 'sales documents');
    
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    const dayOfWeek = weekStart.getDay();
    const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const initHourArray = () => ({ 
      revenue: Array(24).fill(0), 
      profit: Array(24).fill(0), 
      sales: Array(24).fill(0) 
    });
    
    const data = {
      daily: initHourArray(),
      weekly: initHourArray(),
      monthly: initHourArray(),
    };

    // Build original sales map for return calculations
    const originalSalesMap = new Map();
    salesDocs.forEach(doc => {
      if (doc?.type === 'SALE' && doc._id) {
        originalSalesMap.set(doc._id, {
          profit: safeNumeric(doc.profit),
          total: safeNumeric(doc.total)
        });
      }
    });

    salesDocs.forEach(doc => {
      if (!doc) return;
      
      try {
        const date = safeParseDate(doc.createdAt || doc.returnedAt);
        if (!date) return;
        
        const hour = date.getHours();
        if (hour < 0 || hour > 23) return; // Validate hour
        
        let revenue = 0, profit = 0, salesCount = 0;

        if (doc.type === 'SALE') {
          revenue = safeNumeric(doc.subtotal) - safeNumeric(doc.totalDiscountAmount) - safeNumeric(doc.flatDiscount?.amount);
          profit = safeNumeric(doc.profit);
          salesCount = 1;
        } else if (doc.type === 'RETURN') {
          const returnValue = Math.abs(safeNumeric(doc.totalReturnValue));
          revenue = -returnValue;
          
          // Calculate returned profit proportionally
          const originalSale = originalSalesMap.get(doc.originalInvoiceId);
          if (originalSale && originalSale.total > 0) {
            const returnProportion = Math.min(returnValue / originalSale.total, 1);
            profit = -(originalSale.profit * returnProportion);
          } else {
            profit = -returnValue * 0.2; // Fallback
          }
        }

        // Update hourly data based on time periods
        if (date >= todayStart) {
          data.daily.revenue[hour] += revenue;
          data.daily.profit[hour] += profit;
          data.daily.sales[hour] += salesCount;
        }
        if (date >= weekStart) {
          data.weekly.revenue[hour] += revenue;
          data.weekly.profit[hour] += profit;
          data.weekly.sales[hour] += salesCount;
        }
        if (date >= monthStart) {
          data.monthly.revenue[hour] += revenue;
          data.monthly.profit[hour] += profit;
          data.monthly.sales[hour] += salesCount;
        }
      } catch (error) {
        // Skip problematic documents
      }
    });
    
    console.log('✅ Peak hours data processed successfully');
    endTimer();
    return data;

  } catch (error) {
    console.error('❌ Error processing peak hours data:', error);
    endTimer();
    return getDefaultPeakHoursData();
  }
};

// Default peak hours data structure
const getDefaultPeakHoursData = () => ({
  daily: { revenue: Array(24).fill(0), profit: Array(24).fill(0), sales: Array(24).fill(0) },
  weekly: { revenue: Array(24).fill(0), profit: Array(24).fill(0), sales: Array(24).fill(0) },
  monthly: { revenue: Array(24).fill(0), profit: Array(24).fill(0), sales: Array(24).fill(0) },
});

// --- 🚀 OPTIMIZED Utility Functions ---

export const calculateSalesTrends = (currentPeriodData, previousPeriodData) => {
  try {
    const current = safeNumeric(currentPeriodData);
    const previous = safeNumeric(previousPeriodData);
    
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    
    return ((current - previous) / previous) * 100;
  } catch (error) {
    return 0;
  }
};

export const formatCurrency = (amount, currency = 'PKR') => {
  try {
    const num = safeNumeric(amount);
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(num);
  } catch (error) {
    return `${currency} ${safeNumeric(amount).toFixed(2)}`;
  }
};

export const formatPercentage = (value, decimals = 1) => {
  try {
    const num = safeNumeric(value);
    return `${num.toFixed(decimals)}%`;
  } catch (error) {
    return '0.0%';
  }
};

export const getTimePeriodLabel = (timeframe, customDateRange) => {
  try {
    switch (timeframe) {
      case 'today':
        return 'Today';
      case 'week':
        return 'This Week';
      case 'month':
        return 'This Month';
      case 'custom':
        if (customDateRange?.start && customDateRange?.end) {
          const start = new Date(customDateRange.start).toLocaleDateString();
          const end = new Date(customDateRange.end).toLocaleDateString();
          return `${start} - ${end}`;
        }
        return 'Custom Range';
      default:
        return 'Unknown Period';
    }
  } catch (error) {
    return 'Unknown Period';
  }
};

export const validateDashboardData = (data) => {
  const errors = [];
  
  try {
    if (!data.stats || typeof data.stats !== 'object') {
      errors.push('Invalid or missing stats data');
    }
    
    if (!data.chartData || typeof data.chartData !== 'object') {
      errors.push('Invalid or missing chart data');
    } else {
      ['daily', 'weekly', 'monthly'].forEach(period => {
        if (!data.chartData[period] || typeof data.chartData[period] !== 'object') {
          errors.push(`Invalid ${period} chart data`);
        }
      });
    }
    
    if (!data.peakHoursData || typeof data.peakHoursData !== 'object') {
      errors.push('Invalid or missing peak hours data');
    }
    
    if (!data.cashflowHeatmapData || typeof data.cashflowHeatmapData !== 'object') {
      errors.push('Invalid or missing heatmap data');
    }
    
  } catch (error) {
    errors.push(`Validation error: ${error.message}`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};
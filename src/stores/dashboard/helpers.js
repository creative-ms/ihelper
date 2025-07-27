// =================================================================================
// CONSOLIDATED FILE: src/stores/dashboard/helpers.js
// =================================================================================

// Import the product analytics functions
import { 
    analyzeProductPerformance, 
    getProductPerformanceSummary,
    processProductPerformanceData 
} from './productPerformanceHelpers';

// --- Helper Functions for Date Operations ---
const getDayKey = (date) => {
    const d = new Date(date);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
};

const getWeekKey = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
};

const getMonthKey = (date) => `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;

// --- Stats Calculation Logic ---
export const calculateStats = (allDocs, timeframe, customDateRange) => {
    let statsStartDate, statsEndDate = new Date();
    const now = new Date();

    if (timeframe === 'custom' && customDateRange.start && customDateRange.end) {
        statsStartDate = new Date(customDateRange.start);
        statsEndDate = new Date(customDateRange.end);
    } else if (timeframe === 'today') {
        statsStartDate = new Date(new Date().setHours(0, 0, 0, 0));
    } else if (timeframe === 'week') {
        const firstDay = now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1);
        statsStartDate = new Date(new Date().setDate(firstDay));
        statsStartDate.setHours(0, 0, 0, 0);
    } else {
        statsStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    statsEndDate.setHours(23, 59, 59, 999);

    const filterByDate = (doc) => {
        const docDate = new Date(doc.createdAt || doc.returnedAt || doc.date);
        return !isNaN(docDate) && docDate >= statsStartDate && docDate <= statsEndDate;
    };

    const filteredSalesAndReturns = allDocs.sales.filter(filterByDate);
    const filteredPurchasesAndReturns = allDocs.purchases.filter(filterByDate);
    const filteredTransactions = allDocs.transactions.filter(filterByDate);

    let totalNetRevenue = 0, totalProfit = 0, itemsSold = 0;

    filteredSalesAndReturns.forEach(doc => {
        if (doc.type === 'SALE') {
            totalNetRevenue += (doc.total || 0);
            totalProfit += doc.profit || 0;
            itemsSold += (doc.items || []).reduce((sum, item) => sum + item.quantity, 0);
        } else if (doc.type === 'RETURN') {
            totalNetRevenue -= doc.totalReturnValue || 0;
            itemsSold -= (doc.items || []).reduce((sum, item) => sum + item.returnQuantity, 0);
            const originalSale = allDocs.sales.find(s => s._id === doc.originalInvoiceId);
            if (originalSale) { totalProfit -= originalSale.profit || 0; }
        }
    });

    let grossPurchases = 0, totalSupplierRefundValue = 0;
    filteredPurchasesAndReturns.forEach(doc => {
        if (doc.type === 'PURCHASE') {
            grossPurchases += doc.totals?.grandTotal || 0;
        } else if (doc.type === 'PURCHASE_RETURN') {
            totalSupplierRefundValue += doc.totalReturnValue || 0;
        }
    });

    let cashInflow = 0, cashOutflow = 0, totalCustomerRefundValue = 0;

    filteredSalesAndReturns.forEach(doc => {
        if (doc.type === 'SALE') {
            cashInflow += doc.amountPaid || 0;
        } else if (doc.type === 'RETURN') {
            totalCustomerRefundValue += doc.totalReturnValue || 0;
            if (doc.settlement?.type === 'REFUND') {
                cashOutflow += doc.settlement.amountRefunded || 0;
            }
        }
    });

    filteredPurchasesAndReturns.forEach(doc => {
        if (doc.type === 'PURCHASE') {
            cashOutflow += doc.amountPaid || 0;
        }
        if (doc.type === 'PURCHASE_RETURN' && doc.settlement?.type === 'REFUND') {
            cashInflow += doc.settlement.amountRefunded || 0;
        }
    });

    filteredTransactions.forEach(tx => {
        if (tx.type === 'SUPPLIER_PAYMENT') {
            if (tx.direction === 'out') cashOutflow += tx.amountPaid || 0;
            else if (tx.direction === 'in') cashInflow += tx.amountPaid || 0;
        }
        if (tx.type === 'PAYMENT' && tx.description?.includes('Payment received via')) {
            cashInflow += Math.abs(tx.amount) || 0;
        }
    });

    const netCashFlow = cashInflow - cashOutflow;
    const netTotalPurchase = grossPurchases - totalSupplierRefundValue;
    const totalSalesCount = filteredSalesAndReturns.filter(d => d.type === 'SALE').length;
    const totalReturnCount = filteredSalesAndReturns.filter(d => d.type === 'RETURN').length;
    const netSalesCount = totalSalesCount - totalReturnCount;

    return {
        totalSales: netSalesCount,
        itemsSold,
        revenue: totalNetRevenue,
        profit: totalProfit,
        averageSale: totalSalesCount > 0 ? totalNetRevenue / totalSalesCount : 0,
        cashInflow,
        cashOutflow,
        netCashFlow,
        totalSupplierRefund: totalSupplierRefundValue,
        totalCustomerRefund: totalCustomerRefundValue,
        totalReceivable: allDocs.customers.reduce((sum, c) => sum + Math.max(0, c.balance || 0), 0),
        totalPayable: allDocs.suppliers.reduce((sum, s) => sum + Math.max(0, s.balance || 0), 0),
        customerCredit: allDocs.customers.reduce((sum, c) => sum + Math.abs(Math.min(0, c.balance || 0)), 0),
        supplierCredit: allDocs.suppliers.reduce((sum, s) => sum + Math.abs(Math.min(0, s.balance || 0)), 0),
        totalPurchase: netTotalPurchase,
    };
};

// --- Chart Data Processing ---
export const processChartData = (salesDocs) => {
    const dailyData = {}, weeklyData = {}, monthlyData = {};

    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = getDayKey(d);
        if (key) dailyData[key] = { revenue: 0, sales: 0, profit: 0 };
    }

    for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i, 1);
        const key = getMonthKey(d);
        if (key) monthlyData[key] = { revenue: 0, sales: 0, profit: 0 };
    }

    salesDocs.forEach(doc => {
        const rawDate = doc.createdAt || doc.returnedAt || doc.date;
        const date = new Date(rawDate);
        if (isNaN(date)) return;

        const dayKey = getDayKey(date);
        const weekKey = getWeekKey(date);
        const monthKey = getMonthKey(date);

        let revenue = 0, profit = 0, salesCount = 0;

        if (doc.type === 'SALE') {
            revenue = (doc.subtotal || 0) - ((doc.totalDiscountAmount || 0) + (doc.flatDiscount?.amount || 0));
            salesCount = 1;
            let saleCogs = 0;
            (doc.items || []).forEach(item => {
                saleCogs += (item.sourceBatchInfo?.purchasePrice || 0) * (item.quantity || 0);
            });
            profit = revenue - saleCogs;
        } else if (doc.type === 'RETURN') {
            revenue = -(doc.totalReturnValue || 0);
            let returnedCogs = 0;
            (doc.items || []).forEach(item => {
                returnedCogs += (item.sourceBatchInfo?.purchasePrice || 0) * (item.returnQuantity || 0);
            });
            profit = -((doc.totalReturnValue || 0) - returnedCogs);
        }

        if (dailyData[dayKey]) {
            dailyData[dayKey].revenue += revenue;
            dailyData[dayKey].sales += salesCount;
            dailyData[dayKey].profit += profit;
        }
        if (weeklyData[weekKey]) {
            weeklyData[weekKey].revenue += revenue;
            weeklyData[weekKey].sales += salesCount;
            weeklyData[weekKey].profit += profit;
        }
        if (monthlyData[monthKey]) {
            monthlyData[monthKey].revenue += revenue;
            monthlyData[monthKey].sales += salesCount;
            monthlyData[monthKey].profit += profit;
        }
    });

    const processGroupedData = (groupedData) => {
        const sortedKeys = Object.keys(groupedData).sort();
        return {
            labels: sortedKeys,
            revenue: sortedKeys.map(k => groupedData[k].revenue),
            sales: sortedKeys.map(k => groupedData[k].sales),
            profit: sortedKeys.map(k => groupedData[k].profit),
        };
    };

    return {
        daily: processGroupedData(dailyData),
        weekly: processGroupedData(weeklyData),
        monthly: processGroupedData(monthlyData),
    };
};

// --- Heatmap Data Processing ---
export const processHeatmapData = (allDocs) => {
    const cashflowHeatmap = {};

    const recordCashflow = (date, inflow = 0, outflow = 0) => {
        const key = getDayKey(date);
        if (!key) return;
        if (!cashflowHeatmap[key]) {
            cashflowHeatmap[key] = { inflow: 0, outflow: 0 };
        }
        cashflowHeatmap[key].inflow += inflow;
        cashflowHeatmap[key].outflow += outflow;
    };

    allDocs.sales.forEach(doc => {
        if (doc.type === 'SALE') {
            recordCashflow(doc.createdAt, doc.amountPaid || 0, 0);
        } else if (doc.type === 'RETURN' && doc.refundType === 'REFUND') {
            recordCashflow(doc.returnedAt, 0, doc.settlement?.amountRefunded || doc.totalReturnValue || 0);
        }
    });

    allDocs.purchases.forEach(doc => {
        if (doc.type === 'PURCHASE') {
            recordCashflow(doc.createdAt, 0, doc.amountPaid || 0);
        }
    });

    return { cashflowHeatmap };
};

// --- Peak Hours Data Processing ---
export const processPeakHoursData = (salesDocs) => {
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const initHourArray = () => ({ revenue: Array(24).fill(0), profit: Array(24).fill(0), sales: Array(24).fill(0) });
    const data = { daily: initHourArray(), weekly: initHourArray(), monthly: initHourArray() };

    salesDocs.forEach(doc => {
        if (doc.type !== 'SALE') return;
        const date = new Date(doc.createdAt);
        if (isNaN(date)) return;

        const hour = date.getHours();
        const revenue = (doc.subtotal || 0) - ((doc.totalDiscountAmount || 0) + (doc.flatDiscount?.amount || 0));
        let saleCogs = 0;
        (doc.items || []).forEach(item => {
            saleCogs += (item.sourceBatchInfo?.purchasePrice || 0) * (item.quantity || 0);
        });
        const profit = revenue - saleCogs;

        if (date >= todayStart) {
            data.daily.revenue[hour] += revenue;
            data.daily.profit[hour] += profit;
            data.daily.sales[hour] += 1;
        }
        if (date >= weekStart) {
            data.weekly.revenue[hour] += revenue;
            data.weekly.profit[hour] += profit;
            data.weekly.sales[hour] += 1;
        }
        if (date >= monthStart) {
            data.monthly.revenue[hour] += revenue;
            data.monthly.profit[hour] += profit;
            data.monthly.sales[hour] += 1;
        }
    });

    return data;
};

// --- NEW: Product Performance Analysis Integration ---
export const processProductAnalytics = (allDocs, timeframe, customDateRange) => {
    if (!allDocs.sales || !allDocs.products) {
        return {
            topSellingProducts: [],
            slowMovingProducts: [],
            productPerformanceSummary: {
                topSellingProducts: [],
                slowMovingProducts: [],
                metrics: {
                    totalActiveProducts: 0,
                    productsWithSales: 0,
                    slowMovingCount: 0,
                    salesPerformanceRate: 0
                }
            }
        };
    }

    try {
        return processProductPerformanceData(allDocs, timeframe, customDateRange);
    } catch (error) {
        console.error('Error processing product analytics:', error);
        return {
            topSellingProducts: [],
            slowMovingProducts: [],
            productPerformanceSummary: {
                topSellingProducts: [],
                slowMovingProducts: [],
                metrics: {
                    totalActiveProducts: 0,
                    productsWithSales: 0,  
                    slowMovingCount: 0,
                    salesPerformanceRate: 0
                }
            }
        };
    }
};

// Re-export the product analytics functions for direct use
export { 
    analyzeProductPerformance, 
    getProductPerformanceSummary,
    processProductPerformanceData
} from './productPerformanceHelpers';
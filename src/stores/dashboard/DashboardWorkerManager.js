// ===================================
// Enhanced Non-Blocking Dashboard Cache System
// File: src/stores/dashboard/DashboardWorkerManager.js
// Ensures dashboard operations never block the main thread
// ===================================

import CacheManager from '../../utils/cache/index';

class EnhancedDashboardWorkerManager {
  constructor() {
    this.worker = null;
    this.taskQueue = [];
    this.isProcessing = false;
    this.priority = 1; // Lower number = higher priority
    this.initWorker();
  }

  initWorker() {
    const workerCode = `
      // Enhanced dashboard calculation worker with complete implementations
      class DashboardProcessor {
        
        // Helper Functions for Date Operations
        static getDayKey(date) {
          const d = new Date(date);
          return isNaN(d) ? null : d.toISOString().split('T')[0];
        }

        static getWeekKey(date) {
          const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
          d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
          const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
          const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
          return d.getUTCFullYear() + '-W' + weekNo.toString().padStart(2, '0');
        }

        static getMonthKey(date) {
          return date.getFullYear() + '-' + (date.getMonth() + 1).toString().padStart(2, '0');
        }

        // Calculate stats in chunks to prevent blocking
        static calculateStatsInChunks(allDocs, timeframe, customDateRange, chunkSize = 100) {
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

          const filteredSalesAndReturns = (allDocs.sales || []).filter(filterByDate);
          const filteredPurchasesAndReturns = (allDocs.purchases || []).filter(filterByDate);
          const filteredTransactions = (allDocs.transactions || []).filter(filterByDate);

          let totalNetRevenue = 0, totalProfit = 0, itemsSold = 0;
          let processedCount = 0;

          // Process sales/returns in chunks
          for (let i = 0; i < filteredSalesAndReturns.length; i += chunkSize) {
            const chunk = filteredSalesAndReturns.slice(i, i + chunkSize);
            
            chunk.forEach(doc => {
              if (doc.type === 'SALE') {
                totalNetRevenue += (doc.total || 0);
                totalProfit += doc.profit || 0;
                itemsSold += (doc.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
              } else if (doc.type === 'RETURN') {
                totalNetRevenue -= doc.totalReturnValue || 0;
                itemsSold -= (doc.items || []).reduce((sum, item) => sum + (item.returnQuantity || 0), 0);
                // Find original sale for profit calculation
                const originalSale = allDocs.sales?.find(s => s._id === doc.originalInvoiceId);
                if (originalSale) { 
                  totalProfit -= originalSale.profit || 0; 
                }
              }
            });

            processedCount += chunk.length;
            
            // Report progress every 5 chunks
            if (i % (chunkSize * 5) === 0) {
              self.postMessage({ 
                type: 'PROGRESS', 
                processed: processedCount, 
                total: filteredSalesAndReturns.length,
                stage: 'sales'
              });
            }
          }

          // Process purchases/returns
          let grossPurchases = 0, totalSupplierRefundValue = 0;
          filteredPurchasesAndReturns.forEach(doc => {
            if (doc.type === 'PURCHASE') {
              grossPurchases += doc.totals?.grandTotal || 0;
            } else if (doc.type === 'PURCHASE_RETURN') {
              totalSupplierRefundValue += doc.totalReturnValue || 0;
            }
          });

          // Process transactions for cash flow
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

          // Calculate customer/supplier balances
          const totalReceivable = (allDocs.customers || []).reduce((sum, c) => sum + Math.max(0, c.balance || 0), 0);
          const totalPayable = (allDocs.suppliers || []).reduce((sum, s) => sum + Math.max(0, s.balance || 0), 0);
          const customerCredit = (allDocs.customers || []).reduce((sum, c) => sum + Math.abs(Math.min(0, c.balance || 0)), 0);
          const supplierCredit = (allDocs.suppliers || []).reduce((sum, s) => sum + Math.abs(Math.min(0, s.balance || 0)), 0);

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
            totalReceivable,
            totalPayable,
            customerCredit,
            supplierCredit,
            totalPurchase: netTotalPurchase,
          };
        }

        static processChartDataInChunks(salesDocs, chunkSize = 50) {
          const dailyData = {}, weeklyData = {}, monthlyData = {};
          
          // Initialize daily data for last 14 days
          for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = this.getDayKey(d);
            if (key) dailyData[key] = { revenue: 0, sales: 0, profit: 0 };
          }

          // Initialize monthly data for last 12 months
          for (let i = 11; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i, 1);
            const key = this.getMonthKey(d);
            if (key) monthlyData[key] = { revenue: 0, sales: 0, profit: 0 };
          }

          // Process sales in chunks
          for (let i = 0; i < salesDocs.length; i += chunkSize) {
            const chunk = salesDocs.slice(i, i + chunkSize);
            
            chunk.forEach(doc => {
              const rawDate = doc.createdAt || doc.returnedAt || doc.date;
              const date = new Date(rawDate);
              if (isNaN(date)) return;

              const dayKey = this.getDayKey(date);
              const weekKey = this.getWeekKey(date);
              const monthKey = this.getMonthKey(date);

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

              // Update data structures
              if (dailyData[dayKey]) {
                dailyData[dayKey].revenue += revenue;
                dailyData[dayKey].sales += salesCount;
                dailyData[dayKey].profit += profit;
              }
              
              if (!weeklyData[weekKey]) {
                weeklyData[weekKey] = { revenue: 0, sales: 0, profit: 0 };
              }
              weeklyData[weekKey].revenue += revenue;
              weeklyData[weekKey].sales += salesCount;
              weeklyData[weekKey].profit += profit;
              
              if (monthlyData[monthKey]) {
                monthlyData[monthKey].revenue += revenue;
                monthlyData[monthKey].sales += salesCount;
                monthlyData[monthKey].profit += profit;
              }
            });

            // Progress update
            if (i % (chunkSize * 5) === 0) {
              self.postMessage({ 
                type: 'PROGRESS', 
                processed: i, 
                total: salesDocs.length,
                stage: 'charts'
              });
            }
          }

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
        }

        static processProductAnalyticsInChunks(allDocs, timeframe, customDateRange, chunkSize = 25) {
          const now = new Date();
          let startDate, endDate = new Date();

          if (timeframe === 'custom' && customDateRange.start && customDateRange.end) {
            startDate = new Date(customDateRange.start);
            endDate = new Date(customDateRange.end);
          } else if (timeframe === 'today') {
            startDate = new Date(new Date().setHours(0, 0, 0, 0));
          } else if (timeframe === 'week') {
            const firstDay = now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1);
            startDate = new Date(new Date().setDate(firstDay));
            startDate.setHours(0, 0, 0, 0);
          } else {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          }
          endDate.setHours(23, 59, 59, 999);

          // Filter sales by date and type
          const filteredSales = (allDocs.sales || []).filter(doc => {
            if (doc.type !== 'SALE') return false;
            const docDate = new Date(doc.createdAt);
            return !isNaN(docDate) && docDate >= startDate && docDate <= endDate;
          });

          const productPerformance = new Map();
          const productsDocs = allDocs.products || [];
          
          // Initialize products
          productsDocs.forEach(product => {
            if (product._id && product.name && !product._id.startsWith('_design')) {
              // Calculate current stock
              const currentStock = (product.batches || []).reduce((total, batch) => {
                return total + (Number(batch.quantity) || 0);
              }, 0);

              productPerformance.set(product._id, {
                productId: product._id,
                productName: product.name,
                category: product.category || 'Uncategorized',
                manufacturer: product.manufacturer || 'Unknown',
                quantitySold: 0,
                totalRevenue: 0,
                totalProfit: 0,
                salesCount: 0,
                averageSellingPrice: 0,
                lastSaleDate: null,
                currentStock: currentStock,
                isActive: product.isActive !== false
              });
            }
          });

          // Process sales in chunks
          for (let i = 0; i < filteredSales.length; i += chunkSize) {
            const chunk = filteredSales.slice(i, i + chunkSize);
            
            chunk.forEach(sale => {
              if (!sale.items || !Array.isArray(sale.items)) return;

              sale.items.forEach(item => {
                if (!item._id || item.isManual) return;

                const performance = productPerformance.get(item._id);
                if (!performance) return;

                const quantity = item.quantity || 0;
                const revenue = (item.sellingPrice || 0) * quantity;
                const itemDiscount = revenue * (((item.discountRate || 0) + (item.extraDiscount || 0)) / 100);
                const netRevenue = revenue - itemDiscount;
                
                // Calculate profit (COGS)
                const purchasePrice = item.sourceBatchInfo?.purchasePrice || 0;
                const cogs = this.calculateItemCogs(item, purchasePrice) * quantity;
                const profit = netRevenue - cogs;

                // Update performance metrics
                performance.quantitySold += quantity;
                performance.totalRevenue += netRevenue;
                performance.totalProfit += profit;
                performance.salesCount += 1;
                performance.lastSaleDate = new Date(sale.createdAt);
                
                // Update average selling price
                performance.averageSellingPrice = performance.quantitySold > 0 
                  ? performance.totalRevenue / performance.quantitySold 
                  : 0;
              });
            });

            // Progress update
            if (i % (chunkSize * 10) === 0) {
              self.postMessage({ 
                type: 'PROGRESS', 
                processed: i, 
                total: filteredSales.length,
                stage: 'products'
              });
            }
          }

          // Convert to arrays and sort
          const allProducts = Array.from(productPerformance.values())
            .filter(product => product.isActive);

          const topSellingProducts = [...allProducts]
            .filter(product => product.quantitySold > 0)
            .sort((a, b) => {
              if (b.quantitySold !== a.quantitySold) {
                return b.quantitySold - a.quantitySold;
              }
              return b.totalRevenue - a.totalRevenue;
            })
            .slice(0, 5)
            .map(product => {
              const profitMargin = product.totalRevenue > 0 
                ? ((product.totalProfit / product.totalRevenue) * 100) 
                : 0;
              
              return {
                ...product,
                profitMargin: Math.round(profitMargin * 100) / 100,
                revenuePerSale: product.salesCount > 0 
                  ? Math.round((product.totalRevenue / product.salesCount) * 100) / 100 
                  : 0,
                performance: 'top-seller'
              };
            });

          const slowMovingProducts = [...allProducts]
            .filter(product => {
              const daysSinceLastSale = product.lastSaleDate 
                ? Math.floor((now - product.lastSaleDate) / (1000 * 60 * 60 * 24))
                : Infinity;
              
              return (
                product.quantitySold === 0 || 
                daysSinceLastSale > 30
              ) && product.currentStock > 0;
            })
            .sort((a, b) => {
              const daysA = a.lastSaleDate ? Math.floor((now - a.lastSaleDate) / (1000 * 60 * 60 * 24)) : Infinity;
              const daysB = b.lastSaleDate ? Math.floor((now - b.lastSaleDate) / (1000 * 60 * 60 * 24)) : Infinity;
              
              if (daysB !== daysA) {
                return daysB - daysA;
              }
              return b.currentStock - a.currentStock;
            })
            .slice(0, 5)
            .map(product => {
              const daysSinceLastSale = product.lastSaleDate 
                ? Math.floor((now - product.lastSaleDate) / (1000 * 60 * 60 * 24))
                : null;
              
              return {
                ...product,
                daysSinceLastSale,
                stockValue: product.currentStock * (product.averageSellingPrice || 0),
                riskLevel: this.getRiskLevel(daysSinceLastSale, product.currentStock),
                performance: 'slow-moving'
              };
            });

          const totalProductsWithSales = allProducts.filter(p => p.quantitySold > 0).length;

          return {
            topSellingProducts,
            slowMovingProducts,
            productPerformanceSummary: {
              topSellingProducts: topSellingProducts.slice(0, 3).map(product => ({
                name: product.productName,
                quantitySold: product.quantitySold,
                revenue: Math.round(product.totalRevenue),
                profitMargin: product.profitMargin
              })),
              slowMovingProducts: slowMovingProducts.slice(0, 3).map(product => ({
                name: product.productName,
                daysSinceLastSale: product.daysSinceLastSale,
                currentStock: product.currentStock,
                riskLevel: product.riskLevel
              })),
              metrics: {
                totalActiveProducts: allProducts.length,
                productsWithSales: totalProductsWithSales,
                slowMovingCount: slowMovingProducts.length,
                salesPerformanceRate: allProducts.length > 0 
                  ? Math.round((totalProductsWithSales / allProducts.length) * 100)
                  : 0
              }
            }
          };
        }

        // Helper method to calculate COGS per item
        static calculateItemCogs(item, fallbackPurchasePrice = 0) {
          const purchasePrice = item.sourceBatchInfo?.purchasePrice || fallbackPurchasePrice;
          if (purchasePrice === 0) return 0;
          
          const sellingUnit = item.sellingUnit;
          const stripsPerBox = Number(item.stripsPerBox) || 0;
          const tabletsPerStrip = Number(item.tabletsPerStrip) || 0;
          const unitsPerPack = Number(item.unitsPerPack) || 0;
          const subUnitName = item.subUnitName || 'Unit';
          
          if (sellingUnit === 'Box') return purchasePrice;
          if (sellingUnit === 'Strip' && stripsPerBox > 0) return purchasePrice / stripsPerBox;
          if (sellingUnit === 'Tablet' && stripsPerBox > 0 && tabletsPerStrip > 0) {
            return purchasePrice / (stripsPerBox * tabletsPerStrip);
          }
          if (sellingUnit === subUnitName && unitsPerPack > 0) return purchasePrice / unitsPerPack;
          
          return purchasePrice;
        }

        // Helper method to determine risk level
        static getRiskLevel(daysSinceLastSale, currentStock) {
          if (daysSinceLastSale === null) return 'high';
          if (daysSinceLastSale > 90) return 'high';
          if (daysSinceLastSale > 60) return 'medium';
          if (daysSinceLastSale > 30) return 'low';
          return 'normal';
        }
      }

      // Worker message handler with progress reporting
      self.onmessage = function(e) {
        const { type, data, id } = e.data;
        let result;

        try {
          switch (type) {
            case 'CALCULATE_STATS':
              result = DashboardProcessor.calculateStatsInChunks(
                data.allDocs, 
                data.timeframe, 
                data.customDateRange,
                data.chunkSize || 100
              );
              break;
              
            case 'PROCESS_CHART_DATA':
              result = DashboardProcessor.processChartDataInChunks(
                data.salesDocs,
                data.chunkSize || 50
              );
              break;
              
            case 'PROCESS_PRODUCT_ANALYTICS':
              result = DashboardProcessor.processProductAnalyticsInChunks(
                data.allDocs,
                data.timeframe,
                data.customDateRange,
                data.chunkSize || 25
              );
              break;
              
            default:
              throw new Error('Unknown task type: ' + type);
          }

          self.postMessage({ success: true, result, id });
        } catch (error) {
          self.postMessage({ success: false, error: error.message, id });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    
    this.worker.onmessage = (e) => {
      const { success, result, error, id, type } = e.data;
      
      if (type === 'PROGRESS') {
        // Handle progress updates
        console.log(`Processing ${e.data.stage}: ${e.data.processed}/${e.data.total}`);
        return;
      }
      
      const task = this.taskQueue.find(t => t.id === id);
      if (task) {
        this.taskQueue = this.taskQueue.filter(t => t.id !== id);
        if (success) {
          task.resolve(result);
        } else {
          task.reject(new Error(error));
        }
      }
      
      this.processNextTask();
    };

    this.worker.onerror = (error) => {
      console.error('Worker error:', error);
      // Reject all pending tasks
      this.taskQueue.forEach(task => {
        task.reject(new Error('Worker error: ' + error.message));
      });
      this.taskQueue = [];
      this.isProcessing = false;
    };
  }

  // Execute task with priority and idle callback
  async executeTask(type, data, priority = 1) {
    return new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();
      const task = { id, type, data, resolve, reject, priority };
      
      // Insert task based on priority
      const insertIndex = this.taskQueue.findIndex(t => t.priority > priority);
      if (insertIndex === -1) {
        this.taskQueue.push(task);
      } else {
        this.taskQueue.splice(insertIndex, 0, task);
      }
      
      // Use requestIdleCallback for background processing
      if (typeof window !== 'undefined' && window.requestIdleCallback) {
        window.requestIdleCallback(() => {
          if (!this.isProcessing) {
            this.processNextTask();
          }
        }, { timeout: 2000 });
      } else {
        setTimeout(() => {
          if (!this.isProcessing) {
            this.processNextTask();
          }
        }, 10);
      }
    });
  }

  processNextTask() {
    if (this.taskQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const task = this.taskQueue[0];
    
    this.worker.postMessage({
      type: task.type,
      data: task.data,
      id: task.id
    });
  }

  // Terminate worker
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    // Reject all pending tasks
    this.taskQueue.forEach(task => {
      task.reject(new Error('Worker terminated'));
    });
    this.taskQueue = [];
    this.isProcessing = false;
  }
}

// Enhanced Dashboard Cache with Background Processing
class EnhancedDashboardCache {
  constructor() {
    this.workerManager = new EnhancedDashboardWorkerManager();
    this.isBackgroundProcessing = false;
    this.updateQueue = [];
  }

  // Background data processing that won't block UI
  async processDataInBackground(allDocs, timeframe, customDateRange) {
    if (this.isBackgroundProcessing) {
      console.log('Background processing already in progress');
      return null;
    }

    this.isBackgroundProcessing = true;

    try {
      // Check if we have cached data first
      const [cachedStats, cachedCharts, cachedProducts] = await Promise.all([
        CacheManager.getCachedDashboardStats(timeframe),
        CacheManager.getCachedChartData(),
        CacheManager.getCachedProductAnalytics(timeframe)
      ]);

      // If all data is cached and fresh, return immediately
      if (cachedStats && cachedCharts && cachedProducts) {
        this.isBackgroundProcessing = false;
        return {
          stats: cachedStats,
          chartData: cachedCharts,
          productPerformance: cachedProducts,
          fromCache: true
        };
      }

      // Process missing data in background worker
      const processingPromises = [];

      if (!cachedStats) {
        processingPromises.push(
          this.workerManager.executeTask('CALCULATE_STATS', {
            allDocs,
            timeframe,
            customDateRange,
            chunkSize: 100
          }, 1) // High priority
        );
      }

      if (!cachedCharts) {
        processingPromises.push(
          this.workerManager.executeTask('PROCESS_CHART_DATA', {
            salesDocs: allDocs.sales || [],
            chunkSize: 50
          }, 2) // Medium priority
        );
      }

      if (!cachedProducts) {
        processingPromises.push(
          this.workerManager.executeTask('PROCESS_PRODUCT_ANALYTICS', {
            allDocs,
            timeframe,
            customDateRange,
            chunkSize: 25
          }, 3) // Lower priority
        );
      }

      // Wait for all processing to complete
      const results = await Promise.allSettled(processingPromises);
      
      const [statsResult, chartsResult, productsResult] = results;

      // Cache the new results
      const cachePromises = [];
      
      if (statsResult?.status === 'fulfilled') {
        cachePromises.push(CacheManager.cacheDashboardStats(timeframe, statsResult.value));
      }
      
      if (chartsResult?.status === 'fulfilled') {
        cachePromises.push(CacheManager.cacheChartData(chartsResult.value));
      }
      
      if (productsResult?.status === 'fulfilled') {
        cachePromises.push(CacheManager.cacheProductAnalytics(timeframe, productsResult.value));
      }

      // Cache in background
      Promise.all(cachePromises).catch(console.error);

      this.isBackgroundProcessing = false;

      return {
        stats: statsResult?.status === 'fulfilled' ? statsResult.value : cachedStats,
        chartData: chartsResult?.status === 'fulfilled' ? chartsResult.value :  cachedCharts,
        productPerformance: productsResult?.status === 'fulfilled' ? productsResult.value : cachedProducts,
        fromCache: false
      };

    } catch (error) {
      console.error('Error in background processing:', error);
      this.isBackgroundProcessing = false;
      return null;
    }
  }

  // Preload data for anticipated timeframes
  async preloadData(currentTimeframe) {
    const timeframesToPreload = this.getNextLikelyTimeframes(currentTimeframe);
    
    timeframesToPreload.forEach(timeframe => {
      setTimeout(() => {
        this.workerManager.executeTask('CALCULATE_STATS', {
          allDocs: {},
          timeframe,
          customDateRange: {},
          chunkSize: 100
        }, 5); // Very low priority
      }, 1000);
    });
  }

  // Predict next likely timeframes based on user behavior
  getNextLikelyTimeframes(current) {
    const timeframes = ['today', 'week', 'month'];
    const currentIndex = timeframes.indexOf(current);
    
    if (currentIndex === -1) return ['today', 'week'];
    
    // Return adjacent timeframes
    const next = [];
    if (currentIndex > 0) next.push(timeframes[currentIndex - 1]);
    if (currentIndex < timeframes.length - 1) next.push(timeframes[currentIndex + 1]);
    
    return next;
  }

  // Queue cache updates for batch processing
  queueCacheUpdate(type, data) {
    this.updateQueue.push({ type, data, timestamp: Date.now() });
    
    // Process queue every 5 seconds
    if (this.updateQueue.length === 1) {
      setTimeout(() => this.processUpdateQueue(), 5000);
    }
  }

  // Process queued cache updates in batch
  async processUpdateQueue() {
    if (this.updateQueue.length === 0) return;
    
    const updates = [...this.updateQueue];
    this.updateQueue = [];
    
    try {
      await Promise.all(updates.map(update => {
        switch (update.type) {
          case 'stats':
            return CacheManager.cacheDashboardStats(update.data.timeframe, update.data.stats);
          case 'charts':
            return CacheManager.cacheChartData(update.data.chartData);
          case 'products':
            return CacheManager.cacheProductAnalytics(update.data.timeframe, update.data.analytics);
          default:
            return Promise.resolve();
        }
      }));
      
      console.log(`✅ Processed ${updates.length} cache updates`);
    } catch (error) {
      console.error('Error processing cache updates:', error);
    }
  }

  // Get processing status
  getProcessingStatus() {
    return {
      isProcessing: this.isBackgroundProcessing,
      queueLength: this.workerManager.taskQueue.length,
      updateQueueLength: this.updateQueue.length
    };
  }

  // Cleanup method
  terminate() {
    this.workerManager.terminate();
    this.updateQueue = [];
    this.isBackgroundProcessing = false;
  }

  // Health check method
  async healthCheck() {
    try {
      // Test if worker is responsive
      await this.workerManager.executeTask('CALCULATE_STATS', {
        allDocs: { sales: [], products: [], customers: [], suppliers: [], purchases: [], transactions: [] },
        timeframe: 'today',
        customDateRange: {},
        chunkSize: 1
      }, 10); // Lowest priority
      
      return {
        healthy: true,
        workerResponsive: true,
        queueLength: this.workerManager.taskQueue.length,
        isProcessing: this.isBackgroundProcessing
      };
    } catch (error) {
      return {
        healthy: false,
        workerResponsive: false,
        error: error.message,
        queueLength: this.workerManager.taskQueue.length,
        isProcessing: this.isBackgroundProcessing
      };
    }
  }
}

export default EnhancedDashboardCache;
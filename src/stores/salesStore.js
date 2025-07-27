// salesStore.js - Optimized version with cache integration
import { create } from 'zustand';
import axios from 'axios';
import { useProductStore } from './productStore.js';
import { useInventoryStore } from './inventoryStore.js';
import { useCartStore } from './cartStore.js';
import { useCustomerStore } from './customerStore.js';
import { getUnitConversionFactor } from './validationService.js';
import { useTransactionStore } from './transactionStore.js';
import { useAuditStore } from './auditStore';
import { useAuthStore } from './authStore';
import CacheManager from '../utils/cache/index.js';
import { useSettingsStore } from '../stores/settingsStore';

// --- Performance Configuration ---
const PERFORMANCE_CONFIG = {
  BATCH_SIZE: 50,
  CONCURRENT_REQUESTS: 3,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  DEBOUNCE_DELAY: 300,
};

// --- Database Configuration ---
const SALES_DB_URL = 'http://localhost:5984/sales';
const PRODUCTS_DB_URL = 'http://localhost:5984/products';
const CUSTOMERS_DB_URL = 'http://localhost:5984/customers';
const TRANSACTIONS_DB_URL = 'http://localhost:5984/transactions';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

// --- Performance Monitoring ---
class SalesPerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }

  start(operation) {
    this.metrics.set(operation, performance.now());
  }

  end(operation) {
    const startTime = this.metrics.get(operation);
    if (startTime) {
      const duration = performance.now() - startTime;
      this.metrics.delete(operation);
      return duration;
    }
  }
}

const perfMonitor = new SalesPerformanceMonitor();

// --- Optimized Helper Functions ---
const calculateItemCogs = (item) => {
  const purchasePrice = item.sourceBatchInfo?.purchasePrice || 0;
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
};

const getRoleDisplay = (role) => {
  const roleMap = {
    'cashier': 'Cashier',
    'store manager': 'Store Manager',
    'manager': 'Store Manager',
    'admin': 'Admin'
  };
  return roleMap[(role || '').toLowerCase()] || role || 'User';
};

// --- Optimized Batch Processing ---
const batchApiCalls = async (requests, concurrency = PERFORMANCE_CONFIG.CONCURRENT_REQUESTS) => {
  const results = [];
  
  for (let i = 0; i < requests.length; i += concurrency) {
    const batch = requests.slice(i, i + concurrency);
    try {
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    } catch (error) {
      results.push(...new Array(batch.length).fill(null));
    }
  }
  
  return results;
};

const batchUpdateProducts = async (productUpdates) => {
  if (!productUpdates.length) return [];
  
  perfMonitor.start('batchUpdateProducts');
  
  const batches = [];
  for (let i = 0; i < productUpdates.length; i += PERFORMANCE_CONFIG.BATCH_SIZE) {
    batches.push(productUpdates.slice(i, i + PERFORMANCE_CONFIG.BATCH_SIZE));
  }
  
  const results = [];
  for (const batch of batches) {
    const updatePromises = batch.map(async (update) => {
      try {
        const response = await axios.put(`${PRODUCTS_DB_URL}/${update._id}`, update, DB_AUTH);
        return { success: true, productId: update._id, response };
      } catch (error) {
        return { success: false, productId: update._id, error };
      }
    });
    
    const batchResults = await Promise.allSettled(updatePromises);
    results.push(...batchResults);
  }
  
  perfMonitor.end('batchUpdateProducts');
  return results;
};

// --- Optimized Inventory Updates ---
const prepareInventoryUpdates = async (items) => {
  perfMonitor.start('prepareInventoryUpdates');
  
  const nonManualItems = items.filter(item => !item.isManual);
  if (nonManualItems.length === 0) {
    perfMonitor.end('prepareInventoryUpdates');
    return { productUpdates: [], auditEvents: [] };
  }
  
  const productIds = [...new Set(nonManualItems.map(item => item._id))];
  const productRequests = productIds.map(id => 
    axios.get(`${PRODUCTS_DB_URL}/${id}`, DB_AUTH)
  );
  
  let products = [];
  try {
    const productResponses = await batchApiCalls(productRequests);
    products = productResponses.filter(response => response).map(response => response.data);
  } catch (error) {
    perfMonitor.end('prepareInventoryUpdates');
    return { productUpdates: [], auditEvents: [] };
  }
  
  const productUpdates = [];
  const auditEvents = [];
  
  for (const item of nonManualItems) {
    const product = products.find(p => p._id === item._id);
    if (!product || !product.batches) continue;
    
    const batch = product.batches.find(b => b.id === item.sourceBatchInfo?.id);
    if (!batch) continue;
    
    const factor = getUnitConversionFactor(product, item.sellingUnit);
    batch.quantity = Math.max(0, batch.quantity - (item.quantity * factor));
    
    productUpdates.push(product);
    
    auditEvents.push({
      eventType: 'SALE',
      productId: item._id,
      productName: item.name,
      details: {
        quantity: item.quantity,
        sellingUnit: item.sellingUnit,
        basePrice: item.sellingPrice || 0,
        itemDiscount: {
          rate: (item.discountRate || 0) + (item.extraDiscount || 0),
          amount: ((item.sellingPrice || 0) * item.quantity) * (((item.discountRate || 0) + (item.extraDiscount || 0)) / 100)
        },
        taxes: {
          rate: isNaN(parseFloat(item.taxRate)) ? 0 : parseFloat(item.taxRate),
          amount: (((item.sellingPrice || 0) * item.quantity - 
                   (((item.sellingPrice || 0) * item.quantity) * (((item.discountRate || 0) + (item.extraDiscount || 0)) / 100))) * 
                   ((isNaN(parseFloat(item.taxRate)) ? 0 : parseFloat(item.taxRate)) / 100))
        },
        costOfGoodsSold: calculateItemCogs(item) * item.quantity
      }
    });
  }
  
  perfMonitor.end('prepareInventoryUpdates');
  return { productUpdates, auditEvents };
};

// --- Optimized Meilisearch Sync ---
const syncInvoiceToMeili = async (saleRecord, saleId) => {
  if (!window.electronAPI?.sync) return { success: false };
  
  try {
    return await window.electronAPI.sync({
      indexName: 'invoices',
      documents: [{
        id: saleId,
        shortId: saleId.slice(-6),
        customerName: saleRecord.customerName,
        total: saleRecord.total,
        createdAt: new Date(saleRecord.createdAt).getTime()
      }]
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// --- Store Refresh Helper ---
const refreshStores = () => {
  const { posViewStyle } = useSettingsStore.getState(); // ✅ get the current POS view

  const refresh = () => {
    const productStore = useProductStore.getState();
    const inventoryStore = useInventoryStore.getState();
    const customerStore = useCustomerStore.getState();
    const transactionStore = useTransactionStore.getState();

    if (productStore.backgroundSync) productStore.backgroundSync();

    // ✅ Skip inventory refresh in minimal view
    if (posViewStyle !== 'minimal' && inventoryStore.fetchInventory) {
      inventoryStore.fetchInventory();
    }

    if (customerStore.fetchCustomers) customerStore.fetchCustomers();
    if (transactionStore.fetchInvoices) transactionStore.fetchInvoices();
  };

  if (window.requestIdleCallback) {
    window.requestIdleCallback(refresh, { timeout: 1000 });
  } else {
    setTimeout(refresh, 100);
  }
};

// --- Zustand Store ---
export const useSalesStore = create((set, get) => ({
  // State
  sales: [],
  isLoading: false,
  error: null,
  lastFetchTime: null,
  isInitialized: false,

  // =================================================================
  //  CACHE-INTEGRATED INITIALIZATION
  // =================================================================

  initializeFromCache: async () => {
    const state = get();
    if (!state.isInitialized) {
      try {
        const cachedSales = await CacheManager.getCachedSales({ limit: 100 });
        
        if (cachedSales.length > 0) {
          set({
            sales: cachedSales,
            isInitialized: true,
            lastFetchTime: new Date()
          });
        } else {
          set({ isInitialized: true });
        }

        // Check if cache is stale and needs refresh
        const isStale = await CacheManager.isCacheStale(1); // 1 hour
        
        if (isStale && navigator.onLine) {
          setTimeout(() => {
            state.syncWithServer();
          }, 100);
        }
      } catch (error) {
        set({ isInitialized: true });
      }
    }
  },

  // =================================================================
  //  SERVER SYNC WITH CACHE UPDATE
  // =================================================================

  syncWithServer: async () => {
    if (!navigator.onLine) return;

    try {
      const response = await axios.get(
        `${SALES_DB_URL}/_all_docs?include_docs=true`, 
        DB_AUTH
      );
      
      const allSaleDocuments = response.data.rows
        .map(row => row.doc)
        .filter(doc => doc && doc.type);
      
      // Update cache with fresh data
      await CacheManager.cacheRecentSales(allSaleDocuments);
      
      // Update UI state
      const sortedDocuments = allSaleDocuments.sort((a, b) => {
        const dateA = new Date(b.returnedAt || b.createdAt);
        const dateB = new Date(a.returnedAt || a.createdAt);
        return dateA - dateB;
      });
      
      set({ 
        sales: sortedDocuments, 
        lastFetchTime: new Date()
      });
      
    } catch (error) {
      // Silently fail and continue with cached data
    }
  },

  // =================================================================
  //  OPTIMIZED FETCH SALES (CACHE-FIRST)
  // =================================================================

  fetchSales: async () => {
    perfMonitor.start('fetchSales');
    set({ isLoading: true, error: null });
    
    try {
      // Try cache first
      const cachedSales = await CacheManager.getCachedSales({ limit: 500 });
      
      if (cachedSales.length > 0) {
        set({ 
          sales: cachedSales, 
          isLoading: false,
          lastFetchTime: new Date()
        });
        
        // Background sync if cache is stale
        const isStale = await CacheManager.isCacheStale(1);
        if (isStale && navigator.onLine) {
          setTimeout(() => get().syncWithServer(), 100);
        }
        
        perfMonitor.end('fetchSales');
        return;
      }

      // Fallback to server if cache is empty
      if (navigator.onLine) {
        await get().syncWithServer();
        set({ isLoading: false });
      } else {
        set({ 
          isLoading: false, 
          error: "No cached data available offline",
          sales: [] 
        });
      }
      
      perfMonitor.end('fetchSales');
    } catch (error) {
      set({ 
        isLoading: false, 
        error: "Failed to fetch sales",
        sales: [] 
      });
      perfMonitor.end('fetchSales');
    }
  },

  // =================================================================
  //  OPTIMIZED INVOICE SEARCH (CACHE-FIRST)
  // =================================================================

  findInvoiceById: async (invoiceId) => {
    if (!invoiceId || invoiceId.length < 6) return null;
    
    perfMonitor.start('findInvoiceById');
    
    try {
      // Try cache first
      const cachedSale = await CacheManager.getCachedSaleById(invoiceId);
      if (cachedSale) {
        perfMonitor.end('findInvoiceById');
        return cachedSale;
      }

      // Try offline search
      const searchResults = await CacheManager.searchSalesOffline(invoiceId);
      if (searchResults.length > 0) {
        perfMonitor.end('findInvoiceById');
        return searchResults[0];
      }

      // Fallback to server if online
      if (!navigator.onLine) {
        perfMonitor.end('findInvoiceById');
        return null;
      }

      const query = {
        selector: { _id: { '$regex': `${invoiceId}$` } },
        limit: 1
      };
      
      const response = await axios.post(`${SALES_DB_URL}/_find`, query, DB_AUTH);
      const result = response.data.docs.length > 0 ? response.data.docs[0] : null;
      
      // Cache the result
      if (result) {
        await CacheManager.addSaleToCache(result);
      }
      
      perfMonitor.end('findInvoiceById');
      return result;
    } catch (error) {
      perfMonitor.end('findInvoiceById');
      return null;
    }
  },

  // =================================================================
  //  OPTIMIZED ADD SALE WITH CACHE INTEGRATION
  // =================================================================

  addSale: async (saleData) => {
    perfMonitor.start('addSale');
    set({ isLoading: true, error: null });
    
    try {
      const {
        items,
        customer,
        walkInCustomerName,
        subtotal,
        totalDiscountAmount,
        totalTaxAmount,
        total,
        amountPaid,
        paymentMethod,
        settlePreviousBalance,
        flatDiscount
      } = saleData;
      
      const currentUser = useAuthStore.getState().currentUser;
      const finalSaleTotal = total - (flatDiscount?.amount || 0);

      const totalCogs = items.reduce((cogsSum, item) => {
        if (item.isManual) {
          return cogsSum + (item.manualCostPrice || 0) * item.quantity;
        }
        const itemUnitCost = calculateItemCogs(item);
        return cogsSum + (itemUnitCost * item.quantity);
      }, 0);

      const finalProfit = finalSaleTotal - totalCogs;
      
      let finalCustomerName;
      let customerId = null;
      
      if (customer && customer._id) {
        finalCustomerName = customer.name;
        customerId = customer._id;
      } else if (walkInCustomerName && walkInCustomerName.trim()) {
        finalCustomerName = walkInCustomerName.trim();
        customerId = null;
      } else {
        finalCustomerName = 'Walk-in Customer';
        customerId = null;
      }
      
      const saleRecordToSave = {
        items,
        customerName: finalCustomerName,
        customerId: customerId,
        subtotal,
        totalDiscountAmount,
        totalTaxAmount,
        flatDiscount,
        total: finalSaleTotal,
        profit: finalProfit,
        totalCogs,
        amountPaid,
        paymentMethod,
        createdAt: new Date().toISOString(),
        type: 'SALE',
        changeDue: 0,
        soldBy: {
          userId: currentUser?._id || 'admin',
          userName: currentUser?.name || 'Admin',
          userRole: currentUser?.role || 'admin',
          userRoleDisplay: getRoleDisplay(currentUser?.role || 'admin')
        }
      };
      
      // Parallel operations for better performance
      const [saleResponse, inventoryUpdates] = await Promise.all([
        axios.post(SALES_DB_URL, saleRecordToSave, DB_AUTH),
        prepareInventoryUpdates(items)
      ]);
      
      const saleId = saleResponse.data.id;
      const parallelOperations = [];
      
      // Customer management
      if (customer && customer._id) {
        parallelOperations.push(
          useCustomerStore.getState().processSaleAndUpdateBalance(
            customer._id,
            finalSaleTotal,
            amountPaid,
            saleId,
            settlePreviousBalance
          )
        );
      }
      
      // Inventory updates
      if (inventoryUpdates.productUpdates.length > 0) {
        parallelOperations.push(batchUpdateProducts(inventoryUpdates.productUpdates));
      }
      
      // Meilisearch sync
      parallelOperations.push(syncInvoiceToMeili(saleRecordToSave, saleId));
      
      const [updatedCustomer, productUpdateResults, meiliSyncResult] = await Promise.all(parallelOperations);
      
      // Log audit events asynchronously
      if (inventoryUpdates.auditEvents.length > 0) {
        const auditStore = useAuditStore.getState();
        inventoryUpdates.auditEvents.forEach(event => {
          event.details.customerName = saleRecordToSave.customerName;
          event.details.saleId = saleId;
          auditStore.logEvent(event);
        });
      }
      
      // Calculate change due
      const oldBalance = customer?.balance || 0;
      const totalDue = settlePreviousBalance ? finalSaleTotal + oldBalance : finalSaleTotal;
      const changeDue = Math.max(0, amountPaid - totalDue);
      
      // Update final sale record
      const finalSaleRecord = {
        ...saleRecordToSave,
        _id: saleId,
        _rev: saleResponse.data.rev,
        changeDue,
        updatedCustomer
      };
      
      await axios.put(`${SALES_DB_URL}/${saleId}`, finalSaleRecord, DB_AUTH);
      
      // Add to cache immediately
      await CacheManager.addSaleToCache(finalSaleRecord);
      
      // Update sales metrics cache
      await CacheManager.calculateMetricsFromCache();
      
      // Add to transaction store cache if available
      const transactionStore = useTransactionStore.getState();
      if (transactionStore.addNewInvoice) {
        await transactionStore.addNewInvoice(finalSaleRecord);
      }
      
      // Clear cart
      useCartStore.getState().clearCart();
      
      // Refresh stores with background priority
      refreshStores();
      
      set({ isLoading: false });
      perfMonitor.end('addSale');
      return finalSaleRecord;
      
    } catch (error) {
      set({ isLoading: false, error: 'Failed to process sale' });
      perfMonitor.end('addSale');
      return null;
    }
  },

  // =================================================================
  //  OPTIMIZED PROCESS RETURN WITH CACHE INTEGRATION
  // =================================================================

  processReturn: async (originalInvoice, returnedItems, refundChoice) => {
    perfMonitor.start('processReturn');
    set({ isLoading: true });
    
    try {
      const invoiceSubtotal = originalInvoice.subtotal || 0;
      const invoiceTotal = originalInvoice.total || 0;
      const totalToSubtotalRatio = invoiceSubtotal > 0 ? invoiceTotal / invoiceSubtotal : 0;
      
      const totalReturnValue = returnedItems.reduce((sum, item) => {
        return sum + (item.sellingPrice * item.returnQuantity) * totalToSubtotalRatio;
      }, 0);
      
      const customerStore = useCustomerStore.getState();
      let customer = null;
      
      if (originalInvoice.customerId) {
        try {
          const customerResponse = await axios.get(
            `${CUSTOMERS_DB_URL}/${originalInvoice.customerId}`, 
            DB_AUTH
          );
          customer = customerResponse.data;
        } catch (error) {
          // Customer not found
        }
      }
      
      const currentBalance = customer?.balance || 0;
      const amountToSettle = Math.min(Math.max(0, currentBalance), totalReturnValue);
      
      let amountToRefund = 0;
      let creditNoteAmount = 0;
      
      if (refundChoice.type === 'REFUND') {
        amountToRefund = totalReturnValue - amountToSettle;
      } else {
        creditNoteAmount = totalReturnValue - amountToSettle;
      }
      
      const returnRecord = {
        type: 'RETURN',
        originalInvoiceId: originalInvoice._id,
        returnedAt: new Date().toISOString(),
        items: returnedItems,
        totalReturnValue,
        refundType: refundChoice.type,
        settlement: {
          type: refundChoice.type,
          amountRefunded: amountToRefund,
          creditNoteAmount: creditNoteAmount
        },
        customerName: originalInvoice.customerName,
        customerId: originalInvoice.customerId
      };
      
      // Save return record
      const returnResponse = await axios.post(SALES_DB_URL, returnRecord, DB_AUTH);
      
      // Add return to cache
      const finalReturnRecord = {
        ...returnRecord,
        _id: returnResponse.data.id,
        _rev: returnResponse.data.rev
      };
      await CacheManager.addSaleToCache(finalReturnRecord);
      
      // Update customer balance
      if (customer) {
        await customerStore._updateCustomerBalance(
          customer._id,
          customer.balance - (amountToSettle + creditNoteAmount)
        );
      }
      
      // Process inventory returns in batches
      const productStore = useProductStore.getState();
      const nonManualReturns = returnedItems.filter(item => !item.isManual);
      
      for (let i = 0; i < nonManualReturns.length; i += PERFORMANCE_CONFIG.BATCH_SIZE) {
        const batch = nonManualReturns.slice(i, i + PERFORMANCE_CONFIG.BATCH_SIZE);
        
        await Promise.all(batch.map(async (item) => {
          try {
            const productResponse = await axios.get(`${PRODUCTS_DB_URL}/${item._id}`, DB_AUTH);
            const product = productResponse.data;
            
            if (!product.batches) product.batches = [];
            
            const factor = getUnitConversionFactor(product, item.sellingUnit);
            const qtyToAdd = item.returnQuantity * factor;
            
            const batch = product.batches.find(b => b.id === item.sourceBatchInfo?.id);
            
            if (batch) {
              batch.quantity = (Number(batch.quantity) || 0) + qtyToAdd;
            } else {
              product.batches.push({
                id: `ret-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                batchNumber: item.sourceBatchInfo?.batchNumber || 'RETURNED',
                quantity: qtyToAdd,
                purchasePrice: item.sourceBatchInfo?.purchasePrice || 0,
                expDate: item.sourceBatchInfo?.expDate || 
                         new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
                retailPrice: item.sellingPrice / factor
              });
            }
            
            await productStore.updateProduct(product);
            
            // Log audit event
            useAuditStore.getState().logEvent({
              eventType: 'RETURN_CUSTOMER',
              productId: item._id,
              productName: item.name,
              details: {
                quantity: item.returnQuantity,
                sellingUnit: item.sellingUnit,
                customerName: returnRecord.customerName,
                saleId: returnRecord.originalInvoiceId
              }
            });
          } catch (error) {
            // Skip failed product updates
          }
        }));
      }
      
      // Update transaction store if available
      const transactionStore = useTransactionStore.getState();
      if (transactionStore.updateInvoiceReturns) {
        await transactionStore.updateInvoiceReturns(originalInvoice._id, finalReturnRecord);
      }
      
      // Update sales metrics cache
      await CacheManager.calculateMetricsFromCache();
      
      // Refresh related stores
      refreshStores();
      
      perfMonitor.end('processReturn');
    } catch (error) {
      perfMonitor.end('processReturn');
    } finally {
      set({ isLoading: false });
    }
  },

  // =================================================================
  //  CACHE-ENHANCED UTILITY METHODS
  // =================================================================

  clearError: () => set({ error: null }),
  
  getSalesMetrics: async () => {
    try {
      // Try to get metrics from cache first
      const cachedMetrics = await CacheManager.getCachedSalesMetrics();
      return cachedMetrics;
    } catch (error) {
      // Fallback to calculating from current state
      const { sales } = get();
      const today = new Date().toDateString();
      
      const todaySales = sales.filter(sale => 
        sale.type === 'SALE' && 
        new Date(sale.createdAt).toDateString() === today
      );
      
      const totalRevenue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);
      const totalProfit = todaySales.reduce((sum, sale) => sum + (sale.profit || 0), 0);
      
      return {
        todaySalesCount: todaySales.length,
        totalRevenue,
        totalProfit,
        averageSaleValue: todaySales.length > 0 ? totalRevenue / todaySales.length : 0,
        profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
      };
    }
  },

  // Search sales (cache-first)
  searchSales: async (keyword) => {
    try {
      return await CacheManager.searchSalesOffline(keyword);
    } catch (error) {
      return [];
    }
  },

  // Get sale by ID (cache-first)
  getSaleById: async (saleId) => {
    try {
      return await CacheManager.getCachedSaleById(saleId);
    } catch (error) {
      return null;
    }
  },

  // Clear sales cache
  clearCache: async () => {
    try {
      await CacheManager.clearSalesCache();
      set({
        sales: [],
        lastFetchTime: null,
        isInitialized: false
      });
      return true;
    } catch (error) {
      return false;
    }
  },

  // Get cache health
  getCacheHealth: async () => {
    try {
      return await CacheManager.healthCheck();
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }
}));
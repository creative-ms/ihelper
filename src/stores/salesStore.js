// salesStore.js - PouchDB Only Version (No CouchDB Sync)
import { create } from 'zustand';
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
  DEBOUNCE_DELAY: 300,
};

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

// --- Helper Functions ---
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

// --- Local Inventory Updates (PouchDB Only) ---
const updateLocalInventory = async (items) => {
  perfMonitor.start('updateLocalInventory');
  
  const nonManualItems = items.filter(item => !item.isManual);
  if (nonManualItems.length === 0) {
    perfMonitor.end('updateLocalInventory');
    return { success: true, auditEvents: [] };
  }
  
  const auditEvents = [];
  const productStore = useProductStore.getState();
  
  try {
    for (const item of nonManualItems) {
      // Get product from local store
      const product = await productStore.getProductById(item._id);
      if (!product || !product.batches) continue;
      
      const batch = product.batches.find(b => b.id === item.sourceBatchInfo?.id);
      if (!batch) continue;
      
      const factor = getUnitConversionFactor(product, item.sellingUnit);
      const newQuantity = Math.max(0, batch.quantity - (item.quantity * factor));
      
      // Update batch quantity
      batch.quantity = newQuantity;
      
      // Update product in local store
      await productStore.updateProduct(product);
      
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
    
    perfMonitor.end('updateLocalInventory');
    return { success: true, auditEvents };
    
  } catch (error) {
    console.error('Error updating local inventory:', error);
    perfMonitor.end('updateLocalInventory');
    return { success: false, auditEvents: [] };
  }
};

// --- Store Refresh Helper ---
const refreshStores = () => {
  const { posViewStyle } = useSettingsStore.getState();

  const refresh = () => {
    const productStore = useProductStore.getState();
    const inventoryStore = useInventoryStore.getState();
    const customerStore = useCustomerStore.getState();
    const transactionStore = useTransactionStore.getState();

    if (productStore.backgroundSync) productStore.backgroundSync();

    // Skip inventory refresh in minimal view
    if (posViewStyle !== 'minimal' && inventoryStore.fetchInventory) {
      inventoryStore.fetchInventory();
    }

    if (customerStore.fetchCustomers) customerStore.fetchCustomers();
    if (transactionStore.refreshInvoices) transactionStore.refreshInvoices();
  };

  if (window.requestIdleCallback) {
    window.requestIdleCallback(refresh, { timeout: 1000 });
  } else {
    setTimeout(refresh, 100);
  }
};

// --- Generate Sale ID ---
const generateSaleId = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `sale_${timestamp}_${random}`;
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
  //  CACHE-ONLY INITIALIZATION
  // =================================================================

  initializeFromCache: async () => {
    const state = get();
    if (!state.isInitialized) {
      try {
        const cachedSales = await CacheManager.getCachedSales({ limit: 100 });
        
        set({
          sales: cachedSales,
          isInitialized: true,
          lastFetchTime: new Date()
        });

        console.log(`✅ Initialized with ${cachedSales.length} cached sales`);
      } catch (error) {
        console.error('Error initializing from cache:', error);
        set({ 
          isInitialized: true,
          sales: [],
          error: 'Failed to load cached sales'
        });
      }
    }
  },

  // =================================================================
  //  FETCH SALES (CACHE-ONLY)
  // =================================================================

  fetchSales: async () => {
    perfMonitor.start('fetchSales');
    set({ isLoading: true, error: null });
    
    try {
      const cachedSales = await CacheManager.getCachedSales({ limit: 500 });
      
      set({ 
        sales: cachedSales, 
        isLoading: false,
        lastFetchTime: new Date()
      });
      
      console.log(`✅ Loaded ${cachedSales.length} sales from cache`);
      perfMonitor.end('fetchSales');
    } catch (error) {
      console.error('Error fetching sales:', error);
      set({ 
        isLoading: false, 
        error: "Failed to fetch sales from cache",
        sales: [] 
      });
      perfMonitor.end('fetchSales');
    }
  },

  // =================================================================
  //  INVOICE SEARCH (CACHE-ONLY)
  // =================================================================

  findInvoiceById: async (invoiceId) => {
    if (!invoiceId || invoiceId.length < 6) return null;
    
    perfMonitor.start('findInvoiceById');
    
    try {
      // Try direct cache lookup first
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

      perfMonitor.end('findInvoiceById');
      return null;
    } catch (error) {
      console.error('Error finding invoice:', error);
      perfMonitor.end('findInvoiceById');
      return null;
    }
  },

  // =================================================================
  //  ADD SALE (LOCAL ONLY)
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
      
      // Generate unique sale ID
      const saleId = generateSaleId();
      
      const saleRecordToSave = {
        _id: saleId,
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
      
      // Update local inventory
      const inventoryResult = await updateLocalInventory(items);
      
      // Process customer balance if applicable
      let updatedCustomer = null;
      if (customer && customer._id) {
        const customerStore = useCustomerStore.getState();
        updatedCustomer = await customerStore.processSaleAndUpdateBalance(
          customer._id,
          finalSaleTotal,
          amountPaid,
          saleId,
          settlePreviousBalance
        );
      }
      
      // Calculate change due
      const oldBalance = customer?.balance || 0;
      const totalDue = settlePreviousBalance ? finalSaleTotal + oldBalance : finalSaleTotal;
      const changeDue = Math.max(0, amountPaid - totalDue);
      
      // Update final sale record
      const finalSaleRecord = {
        ...saleRecordToSave,
        changeDue,
        updatedCustomer
      };
      
      // Save to PouchDB cache
      await CacheManager.addSaleToCache(finalSaleRecord);
      
      // Log audit events
      if (inventoryResult.auditEvents.length > 0 && inventoryResult.success) {
        const auditStore = useAuditStore.getState();
        inventoryResult.auditEvents.forEach(event => {
          event.details.customerName = finalSaleRecord.customerName;
          event.details.saleId = saleId;
          if (auditStore.logEvent) {
            auditStore.logEvent(event);
          }
        });
      }
      
      // Update sales metrics cache
      await CacheManager.calculateMetricsFromCache();
      
      // Add to transaction store cache if available
      const transactionStore = useTransactionStore.getState();
      if (transactionStore.addNewInvoice) {
        await transactionStore.addNewInvoice(finalSaleRecord);
      }
      
      // Update local state
      const currentSales = get().sales;
      set({
        sales: [finalSaleRecord, ...currentSales],
        isLoading: false
      });
      
      // Clear cart
      useCartStore.getState().clearCart();
      
      // Refresh stores
      refreshStores();
      
      console.log(`✅ Sale ${saleId} processed successfully (local only)`);
      perfMonitor.end('addSale');
      return finalSaleRecord;
      
    } catch (error) {
      console.error('Error processing sale:', error);
      set({ isLoading: false, error: 'Failed to process sale' });
      perfMonitor.end('addSale');
      return null;
    }
  },

  // =================================================================
  //  PROCESS RETURN (LOCAL ONLY)
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
      
      // Handle customer balance locally
      const customerStore = useCustomerStore.getState();
      let customer = null;
      
      if (originalInvoice.customerId) {
        customer = await customerStore.getCustomerById(originalInvoice.customerId);
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
      
      // Generate return ID
      const returnId = `return_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const returnRecord = {
        _id: returnId,
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
      
      // Save return record to cache
      await CacheManager.addSaleToCache(returnRecord);
      
      // Update customer balance locally
      if (customer) {
        await customerStore._updateCustomerBalance(
          customer._id,
          customer.balance - (amountToSettle + creditNoteAmount)
        );
      }
      
      // Process inventory returns locally (batch processing)
      const productStore = useProductStore.getState();
      const nonManualReturns = returnedItems.filter(item => !item.isManual);
      
      for (let i = 0; i < nonManualReturns.length; i += PERFORMANCE_CONFIG.BATCH_SIZE) {
        const batch = nonManualReturns.slice(i, i + PERFORMANCE_CONFIG.BATCH_SIZE);
        
        await Promise.all(batch.map(async (item) => {
          try {
            const product = await productStore.getProductById(item._id);
            if (!product) return;
            
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
            const auditStore = useAuditStore.getState();
            if (auditStore.logEvent) {
              auditStore.logEvent({
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
            }
          } catch (error) {
            console.error('Error processing return for item:', item._id, error);
          }
        }));
      }
      
      // Update transaction store
      const transactionStore = useTransactionStore.getState();
      if (transactionStore.updateInvoiceReturns) {
        await transactionStore.updateInvoiceReturns(originalInvoice._id, returnRecord);
      }
      
      // Update sales metrics cache
      await CacheManager.calculateMetricsFromCache();
      
      // Update local state
      const currentSales = get().sales;
      set({
        sales: [returnRecord, ...currentSales],
        isLoading: false
      });
      
      // Refresh stores
      refreshStores();
      
      console.log(`✅ Return ${returnId} processed successfully (local only)`);
      perfMonitor.end('processReturn');
      return returnRecord;
      
    } catch (error) {
      console.error('Error processing return:', error);
      set({ isLoading: false, error: 'Failed to process return' });
      perfMonitor.end('processReturn');
      return null;
    }
  },

  // =================================================================
  //  UTILITY METHODS (CACHE-ONLY)
  // =================================================================

  clearError: () => set({ error: null }),
  
  getSalesMetrics: async () => {
    try {
      return await CacheManager.getCachedSalesMetrics();
    } catch (error) {
      console.error('Error getting sales metrics:', error);
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

  // Search sales (cache-only)
  searchSales: async (keyword) => {
    try {
      return await CacheManager.searchSalesOffline(keyword);
    } catch (error) {
      console.error('Error searching sales:', error);
      return [];
    }
  },

  // Get sale by ID (cache-only)
  getSaleById: async (saleId) => {
    try {
      return await CacheManager.getCachedSaleById(saleId);
    } catch (error) {
      console.error('Error getting sale by ID:', error);
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
      console.log('✅ Sales cache cleared');
      return true;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return false;
    }
  },

  // Get cache health
  getCacheHealth: async () => {
    try {
      return await CacheManager.getSalesCacheHealth();
    } catch (error) {
      console.error('Error getting cache health:', error);
      return { healthy: false, error: error.message };
    }
  },

  // Refresh sales from cache
  refreshSales: async () => {
    await get().fetchSales();
  },

  // Export sales data
  exportSales: async (filters = {}) => {
    try {
      const sales = await CacheManager.getCachedSales({
        limit: 10000,
        ...filters
      });
      
      return sales.map(sale => ({
        id: sale._id,
        date: sale.createdAt,
        customer: sale.customerName,
        total: sale.total,
        profit: sale.profit,
        soldBy: sale.soldBy?.userName || 'Unknown',
        type: sale.type
      }));
    } catch (error) {
      console.error('Error exporting sales:', error);
      return [];
    }
  }
}));
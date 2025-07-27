// ===================================
// src/utils/cache/PurchaseCache.js  
// ===================================
import { purchasesDB } from './databases.js';
import CacheUtilities from './CacheUtilities.js';

const PurchaseCache = {
  async cachePurchases(purchases = []) {
    if (!purchases.length) return;
    
    try {
      await CacheUtilities.clearDatabase(purchasesDB);
      
      const processedPurchases = this._processPurchasesForCache(purchases);
      
      if (processedPurchases.length > 0) {
        await purchasesDB.bulkDocs(processedPurchases);
      }
      
      await this.updateSyncMetadata('purchases', purchases.length);
      console.log(`✅ Cached ${processedPurchases.length} purchases`);
      
    } catch (error) {
      console.error('Error caching purchases:', error);
      throw error;
    }
  },

  async getAllCachedPurchases() {
    try {
      const result = await purchasesDB.allDocs({ include_docs: true });
      return result.rows
        .map(row => row.doc)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('Error getting cached purchases:', error);
      return [];
    }
  },

  async getPurchaseById(id) {
    try {
      const purchase = await purchasesDB.get(id);
      return purchase || null;
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting purchase by ID:', error);
      return null;
    }
  },

  async addPurchaseToCache(purchase) {
    if (!purchase?._id) {
      console.error('Invalid purchase data for cache');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      const purchaseData = this._cleanPurchaseData(purchase);
      await purchasesDB.put(purchaseData);
      
      console.log(`✅ Added purchase ${purchase._id} to cache`);
      return true;
    }, 3);
  },

  async updatePurchaseInCache(purchase) {
    if (!purchase?._id) {
      console.error('Invalid purchase data for cache update');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      if (purchase._deleted) {
        await this.removePurchaseFromCache(purchase._id);
        return true;
      }

      const purchaseData = this._cleanPurchaseData(purchase);
      
      // Get existing document to preserve _rev
      try {
        const existingPurchase = await purchasesDB.get(purchase._id);
        purchaseData._rev = existingPurchase._rev;
      } catch (error) {
        if (error.name !== 'not_found') throw error;
      }
      
      await purchasesDB.put(purchaseData);
      
      console.log(`✅ Updated purchase ${purchase._id} in cache`);
      return true;
    }, 3);
  },

  async removePurchaseFromCache(purchaseId) {
    try {
      const existingPurchase = await purchasesDB.get(purchaseId);
      await purchasesDB.remove(existingPurchase);
      console.log(`✅ Removed purchase ${purchaseId} from cache`);
      return true;
    } catch (error) {
      if (error.name === 'not_found') return true; // Already removed
      console.error('Error removing purchase from cache:', error);
      return false;
    }
  },

  async getPurchasesBySupplier(supplierId) {
    try {
      const result = await purchasesDB.allDocs({ include_docs: true });
      return result.rows
        .map(row => row.doc)
        .filter(purchase => purchase.supplierId === supplierId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('Error getting purchases by supplier:', error);
      return [];
    }
  },

  async getPurchasesByDateRange(startDate, endDate) {
    try {
      const result = await purchasesDB.allDocs({ include_docs: true });
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      return result.rows
        .map(row => row.doc)
        .filter(purchase => {
          const purchaseDate = new Date(purchase.createdAt);
          return purchaseDate >= start && purchaseDate <= end;
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('Error getting purchases by date range:', error);
      return [];
    }
  },

  async getPurchasesByStatus(status) {
    try {
      const result = await purchasesDB.allDocs({ include_docs: true });
      return result.rows
        .map(row => row.doc)
        .filter(purchase => (purchase.status || 'Completed') === status)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('Error getting purchases by status:', error);
      return [];
    }
  },

  async getRecentPurchases(limit = 10) {
    try {
      const result = await purchasesDB.allDocs({ 
        include_docs: true,
        limit: limit,
        descending: true 
      });
      
      return result.rows
        .map(row => row.doc)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('Error getting recent purchases:', error);
      return [];
    }
  },

  async searchPurchasesOffline(keyword = '') {
    if (!keyword) return [];
    
    try {
      const purchases = await this._getFilteredPurchases(keyword);
      return purchases;
    } catch (error) {
      console.error('Error searching purchases offline:', error);
      return [];
    }
  },

  async getPurchaseStats() {
    try {
      const result = await purchasesDB.allDocs({ include_docs: true });
      const purchases = result.rows.map(row => row.doc);
      
      const stats = {
        totalPurchases: purchases.length,
        totalValue: purchases.reduce((sum, p) => sum + (p.totals?.grandTotal || 0), 0),
        totalPaid: purchases.reduce((sum, p) => sum + (p.amountPaid || 0), 0),
        totalDue: purchases.reduce((sum, p) => sum + (p.amountDue || 0), 0),
        byStatus: {},
        byPaymentStatus: {},
        recentCount: purchases.filter(p => {
          const days = (new Date() - new Date(p.createdAt)) / (1000 * 60 * 60 * 24);
          return days <= 30;
        }).length
      };

      // Calculate status distribution
      purchases.forEach(purchase => {
        const status = purchase.status || 'Completed';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
        
        const paymentStatus = purchase.amountDue <= 0 ? 'Paid' : 
                             purchase.amountPaid > 0 ? 'Partially Paid' : 'Unpaid';
        stats.byPaymentStatus[paymentStatus] = (stats.byPaymentStatus[paymentStatus] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('Error getting purchase stats:', error);
      return {
        totalPurchases: 0,
        totalValue: 0,
        totalPaid: 0,
        totalDue: 0,
        byStatus: {},
        byPaymentStatus: {},
        recentCount: 0
      };
    }
  },

  // Private helper methods
  _processPurchasesForCache(purchases) {
    return purchases.map(purchase => this._cleanPurchaseData(purchase));
  },

  _cleanPurchaseData(purchase) {
    return {
      _id: purchase._id,
      type: purchase.type || 'PURCHASE',
      invoiceNumber: purchase.invoiceNumber,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierName,
      items: purchase.items || [],
      totals: purchase.totals || {},
      amountPaid: purchase.amountPaid || 0,
      amountDue: purchase.amountDue || 0,
      status: purchase.status || 'Completed',
      paymentMethod: purchase.paymentMethod,
      notes: purchase.notes,
      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt || new Date().toISOString(),
      // For returns
      originalPurchaseId: purchase.originalPurchaseId,
      reason: purchase.reason,
      settlement: purchase.settlement
    };
  },

  async _getFilteredPurchases(keyword) {
    const result = await purchasesDB.allDocs({ include_docs: true });
    const lower = keyword.toLowerCase();
    
    return result.rows
      .map(row => row.doc)
      .filter(p => 
        (p.invoiceNumber || p._id).toLowerCase().includes(lower) ||
        p.supplierName?.toLowerCase().includes(lower) ||
        p.notes?.toLowerCase().includes(lower) ||
        p.items?.some(item => 
          item.productName?.toLowerCase().includes(lower) ||
          item.batchNumber?.toLowerCase().includes(lower)
        )
      )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
};

export default PurchaseCache;
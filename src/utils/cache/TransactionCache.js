// ===================================
// src/utils/cache/TransactionCache.js
// ===================================
import { transactionsDB, returnsDB, transactionStatsDB } from './databases.js';
import CacheUtilities from './CacheUtilities.js';

// Updated databases.js should include:
// export const transactionsDB = new PouchDB('pharmacy_transactions');
// export const returnsDB = new PouchDB('pharmacy_returns');  
// export const transactionStatsDB = new PouchDB('pharmacy_transaction_stats');

const TransactionCache = {
  // Cache invoices with their related returns
  async cacheInvoices(invoices = []) {
    if (!invoices.length) return;
    
    try {
      await CacheUtilities.clearDatabase(transactionsDB);
      
      const processedInvoices = invoices.map(invoice => this._cleanInvoiceData(invoice));
      
      if (processedInvoices.length > 0) {
        await transactionsDB.bulkDocs(processedInvoices);
      }
      
      await this.updateSyncMetadata('transactions', invoices.length);
      console.log(`✅ Cached ${processedInvoices.length} invoices`);
      
    } catch (error) {
      console.error('Error caching invoices:', error);
      throw error;
    }
  },

  // Cache returns separately
  async cacheReturns(returns = []) {
    if (!returns.length) return;
    
    try {
      await CacheUtilities.clearDatabase(returnsDB);
      
      const processedReturns = returns.map(returnDoc => this._cleanReturnData(returnDoc));
      
      if (processedReturns.length > 0) {
        await returnsDB.bulkDocs(processedReturns);
      }
      
      await this.updateSyncMetadata('returns', returns.length);
      console.log(`✅ Cached ${processedReturns.length} returns`);
      
    } catch (error) {
      console.error('Error caching returns:', error);
      throw error;
    }
  },

  // Get all cached invoices with pagination
  async getCachedInvoices({ searchTerm = '', page = 1, pageSize = 25 } = {}) {
    try {
      const result = await transactionsDB.allDocs({ 
        include_docs: true,
        limit: 1000 // Get more for searching
      });
      
      let invoices = result.rows.map(row => row.doc);
      
      // Filter by search term if provided
      if (searchTerm.trim()) {
        const lower = searchTerm.toLowerCase();
        invoices = invoices.filter(invoice => 
          invoice._id?.toLowerCase().includes(lower) ||
          invoice.customerName?.toLowerCase().includes(lower) ||
          invoice.customerId?.toLowerCase().includes(lower)
        );
      }
      
      // Sort by creation date (newest first)
      invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      // Paginate
      const skip = (page - 1) * pageSize;
      const paginatedInvoices = invoices.slice(skip, skip + pageSize);
      
      // Attach related returns to each invoice
      const invoicesWithReturns = await Promise.all(
        paginatedInvoices.map(async invoice => {
          const returns = await this._getReturnsForInvoice(invoice._id);
          return { ...invoice, relatedReturns: returns };
        })
      );
      
      return {
        invoices: invoicesWithReturns,
        totalInvoices: invoices.length,
        currentPage: page,
        totalPages: Math.ceil(invoices.length / pageSize)
      };
      
    } catch (error) {
      console.error('Error getting cached invoices:', error);
      return {
        invoices: [],
        totalInvoices: 0,
        currentPage: 1,
        totalPages: 0
      };
    }
  },

  // Get invoice by ID from cache
  async getCachedInvoiceById(invoiceId) {
    try {
      const invoice = await transactionsDB.get(invoiceId);
      if (!invoice) return null;
      
      const returns = await this._getReturnsForInvoice(invoiceId);
      return { ...invoice, relatedReturns: returns };
      
    } catch (error) {
      if (error.name === 'not_found') return null;
      console.error('Error getting cached invoice by ID:', error);
      return null;
    }
  },

  // Get unpaid invoices for a customer from cache
  async getCachedUnpaidInvoicesForCustomer(customerId) {
    if (!customerId) return [];
    
    try {
      const result = await transactionsDB.allDocs({ include_docs: true });
      const customerInvoices = result.rows
        .map(row => row.doc)
        .filter(invoice => invoice.customerId === customerId);
      
      // Filter for unpaid invoices
      const unpaidInvoices = [];
      
      for (const invoice of customerInvoices) {
        const returns = await this._getReturnsForInvoice(invoice._id);
        const totalReturned = returns.reduce((sum, r) => sum + (r.totalReturnValue || 0), 0);
        const netPayable = (invoice.total || 0) - (invoice.amountPaid || 0) - totalReturned;
        
        if (netPayable > 0.01) {
          unpaidInvoices.push({ ...invoice, relatedReturns: returns });
        }
      }
      
      return unpaidInvoices.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
    } catch (error) {
      console.error('Error getting cached unpaid invoices:', error);
      return [];
    }
  },

  // Add new invoice to cache
  async addInvoiceToCache(invoice) {
    if (!invoice?._id) {
      console.error('Invalid invoice data for cache');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      const invoiceData = this._cleanInvoiceData(invoice);
      await transactionsDB.put(invoiceData);
      
      console.log(`✅ Added invoice ${invoice._id} to cache`);
      return true;
    }, 3);
  },

  // Update invoice in cache
  async updateInvoiceInCache(invoice) {
    if (!invoice?._id) {
      console.error('Invalid invoice data for cache update');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      if (invoice._deleted) {
        await this.removeInvoiceFromCache(invoice._id);
        return true;
      }

      const invoiceData = this._cleanInvoiceData(invoice);
      await this._updateInvoiceDocument(invoiceData);
      
      console.log(`✅ Successfully updated invoice ${invoice._id} in cache`);
      return true;
    }, 3);
  },

  // Remove invoice from cache
  async removeInvoiceFromCache(invoiceId) {
    try {
      // Remove invoice document
      try {
        const existingInvoice = await transactionsDB.get(invoiceId);
        await transactionsDB.remove(existingInvoice);
      } catch (error) {
        if (error.name !== 'not_found') throw error;
      }
      
      console.log(`✅ Removed invoice ${invoiceId} from cache`);
      return true;
    } catch (error) {
      console.error('Error removing invoice from cache:', error);
      return false;
    }
  },

  // Add return to cache
  async addReturnToCache(returnDoc) {
    if (!returnDoc?._id) {
      console.error('Invalid return data for cache');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      const returnData = this._cleanReturnData(returnDoc);
      await returnsDB.put(returnData);
      
      console.log(`✅ Added return ${returnDoc._id} to cache`);
      return true;
    }, 3);
  },

  // Update return in cache
  async updateReturnInCache(returnDoc) {
    if (!returnDoc?._id) {
      console.error('Invalid return data for cache update');
      return false;
    }

    return CacheUtilities._retryOperation(async () => {
      if (returnDoc._deleted) {
        await this.removeReturnFromCache(returnDoc._id);
        return true;
      }

      const returnData = this._cleanReturnData(returnDoc);
      await this._updateReturnDocument(returnData);
      
      console.log(`✅ Successfully updated return ${returnDoc._id} in cache`);
      return true;
    }, 3);
  },

  // Remove return from cache
  async removeReturnFromCache(returnId) {
    try {
      try {
        const existingReturn = await returnsDB.get(returnId);
        await returnsDB.remove(existingReturn);
      } catch (error) {
        if (error.name !== 'not_found') throw error;
      }
      
      console.log(`✅ Removed return ${returnId} from cache`);
      return true;
    } catch (error) {
      console.error('Error removing return from cache:', error);
      return false;
    }
  },

  // Search transactions offline
  async searchTransactionsOffline(keyword = '') {
    if (!keyword) return [];
    
    try {
      const result = await transactionsDB.allDocs({ include_docs: true });
      const lower = keyword.toLowerCase();
      
      const filteredInvoices = result.rows
        .map(row => row.doc)
        .filter(invoice => 
          invoice._id?.toLowerCase().includes(lower) ||
          invoice.customerName?.toLowerCase().includes(lower) ||
          invoice.customerId?.toLowerCase().includes(lower)
        );

      // Attach returns to each invoice
      return Promise.all(filteredInvoices.map(async invoice => {
        const returns = await this._getReturnsForInvoice(invoice._id);
        return { ...invoice, relatedReturns: returns };
      }));
      
    } catch (error) {
      console.error('Error searching transactions offline:', error);
      return [];
    }
  },

  // Cache transaction statistics
  async cacheTransactionStats(stats) {
    try {
      const statsEntry = {
        _id: 'transaction_stats',
        ...stats,
        timestamp: new Date().toISOString()
      };
      
      // Get existing stats to preserve _rev
      try {
        const existingStats = await transactionStatsDB.get('transaction_stats');
        statsEntry._rev = existingStats._rev;
      } catch (error) {
        // Stats don't exist, no _rev needed
      }
      
      await transactionStatsDB.put(statsEntry);
      
    } catch (error) {
      console.error('Error caching transaction stats:', error);
    }
  },

  // Get cached transaction statistics
  async getCachedTransactionStats() {
    try {
      const stats = await transactionStatsDB.get('transaction_stats');
      const { _id, _rev, ...cleanStats } = stats;
      return cleanStats;
    } catch (error) {
      if (error.name === 'not_found') {
        return null;
      }
      console.error('Error getting cached transaction stats:', error);
      return null;
    }
  },

  // Private helper methods
  _cleanInvoiceData(invoice) {
    return {
      _id: invoice._id,
      type: invoice.type || 'SALE',
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      customerPhone: invoice.customerPhone,
      items: invoice.items || [],
      subtotal: invoice.subtotal || 0,
      discount: invoice.discount || 0,
      tax: invoice.tax || 0,
      total: invoice.total || 0,
      amountPaid: invoice.amountPaid || 0,
      paymentMethod: invoice.paymentMethod,
      notes: invoice.notes,
      cashierId: invoice.cashierId,
      cashierName: invoice.cashierName,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt || new Date().toISOString(),
      status: invoice.status || 'completed'
    };
  },

  _cleanReturnData(returnDoc) {
    return {
      _id: returnDoc._id,
      type: returnDoc.type || 'RETURN',
      originalInvoiceId: returnDoc.originalInvoiceId,
      customerId: returnDoc.customerId,
      customerName: returnDoc.customerName,
      returnedItems: returnDoc.returnedItems || [],
      totalReturnValue: returnDoc.totalReturnValue || 0,
      returnReason: returnDoc.returnReason,
      refundMethod: returnDoc.refundMethod,
      cashierId: returnDoc.cashierId,
      cashierName: returnDoc.cashierName,
      createdAt: returnDoc.createdAt,
      updatedAt: returnDoc.updatedAt || new Date().toISOString(),
      status: returnDoc.status || 'completed'
    };
  },

  async _updateInvoiceDocument(invoiceData) {
    try {
      // Get existing invoice to preserve _rev
      const existingInvoice = await transactionsDB.get(invoiceData._id);
      invoiceData._rev = existingInvoice._rev;
    } catch (error) {
      if (error.name !== 'not_found') throw error;
      // Invoice doesn't exist, no _rev needed
    }
    
    await transactionsDB.put(invoiceData);
  },

  async _updateReturnDocument(returnData) {
    try {
      // Get existing return to preserve _rev
      const existingReturn = await returnsDB.get(returnData._id);
      returnData._rev = existingReturn._rev;
    } catch (error) {
      if (error.name !== 'not_found') throw error;
      // Return doesn't exist, no _rev needed
    }
    
    await returnsDB.put(returnData);
  },

  async _getReturnsForInvoice(invoiceId) {
    try {
      const result = await returnsDB.allDocs({ include_docs: true });
      return result.rows
        .map(row => row.doc)
        .filter(returnDoc => returnDoc.originalInvoiceId === invoiceId);
    } catch (error) {
      console.error('Error getting returns for invoice:', error);
      return [];
    }
  },

};



export default TransactionCache;
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import CacheManager from '../utils/cache/index.js';

// Custom storage with better quota management
const customStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch (error) {
      console.warn('localStorage read error:', error);
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      console.warn('localStorage write error:', error);
      if (error.name === 'QuotaExceededError') {
        // Clear old data and try again
        localStorage.clear();
        try {
          localStorage.setItem(name, value);
        } catch (retryError) {
          console.error('Failed to save even after clearing:', retryError);
        }
      }
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch (error) {
      console.warn('localStorage remove error:', error);
    }
  }
};

export const useTransactionStore = create(
  persist(
    (set, get) => ({
      invoices: [],
      isLoading: false,
      error: null,
      totalInvoices: 0,
      lastFetchTimestamp: null,
      isInitialized: false,

      /**
       * Initialize from PouchDB cache
       */
      initializeFromCache: async () => {
        const state = get();
        if (!state.isInitialized) {
          try {
            console.log('🔄 Initializing from PouchDB cache...');
            
            // Load from PouchDB cache
            const cachedData = await CacheManager.getCachedInvoices({ 
              page: 1, 
              pageSize: 25 
            });
            
            set({
              invoices: cachedData.invoices,
              totalInvoices: cachedData.totalInvoices,
              isInitialized: true,
              lastFetchTimestamp: new Date().toISOString()
            });

            console.log(`✅ Initialized with ${cachedData.invoices.length} cached invoices`);
          } catch (error) {
            console.error('Error initializing from cache:', error);
            set({ 
              isInitialized: true,
              invoices: [],
              totalInvoices: 0 
            });
          }
        }
      },

      /**
       * Fetch paginated invoices from PouchDB
       */
      fetchInvoices: async ({ searchTerm = '', page = 1, pageSize = 25 } = {}) => {
        set({ isLoading: true, error: null });

        try {
          console.log(`🔍 Fetching invoices from PouchDB - Page ${page}, Search: "${searchTerm}"`);
          
          const cachedData = await CacheManager.getCachedInvoices({
            searchTerm,
            page,
            pageSize
          });

          set({
            invoices: cachedData.invoices,
            totalInvoices: cachedData.totalInvoices,
            isLoading: false,
            lastFetchTimestamp: new Date().toISOString(),
            error: null
          });

          console.log(`✅ Fetched ${cachedData.invoices.length} invoices from PouchDB`);

        } catch (error) {
          console.error('❌ Error fetching invoices from PouchDB:', error);
          set({
            error: 'Failed to fetch invoices from local database',
            isLoading: false
          });
        }
      },

      /**
       * Add new invoice
       */
      addInvoice: async (newInvoice) => {
        try {
          console.log('💾 Adding new invoice to PouchDB...');
          
          // Ensure the invoice has required fields
          const invoiceData = {
            _id: newInvoice._id || `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'SALE',
            ...newInvoice,
            createdAt: newInvoice.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: newInvoice.status || 'completed'
          };

          // Add to PouchDB cache
          await CacheManager.addInvoiceToCache(invoiceData);
          
          // Update UI state
          const state = get();
          const currentInvoices = state.invoices;
          
          set({
            invoices: [invoiceData, ...currentInvoices.slice(0, 24)],
            totalInvoices: state.totalInvoices + 1,
            lastFetchTimestamp: new Date().toISOString()
          });

          console.log(`✅ Added invoice ${invoiceData._id} successfully`);
          return invoiceData;

        } catch (error) {
          console.error('❌ Error adding invoice:', error);
          set({ error: 'Failed to add invoice' });
          throw error;
        }
      },

      /**
       * Update existing invoice
       */
      updateInvoice: async (invoiceId, updates) => {
        try {
          console.log(`🔄 Updating invoice ${invoiceId}...`);
          
          // Get existing invoice
          const existingInvoice = await CacheManager.getCachedInvoiceById(invoiceId);
          if (!existingInvoice) {
            throw new Error('Invoice not found');
          }

          // Merge updates
          const updatedInvoice = {
            ...existingInvoice,
            ...updates,
            updatedAt: new Date().toISOString()
          };

          // Update in PouchDB
          await CacheManager.updateInvoiceInCache(updatedInvoice);
          
          // Update UI state
          const state = get();
          const currentInvoices = state.invoices;
          const invoiceIndex = currentInvoices.findIndex(inv => inv._id === invoiceId);
          
          if (invoiceIndex !== -1) {
            const updatedInvoices = [...currentInvoices];
            updatedInvoices[invoiceIndex] = updatedInvoice;
            
            set({
              invoices: updatedInvoices,
              lastFetchTimestamp: new Date().toISOString()
            });
          }

          console.log(`✅ Updated invoice ${invoiceId} successfully`);
          return updatedInvoice;

        } catch (error) {
          console.error('❌ Error updating invoice:', error);
          set({ error: 'Failed to update invoice' });
          throw error;
        }
      },

      /**
       * Delete invoice
       */
      deleteInvoice: async (invoiceId) => {
        try {
          console.log(`🗑️ Deleting invoice ${invoiceId}...`);
          
          // Remove from PouchDB
          await CacheManager.removeInvoiceFromCache(invoiceId);
          
          // Update UI state
          const state = get();
          const currentInvoices = state.invoices;
          const filteredInvoices = currentInvoices.filter(inv => inv._id !== invoiceId);
          
          set({
            invoices: filteredInvoices,
            totalInvoices: Math.max(0, state.totalInvoices - 1),
            lastFetchTimestamp: new Date().toISOString()
          });

          console.log(`✅ Deleted invoice ${invoiceId} successfully`);

        } catch (error) {
          console.error('❌ Error deleting invoice:', error);
          set({ error: 'Failed to delete invoice' });
          throw error;
        }
      },

      /**
       * Process return for an invoice
       */
      processReturn: async (returnData) => {
        try {
          console.log(`↩️ Processing return for invoice ${returnData.originalInvoiceId}...`);
          
          // Ensure return has required fields
          const returnDocument = {
            _id: returnData._id || `RET-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'RETURN',
            ...returnData,
            createdAt: returnData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: returnData.status || 'completed'
          };

          // Add return to cache
          await CacheManager.addReturnToCache(returnDocument);
          
          // Update invoice with return information
          await get().updateInvoiceReturns(returnData.originalInvoiceId, returnDocument);

          console.log(`✅ Processed return ${returnDocument._id} successfully`);
          return returnDocument;

        } catch (error) {
          console.error('❌ Error processing return:', error);
          set({ error: 'Failed to process return' });
          throw error;
        }
      },

      /**
       * Update invoice returns data after processing a return
       */
      updateInvoiceReturns: async (invoiceId, newReturnData) => {
        try {
          // Get updated invoice with returns from cache
          const updatedInvoice = await CacheManager.getCachedInvoiceById(invoiceId);
          
          if (updatedInvoice) {
            const state = get();
            const currentInvoices = state.invoices;
            const invoiceIndex = currentInvoices.findIndex(inv => inv._id === invoiceId);
            
            if (invoiceIndex !== -1) {
              const updatedInvoices = [...currentInvoices];
              updatedInvoices[invoiceIndex] = updatedInvoice;

              set({
                invoices: updatedInvoices,
                lastFetchTimestamp: new Date().toISOString()
              });
            }
          }
        } catch (error) {
          console.error('Error updating invoice returns:', error);
        }
      },

      /**
       * Get invoice by ID
       */
      getInvoiceById: async (invoiceId) => {
        try {
          // Check current UI state first
          const state = get();
          const uiCached = state.invoices.find(inv => inv._id === invoiceId);
          if (uiCached) return uiCached;

          // Get from PouchDB cache
          const cached = await CacheManager.getCachedInvoiceById(invoiceId);
          return cached;

        } catch (error) {
          console.error('Error fetching invoice by ID:', error);
          return null;
        }
      },

      /**
       * Fetch unpaid invoices for a customer
       */
      fetchUnpaidInvoicesForCustomer: async (customerId) => {
        if (!customerId) return [];

        try {
          console.log(`🔍 Fetching unpaid invoices for customer ${customerId}...`);
          
          const unpaidInvoices = await CacheManager.getCachedUnpaidInvoicesForCustomer(customerId);
          
          console.log(`✅ Found ${unpaidInvoices.length} unpaid invoices for customer`);
          return unpaidInvoices;

        } catch (error) {
          console.error('Error fetching unpaid invoices:', error);
          return [];
        }
      },

      /**
       * Search transactions
       */
      searchTransactions: async (keyword) => {
        if (!keyword?.trim()) return [];
        
        try {
          console.log(`🔍 Searching transactions for: "${keyword}"`);
          
          const results = await CacheManager.searchTransactionsOffline(keyword);
          
          console.log(`✅ Found ${results.length} matching transactions`);
          return results;

        } catch (error) {
          console.error('Error searching transactions:', error);
          return [];
        }
      },

      /**
       * Refresh invoices (reload from PouchDB)
       */
      refreshInvoices: async () => {
        console.log('🔄 Refreshing invoices from PouchDB...');
        await get().fetchInvoices({
          searchTerm: '',
          page: 1,
          pageSize: 25
        });
      },

      /**
       * Get transaction statistics
       */
      getTransactionStats: async () => {
        try {
          const stats = await CacheManager.getCachedTransactionStats();
          return stats || {
            totalSales: 0,
            totalRevenue: 0,
            totalReturns: 0,
            totalReturnValue: 0,
            averageOrderValue: 0
          };
        } catch (error) {
          console.error('Error getting transaction stats:', error);
          return {
            totalSales: 0,
            totalRevenue: 0,
            totalReturns: 0,
            totalReturnValue: 0,
            averageOrderValue: 0
          };
        }
      },

      /**
       * Update transaction statistics
       */
      updateTransactionStats: async (stats) => {
        try {
          await CacheManager.cacheTransactionStats(stats);
        } catch (error) {
          console.error('Error updating transaction stats:', error);
        }
      },

      /**
       * Get cache health information
       */
      getCacheHealth: async () => {
        try {
          return await CacheManager.healthCheck();
        } catch (error) {
          console.error('Error getting cache health:', error);
          return { healthy: false, error: error.message };
        }
      },

      /**
       * Clear all cache and reset store
       */
      clearCache: async () => {
        try {
          console.log('🗑️ Clearing all transaction cache...');
          
          await CacheManager.clearAllCache();
          
          set({
            invoices: [],
            totalInvoices: 0,
            lastFetchTimestamp: null,
            isInitialized: false,
            error: null
          });

          console.log('✅ Transaction cache cleared successfully');

        } catch (error) {
          console.error('Error clearing cache:', error);
          set({ error: 'Failed to clear cache' });
        }
      },

      /**
       * Import bulk invoices (for data migration)
       */
      importBulkInvoices: async (invoices) => {
        if (!Array.isArray(invoices) || invoices.length === 0) {
          throw new Error('Invalid invoices data for bulk import');
        }

        try {
          console.log(`📥 Importing ${invoices.length} invoices...`);
          set({ isLoading: true });

          // Process invoices in batches to avoid overwhelming the system
          const batchSize = 50;
          let imported = 0;

          for (let i = 0; i < invoices.length; i += batchSize) {
            const batch = invoices.slice(i, i + batchSize);
            
            // Process each invoice in the batch
            for (const invoice of batch) {
              const invoiceData = {
                _id: invoice._id || `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'SALE',
                ...invoice,
                createdAt: invoice.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: invoice.status || 'completed'
              };

              await CacheManager.addInvoiceToCache(invoiceData);
              imported++;
            }

            // Update progress
            console.log(`📥 Imported ${imported}/${invoices.length} invoices...`);
          }

          // Refresh the UI with the new data
          await get().refreshInvoices();

          set({ isLoading: false });
          console.log(`✅ Successfully imported ${imported} invoices`);

          return { success: true, imported };

        } catch (error) {
          console.error('❌ Error importing bulk invoices:', error);
          set({ 
            isLoading: false,
            error: 'Failed to import invoices'
          });
          throw error;
        }
      },

      /**
       * Export all invoices (for backup)
       */
      exportAllInvoices: async () => {
        try {
          console.log('📤 Exporting all invoices...');
          
          const allInvoices = await CacheManager.getCachedInvoices({
            page: 1,
            pageSize: 10000 // Get all invoices
          });

          console.log(`✅ Exported ${allInvoices.invoices.length} invoices`);
          return allInvoices.invoices;

        } catch (error) {
          console.error('❌ Error exporting invoices:', error);
          throw error;
        }
      }
    }),
    {
      name: 'transaction-store',
      storage: createJSONStorage(() => customStorage),
      partialize: (state) => ({
        // Only persist minimal UI state, let PouchDB handle the heavy caching
        lastFetchTimestamp: state.lastFetchTimestamp,
        isInitialized: state.isInitialized
      })
    }
  )
);
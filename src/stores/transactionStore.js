import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import axios from 'axios';
import CacheManager from '../utils/cache/index.js';

const SALES_DB_URL = 'http://localhost:5984/sales';
const RETURNS_DB_URL = SALES_DB_URL;

const DB_AUTH = {
  auth: { username: 'admin', password: 'mynewsecretpassword' }
};

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
      isOnline: navigator.onLine,

      /**
       * Initialize with cached data immediately - no loading
       */
      initializeFromCache: async () => {
        const state = get();
        if (!state.isInitialized) {
          try {
            // Load from PouchDB cache first
            const cachedData = await CacheManager.getCachedInvoices({ 
              page: 1, 
              pageSize: 25 
            });
            
            if (cachedData.invoices.length > 0) {
              set({
                invoices: cachedData.invoices,
                totalInvoices: cachedData.totalInvoices,
                isInitialized: true
              });
            } else {
              set({ isInitialized: true });
            }

            // Check if cache is stale and needs refresh
            const isStale = await CacheManager.isTransactionCacheStale(0.5); // 30 minutes
            
            if (isStale && navigator.onLine) {
              // Start background sync
              setTimeout(() => {
                state.syncWithServer();
              }, 100);
            }
          } catch (error) {
            console.error('Error initializing from cache:', error);
            set({ isInitialized: true });
          }
        }
      },

      /**
       * Sync with server and update cache
       */
      syncWithServer: async () => {
        if (!navigator.onLine) {
          console.log('📱 Offline mode - using cached data');
          return;
        }

        try {
          console.log('🔄 Syncing transactions with server...');
          
          // Fetch fresh invoices from server
          const invoicesQuery = {
            selector: {
              type: 'SALE',
              createdAt: { $gte: '2000-01-01T00:00:00Z' }
            },
            limit: 500, // Increased limit for better caching
            sort: [{ createdAt: 'desc' }],
            use_index: 'sales-by-date-desc-index'
          };

          const invoicesResponse = await axios.post(
            `${SALES_DB_URL}/_find`,
            invoicesQuery,
            DB_AUTH
          );

          // Fetch fresh returns from server
          const returnsQuery = {
            selector: {
              type: 'RETURN'
            },
            limit: 200,
            use_index: 'returns-by-invoice-index'
          };

          const returnsResponse = await axios.post(
            `${RETURNS_DB_URL}/_find`,
            returnsQuery,
            DB_AUTH
          );

          // Cache the fresh data
          await CacheManager.cacheInvoices(invoicesResponse.data.docs);
          await CacheManager.cacheReturns(returnsResponse.data.docs);

          // Update sync metadata
          await CacheManager.updateSyncMetadata('transactions', invoicesResponse.data.docs.length);
          await CacheManager.updateSyncMetadata('returns', returnsResponse.data.docs.length);

          console.log('✅ Transaction sync completed');

          // If user is on the first page, update UI
          const state = get();
          if (state.invoices.length === 0) {
            const freshData = await CacheManager.getCachedInvoices({ 
              page: 1, 
              pageSize: 25 
            });
            
            set({
              invoices: freshData.invoices,
              totalInvoices: freshData.totalInvoices,
              lastFetchTimestamp: new Date().toISOString()
            });
          }

        } catch (error) {
          console.error('❌ Error syncing with server:', error);
          // Continue with cached data
        }
      },

      /**
       * Fetch paginated invoices (cache-first approach)
       */
      fetchInvoices: async ({ searchTerm = '', page = 1, pageSize = 25 } = {}) => {
        const state = get();
        
        // Show loading for search or pagination
        const shouldShowLoading = searchTerm || page > 1;
        if (shouldShowLoading) {
          set({ isLoading: true, error: null });
        }

        try {
          // Try cache first
          const cachedData = await CacheManager.getCachedInvoices({
            searchTerm,
            page,
            pageSize
          });

          // If we have cached data, use it
          if (cachedData.invoices.length > 0 || !navigator.onLine) {
            set({
              invoices: cachedData.invoices,
              totalInvoices: cachedData.totalInvoices,
              isLoading: false,
              lastFetchTimestamp: new Date().toISOString()
            });

            // If online and cache might be stale, sync in background
            if (navigator.onLine) {
              const isStale = await CacheManager.isTransactionCacheStale(0.5);
              if (isStale) {
                setTimeout(() => state.syncWithServer(), 100);
              }
            }
            
            return;
          }

          // Fallback to server if cache is empty and we're online
          if (navigator.onLine) {
            await state.fetchFromServer({ searchTerm, page, pageSize });
          } else {
            // Offline with no cache
            set({
              invoices: [],
              totalInvoices: 0,
              isLoading: false,
              error: 'No cached data available offline'
            });
          }

        } catch (error) {
          console.error('❌ Error fetching invoices:', error);
          set({
            error: 'Failed to fetch invoices',
            isLoading: false
          });
        }
      },

      /**
       * Fetch from server (fallback method)
       */
      fetchFromServer: async ({ searchTerm = '', page = 1, pageSize = 25 } = {}) => {
        try {
          const skip = (page - 1) * pageSize;

          let selector = {
            type: 'SALE',
            createdAt: { $gte: '2000-01-01T00:00:00Z' }
          };

          if (searchTerm.trim()) {
            selector.$or = [
              { _id: { $regex: `(?i).*${searchTerm}.*` } },
              { customerName: { $regex: `(?i).*${searchTerm}.*` } }
            ];
          }

          // Get total count
          const countQuery = {
            selector,
            fields: ['_id'],
            limit: 1000,
            use_index: 'sales-by-date-desc-index'
          };

          const countRes = await axios.post(
            `${SALES_DB_URL}/_find`,
            countQuery,
            DB_AUTH
          );

          // Fetch paginated invoices
          const salesQuery = {
            selector,
            limit: pageSize,
            skip,
            sort: [{ createdAt: 'desc' }],
            use_index: 'sales-by-date-desc-index'
          };

          const salesRes = await axios.post(
            `${SALES_DB_URL}/_find`,
            salesQuery,
            DB_AUTH
          );

          const salesDocs = salesRes.data.docs;

          // Fetch returns for these invoices
          const invoiceIds = salesDocs.map((doc) => doc._id);
          let relatedReturns = [];

          if (invoiceIds.length > 0) {
            const returnsQuery = {
              selector: {
                type: 'RETURN',
                originalInvoiceId: { $in: invoiceIds }
              },
              use_index: 'returns-by-invoice-index',
              limit: 200
            };

            const returnsRes = await axios.post(
              `${RETURNS_DB_URL}/_find`,
              returnsQuery,
              DB_AUTH
            );

            relatedReturns = returnsRes.data.docs;
          }

          // Group returns by invoice ID
          const returnsMap = new Map();
          relatedReturns.forEach((r) => {
            if (!returnsMap.has(r.originalInvoiceId)) {
              returnsMap.set(r.originalInvoiceId, []);
            }
            returnsMap.get(r.originalInvoiceId).push(r);
          });

          // Attach returns to invoices
          const salesWithReturns = salesDocs.map((sale) => ({
            ...sale,
            relatedReturns: returnsMap.get(sale._id) || []
          }));

          set({
            invoices: salesWithReturns,
            isLoading: false,
            totalInvoices: countRes.data.docs.length,
            lastFetchTimestamp: new Date().toISOString()
          });

          // Cache the fetched data for future use
          if (salesDocs.length > 0) {
            await CacheManager.cacheInvoices(salesDocs);
          }
          if (relatedReturns.length > 0) {
            await CacheManager.cacheReturns(relatedReturns);
          }

        } catch (error) {
          console.error('❌ Error fetching from server:', error);
          throw error;
        }
      },

      /**
       * Fetch unpaid invoices for a customer (cache-first)
       */
      fetchUnpaidInvoicesForCustomer: async (customerId) => {
        if (!customerId) return [];

        try {
          // Try cache first
          const cachedUnpaid = await CacheManager.getCachedUnpaidInvoicesForCustomer(customerId);
          
          if (cachedUnpaid.length > 0 || !navigator.onLine) {
            return cachedUnpaid;
          }

          // Fallback to server
          const query = {
            selector: {
              customerId,
              type: 'SALE'
            },
            sort: [
              { customerId: 'asc' },
              { type: 'asc' }, 
              { createdAt: 'asc' }
            ],
            use_index: 'sales-by-customer-index'
          };

          const res = await axios.post(
            `${SALES_DB_URL}/_find`,
            query,
            DB_AUTH
          );

          const salesDocs = res.data.docs;

          // Fetch related returns
          const invoiceIds = salesDocs.map((doc) => doc._id);
          let relatedReturns = [];

          if (invoiceIds.length > 0) {
            const returnsQuery = {
              selector: {
                type: 'RETURN',
                originalInvoiceId: { $in: invoiceIds }
              },
              use_index: 'returns-by-invoice-index',
              limit: 200
            };

            const returnsRes = await axios.post(
              `${RETURNS_DB_URL}/_find`,
              returnsQuery,
              DB_AUTH
            );

            relatedReturns = returnsRes.data.docs;
          }

          const returnsMap = new Map();
          relatedReturns.forEach((r) => {
            if (!returnsMap.has(r.originalInvoiceId)) {
              returnsMap.set(r.originalInvoiceId, []);
            }
            returnsMap.get(r.originalInvoiceId).push(r);
          });

          const unpaidInvoices = salesDocs.filter((invoice) => {
            const returns = returnsMap.get(invoice._id) || [];
            const totalReturned = returns.reduce(
              (sum, r) => sum + (r.totalReturnValue || 0),
              0
            );

            const netPayable =
              (invoice.total || 0) - (invoice.amountPaid || 0) - totalReturned;

            return netPayable > 0.01;
          });

          return unpaidInvoices.sort(
            (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
          );

        } catch (error) {
          console.error('Error fetching unpaid invoices:', error);
          return [];
        }
      },

      /**
       * Add new invoice to cache and UI
       */
      addNewInvoice: async (newInvoice) => {
        try {
          // Add to cache
          await CacheManager.addInvoiceToCache(newInvoice);
          
          // Update UI if user is on first page
          const state = get();
          const currentInvoices = state.invoices;
          
          if (currentInvoices.length > 0) {
            set({
              invoices: [newInvoice, ...currentInvoices.slice(0, 24)],
              totalInvoices: state.totalInvoices + 1,
              lastFetchTimestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error('Error adding new invoice:', error);
        }
      },

      /**
       * Update invoice returns data after processing a return
       */
      updateInvoiceReturns: async (invoiceId, newReturnData) => {
        try {
          // Add return to cache
          if (newReturnData) {
            await CacheManager.addReturnToCache(newReturnData);
          }

          // Update cache and UI
          const state = get();
          const currentInvoices = state.invoices;
          const invoiceIndex = currentInvoices.findIndex(inv => inv._id === invoiceId);
          
          if (invoiceIndex !== -1) {
            // Get updated invoice with returns from cache
            const updatedInvoice = await CacheManager.getCachedInvoiceById(invoiceId);
            
            if (updatedInvoice) {
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
       * Get invoice by ID (cache-first)
       */
      getInvoiceById: async (invoiceId) => {
        try {
          // Check cache first
          const cached = await CacheManager.getCachedInvoiceById(invoiceId);
          if (cached) return cached;

          // Check current UI state
          const state = get();
          const uiCached = state.invoices.find(inv => inv._id === invoiceId);
          if (uiCached) return uiCached;

          // Fallback to server if online
          if (!navigator.onLine) {
            return null;
          }

          const res = await axios.get(`${SALES_DB_URL}/${invoiceId}`, DB_AUTH);
          const invoice = res.data;

          // Fetch related returns
          const returnsQuery = {
            selector: {
              type: 'RETURN',
              originalInvoiceId: invoiceId
            },
            use_index: 'returns-by-invoice-index',
            limit: 50
          };

          const returnsRes = await axios.post(
            `${RETURNS_DB_URL}/_find`,
            returnsQuery,
            DB_AUTH
          );

          invoice.relatedReturns = returnsRes.data.docs;

          // Cache the fetched invoice and returns
          await CacheManager.addInvoiceToCache(invoice);
          if (invoice.relatedReturns.length > 0) {
            await Promise.all(
              invoice.relatedReturns.map(ret => CacheManager.addReturnToCache(ret))
            );
          }

          return invoice;
        } catch (error) {
          console.error('Error fetching invoice by ID:', error);
          return null;
        }
      },

      /**
       * Search transactions (cache-first for offline support)
       */
      searchTransactions: async (keyword) => {
        try {
          // Try offline search first
          const offlineResults = await CacheManager.searchTransactionsOffline(keyword);
          
          if (offlineResults.length > 0 || !navigator.onLine) {
            return offlineResults;
          }

          // If online and no cached results, fetch from server
          return await get().fetchFromServer({ 
            searchTerm: keyword, 
            page: 1, 
            pageSize: 50 
          });

        } catch (error) {
          console.error('Error searching transactions:', error);
          return [];
        }
      },

      /**
       * Refresh invoices table (page 1)
       */
      refreshInvoices: async () => {
        const state = get();
        
        // Clear cache and fetch fresh
        if (navigator.onLine) {
          await state.syncWithServer();
        }
        
        await state.fetchInvoices({
          searchTerm: '',
          page: 1,
          pageSize: 25
        });
      },

      /**
       * Handle online/offline status changes
       */
      setOnlineStatus: (isOnline) => {
        set({ isOnline });
        
        if (isOnline) {
          // When coming back online, sync with server
          const state = get();
          setTimeout(() => state.syncWithServer(), 1000);
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
       * Clear all cache
       */
      clearCache: async () => {
        try {
          await CacheManager.clearAllCache();
          set({
            invoices: [],
            totalInvoices: 0,
            lastFetchTimestamp: null,
            isInitialized: false
          });
        } catch (error) {
          console.error('Error clearing cache:', error);
        }
      }
    }),
    {
      name: 'transaction-store',
      storage: createJSONStorage(() => customStorage),
      partialize: (state) => ({
        // Only persist minimal UI state, let PouchDB handle the heavy caching
        lastFetchTimestamp: state.lastFetchTimestamp,
        isInitialized: state.isInitialized,
        isOnline: state.isOnline
      })
    }
  )
);

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useTransactionStore.getState().setOnlineStatus(true);
  });
  
  window.addEventListener('offline', () => {
    useTransactionStore.getState().setOnlineStatus(false);
  });
}
// DashboardSyncService.cjs - FIXED VERSION
const configManager = require('./config-manager.cjs');
const axios = require('axios');

class DashboardSyncService {
    constructor(localDbManager) {
        this.localDbManager = localDbManager;
        this.syncInterval = null;
        this.isRunning = false;
        this.lastSyncTime = null;
        this.syncErrors = [];
        
        // TESTING MODE: Set short interval for live testing
        this.SYNC_INTERVAL_MS = 30000; // 30 seconds for testing
        this.SYNC_INTERVAL_DISPLAY = '30 seconds';
        
        // Load CouchDB configuration
        this.BASE_URL = configManager.get('DATABASE_URL');
        this.DB_USERNAME = configManager.get('DATABASE_USERNAME');
        this.DB_PASSWORD = configManager.get('DATABASE_PASSWORD');
        this.DASHBOARD_DB_URL = `${this.BASE_URL}/dashboard_summaries`;
        
        // Enhanced axios configuration for CouchDB
        this.dbAuth = {
            auth: {
                username: this.DB_USERNAME,
                password: this.DB_PASSWORD
            },
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'PharmAssist-Dashboard-Sync/1.0.0'
            },
            maxRetries: 3,
            retryDelay: 1000
        };
        
        console.log('✅ Dashboard Sync Service initialized');
        console.log(`⏱️ TESTING MODE: Sync interval set to ${this.SYNC_INTERVAL_DISPLAY}`);
        console.log('🌐 Target CouchDB:', this.DASHBOARD_DB_URL);
    }

    // FIXED: Generate current summary with better error handling and fallbacks
    async generateCurrentSummary() {
        try {
            console.log('🔍 Starting summary generation...');
            
            // FIXED: Don't return null immediately, try to work with what we have
            const now = new Date();
            const currentTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
            
            // Initialize with defaults
            let storeId = 'default-store';
            let storeName = 'Default Store';
            
            // Try to get store info but don't fail if unavailable
            try {
                if (this.localDbManager && this.localDbManager.currentStoreId) {
                    storeId = this.localDbManager.currentStoreId;
                    console.log('📊 Using current store ID:', storeId);
                }
                
                if (this.localDbManager && typeof this.localDbManager.loadStoreConfig === 'function') {
                    const storeConfig = this.localDbManager.loadStoreConfig();
                    if (storeConfig && storeConfig.storeName) {
                        storeName = storeConfig.storeName;
                        console.log('📊 Store config loaded:', { storeId, storeName });
                    }
                }
            } catch (configError) {
                console.warn('⚠️ Store config unavailable, using defaults:', configError.message);
            }

            console.log(`📊 Generating summary for store: ${storeName} (${storeId})`);

            // Set time range - last 24 hours for better data capture
            const periodStart = new Date(now);
            periodStart.setHours(periodStart.getHours() - 24);
            const periodEnd = new Date(now);

            console.log(`📊 Data period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

            // Initialize data arrays
            let salesData = [];
            let customersData = [];
            let suppliersData = [];
            let purchasesData = [];

            // FIXED: Robust database access with multiple fallback strategies
            if (this.localDbManager) {
                console.log('📊 Database manager available, fetching data...');
                
                // Try to fetch sales data with multiple fallback strategies
                salesData = await this.fetchDataWithFallbacks('sales', {
                    primary: {
                        selector: {
                            $and: [
                                { createdAt: { $gte: periodStart.toISOString() } },
                                { createdAt: { $lte: periodEnd.toISOString() } }
                            ]
                        },
                        limit: 1000
                    },
                    fallback1: {
                        selector: { _id: { $gte: null } },
                        limit: 500,
                        sort: [{ createdAt: 'desc' }]
                    },
                    fallback2: { limit: 100 }
                });

                // Try to fetch customers data
                customersData = await this.fetchDataWithFallbacks('customers', {
                    primary: {
                        selector: { _id: { $gte: null } },
                        limit: 500
                    },
                    fallback1: { limit: 100 }
                });

                // Try to fetch suppliers data
                suppliersData = await this.fetchDataWithFallbacks('suppliers', {
                    primary: {
                        selector: { _id: { $gte: null } },
                        limit: 100
                    },
                    fallback1: { limit: 50 }
                });

                // Try to fetch purchases data
                purchasesData = await this.fetchDataWithFallbacks('purchases', {
                    primary: {
                        selector: {
                            $and: [
                                { createdAt: { $gte: periodStart.toISOString() } },
                                { createdAt: { $lte: periodEnd.toISOString() } }
                            ]
                        },
                        limit: 500
                    },
                    fallback1: {
                        selector: { _id: { $gte: null } },
                        limit: 250,
                        sort: [{ createdAt: 'desc' }]
                    },
                    fallback2: { limit: 100 }
                });
            } else {
                console.warn('⚠️ No database manager available, creating summary with zero data');
            }

            console.log('📊 Data fetched:', {
                sales: salesData.length,
                customers: customersData.length,
                suppliers: suppliersData.length,
                purchases: purchasesData.length
            });

            // Calculate summary metrics
            const summary = this.calculateCurrentMetrics(salesData, customersData, suppliersData, purchasesData);

            console.log('📊 Calculated metrics:', {
                totalRevenue: summary.totalRevenue,
                totalSales: summary.totalSales,
                totalPurchases: summary.totalPurchases,
                itemsSold: summary.itemsSold
            });

            // Create the summary document - ALWAYS CREATE ONE
            const summaryDoc = {
                _id: `summary-${currentTimestamp}`,
                storeId: storeId,
                storeName: storeName,
                timestamp: currentTimestamp,
                period: {
                    start: periodStart.toISOString(),
                    end: periodEnd.toISOString()
                },
                syncMode: 'testing',
                ...summary,
                metadata: {
                    dataPoints: {
                        sales: salesData.length,
                        customers: customersData.length,
                        suppliers: suppliersData.length,
                        purchases: purchasesData.length
                    },
                    generatedAt: now.toISOString(),
                    version: '1.0-testing',
                    debug: {
                        hasDbManager: !!this.localDbManager,
                        dbManagerInitialized: this.localDbManager ? this.localDbManager.isInitialized : false,
                        currentStoreId: this.localDbManager ? this.localDbManager.currentStoreId : null
                    }
                }
            };

            console.log(`📊 Generated summary document: ${summaryDoc._id}`);
            console.log(`📈 Summary contains: ${summaryDoc.totalSales} sales, revenue: ${summaryDoc.totalRevenue}`);
            
            return summaryDoc;

        } catch (error) {
            console.error('❌ Error generating summary:', error);
            
            // ALWAYS return a valid summary document even on complete failure
            const now = new Date();
            const currentTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
            
            return {
                _id: `summary-error-${currentTimestamp}`,
                storeId: 'error-state',
                storeName: 'Error State',
                timestamp: currentTimestamp,
                period: {
                    start: now.toISOString(),
                    end: now.toISOString()
                },
                syncMode: 'testing-error',
                totalRevenue: 0,
                totalProfit: 0,
                netCashFlow: 0,
                cashInflow: 0,
                cashOutflow: 0,
                totalSales: 0,
                itemsSold: 0,
                dueByCustomers: 0,
                payableToSuppliers: 0,
                creditWithSuppliers: 0,
                customerStoreCredit: 0,
                totalPurchases: 0,
                averageSale: 0,
                customerRefunds: 0,
                supplierReturns: 0,
                metadata: {
                    dataPoints: { sales: 0, customers: 0, suppliers: 0, purchases: 0 },
                    generatedAt: now.toISOString(),
                    version: '1.0-testing-error',
                    error: error.message,
                    debug: {
                        hasDbManager: !!this.localDbManager,
                        dbManagerInitialized: this.localDbManager ? this.localDbManager.isInitialized : false,
                        currentStoreId: this.localDbManager ? this.localDbManager.currentStoreId : null
                    }
                }
            };
        }
    }

    // NEW: Robust data fetching with multiple fallback strategies
    async fetchDataWithFallbacks(collectionName, strategies) {
        if (!this.localDbManager) {
            console.log(`⚠️ No database manager for ${collectionName}`);
            return [];
        }

        const strategyNames = ['primary', 'fallback1', 'fallback2'];
        
        for (const strategyName of strategyNames) {
            if (!strategies[strategyName]) continue;
            
            try {
                console.log(`🔍 Fetching ${collectionName} data (${strategyName})...`);
                
                const db = this.localDbManager.getDatabase(collectionName);
                if (!db) {
                    console.warn(`⚠️ ${collectionName} database not available`);
                    continue;
                }

                let result;
                const strategy = strategies[strategyName];
                
                if (strategy.selector) {
                    // Use find() method
                    result = await db.find(strategy);
                } else {
                    // Use allDocs() method
                    const allDocsOptions = {
                        include_docs: true,
                        ...strategy
                    };
                    const allDocsResult = await db.allDocs(allDocsOptions);
                    result = {
                        docs: allDocsResult.rows
                            .map(row => row.doc)
                            .filter(doc => doc && !doc._id.startsWith('_design'))
                    };
                }
                
                const docs = result.docs || [];
                console.log(`📊 ${collectionName}: ${docs.length} records (${strategyName})`);
                
                // Return result if we got any data, or if this was the last strategy
                if (docs.length > 0 || strategyName === 'fallback2') {
                    return docs;
                }
                
            } catch (error) {
                console.warn(`⚠️ ${collectionName} ${strategyName} failed:`, error.message);
                // Continue to next strategy
            }
        }
        
        console.log(`⚠️ All strategies failed for ${collectionName}, returning empty array`);
        return [];
    }

    // Calculate metrics from raw data (unchanged but with better logging)
    calculateCurrentMetrics(sales, customers, suppliers, purchases) {
        console.log('🔢 Calculating metrics from data:', {
            salesCount: sales.length,
            customersCount: customers.length,
            suppliersCount: suppliers.length,
            purchasesCount: purchases.length
        });

        // Initialize metrics
        let totalRevenue = 0;
        let totalProfit = 0;
        let cashInflow = 0;
        let cashOutflow = 0;
        let totalSales = 0;
        let itemsSold = 0;
        let customerRefunds = 0;
        let supplierReturns = 0;
        let totalPurchases = 0;

        // Process sales data
        if (Array.isArray(sales) && sales.length > 0) {
            console.log('💰 Processing sales data...');
            sales.forEach((sale, index) => {
                try {
                    if (sale.type === 'SALE') {
                        totalSales += 1;
                        const saleTotal = this.safeNumeric(sale.total || sale.grandTotal || sale.totalAmount);
                        const saleProfit = this.safeNumeric(sale.profit || sale.totalProfit);
                        const amountPaid = this.safeNumeric(sale.amountPaid || sale.paidAmount);
                        
                        totalRevenue += saleTotal;
                        totalProfit += saleProfit;
                        cashInflow += amountPaid;
                        
                        // Count items sold
                        if (Array.isArray(sale.items)) {
                            itemsSold += sale.items.reduce((sum, item) => 
                                sum + this.safeNumeric(item.quantity), 0);
                        } else if (sale.itemCount) {
                            itemsSold += this.safeNumeric(sale.itemCount);
                        }
                        
                        if (index < 5) { // Log first 5 sales
                            console.log(`  Sale ${index + 1}: Revenue=${saleTotal}, Profit=${saleProfit}`);
                        }
                        
                    } else if (sale.type === 'RETURN') {
                        const returnValue = Math.abs(this.safeNumeric(sale.totalReturnValue || sale.total));
                        customerRefunds += returnValue;
                        totalRevenue -= returnValue;
                        
                        if (sale.settlement?.type === 'REFUND' || sale.refundType === 'REFUND') {
                            cashOutflow += this.safeNumeric(sale.settlement?.amountRefunded || returnValue);
                        }
                        
                        if (Array.isArray(sale.items)) {
                            itemsSold -= sale.items.reduce((sum, item) => 
                                sum + this.safeNumeric(item.returnQuantity || item.quantity), 0);
                        }
                    }
                } catch (saleError) {
                    console.warn(`⚠️ Error processing sale ${index}:`, saleError.message);
                }
            });
        }

        // Process purchases data
        if (Array.isArray(purchases) && purchases.length > 0) {
            console.log('🛒 Processing purchases data...');
            purchases.forEach((purchase, index) => {
                try {
                    if (purchase.type === 'PURCHASE') {
                        const purchaseTotal = this.safeNumeric(
                            purchase.totals?.grandTotal || 
                            purchase.total || 
                            purchase.grandTotal ||
                            purchase.totalAmount
                        );
                        const amountPaid = this.safeNumeric(purchase.amountPaid || purchase.paidAmount);
                        
                        totalPurchases += purchaseTotal;
                        cashOutflow += amountPaid;
                        
                        if (index < 5) { // Log first 5 purchases
                            console.log(`  Purchase ${index + 1}: Total=${purchaseTotal}, Paid=${amountPaid}`);
                        }
                        
                    } else if (purchase.type === 'PURCHASE_RETURN') {
                        const returnValue = this.safeNumeric(purchase.totalReturnValue || purchase.total);
                        supplierReturns += returnValue;
                        totalPurchases -= returnValue;
                        
                        if (purchase.settlement?.type === 'REFUND') {
                            cashInflow += this.safeNumeric(purchase.settlement.amountRefunded);
                        }
                    }
                } catch (purchaseError) {
                    console.warn(`⚠️ Error processing purchase ${index}:`, purchaseError.message);
                }
            });
        }

        // Calculate customer balances
        let dueByCustomers = 0;
        let customerStoreCredit = 0;
        if (Array.isArray(customers) && customers.length > 0) {
            console.log('👥 Processing customer balances...');
            customers.forEach((customer, index) => {
                try {
                    const balance = this.safeNumeric(customer.balance);
                    if (balance > 0) {
                        dueByCustomers += balance;
                    } else if (balance < 0) {
                        customerStoreCredit += Math.abs(balance);
                    }
                } catch (customerError) {
                    console.warn(`⚠️ Error processing customer ${index}:`, customerError.message);
                }
            });
        }

        // Calculate supplier balances
        let payableToSuppliers = 0;
        let creditWithSuppliers = 0;
        if (Array.isArray(suppliers) && suppliers.length > 0) {
            console.log('🏢 Processing supplier balances...');
            suppliers.forEach((supplier, index) => {
                try {
                    const balance = this.safeNumeric(supplier.balance);
                    if (balance > 0) {
                        payableToSuppliers += balance;
                    } else if (balance < 0) {
                        creditWithSuppliers += Math.abs(balance);
                    }
                } catch (supplierError) {
                    console.warn(`⚠️ Error processing supplier ${index}:`, supplierError.message);
                }
            });
        }

        // Calculate derived metrics
        const netCashFlow = cashInflow - cashOutflow;
        const averageSale = totalSales > 0 ? totalRevenue / totalSales : 0;

        const calculatedMetrics = {
            totalRevenue: Math.max(0, totalRevenue),
            totalProfit: totalProfit,
            netCashFlow: netCashFlow,
            cashInflow: Math.max(0, cashInflow),
            cashOutflow: Math.max(0, cashOutflow),
            totalSales: Math.max(0, totalSales),
            itemsSold: itemsSold,
            dueByCustomers: Math.max(0, dueByCustomers),
            payableToSuppliers: Math.max(0, payableToSuppliers),
            creditWithSuppliers: Math.max(0, creditWithSuppliers),
            customerStoreCredit: Math.max(0, customerStoreCredit),
            totalPurchases: Math.max(0, totalPurchases),
            averageSale: Math.max(0, averageSale),
            customerRefunds: Math.max(0, customerRefunds),
            supplierReturns: Math.max(0, supplierReturns)
        };

        console.log('🔢 Final calculated metrics:', {
            totalRevenue: calculatedMetrics.totalRevenue,
            totalProfit: calculatedMetrics.totalProfit,
            totalSales: calculatedMetrics.totalSales,
            netCashFlow: calculatedMetrics.netCashFlow
        });

        return calculatedMetrics;
    }

    // Safe numeric conversion
    safeNumeric(value, defaultValue = 0) {
        if (typeof value === 'number') return isNaN(value) ? defaultValue : value;
        if (value === null || value === undefined) return defaultValue;
        const num = Number(value);
        return isNaN(num) ? defaultValue : num;
    }

    // Start sync service
    start() {
        if (this.isRunning) {
            console.log('⚠️ Dashboard sync already running');
            return;
        }

        this.isRunning = true;
        console.log(`🚀 Starting dashboard sync every ${this.SYNC_INTERVAL_DISPLAY}...`);
        
        // Initial sync after a short delay
        setTimeout(() => {
            this.performSync();
        }, 5000); // 5 second delay for initial sync
        
        // Schedule periodic syncs
        this.syncInterval = setInterval(() => {
            this.performSync();
        }, this.SYNC_INTERVAL_MS);
        
        console.log(`✅ Dashboard sync started - syncing every ${this.SYNC_INTERVAL_DISPLAY}`);
    }

    // Stop sync service
    stop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.isRunning = false;
        console.log('⏹️ Dashboard sync stopped');
    }

    // Perform sync operation
    async performSync() {
        try {
            console.log(`🔄 Starting dashboard sync (${this.SYNC_INTERVAL_DISPLAY} interval)...`);
            const startTime = Date.now();

            const summary = await this.generateCurrentSummary();
            
            // FIXED: Never skip sync - always upload summary
            if (!summary) {
                console.error('❌ Failed to generate summary - this should not happen');
                return { success: false, error: 'Failed to generate summary' };
            }

            await this.ensureDatabaseExists();
            const uploadResult = await this.uploadSummary(summary);
            await this.cleanupOldSummaries();

            this.lastSyncTime = new Date().toISOString();
            const duration = Date.now() - startTime;
            
            console.log(`✅ Dashboard sync completed in ${duration}ms`);
            console.log(`📊 Synced summary: ${summary._id}`);
            console.log(`📈 Data: ${summary.totalSales} sales, ${summary.totalRevenue} revenue`);
            
            // Clear any previous errors on successful sync
            if (this.syncErrors.length > 0) {
                this.syncErrors = [];
                console.log('✅ Previous sync errors cleared after successful sync');
            }

            return { 
                success: true, 
                summaryId: summary._id,
                duration,
                lastSyncTime: this.lastSyncTime,
                dataPoints: summary.metadata.dataPoints
            };

        } catch (error) {
            console.error('❌ Dashboard sync failed:', error.message);
            
            this.syncErrors.push({
                error: error.message,
                timestamp: new Date().toISOString(),
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
            
            // Keep only last 10 errors
            if (this.syncErrors.length > 10) {
                this.syncErrors = this.syncErrors.slice(-10);
            }

            return { success: false, error: error.message };
        }
    }

    // Ensure CouchDB database exists
    async ensureDatabaseExists() {
        try {
            const response = await axios.get(this.DASHBOARD_DB_URL, this.dbAuth);
            console.log('✅ Dashboard database exists');
            return true;
        } catch (error) {
            if (error.response?.status === 404) {
                try {
                    await axios.put(this.DASHBOARD_DB_URL, {}, this.dbAuth);
                    console.log('✅ Created dashboard database');
                    return true;
                } catch (createError) {
                    console.error('❌ Failed to create dashboard database:', createError.message);
                    throw createError;
                }
            } else {
                console.error('❌ Error checking dashboard database:', error.message);
                throw error;
            }
        }
    }

    // Upload summary to CouchDB
    async uploadSummary(summary) {
        try {
            const url = `${this.DASHBOARD_DB_URL}/${summary._id}`;
            
            let existingDoc = null;
            try {
                const existingResponse = await axios.get(url, this.dbAuth);
                existingDoc = existingResponse.data;
                console.log(`📝 Found existing summary: ${summary._id}`);
            } catch (error) {
                if (error.response?.status !== 404) {
                    throw error;
                }
            }

            if (existingDoc) {
                summary._rev = existingDoc._rev;
                console.log(`🔄 Updating existing summary: ${summary._id}`);
            }

            const response = await axios.put(url, summary, this.dbAuth);
            
            console.log(`✅ Successfully ${existingDoc ? 'updated' : 'created'} summary: ${summary._id}`);
            return response.data;

        } catch (error) {
            console.error('❌ Failed to upload summary:', error.message);
            if (error.response?.data) {
                console.error('📝 CouchDB error details:', error.response.data);
            }
            throw error;
        }
    }

    // Clean up old summaries (keep latest 100)
    async cleanupOldSummaries() {
        try {
            const allDocsUrl = `${this.DASHBOARD_DB_URL}/_all_docs?startkey="${encodeURIComponent('summary-')}"&include_docs=false&limit=1000`;
            
            const response = await axios.get(allDocsUrl, this.dbAuth);
            const allDocs = response.data.rows || [];

            if (allDocs.length <= 100) {
                console.log(`🧹 Only ${allDocs.length} summaries found, no cleanup needed`);
                return;
            }

            const sortedDocs = allDocs.sort((a, b) => b.id.localeCompare(a.id));
            const docsToDelete = sortedDocs.slice(100);

            if (docsToDelete.length === 0) {
                console.log('🧹 No old summaries to clean up');
                return;
            }

            console.log(`🧹 Found ${docsToDelete.length} old summaries to delete (keeping latest 100)`);

            const batchSize = 10;
            for (let i = 0; i < docsToDelete.length; i += batchSize) {
                const batch = docsToDelete.slice(i, i + batchSize);
                
                const deletePromises = batch.map(doc => {
                    const deleteUrl = `${this.DASHBOARD_DB_URL}/${doc.id}?rev=${doc.value.rev}`;
                    return axios.delete(deleteUrl, this.dbAuth).catch(err => {
                        console.warn(`⚠️ Failed to delete ${doc.id}:`, err.message);
                    });
                });

                await Promise.all(deletePromises);
                console.log(`🗑️ Deleted batch of ${batch.length} old summaries`);
            }

            console.log(`✅ Cleanup completed - deleted ${docsToDelete.length} old summaries`);

        } catch (error) {
            console.error('❌ Error during cleanup:', error.message);
        }
    }

    // Manual sync trigger
    async triggerManualSync() {
        console.log('🔄 Manual sync triggered (testing mode)');
        return await this.performSync();
    }

    // Get current sync status
    getSyncStatus() {
        const nextSyncTime = this.isRunning && this.lastSyncTime ? 
            new Date(new Date(this.lastSyncTime).getTime() + this.SYNC_INTERVAL_MS).toISOString() : null;

        return {
            isRunning: this.isRunning,
            lastSyncTime: this.lastSyncTime,
            hasErrors: this.syncErrors.length > 0,
            errorCount: this.syncErrors.length,
            lastError: this.syncErrors.length > 0 ? this.syncErrors[this.syncErrors.length - 1] : null,
            nextSyncTime: nextSyncTime,
            syncInterval: this.SYNC_INTERVAL_DISPLAY,
            testingMode: true
        };
    }

    // Get sync statistics
    getSyncStats() {
        const now = new Date();
        
        return {
            status: this.getSyncStatus(),
            errors: this.syncErrors,
            configuration: {
                syncInterval: this.SYNC_INTERVAL_DISPLAY,
                databaseUrl: this.DASHBOARD_DB_URL,
                retentionPolicy: 'Keep latest 100 summaries (testing mode)',
                testingMode: true
            },
            nextCleanupTime: this.isRunning ? 
                new Date(now.getTime() + this.SYNC_INTERVAL_MS).toISOString() : null
        };
    }

    // Switch to production mode (1 hour intervals)
    switchToProductionMode() {
        console.log('🔄 Switching to production mode...');
        
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
        }

        this.SYNC_INTERVAL_MS = 3600000; // 1 hour
        this.SYNC_INTERVAL_DISPLAY = '1 hour';

        console.log(`✅ Switched to production mode: ${this.SYNC_INTERVAL_DISPLAY} interval`);

        if (wasRunning) {
            this.start();
        }

        return { success: true, interval: this.SYNC_INTERVAL_DISPLAY };
    }

    // Set custom test interval
    setTestInterval(seconds) {
        console.log(`🔄 Setting test interval to ${seconds} seconds...`);
        
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
        }

        this.SYNC_INTERVAL_MS = seconds * 1000;
        this.SYNC_INTERVAL_DISPLAY = `${seconds} seconds`;

        console.log(`✅ Set test interval: ${this.SYNC_INTERVAL_DISPLAY}`);

        if (wasRunning) {
            this.start();
        }

        return { success: true, interval: this.SYNC_INTERVAL_DISPLAY };
    }

    // Shutdown sync service
    shutdown() {
        this.stop();
        console.log('✅ Dashboard sync service shutdown complete');
    }
}

module.exports = DashboardSyncService;
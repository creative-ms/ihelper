// DashboardSyncService.cjs - FIXED DATA GENERATION VERSION
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

    // FIXED: Generate current summary with proper data fetching
    async generateCurrentSummary() {
        try {
            console.log('🔍 Checking database manager initialization...');
            if (!this.localDbManager || !this.localDbManager.isInitialized) {
                console.log('❌ Local database not initialized');
                return null;
            }

            console.log('✅ Database manager is initialized');

            const now = new Date();
            const currentTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
            
            // Get store configuration
            let storeConfig;
            try {
                storeConfig = this.localDbManager.loadStoreConfig();
                console.log('📊 Store config loaded:', { storeId: storeConfig?.storeId, storeName: storeConfig?.storeName });
            } catch (configError) {
                console.warn('⚠️ Could not load store config:', configError);
                storeConfig = null;
            }

            const storeId = storeConfig?.storeId || this.localDbManager.currentStoreId || 'unknown';
            const storeName = storeConfig?.storeName || 'Unknown Store';

            console.log(`📊 Generating summary for store: ${storeName} (${storeId})`);

            // FIXED: Expanded time range to get more data
            const periodStart = new Date(now);
            periodStart.setHours(periodStart.getHours() - 24); // Last 24 hours instead of 5 minutes
            
            const periodEnd = new Date(now);

            console.log(`📊 Data period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

            // FIXED: Better database access with error handling
            let salesData = [];
            let customersData = [];
            let suppliersData = [];
            let purchasesData = [];

            try {
                console.log('🔍 Fetching sales data...');
                const salesDb = this.localDbManager.getDatabase('sales');
                if (salesDb) {
                    const salesResult = await salesDb.find({
                        selector: {
                            $or: [
                                { createdAt: { $gte: periodStart.toISOString(), $lte: periodEnd.toISOString() } },
                                { _id: { $gte: null } } // Fallback to get any sales
                            ]
                        },
                        limit: 1000
                    });
                    salesData = salesResult.docs || [];
                    console.log(`📊 Found ${salesData.length} sales records`);
                } else {
                    console.warn('⚠️ Sales database not available');
                }
            } catch (salesError) {
                console.error('❌ Error fetching sales:', salesError);
                // Try simpler query as fallback
                try {
                    const salesDb = this.localDbManager.getDatabase('sales');
                    const fallbackResult = await salesDb.allDocs({ include_docs: true, limit: 100 });
                    salesData = fallbackResult.rows.map(row => row.doc).filter(doc => doc && !doc._id.startsWith('_design'));
                    console.log(`📊 Fallback: Found ${salesData.length} sales records`);
                } catch (fallbackError) {
                    console.error('❌ Fallback sales query failed:', fallbackError);
                }
            }

            try {
                console.log('🔍 Fetching customers data...');
                const customersDb = this.localDbManager.getDatabase('customers');
                if (customersDb) {
                    const customersResult = await customersDb.find({
                        selector: { _id: { $gte: null } },
                        limit: 500
                    });
                    customersData = customersResult.docs || [];
                    console.log(`📊 Found ${customersData.length} customer records`);
                } else {
                    console.warn('⚠️ Customers database not available');
                }
            } catch (customersError) {
                console.error('❌ Error fetching customers:', customersError);
            }

            try {
                console.log('🔍 Fetching suppliers data...');
                const suppliersDb = this.localDbManager.getDatabase('suppliers');
                if (suppliersDb) {
                    const suppliersResult = await suppliersDb.find({
                        selector: { _id: { $gte: null } },
                        limit: 100
                    });
                    suppliersData = suppliersResult.docs || [];
                    console.log(`📊 Found ${suppliersData.length} supplier records`);
                } else {
                    console.warn('⚠️ Suppliers database not available');
                }
            } catch (suppliersError) {
                console.error('❌ Error fetching suppliers:', suppliersError);
            }

            try {
                console.log('🔍 Fetching purchases data...');
                const purchasesDb = this.localDbManager.getDatabase('purchases');
                if (purchasesDb) {
                    const purchasesResult = await purchasesDb.find({
                        selector: {
                            $or: [
                                { createdAt: { $gte: periodStart.toISOString(), $lte: periodEnd.toISOString() } },
                                { _id: { $gte: null } } // Fallback to get any purchases
                            ]
                        },
                        limit: 500
                    });
                    purchasesData = purchasesResult.docs || [];
                    console.log(`📊 Found ${purchasesData.length} purchase records`);
                } else {
                    console.warn('⚠️ Purchases database not available');
                }
            } catch (purchasesError) {
                console.error('❌ Error fetching purchases:', purchasesError);
            }

            // Calculate summary metrics
            const summary = this.calculateCurrentMetrics(salesData, customersData, suppliersData, purchasesData);

            console.log('📊 Calculated metrics:', {
                totalRevenue: summary.totalRevenue,
                totalSales: summary.totalSales,
                totalPurchases: summary.totalPurchases,
                itemsSold: summary.itemsSold
            });

            // Create the summary document - ALWAYS CREATE ONE EVEN WITH NO DATA
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
                    // Add debug info
                    debug: {
                        dbManagerInitialized: this.localDbManager.isInitialized,
                        currentStoreId: this.localDbManager.currentStoreId,
                        hasStoreConfig: !!storeConfig
                    }
                }
            };

            console.log(`📊 Generated summary document: ${summaryDoc._id}`);
            console.log(`📈 Summary contains: ${summaryDoc.totalSales} sales, revenue: ${summaryDoc.totalRevenue}`);
            
            return summaryDoc;

        } catch (error) {
            console.error('❌ Error generating current summary:', error);
            
            // FIXED: Return a basic summary even on error to ensure sync continues
            const now = new Date();
            const currentTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
            
            return {
                _id: `summary-error-${currentTimestamp}`,
                storeId: 'error',
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
                    error: error.message
                }
            };
        }
    }

    // Calculate metrics from raw data (FIXED calculations)
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
        if (Array.isArray(sales)) {
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
                        
                        console.log(`Sale ${index + 1}: Revenue=${saleTotal}, Profit=${saleProfit}, Items=${Array.isArray(sale.items) ? sale.items.length : 0}`);
                        
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
                    console.warn(`⚠️ Error processing sale ${index}:`, saleError);
                }
            });
        }

        // Process purchases data
        if (Array.isArray(purchases)) {
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
                        
                        console.log(`Purchase ${index + 1}: Total=${purchaseTotal}, Paid=${amountPaid}`);
                        
                    } else if (purchase.type === 'PURCHASE_RETURN') {
                        const returnValue = this.safeNumeric(purchase.totalReturnValue || purchase.total);
                        supplierReturns += returnValue;
                        totalPurchases -= returnValue;
                        
                        if (purchase.settlement?.type === 'REFUND') {
                            cashInflow += this.safeNumeric(purchase.settlement.amountRefunded);
                        }
                    }
                } catch (purchaseError) {
                    console.warn(`⚠️ Error processing purchase ${index}:`, purchaseError);
                }
            });
        }

        // Calculate customer balances
        let dueByCustomers = 0;
        let customerStoreCredit = 0;
        if (Array.isArray(customers)) {
            customers.forEach((customer, index) => {
                try {
                    const balance = this.safeNumeric(customer.balance);
                    if (balance > 0) {
                        dueByCustomers += balance;
                    } else if (balance < 0) {
                        customerStoreCredit += Math.abs(balance);
                    }
                } catch (customerError) {
                    console.warn(`⚠️ Error processing customer ${index}:`, customerError);
                }
            });
        }

        // Calculate supplier balances
        let payableToSuppliers = 0;
        let creditWithSuppliers = 0;
        if (Array.isArray(suppliers)) {
            suppliers.forEach((supplier, index) => {
                try {
                    const balance = this.safeNumeric(supplier.balance);
                    if (balance > 0) {
                        payableToSuppliers += balance;
                    } else if (balance < 0) {
                        creditWithSuppliers += Math.abs(balance);
                    }
                } catch (supplierError) {
                    console.warn(`⚠️ Error processing supplier ${index}:`, supplierError);
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

        console.log('🔢 Final calculated metrics:', calculatedMetrics);
        return calculatedMetrics;
    }

    // Rest of your methods remain the same...
    safeNumeric(value, defaultValue = 0) {
        if (typeof value === 'number') return isNaN(value) ? defaultValue : value;
        if (value === null || value === undefined) return defaultValue;
        const num = Number(value);
        return isNaN(num) ? defaultValue : num;
    }

    // Start, stop, performSync, and other methods remain unchanged...
    start() {
        if (this.isRunning) {
            console.log('⚠️ Dashboard sync already running');
            return;
        }

        this.isRunning = true;
        console.log(`🚀 Starting dashboard sync every ${this.SYNC_INTERVAL_DISPLAY}...`);
        
        // Initial sync
        this.performSync();
        
        // Schedule frequent syncs for testing
        this.syncInterval = setInterval(() => {
            this.performSync();
        }, this.SYNC_INTERVAL_MS);
        
        console.log(`✅ Dashboard sync started - syncing every ${this.SYNC_INTERVAL_DISPLAY}`);
    }

    stop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.isRunning = false;
        console.log('⏹️ Dashboard sync stopped');
    }

    async performSync() {
        try {
            console.log(`🔄 Starting dashboard sync (${this.SYNC_INTERVAL_DISPLAY} interval)...`);
            const startTime = Date.now();

            const summary = await this.generateCurrentSummary();
            
            if (!summary) {
                console.log('⚠️ No summary generated - skipping sync');
                return { success: true, skipped: true };
            }

            await this.ensureDatabaseExists();
            const uploadResult = await this.uploadSummary(summary);
            await this.cleanupOldSummaries();

            this.lastSyncTime = new Date().toISOString();
            const duration = Date.now() - startTime;
            
            console.log(`✅ Dashboard sync completed in ${duration}ms`);
            console.log(`📊 Synced summary: ${summary._id}`);
            
            if (this.syncErrors.length > 0) {
                this.syncErrors = [];
            }

            return { 
                success: true, 
                summaryId: summary._id,
                duration,
                lastSyncTime: this.lastSyncTime 
            };

        } catch (error) {
            console.error('❌ Dashboard sync failed:', error.message);
            
            this.syncErrors.push({
                error: error.message,
                timestamp: new Date().toISOString(),
                stack: error.stack
            });
            
            if (this.syncErrors.length > 10) {
                this.syncErrors = this.syncErrors.slice(-10);
            }

            return { success: false, error: error.message };
        }
    }

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
                    return axios.delete(deleteUrl, this.dbAuth);
                });

                await Promise.all(deletePromises);
                console.log(`🗑️ Deleted batch of ${batch.length} old summaries`);
            }

            console.log(`✅ Cleanup completed - deleted ${docsToDelete.length} old summaries`);

        } catch (error) {
            console.error('❌ Error during cleanup:', error.message);
        }
    }

    async triggerManualSync() {
        console.log('🔄 Manual sync triggered (testing mode)');
        return await this.performSync();
    }

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

    shutdown() {
        this.stop();
        console.log('✅ Dashboard sync service shutdown complete');
    }
}

module.exports = DashboardSyncService;
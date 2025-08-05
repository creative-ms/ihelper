// localDbManager.cjs - Enhanced Version for POS Software (Fixed for CommonJS)
const fs = require('fs');
const path = require('path');
const os = require('os');
const PouchDB = require('pouchdb');
const crypto = require('crypto');

class EnhancedLocalDatabaseManager {
    constructor(appName = 'YourPOSApp') {
        this.appName = appName;
        this.appDataPath = this.getAppDataPath();
        this.databasesPath = path.join(this.appDataPath, 'databases');
        this.backupsPath = path.join(this.appDataPath, 'backups');
        
        this.currentStoreId = null;
        this.databases = new Map();
        
        this.initializeAppStructure();
    }

    // Get platform-specific app data path
    getAppDataPath() {
        const platform = os.platform();
        let appDataPath;

        switch (platform) {
            case 'win32':
                // Windows: %APPDATA%/YourPOSApp
                appDataPath = path.join(os.homedir(), 'AppData', 'Roaming', this.appName);
                break;
            case 'darwin':
                // macOS: ~/Library/Application Support/YourPOSApp
                appDataPath = path.join(os.homedir(), 'Library', 'Application Support', this.appName);
                break;
            case 'linux':
                // Linux: ~/.config/YourPOSApp
                appDataPath = path.join(os.homedir(), '.config', this.appName);
                break;
            default:
                appDataPath = path.join(os.homedir(), `.${this.appName.toLowerCase()}`);
        }

        return appDataPath;
    }

    // Initialize complete app structure
    initializeAppStructure() {
        const folders = [
            this.appDataPath,
            this.databasesPath,
            this.backupsPath,
            path.join(this.appDataPath, 'logs'),
            path.join(this.appDataPath, 'exports'),
            path.join(this.appDataPath, 'temp')
        ];

        folders.forEach(folder => {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
                console.log(`✅ Created folder: ${folder}`);
            }
        });
    }

    // Initialize Store Databases (License verification handled by license-service.cjs)
    async initializeStore(storeData) {
        try {
            const { storeId, storeName } = storeData;
            
            this.currentStoreId = storeId;

            // Create store-specific folder structure
            const storePath = path.join(this.databasesPath, storeId);
            const storeDbPath = path.join(storePath, 'databases');
            const storeExportsPath = path.join(storePath, 'exports');
            const storeImagesPath = path.join(storePath, 'images');

            [storePath, storeDbPath, storeExportsPath, storeImagesPath].forEach(folder => {
                if (!fs.existsSync(folder)) {
                    fs.mkdirSync(folder, { recursive: true });
                }
            });

            // Initialize all store databases
            const dbNames = [
                'products',      // Products catalog
                'inventory',     // Stock levels
                'sales',        // Sales transactions
                'purchases',    // Purchase orders  
                'customers',    // Customer data
                'suppliers',    // Supplier data
                'categories',   // Product categories
                'brands',       // Brand data
                'generics',     // Generic medicines
                'transactions', // All transactions
                'users',        // Store users
                'settings',     // Store settings
                'audit'         // Audit logs
            ];

            // Close existing databases if switching stores
            if (this.databases.size > 0) {
                await this.closeAllDatabases();
            }

            // Initialize new databases
            for (const dbName of dbNames) {
                const dbPath = path.join(storeDbPath, `${dbName}.db`);
                const db = new PouchDB(dbPath);
                
                // Create appropriate indexes
                await this.createDatabaseIndexes(db, dbName);
                
                this.databases.set(dbName, db);
                console.log(`✅ Initialized ${dbName} database for store ${storeId}`);
            }

            // Save store configuration
            await this.saveStoreConfig(storeId, {
                storeName,
                createdAt: new Date().toISOString(),
                lastAccessed: new Date().toISOString(),
                dbVersion: '1.0',
                appVersion: process.env.npm_package_version || '1.0.0'
            });

            console.log(`✅ Store ${storeName} initialized successfully`);
            return { success: true, storeId };

        } catch (error) {
            console.error('❌ Error initializing store:', error);
            throw error;
        }
    }

    // Create database-specific indexes for better performance
    async createDatabaseIndexes(db, dbName) {
        try {
            switch (dbName) {
                case 'products':
                    await db.createIndex({ index: { fields: ['name', 'sku', 'barcode', 'category'] }});
                    await db.createIndex({ index: { fields: ['createdAt'] }});
                    break;
                
                case 'sales':
                    await db.createIndex({ index: { fields: ['createdAt', 'customerId'] }});
                    await db.createIndex({ index: { fields: ['total', 'paymentMethod'] }});
                    break;
                
                case 'inventory':
                    await db.createIndex({ index: { fields: ['productId', 'quantity'] }});
                    await db.createIndex({ index: { fields: ['expiryDate'] }});
                    break;
                
                case 'customers':
                    await db.createIndex({ index: { fields: ['name', 'phone', 'email'] }});
                    break;
                
                case 'purchases':
                    await db.createIndex({ index: { fields: ['createdAt', 'supplierId'] }});
                    break;
                
                case 'transactions':
                    await db.createIndex({ index: { fields: ['customerId', 'supplierId', 'type', 'date'] }});
                    break;
                
                case 'audit':
                    await db.createIndex({ index: { fields: ['eventType', 'createdAt'] }});
                    break;
            }
        } catch (error) {
            console.log(`Index creation for ${dbName}:`, error.message);
        }
    }

    // Get database instance
    getDatabase(dbName) {
        if (!this.currentStoreId) {
            throw new Error('No store selected. Please initialize store first.');
        }

        const db = this.databases.get(dbName);
        if (!db) {
            throw new Error(`Database ${dbName} not found for current store`);
        }

        return db;
    }

    // Save store configuration
    async saveStoreConfig(storeId, config) {
        const configPath = path.join(this.databasesPath, storeId, 'store-config.json');
        
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error('❌ Error saving store config:', error);
            throw error;
        }
    }

    // Load store configuration
    loadStoreConfig(storeId) {
        const configPath = path.join(this.databasesPath, storeId, 'store-config.json');
        
        try {
            if (fs.existsSync(configPath)) {
                return JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
            return null;
        } catch (error) {
            console.error('❌ Error loading store config:', error);
            return null;
        }
    }

    // Create backup
    async createBackup(storeId = this.currentStoreId, includeImages = true) {
        try {
            if (!storeId) throw new Error('No store ID provided');

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const backupName = `${storeId}_backup_${timestamp}`;
            const sourcePath = path.join(this.databasesPath, storeId);
            const backupPath = path.join(this.backupsPath, backupName);

            await this.copyDirectory(sourcePath, backupPath, includeImages);

            const backupInfo = {
                storeId,
                backupPath,
                createdAt: new Date().toISOString(),
                size: this.getFolderSize(backupPath)
            };

            // Save backup info
            const backupInfoPath = path.join(backupPath, 'backup-info.json');
            fs.writeFileSync(backupInfoPath, JSON.stringify(backupInfo, null, 2));

            console.log(`✅ Backup created: ${backupPath}`);
            return backupInfo;

        } catch (error) {
            console.error('❌ Error creating backup:', error);
            throw error;
        }
    }

    // Helper functions
    async copyDirectory(src, dest, includeImages = true) {
        await fs.promises.mkdir(dest, { recursive: true });
        const files = await fs.promises.readdir(src);

        for (const file of files) {
            const srcPath = path.join(src, file);
            const destPath = path.join(dest, file);
            const stat = await fs.promises.stat(srcPath);

            if (stat.isDirectory()) {
                // Skip images folder if not including images
                if (!includeImages && file === 'images') continue;
                await this.copyDirectory(srcPath, destPath, includeImages);
            } else {
                await fs.promises.copyFile(srcPath, destPath);
            }
        }
    }

    getFolderSize(folderPath) {
        let totalSize = 0;
        const files = fs.readdirSync(folderPath);

        files.forEach(file => {
            const filePath = path.join(folderPath, file);
            const stats = fs.statSync(filePath);
            
            if (stats.isFile()) {
                totalSize += stats.size;
            } else if (stats.isDirectory()) {
                totalSize += this.getFolderSize(filePath);
            }
        });

        return totalSize;
    }

    getDeviceId() {
        // Create unique device ID based on system info
        const networkInterfaces = os.networkInterfaces();
        const macAddresses = [];
        
        for (const name of Object.keys(networkInterfaces)) {
            for (const netInterface of networkInterfaces[name]) {
                if (!netInterface.internal) {
                    macAddresses.push(netInterface.mac);
                }
            }
        }
        
        const deviceInfo = `${os.hostname()}-${os.platform()}-${macAddresses.join(',')}`;
        return crypto.createHash('sha256').update(deviceInfo).digest('hex').substring(0, 16);
    }

    // Close all databases
    async closeAllDatabases() {
        try {
            for (const [name, db] of this.databases.entries()) {
                await db.close();
                console.log(`✅ Closed ${name} database`);
            }
            this.databases.clear();
        } catch (error) {
            console.error('❌ Error closing databases:', error);
        }
    }

    // Cleanup and shutdown
    async shutdown() {
        try {
            await this.closeAllDatabases();
            console.log('✅ Database manager shut down successfully');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }

    // Get app statistics
    getAppStats() {
        const stores = this.getAllStores();
        
        return {
            appName: this.appName,
            appDataPath: this.appDataPath,
            currentStoreId: this.currentStoreId,
            totalStores: stores.length,
            activeDatabases: this.databases.size,
            diskUsage: this.getFolderSize(this.appDataPath),
            stores: stores.map(store => ({
                storeId: store.storeId,
                storeName: store.storeName,
                lastAccessed: store.lastAccessed
            }))
        };
    }
}

module.exports = EnhancedLocalDatabaseManager;
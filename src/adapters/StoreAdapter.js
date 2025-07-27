// src/adapters/StoreAdapter.js
// ===================================================================
//  🏗️ UNIFIED STORE ADAPTER FOR IHELPER APPLICATION
//  Features: Store Management + Event Integration + Performance Monitoring
// ===================================================================

import { 
  createPharmacyEventBus, 
  getGlobalEventBus,
  PHARMACY_EVENTS,
  PharmacyTransactionManager,
  setupPharmacyMiddlewares
} from '../utils/eventBus/index.js';

// Import all stores
import { useAuthStore } from '../stores/authStore.js';
import { useProductStore } from '../stores/productStore.js';
import { useInventoryStore } from '../stores/inventoryStore.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import { useCartStore } from '../stores/cartStore.js';
import { useSalesStore } from '../stores/salesStore.js';
import { usePurchaseStore } from '../stores/purchaseStore.js';
import { useCustomerStore } from '../stores/customerStore.js';
import { useSupplierStore } from '../stores/supplierStore.js';
import { useCategoryStore } from '../stores/categoryStore.js';
import { useBrandStore } from '../stores/brandStore.js';
import { useGenericStore } from '../stores/genericStore.js';
import { useAuditStore } from '../stores/auditStore.js';
import { useTransactionStore } from '../stores/transactionStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useThemeStore } from '../stores/themeStore.js';

// Performance monitoring
class StorePerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.operationCount = 0;
    this.errorCount = 0;
  }

  startOperation(operationName) {
    const operationId = `${operationName}-${Date.now()}-${Math.random()}`;
    this.metrics.set(operationId, {
      name: operationName,
      startTime: performance.now(),
      status: 'running'
    });
    this.operationCount++;
    return operationId;
  }

  endOperation(operationId, success = true, error = null) {
    const metric = this.metrics.get(operationId);
    if (metric) {
      const duration = performance.now() - metric.startTime;
      metric.endTime = performance.now();
      metric.duration = duration;
      metric.status = success ? 'completed' : 'failed';
      metric.error = error;
      
      if (!success) this.errorCount++;
      
      console.log(`📊 ${metric.name}: ${duration.toFixed(2)}ms ${success ? '✅' : '❌'}`);
    }
  }

  getMetrics() {
    return {
      totalOperations: this.operationCount,
      totalErrors: this.errorCount,
      errorRate: this.operationCount > 0 ? (this.errorCount / this.operationCount) * 100 : 0,
      activeOperations: Array.from(this.metrics.values()).filter(m => m.status === 'running').length,
      recentOperations: Array.from(this.metrics.values())
        .sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime))
        .slice(0, 10)
    };
  }

  clearMetrics() {
    this.metrics.clear();
    this.operationCount = 0;
    this.errorCount = 0;
  }
}

// Store Adapter Configuration
const ADAPTER_CONFIG = {
  AUTO_SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutes
  BATCH_SIZE: 50,
  RETRY_ATTEMPTS: 3,
  TIMEOUT: 10000,
  DEBOUNCE_DELAY: 300,
  CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
  EVENT_BUFFER_SIZE: 100,
  PERFORMANCE_TRACKING: true
};

// ===================================================================
//  🎯 MAIN STORE ADAPTER CLASS
// ===================================================================

export class StoreAdapter {
  constructor(config = {}) {
    this.config = { ...ADAPTER_CONFIG, ...config };
    this.eventBus = null;
    this.transactionManager = null;
    this.performanceMonitor = new StorePerformanceMonitor();
    
    // Store registry
    this.stores = new Map();
    this.storeSubscriptions = new Map();
    this.storeStates = new Map();
    
    // Adapter state
    this.isInitialized = false;
    this.isDestroyed = false;
    this.syncInterval = null;
    this.eventBuffer = [];
    this.operationQueue = [];
    
    // Bind methods
    this.init = this.init.bind(this);
    this.destroy = this.destroy.bind(this);
    this.syncStores = this.syncStores.bind(this);
    
    console.log('🏗️ Store Adapter created with config:', this.config);
  }

  // ===================================================================
  //  🚀 INITIALIZATION & SETUP
  // ===================================================================

  async init() {
    if (this.isInitialized) {
      console.warn('Store Adapter already initialized');
      return this;
    }

    const operationId = this.performanceMonitor.startOperation('adapter-init');
    
    try {
      console.log('🚀 Initializing Store Adapter...');
      
      // Initialize event bus
      await this.initializeEventBus();
      
      // Register all stores
      await this.registerAllStores();
      
      // Setup store synchronization
      await this.setupStoreSynchronization();
      
      // Setup middleware
      await this.setupMiddleware();
      
      // Start auto-sync if enabled
      if (this.config.AUTO_SYNC_INTERVAL > 0) {
        this.startAutoSync();
      }
      
      this.isInitialized = true;
      console.log('✅ Store Adapter initialized successfully');
      
      // Emit initialization event
      await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.ADAPTER_INITIALIZED, {
        timestamp: Date.now(),
        storeCount: this.stores.size,
        config: this.config
      });
      
      this.performanceMonitor.endOperation(operationId, true);
      return this;
      
    } catch (error) {
      console.error('❌ Store Adapter initialization failed:', error);
      this.performanceMonitor.endOperation(operationId, false, error);
      throw error;
    }
  }

  async initializeEventBus() {
    try {
      // Try to get existing global event bus or create new one
      this.eventBus = getGlobalEventBus() || createPharmacyEventBus();
      
      // Initialize transaction manager
      this.transactionManager = new PharmacyTransactionManager(this.eventBus);
      
      console.log('📡 Event bus initialized');
    } catch (error) {
      console.error('❌ Event bus initialization failed:', error);
      throw error;
    }
  }

  async registerAllStores() {
    const storeDefinitions = [
      { name: 'auth', store: useAuthStore, priority: 1 },
      { name: 'settings', store: useSettingsStore, priority: 1 },
      { name: 'theme', store: useThemeStore, priority: 1 },
      { name: 'product', store: useProductStore, priority: 2 },
      { name: 'inventory', store: useInventoryStore, priority: 2 },
      { name: 'category', store: useCategoryStore, priority: 2 },
      { name: 'brand', store: useBrandStore, priority: 2 },
      { name: 'generic', store: useGenericStore, priority: 2 },
      { name: 'customer', store: useCustomerStore, priority: 3 },
      { name: 'supplier', store: useSupplierStore, priority: 3 },
      { name: 'cart', store: useCartStore, priority: 4 },
      { name: 'sales', store: useSalesStore, priority: 4 },
      { name: 'purchase', store: usePurchaseStore, priority: 4 },
      { name: 'transaction', store: useTransactionStore, priority: 4 },
      { name: 'dashboard', store: useDashboardStore, priority: 5 },
      { name: 'audit', store: useAuditStore, priority: 6 }
    ];

    // Sort by priority for initialization order
    storeDefinitions.sort((a, b) => a.priority - b.priority);

    for (const { name, store, priority } of storeDefinitions) {
      await this.registerStore(name, store, { priority });
    }

    console.log(`📦 Registered ${this.stores.size} stores`);
  }

  async registerStore(name, storeHook, options = {}) {
    const operationId = this.performanceMonitor.startOperation(`register-store-${name}`);
    
    try {
      if (this.stores.has(name)) {
        console.warn(`Store "${name}" already registered`);
        return;
      }

      const storeInstance = {
        name,
        hook: storeHook,
        options,
        state: null,
        lastSync: null,
        isActive: true,
        subscriptions: new Set(),
        eventListeners: new Map()
      };

      this.stores.set(name, storeInstance);
      
      // Get initial state
      try {
        storeInstance.state = storeHook.getState();
        this.storeStates.set(name, { ...storeInstance.state });
      } catch (error) {
        console.warn(`Failed to get initial state for store "${name}":`, error);
      }

      // Setup store subscription for state changes
      const unsubscribe = storeHook.subscribe((state) => {
        this.handleStoreStateChange(name, state);
      });
      
      this.storeSubscriptions.set(name, unsubscribe);

      // Register store-specific event listeners
      await this.setupStoreEventListeners(name, storeInstance);

      console.log(`✅ Store "${name}" registered successfully`);
      this.performanceMonitor.endOperation(operationId, true);
      
    } catch (error) {
      console.error(`❌ Failed to register store "${name}":`, error);
      this.performanceMonitor.endOperation(operationId, false, error);
      throw error;
    }
  }

  async setupStoreEventListeners(storeName, storeInstance) {
    const eventMappings = {
      product: [
        PHARMACY_EVENTS.PRODUCT.CREATED,
        PHARMACY_EVENTS.PRODUCT.UPDATED,
        PHARMACY_EVENTS.PRODUCT.DELETED,
        PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED
      ],
      inventory: [
        PHARMACY_EVENTS.INVENTORY.BATCH_CREATED,
        PHARMACY_EVENTS.INVENTORY.BATCH_UPDATED,
        PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED,
        PHARMACY_EVENTS.INVENTORY.LOW_STOCK_ALERT
      ],
      cart: [
        PHARMACY_EVENTS.SALES.ITEM_ADDED,
        PHARMACY_EVENTS.SALES.ITEM_REMOVED,
        PHARMACY_EVENTS.SALES.CART_CLEARED
      ],
      sales: [
        PHARMACY_EVENTS.SALES.TRANSACTION_COMPLETED,
        PHARMACY_EVENTS.SALES.PAYMENT_PROCESSED,
        PHARMACY_EVENTS.SALES.RECEIPT_GENERATED
      ],
      dashboard: [
        PHARMACY_EVENTS.SALES.TRANSACTION_COMPLETED,
        PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED,
        PHARMACY_EVENTS.PRODUCT.CREATED
      ]
    };

    const storeEvents = eventMappings[storeName] || [];
    
    for (const eventName of storeEvents) {
      const listener = (payload) => this.handleStoreEvent(storeName, eventName, payload);
      const unsubscribe = this.eventBus.on(eventName, listener);
      storeInstance.eventListeners.set(eventName, unsubscribe);
    }
  }

  // ===================================================================
  //  🔄 STORE SYNCHRONIZATION
  // ===================================================================

  async setupStoreSynchronization() {
    // Setup cross-store dependencies
    const dependencies = {
      inventory: ['product'],
      cart: ['product', 'inventory'],
      sales: ['cart', 'product', 'inventory', 'customer'],
      dashboard: ['sales', 'product', 'inventory', 'purchase'],
      audit: ['*'] // Audit listens to all stores
    };

    for (const [storeName, deps] of Object.entries(dependencies)) {
      if (this.stores.has(storeName)) {
        this.stores.get(storeName).dependencies = deps;
      }
    }

    console.log('🔄 Store synchronization setup completed');
  }

  async syncStores(storeNames = null) {
    const operationId = this.performanceMonitor.startOperation('sync-stores');
    
    try {
      const storesToSync = storeNames 
        ? storeNames.filter(name => this.stores.has(name))
        : Array.from(this.stores.keys());

      console.log(`🔄 Syncing ${storesToSync.length} stores...`);

      const syncResults = [];
      
      for (const storeName of storesToSync) {
        try {
          const result = await this.syncSingleStore(storeName);
          syncResults.push({ store: storeName, success: true, result });
        } catch (error) {
          console.error(`❌ Failed to sync store "${storeName}":`, error);
          syncResults.push({ store: storeName, success: false, error: error.message });
        }
      }

      // Emit sync completion event
      await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.STORES_SYNCED, {
        timestamp: Date.now(),
        results: syncResults,
        successful: syncResults.filter(r => r.success).length,
        failed: syncResults.filter(r => !r.success).length
      });

      this.performanceMonitor.endOperation(operationId, true);
      return syncResults;
      
    } catch (error) {
      console.error('❌ Store sync failed:', error);
      this.performanceMonitor.endOperation(operationId, false, error);
      throw error;
    }
  }

  async syncSingleStore(storeName) {
    const store = this.stores.get(storeName);
    if (!store || !store.isActive) {
      throw new Error(`Store "${storeName}" not found or inactive`);
    }

    const currentState = store.hook.getState();
    const lastState = this.storeStates.get(storeName);

    // Check if store has sync methods
    const syncMethods = [
      'syncCacheWithDatabase',
      'fetchFromRemote',
      'refreshData',
      'forceSync'
    ];

    for (const method of syncMethods) {
      if (typeof currentState[method] === 'function') {
        await currentState[method]();
        store.lastSync = Date.now();
        this.storeStates.set(storeName, { ...currentState });
        return { method, timestamp: store.lastSync };
      }
    }

    // If no sync method found, just update the cached state
    this.storeStates.set(storeName, { ...currentState });
    store.lastSync = Date.now();
    
    return { method: 'state-update', timestamp: store.lastSync };
  }

  // ===================================================================
  //  📡 EVENT HANDLING
  // ===================================================================

  handleStoreStateChange(storeName, newState) {
    if (this.isDestroyed) return;

    const store = this.stores.get(storeName);
    if (!store) return;

    const oldState = this.storeStates.get(storeName);
    this.storeStates.set(storeName, { ...newState });

    // Emit state change event
    this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.STORE_STATE_CHANGED, {
      storeName,
      oldState,
      newState,
      timestamp: Date.now()
    }).catch(console.error);

    // Handle cross-store synchronization
    this.handleCrossStoreSync(storeName, newState, oldState);
  }

  async handleStoreEvent(storeName, eventName, payload) {
    if (this.isDestroyed) return;

    console.log(`📡 Store "${storeName}" received event "${eventName}"`);

    const store = this.stores.get(storeName);
    if (!store || !store.isActive) return;

    try {
      // Add to event buffer for analysis
      this.eventBuffer.push({
        storeName,
        eventName,
        payload,
        timestamp: Date.now()
      });

      // Keep buffer size manageable
      if (this.eventBuffer.length > this.config.EVENT_BUFFER_SIZE) {
        this.eventBuffer.splice(0, this.eventBuffer.length - this.config.EVENT_BUFFER_SIZE);
      }

      // Handle specific event types
      switch (eventName) {
        case PHARMACY_EVENTS.PRODUCT.CREATED:
        case PHARMACY_EVENTS.PRODUCT.UPDATED:
          await this.handleProductEvent(payload);
          break;
          
        case PHARMACY_EVENTS.SALES.TRANSACTION_COMPLETED:
          await this.handleSalesEvent(payload);
          break;
          
        case PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED:
          await this.handleInventoryEvent(payload);
          break;
      }

    } catch (error) {
      console.error(`❌ Error handling event "${eventName}" for store "${storeName}":`, error);
    }
  }

  async handleProductEvent(payload) {
    try {
      // Update related stores
      const productStore = this.stores.get('product');
      const inventoryStore = this.stores.get('inventory');
      const dashboardStore = this.stores.get('dashboard');

      if (productStore?.isActive) {
        await this.syncSingleStore('product');
      }

      if (inventoryStore?.isActive) {
        await this.syncSingleStore('inventory');
      }

      if (dashboardStore?.isActive) {
        // Refresh dashboard data when product changes
        const dashboardState = dashboardStore.hook.getState();
        if (typeof dashboardState.refreshData === 'function') {
          await dashboardState.refreshData();
        }
      }

    } catch (error) {
      console.error('Error handling product event:', error);
    }
  }

  async handleSalesEvent(payload) {
    try {
      const { transactionId, items, total, customer } = payload;

      // Update multiple stores in sequence
      const storesToUpdate = ['sales', 'inventory', 'dashboard', 'audit'];
      
      for (const storeName of storesToUpdate) {
        const store = this.stores.get(storeName);
        if (store?.isActive) {
          await this.syncSingleStore(storeName);
        }
      }

      // Emit follow-up events
      await this.eventBus.emit(PHARMACY_EVENTS.DASHBOARD.DATA_REFRESH_NEEDED, {
        reason: 'sales_transaction',
        transactionId,
        total
      });

      if (customer) {
        await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.TRANSACTION_RECORDED, {
          customerId: customer._id,
          transactionId,
          amount: total
        });
      }

    } catch (error) {
      console.error('Error handling sales event:', error);
    }
  }

  async handleInventoryEvent(payload) {
    try {
      const { productId, newStock, alertLevel } = payload;

      // Update inventory and product stores
      await Promise.all([
        this.syncSingleStore('inventory'),
        this.syncSingleStore('product')
      ]);

      // Check for low stock alerts
      if (newStock <= alertLevel) {
        await this.eventBus.emit(PHARMACY_EVENTS.ALERTS.LOW_STOCK_DETECTED, {
          productId,
          currentStock: newStock,
          alertLevel,
          timestamp: Date.now()
        });
      }

      // Update dashboard
      await this.syncSingleStore('dashboard');

    } catch (error) {
      console.error('Error handling inventory event:', error);
    }
  }

  handleCrossStoreSync(storeName, newState, oldState) {
    if (this.isDestroyed) return;

    const store = this.stores.get(storeName);
    if (!store?.dependencies) return;

    // Handle wildcard dependency (audit listens to all)
    if (store.dependencies.includes('*')) {
      this.handleAuditSync(storeName, newState, oldState);
      return;
    }

    // Handle specific dependencies
    for (const depStoreName of store.dependencies) {
      if (this.stores.has(depStoreName)) {
        this.triggerDependentStoreUpdate(depStoreName, storeName, newState);
      }
    }
  }

  handleAuditSync(sourceStoreName, newState, oldState) {
    // Audit store tracks all changes
    const auditStore = this.stores.get('audit');
    if (!auditStore?.isActive) return;

    try {
      const auditState = auditStore.hook.getState();
      if (typeof auditState.logStoreChange === 'function') {
        auditState.logStoreChange({
          sourceStore: sourceStoreName,
          changes: this.detectStateChanges(oldState, newState),
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error(`Error logging audit for store "${sourceStoreName}":`, error);
    }
  }

  triggerDependentStoreUpdate(targetStoreName, sourceStoreName, sourceState) {
    const targetStore = this.stores.get(targetStoreName);
    if (!targetStore?.isActive) return;

    try {
      const targetState = targetStore.hook.getState();
      
      // Look for update methods in target store
      const updateMethods = [
        'handleStoreUpdate',
        'onDependencyChange',
        'syncWithDependency',
        'refreshFromDependency'
      ];

      for (const method of updateMethods) {
        if (typeof targetState[method] === 'function') {
          targetState[method](sourceStoreName, sourceState);
          break;
        }
      }

    } catch (error) {
      console.error(`Error updating dependent store "${targetStoreName}":`, error);
    }
  }

  detectStateChanges(oldState, newState) {
    const changes = {};
    
    if (!oldState || !newState) return changes;

    // Compare top-level properties
    for (const key in newState) {
      if (oldState[key] !== newState[key]) {
        changes[key] = {
          old: oldState[key],
          new: newState[key]
        };
      }
    }

    return changes;
  }

  // ===================================================================
  //  🔧 AUTO-SYNC & MIDDLEWARE
  // ===================================================================

  startAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      try {
        console.log('🔄 Auto-sync triggered');
        await this.syncStores();
      } catch (error) {
        console.error('❌ Auto-sync failed:', error);
      }
    }, this.config.AUTO_SYNC_INTERVAL);

    console.log(`⏰ Auto-sync started (${this.config.AUTO_SYNC_INTERVAL}ms interval)`);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('⏰ Auto-sync stopped');
    }
  }

  async setupMiddleware() {
    try {
      if (this.eventBus && typeof setupPharmacyMiddlewares === 'function') {
        await setupPharmacyMiddlewares(this.eventBus);
        console.log('🔧 Middleware setup completed');
      }
    } catch (error) {
      console.error('❌ Middleware setup failed:', error);
    }
  }

  // ===================================================================
  //  📊 MONITORING & ANALYTICS
  // ===================================================================

  getAdapterMetrics() {
    const metrics = this.performanceMonitor.getMetrics();
    
    return {
      ...metrics,
      stores: {
        total: this.stores.size,
        active: Array.from(this.stores.values()).filter(s => s.isActive).length,
        lastSyncTimes: Object.fromEntries(
          Array.from(this.stores.entries()).map(([name, store]) => [
            name, 
            store.lastSync || 'never'
          ])
        )
      },
      eventBus: this.eventBus ? this.eventBus.getMetrics() : null,
      config: this.config,
      uptime: this.isInitialized ? Date.now() : 0
    };
  }

  getStoreHealth() {
    const health = {
      overall: 'healthy',
      stores: {},
      issues: []
    };

    for (const [name, store] of this.stores.entries()) {
      const storeHealth = {
        active: store.isActive,
        lastSync: store.lastSync,
        hasSubscription: this.storeSubscriptions.has(name),
        eventListeners: store.eventListeners.size,
        dependencies: store.dependencies?.length || 0
      };

      // Check for issues
      if (!store.isActive) {
        health.issues.push(`Store "${name}" is inactive`);
        storeHealth.status = 'inactive';
      } else if (!store.lastSync) {
        health.issues.push(`Store "${name}" has never synced`);
        storeHealth.status = 'warning';
      } else if (Date.now() - store.lastSync > this.config.AUTO_SYNC_INTERVAL * 2) {
        health.issues.push(`Store "${name}" sync is overdue`);
        storeHealth.status = 'warning';
      } else {
        storeHealth.status = 'healthy';
      }

      health.stores[name] = storeHealth;
    }

    // Determine overall health
    if (health.issues.length > 0) {
      const criticalIssues = health.issues.filter(issue => 
        issue.includes('inactive') || issue.includes('failed')
      );
      health.overall = criticalIssues.length > 0 ? 'critical' : 'warning';
    }

    return health;
  }

  // ===================================================================
  //  🔍 DEBUGGING & UTILITIES
  // ===================================================================

  debugStore(storeName) {
    const store = this.stores.get(storeName);
    if (!store) {
      console.error(`Store "${storeName}" not found`);
      return null;
    }

    const debugInfo = {
      name: storeName,
      active: store.isActive,
      lastSync: store.lastSync,
      state: store.state,
      subscriptions: store.subscriptions.size,
      eventListeners: Array.from(store.eventListeners.keys()),
      dependencies: store.dependencies || []
    };

    console.log(`🔍 Debug info for "${storeName}":`, debugInfo);
    return debugInfo;
  }

  async forceSync(storeNames = null) {
    const operationId = this.performanceMonitor.startOperation('force-sync');
    
    try {
      console.log('🔄 Force sync initiated');
      const results = await this.syncStores(storeNames);
      
      // Clear performance metrics to reset counters
      this.performanceMonitor.clearMetrics();
      
      this.performanceMonitor.endOperation(operationId, true);
      return results;
      
    } catch (error) {
      console.error('❌ Force sync failed:', error);
      this.performanceMonitor.endOperation(operationId, false, error);
      throw error;
    }
  }

  async resetStore(storeName) {
    const store = this.stores.get(storeName);
    if (!store) {
      throw new Error(`Store "${storeName}" not found`);
    }

    try {
      const storeState = store.hook.getState();
      
      // Look for reset methods
      const resetMethods = ['reset', 'clear', 'initialize', 'resetToInitialState'];
      
      for (const method of resetMethods) {
        if (typeof storeState[method] === 'function') {
          await storeState[method]();
          console.log(`✅ Store "${storeName}" reset using ${method}()`);
          break;
        }
      }

      // Force sync after reset
      await this.syncSingleStore(storeName);
      
    } catch (error) {
      console.error(`❌ Failed to reset store "${storeName}":`, error);
      throw error;
    }
  }

  // ===================================================================
  //  🧹 CLEANUP & DESTRUCTION
  // ===================================================================

  async destroy() {
    if (this.isDestroyed) {
      console.warn('Store Adapter already destroyed');
      return;
    }

    console.log('🧹 Destroying Store Adapter...');
    
    try {
      // Stop auto-sync
      this.stopAutoSync();

      // Clear operation queue
      this.operationQueue.length = 0;

      // Cleanup store subscriptions
      for (const [storeName, unsubscribe] of this.storeSubscriptions.entries()) {
        try {
          unsubscribe();
        } catch (error) {
          console.error(`Error unsubscribing from store "${storeName}":`, error);
        }
      }
      this.storeSubscriptions.clear();

      // Cleanup store event listeners
      for (const store of this.stores.values()) {
        for (const unsubscribe of store.eventListeners.values()) {
          try {
            unsubscribe();
          } catch (error) {
            console.error('Error removing event listener:', error);
          }
        }
        store.eventListeners.clear();
      }

      // Clear stores
      this.stores.clear();
      this.storeStates.clear();

      // Cleanup event buffer
      this.eventBuffer.length = 0;

      // Destroy event bus if we created it
      if (this.eventBus && typeof this.eventBus.destroy === 'function') {
        await this.eventBus.destroy();
      }

      // Clear transaction manager
      this.transactionManager = null;

      this.isDestroyed = true;
      console.log('✅ Store Adapter destroyed successfully');

    } catch (error) {
      console.error('❌ Error during Store Adapter destruction:', error);
      this.isDestroyed = true;
    }
  }

  // ===================================================================
  //  🚀 STATIC FACTORY METHODS
  // ===================================================================

  static async create(config = {}) {
    const adapter = new StoreAdapter(config);
    await adapter.init();
    return adapter;
  }

  static getDefaultConfig() {
    return { ...ADAPTER_CONFIG };
  }
}

// ===================================================================
//  🎯 CONVENIENCE FUNCTIONS
// ===================================================================

let globalAdapter = null;

export const createStoreAdapter = async (config = {}) => {
  if (globalAdapter) {
    console.warn('Global store adapter already exists');
    return globalAdapter;
  }

  globalAdapter = await StoreAdapter.create(config);
  return globalAdapter;
};

export const getStoreAdapter = () => {
  return globalAdapter;
};

export const destroyStoreAdapter = async () => {
  if (globalAdapter) {
    await globalAdapter.destroy();
    globalAdapter = null;
  }
};

// ===================================================================
//  📊 PERFORMANCE UTILITIES
// ===================================================================

export const createStoreMetricsCollector = (adapter) => {
  return {
    collect: () => adapter.getAdapterMetrics(),
    health: () => adapter.getStoreHealth(),
    performance: () => adapter.performanceMonitor.getMetrics(),
    
    startMonitoring: (interval = 30000) => {
      return setInterval(() => {
        const metrics = adapter.getAdapterMetrics();
        console.log('📊 Store Adapter Metrics:', metrics);
      }, interval);
    }
  };
};

// Export default
export default StoreAdapter;
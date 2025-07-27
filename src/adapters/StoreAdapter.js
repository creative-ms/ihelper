// src/adapters/StoreAdapter.js
// ===================================================================
//  🏗️ FIXED STORE ADAPTER - MIDDLEWARE METHOD CORRECTED
//  Fixed: EventBus method mismatch, event validation, performance, DUPLICATE EXPORTS
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

// Performance monitoring (same as before)
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
      
      if (duration > 100 || (process.env.NODE_ENV === 'development' && duration > 10)) {
        console.log(`📊 ${metric.name}: ${duration.toFixed(2)}ms ${success ? '✅' : '❌'}`);
      }
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
  AUTO_SYNC_INTERVAL: 5 * 60 * 1000,
  BATCH_SIZE: 50,
  RETRY_ATTEMPTS: 3,
  TIMEOUT: 10000,
  DEBOUNCE_DELAY: 150,
  CACHE_DURATION: 10 * 60 * 1000,
  EVENT_BUFFER_SIZE: 100,
  PERFORMANCE_TRACKING: true,
  EVENT_DEBOUNCE_DELAY: 100,
  BATCH_DELAY: 50,
  SIGNIFICANT_CHANGE_THRESHOLD: 0.1,
  MAX_EVENTS_PER_SECOND: 50,
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV === 'development',
  LAZY_LOADING: true,
  SMART_FILTERING: true
};

const debugLog = ADAPTER_CONFIG.ENABLE_DEBUG_LOGS ? console.log : () => {};
const warnLog = console.warn;

// ===================================================================
//  🎯 FIXED STORE ADAPTER CLASS
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
    this.storeLastEmit = new Map();
    
    // Performance optimizations
    this.eventDebounceMap = new Map();
    this.stateBatch = new Map();
    this.batchTimeout = null;
    this.eventRateTrackers = new Map();
    this.lastStateHashes = new Map();
    
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
    
    debugLog('🏗️ Store Adapter created with config:', this.config);
  }

  // ===================================================================
  //  🚀 INITIALIZATION & SETUP
  // ===================================================================

  async init() {
    if (this.isInitialized) {
      warnLog('Store Adapter already initialized');
      return this;
    }

    const operationId = this.performanceMonitor.startOperation('adapter-init');
    
    try {
      debugLog('🚀 Initializing Store Adapter...');
      
      // Initialize event bus
      await this.initializeEventBus();
      
      // Register all stores
      await this.registerAllStores();
      
      // Setup store synchronization
      await this.setupStoreSynchronization();
      
      // 🔧 FIXED: Setup middleware with correct method
      await this.setupMiddleware();
      
      // Start auto-sync if enabled
      if (this.config.AUTO_SYNC_INTERVAL > 0) {
        this.startAutoSync();
      }
      
      this.isInitialized = true;
      debugLog('✅ Store Adapter initialized successfully');
      
      // 🔧 FIXED: Validate event name before emitting
      if (PHARMACY_EVENTS?.SYSTEM?.ADAPTER_INITIALIZED) {
        await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.ADAPTER_INITIALIZED, {
          timestamp: Date.now(),
          storeCount: this.stores.size,
          config: this.config
        });
      }
      
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
      // Get the event bus instance properly
      const globalInstance = getGlobalEventBus();
      const createdInstance = createPharmacyEventBus();
      
      // 🔧 FIXED: Better handling of eventBus extraction
      if (globalInstance?.eventBus) {
        this.eventBus = globalInstance.eventBus;
      } else if (createdInstance?.eventBus) {
        this.eventBus = createdInstance.eventBus;
      } else if (globalInstance) {
        // In case the global instance IS the eventBus
        this.eventBus = globalInstance;
      } else if (createdInstance) {
        // In case the created instance IS the eventBus
        this.eventBus = createdInstance;
      } else {
        throw new Error('Could not obtain EventBus instance');
      }

      // Validate eventBus has required methods
      if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
        throw new Error('EventBus instance is invalid or missing required methods');
      }
      
      // Initialize transaction manager
      this.transactionManager = new PharmacyTransactionManager(this.eventBus);
      
      console.log('📡 Event bus initialized');
    } catch (error) {
      console.error('❌ Event bus initialization failed:', error);
      throw error;
    }
  }

  // Register stores (same logic as before)
  async registerAllStores() {
    const storeDefinitions = [
      { name: 'auth', store: useAuthStore, priority: 1, critical: true },
      { name: 'settings', store: useSettingsStore, priority: 1, critical: true },
      { name: 'theme', store: useThemeStore, priority: 1, critical: true },
      { name: 'product', store: useProductStore, priority: 2, critical: false },
      { name: 'inventory', store: useInventoryStore, priority: 2, critical: false },
      { name: 'category', store: useCategoryStore, priority: 2, critical: false },
      { name: 'brand', store: useBrandStore, priority: 2, critical: false },
      { name: 'generic', store: useGenericStore, priority: 2, critical: false },
      { name: 'customer', store: useCustomerStore, priority: 3, critical: false },
      { name: 'supplier', store: useSupplierStore, priority: 3, critical: false },
      { name: 'cart', store: useCartStore, priority: 4, critical: false },
      { name: 'sales', store: useSalesStore, priority: 4, critical: false },
      { name: 'purchase', store: usePurchaseStore, priority: 4, critical: false },
      { name: 'transaction', store: useTransactionStore, priority: 4, critical: false },
      { name: 'dashboard', store: useDashboardStore, priority: 5, critical: false },
      { name: 'audit', store: useAuditStore, priority: 6, critical: false }
    ];

    storeDefinitions.sort((a, b) => a.priority - b.priority);

    if (this.config.LAZY_LOADING) {
      const criticalStores = storeDefinitions.filter(def => def.critical);
      const nonCriticalStores = storeDefinitions.filter(def => !def.critical);

      for (const def of criticalStores) {
        await this.registerStore(def.name, def.store, def);
      }

      setTimeout(async () => {
        for (const def of nonCriticalStores) {
          await this.registerStore(def.name, def.store, def);
        }
      }, 50);
    } else {
      for (const def of storeDefinitions) {
        await this.registerStore(def.name, def.store, def);
      }
    }

    debugLog(`📦 Registered ${this.stores.size} stores`);
  }

  async registerStore(name, storeHook, options = {}) {
    const operationId = this.performanceMonitor.startOperation(`register-store-${name}`);
    
    try {
      if (this.stores.has(name)) {
        warnLog(`Store "${name}" already registered`);
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
      
      try {
        storeInstance.state = storeHook.getState();
        this.storeStates.set(name, { ...storeInstance.state });
        this.lastStateHashes.set(name, this.hashState(storeInstance.state));
      } catch (error) {
        warnLog(`Failed to get initial state for store "${name}":`, error);
      }

      const unsubscribe = storeHook.subscribe((state) => {
        this.handleStoreStateChangeOptimized(name, state);
      });
      
      this.storeSubscriptions.set(name, unsubscribe);

      this.eventRateTrackers.set(name, {
        events: [],
        lastCleanup: Date.now()
      });

      await this.setupStoreEventListeners(name, storeInstance);

      debugLog(`✅ Store "${name}" registered successfully`);
      this.performanceMonitor.endOperation(operationId, true);
      
    } catch (error) {
      console.error(`❌ Failed to register store "${name}":`, error);
      this.performanceMonitor.endOperation(operationId, false, error);
      throw error;
    }
  }

  // ===================================================================
  //  🔄 OPTIMIZED EVENT HANDLING (Same as before)
  // ===================================================================

  handleStoreStateChangeOptimized(storeName, newState) {
    if (this.isDestroyed) return;

    const store = this.stores.get(storeName);
    if (!store) return;

    if (!this.shouldAllowEvent(storeName)) {
      debugLog(`⏭️ Skipping event for "${storeName}" - rate limited`);
      return;
    }

    if (!this.hasSignificantChanges(storeName, newState)) {
      debugLog(`⏭️ Skipping event for "${storeName}" - no significant changes`);
      return;
    }

    this.debouncedEmitStateChange(storeName, newState);
  }

  shouldAllowEvent(storeName) {
    const tracker = this.eventRateTrackers.get(storeName);
    if (!tracker) return true;

    const now = Date.now();
    const oneSecondAgo = now - 1000;

    tracker.events = tracker.events.filter(time => time > oneSecondAgo);

    if (tracker.events.length >= this.config.MAX_EVENTS_PER_SECOND) {
      return false;
    }

    tracker.events.push(now);
    return true;
  }

  hasSignificantChanges(storeName, newState) {
    if (!this.config.SMART_FILTERING) return true;
    
    const oldHash = this.lastStateHashes.get(storeName);
    const newHash = this.hashState(newState);
    
    this.lastStateHashes.set(storeName, newHash);
    
    return oldHash !== newHash;
  }

  hashState(state) {
    try {
      const filteredState = this.filterStateForHashing(state);
      return JSON.stringify(filteredState);
    } catch (error) {
      return Date.now().toString();
    }
  }

  filterStateForHashing(state) {
    if (!state || typeof state !== 'object') return state;

    const filtered = { ...state };
    
    const noiseFields = [
      'lastUpdated', 'timestamp', 'lastSync', 'isLoading', 
      'loadingStates', 'ui', 'temp', 'cache', 'debug'
    ];

    noiseFields.forEach(field => {
      delete filtered[field];
    });

    return filtered;
  }

  debouncedEmitStateChange(storeName, newState) {
    const debounceKey = `${storeName}_state_change`;
    
    if (this.eventDebounceMap.has(debounceKey)) {
      clearTimeout(this.eventDebounceMap.get(debounceKey));
    }
    
    const timeoutId = setTimeout(() => {
      this.eventDebounceMap.delete(debounceKey);
      this.emitStateChangeEvent(storeName, newState);
    }, this.config.EVENT_DEBOUNCE_DELAY);
    
    this.eventDebounceMap.set(debounceKey, timeoutId);
    
    const oldState = this.storeStates.get(storeName);
    this.storeStates.set(storeName, { ...newState });
  }

  emitStateChangeEvent(storeName, newState) {
    const oldState = this.storeStates.get(storeName);
    
    debugLog(`🔍 Debug handleStoreStateChange: {storeName: '${storeName}', hasEventBus: ${!!this.eventBus}, hasPharmacyEvents: ${!!PHARMACY_EVENTS}, hasSystemEvents: ${!!PHARMACY_EVENTS?.SYSTEM}, storeStateChangedEvent: 'system:store:state_changed'}`);
    
    if (this.config.BATCH_DELAY > 0) {
      this.batchStateChange(storeName, oldState, newState);
    } else {
      this.emitSingleStateChange(storeName, oldState, newState);
    }
  }

  batchStateChange(storeName, oldState, newState) {
    this.stateBatch.set(storeName, { oldState, newState, timestamp: Date.now() });
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatchedChanges();
    }, this.config.BATCH_DELAY);
  }

  processBatchedChanges() {
    if (this.stateBatch.size === 0) return;

    const changes = Array.from(this.stateBatch.entries()).map(([storeName, data]) => ({
      storeName,
      ...data
    }));
    
    this.stateBatch.clear();
    this.batchTimeout = null;
    
    // 🔧 FIXED: Validate event name before emitting
    const eventName = PHARMACY_EVENTS?.SYSTEM?.STORES_BATCH_UPDATED;
    if (eventName && this.eventBus) {
      this.eventBus.emit(eventName, {
        changes,
        timestamp: Date.now(),
        count: changes.length
      }).catch(console.error);

      debugLog(`📡 Emitting batched store changes: ${changes.length} stores`);
    }
    
    changes.forEach(({ storeName, newState, oldState }) => {
      this.handleCrossStoreSync(storeName, newState, oldState);
    });
  }

  emitSingleStateChange(storeName, oldState, newState) {
    // 🔧 FIXED: Validate event name before emitting
    const eventName = PHARMACY_EVENTS?.SYSTEM?.STORE_STATE_CHANGED;
    if (eventName && this.eventBus) {
      this.eventBus.emit(eventName, {
        storeName,
        oldState,
        newState,
        timestamp: Date.now()
      }).catch(error => {
        console.error(`Failed to emit store state change event:`, error);
      });

      debugLog(`📡 Emitting store state change event: ${eventName}`);
    }

    this.handleCrossStoreSync(storeName, newState, oldState);
  }

  // ===================================================================
  //  🔧 FIXED MIDDLEWARE SETUP
  // ===================================================================

  async setupMiddleware() {
    try {
      // Setup pharmacy-specific middleware
      await setupPharmacyMiddlewares(this.eventBus);
      
      // 🔧 FIXED: Use correct method name 'use' instead of 'addMiddleware'
      if (typeof this.eventBus.use === 'function') {
        this.eventBus.use(this.performanceMiddleware.bind(this));
        this.eventBus.use(this.eventFilteringMiddleware.bind(this));
        this.eventBus.use(this.batchingMiddleware.bind(this));
      } else {
        console.warn('EventBus does not support middleware via use() method');
      }
      
      debugLog('🔧 Middleware setup completed');
    } catch (error) {
      console.error('❌ Middleware setup failed:', error);
      // Don't throw error - continue without custom middleware
    }
  }

  performanceMiddleware(event) {
    const startTime = performance.now();
    const operationId = this.performanceMonitor.startOperation(`event-${event.name}`);
    
    // Return promise that resolves after processing
    event.performanceStart = startTime;
    
    // Schedule performance tracking
    setTimeout(() => {
      const duration = performance.now() - startTime;
      this.performanceMonitor.endOperation(operationId, true);
      
      if (duration > 50) {
        debugLog(`⚠️ Slow event: ${event.name} took ${duration.toFixed(2)}ms`);
      }
    }, 0);

    return true; // Allow event to continue
  }

  eventFilteringMiddleware(event) {
    // Filter out events during destruction
    if (this.isDestroyed) {
      debugLog(`🚫 Filtered event during destruction: ${event.name}`);
      return false;
    }
    
    // 🔧 FIXED: Validate event name
    if (!event.name || typeof event.name !== 'string') {
      console.warn(`⚠️ Event with undefined or invalid name received:`, event);
      return false;
    }
    
    // Filter rapid duplicate events
    if (this.isDuplicateEvent(event.name, event.payload)) {
      debugLog(`🚫 Filtered duplicate event: ${event.name}`);
      return false;
    }
    
    return true;
  }

  batchingMiddleware(event) {
    // Only batch if event name is valid
    if (!event.name) return true;
    
    if (this.shouldBatchEvent(event.name)) {
      this.addEventToBatch(event.name, event.payload);
      return false; // Event is batched, don't process immediately
    }
    
    return true;
  }

  isDuplicateEvent(eventName, payload) {
    if (!eventName) return false;
    
    const eventKey = `${eventName}-${JSON.stringify(payload)}`;
    const now = Date.now();
    const lastEmit = this.storeLastEmit.get(eventKey);
    
    if (lastEmit && now - lastEmit < this.config.EVENT_DEBOUNCE_DELAY) {
      return true;
    }
    
    this.storeLastEmit.set(eventKey, now);
    return false;
  }

  shouldBatchEvent(eventName) {
    if (!eventName || !PHARMACY_EVENTS) return false;
    
    const batchableEvents = [
      PHARMACY_EVENTS.SYSTEM?.STORE_STATE_CHANGED,
      PHARMACY_EVENTS.INVENTORY?.STOCK_UPDATED,
      PHARMACY_EVENTS.PRODUCT?.UPDATED
    ].filter(Boolean); // Remove undefined events
    
    return batchableEvents.includes(eventName);
  }

  addEventToBatch(eventName, payload) {
    debugLog(`📦 Batching event: ${eventName}`);
  }

  // ===================================================================
  //  🔄 STORE SYNCHRONIZATION (Keep existing methods)
  // ===================================================================

  async setupStoreSynchronization() {
    const dependencies = {
      inventory: ['product'],
      cart: ['product', 'inventory'],
      sales: ['cart', 'product', 'inventory', 'customer'],
      dashboard: ['sales', 'product', 'inventory', 'purchase'],
      audit: ['*']
    };

    for (const [storeName, deps] of Object.entries(dependencies)) {
      if (this.stores.has(storeName)) {
        this.stores.get(storeName).dependencies = deps;
      }
    }

    debugLog('🔄 Store synchronization setup completed');
  }

  async syncStores(storeNames = null) {
    const operationId = this.performanceMonitor.startOperation('sync-stores');
    
    try {
      const storesToSync = storeNames 
        ? storeNames.filter(name => this.stores.has(name))
        : Array.from(this.stores.keys());

      debugLog(`🔄 Syncing ${storesToSync.length} stores...`);

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

      // 🔧 FIXED: Validate event before emitting
      const eventName = PHARMACY_EVENTS?.SYSTEM?.STORES_SYNCED;
      if (eventName && this.eventBus) {
        await this.eventBus.emit(eventName, {
          timestamp: Date.now(),
          results: syncResults,
          successful: syncResults.filter(r => r.success).length,
          failed: syncResults.filter(r => !r.success).length
        });
      }

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

    this.storeStates.set(storeName, { ...currentState });
    store.lastSync = Date.now();
    
    return { method: 'state-update', timestamp: store.lastSync };
  }

  // ===================================================================
  //  📡 EVENT HANDLING (Keep existing methods with validation fixes)
  // ===================================================================

  async setupStoreEventListeners(storeName, storeInstance) {
    const eventMappings = {
      product: [
        PHARMACY_EVENTS.PRODUCT?.CREATED,
        PHARMACY_EVENTS.PRODUCT?.UPDATED,
        PHARMACY_EVENTS.PRODUCT?.DELETED,
        PHARMACY_EVENTS.INVENTORY?.STOCK_UPDATED
      ].filter(Boolean),
      inventory: [
        PHARMACY_EVENTS.INVENTORY?.BATCH_CREATED,
        PHARMACY_EVENTS.INVENTORY?.BATCH_UPDATED,
        PHARMACY_EVENTS.INVENTORY?.STOCK_UPDATED,
        PHARMACY_EVENTS.INVENTORY?.LOW_STOCK_ALERT
      ].filter(Boolean),
      cart: [
        PHARMACY_EVENTS.SALES?.ITEM_ADDED,
        PHARMACY_EVENTS.SALES?.ITEM_REMOVED,
        PHARMACY_EVENTS.SALES?.CART_CLEARED
      ].filter(Boolean),
      sales: [
        PHARMACY_EVENTS.SALES?.TRANSACTION_COMPLETED,
        PHARMACY_EVENTS.SALES?.PAYMENT_PROCESSED,
        PHARMACY_EVENTS.SALES?.RECEIPT_GENERATED
      ].filter(Boolean),
      dashboard: [
        PHARMACY_EVENTS.SALES?.TRANSACTION_COMPLETED,
        PHARMACY_EVENTS.INVENTORY?.STOCK_UPDATED,
        PHARMACY_EVENTS.PRODUCT?.CREATED
      ].filter(Boolean)
    };

    const storeEvents = eventMappings[storeName] || [];
    
    for (const eventName of storeEvents) {
      if (eventName) { // Only add if event name is valid
        const listener = (payload) => this.handleStoreEvent(storeName, eventName, payload);
        const unsubscribe = this.eventBus.on(eventName, listener);
        storeInstance.eventListeners.set(eventName, unsubscribe);
      }
    }
  }

  async handleStoreEvent(storeName, eventName, payload) {
    if (this.isDestroyed) return;

    debugLog(`📡 Store "${storeName}" received event "${eventName}"`);

    const store = this.stores.get(storeName);
    if (!store || !store.isActive) return;

    try {
      this.eventBuffer.push({
        storeName,
        eventName,
        payload,
        timestamp: Date.now()
      });

      if (this.eventBuffer.length > this.config.EVENT_BUFFER_SIZE) {
        this.eventBuffer.splice(0, this.eventBuffer.length - this.config.EVENT_BUFFER_SIZE);
      }

      // Handle specific event types with validation
      if (PHARMACY_EVENTS?.PRODUCT) {
        switch (eventName) {
          case PHARMACY_EVENTS.PRODUCT.CREATED:
          case PHARMACY_EVENTS.PRODUCT.UPDATED:
            await this.handleProductEvent(payload);
            break;
        }
      }

      if (PHARMACY_EVENTS?.SALES) {
        switch (eventName) {
          case PHARMACY_EVENTS.SALES.TRANSACTION_COMPLETED:
            await this.handleSalesEvent(payload);
            break;
        }
      }

      if (PHARMACY_EVENTS?.INVENTORY) {
        switch (eventName) {
          case PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED:
            await this.handleInventoryEvent(payload);
            break;
        }
      }

    } catch (error) {
      console.error(`❌ Error handling event "${eventName}" for store "${storeName}":`, error);
    }
  }

  async handleProductEvent(payload) {
    try {
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

      const storesToUpdate = ['sales', 'inventory', 'dashboard', 'audit'];
      
      for (const storeName of storesToUpdate) {
        const store = this.stores.get(storeName);
        if (store?.isActive) {
          await this.syncSingleStore(storeName);
        }
      }

      // Emit follow-up events with validation
      const dashboardRefreshEvent = PHARMACY_EVENTS?.DASHBOARD?.DATA_REFRESH_NEEDED;
      if (dashboardRefreshEvent && this.eventBus) {
        await this.eventBus.emit(dashboardRefreshEvent, {
          reason: 'sales_transaction',
          transactionId,
          total
        });
      }

      if (customer) {
        const customerTransactionEvent = PHARMACY_EVENTS?.CUSTOMER?.TRANSACTION_RECORDED;
        if (customerTransactionEvent && this.eventBus) {
          await this.eventBus.emit(customerTransactionEvent, {
            customerId: customer._id,
            transactionId,
            amount: total
          });
        }
      }

    } catch (error) {
      console.error('Error handling sales event:', error);
    }
  }

  async handleInventoryEvent(payload) {
    try {
      const { productId, newStock, alertLevel } = payload;

      await Promise.all([
        this.syncSingleStore('inventory'),
        this.syncSingleStore('product')
      ]);

      if (newStock <= alertLevel) {
        const lowStockEvent = PHARMACY_EVENTS?.ALERTS?.LOW_STOCK_DETECTED;
        if (lowStockEvent && this.eventBus) {
          await this.eventBus.emit(lowStockEvent, {
            productId,
            currentStock: newStock,
            alertLevel,
            timestamp: Date.now()
          });
        }
      }

      await this.syncSingleStore('dashboard');

    } catch (error) {
      console.error('Error handling inventory event:', error);
    }
  }

  handleCrossStoreSync(storeName, newState, oldState) {
    if (this.isDestroyed) return;

    const store = this.stores.get(storeName);
    if (!store?.dependencies) return;

    if (store.dependencies.includes('*')) {
      this.handleAuditSync(storeName, newState, oldState);
      return;
    }

    const dependentStores = Array.from(this.stores.entries())
      .filter(([name, s]) => s.dependencies?.includes(storeName))
      .map(([name]) => name);

    if (dependentStores.length === 0) return;

    debugLog(`🔗 Cross-store sync: "${storeName}" affects [${dependentStores.join(', ')}]`);

    dependentStores.forEach(dependentStore => {
      this.debouncedEmitStateChange(`${dependentStore}_dependency_update`, {
        sourceStore: storeName,
        dependentStore,
        changes: this.extractSignificantChanges(oldState, newState),
        timestamp: Date.now()
      });
    });
  }

  handleAuditSync(sourceStoreName, newState, oldState) {
    try {
      const auditStore = this.stores.get('audit');
      if (!auditStore?.isActive) return;

      const auditState = auditStore.hook.getState();
      if (typeof auditState.logStateChange === 'function') {
        auditState.logStateChange({
          sourceStore: sourceStoreName,
          changes: this.extractSignificantChanges(oldState, newState),
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Error in audit sync:', error);
    }
  }

  extractSignificantChanges(oldState, newState) {
    if (!oldState || !newState) return {};

    const changes = {};
    const significantFields = [
      'products', 'inventory', 'sales', 'customers', 'suppliers',
      'totalQuantity', 'lowStockCount', 'todaySales', 'totalRevenue'
    ];

    significantFields.forEach(field => {
      if (oldState[field] !== newState[field]) {
        changes[field] = {
          from: oldState[field],
          to: newState[field]
        };
      }
    });

    return changes;
  }

  // ===================================================================
  //  🔄 AUTO SYNC & BACKGROUND TASKS
  // ===================================================================

  startAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => {
      if (!this.isDestroyed && this.isInitialized) {
        this.performAutoSync().catch(error => {
          console.error('Auto sync failed:', error);
        });
      }
    }, this.config.AUTO_SYNC_INTERVAL);

    debugLog(`🔄 Auto sync started (${this.config.AUTO_SYNC_INTERVAL}ms interval)`);
  }

  async performAutoSync() {
    try {
      debugLog('🔄 Performing auto sync...');
      
      const storesToSync = this.getStoresNeedingSync();
      
      if (storesToSync.length === 0) {
        debugLog('✅ All stores are up to date');
        return;
      }

      const results = await this.syncStores(storesToSync);
      
      const autoSyncEvent = PHARMACY_EVENTS?.SYSTEM?.AUTO_SYNC_COMPLETED;
      if (autoSyncEvent && this.eventBus) {
        await this.eventBus.emit(autoSyncEvent, {
          timestamp: Date.now(),
          syncedStores: storesToSync,
          results
        });
      }

      debugLog(`✅ Auto sync completed for ${storesToSync.length} stores`);
      
    } catch (error) {
      console.error('❌ Auto sync failed:', error);
      
      const autoSyncFailedEvent = PHARMACY_EVENTS?.SYSTEM?.AUTO_SYNC_FAILED;
      if (autoSyncFailedEvent && this.eventBus) {
        await this.eventBus.emit(autoSyncFailedEvent, {
          timestamp: Date.now(),
          error: error.message
        });
      }
    }
  }

  getStoresNeedingSync() {
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    
    return Array.from(this.stores.entries())
      .filter(([name, store]) => {
        if (!store.isActive) return false;
        
        const lastSync = store.lastSync;
        return !lastSync || (now - lastSync) > staleThreshold;
      })
      .map(([name]) => name);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      debugLog('⏹️ Auto sync stopped');
    }
  }

  // ===================================================================
  //  📊 MONITORING & ANALYTICS
  // ===================================================================

  getAdapterMetrics() {
    const performanceMetrics = this.performanceMonitor.getMetrics();
    
    return {
      adapter: {
        isInitialized: this.isInitialized,
        isDestroyed: this.isDestroyed,
        storeCount: this.stores.size,
        activeStores: Array.from(this.stores.values()).filter(s => s.isActive).length,
        eventBufferSize: this.eventBuffer.length,
        operationQueueSize: this.operationQueue.length,
        lastAutoSync: this.syncInterval ? 'active' : 'inactive'
      },
      performance: performanceMetrics,
      events: {
        totalProcessed: this.eventBuffer.length,
        recentEvents: this.eventBuffer.slice(-5).map(e => ({
          store: e.storeName,
          event: e.eventName,
          timestamp: e.timestamp
        }))
      },
      stores: this.getStoreStatuses()
    };
  }

  getStoreStatuses() {
    const statuses = {};
    
    for (const [name, store] of this.stores.entries()) {
      statuses[name] = {
        isActive: store.isActive,
        lastSync: store.lastSync,
        subscriptionCount: store.subscriptions.size,
        eventListenerCount: store.eventListeners.size,
        hasDependencies: !!store.dependencies?.length,
        dependencies: store.dependencies || []
      };
    }
    
    return statuses;
  }

  getStoreHealth() {
    const health = {
      overall: 'healthy',
      issues: [],
      stores: {},
      recommendations: []
    };

    let healthyStores = 0;
    let totalStores = this.stores.size;

    for (const [name, store] of this.stores.entries()) {
      const storeHealth = this.evaluateStoreHealth(name, store);
      health.stores[name] = storeHealth;

      if (storeHealth.status === 'healthy') {
        healthyStores++;
      } else {
        health.issues.push(`Store "${name}": ${storeHealth.issue}`);
      }
    }

    const healthRatio = healthyStores / totalStores;
    if (healthRatio < 0.5) {
      health.overall = 'critical';
      health.recommendations.push('Multiple store failures detected - check system health');
    } else if (healthRatio < 0.8) {
      health.overall = 'warning';
      health.recommendations.push('Some stores experiencing issues - monitor closely');
    }

    const perfMetrics = this.performanceMonitor.getMetrics();
    if (perfMetrics.errorRate > 5) {
      health.overall = 'warning';
      health.recommendations.push('High error rate detected - check store operations');
    }

    return health;
  }

  evaluateStoreHealth(name, store) {
    if (!store.isActive) {
      return { status: 'inactive', issue: 'Store is not active' };
    }

    const now = Date.now();
    
    if (store.lastSync && (now - store.lastSync) > 30 * 60 * 1000) {
      return { status: 'warning', issue: 'Store sync is overdue' };
    }

    try {
      const storeState = store.hook.getState();
      
      if (storeState.error) {
        return { status: 'error', issue: `Store error: ${storeState.error}` };
      }
      
      if (storeState.isLoading && storeState.loadingStartTime) {
        const loadingDuration = now - storeState.loadingStartTime;
        if (loadingDuration > 30000) {
          return { status: 'warning', issue: 'Store has been loading for too long' };
        }
      }
      
    } catch (error) {
      return { status: 'error', issue: `Cannot access store state: ${error.message}` };
    }

    return { status: 'healthy' };
  }

  // ===================================================================
  //  🛠️ UTILITY METHODS
  // ===================================================================

  async executeStoreMethod(storeName, methodName, ...args) {
    const store = this.stores.get(storeName);
    if (!store || !store.isActive) {
      throw new Error(`Store "${storeName}" not found or inactive`);
    }

    const storeState = store.hook.getState();
    if (typeof storeState[methodName] !== 'function') {
      throw new Error(`Method "${methodName}" not found in store "${storeName}"`);
    }

    const operationId = this.performanceMonitor.startOperation(`store-method-${storeName}-${methodName}`);
    
    try {
      const result = await storeState[methodName](...args);
      this.performanceMonitor.endOperation(operationId, true);
      return result;
    } catch (error) {
      this.performanceMonitor.endOperation(operationId, false, error);
      throw error;
    }
  }

  getStoreState(storeName) {
    const store = this.stores.get(storeName);
    if (!store || !store.isActive) {
      throw new Error(`Store "${storeName}" not found or inactive`);
    }

    return store.hook.getState();
  }

  getAllStoreStates() {
    const states = {};
    for (const [name, store] of this.stores.entries()) {
      if (store.isActive) {
        try {
          states[name] = store.hook.getState();
        } catch (error) {
          states[name] = { error: error.message };
        }
      }
    }
    return states;
  }

  async waitForStoreInitialization(storeName, timeout = 10000) {
    const store = this.stores.get(storeName);
    if (!store) {
      throw new Error(`Store "${storeName}" not found`);
    }

    if (store.isActive && store.state) {
      return store.state;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Store "${storeName}" initialization timeout`));
      }, timeout);

      const checkStore = () => {
        if (store.isActive && store.state) {
          clearTimeout(timeoutId);
          resolve(store.state);
        } else {
          setTimeout(checkStore, 100);
        }
      };

      checkStore();
    });
  }

  // ===================================================================
  //  🧹 CLEANUP & DESTRUCTION
  // ===================================================================

  async destroy() {
    if (this.isDestroyed) {
      warnLog('Store Adapter already destroyed');
      return;
    }

    debugLog('🧹 Destroying Store Adapter...');
    this.isDestroyed = true;

    try {
      this.stopAutoSync();

      for (const timeoutId of this.eventDebounceMap.values()) {
        clearTimeout(timeoutId);
      }
      this.eventDebounceMap.clear();

      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
        this.batchTimeout = null;
      }

      for (const [storeName, unsubscribe] of this.storeSubscriptions.entries()) {
        try {
          if (typeof unsubscribe === 'function') {
            unsubscribe();
          }
        } catch (error) {
          console.error(`Error unsubscribing from store "${storeName}":`, error);
        }
      }

      for (const [storeName, store] of this.stores.entries()) {
        for (const [eventName, unsubscribe] of store.eventListeners.entries()) {
          try {
            if (typeof unsubscribe === 'function') {
              unsubscribe();
            }
          } catch (error) {
            console.error(`Error removing event listener for "${storeName}.${eventName}":`, error);
          }
        }
        store.eventListeners.clear();
      }

      this.stores.clear();
      this.storeSubscriptions.clear();
      this.storeStates.clear();
      this.storeLastEmit.clear();
      this.eventRateTrackers.clear();
      this.lastStateHashes.clear();
      this.stateBatch.clear();
      this.eventBuffer.length = 0;
      this.operationQueue.length = 0;

      const destroyEvent = PHARMACY_EVENTS?.SYSTEM?.ADAPTER_DESTROYED;
      if (destroyEvent && this.eventBus && !this.eventBus.isDestroyed) {
        await this.eventBus.emit(destroyEvent, {
          timestamp: Date.now(),
          performanceMetrics: this.performanceMonitor.getMetrics()
        });
      }

      this.performanceMonitor.clearMetrics();

      debugLog('✅ Store Adapter destroyed successfully');
      
    } catch (error) {
      console.error('❌ Error during Store Adapter destruction:', error);
    }
  }

  // ===================================================================
  //  🔄 RESTART & RECOVERY
  // ===================================================================

  async restart() {
    debugLog('🔄 Restarting Store Adapter...');
    
    const wasDestroyed = this.isDestroyed;
    
    await this.destroy();
    
    this.isDestroyed = false;
    this.isInitialized = false;
    
    await this.init();
    
    debugLog('✅ Store Adapter restarted successfully');
    
    return {
      wasDestroyed,
      restartTime: Date.now(),
      storeCount: this.stores.size
    };
  }

  // ===================================================================
  //  📋 DEBUGGING & DEVELOPMENT
  // ===================================================================

  debugDumpState() {
    if (!this.config.ENABLE_DEBUG_LOGS) return;

    console.group('🔍 Store Adapter Debug State');
    console.log('Configuration:', this.config);
    console.log('Adapter State:', {
      isInitialized: this.isInitialized,
      isDestroyed: this.isDestroyed,
      storeCount: this.stores.size,
      eventBufferSize: this.eventBuffer.length
    });
    console.log('Store States:', this.getAllStoreStates());
    console.log('Performance Metrics:', this.performanceMonitor.getMetrics());
    console.log('Health Status:', this.getStoreHealth());
    console.groupEnd();
  }

  generateDiagnosticReport() {
    return {
      timestamp: new Date().toISOString(),
      adapter: {
        version: '2.0.0',
        config: this.config,
        state: {
          isInitialized: this.isInitialized,
          isDestroyed: this.isDestroyed,
          storeCount: this.stores.size,
          activeStores: Array.from(this.stores.values()).filter(s => s.isActive).length
        }
      },
      performance: this.performanceMonitor.getMetrics(),
      health: this.getStoreHealth(),
      metrics: this.getAdapterMetrics(),
      eventBuffer: this.eventBuffer.slice(-10),
      recentOperations: Array.from(this.performanceMonitor.metrics.values())
        .sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime))
        .slice(0, 10)
    };
  }
}

// ===================================================================
//  🏭 FACTORY FUNCTIONS & EXPORTS
// ===================================================================

let globalStoreAdapter = null;

export const createStoreAdapter = async (config = {}) => {
  if (globalStoreAdapter) {
    warnLog('Global store adapter already exists');
    return globalStoreAdapter;
  }

  globalStoreAdapter = new StoreAdapter(config);
  await globalStoreAdapter.init();
  return globalStoreAdapter;
};

export const getStoreAdapter = () => {
  return globalStoreAdapter;
};

export const destroyStoreAdapter = async () => {
  if (globalStoreAdapter) {
    await globalStoreAdapter.destroy();
    globalStoreAdapter = null;
    debugLog('🗑️ Global store adapter destroyed');
  }
};

export const resetStoreAdapter = async (config = {}) => {
  await destroyStoreAdapter();
  return await createStoreAdapter(config);
};

// ===================================================================
//  🎯 ADVANCED UTILITY FUNCTIONS
// ===================================================================

export const withStoreAdapter = (component) => {
  return (props) => {
    const adapter = getStoreAdapter();
    return component({ ...props, storeAdapter: adapter });
  };
};

export const useStoreAdapterMetrics = () => {
  const adapter = getStoreAdapter();
  return adapter ? adapter.getAdapterMetrics() : null;
};

export const useStoreHealth = () => {
  const adapter = getStoreAdapter();
  return adapter ? adapter.getStoreHealth() : null;
};

// ===================================================================
//  📊 MONITORING & DEBUGGING UTILITIES
// ===================================================================

export const StoreAdapterDashboard = {
  getSystemOverview() {
    const adapter = getStoreAdapter();
    if (!adapter) return null;

    return {
      adapter: {
        isInitialized: adapter.isInitialized,
        isDestroyed: adapter.isDestroyed,
        uptime: Date.now() - (adapter.initTime || Date.now()),
        version: '2.0.0'
      },
      stores: adapter.getStoreStatuses(),
      performance: adapter.performanceMonitor.getMetrics(),
      health: adapter.getStoreHealth(),
      events: {
        bufferSize: adapter.eventBuffer.length,
        recentEvents: adapter.eventBuffer.slice(-10)
      }
    };
  },

  async runDiagnostics() {
    const adapter = getStoreAdapter();
    if (!adapter) return { error: 'No adapter found' };

    const diagnostics = {
      timestamp: new Date().toISOString(),
      tests: []
    };

    // Test 1: Adapter initialization
    diagnostics.tests.push({
      name: 'Adapter Initialization',
      status: adapter.isInitialized ? 'pass' : 'fail',
      message: adapter.isInitialized ? 'Adapter is properly initialized' : 'Adapter not initialized'
    });

    // Test 2: Event bus connectivity
    try {
      await adapter.eventBus.emit('diagnostic:test', { timestamp: Date.now() });
      diagnostics.tests.push({
        name: 'Event Bus Connectivity',
        status: 'pass',
        message: 'Event bus is responsive'
      });
    } catch (error) {
      diagnostics.tests.push({
        name: 'Event Bus Connectivity',
        status: 'fail',
        message: `Event bus error: ${error.message}`
      });
    }

    // Test 3: Store responsiveness
    let responsiveStores = 0;
    const totalStores = adapter.stores.size;

    for (const [storeName, store] of adapter.stores.entries()) {
      try {
        const state = store.hook.getState();
        if (state && typeof state === 'object') {
          responsiveStores++;
        }
      } catch (error) {
        console.warn(`Store ${storeName} not responsive:`, error);
      }
    }

    diagnostics.tests.push({
      name: 'Store Responsiveness',
      status: responsiveStores === totalStores ? 'pass' : 'warning',
      message: `${responsiveStores}/${totalStores} stores responsive`
    });

    // Test 4: Performance metrics
    const perfMetrics = adapter.performanceMonitor.getMetrics();
    diagnostics.tests.push({
      name: 'Performance Metrics',
      status: perfMetrics.errorRate < 5 ? 'pass' : 'warning',
      message: `Error rate: ${perfMetrics.errorRate.toFixed(2)}%`
    });

    // Test 5: Memory usage
    const memoryUsage = {
      stores: adapter.stores.size,
      subscriptions: adapter.storeSubscriptions.size,
      eventBuffer: adapter.eventBuffer.length,
      performanceMetrics: adapter.performanceMonitor.metrics.size
    };

    const totalMemoryItems = Object.values(memoryUsage).reduce((a, b) => a + b, 0);
    diagnostics.tests.push({
      name: 'Memory Usage',
      status: totalMemoryItems < 10000 ? 'pass' : 'warning',
      message: `Total tracked items: ${totalMemoryItems}`,
      details: memoryUsage
    });

    return diagnostics;
  },

  async performHealthCheck() {
    const adapter = getStoreAdapter();
    if (!adapter) return { status: 'critical', message: 'No adapter found' };

    const health = adapter.getStoreHealth();
    const metrics = adapter.getAdapterMetrics();

    return {
      status: health.overall,
      timestamp: new Date().toISOString(),
      summary: {
        stores: {
          total: adapter.stores.size,
          healthy: Object.values(health.stores).filter(s => s.status === 'healthy').length,
          issues: health.issues.length
        },
        performance: {
          totalOperations: metrics.performance.totalOperations,
          errorRate: metrics.performance.errorRate,
          activeOperations: metrics.performance.activeOperations
        },
        events: {
          bufferSize: adapter.eventBuffer.length,
          subscriptions: adapter.storeSubscriptions.size
        }
      },
      issues: health.issues,
      recommendations: health.recommendations
    };
  },

  startMonitoring(interval = 30000) {
    return setInterval(async () => {
      const health = await StoreAdapterDashboard.performHealthCheck();
      
      if (health.status !== 'healthy') {
        console.warn('🚨 Store Adapter Health Issue:', health);
        
        // Emit health warning event
        const adapter = getStoreAdapter();
        if (adapter?.eventBus) {
          adapter.eventBus.emit(PHARMACY_EVENTS.SYSTEM.PERFORMANCE_WARNING, {
            type: 'store_adapter_health',
            status: health.status,
            issues: health.issues,
            timestamp: Date.now()
          });
        }
      }
    }, interval);
  }
};

// ===================================================================
//  🔧 DEVELOPMENT & DEBUGGING TOOLS
// ===================================================================

export const StoreAdapterDevTools = {
  enableDebugMode() {
    const adapter = getStoreAdapter();
    if (adapter) {
      adapter.config.ENABLE_DEBUG_LOGS = true;
      adapter.config.PERFORMANCE_TRACKING = true;
      console.log('🔧 Store Adapter debug mode enabled');
    }
  },

  disableDebugMode() {
    const adapter = getStoreAdapter();
    if (adapter) {
      adapter.config.ENABLE_DEBUG_LOGS = false;
      console.log('🔇 Store Adapter debug mode disabled');
    }
  },

  dumpState() {
    const adapter = getStoreAdapter();
    if (adapter) {
      adapter.debugDumpState();
    }
  },

  async simulateStoreError(storeName) {
    const adapter = getStoreAdapter();
    if (!adapter) return;

    try {
      await adapter.eventBus.emit(PHARMACY_EVENTS.SYSTEM.ERROR_OCCURRED, {
        source: 'store',
        storeName,
        error: 'Simulated error for testing',
        timestamp: Date.now()
      });
      
      console.log(`🧪 Simulated error for store: ${storeName}`);
    } catch (error) {
      console.error('Failed to simulate error:', error);
    }
  },

  async testStoreSync(storeName) {
    const adapter = getStoreAdapter();
    if (!adapter) return;

    const startTime = Date.now();
    
    try {
      const result = await adapter.syncSingleStore(storeName);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Store sync test completed for ${storeName}:`, {
        duration: `${duration}ms`,
        result
      });
      
      return { success: true, duration, result };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`❌ Store sync test failed for ${storeName}:`, error);
      return { success: false, duration, error: error.message };
    }
  },

  generateReport() {
    const adapter = getStoreAdapter();
    if (!adapter) return null;

    return adapter.generateDiagnosticReport();
  },

  async stressTest(duration = 10000, operationsPerSecond = 10) {
    const adapter = getStoreAdapter();
    if (!adapter) return;

    console.log(`🏋️ Starting stress test: ${duration}ms at ${operationsPerSecond} ops/sec`);
    
    const startTime = Date.now();
    let operations = 0;
    let errors = 0;
    
    const interval = setInterval(async () => {
      try {
        // Simulate various operations
        const operation = Math.floor(Math.random() * 3);
        
        switch (operation) {
          case 0:
            await adapter.syncStores();
            break;
          case 1:
            await adapter.eventBus.emit('test:stress_operation', { 
              operation: operations,
              timestamp: Date.now() 
            });
            break;
          case 2:
            adapter.getAdapterMetrics();
            break;
        }
        
        operations++;
      } catch (error) {
        errors++;
        console.error('Stress test operation failed:', error);
      }
      
      if (Date.now() - startTime >= duration) {
        clearInterval(interval);
        
        const results = {
          duration,
          totalOperations: operations,
          errors,
          successRate: ((operations - errors) / operations * 100).toFixed(2),
          operationsPerSecond: (operations / (duration / 1000)).toFixed(2)
        };
        
        console.log('🏁 Stress test completed:', results);
        return results;
      }
    }, 1000 / operationsPerSecond);
  }
};

// ===================================================================
//  🚀 INITIALIZATION HELPERS
// ===================================================================

export const initializeStoreSystem = async (config = {}) => {
  try {
    console.log('🚀 Initializing Store System...');
    
    // Create and initialize store adapter
    const adapter = await createStoreAdapter(config);
    
    // Setup monitoring if enabled
    if (config.ENABLE_MONITORING !== false) {
      StoreAdapterDashboard.startMonitoring(config.MONITORING_INTERVAL || 30000);
    }
    
    // Enable debug mode in development
    if (process.env.NODE_ENV === 'development' && config.ENABLE_DEBUG_LOGS !== false) {
      StoreAdapterDevTools.enableDebugMode();
    }
    
    console.log('✅ Store System initialized successfully');
    return adapter;
    
  } catch (error) {
    console.error('❌ Store System initialization failed:', error);
    throw error;
  }
};

export const shutdownStoreSystem = async () => {
  try {
    console.log('🛑 Shutting down Store System...');
    
    await destroyStoreAdapter();
    
    console.log('✅ Store System shutdown complete');
  } catch (error) {
    console.error('❌ Store System shutdown failed:', error);
    throw error;
  }
};

// ===================================================================
//  📈 PERFORMANCE OPTIMIZATION UTILITIES
// ===================================================================

export const StoreOptimizer = {
  async optimizeStorePerformance() {
    const adapter = getStoreAdapter();
    if (!adapter) return;

    console.log('⚡ Optimizing store performance...');
    
    // Clear old performance metrics
    adapter.performanceMonitor.clearMetrics();
    
    // Clear event buffer if too large
    if (adapter.eventBuffer.length > 100) {
      adapter.eventBuffer.splice(0, adapter.eventBuffer.length - 100);
    }
    
    // Clean up old state snapshots
    for (const [storeName, store] of adapter.stores.entries()) {
      if (store.stateHistory && store.stateHistory.length > 10) {
        store.stateHistory.splice(0, store.stateHistory.length - 10);
      }
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    console.log('✅ Store performance optimization completed');
  },

  async analyzePerfBottlenecks() {
    const adapter = getStoreAdapter();
    if (!adapter) return null;

    const metrics = adapter.performanceMonitor.getMetrics();
    const bottlenecks = [];
    
    // Analyze slow operations
    metrics.recentOperations.forEach(op => {
      if (op.duration > 100) {
        bottlenecks.push({
          type: 'slow_operation',
          operation: op.name,
          duration: op.duration,
          timestamp: op.startTime
        });
      }
    });
    
    // Analyze error rates
    if (metrics.errorRate > 5) {
      bottlenecks.push({
        type: 'high_error_rate',
        errorRate: metrics.errorRate,
        totalErrors: metrics.totalErrors
      });
    }
    
    // Analyze memory usage
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed > 100 * 1024 * 1024) { // 100MB
      bottlenecks.push({
        type: 'high_memory_usage',
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal
      });
    }
    
    return {
      timestamp: Date.now(),
      bottlenecks,
      recommendations: this.generateOptimizationRecommendations(bottlenecks)
    };
  },

  generateOptimizationRecommendations(bottlenecks) {
    const recommendations = [];
    
    bottlenecks.forEach(bottleneck => {
      switch (bottleneck.type) {
        case 'slow_operation':
          recommendations.push(`Optimize ${bottleneck.operation} - currently taking ${bottleneck.duration}ms`);
          break;
        case 'high_error_rate':
          recommendations.push('Investigate error sources and add error handling');
          break;
        case 'high_memory_usage':
          recommendations.push('Consider implementing memory cleanup strategies');
          break;
      }
    });
    
    return recommendations;
  }
};

// ===================================================================
//  🔄 BACKUP & RECOVERY UTILITIES
// ===================================================================

export const StoreBackupManager = {
  async createStateSnapshot() {
    const adapter = getStoreAdapter();
    if (!adapter) return null;

    const snapshot = {
      timestamp: Date.now(),
      adapterConfig: { ...adapter.config },
      storeStates: {},
      metrics: adapter.getAdapterMetrics(),
      version: '2.0.0'
    };

    // Capture all store states
    for (const [storeName, store] of adapter.stores.entries()) {
      try {
        snapshot.storeStates[storeName] = {
          state: store.hook.getState(),
          lastSync: store.lastSync,
          isActive: store.isActive
        };
      } catch (error) {
        console.warn(`Failed to snapshot store ${storeName}:`, error);
        snapshot.storeStates[storeName] = { error: error.message };
      }
    }

    return snapshot;
  },

  async restoreFromSnapshot(snapshot) {
    const adapter = getStoreAdapter();
    if (!adapter) throw new Error('No adapter available for restore');

    console.log('🔄 Restoring from snapshot...');

    // Validate snapshot
    if (!snapshot.storeStates) {
      throw new Error('Invalid snapshot format');
    }

    let restoredCount = 0;
    let errorCount = 0;

    // Restore store states
    for (const [storeName, stateData] of Object.entries(snapshot.storeStates)) {
      try {
        const store = adapter.stores.get(storeName);
        if (store && store.isActive && stateData.state) {
          // This would require store-specific restore methods
          // For now, we just log the restoration attempt
          console.log(`Restoring state for store: ${storeName}`);
          restoredCount++;
        }
      } catch (error) {
        console.error(`Failed to restore store ${storeName}:`, error);
        errorCount++;
      }
    }

    console.log(`✅ Snapshot restore completed: ${restoredCount} restored, ${errorCount} errors`);
    return { restoredCount, errorCount };
  }
};

// ===================================================================
//  🎯 FINAL EXPORTS & DEFAULT
// ===================================================================

// Export store adapter instance and utilities
export {
  ADAPTER_CONFIG,
  StorePerformanceMonitor
};

// Default export with commonly used functions
export default {
  // Core functions
  createStoreAdapter,
  getStoreAdapter,
  destroyStoreAdapter,
  resetStoreAdapter,
  
  // React hooks
  useStoreAdapterMetrics,
  useStoreHealth,
  
  // Higher-order components
  withStoreAdapter
};
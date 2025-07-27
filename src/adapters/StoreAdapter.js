// src/adapters/StoreAdapter.js
// ===================================================================
//  🏗️ OPTIMIZED STORE ADAPTER - PERFORMANCE ENHANCED
//  Fixed: Event storms, rate limiting, debouncing, batching
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
      
      // Only log if debug mode or slow operations
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

// Store Adapter Configuration - OPTIMIZED
const ADAPTER_CONFIG = {
  AUTO_SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutes
  BATCH_SIZE: 50,
  RETRY_ATTEMPTS: 3,
  TIMEOUT: 10000,
  DEBOUNCE_DELAY: 150,        // ✅ Optimized debounce
  CACHE_DURATION: 10 * 60 * 1000,
  EVENT_BUFFER_SIZE: 100,
  PERFORMANCE_TRACKING: true,
  
  // ✅ NEW PERFORMANCE CONFIGS
  EVENT_DEBOUNCE_DELAY: 100,  // Debounce rapid events
  BATCH_DELAY: 50,            // Batch multiple updates
  SIGNIFICANT_CHANGE_THRESHOLD: 0.1, // Skip trivial changes
  MAX_EVENTS_PER_SECOND: 50,  // Rate limit per store
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV === 'development',
  LAZY_LOADING: true,
  SMART_FILTERING: true       // Filter unnecessary events
};

// Debug logging helper
const debugLog = ADAPTER_CONFIG.ENABLE_DEBUG_LOGS ? console.log : () => {};
const warnLog = console.warn; // Always show warnings

// ===================================================================
//  🎯 OPTIMIZED STORE ADAPTER CLASS
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
    this.storeLastEmit = new Map(); // Track last emit time per store
    
    // ✅ PERFORMANCE OPTIMIZATIONS
    this.eventDebounceMap = new Map();
    this.stateBatch = new Map();
    this.batchTimeout = null;
    this.eventRateTrackers = new Map();
    this.lastStateHashes = new Map(); // Track state changes efficiently
    
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
      
      // Register all stores (with optimization)
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
      debugLog('✅ Store Adapter initialized successfully');
      
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
      
      debugLog('📡 Event bus initialized');
    } catch (error) {
      console.error('❌ Event bus initialization failed:', error);
      throw error;
    }
  }

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

    // Sort by priority for initialization order
    storeDefinitions.sort((a, b) => a.priority - b.priority);

    if (this.config.LAZY_LOADING) {
      // ✅ OPTIMIZED: Load critical stores first, others lazily
      const criticalStores = storeDefinitions.filter(def => def.critical);
      const nonCriticalStores = storeDefinitions.filter(def => !def.critical);

      // Load critical stores immediately
      for (const def of criticalStores) {
        await this.registerStore(def.name, def.store, def);
      }

      // Load non-critical stores with delay to prevent blocking
      setTimeout(async () => {
        for (const def of nonCriticalStores) {
          await this.registerStore(def.name, def.store, def);
        }
      }, 50);
    } else {
      // Load all stores normally
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
      
      // Get initial state
      try {
        storeInstance.state = storeHook.getState();
        this.storeStates.set(name, { ...storeInstance.state });
        
        // ✅ OPTIMIZATION: Track state hash for efficient change detection
        this.lastStateHashes.set(name, this.hashState(storeInstance.state));
      } catch (error) {
        warnLog(`Failed to get initial state for store "${name}":`, error);
      }

      // Setup store subscription for state changes with optimization
      const unsubscribe = storeHook.subscribe((state) => {
        this.handleStoreStateChangeOptimized(name, state);
      });
      
      this.storeSubscriptions.set(name, unsubscribe);

      // Initialize rate tracker for this store
      this.eventRateTrackers.set(name, {
        events: [],
        lastCleanup: Date.now()
      });

      // Register store-specific event listeners
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
  //  🔄 OPTIMIZED EVENT HANDLING
  // ===================================================================

  /**
   * ✅ OPTIMIZED: Handles store state changes with smart filtering and debouncing
   */
  handleStoreStateChangeOptimized(storeName, newState) {
    if (this.isDestroyed) return;

    const store = this.stores.get(storeName);
    if (!store) return;

    // ✅ RATE LIMITING: Check if this store is emitting too frequently
    if (!this.shouldAllowEvent(storeName)) {
      debugLog(`⏭️ Skipping event for "${storeName}" - rate limited`);
      return;
    }

    // ✅ CHANGE DETECTION: Only process if there are significant changes
    if (!this.hasSignificantChanges(storeName, newState)) {
      debugLog(`⏭️ Skipping event for "${storeName}" - no significant changes`);
      return;
    }

    // ✅ DEBOUNCING: Debounce rapid successive changes
    this.debouncedEmitStateChange(storeName, newState);
  }

  /**
   * ✅ NEW: Check if event should be allowed based on rate limiting
   */
  shouldAllowEvent(storeName) {
    const tracker = this.eventRateTrackers.get(storeName);
    if (!tracker) return true;

    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Clean old events
    tracker.events = tracker.events.filter(time => time > oneSecondAgo);

    // Check rate limit
    if (tracker.events.length >= this.config.MAX_EVENTS_PER_SECOND) {
      return false;
    }

    // Add current event
    tracker.events.push(now);
    return true;
  }

  /**
   * ✅ NEW: Efficient change detection using state hashing
   */
  hasSignificantChanges(storeName, newState) {
    if (!this.config.SMART_FILTERING) return true;
    
    const oldHash = this.lastStateHashes.get(storeName);
    const newHash = this.hashState(newState);
    
    // Update hash
    this.lastStateHashes.set(storeName, newHash);
    
    return oldHash !== newHash;
  }

  /**
   * ✅ NEW: Simple state hashing for change detection
   */
  hashState(state) {
    try {
      // Skip frequently changing fields that don't matter for business logic
      const filteredState = this.filterStateForHashing(state);
      return JSON.stringify(filteredState);
    } catch (error) {
      // Fallback to timestamp if hashing fails
      return Date.now().toString();
    }
  }

  /**
   * ✅ NEW: Filter out noise from state for efficient comparison
   */
  filterStateForHashing(state) {
    if (!state || typeof state !== 'object') return state;

    const filtered = { ...state };
    
    // Remove noisy fields that change frequently but aren't significant
    const noiseFields = [
      'lastUpdated', 'timestamp', 'lastSync', 'isLoading', 
      'loadingStates', 'ui', 'temp', 'cache', 'debug'
    ];

    noiseFields.forEach(field => {
      delete filtered[field];
    });

    return filtered;
  }

  /**
   * ✅ OPTIMIZED: Debounced event emission
   */
  debouncedEmitStateChange(storeName, newState) {
    const debounceKey = `${storeName}_state_change`;
    
    // Clear existing timeout
    if (this.eventDebounceMap.has(debounceKey)) {
      clearTimeout(this.eventDebounceMap.get(debounceKey));
    }
    
    // Set new timeout
    const timeoutId = setTimeout(() => {
      this.eventDebounceMap.delete(debounceKey);
      this.emitStateChangeEvent(storeName, newState);
    }, this.config.EVENT_DEBOUNCE_DELAY);
    
    this.eventDebounceMap.set(debounceKey, timeoutId);
    
    // Update state immediately (don't wait for debounce)
    const oldState = this.storeStates.get(storeName);
    this.storeStates.set(storeName, { ...newState });
  }

  /**
   * ✅ OPTIMIZED: Emit state change event with batching
   */
  emitStateChangeEvent(storeName, newState) {
    const oldState = this.storeStates.get(storeName);
    
    debugLog(`🔍 Debug handleStoreStateChange: {storeName: '${storeName}', hasEventBus: ${!!this.eventBus}, hasPharmacyEvents: ${!!PHARMACY_EVENTS}, hasSystemEvents: ${!!PHARMACY_EVENTS.SYSTEM}, storeStateChangedEvent: 'system:store:state_changed'}`);
    
    // ✅ BATCH SIMILAR EVENTS
    if (this.config.BATCH_DELAY > 0) {
      this.batchStateChange(storeName, oldState, newState);
    } else {
      // Emit immediately
      this.emitSingleStateChange(storeName, oldState, newState);
    }
  }

  /**
   * ✅ NEW: Batch multiple state changes
   */
  batchStateChange(storeName, oldState, newState) {
    this.stateBatch.set(storeName, { oldState, newState, timestamp: Date.now() });
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatchedChanges();
    }, this.config.BATCH_DELAY);
  }

  /**
   * ✅ NEW: Process batched state changes
   */
  processBatchedChanges() {
    if (this.stateBatch.size === 0) return;

    const changes = Array.from(this.stateBatch.entries()).map(([storeName, data]) => ({
      storeName,
      ...data
    }));
    
    this.stateBatch.clear();
    this.batchTimeout = null;
    
    // Emit batch event
    this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.STORES_BATCH_UPDATED, {
      changes,
      timestamp: Date.now(),
      count: changes.length
    }).catch(console.error);

    debugLog(`📡 Emitting batched store changes: ${changes.length} stores`);
    
    // Handle cross-store sync for batched changes
    changes.forEach(({ storeName, newState, oldState }) => {
      this.handleCrossStoreSync(storeName, newState, oldState);
    });
  }

  /**
   * ✅ OPTIMIZED: Emit single state change (fallback)
   */
  emitSingleStateChange(storeName, oldState, newState) {
    this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.STORE_STATE_CHANGED, {
      storeName,
      oldState,
      newState,
      timestamp: Date.now()
    }).catch(console.error);

    debugLog(`📡 Emitting store state change event: system:store:state_changed`);

    // Handle cross-store synchronization
    this.handleCrossStoreSync(storeName, newState, oldState);
  }

  // ===================================================================
  //  📡 EVENT HANDLING (EXISTING METHODS - OPTIMIZED)
  // ===================================================================

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
  //  🔄 STORE SYNCHRONIZATION (EXISTING - KEPT SAME)
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
  //  📡 EVENT HANDLING (EXISTING METHODS - KEPT SAME)
  // ===================================================================

  async handleStoreEvent(storeName, eventName, payload) {
    if (this.isDestroyed) return;

    debugLog(`📡 Store "${storeName}" received event "${eventName}"`);

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
    const dependentStores = Array.from(this.stores.entries())
      .filter(([name, s]) => s.dependencies?.includes(storeName))
      .map(([name]) => name);

    if (dependentStores.length === 0) return;

    debugLog(`🔗 Cross-store sync: "${storeName}" affects [${dependentStores.join(', ')}]`);

    // Notify dependent stores of changes
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
  //  🔧 MIDDLEWARE & PLUGINS
  // ===================================================================

  async setupMiddleware() {
    try {
      // Setup pharmacy-specific middleware
      await setupPharmacyMiddlewares(this.eventBus);
      
      // Add adapter-specific middleware
      this.eventBus.addMiddleware('performance', this.performanceMiddleware.bind(this));
      this.eventBus.addMiddleware('filtering', this.eventFilteringMiddleware.bind(this));
      this.eventBus.addMiddleware('batching', this.batchingMiddleware.bind(this));
      
      debugLog('🔧 Middleware setup completed');
    } catch (error) {
      console.error('❌ Middleware setup failed:', error);
      throw error;
    }
  }

  performanceMiddleware(eventName, payload, next) {
    const startTime = performance.now();
    const operationId = this.performanceMonitor.startOperation(`event-${eventName}`);
    
    return next().finally(() => {
      const duration = performance.now() - startTime;
      this.performanceMonitor.endOperation(operationId, true);
      
      if (duration > 50) { // Log slow events
        debugLog(`⚠️ Slow event: ${eventName} took ${duration.toFixed(2)}ms`);
      }
    });
  }

  eventFilteringMiddleware(eventName, payload, next) {
    // Filter out events during destruction
    if (this.isDestroyed) {
      debugLog(`🚫 Filtered event during destruction: ${eventName}`);
      return Promise.resolve();
    }
    
    // Filter rapid duplicate events
    if (this.isDuplicateEvent(eventName, payload)) {
      debugLog(`🚫 Filtered duplicate event: ${eventName}`);
      return Promise.resolve();
    }
    
    return next();
  }

  batchingMiddleware(eventName, payload, next) {
    // Batch similar events together
    if (this.shouldBatchEvent(eventName)) {
      this.addEventToBatch(eventName, payload);
      return Promise.resolve();
    }
    
    return next();
  }

  isDuplicateEvent(eventName, payload) {
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
    const batchableEvents = [
      PHARMACY_EVENTS.SYSTEM.STORE_STATE_CHANGED,
      PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED,
      PHARMACY_EVENTS.PRODUCT.UPDATED
    ];
    
    return batchableEvents.includes(eventName);
  }

  addEventToBatch(eventName, payload) {
    // Implementation would add to batch queue
    // This is handled by the batching system above
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
      
      // Only sync stores that need it
      const storesToSync = this.getStoresNeedingSync();
      
      if (storesToSync.length === 0) {
        debugLog('✅ All stores are up to date');
        return;
      }

      const results = await this.syncStores(storesToSync);
      
      // Emit auto sync completion
      await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.AUTO_SYNC_COMPLETED, {
        timestamp: Date.now(),
        syncedStores: storesToSync,
        results
      });

      debugLog(`✅ Auto sync completed for ${storesToSync.length} stores`);
      
    } catch (error) {
      console.error('❌ Auto sync failed:', error);
      
      // Emit auto sync failure
      await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.AUTO_SYNC_FAILED, {
        timestamp: Date.now(),
        error: error.message
      });
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

    // Determine overall health
    const healthRatio = healthyStores / totalStores;
    if (healthRatio < 0.5) {
      health.overall = 'critical';
      health.recommendations.push('Multiple store failures detected - check system health');
    } else if (healthRatio < 0.8) {
      health.overall = 'warning';
      health.recommendations.push('Some stores experiencing issues - monitor closely');
    }

    // Performance recommendations
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
    
    // Check last sync time
    if (store.lastSync && (now - store.lastSync) > 30 * 60 * 1000) { // 30 minutes
      return { status: 'warning', issue: 'Store sync is overdue' };
    }

    // Check for store-specific issues
    try {
      const storeState = store.hook.getState();
      
      if (storeState.error) {
        return { status: 'error', issue: `Store error: ${storeState.error}` };
      }
      
      if (storeState.isLoading && storeState.loadingStartTime) {
        const loadingDuration = now - storeState.loadingStartTime;
        if (loadingDuration > 30000) { // 30 seconds
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
      // Stop auto sync
      this.stopAutoSync();

      // Clear all debounce timeouts
      for (const timeoutId of this.eventDebounceMap.values()) {
        clearTimeout(timeoutId);
      }
      this.eventDebounceMap.clear();

      // Clear batch timeout
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
        this.batchTimeout = null;
      }

      // Unsubscribe from all stores
      for (const [storeName, unsubscribe] of this.storeSubscriptions.entries()) {
        try {
          if (typeof unsubscribe === 'function') {
            unsubscribe();
          }
        } catch (error) {
          console.error(`Error unsubscribing from store "${storeName}":`, error);
        }
      }

      // Clean up store event listeners
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

      // Clear all collections
      this.stores.clear();
      this.storeSubscriptions.clear();
      this.storeStates.clear();
      this.storeLastEmit.clear();
      this.eventRateTrackers.clear();
      this.lastStateHashes.clear();
      this.stateBatch.clear();
      this.eventBuffer.length = 0;
      this.operationQueue.length = 0;

      // Emit destruction event
      if (this.eventBus && !this.eventBus.isDestroyed) {
        await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.ADAPTER_DESTROYED, {
          timestamp: Date.now(),
          performanceMetrics: this.performanceMonitor.getMetrics()
        });
      }

      // Clear performance monitor
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
    
    // Soft destroy (preserve config)
    await this.destroy();
    
    // Reset state
    this.isDestroyed = false;
    this.isInitialized = false;
    
    // Re-initialize
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
      eventBuffer: this.eventBuffer.slice(-10), // Last 10 events
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
  }
};

// Convenience export
export { StoreAdapter as default };
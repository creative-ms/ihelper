//src/utils/eventBus.js
// ===================================================================
//  🚀 COMPREHENSIVE PHARMACY EVENT BUS ARCHITECTURE
//  Features: Event Bus + Transaction Rollback + Cleanup + Performance + Pharmacy-Specific Events
// ===================================================================

// --- Core Event Bus with Transaction Support ---
class EventBus {
  constructor() {
    this.listeners = new Map();
    this.onceListeners = new Map();
    this.middlewares = [];
    this.transactions = new Map();
    this.eventHistory = [];
    this.maxHistorySize = 1000;
    this.isDestroyed = false;
    
    // Performance tracking
    this.metrics = {
      eventsEmitted: 0,
      listenersRegistered: 0,
      transactionsCreated: 0,
      rollbacksExecuted: 0
    };
    
    // Cleanup tracking
    this.cleanupTasks = new Set();
    this.intervals = new Set();
    this.timeouts = new Set();
    
    // Auto-cleanup old history
    this.setupHistoryCleanup();
  }

  // =================================================================
  //  📡 CORE EVENT SYSTEM
  // =================================================================

  /**
   * Subscribe to an event
   */
  on(eventName, listener, options = {}) {
    if (this.isDestroyed) {
      console.warn('EventBus: Cannot register listener on destroyed bus');
      return () => {};
    }

    const { priority = 0, once = false, context = null } = options;
    
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    
    const wrappedListener = {
      fn: listener,
      priority,
      context,
      id: this.generateId(),
      createdAt: Date.now()
    };
    
    if (once) {
      if (!this.onceListeners.has(eventName)) {
        this.onceListeners.set(eventName, []);
      }
      this.onceListeners.get(eventName).push(wrappedListener);
    } else {
      this.listeners.get(eventName).push(wrappedListener);
      this.listeners.get(eventName).sort((a, b) => b.priority - a.priority);
    }
    
    this.metrics.listenersRegistered++;
    
    // Return unsubscribe function
    return () => this.off(eventName, wrappedListener.id);
  }

  /**
   * Subscribe to an event once
   */
  once(eventName, listener, options = {}) {
    return this.on(eventName, listener, { ...options, once: true });
  }

  /**
   * Unsubscribe from an event
   */
  off(eventName, listenerId) {
    if (this.isDestroyed) return;

    // Remove from regular listeners
    if (this.listeners.has(eventName)) {
      const listeners = this.listeners.get(eventName);
      const index = listeners.findIndex(l => l.id === listenerId);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this.listeners.delete(eventName);
        }
      }
    }
    
    // Remove from once listeners
    if (this.onceListeners.has(eventName)) {
      const listeners = this.onceListeners.get(eventName);
      const index = listeners.findIndex(l => l.id === listenerId);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this.onceListeners.delete(eventName);
        }
      }
    }
  }

  /**
   * Emit an event with transaction support
   */
  async emit(eventName, payload = {}, options = {}) {
    if (this.isDestroyed) {
      console.warn('EventBus: Cannot emit on destroyed bus');
      return { success: false, error: 'Bus destroyed' };
    }

    const { 
      transactionId = null, 
      rollbackData = null,
      priority = 0,
      timeout = 5000 
    } = options;

    const event = {
      id: this.generateId(),
      name: eventName,
      payload,
      timestamp: Date.now(),
      transactionId,
      rollbackData,
      priority,
      results: []
    };

    try {
      // Apply middlewares
      for (const middleware of this.middlewares) {
        const result = await middleware(event);
        if (result === false) {
          return { success: false, error: 'Blocked by middleware' };
        }
      }

      // Execute listeners with timeout
      const executionPromise = this.executeListeners(event);
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Event "${eventName}" timed out after ${timeout}ms`));
        }, timeout);
        this.timeouts.add(timeoutId);
      });

      await Promise.race([executionPromise, timeoutPromise]);

      // Add to history
      this.addToHistory(event);
      this.metrics.eventsEmitted++;

      return { 
        success: true, 
        eventId: event.id, 
        results: event.results,
        listenersExecuted: event.results.length
      };

    } catch (error) {
      console.error(`EventBus: Error emitting "${eventName}":`, error);
      
      // Auto-rollback on error if transaction is active
      if (transactionId && rollbackData) {
        await this.rollbackTransaction(transactionId);
      }
      
      return { success: false, error: error.message, eventId: event.id };
    }
  }

  /**
   * Execute listeners for an event
   */
  async executeListeners(event) {
    const { name: eventName } = event;
    const allListeners = [];

    // Collect regular listeners
    if (this.listeners.has(eventName)) {
      allListeners.push(...this.listeners.get(eventName));
    }

    // Collect once listeners
    if (this.onceListeners.has(eventName)) {
      const onceListeners = this.onceListeners.get(eventName);
      allListeners.push(...onceListeners);
      // Clear once listeners
      this.onceListeners.delete(eventName);
    }

    // Sort by priority
    allListeners.sort((a, b) => b.priority - a.priority);

    // Execute listeners
    for (const listener of allListeners) {
      try {
        const result = await this.executeListener(listener, event);
        event.results.push({
          listenerId: listener.id,
          success: true,
          result,
          executedAt: Date.now()
        });
      } catch (error) {
        event.results.push({
          listenerId: listener.id,
          success: false,
          error: error.message,
          executedAt: Date.now()
        });
        console.error(`EventBus: Listener error for "${eventName}":`, error);
      }
    }
  }

  /**
   * Execute a single listener
   */
  async executeListener(listener, event) {
    const { fn, context } = listener;
    
    if (context) {
      return await fn.call(context, event.payload, event);
    } else {
      return await fn(event.payload, event);
    }
  }

  // =================================================================
  //  🔄 TRANSACTION & ROLLBACK SYSTEM
  // =================================================================

  /**
   * Start a new transaction
   */
  startTransaction(transactionId = null) {
    const id = transactionId || this.generateId();
    
    if (this.transactions.has(id)) {
      throw new Error(`Transaction ${id} already exists`);
    }

    const transaction = {
      id,
      startTime: Date.now(),
      events: [],
      rollbackActions: [],
      status: 'active', // active, committed, rolled_back
      metadata: {}
    };

    this.transactions.set(id, transaction);
    this.metrics.transactionsCreated++;
    
    console.log(`🔄 Transaction started: ${id}`);
    return id;
  }

  /**
   * Add rollback action to transaction
   */
  addRollbackAction(transactionId, rollbackFn, description = '') {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (transaction.status !== 'active') {
      throw new Error(`Cannot add rollback action to ${transaction.status} transaction`);
    }

    transaction.rollbackActions.push({
      id: this.generateId(),
      fn: rollbackFn,
      description,
      addedAt: Date.now()
    });
  }

  /**
   * Commit a transaction
   */
  async commitTransaction(transactionId) {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (transaction.status !== 'active') {
      throw new Error(`Cannot commit ${transaction.status} transaction`);
    }

    try {
      // Emit commit event
      await this.emit('transaction:commit', {
        transactionId,
        events: transaction.events,
        duration: Date.now() - transaction.startTime
      });

      transaction.status = 'committed';
      transaction.commitTime = Date.now();
      
      console.log(`✅ Transaction committed: ${transactionId}`);
      return { success: true, transactionId };

    } catch (error) {
      console.error(`❌ Transaction commit failed: ${transactionId}`, error);
      await this.rollbackTransaction(transactionId);
      throw error;
    }
  }

  /**
   * Rollback a transaction
   */
  async rollbackTransaction(transactionId) {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (transaction.status === 'rolled_back') {
      console.warn(`Transaction ${transactionId} already rolled back`);
      return { success: true, transactionId };
    }

    try {
      console.log(`🔄 Rolling back transaction: ${transactionId}`);
      
      // Execute rollback actions in reverse order
      const rollbackActions = [...transaction.rollbackActions].reverse();
      const rollbackResults = [];

      for (const action of rollbackActions) {
        try {
          const result = await action.fn();
          rollbackResults.push({
            actionId: action.id,
            success: true,
            result,
            description: action.description
          });
        } catch (error) {
          rollbackResults.push({
            actionId: action.id,
            success: false,
            error: error.message,
            description: action.description
          });
          console.error(`Rollback action failed:`, error);
        }
      }

      transaction.status = 'rolled_back';
      transaction.rollbackTime = Date.now();
      transaction.rollbackResults = rollbackResults;
      
      this.metrics.rollbacksExecuted++;

      // Emit rollback event
      await this.emit('transaction:rollback', {
        transactionId,
        rollbackResults,
        duration: Date.now() - transaction.startTime
      });

      console.log(`🔄 Transaction rolled back: ${transactionId}`);
      return { success: true, transactionId, rollbackResults };

    } catch (error) {
      console.error(`❌ Transaction rollback failed: ${transactionId}`, error);
      return { success: false, transactionId, error: error.message };
    }
  }

  /**
   * Get transaction status
   */
  getTransaction(transactionId) {
    return this.transactions.get(transactionId) || null;
  }

  /**
   * Clean up old transactions
   */
  cleanupTransactions(olderThanMs = 24 * 60 * 60 * 1000) { // 24 hours
    const cutoffTime = Date.now() - olderThanMs;
    let cleanedCount = 0;

    for (const [id, transaction] of this.transactions.entries()) {
      if (transaction.startTime < cutoffTime && transaction.status !== 'active') {
        this.transactions.delete(id);
        cleanedCount++;
      }
    }

    console.log(`🧹 Cleaned up ${cleanedCount} old transactions`);
    return cleanedCount;
  }

  // =================================================================
  //  🧹 CLEANUP & MEMORY MANAGEMENT
  // =================================================================

  /**
   * Register a cleanup task
   */
  registerCleanup(cleanupFn, description = '') {
    const task = {
      id: this.generateId(),
      fn: cleanupFn,
      description,
      registeredAt: Date.now()
    };
    
    this.cleanupTasks.add(task);
    return task.id;
  }

  /**
   * Execute all cleanup tasks
   */
  async executeCleanup() {
    console.log(`🧹 Executing ${this.cleanupTasks.size} cleanup tasks...`);
    
    const results = [];
    
    for (const task of this.cleanupTasks) {
      try {
        await task.fn();
        results.push({ taskId: task.id, success: true, description: task.description });
      } catch (error) {
        results.push({ 
          taskId: task.id, 
          success: false, 
          error: error.message, 
          description: task.description 
        });
        console.error(`Cleanup task failed:`, error);
      }
    }
    
    // Clear timeouts and intervals
    this.timeouts.forEach(id => clearTimeout(id));
    this.intervals.forEach(id => clearInterval(id));
    this.timeouts.clear();
    this.intervals.clear();
    
    console.log(`✅ Cleanup completed: ${results.filter(r => r.success).length}/${results.length} tasks successful`);
    return results;
  }

  /**
   * Setup automatic history cleanup
   */
  setupHistoryCleanup() {
    const intervalId = setInterval(() => {
      if (this.eventHistory.length > this.maxHistorySize) {
        const excess = this.eventHistory.length - this.maxHistorySize;
        this.eventHistory.splice(0, excess);
        console.log(`🧹 Cleaned up ${excess} old events from history`);
      }
    }, 60000); // Every minute
    
    this.intervals.add(intervalId);
  }

  /**
   * Add event to history
   */
  addToHistory(event) {
    this.eventHistory.push({
      ...event,
      historySavedAt: Date.now()
    });
  }

  /**
   * Clear event history
   */
  clearHistory() {
    const count = this.eventHistory.length;
    this.eventHistory.length = 0;
    console.log(`🧹 Cleared ${count} events from history`);
    return count;
  }

  /**
   * Destroy the event bus
   */
  async destroy() {
    if (this.isDestroyed) return;
    
    console.log('🧹 Destroying EventBus...');
    
    // Rollback all active transactions
    const activeTransactions = Array.from(this.transactions.values())
      .filter(t => t.status === 'active');
    
    for (const transaction of activeTransactions) {
      await this.rollbackTransaction(transaction.id);
    }
    
    // Execute cleanup tasks
    await this.executeCleanup();
    
    // Clear all data structures
    this.listeners.clear();
    this.onceListeners.clear();
    this.middlewares.length = 0;
    this.transactions.clear();
    this.eventHistory.length = 0;
    this.cleanupTasks.clear();
    
    this.isDestroyed = true;
    console.log('✅ EventBus destroyed');
  }

  // =================================================================
  //  🔧 MIDDLEWARE & UTILITIES
  // =================================================================

  /**
   * Add middleware
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.middlewares.push(middleware);
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get event bus metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeListeners: Array.from(this.listeners.values()).reduce((sum, listeners) => sum + listeners.length, 0),
      activeTransactions: Array.from(this.transactions.values()).filter(t => t.status === 'active').length,
      historySize: this.eventHistory.length,
      cleanupTasks: this.cleanupTasks.size
    };
  }

  /**
   * Get health status
   */
  getHealth() {
    return {
      isHealthy: !this.isDestroyed,
      uptime: Date.now(),
      metrics: this.getMetrics(),
      status: this.isDestroyed ? 'destroyed' : 'active'
    };
  }
}

// =================================================================
//  🏪 COMPREHENSIVE PHARMACY EVENT DEFINITIONS
// =================================================================

export const PHARMACY_EVENTS = {
  // Core Inventory Events
  INVENTORY: {
    PRODUCT_ADDED: 'inventory:product:added',
    PRODUCT_UPDATED: 'inventory:product:updated',
    PRODUCT_DELETED: 'inventory:product:deleted',
    BATCH_ADDED: 'inventory:batch:added',
    BATCH_UPDATED: 'inventory:batch:updated',
    BATCH_REMOVED: 'inventory:batch:removed',
    STOCK_LOW: 'inventory:stock:low',
    STOCK_OUT: 'inventory:stock:out',
    STOCK_RESERVED: 'inventory:stock:reserved',
    STOCK_RELEASED: 'inventory:stock:released',
    STOCK_REDUCED: 'inventory:stock:reduced',
    STOCK_RESTORED: 'inventory:stock:restored',
    EXPIRY_WARNING: 'inventory:expiry:warning',
    SYNC_REQUIRED: 'inventory:sync:required'
  },

  // Sales Events
  SALES: {
    SALE_STARTED: 'sales:sale:started',
    ITEM_ADDED: 'sales:item:added',
    ITEM_REMOVED: 'sales:item:removed',
    DISCOUNT_APPLIED: 'sales:discount:applied',
    SALE_COMPLETED: 'sales:sale:completed',
    SALE_CANCELLED: 'sales:sale:cancelled',
    REFUND_PROCESSED: 'sales:refund:processed',
    PAYMENT_RECEIVED: 'sales:payment:received'
  },

  // Customer Events
  CUSTOMER: {
    CREATED: 'customer:created',
    UPDATED: 'customer:updated',
    DELETED: 'customer:deleted',
    BALANCE_UPDATED: 'customer:balance:updated',
    PAYMENT_MADE: 'customer:payment:made'
  },

  // Cart Events
  CART: {
    ITEM_ADDED: 'cart:item:added',
    ITEM_REMOVED: 'cart:item:removed',
    QUANTITY_CHANGED: 'cart:quantity:changed',
    CLEARED: 'cart:cleared',
    CUSTOMER_SELECTED: 'cart:customer:selected',
    VALIDATION_FAILED: 'cart:validation:failed',
    PRICE_OVERRIDDEN: 'cart:price:overridden',
    BULK_DISCOUNT_APPLIED: 'cart:bulk_discount:applied',
    CUSTOMER_DISCOUNT_APPLIED: 'cart:customer_discount:applied',
    TAX_CALCULATED: 'cart:tax:calculated',
    TOTAL_RECALCULATED: 'cart:total:recalculated'
  },

  // 🔋 HARDWARE EVENTS (for POS systems)
  HARDWARE: {
    BATTERY_LOW: 'hardware:battery:low',
    BATTERY_CRITICAL: 'hardware:battery:critical',
    PRINTER_OFFLINE: 'hardware:printer:offline',
    PRINTER_ONLINE: 'hardware:printer:online',
    BARCODE_SCANNER_CONNECTED: 'hardware:scanner:connected',
    BARCODE_SCANNER_DISCONNECTED: 'hardware:scanner:disconnected',
    CASH_DRAWER_OPENED: 'hardware:cash_drawer:opened',
    CASH_DRAWER_CLOSED: 'hardware:cash_drawer:closed'
  },

  // 🔐 USER & AUTHENTICATION EVENTS
  USER: {
    LOGIN: 'user:login',
    LOGOUT: 'user:logout',
    SESSION_EXPIRED: 'user:session:expired',
    PERMISSION_DENIED: 'user:permission:denied',
    PRIVILEGE_UPDATED: 'user:privilege:updated',
    PASSWORD_CHANGED: 'user:password:changed',
    PIN_CHANGED: 'user:pin:changed',
    FAILED_LOGIN_ATTEMPT: 'user:login:failed'
  },

  // 🏪 STORE & SETTINGS EVENTS
  STORE: {
    SETTINGS_UPDATED: 'store:settings:updated',
    THEME_CHANGED: 'store:theme:changed',
    POS_VIEW_CHANGED: 'store:pos_view:changed',
    PAYMENT_METHODS_UPDATED: 'store:payment_methods:updated',
    ROLE_PRIVILEGES_UPDATED: 'store:role_privileges:updated',
    STORE_OPENING: 'store:opening',
    STORE_CLOSING: 'store:closing'
  },

  // 💾 DATA SYNCHRONIZATION EVENTS
  SYNC: {
    STARTED: 'sync:started',
    COMPLETED: 'sync:completed',
    FAILED: 'sync:failed',
    CONFLICT_DETECTED: 'sync:conflict:detected',
    CONFLICT_RESOLVED: 'sync:conflict:resolved',
    OFFLINE_CHANGES_QUEUED: 'sync:offline:queued',
    OFFLINE_CHANGES_SYNCED: 'sync:offline:synced'
  },

  // 📊 DASHBOARD & ANALYTICS EVENTS
  DASHBOARD: {
    INITIALIZED: 'dashboard:initialized',
    DEACTIVATED: 'dashboard:deactivated',
    DATA_REFRESHED: 'dashboard:data:refreshed',
    CACHE_CLEARED: 'dashboard:cache:cleared',
    FILTER_CHANGED: 'dashboard:filter:changed',
    EXPORT_REQUESTED: 'dashboard:export:requested',
    REPORT_GENERATED: 'dashboard:report:generated'
  },

  // 🏷️ ENHANCED PRODUCT EVENTS
  PRODUCT: {
    BARCODE_SCANNED: 'product:barcode:scanned',
    UNIT_CONVERSION_APPLIED: 'product:unit:converted',
    EXPIRY_CHECK_PERFORMED: 'product:expiry:checked',
    BATCH_EXPIRED: 'product:batch:expired',
    BATCH_EXPIRING_SOON: 'product:batch:expiring_soon',
    FEFO_APPLIED: 'product:fefo:applied',
    PRICE_UPDATED: 'product:price:updated',
    DISCOUNT_APPLIED: 'product:discount:applied'
  },

  // 💰 FINANCIAL EVENTS
  FINANCE: {
    CASH_COUNTED: 'finance:cash:counted',
    TILL_OPENED: 'finance:till:opened',
    TILL_CLOSED: 'finance:till:closed',
    DAILY_SALES_CALCULATED: 'finance:daily_sales:calculated',
    PROFIT_CALCULATED: 'finance:profit:calculated',
    LOSS_RECORDED: 'finance:loss:recorded',
    EXPENSE_RECORDED: 'finance:expense:recorded'
  },

  // 📋 AUDIT & COMPLIANCE EVENTS
  AUDIT: {
    TRANSACTION_LOGGED: 'audit:transaction:logged',
    USER_ACTION_LOGGED: 'audit:user_action:logged',
    SYSTEM_EVENT_LOGGED: 'audit:system_event:logged',
    COMPLIANCE_CHECK_PERFORMED: 'audit:compliance:checked',
    SUSPICIOUS_ACTIVITY_DETECTED: 'audit:suspicious:detected',
    DATA_INTEGRITY_CHECK: 'audit:data_integrity:checked'
  },

  // 🔄 PURCHASE & SUPPLIER EVENTS
  PURCHASE: {
    ORDER_CREATED: 'purchase:order:created',
    ORDER_SENT_TO_SUPPLIER: 'purchase:order:sent',
    DELIVERY_RECEIVED: 'purchase:delivery:received',
    QUALITY_CHECK_PERFORMED: 'purchase:quality:checked',
    RETURN_INITIATED: 'purchase:return:initiated',
    RETURN_COMPLETED: 'purchase:return:completed',
    SUPPLIER_PAYMENT_DUE: 'purchase:payment:due',
    SUPPLIER_BALANCE_UPDATED: 'purchase:supplier:balance_updated'
  },

  // 🏥 PRESCRIPTION & REGULATORY EVENTS
  PRESCRIPTION: {
    UPLOADED: 'prescription:uploaded',
    VERIFIED: 'prescription:verified',
    DISPENSED: 'prescription:dispensed',
    CONTROLLED_SUBSTANCE_DISPENSED: 'prescription:controlled:dispensed',
    INSURANCE_CLAIMED: 'prescription:insurance:claimed',
    DOCTOR_CONSULTED: 'prescription:doctor:consulted'
  },

  // 🚨 ALERT & NOTIFICATION EVENTS
  ALERTS: {
    LOW_STOCK_ALERT: 'alert:stock:low',
    OUT_OF_STOCK_ALERT: 'alert:stock:out',
    EXPIRY_ALERT: 'alert:expiry:warning',
    PRICE_CHANGE_ALERT: 'alert:price:changed',
    SYSTEM_ERROR_ALERT: 'alert:system:error',
    BACKUP_ALERT: 'alert:backup:required',
    SECURITY_ALERT: 'alert:security:breach'
  },

  // 🌐 NETWORK & CONNECTIVITY EVENTS
  NETWORK: {
    ONLINE: 'network:online',
    OFFLINE: 'network:offline',
    CONNECTION_SLOW: 'network:slow',
    DATABASE_CONNECTED: 'network:database:connected',
    DATABASE_DISCONNECTED: 'network:database:disconnected',
    API_TIMEOUT: 'network:api:timeout',
    SYNC_SERVER_UNAVAILABLE: 'network:sync:unavailable'
  },

  // System Events
  SYSTEM: {
    CACHE_UPDATED: 'system:cache:updated',
    SYNC_STARTED: 'system:sync:started',
    SYNC_COMPLETED: 'system:sync:completed',
    ERROR_OCCURRED: 'system:error:occurred',
    PERFORMANCE_WARNING: 'system:performance:warning'
  }
};

// =================================================================
//  🔄 ENHANCED TRANSACTION MANAGER FOR PHARMACY OPERATIONS
// =================================================================

export class PharmacyTransactionManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.setupEnhancedListeners();
  }

  setupEnhancedListeners() {
    // Listen for authentication events
    this.eventBus.on(PHARMACY_EVENTS.USER.LOGIN, async (payload) => {
      await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.USER_ACTION_LOGGED, {
        action: 'USER_LOGIN',
        userId: payload.userId,
        userName: payload.userName,
        timestamp: Date.now()
      });
    });

    // Listen for inventory changes to trigger alerts
    this.eventBus.on(PHARMACY_EVENTS.INVENTORY.STOCK_LOW, async (payload) => {
      await this.eventBus.emit(PHARMACY_EVENTS.ALERTS.LOW_STOCK_ALERT, {
        productId: payload.productId,
        productName: payload.productName,
        currentStock: payload.currentStock,
        minimumLevel: payload.minimumLevel
      });
    });

    // Listen for expiry warnings
    this.eventBus.on(PHARMACY_EVENTS.PRODUCT.BATCH_EXPIRING_SOON, async (payload) => {
      await this.eventBus.emit(PHARMACY_EVENTS.ALERTS.EXPIRY_ALERT, {
        productId: payload.productId,
        batchNumber: payload.batchNumber,
        expiryDate: payload.expiryDate,
        daysRemaining: payload.daysRemaining
      });
    });
  }

  /**
   * Execute a sale transaction with rollback capability
   */
  async executeSaleTransaction(saleData, options = {}) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { items, customer, payment } = saleData;
      
      // Step 1: Reserve inventory
      await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_RESERVED, {
        items,
        reservedBy: transactionId
      }, { transactionId });
      
      // Add rollback for inventory reservation
      this.eventBus.addRollbackAction(transactionId, async () => {
        await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_RELEASED, {
          items,
          reservedBy: transactionId
        });
      }, 'Release reserved inventory');

      // Step 2: Process payment
      if (customer && payment.amount < saleData.total) {
        await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
          customerId: customer._id,
          amount: saleData.total - payment.amount,
          type: 'charge'
        }, { transactionId });
        
        // Add rollback for customer balance
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
            customerId: customer._id,
            amount: -(saleData.total - payment.amount),
            type: 'credit'
          });
        }, 'Reverse customer balance change');
      }

      // Step 3: Update inventory
      await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_REDUCED, {
        items,
        transactionId
      }, { transactionId });

      // Step 4: Record sale
      const saleResult = await this.eventBus.emit(PHARMACY_EVENTS.SALES.SALE_COMPLETED, {
        ...saleData,
        transactionId
      }, { transactionId });

      // Commit transaction
      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, transactionId, saleResult };

    } catch (error) {
      console.error('Sale transaction failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message, transactionId };
    }
  }

  /**
   * Execute a refund transaction with rollback capability
   */
  async executeRefundTransaction(refundData) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { originalSaleId, items, customer, refundAmount } = refundData;
      
      // Step 1: Restore inventory
      await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_RESTORED, {
        items,
        originalSaleId,
        transactionId
      }, { transactionId });
      
      // Add rollback for inventory restoration
      this.eventBus.addRollbackAction(transactionId, async () => {
        await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_REDUCED, {
          items,
          transactionId
        });
      }, 'Re-reduce inventory after failed refund');

      // Step 2: Update customer balance
      if (customer) {
        await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
          customerId: customer._id,
          amount: -refundAmount,
          type: 'credit'
        }, { transactionId });
        
        // Add rollback for customer balance
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
            customerId: customer._id,
            amount: refundAmount,
            type: 'charge'
          });
        }, 'Reverse refund balance change');
      }

      // Step 3: Record refund
      const refundResult = await this.eventBus.emit(PHARMACY_EVENTS.SALES.REFUND_PROCESSED, {
        ...refundData,
        transactionId
      }, { transactionId });

      // Commit transaction
      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, transactionId, refundResult };

    } catch (error) {
      console.error('Refund transaction failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message, transactionId };
    }
  }

  /**
   * Enhanced sale transaction with comprehensive audit trail
   */
  async executeSaleTransactionWithAudit(saleData, options = {}) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      // Log transaction start
      await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
        transactionId,
        type: 'SALE_START',
        details: { customerId: saleData.customer?._id, itemCount: saleData.items.length }
      }, { transactionId });

      // Execute the sale
      const result = await this.executeSaleTransaction(saleData, options);

      // Log successful completion
      if (result.success) {
        await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
          transactionId,
          type: 'SALE_COMPLETED',
          details: { total: saleData.total, paymentMethod: saleData.payment.method }
        }, { transactionId });
      }

      return result;

    } catch (error) {
      // Log error
      await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
        transactionId,
        type: 'SALE_ERROR',
        error: error.message
      }, { transactionId });
      
      throw error;
    }
  }

  /**
   * Purchase transaction with supplier integration
   */
  async executePurchaseTransaction(purchaseData) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { items, supplier, totals, amountPaid } = purchaseData;
      
      // Step 1: Validate purchase data
      await this.eventBus.emit(PHARMACY_EVENTS.PURCHASE.ORDER_CREATED, {
        supplierId: supplier._id,
        items,
        total: totals.grandTotal
      }, { transactionId });

      // Step 2: Update inventory
      for (const item of items) {
        await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.BATCH_ADDED, {
          productId: item.productId,
          batchData: {
            batchNumber: item.batchNumber,
            quantity: item.qty,
            purchasePrice: item.rate,
            retailPrice: item.retailPrice,
            expiryDate: item.expDate
          }
        }, { transactionId });

        // Add rollback for inventory
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.BATCH_REMOVED, {
            productId: item.productId,
            batchNumber: item.batchNumber
          });
        }, `Remove batch ${item.batchNumber} for product ${item.productId}`);
      }

      // Step 3: Update supplier balance
      const amountDue = totals.grandTotal - amountPaid;
      if (amountDue > 0) {
        await this.eventBus.emit(PHARMACY_EVENTS.PURCHASE.SUPPLIER_BALANCE_UPDATED, {
          supplierId: supplier._id,
          amount: amountDue,
          type: 'purchase'
        }, { transactionId });

        // Add rollback for supplier balance
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.PURCHASE.SUPPLIER_BALANCE_UPDATED, {
            supplierId: supplier._id,
            amount: -amountDue,
            type: 'adjustment'
          });
        }, 'Reverse supplier balance change');
      }

      // Commit transaction
      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, transactionId };

    } catch (error) {
      console.error('Purchase transaction failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message, transactionId };
    }
  }

  /**
   * Daily cash reconciliation transaction
   */
  async executeDailyCashReconciliation(reconciliationData) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { expectedCash, actualCash, userId, notes } = reconciliationData;
      const variance = actualCash - expectedCash;

      // Open till
      await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.TILL_OPENED, {
        userId,
        expectedCash,
        timestamp: Date.now()
      }, { transactionId });

      // Count cash
      await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.CASH_COUNTED, {
        userId,
        actualCash,
        variance,
        notes
      }, { transactionId });

      // Handle variance
      if (Math.abs(variance) > 0.01) { // More than 1 cent difference
        if (variance > 0) {
          await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.PROFIT_CALCULATED, {
            amount: variance,
            type: 'cash_overage',
            reconciliationId: transactionId
          }, { transactionId });
        } else {
          await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.LOSS_RECORDED, {
            amount: Math.abs(variance),
            type: 'cash_shortage',
            reconciliationId: transactionId
          }, { transactionId });
        }
      }

      // Close till
      await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.TILL_CLOSED, {
        userId,
        finalCash: actualCash,
        variance,
        timestamp: Date.now()
      }, { transactionId });

      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, variance, transactionId };

    } catch (error) {
      console.error('Cash reconciliation failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message };
    }
  }
}

// =================================================================
//  🔌 MIDDLEWARE FOR PHARMACY OPERATIONS
// =================================================================

/**
 * Authentication middleware
 */
export const authenticationMiddleware = async (event) => {
  const protectedEvents = [
    'sales:sale:completed',
    'inventory:product:deleted',
    'customer:balance:updated',
    'purchase:return:completed'
  ];

  if (protectedEvents.includes(event.name)) {
    // Check if user has permission
    const userStore = window.useAuthStore?.getState?.();
    if (!userStore?.isAuthenticated) {
      console.warn(`Blocked ${event.name}: User not authenticated`);
      return false;
    }
  }
  
  return true; // Allow event to proceed
};

/**
 * Audit logging middleware
 */
export const auditLoggingMiddleware = async (event) => {
  const auditableEvents = [
    'sales:sale:completed',
    'inventory:product:added',
    'inventory:product:updated',
    'inventory:product:deleted',
    'customer:created',
    'customer:updated',
    'user:login',
    'user:logout'
  ];

  if (auditableEvents.includes(event.name)) {
    // Log to audit store
    const auditStore = window.useAuditStore?.getState?.();
    if (auditStore?.logEvent) {
      auditStore.logEvent({
        eventType: event.name.toUpperCase().replace(/:/g, '_'),
        details: event.payload,
        eventId: event.id,
        transactionId: event.transactionId
      });
    }
  }
  
  return true;
};

/**
 * Performance monitoring middleware
 */
export const performanceMiddleware = async (event) => {
  const startTime = Date.now();
  
  // Add performance tracking to event
  event.performanceStart = startTime;
  
  // Log slow events
  setTimeout(() => {
    const duration = Date.now() - startTime;
    if (duration > 1000) { // Events taking more than 1 second
      console.warn(`Slow event detected: ${event.name} took ${duration}ms`);
    }
  }, 0);
  
  return true;
};

// =================================================================
//  🏗️ ENHANCED FACTORY WITH STORE INTEGRATIONS
// =================================================================

export function createPharmacyEventBus() {
  const eventBus = new EventBus();
  const transactionManager = new PharmacyTransactionManager(eventBus);
  
  // Setup enhanced middlewares
  eventBus.use(authenticationMiddleware);
  eventBus.use(auditLoggingMiddleware);
  eventBus.use(performanceMiddleware);
  
  // Setup pharmacy-specific middlewares
  eventBus.use(async (event) => {
    // Performance monitoring middleware
    if (event.name.includes('inventory') || event.name.includes('sales')) {
      console.log(`📊 Processing ${event.name} with ${event.payload ? Object.keys(event.payload).length : 0} payload keys`);
    }
    return true;
  });

  // Setup cleanup tasks
  eventBus.registerCleanup(async () => {
    // Clear any temporary caches
    if (window.pharmacyTempCache) {
      window.pharmacyTempCache.clear();
    }
  }, 'Clear temporary pharmacy cache');

  eventBus.registerCleanup(async () => {
    // Close any open database connections
    if (window.pharmacyDB) {
      await window.pharmacyDB.close();
    }
  }, 'Close pharmacy database connections');

  // Setup automatic transaction cleanup
  const cleanupInterval = setInterval(() => {
    eventBus.cleanupTransactions();
  }, 60 * 60 * 1000); // Every hour

  eventBus.registerCleanup(async () => {
    clearInterval(cleanupInterval);
  }, 'Clear transaction cleanup interval');

  // Setup store-specific listeners
  setupStoreListeners(eventBus);

  return {
    eventBus,
    transactionManager,
    events: PHARMACY_EVENTS
  };
}

/**
 * Setup listeners for your Zustand stores
 */
function setupStoreListeners(eventBus) {
  // Dashboard store listeners
  eventBus.on(PHARMACY_EVENTS.DASHBOARD.INITIALIZED, async () => {
    console.log('📊 Dashboard initialized');
  });

  // Settings store listeners
  eventBus.on(PHARMACY_EVENTS.STORE.SETTINGS_UPDATED, async (payload) => {
    console.log('⚙️ Store settings updated:', payload.settingType);
  });

  // Network status listeners
  eventBus.on(PHARMACY_EVENTS.NETWORK.OFFLINE, async () => {
    // Handle offline mode
    console.warn('📡 System went offline - enabling offline mode');
  });

  eventBus.on(PHARMACY_EVENTS.NETWORK.ONLINE, async () => {
    // Handle reconnection
    console.log('📡 System back online - syncing data');
    eventBus.emit(PHARMACY_EVENTS.SYNC.STARTED, {
      reason: 'reconnection',
      timestamp: Date.now()
    });
  });
}

// =================================================================
//  📋 USAGE EXAMPLES FOR YOUR PHARMACY SOFTWARE
// =================================================================

/*
// Initialize the event bus
const { eventBus, transactionManager, events } = createPharmacyEventBus();

// Example 1: Listen to inventory changes
const unsubscribe = eventBus.on(events.INVENTORY.PRODUCT_ADDED, async (payload) => {
  console.log('New product added:', payload.product.name);
  
  // Update UI cache
  await updateProductCache(payload.product);
  
  // Sync with search engine
  await syncToMeilisearch(payload.product);
});

// Example 2: Execute a sale with rollback capability
const saleResult = await transactionManager.executeSaleTransaction({
  items: cartItems,
  customer: selectedCustomer,
  payment: { amount: 100, method: 'cash' },
  total: 120
});

if (!saleResult.success) {
  console.error('Sale failed and was rolled back:', saleResult.error);
}

// Example 3: Use transactions for complex operations
const transactionId = eventBus.startTransaction();

try {
  // Emit events within transaction
  await eventBus.emit(events.CART.ITEM_ADDED, { 
    productId: 'prod-123', 
    quantity: 2 
  }, { transactionId });
  
  await eventBus.emit(events.INVENTORY.STOCK_REDUCED, { 
    productId: 'prod-123', 
    quantity: 2 
  }, { transactionId });
  
  // Commit if all went well
  await eventBus.commitTransaction(transactionId);
} catch (error) {
  // Auto-rollback on error
  await eventBus.rollbackTransaction(transactionId);
}

// Example 4: Enhanced purchase workflow
const purchaseResult = await transactionManager.executePurchaseTransaction({
  items: purchaseItems,
  supplier: selectedSupplier,
  totals: calculatedTotals,
  amountPaid: paidAmount
});

// Example 5: Daily reconciliation
const reconciliationResult = await transactionManager.executeDailyCashReconciliation({
  expectedCash: 1500.00,
  actualCash: 1498.50,
  userId: currentUser._id,
  notes: "Missing 2 coins"
});

// Example 6: Integration with your cartStore
eventBus.on(events.CART.ITEM_ADDED, async (payload) => {
  // Check stock availability
  const stockCheck = checkStockAvailability(
    payload.product, 
    payload.currentQuantity, 
    payload.addedQuantity
  );
  
  if (!stockCheck) {
    await eventBus.emit(events.ALERTS.LOW_STOCK_ALERT, {
      productId: payload.product._id,
      productName: payload.product.name
    });
  }
});

// Example 7: Cleanup when app closes
window.addEventListener('beforeunload', async () => {
  await eventBus.destroy();
});
*/

export default EventBus;
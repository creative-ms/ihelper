//src/utils/eventBus/core/EventBus.js
// ===================================================================
//  🚀 CORE EVENT BUS ARCHITECTURE
//  Features: Event Bus + Transaction Rollback + Cleanup + Performance
// ===================================================================

export class EventBus {
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
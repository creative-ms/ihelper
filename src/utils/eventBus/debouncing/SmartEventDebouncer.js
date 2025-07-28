// src/utils/eventBus/debouncing/SmartEventDebouncer.js
// ===================================================================
//  🎯 SMART EVENT DEBOUNCING SYSTEM
//  Features: Intelligent debouncing + Event coalescing + Performance optimization
// ===================================================================

export class SmartEventDebouncer {
  constructor(config = {}) {
    this.config = {
      // Default debounce delays for different event types
      defaultDelay: 300,
      
      // Event-specific delays
      eventDelays: {
        'system:store:state_changed': 150,
        'inventory:product:updated': 500,
        'sales:transaction:completed': 100,
        'dashboard:data:refresh': 1000,
        'cache:updated': 200,
        'filter:applied': 300,
        'search:query:changed': 500,
        ...config.eventDelays
      },
      
      // Coalescing rules - events that can be merged
      coalesceRules: {
        'system:store:state_changed': {
          groupBy: 'storeName',
          maxAge: 1000,
          strategy: 'latest'
        },
        'inventory:stock:updated': {
          groupBy: 'productId',
          maxAge: 2000,
          strategy: 'merge'
        },
        'dashboard:metric:updated': {
          groupBy: 'metricType',
          maxAge: 5000,
          strategy: 'accumulate'
        },
        'cache:invalidated': {
          groupBy: 'cacheKey',
          maxAge: 1000,
          strategy: 'latest'
        },
        ...config.coalesceRules
      },
      
      // Maximum pending events before force flush
      maxPendingEvents: 100,
      
      // Performance thresholds
      performanceThresholds: {
        slowEventMs: 100,
        criticalEventMs: 500,
        maxEventAge: 10000
      },
      
      // Debug options
      debug: config.debug || false,
      
      ...config
    };

    // Internal state
    this.pendingEvents = new Map();
    this.coalescingGroups = new Map();
    this.eventHistory = new Map();
    this.metrics = {
      eventsDebounced: 0,
      eventsCoalesced: 0,
      eventsSuppressed: 0,
      performanceGains: 0
    };
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEvents();
    }, 5000);

    this.log('Smart Event Debouncer initialized', this.config);
  }

  // ===================================================================
  //  🎯 MAIN DEBOUNCING LOGIC
  // ===================================================================

  /**
   * Main debounce method - processes incoming events
   */
  debounce(eventName, payload, originalEmitFn, options = {}) {
    const startTime = performance.now();
    
    try {
      // Check if event should be suppressed entirely
      if (this.shouldSuppressEvent(eventName, payload)) {
        this.metrics.eventsSuppressed++;
        this.log(`🚫 Event suppressed: ${eventName}`);
        return Promise.resolve({ suppressed: true, reason: 'duplicate_or_insignificant' });
      }

      // Check for coalescing opportunities
      const coalescedEvent = this.tryCoalesceEvent(eventName, payload, options);
      if (coalescedEvent) {
        this.metrics.eventsCoalesced++;
        this.log(`🔗 Event coalesced: ${eventName}`);
        return coalescedEvent.promise;
      }

      // Apply debouncing
      const debouncedPromise = this.applyDebouncing(eventName, payload, originalEmitFn, options);
      
      // Track performance
      const processingTime = performance.now() - startTime;
      this.metrics.performanceGains += Math.max(0, this.config.defaultDelay - processingTime);
      
      return debouncedPromise;

    } catch (error) {
      this.log('❌ Error in debounce:', error);
      // Fallback to original emit
      return originalEmitFn(eventName, payload, options);
    }
  }

  /**
   * Apply debouncing logic to an event
   */
  applyDebouncing(eventName, payload, originalEmitFn, options) {
    const eventKey = this.generateEventKey(eventName, payload, options);
    const delay = this.getEventDelay(eventName, options);

    // Check if we already have a pending event for this key
    if (this.pendingEvents.has(eventKey)) {
      const existingEvent = this.pendingEvents.get(eventKey);
      
      // Clear the existing timeout
      clearTimeout(existingEvent.timeoutId);
      
      // Update the payload (use latest)
      existingEvent.payload = this.mergePayloads(existingEvent.payload, payload, eventName);
      existingEvent.updatedAt = Date.now();
      existingEvent.updateCount++;

      this.log(`🔄 Updated pending event: ${eventName} (${existingEvent.updateCount} updates)`);
    } else {
      // Create new pending event
      const pendingEvent = {
        eventName,
        payload,
        originalEmitFn,
        options,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updateCount: 0,
        timeoutId: null,
        promise: null,
        resolve: null,
        reject: null
      };

      // Create promise for this debounced event
      pendingEvent.promise = new Promise((resolve, reject) => {
        pendingEvent.resolve = resolve;
        pendingEvent.reject = reject;
      });

      this.pendingEvents.set(eventKey, pendingEvent);
      this.log(`⏳ New pending event: ${eventName} (delay: ${delay}ms)`);
    }

    // Set/reset the timeout
    const pendingEvent = this.pendingEvents.get(eventKey);
    pendingEvent.timeoutId = setTimeout(async () => {
      await this.executePendingEvent(eventKey);
    }, delay);

    this.metrics.eventsDebounced++;
    return pendingEvent.promise;
  }

  /**
   * Execute a pending event
   */
  async executePendingEvent(eventKey) {
    const pendingEvent = this.pendingEvents.get(eventKey);
    if (!pendingEvent) return;

    const startTime = performance.now();
    
    try {
      this.log(`🚀 Executing debounced event: ${pendingEvent.eventName}`);
      
      // Remove from pending events
      this.pendingEvents.delete(eventKey);
      
      // Execute the original emit function
      const result = await pendingEvent.originalEmitFn(
        pendingEvent.eventName,
        pendingEvent.payload,
        pendingEvent.options
      );

      // Track execution time
      const executionTime = performance.now() - startTime;
      this.updateEventHistory(pendingEvent.eventName, executionTime, true);

      // Resolve the promise
      pendingEvent.resolve(result);

      this.log(`✅ Event executed: ${pendingEvent.eventName} (${executionTime.toFixed(2)}ms)`);
      
    } catch (error) {
      this.log(`❌ Event execution failed: ${pendingEvent.eventName}`, error);
      
      // Track error
      this.updateEventHistory(pendingEvent.eventName, performance.now() - startTime, false);
      
      // Reject the promise
      pendingEvent.reject(error);
    }
  }

  // ===================================================================
  //  🔗 EVENT COALESCING
  // ===================================================================

  /**
   * Try to coalesce an event with existing events
   */
  tryCoalesceEvent(eventName, payload, options) {
    const coalesceRule = this.config.coalesceRules[eventName];
    if (!coalesceRule) return null;

    const groupKey = this.getCoalesceGroupKey(eventName, payload, coalesceRule);
    const coalescingGroup = this.coalescingGroups.get(groupKey);

    if (!coalescingGroup) {
      // Create new coalescing group
      this.createCoalescingGroup(groupKey, eventName, payload, options, coalesceRule);
      return null;
    }

    // Check if we can add to existing group
    const now = Date.now();
    const groupAge = now - coalescingGroup.createdAt;
    
    if (groupAge <= coalesceRule.maxAge) {
      // Add to existing group
      this.addToCoalescingGroup(coalescingGroup, payload, coalesceRule);
      return coalescingGroup;
    } else {
      // Group too old, execute it and create new one
      this.executeCoalescingGroup(groupKey);
      this.createCoalescingGroup(groupKey, eventName, payload, options, coalesceRule);
      return null;
    }
  }

  /**
   * Create a new coalescing group
   */
  createCoalescingGroup(groupKey, eventName, payload, options, coalesceRule) {
    const group = {
      groupKey,
      eventName,
      payloads: [payload],
      options,
      coalesceRule,
      createdAt: Date.now(),
      timeoutId: null,
      promise: null,
      resolve: null,
      reject: null
    };

    // Create promise
    group.promise = new Promise((resolve, reject) => {
      group.resolve = resolve;
      group.reject = reject;
    });

    // Set timeout for execution
    group.timeoutId = setTimeout(() => {
      this.executeCoalescingGroup(groupKey);
    }, coalesceRule.maxAge);

    this.coalescingGroups.set(groupKey, group);
    this.log(`🔗 Created coalescing group: ${groupKey}`);
  }

  /**
   * Add payload to existing coalescing group
   */
  addToCoalescingGroup(group, payload, coalesceRule) {
    switch (coalesceRule.strategy) {
      case 'latest':
        group.payloads = [payload]; // Keep only latest
        break;
      case 'merge':
        group.payloads[0] = { ...group.payloads[0], ...payload }; // Merge into first
        break;
      case 'accumulate':
        group.payloads.push(payload); // Keep all
        break;
      default:
        group.payloads.push(payload);
    }

    this.log(`🔗 Added to coalescing group: ${group.groupKey} (${group.payloads.length} payloads)`);
  }

  /**
   * Execute a coalescing group
   */
  async executeCoalescingGroup(groupKey) {
    const group = this.coalescingGroups.get(groupKey);
    if (!group) return;

    try {
      this.log(`🚀 Executing coalescing group: ${groupKey}`);
      
      // Remove from groups
      this.coalescingGroups.delete(groupKey);
      clearTimeout(group.timeoutId);

      // Prepare final payload
      const finalPayload = this.prepareFinalPayload(group.payloads, group.coalesceRule);

      // Execute the event (this would need to be provided by the caller)
      // For now, we'll resolve with the coalesced data
      const result = {
        coalesced: true,
        originalCount: group.payloads.length,
        finalPayload,
        eventName: group.eventName
      };

      group.resolve(result);
      
    } catch (error) {
      this.log(`❌ Coalescing group execution failed: ${groupKey}`, error);
      group.reject(error);
    }
  }

  /**
   * Prepare final payload from coalesced payloads
   */
  prepareFinalPayload(payloads, coalesceRule) {
    switch (coalesceRule.strategy) {
      case 'latest':
        return payloads[payloads.length - 1];
      case 'merge':
        return payloads.reduce((acc, payload) => ({ ...acc, ...payload }), {});
      case 'accumulate':
        return { coalescedPayloads: payloads, count: payloads.length };
      default:
        return payloads[0];
    }
  }

  // ===================================================================
  //  🚫 EVENT SUPPRESSION
  // ===================================================================

  /**
   * Check if an event should be suppressed
   */
  shouldSuppressEvent(eventName, payload) {
    // Suppress if identical event was recently processed
    if (this.isDuplicateEvent(eventName, payload)) {
      return true;
    }

    // Suppress if payload indicates no significant changes
    if (this.hasNoSignificantChanges(payload)) {
      return true;
    }

    // Suppress high-frequency low-value events
    if (this.isHighFrequencyLowValue(eventName)) {
      return true;
    }

    return false;
  }

  /**
   * Check for duplicate events
   */
  isDuplicateEvent(eventName, payload) {
    const eventKey = this.generateEventKey(eventName, payload);
    const history = this.eventHistory.get(eventKey);
    
    if (!history) return false;

    const timeSinceLastExecution = Date.now() - history.lastExecutedAt;
    const duplicateThreshold = this.getEventDelay(eventName) / 2;

    return timeSinceLastExecution < duplicateThreshold;
  }

  /**
   * Check if payload indicates no significant changes
   */
  hasNoSignificantChanges(payload) {
    // Check for explicit "no changes" indicators
    if (payload.noSignificantChanges === true) return true;
    if (payload.changeCount === 0) return true;
    if (payload.hasChanges === false) return true;

    // Check for empty or minimal changes
    if (payload.changes && Array.isArray(payload.changes) && payload.changes.length === 0) {
      return true;
    }

    if (payload.delta && Object.keys(payload.delta).length === 0) {
      return true;
    }

    return false;
  }

  /**
   * Check if event is high-frequency but low-value
   */
  isHighFrequencyLowValue(eventName) {
    const lowValueEvents = [
      'ui:scroll:updated',
      'ui:mouse:moved',
      'ui:resize:detected',
      'cache:miss:logged',
      'debug:trace:logged'
    ];

    return lowValueEvents.includes(eventName);
  }

  // ===================================================================
  //  🔧 UTILITY METHODS
  // ===================================================================

  /**
   * Generate unique key for event
   */
  generateEventKey(eventName, payload, options = {}) {
    const keyParts = [eventName];
    
    // Add significant payload properties to key
    if (payload) {
      if (payload.storeName) keyParts.push(payload.storeName);
      if (payload.productId) keyParts.push(payload.productId);
      if (payload.customerId) keyParts.push(payload.customerId);
      if (payload.transactionId) keyParts.push(payload.transactionId);
      if (payload.entityId) keyParts.push(payload.entityId);
      if (payload.cacheKey) keyParts.push(payload.cacheKey);
    }

    return keyParts.join(':');
  }

  /**
   * Get coalescing group key
   */
  getCoalesceGroupKey(eventName, payload, coalesceRule) {
    const keyParts = [eventName];
    
    if (coalesceRule.groupBy && payload[coalesceRule.groupBy]) {
      keyParts.push(payload[coalesceRule.groupBy]);
    }

    return keyParts.join(':');
  }

  /**
   * Get debounce delay for specific event
   */
  getEventDelay(eventName, options = {}) {
    if (options.delay !== undefined) return options.delay;
    return this.config.eventDelays[eventName] || this.config.defaultDelay;
  }

  /**
   * Merge payloads intelligently
   */
  mergePayloads(existing, incoming, eventName) {
    // For state change events, prefer incoming (latest state)
    if (eventName.includes('state_changed')) {
      return { ...existing, ...incoming, mergedAt: Date.now() };
    }

    // For accumulative events, merge arrays and objects
    if (eventName.includes('batch') || eventName.includes('bulk')) {
      return this.deepMerge(existing, incoming);
    }

    // Default: incoming takes precedence
    return { ...existing, ...incoming };
  }

  /**
   * Deep merge objects
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else if (Array.isArray(source[key])) {
        result[key] = [...(result[key] || []), ...source[key]];
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Update event execution history
   */
  updateEventHistory(eventName, executionTime, success) {
    const eventKey = eventName;
    const history = this.eventHistory.get(eventKey) || {
      eventName,
      totalExecutions: 0,
      successfulExecutions: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      lastExecutedAt: 0
    };

    history.totalExecutions++;
    if (success) history.successfulExecutions++;
    history.totalExecutionTime += executionTime;
    history.averageExecutionTime = history.totalExecutionTime / history.totalExecutions;
    history.lastExecutedAt = Date.now();

    this.eventHistory.set(eventKey, history);

    // Alert on slow events
    if (executionTime > this.config.performanceThresholds.slowEventMs) {
      this.log(`🐌 Slow event detected: ${eventName} (${executionTime.toFixed(2)}ms)`);
    }
  }

  // ===================================================================
  //  🧹 CLEANUP & MAINTENANCE
  // ===================================================================

  /**
   * Clean up expired events and groups
   */
  cleanupExpiredEvents() {
    const now = Date.now();
    let cleanupCount = 0;

    // Clean up old pending events
    for (const [key, event] of this.pendingEvents.entries()) {
      const age = now - event.createdAt;
      if (age > this.config.performanceThresholds.maxEventAge) {
        clearTimeout(event.timeoutId);
        event.reject(new Error('Event expired'));
        this.pendingEvents.delete(key);
        cleanupCount++;
      }
    }

    // Clean up old coalescing groups
    for (const [key, group] of this.coalescingGroups.entries()) {
      const age = now - group.createdAt;
      if (age > this.config.performanceThresholds.maxEventAge) {
        this.executeCoalescingGroup(key);
        cleanupCount++;
      }
    }

    // Clean up old event history
    for (const [key, history] of this.eventHistory.entries()) {
      const age = now - history.lastExecutedAt;
      if (age > this.config.performanceThresholds.maxEventAge * 2) {
        this.eventHistory.delete(key);
        cleanupCount++;
      }
    }

    if (cleanupCount > 0) {
      this.log(`🧹 Cleaned up ${cleanupCount} expired items`);
    }

    // Force flush if too many pending events
    if (this.pendingEvents.size > this.config.maxPendingEvents) {
      this.forceFlushPendingEvents();
    }
  }

  /**
   * Force flush all pending events
   */
  async forceFlushPendingEvents() {
    this.log(`🚨 Force flushing ${this.pendingEvents.size} pending events`);
    
    const pendingKeys = Array.from(this.pendingEvents.keys());
    
    for (const key of pendingKeys) {
      await this.executePendingEvent(key);
    }
  }

  /**
   * Get debouncing metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      pendingEvents: this.pendingEvents.size,
      coalescingGroups: this.coalescingGroups.size,
      eventHistorySize: this.eventHistory.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * Estimate memory usage
   */
  estimateMemoryUsage() {
    const pendingSize = this.pendingEvents.size * 1000; // Rough estimate
    const groupsSize = this.coalescingGroups.size * 500;
    const historySize = this.eventHistory.size * 200;
    
    return {
      total: pendingSize + groupsSize + historySize,
      pending: pendingSize,
      groups: groupsSize,
      history: historySize
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics = {
      eventsDebounced: 0,
      eventsCoalesced: 0,
      eventsSuppressed: 0,
      performanceGains: 0
    };
    this.log('📊 Metrics reset');
  }

  /**
   * Logging utility
   */
  log(message, data = null) {
    if (this.config.debug) {
      if (data) {
        console.log(`🎯 SmartDebouncer: ${message}`, data);
      } else {
        console.log(`🎯 SmartDebouncer: ${message}`);
      }
    }
  }

  /**
   * Destroy the debouncer
   */
  async destroy() {
    this.log('🧹 Destroying Smart Event Debouncer...');
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Flush all pending events
    await this.forceFlushPendingEvents();

    // Execute all coalescing groups
    const groupKeys = Array.from(this.coalescingGroups.keys());
    for (const key of groupKeys) {
      await this.executeCoalescingGroup(key);
    }

    // Clear all data structures
    this.pendingEvents.clear();
    this.coalescingGroups.clear();
    this.eventHistory.clear();

    this.log('✅ Smart Event Debouncer destroyed');
  }
}

// ===================================================================
//  🏭 DEBOUNCER FACTORY & INTEGRATION
// ===================================================================

export class DebouncedEventBus {
  constructor(originalEventBus, debouncerConfig = {}) {
    this.originalEventBus = originalEventBus;
    this.debouncer = new SmartEventDebouncer(debouncerConfig);
    
    // Preserve original methods
    this.on = originalEventBus.on.bind(originalEventBus);
    this.once = originalEventBus.once.bind(originalEventBus);
    this.off = originalEventBus.off.bind(originalEventBus);
    this.use = originalEventBus.use.bind(originalEventBus);
    this.getMetrics = this.getCombinedMetrics.bind(this);
  }

  /**
   * Debounced emit method
   */
  async emit(eventName, payload = {}, options = {}) {
    // Skip debouncing for critical events
    const criticalEvents = [
      'system:error',
      'user:logout',
      'transaction:rollback',
      'alert:security:breach'
    ];

    if (criticalEvents.includes(eventName) || options.immediate === true) {
      return this.originalEventBus.emit(eventName, payload, options);
    }

    // Apply smart debouncing
    return this.debouncer.debounce(
      eventName,
      payload,
      (name, data, opts) => this.originalEventBus.emit(name, data, opts),
      options
    );
  }

  /**
   * Get combined metrics from both event bus and debouncer
   */
  getCombinedMetrics() {
    const originalMetrics = this.originalEventBus.getMetrics();
    const debouncerMetrics = this.debouncer.getMetrics();

    return {
      eventBus: originalMetrics,
      debouncer: debouncerMetrics,
      performance: {
        eventsReduced: debouncerMetrics.eventsDebounced + debouncerMetrics.eventsCoalesced + debouncerMetrics.eventsSuppressed,
        performanceGain: debouncerMetrics.performanceGains,
        reductionPercentage: originalMetrics.eventsEmitted > 0 
          ? ((debouncerMetrics.eventsDebounced + debouncerMetrics.eventsCoalesced + debouncerMetrics.eventsSuppressed) / originalMetrics.eventsEmitted * 100).toFixed(2)
          : 0
      }
    };
  }

  /**
   * Force flush all pending operations
   */
  async flush() {
    await this.debouncer.forceFlushPendingEvents();
  }

  /**
   * Destroy the debounced event bus
   */
  async destroy() {
    await this.debouncer.destroy();
    if (this.originalEventBus.destroy) {
      await this.originalEventBus.destroy();
    }
  }
}

// ===================================================================
//  🚀 CONVENIENCE FACTORY FUNCTIONS
// ===================================================================

/**
 * Create a debounced version of an existing event bus
 */
export function createDebouncedEventBus(originalEventBus, config = {}) {
  return new DebouncedEventBus(originalEventBus, config);
}

/**
 * Enhanced StoreAdapter integration
 */
export function enhanceStoreAdapterWithDebouncing(storeAdapter, config = {}) {
  if (!storeAdapter.eventBus) {
    throw new Error('StoreAdapter must have an initialized eventBus');
  }

  // Replace the event bus with debounced version
  const originalEventBus = storeAdapter.eventBus;
  storeAdapter.eventBus = createDebouncedEventBus(originalEventBus, {
    debug: true,
    eventDelays: {
      'system:store:state_changed': 100,
      'inventory:stock:updated': 300,
      'product:cache:updated': 200,
      'dashboard:refresh:needed': 1000,
    },
    coalesceRules: {
      'system:store:state_changed': {
        groupBy: 'storeName',
        maxAge: 500,
        strategy: 'latest'
      },
      'product:cache:updated': {
        groupBy: 'cacheType',
        maxAge: 1000,
        strategy: 'merge'
      }
    },
    ...config
  });

  console.log('🎯 StoreAdapter enhanced with smart event debouncing');
  return storeAdapter;
}

export default SmartEventDebouncer;
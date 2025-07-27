//src/utils/eventBus/utils/eventHelpers.js
// =================================================================
//  🛠️ EVENT UTILITY HELPERS
// =================================================================

import { PHARMACY_EVENTS } from '../events/eventDefinitions.js';

/**
 * Event name validator
 */
export function isValidEventName(eventName) {
  const allEvents = Object.values(PHARMACY_EVENTS).flatMap(category => Object.values(category));
  return allEvents.includes(eventName);
}

/**
 * Event payload validator
 */
export function validateEventPayload(eventName, payload) {
  const validationRules = {
    [PHARMACY_EVENTS.SALES.SALE_COMPLETED]: (data) => {
      return data && data.items && Array.isArray(data.items) && data.total !== undefined;
    },
    [PHARMACY_EVENTS.INVENTORY.PRODUCT_ADDED]: (data) => {
      return data && data.product && data.product.name && data.product.price !== undefined;
    },
    [PHARMACY_EVENTS.CUSTOMER.CREATED]: (data) => {
      return data && data.customer && data.customer.name;
    },
    [PHARMACY_EVENTS.CART.ITEM_ADDED]: (data) => {
      return data && data.product && data.quantity > 0;
    }
  };

  const validator = validationRules[eventName];
  return validator ? validator(payload) : true;
}

/**
 * Event categorizer
 */
export function getEventCategory(eventName) {
  for (const [category, events] of Object.entries(PHARMACY_EVENTS)) {
    if (Object.values(events).includes(eventName)) {
      return category.toLowerCase();
    }
  }
  return 'unknown';
}

/**
 * Event priority mapper
 */
export function getEventPriority(eventName) {
  const highPriorityEvents = [
    PHARMACY_EVENTS.ALERTS.LOW_STOCK_ALERT,
    PHARMACY_EVENTS.ALERTS.OUT_OF_STOCK_ALERT,
    PHARMACY_EVENTS.ALERTS.SECURITY_ALERT,
    PHARMACY_EVENTS.HARDWARE.BATTERY_CRITICAL,
    PHARMACY_EVENTS.NETWORK.OFFLINE
  ];

  const mediumPriorityEvents = [
    PHARMACY_EVENTS.SALES.SALE_COMPLETED,
    PHARMACY_EVENTS.INVENTORY.STOCK_LOW,
    PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED,
    PHARMACY_EVENTS.USER.LOGIN
  ];

  if (highPriorityEvents.includes(eventName)) return 100;
  if (mediumPriorityEvents.includes(eventName)) return 50;
  return 0;
}

/**
 * Event formatter for logging
 */
export function formatEventForLogging(event) {
  return {
    id: event.id,
    name: event.name,
    category: getEventCategory(event.name),
    timestamp: new Date(event.timestamp).toISOString(),
    payloadSize: JSON.stringify(event.payload || {}).length,
    transactionId: event.transactionId || null,
    priority: event.priority || 0
  };
}

/**
 * Batch event processor
 */
export class BatchEventProcessor {
  constructor(eventBus, options = {}) {
    this.eventBus = eventBus;
    this.batchSize = options.batchSize || 10;
    this.batchTimeout = options.batchTimeout || 1000;
    this.batches = new Map();
  }

  /**
   * Add event to batch
   */
  addToBatch(batchKey, eventName, payload) {
    if (!this.batches.has(batchKey)) {
      this.batches.set(batchKey, {
        events: [],
        timeout: setTimeout(() => {
          this.processBatch(batchKey);
        }, this.batchTimeout)
      });
    }

    const batch = this.batches.get(batchKey);
    batch.events.push({ eventName, payload });

    // Process batch if it reaches the size limit
    if (batch.events.length >= this.batchSize) {
      clearTimeout(batch.timeout);
      this.processBatch(batchKey);
    }
  }

  /**
   * Process a batch of events
   */
  async processBatch(batchKey) {
    const batch = this.batches.get(batchKey);
    if (!batch) return;

    try {
      // Emit batch processing event
      await this.eventBus.emit('system:batch:processing', {
        batchKey,
        eventCount: batch.events.length
      });

      // Process each event in the batch
      for (const { eventName, payload } of batch.events) {
        await this.eventBus.emit(eventName, payload);
      }

      // Emit batch completed event
      await this.eventBus.emit('system:batch:completed', {
        batchKey,
        eventCount: batch.events.length
      });

    } catch (error) {
      console.error(`Batch processing failed for ${batchKey}:`, error);
      
      // Emit batch error event
      await this.eventBus.emit('system:batch:error', {
        batchKey,
        error: error.message,
        eventCount: batch.events.length
      });
    }

    // Clean up
    this.batches.delete(batchKey);
  }

  /**
   * Flush all pending batches
   */
  async flushAll() {
    const promises = Array.from(this.batches.keys()).map(key => this.processBatch(key));
    await Promise.all(promises);
  }
}

/**
 * Event metrics collector
 */
export class EventMetricsCollector {
  constructor() {
    this.metrics = {
      totalEvents: 0,
      eventsByCategory: {},
      eventsByHour: {},
      averageProcessingTime: 0,
      errorRate: 0,
      slowEvents: []
    };
  }

  /**
   * Record event metrics
   */
  recordEvent(event, processingTime) {
    this.metrics.totalEvents++;
    
    // Category metrics
    const category = getEventCategory(event.name);
    this.metrics.eventsByCategory[category] = (this.metrics.eventsByCategory[category] || 0) + 1;
    
    // Hourly metrics
    const hour = new Date().getHours();
    this.metrics.eventsByHour[hour] = (this.metrics.eventsByHour[hour] || 0) + 1;
    
    // Processing time metrics
    const currentAvg = this.metrics.averageProcessingTime;
    this.metrics.averageProcessingTime = (currentAvg * (this.metrics.totalEvents - 1) + processingTime) / this.metrics.totalEvents;
    
    // Track slow events
    if (processingTime > 1000) {
      this.metrics.slowEvents.push({
        eventName: event.name,
        processingTime,
        timestamp: Date.now()
      });
      
      // Keep only last 100 slow events
      if (this.metrics.slowEvents.length > 100) {
        this.metrics.slowEvents.shift();
      }
    }
  }

  /**
   * Record event error
   */
  recordError(event, error) {
    this.metrics.errorRate = (this.metrics.errorRate * this.metrics.totalEvents + 1) / (this.metrics.totalEvents + 1);
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      totalEvents: 0,
      eventsByCategory: {},
      eventsByHour: {},
      averageProcessingTime: 0,
      errorRate: 0,
      slowEvents: []
    };
  }
}
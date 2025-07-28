// src/utils/eventBus/middleware/debouncingMiddlewares.js
// ===================================================================
//  🎯 DEBOUNCING MIDDLEWARE SYSTEM
//  Integrates SmartEventDebouncer with existing event bus architecture
// ===================================================================

import { SmartEventDebouncer, createDebouncedEventBus } from '../debouncing/SmartEventDebouncer.js';

// ===================================================================
//  🔧 CORE DEBOUNCING MIDDLEWARE
// ===================================================================

/**
 * Main debouncing middleware that wraps event emission
 */
export const createDebouncingMiddleware = (config = {}) => {
  const debouncer = new SmartEventDebouncer({
    debug: true,
    
    // Event-specific delays based on your log patterns
    eventDelays: {
      'system:store:state_changed': 150,        // Very frequent in logs
      'inventory:product:updated': 300,
      'inventory:stock:updated': 200,
      'product:cache:updated': 250,
      'dashboard:data:refresh': 1000,
      'sales:transaction:completed': 100,
      'purchase:data:updated': 200,
      'supplier:data:updated': 200,
      'customer:data:updated': 200,
      'cart:item:updated': 150,
      'filter:applied': 300,
      'search:query:changed': 400,
      'cache:invalidated': 100,
      'ui:theme:changed': 50,
      ...config.eventDelays
    },

    // Coalescing rules for events that can be merged
    coalesceRules: {
      'system:store:state_changed': {
        groupBy: 'storeName',
        maxAge: 500,
        strategy: 'latest'  // Keep only the latest state
      },
      'inventory:stock:updated': {
        groupBy: 'productId',
        maxAge: 1000,
        strategy: 'merge'   // Merge stock changes
      },
      'product:cache:updated': {
        groupBy: 'cacheType',
        maxAge: 800,
        strategy: 'latest'
      },
      'dashboard:metric:updated': {
        groupBy: 'metricType',
        maxAge: 2000,
        strategy: 'accumulate'  // Collect all metric updates
      },
      'purchase:batch:updated': {
        groupBy: 'supplierId',
        maxAge: 1500,
        strategy: 'merge'
      },
      'sales:batch:completed': {
        groupBy: 'customerId',
        maxAge: 1000,
        strategy: 'accumulate'
      },
      ...config.coalesceRules
    },

    // Performance settings
    maxPendingEvents: 150,
    performanceThresholds: {
      slowEventMs: 100,
      criticalEventMs: 500,
      maxEventAge: 10000
    },

    ...config
  });

  // Middleware function
  return {
    name: 'debouncing',
    priority: 900, // High priority to catch events early
    
    async beforeEmit(context) {
      const { eventName, payload, options = {}, eventBus } = context;
      
      // Skip debouncing for critical/immediate events
      if (shouldSkipDebouncing(eventName, options)) {
        return context; // Pass through unchanged
      }

      // Check if this event should be suppressed entirely
      if (shouldSuppressEvent(eventName, payload)) {
        context.suppress = true;
        context.suppressReason = 'duplicate_or_insignificant';
        return context;
      }

      // Apply debouncing
      try {
        const debouncedPromise = debouncer.debounce(
          eventName,
          payload,
          (name, data, opts) => {
            // This callback will execute the actual emission
            return eventBus.executeOriginalEmit(name, data, opts);
          },
          options
        );

        // Replace the original emit with our debounced promise
        context.debouncedPromise = debouncedPromise;
        context.debounced = true;
        
        return context;
        
      } catch (error) {
        console.error('🚨 Debouncing middleware error:', error);
        return context; // Fall back to original behavior
      }
    },

    async afterEmit(context) {
      // If event was debounced, return the debounced promise
      if (context.debounced && context.debouncedPromise) {
        context.result = await context.debouncedPromise;
      }
      
      return context;
    },

    // Expose debouncer methods
    getMetrics: () => debouncer.getMetrics(),
    flush: () => debouncer.forceFlushPendingEvents(),
    destroy: () => debouncer.destroy()
  };
};

// ===================================================================
//  🚫 EVENT FILTERING & SUPPRESSION
// ===================================================================

/**
 * Check if event should skip debouncing entirely
 */
function shouldSkipDebouncing(eventName, options) {
  // Critical events that should never be debounced
  const criticalEvents = [
    'system:error',
    'system:shutdown',
    'user:logout',
    'user:login',
    'transaction:rollback',
    'alert:security:breach',
    'license:verification:failed',
    'database:connection:lost'
  ];

  if (criticalEvents.includes(eventName)) return true;
  if (options.immediate === true) return true;
  if (options.skipDebouncing === true) return true;

  return false;
}

/**
 * Enhanced event suppression based on your log patterns
 */
function shouldSuppressEvent(eventName, payload) {
  // Suppress events that explicitly indicate no changes
  if (payload?.noSignificantChanges === true) return true;
  if (payload?.hasChanges === false) return true;
  if (payload?.changeCount === 0) return true;
  if (payload?.skipEvent === true) return true;

  // Suppress empty change sets
  if (payload?.changes && Array.isArray(payload.changes) && payload.changes.length === 0) {
    return true;
  }

  // Suppress empty deltas
  if (payload?.delta && typeof payload.delta === 'object' && Object.keys(payload.delta).length === 0) {
    return true;
  }

  // Suppress redundant cache events
  if (eventName.includes('cache:') && payload?.redundant === true) {
    return true;
  }

  // Suppress UI events during rapid interactions
  const uiEvents = ['ui:scroll', 'ui:mouse:move', 'ui:resize'];
  if (uiEvents.some(event => eventName.includes(event))) {
    return true;
  }

  return false;
}

// ===================================================================
//  📊 STORE-SPECIFIC DEBOUNCING MIDDLEWARE
// ===================================================================

/**
 * Store-specific debouncing middleware for different store types
 */
export const createStoreSpecificDebouncingMiddleware = (storeName) => {
  const storeConfigs = {
    inventory: {
      eventDelays: {
        'inventory:product:updated': 400,
        'inventory:stock:updated': 300,
        'inventory:batch:updated': 500,
        'inventory:filter:applied': 350
      },
      coalesceRules: {
        'inventory:stock:updated': {
          groupBy: 'productId',
          maxAge: 1000,
          strategy: 'merge'
        },
        'inventory:filter:applied': {
          groupBy: 'filterType',
          maxAge: 800,
          strategy: 'latest'
        }
      }
    },

    purchase: {
      eventDelays: {
        'purchase:data:updated': 250,
        'purchase:item:added': 200,
        'purchase:supplier:changed': 300,
        'purchase:page:initialized': 150
      },
      coalesceRules: {
        'purchase:data:updated': {
          groupBy: 'purchaseId',
          maxAge: 1200,
          strategy: 'merge'
        }
      }
    },

    sales: {
      eventDelays: {
        'sales:transaction:updated': 200,
        'sales:item:added': 150,
        'sales:customer:changed': 250,
        'sales:payment:processed': 100
      },
      coalesceRules: {
        'sales:transaction:updated': {
          groupBy: 'transactionId',
          maxAge: 800,
          strategy: 'latest'
        }
      }
    },

    product: {
      eventDelays: {
        'product:cache:updated': 300,
        'product:filter:applied': 400,
        'product:search:performed': 500,
        'product:batch:processed': 600
      },
      coalesceRules: {
        'product:cache:updated': {
          groupBy: 'cacheKey',
          maxAge: 1000,
          strategy: 'latest'
        },
        'product:filter:applied': {
          groupBy: 'filterId',
          maxAge: 1200,
          strategy: 'latest'
        }
      }
    },

    dashboard: {
      eventDelays: {
        'dashboard:data:refresh': 1500,
        'dashboard:metric:updated': 1000,
        'dashboard:chart:updated': 800,
        'dashboard:stats:calculated': 1200
      },
      coalesceRules: {
        'dashboard:metric:updated': {
          groupBy: 'metricType',
          maxAge: 3000,
          strategy: 'accumulate'
        }
      }
    }
  };

  const config = storeConfigs[storeName] || {};
  return createDebouncingMiddleware(config);
};

// ===================================================================
//  🔄 ADAPTIVE DEBOUNCING MIDDLEWARE
// ===================================================================

/**
 * Adaptive middleware that adjusts debouncing based on system load
 */
export const createAdaptiveDebouncingMiddleware = (config = {}) => {
  let systemLoad = 'normal'; // normal, high, critical
  let eventFrequency = new Map();
  let lastLoadCheck = Date.now();

  const baseMiddleware = createDebouncingMiddleware(config);

  return {
    ...baseMiddleware,
    name: 'adaptive-debouncing',
    
    async beforeEmit(context) {
      // Update system load assessment
      updateSystemLoad(context.eventName);
      
      // Adjust debouncing based on load
      adjustDebouncingForLoad(context);
      
      return baseMiddleware.beforeEmit(context);
    },

    getSystemLoad: () => systemLoad,
    getEventFrequency: () => Object.fromEntries(eventFrequency)
  };

  function updateSystemLoad(eventName) {
    const now = Date.now();
    
    // Track event frequency
    const currentCount = eventFrequency.get(eventName) || 0;
    eventFrequency.set(eventName, currentCount + 1);
    
    // Check load every 5 seconds
    if (now - lastLoadCheck > 5000) {
      const totalEvents = Array.from(eventFrequency.values()).reduce((sum, count) => sum + count, 0);
      const eventsPerSecond = totalEvents / 5;
      
      if (eventsPerSecond > 50) {
        systemLoad = 'critical';
      } else if (eventsPerSecond > 20) {
        systemLoad = 'high';
      } else {
        systemLoad = 'normal';
      }
      
      // Reset counters
      eventFrequency.clear();
      lastLoadCheck = now;
      
      console.log(`🎯 System load: ${systemLoad} (${eventsPerSecond.toFixed(1)} events/sec)`);
    }
  }

  function adjustDebouncingForLoad(context) {
    const multipliers = {
      normal: 1,
      high: 1.5,
      critical: 2.5
    };

    const multiplier = multipliers[systemLoad] || 1;
    
    if (context.options.delay) {
      context.options.delay = Math.floor(context.options.delay * multiplier);
    }
    
    // In critical load, suppress more aggressively
    if (systemLoad === 'critical') {
      const aggressiveSuppressionEvents = [
        'ui:',
        'cache:miss',
        'debug:',
        'trace:'
      ];
      
      if (aggressiveSuppressionEvents.some(prefix => context.eventName.startsWith(prefix))) {
        context.suppress = true;
        context.suppressReason = 'critical_load_suppression';
      }
    }
  }
};

// ===================================================================
//  🏭 MIDDLEWARE FACTORY & INTEGRATION
// ===================================================================

/**
 * Factory to create different types of debouncing middleware
 */
export const DebouncingMiddlewareFactory = {
  
  /**
   * Create basic debouncing middleware
   */
  basic: (config = {}) => createDebouncingMiddleware(config),
  
  /**
   * Create store-specific middleware
   */
  forStore: (storeName, config = {}) => createStoreSpecificDebouncingMiddleware(storeName),
  
  /**
   * Create adaptive middleware
   */
  adaptive: (config = {}) => createAdaptiveDebouncingMiddleware(config),
  
  /**
   * Create performance-focused middleware
   */
  performance: (config = {}) => createDebouncingMiddleware({
    ...config,
    eventDelays: {
      'system:store:state_changed': 100,  // Aggressive debouncing
      'inventory:product:updated': 500,
      'product:cache:updated': 400,
      'dashboard:data:refresh': 2000,
      ...config.eventDelays
    },
    maxPendingEvents: 200,
    performanceThresholds: {
      slowEventMs: 50,    // Lower threshold
      criticalEventMs: 200,
      maxEventAge: 8000
    }
  }),

  /**
   * Create development-friendly middleware with extensive logging
   */
  development: (config = {}) => {
    const middleware = createDebouncingMiddleware({
      ...config,
      debug: true
    });

    // Enhance with additional logging
    const originalBeforeEmit = middleware.beforeEmit;
    middleware.beforeEmit = async (context) => {
      if (context.suppress) {
        console.log(`🚫 [DEV] Event suppressed: ${context.eventName}`, context.suppressReason);
      } else if (context.debounced) {
        console.log(`⏳ [DEV] Event debounced: ${context.eventName}`);
      }
      
      return originalBeforeEmit(context);
    };

    return middleware;
  }
};

// ===================================================================
//  🔌 STORE ADAPTER INTEGRATION
// ===================================================================

/**
 * Integrate debouncing middleware with StoreAdapter
 */
export const integrateWithStoreAdapter = (storeAdapter, middlewareType = 'basic', config = {}) => {
  if (!storeAdapter || !storeAdapter.eventBus) {
    throw new Error('StoreAdapter must have an initialized eventBus');
  }

  // Create appropriate middleware
  let middleware;
  switch (middlewareType) {
    case 'adaptive':
      middleware = DebouncingMiddlewareFactory.adaptive(config);
      break;
    case 'performance':
      middleware = DebouncingMiddlewareFactory.performance(config);
      break;
    case 'development':
      middleware = DebouncingMiddlewareFactory.development(config);
      break;
    default:
      middleware = DebouncingMiddlewareFactory.basic(config);
  }

  // Add middleware to event bus
  if (storeAdapter.eventBus.use) {
    storeAdapter.eventBus.use(middleware);
  } else {
    console.warn('⚠️ EventBus does not support middleware. Consider upgrading your EventBus implementation.');
  }

  // Add convenience methods to StoreAdapter
  storeAdapter.getDebouncingMetrics = () => middleware.getMetrics();
  storeAdapter.flushDebouncedEvents = () => middleware.flush();
  
  console.log(`🎯 StoreAdapter enhanced with ${middlewareType} debouncing middleware`);
  return storeAdapter;
};

// ===================================================================
//  📈 MONITORING & ANALYTICS
// ===================================================================

/**
 * Middleware for monitoring debouncing performance
 */
export const createDebouncingAnalyticsMiddleware = () => {
  const analytics = {
    eventsSuppressed: 0,
    eventsDebounced: 0,
    performanceGained: 0,
    topSuppressedEvents: new Map(),
    topDebouncedEvents: new Map()
  };

  return {
    name: 'debouncing-analytics',
    priority: 1000, // Highest priority to catch everything
    
    async beforeEmit(context) {
      if (context.suppress) {
        analytics.eventsSuppressed++;
        const count = analytics.topSuppressedEvents.get(context.eventName) || 0;
        analytics.topSuppressedEvents.set(context.eventName, count + 1);
      }
      
      if (context.debounced) {
        analytics.eventsDebounced++;
        const count = analytics.topDebouncedEvents.get(context.eventName) || 0;
        analytics.topDebouncedEvents.set(context.eventName, count + 1);
      }
      
      return context;
    },

    getAnalytics: () => ({
      ...analytics,
      topSuppressedEvents: Object.fromEntries(
        Array.from(analytics.topSuppressedEvents.entries())
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
      ),
      topDebouncedEvents: Object.fromEntries(
        Array.from(analytics.topDebouncedEvents.entries())
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
      )
    }),

    reset: () => {
      analytics.eventsSuppressed = 0;
      analytics.eventsDebounced = 0;
      analytics.performanceGained = 0;
      analytics.topSuppressedEvents.clear();
      analytics.topDebouncedEvents.clear();
    }
  };
};

// ===================================================================
//  🚀 READY-TO-USE CONFIGURATIONS
// ===================================================================

/**
 * Pre-configured middleware for common scenarios
 */
export const DebouncingPresets = {
  
  /**
   * Optimized for pharmacy/inventory systems
   */
  pharmacy: () => DebouncingMiddlewareFactory.basic({
    eventDelays: {
      'system:store:state_changed': 100,
      'inventory:product:updated': 300,
      'inventory:stock:updated': 250,
      'purchase:data:updated': 200,
      'sales:transaction:completed': 150,
      'product:cache:updated': 300,
      'dashboard:data:refresh': 1500
    },
    coalesceRules: {
      'system:store:state_changed': {
        groupBy: 'storeName',
        maxAge: 500,
        strategy: 'latest'
      },
      'inventory:stock:updated': {
        groupBy: 'productId',
        maxAge: 1000,
        strategy: 'merge'
      }
    }
  }),

  /**
   * High-performance configuration
   */
  highPerformance: () => DebouncingMiddlewareFactory.performance({
    eventDelays: {
      'system:store:state_changed': 50,
      'inventory:product:updated': 200,
      'product:cache:updated': 150,
      'dashboard:data:refresh': 3000
    },
    maxPendingEvents: 300
  }),

  /**
   * Development-friendly configuration
   */
  development: () => DebouncingMiddlewareFactory.development({
    debug: true,
    eventDelays: {
      'system:store:state_changed': 200, // Slower for easier debugging
      'inventory:product:updated': 400,
      'product:cache:updated': 300
    }
  })
};

export default {
  createDebouncingMiddleware,
  createStoreSpecificDebouncingMiddleware,
  createAdaptiveDebouncingMiddleware,
  DebouncingMiddlewareFactory,
  integrateWithStoreAdapter,
  createDebouncingAnalyticsMiddleware,
  DebouncingPresets
};
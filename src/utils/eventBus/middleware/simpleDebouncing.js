// src/utils/eventBus/middleware/simpleDebouncing.js
// ===================================================================
//  🎯 SIMPLE DEBOUNCING SOLUTION - WORKS WITH YOUR EVENTBUS
//  This version creates a middleware FUNCTION as your EventBus expects
// ===================================================================

// ===================================================================
//  🎯 SIMPLE DEBOUNCING MIDDLEWARE FACTORY
// ===================================================================

export const createSimpleDebouncingMiddleware = () => {
  // Tracking data
  const lastExecutions = new Map();
  const suppressedCount = new Map();
  const analytics = {
    eventsDebounced: 0,
    eventsSuppressed: 0,
    totalEvents: 0
  };

  // Event delay configuration
  const eventDelays = {
    'system:store:state_changed': 100,      // Your most frequent event
    'purchase:data:updated': 150,
    'purchase:page:initialized': 100,
    'inventory:product:updated': 200,
    'product:cache:updated': 300,
    'dashboard:data:refresh': 1000,
    'cart:item:added': 100,
    'sales:transaction:completed': 50,      // Keep responsive
    'cache:updated': 150,
    'settings:updated': 300,
    'theme:changed': 200
  };

  // Critical events that should never be debounced
  const criticalEvents = [
    'system:error',
    'user:logout',
    'user:login', 
    'system:shutdown',
    'sales:transaction:completed',          // Keep for UX
    'alert:security:breach'
  ];

  // Events that should be suppressed if no significant changes
  const suppressibleEvents = [
    'system:store:state_changed',
    'purchase:data:updated',
    'inventory:product:updated',
    'product:cache:updated'
  ];

  // The actual middleware function that your EventBus expects
  const middlewareFunction = async (event) => {
    try {
      analytics.totalEvents++;
      const { name: eventName, payload } = event;
      
      // 1. Allow critical events immediately
      if (criticalEvents.includes(eventName)) {
        return true;
      }

      // 2. Check for suppression based on payload
      if (suppressibleEvents.includes(eventName) && shouldSuppressEvent(payload)) {
        analytics.eventsSuppressed++;
        const count = suppressedCount.get(eventName) || 0;
        suppressedCount.set(eventName, count + 1);
        
        // Only log occasionally to avoid spam
        if (count % 10 === 0) {
          console.log(`🚫 Suppressed ${count + 1} "${eventName}" events (no significant changes)`);
        }
        return false;
      }

      // 3. Apply debouncing for frequent events
      const delay = eventDelays[eventName];
      if (delay) {
        const now = Date.now();
        const lastExecution = lastExecutions.get(eventName) || 0;
        
        if (now - lastExecution < delay) {
          analytics.eventsDebounced++;
          console.log(`⏳ Debounced: ${eventName} (${now - lastExecution}ms < ${delay}ms)`);
          return false;
        }
        
        // Update last execution time
        lastExecutions.set(eventName, now);
      }

      // 4. Allow event to proceed
      return true;
      
    } catch (error) {
      console.error('❌ Debouncing middleware error:', error);
      return true; // Allow event on error to prevent breaking the system
    }
  };

  // Attach utility methods to the middleware function
  middlewareFunction.getMetrics = () => ({
    ...analytics,
    suppressedByEvent: Object.fromEntries(suppressedCount),
    reductionPercentage: analytics.totalEvents > 0 ? 
      (((analytics.eventsDebounced + analytics.eventsSuppressed) / analytics.totalEvents) * 100).toFixed(2) + '%' : '0%'
  });

  middlewareFunction.reset = () => {
    lastExecutions.clear();
    suppressedCount.clear();
    analytics.eventsDebounced = 0;
    analytics.eventsSuppressed = 0;
    analytics.totalEvents = 0;
    console.log('📊 Debouncing metrics reset');
  };

  middlewareFunction.flush = () => {
    lastExecutions.clear();
    console.log('🚀 Debouncing cache flushed - next events will execute immediately');
  };

  return middlewareFunction;
};

// ===================================================================
//  🔍 HELPER FUNCTIONS
// ===================================================================

function shouldSuppressEvent(payload) {
  if (!payload) return false;

  // Explicit suppression indicators
  if (payload.noSignificantChanges === true) return true;
  if (payload.hasChanges === false) return true;
  if (payload.changeCount === 0) return true;
  if (payload.skipEvent === true) return true;

  // Empty changes array
  if (payload.changes && Array.isArray(payload.changes) && payload.changes.length === 0) {
    return true;
  }

  // Empty delta object
  if (payload.delta && typeof payload.delta === 'object' && Object.keys(payload.delta).length === 0) {
    return true;
  }

  return false;
}

// ===================================================================
//  🚀 STORE ADAPTER INTEGRATION
// ===================================================================

export const addDebouncingToStoreAdapter = (storeAdapter) => {
  if (!storeAdapter || !storeAdapter.eventBus) {
    throw new Error('StoreAdapter must have an initialized eventBus');
  }

  console.log('🎯 Adding simple debouncing to StoreAdapter...');

  // Create the debouncing middleware
  const debouncingMiddleware = createSimpleDebouncingMiddleware();

  // Add it to the EventBus (this should work now!)
  storeAdapter.eventBus.use(debouncingMiddleware);

  // Add utility methods to StoreAdapter
  storeAdapter.getDebouncingMetrics = () => debouncingMiddleware.getMetrics();
  storeAdapter.resetDebouncingMetrics = () => debouncingMiddleware.reset();
  storeAdapter.flushDebouncedEvents = () => debouncingMiddleware.flush();

  // Override handleStoreStateChange to add smarter change detection
  const originalHandleStoreStateChange = storeAdapter.handleStoreStateChange;
  storeAdapter.handleStoreStateChange = function(storeName, newState) {
    if (this.isDestroyed) return;

    const store = this.stores.get(storeName);
    if (!store) return;

    const oldState = this.storeStates.get(storeName);
    
    // Smart change detection
    const hasSignificantChanges = detectSignificantChanges(oldState, newState, storeName);
    
    // Update state cache first
    this.storeStates.set(storeName, { ...newState });

    // Only emit if there are significant changes
    if (!hasSignificantChanges) {
      // Still log occasionally for debugging
      if (Math.random() < 0.01) { // 1% chance
        console.log(`⏭️ Skipping event for "${storeName}" - no significant changes`);
      }
      return;
    }

    // Emit the event (will now be processed by debouncing middleware)
    this.eventBus.emit('system:store:state_changed', {
      storeName,
      oldState,
      newState,
      timestamp: Date.now(),
      hasSignificantChanges: true
    }).catch(console.error);

    // Handle cross-store sync
    this.handleCrossStoreSync(storeName, newState, oldState);
  };

  console.log('✅ Simple debouncing added successfully');
  return storeAdapter;
};

// ===================================================================
//  🔍 CHANGE DETECTION
// ===================================================================

function detectSignificantChanges(oldState, newState, storeName) {
  // If no old state, it's significant
  if (!oldState) return true;
  
  // If states are identical references, no changes
  if (oldState === newState) return false;

  // Store-specific change detection
  switch (storeName) {
    case 'purchase':
      return detectPurchaseChanges(oldState, newState);
    case 'inventory':
      return detectInventoryChanges(oldState, newState);
    case 'product':
      return detectProductChanges(oldState, newState);
    case 'cart':
      return detectCartChanges(oldState, newState);
    case 'dashboard':
      return true; // Dashboard updates are always significant
    default:
      return detectGenericChanges(oldState, newState);
  }
}

function detectPurchaseChanges(oldState, newState) {
  const significantFields = [
    'purchases', 'suppliers', 'isLoading', 'error',
    'totalAmount', 'selectedSupplier', 'purchaseItems'
  ];
  
  return significantFields.some(field => {
    const oldVal = oldState?.[field];
    const newVal = newState?.[field];
    
    if (Array.isArray(newVal)) {
      return !Array.isArray(oldVal) || oldVal.length !== newVal.length;
    }
    
    return oldVal !== newVal;
  });
}

function detectInventoryChanges(oldState, newState) {
  const significantFields = [
    'products', 'filteredProducts', 'totalProducts',
    'isLoading', 'selectedProduct', 'stockAlerts'
  ];
  
  return significantFields.some(field => 
    oldState?.[field] !== newState?.[field]
  );
}

function detectProductChanges(oldState, newState) {
  const significantFields = [
    'products', 'filteredProducts', 'selectedProduct',
    'totalCount', 'isLoading', 'searchQuery'
  ];
  
  return significantFields.some(field => 
    oldState?.[field] !== newState?.[field]
  );
}

function detectCartChanges(oldState, newState) {
  const significantFields = [
    'items', 'total', 'subtotal', 'customer', 'paymentMethod'
  ];
  
  return significantFields.some(field => 
    oldState?.[field] !== newState?.[field]
  );
}

function detectGenericChanges(oldState, newState) {
  // Shallow comparison for unknown stores
  if (typeof newState === 'object' && newState !== null) {
    return Object.keys(newState).some(key => 
      oldState?.[key] !== newState[key]
    );
  }
  
  return oldState !== newState;
}

// ===================================================================
//  📊 MONITORING UTILITY
// ===================================================================

export const createDebouncingMonitor = (storeAdapter, intervalMs = 30000) => {
  const startTime = Date.now();
  
  const logMetrics = () => {
    const metrics = storeAdapter.getDebouncingMetrics();
    const uptime = Math.round((Date.now() - startTime) / 1000);
    
    console.log(`📊 Debouncing Report (${uptime}s):`, {
      totalEvents: metrics.totalEvents,
      eventsDebounced: metrics.eventsDebounced,
      eventsSuppressed: metrics.eventsSuppressed,
      reductionPercentage: metrics.reductionPercentage,
      topSuppressed: Object.entries(metrics.suppressedByEvent)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([event, count]) => `${event}: ${count}`)
    });
  };

  const intervalId = setInterval(logMetrics, intervalMs);
  
  return {
    stop: () => {
      clearInterval(intervalId);
      console.log('📊 Debouncing monitoring stopped');
    },
    logNow: logMetrics
  };
};

// ===================================================================
//  🎯 READY-TO-USE EXPORT
// ===================================================================

export default {
  createSimpleDebouncingMiddleware,
  addDebouncingToStoreAdapter,
  createDebouncingMonitor
};
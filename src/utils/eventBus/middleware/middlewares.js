//src/utils/eventBus/middleware/middlewares.js
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

/**
 * Data validation middleware
 */
export const validationMiddleware = async (event) => {
  // Define validation rules for different events
  const validationRules = {
    'sales:sale:completed': (payload) => {
      return payload.items && Array.isArray(payload.items) && payload.items.length > 0;
    },
    'inventory:product:added': (payload) => {
      return payload.product && payload.product.name && payload.product.price;
    },
    'customer:created': (payload) => {
      return payload.customer && payload.customer.name;
    }
  };

  const validator = validationRules[event.name];
  if (validator && !validator(event.payload)) {
    console.error(`Validation failed for ${event.name}:`, event.payload);
    return false;
  }

  return true;
};

/**
 * Rate limiting middleware
 */
export const rateLimitingMiddleware = (() => {
  const eventCounts = new Map();
  const timeWindow = 60000; // 1 minute
  const maxEventsPerWindow = 1000;

  return async (event) => {
    const now = Date.now();
    const eventType = event.name;
    
    if (!eventCounts.has(eventType)) {
      eventCounts.set(eventType, []);
    }
    
    const timestamps = eventCounts.get(eventType);
    
    // Remove old timestamps outside the time window
    const validTimestamps = timestamps.filter(timestamp => now - timestamp < timeWindow);
    
    if (validTimestamps.length >= maxEventsPerWindow) {
      console.warn(`Rate limit exceeded for ${eventType}: ${validTimestamps.length} events in last minute`);
      return false;
    }
    
    // Add current timestamp
    validTimestamps.push(now);
    eventCounts.set(eventType, validTimestamps);
    
    return true;
  };
})();

/**
 * Error handling middleware
 */
export const errorHandlingMiddleware = async (event) => {
  try {
    // Check for potential error conditions
    if (event.payload && event.payload.error) {
      console.error(`Event ${event.name} contains error:`, event.payload.error);
      
      // Emit error alert
      setTimeout(() => {
        window.pharmacyEventBus?.emit('alert:system:error', {
          originalEvent: event.name,
          error: event.payload.error,
          timestamp: Date.now()
        });
      }, 0);
    }
    
    return true;
  } catch (error) {
    console.error('Error in error handling middleware:', error);
    return true; // Don't block the event due to middleware error
  }
};

/**
 * Security middleware
 */
export const securityMiddleware = async (event) => {
  // List of sensitive events that require extra security checks
  const sensitiveEvents = [
    'user:password:changed',
    'user:privilege:updated',
    'finance:cash:counted',
    'purchase:supplier:balance_updated'
  ];

  if (sensitiveEvents.includes(event.name)) {
    // Check for suspicious patterns
    const userStore = window.useAuthStore?.getState?.();
    const currentUser = userStore?.user;
    
    if (!currentUser || !currentUser.permissions?.includes('sensitive_operations')) {
      console.warn(`Security violation: User ${currentUser?.name || 'unknown'} attempted sensitive operation: ${event.name}`);
      
      // Log security alert
      setTimeout(() => {
        window.pharmacyEventBus?.emit('alert:security:breach', {
          userId: currentUser?._id,
          userName: currentUser?.name,
          attemptedEvent: event.name,
          timestamp: Date.now()
        });
      }, 0);
      
      return false;
    }
  }

  return true;
};

/**
 * Network status middleware
 */
export const networkStatusMiddleware = async (event) => {
  // Check if we're offline and the event requires network connectivity
  const networkRequiredEvents = [
    'sync:started',
    'purchase:order:sent',
    'prescription:insurance:claimed'
  ];

  if (networkRequiredEvents.includes(event.name)) {
    const isOnline = navigator.onLine;
    
    if (!isOnline) {
      console.warn(`Network required for ${event.name} but system is offline`);
      
      // Emit offline queue event
      setTimeout(() => {
        window.pharmacyEventBus?.emit('sync:offline:queued', {
          originalEvent: event.name,
          payload: event.payload,
          queuedAt: Date.now()
        });
      }, 0);
      
      return false;
    }
  }

  return true;
};

/**
 * Business rules middleware
 */
export const businessRulesMiddleware = async (event) => {
  // Define business rules for different operations
  const businessRules = {
    'sales:sale:completed': (payload) => {
      // Rule: Cannot sell expired products
      if (payload.items) {
        const hasExpiredItems = payload.items.some(item => {
          return item.expiryDate && new Date(item.expiryDate) < new Date();
        });
        
        if (hasExpiredItems) {
          console.error('Business rule violation: Attempting to sell expired products');
          return false;
        }
      }
      
      // Rule: Cannot sell more than available stock
      if (payload.items) {
        const hasInsufficientStock = payload.items.some(item => {
          return item.requestedQuantity > item.availableStock;
        });
        
        if (hasInsufficientStock) {
          console.error('Business rule violation: Insufficient stock for sale');
          return false;
        }
      }
      
      return true;
    },
    
    'inventory:product:deleted': (payload) => {
      // Rule: Cannot delete products with pending orders
      if (payload.product && payload.product.pendingOrders > 0) {
        console.error('Business rule violation: Cannot delete product with pending orders');
        return false;
      }
      
      return true;
    }
  };

  const rule = businessRules[event.name];
  if (rule && !rule(event.payload)) {
    return false;
  }

  return true;
};

/**
 * Combine all middlewares into a single setup function
 */
export const setupPharmacyMiddlewares = (eventBus) => {
  eventBus.use(authenticationMiddleware);
  eventBus.use(auditLoggingMiddleware);
  eventBus.use(performanceMiddleware);
  eventBus.use(validationMiddleware);
  eventBus.use(rateLimitingMiddleware);
  eventBus.use(errorHandlingMiddleware);
  eventBus.use(securityMiddleware);
  eventBus.use(networkStatusMiddleware);
  eventBus.use(businessRulesMiddleware);
  
  console.log('🔌 All pharmacy middlewares registered');
};
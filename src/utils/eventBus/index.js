//src/utils/eventBus/index.js
// =================================================================
//  📦 MAIN EXPORT FILE
// =================================================================

// Core exports
export { EventBus } from './core/EventBus.js';

// Event definitions
export { PHARMACY_EVENTS } from './events/eventDefinitions.js';

// Managers
export { PharmacyTransactionManager } from './managers/PharmacyTransactionManager.js';

// Factory
export { 
  createPharmacyEventBus, 
  getGlobalEventBus, 
  destroyGlobalEventBus 
} from './factory/eventBusFactory.js';

// Middlewares
export { 
  authenticationMiddleware,
  auditLoggingMiddleware,
  performanceMiddleware,
  validationMiddleware,
  rateLimitingMiddleware,
  errorHandlingMiddleware,
  securityMiddleware,
  networkStatusMiddleware,
  businessRulesMiddleware,
  setupPharmacyMiddlewares
} from './middleware/middlewares.js';

// Listeners
export { setupStoreListeners } from './listeners/storeListeners.js';

// Utils
export {
  isValidEventName,
  validateEventPayload,
  getEventCategory,
  getEventPriority,
  formatEventForLogging,
  BatchEventProcessor,
  EventMetricsCollector
} from './utils/eventHelpers.js';

// Default export
export default {
  EventBus,
  PHARMACY_EVENTS,
  PharmacyTransactionManager,
  createPharmacyEventBus,
  getGlobalEventBus,
  destroyGlobalEventBus
};
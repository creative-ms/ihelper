//src/utils/eventBus/factory/eventBusFactory.js
// =================================================================
//  🏗️ ENHANCED FACTORY WITH STORE INTEGRATIONS
// =================================================================

import { EventBus } from '../core/EventBus.js';
import { PharmacyTransactionManager } from '../managers/PharmacyTransactionManager.js';
import { PHARMACY_EVENTS } from '../events/eventDefinitions.js';
import { setupPharmacyMiddlewares } from '../middleware/middlewares.js';
import { setupStoreListeners } from '../listeners/storeListeners.js';

export function createPharmacyEventBus() {
  const eventBus = new EventBus();
  const transactionManager = new PharmacyTransactionManager(eventBus);
  
  // Setup enhanced middlewares
  setupPharmacyMiddlewares(eventBus);
  
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

// =================================================================
//  🏭 SINGLETON PATTERN FOR GLOBAL ACCESS
// =================================================================

let globalEventBusInstance = null;

export function getGlobalEventBus() {
  if (!globalEventBusInstance) {
    globalEventBusInstance = createPharmacyEventBus();
    
    // Make it globally accessible
    if (typeof window !== 'undefined') {
      window.pharmacyEventBus = globalEventBusInstance.eventBus;
      window.pharmacyTransactionManager = globalEventBusInstance.transactionManager;
      window.PHARMACY_EVENTS = globalEventBusInstance.events;
    }
  }
  
  return globalEventBusInstance;
}

export function destroyGlobalEventBus() {
  if (globalEventBusInstance) {
    globalEventBusInstance.eventBus.destroy();
    globalEventBusInstance = null;
    
    if (typeof window !== 'undefined') {
      delete window.pharmacyEventBus;
      delete window.pharmacyTransactionManager;
      delete window.PHARMACY_EVENTS;
    }
  }
}
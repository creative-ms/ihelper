//src/utils/eventBus/listeners/storeListeners.js
// =================================================================
//  🎧 STORE LISTENERS SETUP
// =================================================================

import { PHARMACY_EVENTS } from '../events/eventDefinitions.js';

/**
 * Setup listeners for your Zustand stores
 */
export function setupStoreListeners(eventBus) {
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

  // Cart store integration
  eventBus.on(PHARMACY_EVENTS.CART.ITEM_ADDED, async (payload) => {
    // Check stock availability
    const stockCheck = checkStockAvailability(
      payload.product, 
      payload.currentQuantity, 
      payload.addedQuantity
    );
    
    if (!stockCheck) {
      await eventBus.emit(PHARMACY_EVENTS.ALERTS.LOW_STOCK_ALERT, {
        productId: payload.product._id,
        productName: payload.product.name
      });
    }
  });

  // Inventory store integration
  eventBus.on(PHARMACY_EVENTS.INVENTORY.PRODUCT_ADDED, async (payload) => {
    console.log('New product added:', payload.product.name);
    
    // Update UI cache if available
    if (window.updateProductCache) {
      await window.updateProductCache(payload.product);
    }
    
    // Sync with search engine if available
    if (window.syncToMeilisearch) {
      await window.syncToMeilisearch(payload.product);
    }
  });

  // Sales store integration
  eventBus.on(PHARMACY_EVENTS.SALES.SALE_COMPLETED, async (payload) => {
    // Update daily sales cache
    if (window.updateDailySalesCache) {
      await window.updateDailySalesCache(payload);
    }
    
    // Trigger receipt printing
    if (window.printReceipt) {
      await window.printReceipt(payload);
    }
  });

  // User authentication integration
  eventBus.on(PHARMACY_EVENTS.USER.LOGIN, async (payload) => {
    // Update user session
    if (window.updateUserSession) {
      await window.updateUserSession(payload);
    }
    
    // Load user preferences
    if (window.loadUserPreferences) {
      await window.loadUserPreferences(payload.userId);
    }
  });

  console.log('🎧 Store listeners setup completed');
}

// Helper function for stock checking
function checkStockAvailability(product, currentQuantity, addedQuantity) {
  if (!product || !product.stock) return true;
  
  const totalRequested = currentQuantity + addedQuantity;
  return product.stock.quantity >= totalRequested;
}
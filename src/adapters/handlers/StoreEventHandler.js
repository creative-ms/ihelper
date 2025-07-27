// src/adapters/handlers/StoreEventHandler.js
// ===================================================================
//  🎯 STORE EVENT HANDLER MODULE
//  Handles cross-store event communication and synchronization
// ===================================================================

import { PHARMACY_EVENTS } from '../../utils/eventBus/index.js';

export class StoreEventHandler {
  constructor(storeAdapter) {
    this.adapter = storeAdapter;
    this.eventBuffer = [];
    this.eventHandlers = new Map();
    
    this.initializeEventHandlers();
  }

  initializeEventHandlers() {
    // Product event handlers
    this.eventHandlers.set(PHARMACY_EVENTS.PRODUCT.CREATED, this.handleProductCreated.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.PRODUCT.UPDATED, this.handleProductUpdated.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.PRODUCT.DELETED, this.handleProductDeleted.bind(this));

    // Inventory event handlers
    this.eventHandlers.set(PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED, this.handleStockUpdated.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.INVENTORY.BATCH_CREATED, this.handleBatchCreated.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.INVENTORY.LOW_STOCK_ALERT, this.handleLowStockAlert.bind(this));

    // Sales event handlers
    this.eventHandlers.set(PHARMACY_EVENTS.SALES.TRANSACTION_COMPLETED, this.handleSalesTransaction.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.SALES.ITEM_ADDED, this.handleCartItemAdded.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.SALES.PAYMENT_PROCESSED, this.handlePaymentProcessed.bind(this));

    // Customer event handlers
    this.eventHandlers.set(PHARMACY_EVENTS.CUSTOMER.CREATED, this.handleCustomerCreated.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, this.handleCustomerBalanceUpdated.bind(this));

    // System event handlers
    this.eventHandlers.set(PHARMACY_EVENTS.SYSTEM.STORE_STATE_CHANGED, this.handleStoreStateChanged.bind(this));
    this.eventHandlers.set(PHARMACY_EVENTS.SYSTEM.SYNC_REQUIRED, this.handleSyncRequired.bind(this));
  }

  async handleEvent(eventName, payload) {
    const handler = this.eventHandlers.get(eventName);
    if (handler) {
      try {
        await handler(payload);
        this.addToEventBuffer(eventName, payload, 'handled');
      } catch (error) {
        console.error(`Error handling event ${eventName}:`, error);
        this.addToEventBuffer(eventName, payload, 'error', error.message);
      }
    } else {
      console.warn(`No handler found for event: ${eventName}`);
    }
  }

  // ===================================================================
  //  🛍️ PRODUCT EVENT HANDLERS
  // ===================================================================

  async handleProductCreated(payload) {
    const { productId, productData } = payload;
    
    // Update dependent stores
    await Promise.all([
      this.syncStoreIfActive('product'),
      this.syncStoreIfActive('inventory'),
      this.syncStoreIfActive('dashboard')
    ]);

    // Emit follow-up events
    await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.DATA_REFRESH_NEEDED, {
      reason: 'product_created',
      productId
    });

    // Log audit trail
    await this.emitEvent(PHARMACY_EVENTS.AUDIT.ENTITY_CREATED, {
      entityType: 'product',
      entityId: productId,
      data: productData
    });
  }

  async handleProductUpdated(payload) {
    const { productId, changes, oldData, newData } = payload;
    
    // Determine which stores need updates based on what changed
    const storesToUpdate = ['product'];
    
    if (changes.retailPrice || changes.costPrice) {
      storesToUpdate.push('sales', 'dashboard');
    }
    
    if (changes.category || changes.brand) {
      storesToUpdate.push('dashboard');
    }

    // Update relevant stores
    for (const storeName of storesToUpdate) {
      await this.syncStoreIfActive(storeName);
    }

    // Emit audit event
    await this.emitEvent(PHARMACY_EVENTS.AUDIT.ENTITY_UPDATED, {
      entityType: 'product',
      entityId: productId,
      changes,
      oldData,
      newData
    });
  }

  async handleProductDeleted(payload) {
    const { productId, productData } = payload;
    
    // Update all relevant stores
    await Promise.all([
      this.syncStoreIfActive('product'),
      this.syncStoreIfActive('inventory'),
      this.syncStoreIfActive('cart'),
      this.syncStoreIfActive('dashboard')
    ]);

    // Check if product was in active carts
    const cartStore = this.adapter.stores.get('cart');
    if (cartStore?.isActive) {
      const cartState = cartStore.hook.getState();
      if (cartState.items?.some(item => item.productId === productId)) {
        await this.emitEvent(PHARMACY_EVENTS.SALES.ITEM_REMOVED, {
          productId,
          reason: 'product_deleted'
        });
      }
    }

    // Log deletion
    await this.emitEvent(PHARMACY_EVENTS.AUDIT.ENTITY_DELETED, {
      entityType: 'product',
      entityId: productId,
      data: productData
    });
  }

  // ===================================================================
  //  📦 INVENTORY EVENT HANDLERS
  // ===================================================================

  async handleStockUpdated(payload) {
    const { productId, newStock, previousStock, changeType } = payload;
    
    // Update inventory and product stores
    await Promise.all([
      this.syncStoreIfActive('inventory'),
      this.syncStoreIfActive('product'),
      this.syncStoreIfActive('dashboard')
    ]);

    // Check for low stock condition
    const inventoryStore = this.adapter.stores.get('inventory');
    if (inventoryStore?.isActive) {
      const inventoryState = inventoryStore.hook.getState();
      const product = inventoryState.products?.find(p => p._id === productId);
      
      if (product && newStock <= (product.minStockLevel || 10)) {
        await this.emitEvent(PHARMACY_EVENTS.INVENTORY.LOW_STOCK_ALERT, {
          productId,
          productName: product.name,
          currentStock: newStock,
          minStockLevel: product.minStockLevel || 10
        });
      }
    }

    // Update dashboard metrics
    await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.METRIC_UPDATED, {
      metric: 'inventory_change',
      productId,
      change: newStock - previousStock,
      changeType
    });
  }

  async handleBatchCreated(payload) {
    const { productId, batchData } = payload;
    
    // Update inventory and product stores
    await Promise.all([
      this.syncStoreIfActive('inventory'),
      this.syncStoreIfActive('product')
    ]);

    // Check for near-expiry items
    if (batchData.expiryDate) {
      const expiryDate = new Date(batchData.expiryDate);
      const daysUntilExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry <= 30) { // Alert if expiring within 30 days
        await this.emitEvent(PHARMACY_EVENTS.INVENTORY.EXPIRY_WARNING, {
          productId,
          batchNumber: batchData.batchNumber,
          expiryDate: batchData.expiryDate,
          daysUntilExpiry
        });
      }
    }
  }

  async handleLowStockAlert(payload) {
    const { productId, currentStock, minStockLevel } = payload;
    
    // Update dashboard to show alert
    await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.ALERT_ADDED, {
      type: 'low_stock',
      productId,
      message: `Low stock alert: ${currentStock} remaining (minimum: ${minStockLevel})`
    });

    // Log audit event
    await this.emitEvent(PHARMACY_EVENTS.AUDIT.ALERT_TRIGGERED, {
      alertType: 'low_stock',
      productId,
      details: { currentStock, minStockLevel }
    });
  }

  // ===================================================================
  //  💰 SALES EVENT HANDLERS
  // ===================================================================

  async handleSalesTransaction(payload) {
    const { transactionId, items, total, customer, payment } = payload;
    
    // Update all sales-related stores
    await Promise.all([
      this.syncStoreIfActive('sales'),
      this.syncStoreIfActive('inventory'),
      this.syncStoreIfActive('dashboard'),
      this.syncStoreIfActive('audit')
    ]);

    // Update customer store if customer involved
    if (customer) {
      await this.syncStoreIfActive('customer');
      
      // Update customer transaction history
      await this.emitEvent(PHARMACY_EVENTS.CUSTOMER.TRANSACTION_RECORDED, {
        customerId: customer._id,
        transactionId,
        amount: total,
        items: items.length
      });
    }

    // Update dashboard metrics
    await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.SALES_RECORDED, {
      transactionId,
      total,
      itemCount: items.length,
      paymentMethod: payment.method
    });

    // Clear cart after successful sale
    await this.emitEvent(PHARMACY_EVENTS.SALES.CART_CLEARED, {
      reason: 'transaction_completed',
      transactionId
    });
  }

  async handleCartItemAdded(payload) {
    const { productId, quantity, batchNumber } = payload;
    
    // Update cart store
    await this.syncStoreIfActive('cart');

    // Check if sufficient stock available
    const inventoryStore = this.adapter.stores.get('inventory');
    if (inventoryStore?.isActive) {
      const inventoryState = inventoryStore.hook.getState();
      const batch = inventoryState.batches?.find(b => 
        b.productId === productId && b.batchNumber === batchNumber
      );
      
      if (batch && batch.quantity < quantity) {
        await this.emitEvent(PHARMACY_EVENTS.INVENTORY.INSUFFICIENT_STOCK, {
          productId,
          batchNumber,
          requested: quantity,
          available: batch.quantity
        });
      }
    }
  }

  async handlePaymentProcessed(payload) {
    const { transactionId, paymentMethod, amount, status } = payload;
    
    if (status === 'success') {
      // Update financial records
      await this.emitEvent(PHARMACY_EVENTS.FINANCE.PAYMENT_RECORDED, {
        transactionId,
        method: paymentMethod,
        amount
      });
    } else {
      // Handle payment failure
      await this.emitEvent(PHARMACY_EVENTS.FINANCE.PAYMENT_FAILED, {
        transactionId,
        method: paymentMethod,
        amount,
        reason: payload.errorMessage
      });
    }
  }

  // ===================================================================
  //  👥 CUSTOMER EVENT HANDLERS
  // ===================================================================

  async handleCustomerCreated(payload) {
    const { customerId, customerData } = payload;
    
    // Update customer store and dashboard
    await Promise.all([
      this.syncStoreIfActive('customer'),
      this.syncStoreIfActive('dashboard')
    ]);

    // Log audit trail
    await this.emitEvent(PHARMACY_EVENTS.AUDIT.ENTITY_CREATED, {
      entityType: 'customer',
      entityId: customerId,
      data: customerData
    });
  }

  async handleCustomerBalanceUpdated(payload) {
    const { customerId, newBalance, changeAmount, changeType } = payload;
    
    // Update customer store
    await this.syncStoreIfActive('customer');

    // Update dashboard customer metrics
    await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.CUSTOMER_METRIC_UPDATED, {
      customerId,
      metric: 'balance',
      value: newBalance,
      change: changeAmount,
      changeType
    });
  }

  // ===================================================================
  //  🔧 SYSTEM EVENT HANDLERS
  // ===================================================================

  async handleStoreStateChanged(payload) {
    const { storeName, oldState, newState } = payload;
    
    // Handle cross-store dependencies
    this.adapter.handleCrossStoreSync(storeName, newState, oldState);

    // Log significant state changes
    const changes = this.adapter.detectStateChanges(oldState, newState);
    if (Object.keys(changes).length > 0) {
      await this.emitEvent(PHARMACY_EVENTS.AUDIT.STORE_STATE_LOGGED, {
        storeName,
        changes,
        timestamp: Date.now()
      });
    }
  }

  async handleSyncRequired(payload) {
    const { storeNames, reason } = payload;
    
    console.log(`🔄 Sync required for stores: ${storeNames.join(', ')} - Reason: ${reason}`);
    
    // Perform sync
    await this.adapter.syncStores(storeNames);
  }

  // ===================================================================
  //  🛠️ UTILITY METHODS
  // ===================================================================

  async syncStoreIfActive(storeName) {
    const store = this.adapter.stores.get(storeName);
    if (store?.isActive) { try {
        await this.adapter.syncSingleStore(storeName);
        console.log(`✅ Store "${storeName}" synced successfully`);
      } catch (error) {
        console.error(`❌ Failed to sync store "${storeName}":`, error);
      }
    }
  }

  async emitEvent(eventName, payload) {
    if (this.adapter.eventBus) {
      try {
        return await this.adapter.eventBus.emit(eventName, payload);
      } catch (error) {
        console.error(`❌ Failed to emit event "${eventName}":`, error);
        throw error;
      }
    }
  }

  addToEventBuffer(eventName, payload, status, error = null) {
    this.eventBuffer.push({
      eventName,
      payload,
      status,
      error,
      timestamp: Date.now(),
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    });

    // Keep buffer manageable
    if (this.eventBuffer.length > 100) {
      this.eventBuffer.splice(0, this.eventBuffer.length - 100);
    }
  }

  // ===================================================================
  //  🔧 ADVANCED EVENT HANDLERS
  // ===================================================================

  async handleFinanceEvent(payload) {
    const { eventType, amount, method, transactionId } = payload;
    
    try {
      // Update financial stores
      await Promise.all([
        this.syncStoreIfActive('sales'),
        this.syncStoreIfActive('dashboard'),
        this.syncStoreIfActive('audit')
      ]);

      // Handle specific finance events
      switch (eventType) {
        case 'cash_counted':
          await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.CASH_FLOW_UPDATED, {
            totalCash: amount,
            timestamp: Date.now()
          });
          break;

        case 'till_opened':
          await this.emitEvent(PHARMACY_EVENTS.AUDIT.SYSTEM_EVENT_LOGGED, {
            eventType: 'till_opened',
            amount,
            userId: payload.userId,
            timestamp: Date.now()
          });
          break;

        case 'payment_processed':
          await this.handlePaymentEvent(payload);
          break;
      }

    } catch (error) {
      console.error('Error handling finance event:', error);
    }
  }

  async handlePaymentEvent(payload) {
    const { transactionId, method, amount, status, customerId } = payload;
    
    try {
      if (status === 'success') {
        // Update customer balance if applicable
        if (customerId && method === 'credit') {
          await this.emitEvent(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
            customerId,
            changeAmount: -amount,
            changeType: 'payment',
            transactionId
          });
        }

        // Update daily sales metrics
        await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.SALES_METRIC_UPDATED, {
          metric: 'daily_revenue',
          value: amount,
          method,
          timestamp: Date.now()
        });

        // Log successful payment
        await this.emitEvent(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
          type: 'payment_success',
          transactionId,
          amount,
          method,
          timestamp: Date.now()
        });

      } else {
        // Handle payment failure
        await this.emitEvent(PHARMACY_EVENTS.ALERTS.PAYMENT_FAILED, {
          transactionId,
          method,
          amount,
          reason: payload.errorMessage,
          timestamp: Date.now()
        });

        // Log failed payment
        await this.emitEvent(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
          type: 'payment_failure',
          transactionId,
          amount,
          method,
          error: payload.errorMessage,
          timestamp: Date.now()
        });
      }

    } catch (error) {
      console.error('Error handling payment event:', error);
    }
  }

  async handleSupplierEvent(payload) {
    const { eventType, supplierId, orderData, paymentData } = payload;
    
    try {
      // Update supplier and purchase stores
      await Promise.all([
        this.syncStoreIfActive('supplier'),
        this.syncStoreIfActive('purchase'),
        this.syncStoreIfActive('dashboard')
      ]);

      switch (eventType) {
        case 'order_created':
          await this.emitEvent(PHARMACY_EVENTS.AUDIT.ENTITY_CREATED, {
            entityType: 'purchase_order',
            entityId: orderData.orderId,
            supplierId,
            data: orderData
          });
          break;

        case 'delivery_received':
          await this.handleDeliveryReceived(payload);
          break;

        case 'payment_due':
          await this.emitEvent(PHARMACY_EVENTS.ALERTS.PAYMENT_DUE, {
            supplierId,
            amount: paymentData.amount,
            dueDate: paymentData.dueDate,
            orderIds: paymentData.orderIds
          });
          break;
      }

    } catch (error) {
      console.error('Error handling supplier event:', error);
    }
  }

  async handleDeliveryReceived(payload) {
    const { supplierId, deliveryData, items } = payload;
    
    try {
      // Update inventory for each received item
      for (const item of items) {
        await this.emitEvent(PHARMACY_EVENTS.INVENTORY.BATCH_ADDED, {
          productId: item.productId,
          batchData: {
            batchNumber: item.batchNumber,
            quantity: item.receivedQuantity,
            expiryDate: item.expiryDate,
            costPrice: item.costPrice,
            supplierId,
            receivedDate: Date.now()
          }
        });

        // Update product stock
        await this.emitEvent(PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED, {
          productId: item.productId,
          changeType: 'purchase_received',
          changeAmount: item.receivedQuantity,
          batchNumber: item.batchNumber
        });
      }

      // Update dashboard purchase metrics
      await this.emitEvent(PHARMACY_EVENTS.DASHBOARD.PURCHASE_RECORDED, {
        supplierId,
        totalItems: items.length,
        totalValue: items.reduce((sum, item) => sum + (item.costPrice * item.receivedQuantity), 0),
        deliveryId: deliveryData.deliveryId
      });

    } catch (error) {
      console.error('Error handling delivery received:', error);
    }
  }

  async handlePrescriptionEvent(payload) {
    const { eventType, prescriptionId, patientData, medicationData } = payload;
    
    try {
      // Update prescription and customer stores
      await Promise.all([
        this.syncStoreIfActive('customer'),
        this.syncStoreIfActive('sales'),
        this.syncStoreIfActive('audit')
      ]);

      switch (eventType) {
        case 'prescription_uploaded':
          await this.emitEvent(PHARMACY_EVENTS.AUDIT.ENTITY_CREATED, {
            entityType: 'prescription',
            entityId: prescriptionId,
            patientId: patientData.patientId,
            data: { ...prescriptionId, medications: medicationData }
          });
          break;

        case 'prescription_dispensed':
          await this.handlePrescriptionDispensed(payload);
          break;

        case 'controlled_substance_dispensed':
          await this.emitEvent(PHARMACY_EVENTS.AUDIT.COMPLIANCE_CHECK_PERFORMED, {
            type: 'controlled_substance',
            prescriptionId,
            medicationData,
            dispensedBy: payload.dispensedBy,
            timestamp: Date.now()
          });
          break;
      }

    } catch (error) {
      console.error('Error handling prescription event:', error);
    }
  }

  async handlePrescriptionDispensed(payload) {
    const { prescriptionId, medicationData, patientData, totalAmount } = payload;
    
    try {
      // Reduce inventory for dispensed medications
      for (const medication of medicationData) {
        await this.emitEvent(PHARMACY_EVENTS.INVENTORY.STOCK_REDUCED, {
          productId: medication.productId,
          quantity: medication.dispensedQuantity,
          reason: 'prescription_dispensed',
          prescriptionId,
          batchNumber: medication.batchNumber
        });
      }

      // Create sales transaction
      await this.emitEvent(PHARMACY_EVENTS.SALES.TRANSACTION_COMPLETED, {
        transactionType: 'prescription',
        prescriptionId,
        patientId: patientData.patientId,
        items: medicationData,
        total: totalAmount,
        timestamp: Date.now()
      });

      // Update patient record
      if (patientData.patientId) {
        await this.emitEvent(PHARMACY_EVENTS.CUSTOMER.PRESCRIPTION_FILLED, {
          customerId: patientData.patientId,
          prescriptionId,
          totalAmount,
          medicationCount: medicationData.length
        });
      }

    } catch (error) {
      console.error('Error handling prescription dispensed:', error);
    }
  }

  async handleNetworkEvent(payload) {
    const { eventType, connectionStatus, serverDetails } = payload;
    
    try {
      switch (eventType) {
        case 'offline':
          await this.emitEvent(PHARMACY_EVENTS.SYSTEM.OFFLINE_MODE_ENABLED, {
            timestamp: Date.now(),
            reason: payload.reason
          });
          
          // Enable offline queuing for all stores
          this.adapter.enableOfflineMode();
          break;

        case 'online':
          await this.emitEvent(PHARMACY_EVENTS.SYSTEM.ONLINE_MODE_RESTORED, {
            timestamp: Date.now(),
            downtime: payload.downtime
          });
          
          // Sync all stores when back online
          await this.emitEvent(PHARMACY_EVENTS.SYNC.STARTED, {
            reason: 'network_restored',
            storeCount: this.adapter.stores.size
          });
          
          await this.adapter.syncStores();
          break;

        case 'database_disconnected':
          await this.emitEvent(PHARMACY_EVENTS.ALERTS.DATABASE_CONNECTION_LOST, {
            serverDetails,
            timestamp: Date.now()
          });
          break;

        case 'sync_server_unavailable':
          await this.emitEvent(PHARMACY_EVENTS.ALERTS.SYNC_SERVER_UNAVAILABLE, {
            serverDetails,
            retryCount: payload.retryCount,
            timestamp: Date.now()
          });
          break;
      }

    } catch (error) {
      console.error('Error handling network event:', error);
    }
  }

  async handleHardwareEvent(payload) {
    const { eventType, deviceType, deviceStatus, errorDetails } = payload;
    
    try {
      switch (eventType) {
        case 'printer_offline':
          await this.emitEvent(PHARMACY_EVENTS.ALERTS.HARDWARE_ISSUE, {
            deviceType: 'printer',
            status: 'offline',
            impact: 'receipt_printing_disabled',
            timestamp: Date.now()
          });
          break;

        case 'battery_low':
          await this.emitEvent(PHARMACY_EVENTS.ALERTS.BATTERY_LOW, {
            deviceType,
            batteryLevel: payload.batteryLevel,
            estimatedTimeRemaining: payload.estimatedTime,
            timestamp: Date.now()
          });
          break;

        case 'cash_drawer_opened':
          await this.emitEvent(PHARMACY_EVENTS.AUDIT.HARDWARE_EVENT_LOGGED, {
            eventType: 'cash_drawer_opened',
            userId: payload.userId,
            reason: payload.reason,
            timestamp: Date.now()
          });
          break;

        case 'barcode_scanner_connected':
          await this.emitEvent(PHARMACY_EVENTS.SYSTEM.SCANNER_READY, {
            deviceId: payload.deviceId,
            capabilities: payload.capabilities,
            timestamp: Date.now()
          });
          break;
      }

    } catch (error) {
      console.error('Error handling hardware event:', error);
    }
  }

  // ===================================================================
  //  📊 ANALYTICS & MONITORING
  // ===================================================================

  getEventMetrics() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    const recentEvents = this.eventBuffer.filter(event => 
      event.timestamp > oneHourAgo
    );

    const eventCounts = recentEvents.reduce((counts, event) => {
      counts[event.eventName] = (counts[event.eventName] || 0) + 1;
      return counts;
    }, {});

    const errorEvents = recentEvents.filter(event => event.status === 'error');
    
    return {
      totalEvents: this.eventBuffer.length,
      recentEvents: recentEvents.length,
      errorEvents: errorEvents.length,
      errorRate: recentEvents.length > 0 ? (errorEvents.length / recentEvents.length) * 100 : 0,
      eventBreakdown: eventCounts,
      averageProcessingTime: this.calculateAverageProcessingTime(recentEvents),
      mostActiveStore: this.getMostActiveStore(recentEvents),
      healthStatus: this.getEventHandlerHealth()
    };
  }

  calculateAverageProcessingTime(events) {
    if (events.length === 0) return 0;
    
    const processingTimes = events
      .filter(event => event.processingTime)
      .map(event => event.processingTime);
      
    if (processingTimes.length === 0) return 0;
    
    return processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
  }

  getMostActiveStore(events) {
    const storeCounts = events.reduce((counts, event) => {
      // Extract store name from event payload if available
      const storeName = event.payload?.storeName || 'unknown';
      counts[storeName] = (counts[storeName] || 0) + 1;
      return counts;
    }, {});

    return Object.entries(storeCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none';
  }

  getEventHandlerHealth() {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    const recentEvents = this.eventBuffer.filter(event => 
      event.timestamp > fiveMinutesAgo
    );
    
    const recentErrors = recentEvents.filter(event => event.status === 'error');
    const errorRate = recentEvents.length > 0 ? (recentErrors.length / recentEvents.length) * 100 : 0;
    
    let health = 'healthy';
    if (errorRate > 20) health = 'critical';
    else if (errorRate > 10) health = 'warning';
    else if (recentEvents.length === 0 && this.eventBuffer.length > 0) health = 'stale';
    
    return {
      status: health,
      errorRate,
      recentActivity: recentEvents.length,
      lastEventTime: this.eventBuffer.length > 0 ? 
        Math.max(...this.eventBuffer.map(e => e.timestamp)) : null
    };
  }

  // ===================================================================
  //  🔧 DEBUGGING & UTILITIES
  // ===================================================================

  debugEventFlow(eventName) {
    const relatedEvents = this.eventBuffer.filter(event => 
      event.eventName === eventName
    );

    const flowAnalysis = {
      eventName,
      totalOccurrences: relatedEvents.length,
      successfulEvents: relatedEvents.filter(e => e.status === 'handled').length,
      failedEvents: relatedEvents.filter(e => e.status === 'error').length,
      averageTimeBetweenEvents: this.calculateAverageTimeBetween(relatedEvents),
      lastOccurrence: relatedEvents.length > 0 ? 
        Math.max(...relatedEvents.map(e => e.timestamp)) : null,
      commonErrors: this.getCommonErrors(relatedEvents),
      affectedStores: this.getAffectedStores(eventName)
    };

    console.log(`🔍 Event Flow Analysis for "${eventName}":`, flowAnalysis);
    return flowAnalysis;
  }

  calculateAverageTimeBetween(events) {
    if (events.length < 2) return 0;
    
    const sortedEvents = events.sort((a, b) => a.timestamp - b.timestamp);
    const intervals = [];
    
    for (let i = 1; i < sortedEvents.length; i++) {
      intervals.push(sortedEvents[i].timestamp - sortedEvents[i-1].timestamp);
    }
    
    return intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  }

  getCommonErrors(events) {
    const errorEvents = events.filter(e => e.status === 'error' && e.error);
    const errorCounts = errorEvents.reduce((counts, event) => {
      counts[event.error] = (counts[event.error] || 0) + 1;
      return counts;
    }, {});

    return Object.entries(errorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));
  }

  getAffectedStores(eventName) {
    const handler = this.eventHandlers.get(eventName);
    if (!handler) return [];

    // This would need to be enhanced based on actual handler implementation
    // For now, return stores that typically respond to this event type
    const eventStoreMapping = {
      [PHARMACY_EVENTS.PRODUCT.CREATED]: ['product', 'inventory', 'dashboard'],
      [PHARMACY_EVENTS.SALES.TRANSACTION_COMPLETED]: ['sales', 'inventory', 'dashboard', 'customer'],
      [PHARMACY_EVENTS.INVENTORY.STOCK_UPDATED]: ['inventory', 'product', 'dashboard'],
      // Add more mappings as needed
    };

    return eventStoreMapping[eventName] || [];
  }

  clearEventBuffer() {
    const clearedCount = this.eventBuffer.length;
    this.eventBuffer.length = 0;
    console.log(`🧹 Cleared ${clearedCount} events from buffer`);
    return clearedCount;
  }

  exportEventLog() {
    return {
      exportedAt: Date.now(),
      totalEvents: this.eventBuffer.length,
      events: [...this.eventBuffer],
      metrics: this.getEventMetrics(),
      handlers: Array.from(this.eventHandlers.keys())
    };
  }

  // ===================================================================
  //  🧹 CLEANUP
  // ===================================================================

  destroy() {
    console.log('🧹 Destroying StoreEventHandler...');
    
    // Clear event buffer
    this.eventBuffer.length = 0;
    
    // Clear event handlers
    this.eventHandlers.clear();
    
    // Reset references
    this.adapter = null;
    
    console.log('✅ StoreEventHandler destroyed');
  }
}
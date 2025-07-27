//src/utils/eventBus/managers/PharmacyTransactionManager.js
// =================================================================
//  🔄 ENHANCED TRANSACTION MANAGER FOR PHARMACY OPERATIONS
// =================================================================

import { PHARMACY_EVENTS } from '../events/eventDefinitions.js';

export class PharmacyTransactionManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.setupEnhancedListeners();
  }

  setupEnhancedListeners() {
    // Listen for authentication events
    this.eventBus.on(PHARMACY_EVENTS.USER.LOGIN, async (payload) => {
      await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.USER_ACTION_LOGGED, {
        action: 'USER_LOGIN',
        userId: payload.userId,
        userName: payload.userName,
        timestamp: Date.now()
      });
    });

    // Listen for inventory changes to trigger alerts
    this.eventBus.on(PHARMACY_EVENTS.INVENTORY.STOCK_LOW, async (payload) => {
      await this.eventBus.emit(PHARMACY_EVENTS.ALERTS.LOW_STOCK_ALERT, {
        productId: payload.productId,
        productName: payload.productName,
        currentStock: payload.currentStock,
        minimumLevel: payload.minimumLevel
      });
    });

    // Listen for expiry warnings
    this.eventBus.on(PHARMACY_EVENTS.PRODUCT.BATCH_EXPIRING_SOON, async (payload) => {
      await this.eventBus.emit(PHARMACY_EVENTS.ALERTS.EXPIRY_ALERT, {
        productId: payload.productId,
        batchNumber: payload.batchNumber,
        expiryDate: payload.expiryDate,
        daysRemaining: payload.daysRemaining
      });
    });
  }

  /**
   * Execute a sale transaction with rollback capability
   */
  async executeSaleTransaction(saleData, options = {}) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { items, customer, payment } = saleData;
      
      // Step 1: Reserve inventory
      await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_RESERVED, {
        items,
        reservedBy: transactionId
      }, { transactionId });
      
      // Add rollback for inventory reservation
      this.eventBus.addRollbackAction(transactionId, async () => {
        await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_RELEASED, {
          items,
          reservedBy: transactionId
        });
      }, 'Release reserved inventory');

      // Step 2: Process payment
      if (customer && payment.amount < saleData.total) {
        await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
          customerId: customer._id,
          amount: saleData.total - payment.amount,
          type: 'charge'
        }, { transactionId });
        
        // Add rollback for customer balance
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
            customerId: customer._id,
            amount: -(saleData.total - payment.amount),
            type: 'credit'
          });
        }, 'Reverse customer balance change');
      }

      // Step 3: Update inventory
      await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_REDUCED, {
        items,
        transactionId
      }, { transactionId });

      // Step 4: Record sale
      const saleResult = await this.eventBus.emit(PHARMACY_EVENTS.SALES.SALE_COMPLETED, {
        ...saleData,
        transactionId
      }, { transactionId });

      // Commit transaction
      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, transactionId, saleResult };

    } catch (error) {
      console.error('Sale transaction failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message, transactionId };
    }
  }

  /**
   * Execute a refund transaction with rollback capability
   */
  async executeRefundTransaction(refundData) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { originalSaleId, items, customer, refundAmount } = refundData;
      
      // Step 1: Restore inventory
      await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_RESTORED, {
        items,
        originalSaleId,
        transactionId
      }, { transactionId });
      
      // Add rollback for inventory restoration
      this.eventBus.addRollbackAction(transactionId, async () => {
        await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.STOCK_REDUCED, {
          items,
          transactionId
        });
      }, 'Re-reduce inventory after failed refund');

      // Step 2: Update customer balance
      if (customer) {
        await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
          customerId: customer._id,
          amount: -refundAmount,
          type: 'credit'
        }, { transactionId });
        
        // Add rollback for customer balance
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.CUSTOMER.BALANCE_UPDATED, {
            customerId: customer._id,
            amount: refundAmount,
            type: 'charge'
          });
        }, 'Reverse refund balance change');
      }

      // Step 3: Record refund
      const refundResult = await this.eventBus.emit(PHARMACY_EVENTS.SALES.REFUND_PROCESSED, {
        ...refundData,
        transactionId
      }, { transactionId });

      // Commit transaction
      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, transactionId, refundResult };

    } catch (error) {
      console.error('Refund transaction failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message, transactionId };
    }
  }

  /**
   * Enhanced sale transaction with comprehensive audit trail
   */
  async executeSaleTransactionWithAudit(saleData, options = {}) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      // Log transaction start
      await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
        transactionId,
        type: 'SALE_START',
        details: { customerId: saleData.customer?._id, itemCount: saleData.items.length }
      }, { transactionId });

      // Execute the sale
      const result = await this.executeSaleTransaction(saleData, options);

      // Log successful completion
      if (result.success) {
        await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
          transactionId,
          type: 'SALE_COMPLETED',
          details: { total: saleData.total, paymentMethod: saleData.payment.method }
        }, { transactionId });
      }

      return result;

    } catch (error) {
      // Log error
      await this.eventBus.emit(PHARMACY_EVENTS.AUDIT.TRANSACTION_LOGGED, {
        transactionId,
        type: 'SALE_ERROR',
        error: error.message
      }, { transactionId });
      
      throw error;
    }
  }

  /**
   * Purchase transaction with supplier integration
   */
  async executePurchaseTransaction(purchaseData) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { items, supplier, totals, amountPaid } = purchaseData;
      
      // Step 1: Validate purchase data
      await this.eventBus.emit(PHARMACY_EVENTS.PURCHASE.ORDER_CREATED, {
        supplierId: supplier._id,
        items,
        total: totals.grandTotal
      }, { transactionId });

      // Step 2: Update inventory
      for (const item of items) {
        await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.BATCH_ADDED, {
          productId: item.productId,
          batchData: {
            batchNumber: item.batchNumber,
            quantity: item.qty,
            purchasePrice: item.rate,
            retailPrice: item.retailPrice,
            expiryDate: item.expDate
          }
        }, { transactionId });

        // Add rollback for inventory
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.INVENTORY.BATCH_REMOVED, {
            productId: item.productId,
            batchNumber: item.batchNumber
          });
        }, `Remove batch ${item.batchNumber} for product ${item.productId}`);
      }

      // Step 3: Update supplier balance
      const amountDue = totals.grandTotal - amountPaid;
      if (amountDue > 0) {
        await this.eventBus.emit(PHARMACY_EVENTS.PURCHASE.SUPPLIER_BALANCE_UPDATED, {
          supplierId: supplier._id,
          amount: amountDue,
          type: 'purchase'
        }, { transactionId });

        // Add rollback for supplier balance
        this.eventBus.addRollbackAction(transactionId, async () => {
          await this.eventBus.emit(PHARMACY_EVENTS.PURCHASE.SUPPLIER_BALANCE_UPDATED, {
            supplierId: supplier._id,
            amount: -amountDue,
            type: 'adjustment'
          });
        }, 'Reverse supplier balance change');
      }

      // Commit transaction
      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, transactionId };

    } catch (error) {
      console.error('Purchase transaction failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message, transactionId };
    }
  }

  /**
   * Daily cash reconciliation transaction
   */
  async executeDailyCashReconciliation(reconciliationData) {
    const transactionId = this.eventBus.startTransaction();
    
    try {
      const { expectedCash, actualCash, userId, notes } = reconciliationData;
      const variance = actualCash - expectedCash;

      // Open till
      await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.TILL_OPENED, {
        userId,
        expectedCash,
        timestamp: Date.now()
      }, { transactionId });

      // Count cash
      await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.CASH_COUNTED, {
        userId,
        actualCash,
        variance,
        notes
      }, { transactionId });

      // Handle variance
      if (Math.abs(variance) > 0.01) { // More than 1 cent difference
        if (variance > 0) {
          await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.PROFIT_CALCULATED, {
            amount: variance,
            type: 'cash_overage',
            reconciliationId: transactionId
          }, { transactionId });
        } else {
          await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.LOSS_RECORDED, {
            amount: Math.abs(variance),
            type: 'cash_shortage',
            reconciliationId: transactionId
          }, { transactionId });
        }
      }

      // Close till
      await this.eventBus.emit(PHARMACY_EVENTS.FINANCE.TILL_CLOSED, {
        userId,
        finalCash: actualCash,
        variance,
        timestamp: Date.now()
      }, { transactionId });

      await this.eventBus.commitTransaction(transactionId);
      
      return { success: true, variance, transactionId };

    } catch (error) {
      console.error('Cash reconciliation failed:', error);
      await this.eventBus.rollbackTransaction(transactionId);
      return { success: false, error: error.message };
    }
  }
}
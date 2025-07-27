//src/utils/eventBus/events/eventDefinitions.js
// =================================================================
//  🏪 COMPREHENSIVE PHARMACY EVENT DEFINITIONS
// =================================================================

export const PHARMACY_EVENTS = {
  // Core Inventory Events
  INVENTORY: {
    PRODUCT_ADDED: 'inventory:product:added',
    PRODUCT_UPDATED: 'inventory:product:updated',
    PRODUCT_DELETED: 'inventory:product:deleted',
    BATCH_ADDED: 'inventory:batch:added',
    BATCH_UPDATED: 'inventory:batch:updated',
    BATCH_REMOVED: 'inventory:batch:removed',
    STOCK_LOW: 'inventory:stock:low',
    STOCK_OUT: 'inventory:stock:out',
    STOCK_RESERVED: 'inventory:stock:reserved',
    STOCK_RELEASED: 'inventory:stock:released',
    STOCK_REDUCED: 'inventory:stock:reduced',
    STOCK_RESTORED: 'inventory:stock:restored',
    EXPIRY_WARNING: 'inventory:expiry:warning',
    SYNC_REQUIRED: 'inventory:sync:required'
  },

  // Sales Events
  SALES: {
    SALE_STARTED: 'sales:sale:started',
    ITEM_ADDED: 'sales:item:added',
    ITEM_REMOVED: 'sales:item:removed',
    DISCOUNT_APPLIED: 'sales:discount:applied',
    SALE_COMPLETED: 'sales:sale:completed',
    SALE_CANCELLED: 'sales:sale:cancelled',
    REFUND_PROCESSED: 'sales:refund:processed',
    PAYMENT_RECEIVED: 'sales:payment:received'
  },

  // Customer Events
  CUSTOMER: {
    CREATED: 'customer:created',
    UPDATED: 'customer:updated',
    DELETED: 'customer:deleted',
    BALANCE_UPDATED: 'customer:balance:updated',
    PAYMENT_MADE: 'customer:payment:made'
  },

  // Cart Events
  CART: {
    ITEM_ADDED: 'cart:item:added',
    ITEM_REMOVED: 'cart:item:removed',
    QUANTITY_CHANGED: 'cart:quantity:changed',
    CLEARED: 'cart:cleared',
    CUSTOMER_SELECTED: 'cart:customer:selected',
    VALIDATION_FAILED: 'cart:validation:failed',
    PRICE_OVERRIDDEN: 'cart:price:overridden',
    BULK_DISCOUNT_APPLIED: 'cart:bulk_discount:applied',
    CUSTOMER_DISCOUNT_APPLIED: 'cart:customer_discount:applied',
    TAX_CALCULATED: 'cart:tax:calculated',
    TOTAL_RECALCULATED: 'cart:total:recalculated'
  },

  // 🔋 HARDWARE EVENTS (for POS systems)
  HARDWARE: {
    BATTERY_LOW: 'hardware:battery:low',
    BATTERY_CRITICAL: 'hardware:battery:critical',
    PRINTER_OFFLINE: 'hardware:printer:offline',
    PRINTER_ONLINE: 'hardware:printer:online',
    BARCODE_SCANNER_CONNECTED: 'hardware:scanner:connected',
    BARCODE_SCANNER_DISCONNECTED: 'hardware:scanner:disconnected',
    CASH_DRAWER_OPENED: 'hardware:cash_drawer:opened',
    CASH_DRAWER_CLOSED: 'hardware:cash_drawer:closed'
  },

  // 🔐 USER & AUTHENTICATION EVENTS
  USER: {
    LOGIN: 'user:login',
    LOGOUT: 'user:logout',
    SESSION_EXPIRED: 'user:session:expired',
    PERMISSION_DENIED: 'user:permission:denied',
    PRIVILEGE_UPDATED: 'user:privilege:updated',
    PASSWORD_CHANGED: 'user:password:changed',
    PIN_CHANGED: 'user:pin:changed',
    FAILED_LOGIN_ATTEMPT: 'user:login:failed'
  },

  // 🏪 STORE & SETTINGS EVENTS
  STORE: {
    SETTINGS_UPDATED: 'store:settings:updated',
    THEME_CHANGED: 'store:theme:changed',
    POS_VIEW_CHANGED: 'store:pos_view:changed',
    PAYMENT_METHODS_UPDATED: 'store:payment_methods:updated',
    ROLE_PRIVILEGES_UPDATED: 'store:role_privileges:updated',
    STORE_OPENING: 'store:opening',
    STORE_CLOSING: 'store:closing'
  },

  // 💾 DATA SYNCHRONIZATION EVENTS
  SYNC: {
    STARTED: 'sync:started',
    COMPLETED: 'sync:completed',
    FAILED: 'sync:failed',
    CONFLICT_DETECTED: 'sync:conflict:detected',
    CONFLICT_RESOLVED: 'sync:conflict:resolved',
    OFFLINE_CHANGES_QUEUED: 'sync:offline:queued',
    OFFLINE_CHANGES_SYNCED: 'sync:offline:synced'
  },

  // 📊 DASHBOARD & ANALYTICS EVENTS
  DASHBOARD: {
    INITIALIZED: 'dashboard:initialized',
    DEACTIVATED: 'dashboard:deactivated',
    DATA_REFRESHED: 'dashboard:data:refreshed',
    CACHE_CLEARED: 'dashboard:cache:cleared',
    FILTER_CHANGED: 'dashboard:filter:changed',
    EXPORT_REQUESTED: 'dashboard:export:requested',
    REPORT_GENERATED: 'dashboard:report:generated'
  },

  // 🏷️ ENHANCED PRODUCT EVENTS
  PRODUCT: {
    BARCODE_SCANNED: 'product:barcode:scanned',
    UNIT_CONVERSION_APPLIED: 'product:unit:converted',
    EXPIRY_CHECK_PERFORMED: 'product:expiry:checked',
    BATCH_EXPIRED: 'product:batch:expired',
    BATCH_EXPIRING_SOON: 'product:batch:expiring_soon',
    FEFO_APPLIED: 'product:fefo:applied',
    PRICE_UPDATED: 'product:price:updated',
    DISCOUNT_APPLIED: 'product:discount:applied'
  },

  // 💰 FINANCIAL EVENTS
  FINANCE: {
    CASH_COUNTED: 'finance:cash:counted',
    TILL_OPENED: 'finance:till:opened',
    TILL_CLOSED: 'finance:till:closed',
    DAILY_SALES_CALCULATED: 'finance:daily_sales:calculated',
    PROFIT_CALCULATED: 'finance:profit:calculated',
    LOSS_RECORDED: 'finance:loss:recorded',
    EXPENSE_RECORDED: 'finance:expense:recorded'
  },

  // 📋 AUDIT & COMPLIANCE EVENTS
  AUDIT: {
    TRANSACTION_LOGGED: 'audit:transaction:logged',
    USER_ACTION_LOGGED: 'audit:user_action:logged',
    SYSTEM_EVENT_LOGGED: 'audit:system_event:logged',
    COMPLIANCE_CHECK_PERFORMED: 'audit:compliance:checked',
    SUSPICIOUS_ACTIVITY_DETECTED: 'audit:suspicious:detected',
    DATA_INTEGRITY_CHECK: 'audit:data_integrity:checked'
  },

  // 🔄 PURCHASE & SUPPLIER EVENTS
  PURCHASE: {
    ORDER_CREATED: 'purchase:order:created',
    ORDER_SENT_TO_SUPPLIER: 'purchase:order:sent',
    DELIVERY_RECEIVED: 'purchase:delivery:received',
    QUALITY_CHECK_PERFORMED: 'purchase:quality:checked',
    RETURN_INITIATED: 'purchase:return:initiated',
    RETURN_COMPLETED: 'purchase:return:completed',
    SUPPLIER_PAYMENT_DUE: 'purchase:payment:due',
    SUPPLIER_BALANCE_UPDATED: 'purchase:supplier:balance_updated'
  },

  // 🏥 PRESCRIPTION & REGULATORY EVENTS
  PRESCRIPTION: {
    UPLOADED: 'prescription:uploaded',
    VERIFIED: 'prescription:verified',
    DISPENSED: 'prescription:dispensed',
    CONTROLLED_SUBSTANCE_DISPENSED: 'prescription:controlled:dispensed',
    INSURANCE_CLAIMED: 'prescription:insurance:claimed',
    DOCTOR_CONSULTED: 'prescription:doctor:consulted'
  },

  // 🚨 ALERT & NOTIFICATION EVENTS
  ALERTS: {
    LOW_STOCK_ALERT: 'alert:stock:low',
    OUT_OF_STOCK_ALERT: 'alert:stock:out',
    EXPIRY_ALERT: 'alert:expiry:warning',
    PRICE_CHANGE_ALERT: 'alert:price:changed',
    SYSTEM_ERROR_ALERT: 'alert:system:error',
    BACKUP_ALERT: 'alert:backup:required',
    SECURITY_ALERT: 'alert:security:breach'
  },

  // 🌐 NETWORK & CONNECTIVITY EVENTS
  NETWORK: {
    ONLINE: 'network:online',
    OFFLINE: 'network:offline',
    CONNECTION_SLOW: 'network:slow',
    DATABASE_CONNECTED: 'network:database:connected',
    DATABASE_DISCONNECTED: 'network:database:disconnected',
    API_TIMEOUT: 'network:api:timeout',
    SYNC_SERVER_UNAVAILABLE: 'network:sync:unavailable'
  },

  // System Events
  SYSTEM: {
    CACHE_UPDATED: 'system:cache:updated',
    SYNC_STARTED: 'system:sync:started',
    SYNC_COMPLETED: 'system:sync:completed',
    ERROR_OCCURRED: 'system:error:occurred',
    PERFORMANCE_WARNING: 'system:performance:warning'
  }
};
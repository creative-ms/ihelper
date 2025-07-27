// ===================================
// src/utils/cache/databases.js - Updated database instances
// ===================================
import PouchDB from 'pouchdb-browser';

// Existing databases
export const productsDB = new PouchDB('pharmacy_products');
export const batchesDB = new PouchDB('pharmacy_batches');
export const searchCacheDB = new PouchDB('pharmacy_search_cache');
export const inventoryStatsDB = new PouchDB('pharmacy_inventory_stats');
export const syncMetadataDB = new PouchDB('pharmacy_sync_metadata');
export const purchasesDB = new PouchDB('pharmacy_purchases');

// Transaction databases
export const transactionsDB = new PouchDB('pharmacy_transactions');
export const returnsDB = new PouchDB('pharmacy_returns');
export const transactionStatsDB = new PouchDB('pharmacy_transaction_stats');

// Sales databases (needed for SalesCache)
export const salesDB = new PouchDB('pharmacy_sales');
export const salesStatsDB = new PouchDB('pharmacy_sales_stats');

// Dashboard cache databases
export const dashboardStatsDB = new PouchDB('pharmacy_dashboard_stats');
export const chartDataDB = new PouchDB('pharmacy_chart_data');
export const productAnalyticsDB = new PouchDB('pharmacy_product_analytics');
export const peakHoursDB = new PouchDB('pharmacy_peak_hours');
export const heatmapDataDB = new PouchDB('pharmacy_heatmap_data');
export const dashboardMetadataDB = new PouchDB('pharmacy_dashboard_metadata');
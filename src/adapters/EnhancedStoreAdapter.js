// src/adapters/EnhancedStoreAdapter.js - IMPROVED VERSION
// ===================================================================
//  🚀 ENHANCED STORE ADAPTER - IMPROVED WITH FIXES
// ===================================================================

import { StoreAdapter } from './StoreAdapter.js';
import { PHARMACY_EVENTS } from '../utils/eventBus/index.js';

export class EnhancedStoreAdapter extends StoreAdapter {
  constructor(config = {}) {
    super(config);
    
    // Enhanced features
    this.offlineMode = false;
    this.offlineQueue = [];
    this.conflictResolver = null;
    this.syncStrategy = config.SYNC_STRATEGY || 'merge';
    this.lastSyncTimestamp = null;
    this.syncLocks = new Map();
    this.retryQueue = [];
    this.eventHandler = null;
    
    // Advanced monitoring
    this.networkStatus = 'online';
    this.syncHealth = {
      consecutiveFailures: 0,
      lastSuccessfulSync: null,
      averageSyncTime: 0,
      syncTimes: []
    };
    
    // Batch processing - IMPROVED
    this.batchProcessor = null;
    this.batchSize = config.BATCH_SIZE || 50;
    this.batchTimeout = config.BATCH_TIMEOUT || 5000;
    this.maxBatchRetries = config.MAX_BATCH_RETRIES || 3;
    
    // Connection monitoring - NEW
    this.connectionMonitor = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.MAX_RECONNECT_ATTEMPTS || 5;
    
    // Enhanced conflict resolution - NEW
    this.conflictStrategies = new Map([
      ['inventory', 'merge_with_validation'],
      ['sales', 'timestamp_based'],
      ['audit', 'append_only'],
      ['auth', 'server_authoritative'],
      ['settings', 'manual_review']
    ]);
    
    console.log('🚀 Enhanced Store Adapter initialized with improvements');
  }

  // ===================================================================
  //  🔌 IMPROVED OFFLINE MODE MANAGEMENT
  // ===================================================================

  async enableOfflineMode(reason = 'unknown') {
    if (this.offlineMode) return;
    
    console.log(`📴 Enabling offline mode - Reason: ${reason}`);
    this.offlineMode = true;
    this.networkStatus = 'offline';
    
    // Store the reason for going offline
    this.offlineReason = reason;
    this.offlineStartTime = Date.now();
    
    // Enhanced offline preparation
    await this.prepareForOfflineMode();
    
    // Notify all stores about offline mode
    await this.notifyStoresOfflineMode(true);
    
    // Start offline queue monitoring
    this.monitorOfflineQueue();
    
    // Emit enhanced offline event
    if (this.eventBus && PHARMACY_EVENTS.NETWORK?.OFFLINE) {
      await this.eventBus.emit(PHARMACY_EVENTS.NETWORK.OFFLINE, {
        timestamp: Date.now(),
        reason,
        queuedOperations: this.offlineQueue.length,
        affectedStores: this.stores.size
      });
    }
    
    console.log('✅ Offline mode enabled with enhanced features');
  }

  async disableOfflineMode() {
    if (!this.offlineMode) return;
    
    const offlineDuration = Date.now() - this.offlineStartTime;
    console.log(`🔌 Disabling offline mode - Was offline for ${offlineDuration}ms`);
    
    this.offlineMode = false;
    this.networkStatus = 'online';
    
    // Process offline queue with retry logic
    const processResult = await this.processOfflineQueueWithRetry();
    
    // Enhanced conflict detection and resolution
    await this.detectAndResolvePostOfflineConflicts();
    
    // Notify all stores about online mode
    await this.notifyStoresOfflineMode(false);
    
    // Comprehensive sync after coming back online
    await this.performPostOfflineSync();
    
    // Emit enhanced online event
    if (this.eventBus && PHARMACY_EVENTS.NETWORK?.ONLINE) {
      await this.eventBus.emit(PHARMACY_EVENTS.NETWORK.ONLINE, {
        timestamp: Date.now(),
        offlineDuration,
        processedOperations: processResult.successful,
        failedOperations: processResult.failed,
        conflictsResolved: processResult.conflictsResolved
      });
    }
    
    // Reset offline counters
    this.offlineReason = null;
    this.offlineStartTime = null;
    this.reconnectAttempts = 0;
    
    console.log('✅ Online mode restored with enhanced recovery');
  }

  async prepareForOfflineMode() {
    // Cache critical data
    for (const [storeName, store] of this.stores.entries()) {
      if (store.isActive) {
        try {
          const storeState = store.hook.getState();
          if (typeof storeState.cacheForOffline === 'function') {
            await storeState.cacheForOffline();
          }
        } catch (error) {
          console.error(`Failed to cache data for offline mode in store "${storeName}":`, error);
        }
      }
    }
    
    // Create state snapshot for conflict detection
    this.preOfflineSnapshot = await this.createDetailedStateSnapshot();
  }

  async processOfflineQueueWithRetry() {
    if (this.offlineQueue.length === 0) {
      return { successful: 0, failed: 0, conflictsResolved: 0 };
    }
    
    console.log(`🔄 Processing ${this.offlineQueue.length} offline operations with retry logic...`);
    
    const results = {
      successful: 0,
      failed: 0,
      conflictsResolved: 0,
      operations: []
    };
    
    // Group operations by priority and dependency
    const prioritizedQueue = this.prioritizeOfflineOperations(this.offlineQueue);
    
    for (const operation of prioritizedQueue) {
      let success = false;
      let attempts = 0;
      
      while (!success && attempts < this.maxBatchRetries) {
        try {
          // Check for conflicts before execution
          const conflicts = await this.detectOperationConflicts(operation);
          if (conflicts.length > 0) {
            await this.resolveOperationConflicts(operation, conflicts);
            results.conflictsResolved += conflicts.length;
          }
          
          // Execute operation
          const result = await this.executeOfflineOperation(operation);
          results.operations.push({
            id: operation.id,
            success: true,
            result,
            attempts: attempts + 1
          });
          
          results.successful++;
          success = true;
          
        } catch (error) {
          attempts++;
          console.error(`Offline operation ${operation.id} failed (attempt ${attempts}):`, error);
          
          if (attempts >= this.maxBatchRetries) {
            results.operations.push({
              id: operation.id,
              success: false,
              error: error.message,
              attempts
            });
            results.failed++;
            
            // Add to retry queue for later
            if (this.shouldRetryLater(operation, error)) {
              this.retryQueue.push({
                ...operation,
                failedAttempts: attempts,
                lastError: error.message,
                nextRetryAt: Date.now() + this.getRetryDelay(attempts)
              });
            }
          } else {
            // Wait before retry with exponential backoff
            await this.sleep(Math.pow(2, attempts) * 1000);
          }
        }
      }
    }
    
    // Clear successfully processed operations
    this.offlineQueue = this.offlineQueue.filter(op => 
      !results.operations.find(r => r.id === op.id && r.success)
    );
    
    console.log(`✅ Offline queue processed: ${results.successful}/${results.successful + results.failed} successful`);
    return results;
  }

  prioritizeOfflineOperations(operations) {
    // Sort by priority and dependencies
    return operations.sort((a, b) => {
      // Higher priority first
      const priorityDiff = (b.priority || 0) - (a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      
      // Earlier timestamp first for same priority
      return a.queuedAt - b.queuedAt;
    });
  }

  async detectOperationConflicts(operation) {
    const conflicts = [];
    
    if (!this.preOfflineSnapshot) return conflicts;
    
    const { storeName, type } = operation;
    if (!storeName) return conflicts;
    
    try {
      const currentState = this.getStoreState(storeName);
      const snapshotState = this.preOfflineSnapshot.storeStates[storeName]?.state;
      
      if (!currentState || !snapshotState) return conflicts;
      
      // Compare states and detect conflicts
      const stateConflicts = this.compareStatesForConflicts(
        snapshotState, 
        currentState, 
        operation
      );
      
      conflicts.push(...stateConflicts);
      
    } catch (error) {
      console.error(`Error detecting conflicts for operation ${operation.id}:`, error);
    }
    
    return conflicts;
  }

  compareStatesForConflicts(oldState, newState, operation) {
    const conflicts = [];
    
    // Check version conflicts
    if (oldState.version && newState.version && oldState.version !== newState.version) {
      conflicts.push({
        type: 'version_conflict',
        field: 'version',
        oldValue: oldState.version,
        newValue: newState.version,
        operation
      });
    }
    
    // Check timestamp conflicts  
    if (oldState.lastModified && newState.lastModified) {
      const timeDiff = Math.abs(newState.lastModified - oldState.lastModified);
      if (timeDiff > 1000) { // More than 1 second difference
        conflicts.push({
          type: 'timestamp_conflict',
          field: 'lastModified',
          oldValue: oldState.lastModified,
          newValue: newState.lastModified,
          operation
        });
      }
    }
    
    // Check data integrity conflicts
    const criticalFields = this.getCriticalFieldsForStore(operation.storeName);
    for (const field of criticalFields) {
      if (this.hasFieldConflict(oldState[field], newState[field])) {
        conflicts.push({
          type: 'data_conflict',
          field,
          oldValue: oldState[field],
          newValue: newState[field],
          operation
        });
      }
    }
    
    return conflicts;
  }

  getCriticalFieldsForStore(storeName) {
    const criticalFieldsMap = {
      'inventory': ['products', 'batches', 'stock'],
      'sales': ['transactions', 'receipts', 'totalRevenue'],
      'product': ['products', 'categories', 'brands'],
      'customer': ['customers'],
      'supplier': ['suppliers'],
      'audit': ['logs', 'activities']
    };
    
    return criticalFieldsMap[storeName] || [];
  }

  hasFieldConflict(oldValue, newValue) {
    if (oldValue === newValue) return false;
    
    // Handle arrays
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      return oldValue.length !== newValue.length ||
             !oldValue.every((item, index) => 
               JSON.stringify(item) === JSON.stringify(newValue[index])
             );
    }
    
    // Handle objects
    if (typeof oldValue === 'object' && typeof newValue === 'object') {
      return JSON.stringify(oldValue) !== JSON.stringify(newValue);
    }
    
    return true;
  }

  async resolveOperationConflicts(operation, conflicts) {
    console.log(`🔧 Resolving ${conflicts.length} conflicts for operation ${operation.id}`);
    
    const strategy = this.conflictStrategies.get(operation.storeName) || 'merge';
    
    for (const conflict of conflicts) {
      try {
        await this.resolveConflictByStrategy(conflict, strategy);
      } catch (error) {
        console.error(`Failed to resolve conflict for ${operation.id}:`, error);
      }
    }
  }

  async resolveConflictByStrategy(conflict, strategy) {
    switch (strategy) {
      case 'merge_with_validation':
        await this.mergeConflictWithValidation(conflict);
        break;
      case 'timestamp_based':
        await this.resolveTimestampBasedConflict(conflict);
        break;
      case 'append_only':
        await this.appendOnlyConflictResolution(conflict);
        break;
      case 'server_authoritative':
        await this.serverAuthoritativeResolution(conflict);
        break;
      case 'manual_review':
        await this.queueForManualReview(conflict);
        break;
      default:
        console.warn(`Unknown conflict resolution strategy: ${strategy}`);
    }
  }

  async mergeConflictWithValidation(conflict) {
    // Implement smart merging with validation
    console.log(`🔀 Merging conflict with validation: ${conflict.type}`);
    
    // Example implementation - would be customized per conflict type
    const mergedValue = this.smartMerge(conflict.oldValue, conflict.newValue, conflict.field);
    
    // Validate merged result
    if (await this.validateMergedValue(mergedValue, conflict.field)) {
      await this.applyMergedValue(conflict.operation.storeName, conflict.field, mergedValue);
    } else {
      throw new Error(`Merged value validation failed for ${conflict.field}`);
    }
  }

  smartMerge(oldValue, newValue, field) {
    // Field-specific merge logic
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      // For arrays, merge unique items by ID
      const oldIds = new Set(oldValue.map(item => item._id || item.id).filter(Boolean));
      const newItems = newValue.filter(item => 
        !oldIds.has(item._id || item.id)
      );
      return [...oldValue, ...newItems];
    }
    
    if (typeof oldValue === 'object' && typeof newValue === 'object') {
      // For objects, merge properties
      return { ...oldValue, ...newValue };
    }
    
    // For primitives, prefer newer value
    return newValue;
  }

  async validateMergedValue(value, field) {
    // Validation logic based on field type
    if (!value) return false;
    
    if (Array.isArray(value)) {
      // Check for duplicate IDs
      const ids = value.map(item => item._id || item.id).filter(Boolean);
      return ids.length === new Set(ids).size;
    }
    
    return true;
  }

  async applyMergedValue(storeName, field, value) {
    const store = this.stores.get(storeName);
    if (!store) return;
    
    const storeState = store.hook.getState();
    if (typeof storeState.updateField === 'function') {
      await storeState.updateField(field, value);
    }
  }

  // ===================================================================
  //  🔄 ENHANCED SYNCHRONIZATION METHODS
  // ===================================================================

  async performPostOfflineSync() {
    console.log('🔄 Performing comprehensive post-offline sync...');
    
    try {
      // Full state reconciliation
      await this.reconcileAllStoreStates();
      
      // Verify data integrity
      await this.verifyDataIntegrityPostSync();
      
      // Update sync timestamps
      this.lastSyncTimestamp = Date.now();
      
      // Emit sync completion
      if (this.eventBus && PHARMACY_EVENTS.SYSTEM?.POST_OFFLINE_SYNC_COMPLETED) {
        await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.POST_OFFLINE_SYNC_COMPLETED, {
          timestamp: this.lastSyncTimestamp,
          reconciledStores: this.stores.size
        });
      }
      
      console.log('✅ Post-offline sync completed successfully');
      
    } catch (error) {
      console.error('❌ Post-offline sync failed:', error);
      throw error;
    }
  }

  async reconcileAllStoreStates() {
    const reconciliationResults = [];
    
    for (const [storeName, store] of this.stores.entries()) {
      if (!store.isActive) continue;
      
      try {
        const result = await this.reconcileStoreState(storeName);
        reconciliationResults.push({ store: storeName, success: true, result });
      } catch (error) {
        console.error(`Store reconciliation failed for ${storeName}:`, error);
        reconciliationResults.push({ store: storeName, success: false, error: error.message });
      }
    }
    
    return reconciliationResults;
  }

  async reconcileStoreState(storeName) {
    const store = this.stores.get(storeName);
    const currentState = store.hook.getState();
    
    // Compare with pre-offline snapshot
    if (this.preOfflineSnapshot?.storeStates[storeName]) {
      const snapshotState = this.preOfflineSnapshot.storeStates[storeName].state;
      const changes = this.calculateStateChanges(snapshotState, currentState);
      
      if (changes.length > 0) {
        console.log(`📊 Reconciling ${changes.length} changes in store ${storeName}`);
        await this.applyStateReconciliation(storeName, changes);
      }
    }
    
    // Force fresh data fetch if available
    if (typeof currentState.fetchLatestData === 'function') {
      await currentState.fetchLatestData();
    }
    
    return { changesApplied: changes?.length || 0 };
  }

  calculateStateChanges(oldState, newState) {
    const changes = [];
    
    // Compare key fields
    const fieldsToCompare = ['products', 'inventory', 'sales', 'customers', 'suppliers'];
    
    for (const field of fieldsToCompare) {
      if (oldState[field] !== undefined && newState[field] !== undefined) {
        if (JSON.stringify(oldState[field]) !== JSON.stringify(newState[field])) {
          changes.push({
            field,
            type: 'modified',
            oldValue: oldState[field],
            newValue: newState[field]
          });
        }
      }
    }
    
    return changes;
  }

  async applyStateReconciliation(storeName, changes) {
    const store = this.stores.get(storeName);
    const storeState = store.hook.getState();
    
    for (const change of changes) {
      try {
        // Apply change based on conflict resolution strategy
        const strategy = this.conflictStrategies.get(storeName) || 'merge';
        
        if (strategy === 'merge_with_validation') {
          const mergedValue = this.smartMerge(change.oldValue, change.newValue, change.field);
          if (await this.validateMergedValue(mergedValue, change.field)) {
            await this.applyMergedValue(storeName, change.field, mergedValue);
          }
        }
        
      } catch (error) {
        console.error(`Failed to apply reconciliation for ${storeName}.${change.field}:`, error);
      }
    }
  }

  async verifyDataIntegrityPostSync() {
    console.log('🔍 Verifying data integrity post-sync...');
    
    const integrityResults = [];
    
    for (const [storeName, store] of this.stores.entries()) {
      if (!store.isActive) continue;
      
      try {
        const isValid = await this.verifyStoreIntegrity(storeName);
        integrityResults.push({ store: storeName, valid: isValid });
        
        if (!isValid) {
          console.warn(`⚠️ Integrity check failed for store: ${storeName}`);
        }
        
      } catch (error) {
        console.error(`Integrity verification error for ${storeName}:`, error);
        integrityResults.push({ store: storeName, valid: false, error: error.message });
      }
    }
    
    const failedStores = integrityResults.filter(r => !r.valid);
    if (failedStores.length > 0) {
      console.warn(`⚠️ ${failedStores.length} stores failed integrity verification`);
    }
    
    return integrityResults;
  }

  async verifyStoreIntegrity(storeName) {
    const store = this.stores.get(storeName);
    const storeState = store.hook.getState();
    
    // Check if store has custom integrity verification
    if (typeof storeState.verifyIntegrity === 'function') {
      return await storeState.verifyIntegrity();
    }
    
    // Basic integrity checks
    const basicChecks = [
      () => !storeState.error,
      () => storeState.isInitialized !== false,
      () => !storeState.corruptionDetected
    ];
    
    return basicChecks.every(check => {
      try {
        return check();
      } catch {
        return false;
      }
    });
  }

  // ===================================================================
  //  🔧 UTILITY METHODS
  // ===================================================================

  async notifyStoresOfflineMode(isOffline) {
    const methodName = isOffline ? 'enableOfflineMode' : 'disableOfflineMode';
    
    for (const [storeName, store] of this.stores.entries()) {
      if (store.isActive) {
        try {
          const storeState = store.hook.getState();
          if (typeof storeState[methodName] === 'function') {
            await storeState[methodName]();
          }
        } catch (error) {
          console.error(`Error ${methodName} for store "${storeName}":`, error);
        }
      }
    }
  }

  monitorOfflineQueue() {
    // Start monitoring offline queue size and health
    if (this.offlineQueueMonitor) {
      clearInterval(this.offlineQueueMonitor);
    }
    
    this.offlineQueueMonitor = setInterval(() => {
      if (!this.offlineMode) {
        clearInterval(this.offlineQueueMonitor);
        return;
      }
      
      // Log queue status
      if (this.offlineQueue.length > 100) {
        console.warn(`⚠️ Large offline queue: ${this.offlineQueue.length} operations`);
      }
      
      // Check for stuck operations
      const now = Date.now();
      const stuckOperations = this.offlineQueue.filter(op => 
        now - op.queuedAt > 5 * 60 * 1000 // 5 minutes
      );
      
      if (stuckOperations.length > 0) {
        console.warn(`⚠️ ${stuckOperations.length} operations stuck in offline queue`);
      }
      
    }, 30000); // Check every 30 seconds
  }

  async detectAndResolvePostOfflineConflicts() {
    if (!this.preOfflineSnapshot) return;
    
    console.log('🔍 Detecting post-offline conflicts...');
    
    const conflictResults = [];
    
    for (const [storeName, store] of this.stores.entries()) {
      if (!store.isActive) continue;
      
      try {
        const currentState = store.hook.getState();
        const snapshotState = this.preOfflineSnapshot.storeStates[storeName]?.state;
        
        if (snapshotState) {
          const conflicts = this.compareStatesForConflicts(snapshotState, currentState, { storeName });
          
          if (conflicts.length > 0) {
            console.log(`⚠️ Found ${conflicts.length} conflicts in store ${storeName}`);
            
            for (const conflict of conflicts) {
              await this.resolveConflictByStrategy(conflict, this.conflictStrategies.get(storeName) || 'merge');
            }
            
            conflictResults.push({ store: storeName, conflicts: conflicts.length, resolved: true });
          }
        }
        
      } catch (error) {
        console.error(`Error detecting conflicts for ${storeName}:`, error);
        conflictResults.push({ store: storeName, conflicts: 0, resolved: false, error: error.message });
      }
    }
    
    const totalConflicts = conflictResults.reduce((sum, result) => sum + result.conflicts, 0);
    if (totalConflicts > 0) {
      console.log(`✅ Resolved ${totalConflicts} post-offline conflicts`);
    }
    
    return conflictResults;
  }

  async createDetailedStateSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      storeStates: {},
      systemMetrics: this.getAdapterMetrics()
    };
    
    for (const [storeName, store] of this.stores.entries()) {
      if (store.isActive) {
        try {
          const state = store.hook.getState();
          snapshot.storeStates[storeName] = {
            state: JSON.parse(JSON.stringify(state)), // Deep copy
            lastSync: store.lastSync,
            version: state.version || 1,
            checksum: this.calculateStateChecksum(state)
          };
        } catch (error) {
          console.error(`Failed to snapshot store ${storeName}:`, error);
          snapshot.storeStates[storeName] = { error: error.message };
        }
      }
    }
    
    return snapshot;
  }

  calculateStateChecksum(state) {
    try {
      // Simple checksum calculation
      const stateString = JSON.stringify(state);
      let hash = 0;
      for (let i = 0; i < stateString.length; i++) {
        const char = stateString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash.toString(16);
    } catch {
      return 'unknown';
    }
  }

  shouldRetryLater(operation, error) {
    // Determine if operation should be retried later based on error type
    const retryableErrors = [
      'network',
      'timeout',
      'connection',
      'unavailable',
      'busy'
    ];
    
    const errorMessage = error.message.toLowerCase();
    return retryableErrors.some(keyword => errorMessage.includes(keyword));
  }

  getRetryDelay(attempts) {
    // Exponential backoff with jitter
    const baseDelay = 1000; // 1 second
    const maxDelay = 60000; // 1 minute
    const exponentialDelay = baseDelay * Math.pow(2, attempts);
    const jitter = Math.random() * 1000; // Add up to 1 second jitter
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===================================================================
  //  🧹 ENHANCED CLEANUP
  // ===================================================================

  async destroy() {
    console.log('🧹 Destroying Enhanced Store Adapter...');
    
    // Stop monitoring
    if (this.offlineQueueMonitor) {
      clearInterval(this.offlineQueueMonitor);
      this.offlineQueueMonitor = null;
    }
    
    // Stop batch processing
    if (this.batchProcessor?.processInterval) {
      clearInterval(this.batchProcessor.processInterval);
      this.batchProcessor = null;
    }
    
    // Process remaining batches
    if (this.batchProcessor?.batches.size > 0) {
      await this.processBatches();
    }
    
    // Clear queues
    this.offlineQueue.length = 0;
    this.retryQueue.length = 0;
    this.syncLocks.clear();
    
    // Clear snapshots
    this.preOfflineSnapshot = null;
    
    // Destroy event handler
    if (this.eventHandler) {
      this.eventHandler.destroy();
      this.eventHandler = null;
    }
    
    // Call parent destroy
    await super.destroy();
    
    console.log('✅ Enhanced Store Adapter destroyed');
  }

  // ===================================================================
  //  📊 ENHANCED METRICS & MONITORING
  // ===================================================================

  getEnhancedMetrics() {
    const baseMetrics = super.getAdapterMetrics();
    
    return {
      ...baseMetrics,
      enhanced: {
        offlineMode: this.offlineMode,
        networkStatus: this.networkStatus,
        offlineQueueSize: this.offlineQueue.length,
        retryQueueSize: this.retryQueue.length,
        lastSyncTimestamp: this.lastSyncTimestamp,
        syncHealth: { ...this.syncHealth },
        activeSyncLocks: this.syncLocks.size,
        conflictStrategies: Object.fromEntries(this.conflictStrategies),
        reconnectAttempts: this.reconnectAttempts,
        batchProcessor: this.batchProcessor ? {
          activeBatches: this.batchProcessor.batches.size,
          processing: this.batchProcessor.processing
        } : null
      }
    };
  }

  getSystemHealth() {
    const baseHealth = super.getStoreHealth();
    const now = Date.now();
    
    // Determine enhanced health status
    let enhancedStatus = 'healthy';
    const issues = [...baseHealth.issues];
    
    // Check sync health
    if (this.syncHealth.consecutiveFailures > 3) {
      enhancedStatus = 'critical';
      issues.push('Multiple consecutive sync failures');
    } else if (this.syncHealth.consecutiveFailures > 0) {
      enhancedStatus = 'warning';
      issues.push('Recent sync failures detected');
    }
    
    // Check offline queue size
    if (this.offlineQueue.length > 100) {
      enhancedStatus = 'warning';
      issues.push('Large offline operation queue');
    }
    
    // Check last sync time
    if (this.lastSyncTimestamp && now - this.lastSyncTimestamp > 2 * this.config.AUTO_SYNC_INTERVAL) {
      enhancedStatus = 'warning';
      issues.push('Sync overdue');
    }
    
    // Check retry queue
    if (this.retryQueue.length > 10) {
      enhancedStatus = 'warning';
      issues.push('High number of failed operations in retry queue');
    }
    
    // Check sync locks (potential deadlocks)
    if (this.syncLocks.size > 5) {
      enhancedStatus = 'warning';
      issues.push('Multiple sync operations running simultaneously');
    }
    
    return {
      ...baseHealth,
      enhanced: {
        status: enhancedStatus,
        issues,
        metrics: this.getEnhancedMetrics().enhanced,
        recommendations: this.generateHealthRecommendations(),
        offlineMode: this.offlineMode,
        networkStatus: this.networkStatus
      }
    };
  }

  generateHealthRecommendations() {
    const recommendations = [];
    
    if (this.syncHealth.consecutiveFailures > 0) {
      recommendations.push('Consider checking network connectivity and server status');
    }
    
    if (this.offlineQueue.length > 50) {
      recommendations.push('Process offline queue when network is stable');
    }
    
    if (this.syncHealth.averageSyncTime > 10000) {
      recommendations.push('Sync performance is slow, consider optimizing store operations');
    }
    
    if (this.retryQueue.length > 10) {
      recommendations.push('High retry queue indicates persistent operation failures');
    }
    
    if (this.syncLocks.size > 3) {
      recommendations.push('Consider reducing concurrent sync operations');
    }
    
    if (this.batchProcessor && this.batchProcessor.batches.size > 20) {
      recommendations.push('Large number of pending batches, consider increasing batch processing frequency');
    }
    
    return recommendations;
  }

  // ===================================================================
  //  🔄 RETRY MECHANISM
  // ===================================================================

  async processRetryQueue() {
    if (this.retryQueue.length === 0) return;
    
    console.log(`🔄 Processing ${this.retryQueue.length} retry operations...`);
    
    const retryResults = [];
    const failedRetries = [];
    
    for (const operation of this.retryQueue) {
      try {
        // Check if we should retry this operation
        if (this.shouldRetryOperation(operation)) {
          const result = await this.executeOfflineOperation(operation);
          retryResults.push({ operation: operation.id, success: true, result });
          console.log(`✅ Retry successful for operation ${operation.id}`);
        } else {
          failedRetries.push(operation);
          console.log(`❌ Maximum retries exceeded for operation ${operation.id}`);
        }
      } catch (error) {
        operation.retryCount = (operation.retryCount || 0) + 1;
        operation.lastRetryError = error.message;
        operation.nextRetryAt = Date.now() + this.calculateRetryDelay(operation.retryCount);
        
        if (operation.retryCount >= (operation.maxRetries || 3)) {
          failedRetries.push(operation);
          console.error(`❌ Final retry failed for operation ${operation.id}:`, error);
        } else {
          console.warn(`⚠️ Retry ${operation.retryCount} failed for operation ${operation.id}, will retry later`);
        }
      }
    }
    
    // Remove successful and permanently failed operations
    this.retryQueue = this.retryQueue.filter(op => 
      !retryResults.find(r => r.operation === op.id && r.success) &&
      !failedRetries.find(f => f.id === op.id)
    );
    
    // Emit retry completion event
    if (this.eventBus && PHARMACY_EVENTS?.SYSTEM?.RETRY_QUEUE_PROCESSED) {
      await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.RETRY_QUEUE_PROCESSED, {
        timestamp: Date.now(),
        successful: retryResults.length,
        failed: failedRetries.length,
        remaining: this.retryQueue.length
      });
    }
    
    return { successful: retryResults, failed: failedRetries, remaining: this.retryQueue.length };
  }

  shouldRetryOperation(operation) {
    const now = Date.now();
    const retryCount = operation.retryCount || 0;
    const maxRetries = operation.maxRetries || 3;
    const nextRetryAt = operation.nextRetryAt || 0;
    
    return retryCount < maxRetries && now >= nextRetryAt;
  }

  calculateRetryDelay(retryCount) {
    // Exponential backoff: 1s, 2s, 4s, 8s, etc.
    const baseDelay = 1000;
    const maxDelay = 30000; // 30 seconds max
    const delay = Math.min(baseDelay * Math.pow(2, retryCount - 1), maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 1000;
    return delay + jitter;
  }

  // ===================================================================
  //  🔍 ADVANCED MONITORING & ANALYTICS
  // ===================================================================

  startAdvancedMonitoring() {
    // Monitor offline queue health
    this.offlineQueueMonitor = setInterval(() => {
      if (this.offlineQueue.length > 0) {
        const oldestOperation = this.offlineQueue.reduce((oldest, current) => 
          current.queuedAt < oldest.queuedAt ? current : oldest
        );
        
        const queueTime = Date.now() - oldestOperation.queuedAt;
        
        if (queueTime > 5 * 60 * 1000) { // 5 minutes
          console.warn(`⚠️ Oldest offline operation has been queued for ${queueTime}ms`);
        }
        
        if (this.offlineQueue.length > 500) {
          console.warn(`⚠️ Offline queue is getting large: ${this.offlineQueue.length} operations`);
        }
      }
    }, 30000); // Check every 30 seconds
    
    // Monitor sync health
    this.syncHealthMonitor = setInterval(() => {
      if (this.syncHealth.consecutiveFailures > 2) {
        console.warn(`⚠️ Sync health degraded: ${this.syncHealth.consecutiveFailures} consecutive failures`);
      }
      
      if (this.syncHealth.averageSyncTime > 15000) {
        console.warn(`⚠️ Sync performance degraded: ${this.syncHealth.averageSyncTime}ms average`);
      }
    }, 60000); // Check every minute
    
    // Monitor retry queue
    this.retryQueueMonitor = setInterval(() => {
      if (this.retryQueue.length > 0) {
        const readyForRetry = this.retryQueue.filter(op => this.shouldRetryOperation(op));
        if (readyForRetry.length > 0) {
          this.processRetryQueue().catch(error => {
            console.error('Retry queue processing failed:', error);
          });
        }
      }
    }, 10000); // Check every 10 seconds
  }

  stopAdvancedMonitoring() {
    if (this.offlineQueueMonitor) {
      clearInterval(this.offlineQueueMonitor);
      this.offlineQueueMonitor = null;
    }
    
    if (this.syncHealthMonitor) {
      clearInterval(this.syncHealthMonitor);
      this.syncHealthMonitor = null;
    }
    
    if (this.retryQueueMonitor) {
      clearInterval(this.retryQueueMonitor);
      this.retryQueueMonitor = null;
    }
  }

  // ===================================================================
  //  🔄 CONNECTION MONITORING & RECOVERY
  // ===================================================================

  startConnectionMonitoring() {
    // Monitor network connectivity
    this.connectionMonitor = setInterval(async () => {
      try {
        const isOnline = await this.checkNetworkConnectivity();
        
        if (isOnline && this.offlineMode) {
          console.log('🔌 Network connectivity restored, switching to online mode');
          await this.disableOfflineMode();
        } else if (!isOnline && !this.offlineMode) {
          console.log('📴 Network connectivity lost, switching to offline mode');
          await this.enableOfflineMode('network_disconnected');
        }
        
        this.networkStatus = isOnline ? 'online' : 'offline';
        
      } catch (error) {
        console.error('Connection monitoring error:', error);
      }
    }, 5000); // Check every 5 seconds
  }

  async checkNetworkConnectivity() {
    try {
      // Try to emit a simple test event to check if event bus is responsive
      if (this.eventBus && typeof this.eventBus.emit === 'function') {
        await Promise.race([
          this.eventBus.emit('system:connectivity_test', { timestamp: Date.now() }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  stopConnectionMonitoring() {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = null;
    }
  }

  // ===================================================================
  //  📊 PERFORMANCE OPTIMIZATION
  // ===================================================================

  async optimizePerformance() {
    console.log('⚡ Starting performance optimization...');
    
    // Clear old metrics
    this.performanceMonitor.clearMetrics();
    
    // Optimize offline queue
    await this.optimizeOfflineQueue();
    
    // Optimize retry queue
    await this.optimizeRetryQueue();
    
    // Clear old sync times
    if (this.syncHealth.syncTimes.length > 20) {
      this.syncHealth.syncTimes = this.syncHealth.syncTimes.slice(-10);
    }
    
    // Clean up batch processor
    if (this.batchProcessor) {
      await this.optimizeBatchProcessor();
    }
    
    // Clear sync locks that might be stuck
    const now = Date.now();
    for (const [storeName, lockTime] of this.syncLocks.entries()) {
      if (now - lockTime > 30000) { // 30 seconds
        console.warn(`🔓 Clearing stuck sync lock for store: ${storeName}`);
        this.syncLocks.delete(storeName);
      }
    }
    
    console.log('✅ Performance optimization completed');
  }

  async optimizeOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    
    // Remove duplicate operations
    const uniqueOperations = new Map();
    for (const operation of this.offlineQueue) {
      const key = `${operation.type}-${operation.storeName}-${operation.method}`;
      if (!uniqueOperations.has(key) || operation.queuedAt > uniqueOperations.get(key).queuedAt) {
        uniqueOperations.set(key, operation);
      }
    }
    
    const originalLength = this.offlineQueue.length;
    this.offlineQueue = Array.from(uniqueOperations.values());
    
    if (originalLength !== this.offlineQueue.length) {
      console.log(`🧹 Optimized offline queue: ${originalLength} → ${this.offlineQueue.length} operations`);
    }
    
    // Sort by priority and timestamp
    this.offlineQueue.sort((a, b) => {
      const priorityDiff = (b.priority || 0) - (a.priority || 0);
      return priorityDiff !== 0 ? priorityDiff : a.queuedAt - b.queuedAt;
    });
  }

  async optimizeRetryQueue() {
    if (this.retryQueue.length === 0) return;
    
    const now = Date.now();
    const originalLength = this.retryQueue.length;
    
    // Remove operations that have exceeded maximum age
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    this.retryQueue = this.retryQueue.filter(operation => {
      const age = now - operation.queuedAt;
      return age < maxAge;
    });
    
    // Remove operations that have failed too many times
    this.retryQueue = this.retryQueue.filter(operation => {
      return (operation.retryCount || 0) < (operation.maxRetries || 3);
    });
    
    if (originalLength !== this.retryQueue.length) {
      console.log(`🧹 Optimized retry queue: ${originalLength} → ${this.retryQueue.length} operations`);
    }
  }

  async optimizeBatchProcessor() {
    if (!this.batchProcessor) return;
    
    // Process old batches
    const now = Date.now();
    const oldBatches = Array.from(this.batchProcessor.batches.values())
      .filter(batch => now - batch.createdAt > this.batchTimeout * 2);
    
    for (const batch of oldBatches) {
      try {
        await this.processBatch(batch);
        this.batchProcessor.batches.delete(batch.key);
      } catch (error) {
        console.error(`Failed to process old batch ${batch.key}:`, error);
      }
    }
  }

  // ===================================================================
  //  📋 DEBUGGING & DIAGNOSTICS
  // ===================================================================

  generateEnhancedDiagnosticReport() {
    const baseReport = this.generateDiagnosticReport();
    
    return {
      ...baseReport,
      enhanced: {
        offlineMode: {
          enabled: this.offlineMode,
          reason: this.offlineReason || null,
          startTime: this.offlineStartTime || null,
          queueSize: this.offlineQueue.length,
          queueOperations: this.offlineQueue.slice(0, 5).map(op => ({
            id: op.id,
            type: op.type,
            queuedAt: op.queuedAt,
            attempts: op.attempts
          }))
        },
        syncHealth: {
          ...this.syncHealth,
          lastSyncAge: this.lastSyncTimestamp ? Date.now() - this.lastSyncTimestamp : null
        },
        retryQueue: {
          size: this.retryQueue.length,
          operations: this.retryQueue.slice(0, 5).map(op => ({
            id: op.id,
            type: op.type,
            retryCount: op.retryCount || 0,
            lastError: op.lastRetryError || null
          }))
        },
        batchProcessor: this.batchProcessor ? {
          activeBatches: this.batchProcessor.batches.size,
          processing: this.batchProcessor.processing,
          queueSize: this.batchProcessor.queue.length,
          oldestBatch: Array.from(this.batchProcessor.batches.values())
            .reduce((oldest, current) => 
              !oldest || current.createdAt < oldest.createdAt ? current : oldest, null
            )?.createdAt || null
        } : null,
        syncLocks: {
          active: this.syncLocks.size,
          locks: Array.from(this.syncLocks.entries()).map(([store, time]) => ({
            store,
            lockedAt: time,
            duration: Date.now() - time
          }))
        },
        conflictResolution: {
          strategy: this.syncStrategy,
          resolverAvailable: !!this.conflictResolver,
          strategies: Object.fromEntries(this.conflictStrategies || new Map())
        }
      }
    };
  }

  async runEnhancedDiagnostics() {
    console.log('🔍 Running enhanced diagnostics...');
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      tests: [],
      warnings: [],
      recommendations: []
    };
    
    // Test offline mode functionality
    try {
      if (this.offlineMode) {
        diagnostics.tests.push({
          name: 'Offline Mode',
          status: 'info',
          message: `Currently in offline mode. Queue size: ${this.offlineQueue.length}`
        });
      } else {
        diagnostics.tests.push({
          name: 'Offline Mode',
          status: 'pass',
          message: 'Online mode active'
        });
      }
    } catch (error) {
      diagnostics.tests.push({
        name: 'Offline Mode',
        status: 'fail',
        message: `Offline mode test failed: ${error.message}`
      });
    }
    
    // Test sync health
    if (this.syncHealth.consecutiveFailures > 0) {
      diagnostics.warnings.push(`${this.syncHealth.consecutiveFailures} consecutive sync failures`);
      diagnostics.recommendations.push('Check network connectivity and server status');
    }
    
    // Test queue sizes
    if (this.offlineQueue.length > 100) {
      diagnostics.warnings.push(`Large offline queue: ${this.offlineQueue.length} operations`);
      diagnostics.recommendations.push('Consider processing offline queue or switching to online mode');
    }
    
    if (this.retryQueue.length > 20) {
      diagnostics.warnings.push(`Large retry queue: ${this.retryQueue.length} operations`);
      diagnostics.recommendations.push('Investigate persistent operation failures');
    }
    
    // Test batch processor
    if (this.batchProcessor && this.batchProcessor.batches.size > 50) {
      diagnostics.warnings.push(`Many pending batches: ${this.batchProcessor.batches.size}`);
      diagnostics.recommendations.push('Consider increasing batch processing frequency');
    }
    
    // Test sync locks
    if (this.syncLocks.size > 5) {
      diagnostics.warnings.push(`Multiple active sync locks: ${this.syncLocks.size}`);
      diagnostics.recommendations.push('Check for potential sync deadlocks');
    }
    
    // Test performance
    const avgSyncTime = this.syncHealth.averageSyncTime;
    if (avgSyncTime > 10000) {
      diagnostics.warnings.push(`Slow sync performance: ${avgSyncTime}ms average`);
      diagnostics.recommendations.push('Optimize store operations and network connectivity');
    }
    
    console.log('✅ Enhanced diagnostics completed');
    return diagnostics;
  }

  // ===================================================================
  //  🧹 ENHANCED CLEANUP & DESTRUCTION
  // ===================================================================

  async destroy() {
    console.log('🧹 Destroying Enhanced Store Adapter...');
    
    try {
      // Stop monitoring
      this.stopAdvancedMonitoring();
      this.stopConnectionMonitoring();
      
      // Stop batch processing
      if (this.batchProcessor?.processInterval) {
        clearInterval(this.batchProcessor.processInterval);
        this.batchProcessor.processInterval = null;
      }
      
      // Process remaining operations if possible
      if (!this.offlineMode && this.offlineQueue.length > 0) {
        console.log('📤 Processing remaining offline operations...');
        try {
          await Promise.race([
            this.processOfflineQueue(),
            new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
          ]);
        } catch (error) {
          console.warn('Failed to process remaining offline operations:', error);
        }
      }
      
      // Process remaining batches
      if (this.batchProcessor?.batches.size > 0) {
        console.log('📦 Processing remaining batches...');
        try {
          await Promise.race([
            this.processBatches(),
            new Promise(resolve => setTimeout(resolve, 3000)) // 3 second timeout
          ]);
        } catch (error) {
          console.warn('Failed to process remaining batches:', error);
        }
      }
      
      // Clear all queues and maps
      this.offlineQueue.length = 0;
      this.retryQueue.length = 0;
      this.syncLocks.clear();
      
      if (this.batchProcessor) {
        this.batchProcessor.batches.clear();
        this.batchProcessor.queue.length = 0;
        this.batchProcessor = null;
      }
      
      // Clear conflict resolution data
      this.conflictResolver = null;
      if (this.conflictStrategies) {
        this.conflictStrategies.clear();
      }
      
      // Clear snapshots
      this.preOfflineSnapshot = null;
      
      // Reset state
      this.offlineMode = false;
      this.networkStatus = 'unknown';
      this.lastSyncTimestamp = null;
      this.offlineReason = null;
      this.offlineStartTime = null;
      
      // Destroy event handler
      if (this.eventHandler) {
        this.eventHandler.destroy();
        this.eventHandler = null;
      }
      
      // Emit destruction event
      if (this.eventBus && PHARMACY_EVENTS?.SYSTEM?.ENHANCED_ADAPTER_DESTROYED) {
        try {
          await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.ENHANCED_ADAPTER_DESTROYED, {
            timestamp: Date.now(),
            finalMetrics: this.getEnhancedMetrics()
          });
        } catch (error) {
          console.warn('Failed to emit destruction event:', error);
        }
      }
      
      // Call parent destroy
      await super.destroy();
      
      console.log('✅ Enhanced Store Adapter destroyed successfully');
      
    } catch (error) {
      console.error('❌ Error during Enhanced Store Adapter destruction:', error);
      throw error;
    }
  }

  // ===================================================================
  //  🔄 RESTART & RECOVERY
  // ===================================================================

  async restart(config = {}) {
    console.log('🔄 Restarting Enhanced Store Adapter...');
    
    const restartMetrics = {
      startTime: Date.now(),
      offlineQueueSize: this.offlineQueue.length,
      retryQueueSize: this.retryQueue.length,
      wasOffline: this.offlineMode
    };
    
    // Save critical state
    const savedOfflineQueue = [...this.offlineQueue];
    const savedRetryQueue = [...this.retryQueue];
    const savedSyncHealth = { ...this.syncHealth };
    
    try {
      // Destroy current instance
      await this.destroy();
      
      // Reinitialize
      this.isDestroyed = false;
      this.isInitialized = false;
      
      // Merge restart config
      this.config = { ...this.config, ...config };
      
      // Initialize
      await this.init();
      
      // Restore critical state
      this.offlineQueue = savedOfflineQueue;
      this.retryQueue = savedRetryQueue;
      this.syncHealth = savedSyncHealth;
      
      // Restart monitoring
      this.startAdvancedMonitoring();
      this.startConnectionMonitoring();
      
      // Initialize batch processor
      if (config.ENABLE_BATCH_PROCESSING !== false) {
        this.initializeBatchProcessor();
      }
      
      restartMetrics.endTime = Date.now();
      restartMetrics.duration = restartMetrics.endTime - restartMetrics.startTime;
      restartMetrics.restoredOfflineOperations = this.offlineQueue.length;
      restartMetrics.restoredRetryOperations = this.retryQueue.length;
      
      // Emit restart event
      if (this.eventBus && PHARMACY_EVENTS?.SYSTEM?.ENHANCED_ADAPTER_RESTARTED) {
        await this.eventBus.emit(PHARMACY_EVENTS.SYSTEM.ENHANCED_ADAPTER_RESTARTED, {
          timestamp: Date.now(),
          metrics: restartMetrics
        });
      }
      
      console.log(`✅ Enhanced Store Adapter restarted in ${restartMetrics.duration}ms`);
      return restartMetrics;
      
    } catch (error) {
      console.error('❌ Enhanced Store Adapter restart failed:', error);
      throw error;
    }
  }
}

// ===================================================================
//  🏭 ENHANCED FACTORY FUNCTIONS
// ===================================================================

let globalEnhancedAdapter = null;

export const createEnhancedStoreAdapter = async (config = {}) => {
  if (globalEnhancedAdapter && !globalEnhancedAdapter.isDestroyed) {
    console.warn('Global enhanced store adapter already exists');
    return globalEnhancedAdapter;
  }

  const enhancedConfig = {
    // Base configuration
    AUTO_SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutes
    BATCH_SIZE: 50,
    BATCH_TIMEOUT: 5000,
    RETRY_ATTEMPTS: 3,
    TIMEOUT: 10000,
    
    // Enhanced configuration
    OFFLINE_QUEUE_LIMIT: 1000,
    SYNC_STRATEGY: 'merge',
    MAX_BATCH_RETRIES: 3,
    MAX_RECONNECT_ATTEMPTS: 5,
    ENABLE_ADVANCED_MONITORING: true,
    ENABLE_CONNECTION_MONITORING: true,
    ENABLE_BATCH_PROCESSING: true,
    ENABLE_CONFLICT_RESOLUTION: true,
    
    // Performance tuning
    PERFORMANCE_TRACKING: true,
    EVENT_DEBOUNCE_DELAY: 100,
    SIGNIFICANT_CHANGE_THRESHOLD: 0.1,
    
    // Override with user config
    ...config
  };

  try {
    globalEnhancedAdapter = new EnhancedStoreAdapter(enhancedConfig);
    await globalEnhancedAdapter.init();
    
    // Start enhanced features
    if (enhancedConfig.ENABLE_ADVANCED_MONITORING) {
      globalEnhancedAdapter.startAdvancedMonitoring();
    }
    
    if (enhancedConfig.ENABLE_CONNECTION_MONITORING) {
      globalEnhancedAdapter.startConnectionMonitoring();
    }
    
    if (enhancedConfig.ENABLE_BATCH_PROCESSING) {
      globalEnhancedAdapter.initializeBatchProcessor();
    }
    
    console.log('🚀 Enhanced Store Adapter created and configured');
    return globalEnhancedAdapter;
    
  } catch (error) {
    console.error('❌ Failed to create Enhanced Store Adapter:', error);
    globalEnhancedAdapter = null;
    throw error;
  }
};

export const getEnhancedStoreAdapter = () => {
  return globalEnhancedAdapter;
};

export const destroyEnhancedStoreAdapter = async () => {
  if (globalEnhancedAdapter) {
    await globalEnhancedAdapter.destroy();
    globalEnhancedAdapter = null;
    console.log('🗑️ Global enhanced store adapter destroyed');
  }
};

export const resetEnhancedStoreAdapter = async (config = {}) => {
  await destroyEnhancedStoreAdapter();
  return await createEnhancedStoreAdapter(config);
};

// ===================================================================
//  🎯 ENHANCED UTILITY FUNCTIONS
// ===================================================================

export const withEnhancedStoreAdapter = (component) => {
  return (props) => {
    const adapter = getEnhancedStoreAdapter();
    return component({ ...props, enhancedStoreAdapter: adapter });
  };
};

export const useEnhancedStoreAdapterMetrics = () => {
  const adapter = getEnhancedStoreAdapter();
  return adapter ? adapter.getEnhancedMetrics() : null;
};

export const useEnhancedStoreHealth = () => {
  const adapter = getEnhancedStoreAdapter();
  return adapter ? adapter.getSystemHealth() : null;
};

// ===================================================================
//  📊 ENHANCED MONITORING DASHBOARD
// ===================================================================

export const EnhancedStoreAdapterDashboard = {
  getEnhancedSystemOverview() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return null;

    const baseOverview = adapter.getAdapterMetrics();
    const enhancedMetrics = adapter.getEnhancedMetrics();
    const systemHealth = adapter.getSystemHealth();

    return {
      ...baseOverview,
      enhanced: enhancedMetrics.enhanced,
      health: systemHealth.enhanced,
      realtime: {
        timestamp: Date.now(),
        networkStatus: adapter.networkStatus,
        offlineMode: adapter.offlineMode,
        activeOperations: adapter.syncLocks.size,
        queueSizes: {
          offline: adapter.offlineQueue.length,
          retry: adapter.retryQueue.length,
          batch: adapter.batchProcessor?.batches.size || 0
        }
      }
    };
  },

  async runEnhancedDiagnostics() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return { error: 'No enhanced adapter found' };

    return await adapter.runEnhancedDiagnostics();
  },

  async performEnhancedHealthCheck() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return { status: 'critical', message: 'No enhanced adapter found' };

    const baseHealth = adapter.getStoreHealth();
    const enhancedHealth = adapter.getSystemHealth();
    
    // Completing the Enhanced Store Adapter from where it was cut off...

    return {
      ...baseHealth,
      enhanced: enhancedHealth.enhanced,
      timestamp: new Date().toISOString(),
      summary: {
        stores: {
          total: adapter.stores.size,
          healthy: Object.values(enhancedHealth.stores || {}).filter(s => s.status === 'healthy').length,
          issues: enhancedHealth.enhanced.issues.length
        },
        performance: {
          totalOperations: enhancedHealth.performance?.totalOperations || 0,
          errorRate: enhancedHealth.performance?.errorRate || 0,
          activeOperations: adapter.syncLocks.size
        },
        queues: {
          offline: adapter.offlineQueue.length,
          retry: adapter.retryQueue.length,
          batch: adapter.batchProcessor?.batches.size || 0
        },
        connectivity: {
          status: adapter.networkStatus,
          offlineMode: adapter.offlineMode,
          lastSync: adapter.lastSyncTimestamp
        }
      },
      issues: enhancedHealth.enhanced.issues,
      recommendations: enhancedHealth.enhanced.recommendations
    };
  },

  startEnhancedMonitoring(interval = 30000) {
    return setInterval(async () => {
      const health = await EnhancedStoreAdapterDashboard.performEnhancedHealthCheck();
      
      if (health.enhanced?.status !== 'healthy') {
        console.warn('🚨 Enhanced Store Adapter Health Issue:', health);
        
        // Emit enhanced health warning event
        const adapter = getEnhancedStoreAdapter();
        if (adapter?.eventBus && PHARMACY_EVENTS?.SYSTEM?.ENHANCED_PERFORMANCE_WARNING) {
          adapter.eventBus.emit(PHARMACY_EVENTS.SYSTEM.ENHANCED_PERFORMANCE_WARNING, {
            type: 'enhanced_store_adapter_health',
            status: health.enhanced.status,
            issues: health.enhanced.issues,
            queues: health.summary.queues,
            connectivity: health.summary.connectivity,
            timestamp: Date.now()
          });
        }
      }
    }, interval);
  }
};

// ===================================================================
//  🔧 ENHANCED DEVELOPMENT & DEBUGGING TOOLS
// ===================================================================

export const EnhancedStoreAdapterDevTools = {
  enableEnhancedDebugMode() {
    const adapter = getEnhancedStoreAdapter();
    if (adapter) {
      adapter.config.ENABLE_DEBUG_LOGS = true;
      adapter.config.PERFORMANCE_TRACKING = true;
      adapter.config.ENABLE_ADVANCED_MONITORING = true;
      console.log('🔧 Enhanced Store Adapter debug mode enabled');
    }
  },

  disableEnhancedDebugMode() {
    const adapter = getEnhancedStoreAdapter();
    if (adapter) {
      adapter.config.ENABLE_DEBUG_LOGS = false;
      adapter.config.ENABLE_ADVANCED_MONITORING = false;
      console.log('🔇 Enhanced Store Adapter debug mode disabled');
    }
  },

  dumpEnhancedState() {
    const adapter = getEnhancedStoreAdapter();
    if (adapter) {
      console.group('🔍 Enhanced Store Adapter Debug State');
      console.log('Configuration:', adapter.config);
      console.log('Enhanced Metrics:', adapter.getEnhancedMetrics());
      console.log('System Health:', adapter.getSystemHealth());
      console.log('Offline Queue:', adapter.offlineQueue.slice(0, 10));
      console.log('Retry Queue:', adapter.retryQueue.slice(0, 10));
      console.log('Sync Locks:', Array.from(adapter.syncLocks.entries()));
      console.log('Batch Processor:', adapter.batchProcessor ? {
        activeBatches: adapter.batchProcessor.batches.size,
        processing: adapter.batchProcessor.processing,
        queueSize: adapter.batchProcessor.queue?.length || 0
      } : 'Not initialized');
      console.groupEnd();
    }
  },

  async simulateOfflineMode(duration = 30000) {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return;

    console.log(`🧪 Simulating offline mode for ${duration}ms`);
    
    await adapter.enableOfflineMode('debug_simulation');
    
    setTimeout(async () => {
      await adapter.disableOfflineMode();
      console.log('🧪 Offline mode simulation completed');
    }, duration);
  },

  async simulateNetworkError() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return;

    try {
      await adapter.eventBus.emit(PHARMACY_EVENTS.NETWORK?.CONNECTION_ERROR || 'network:connection_error', {
        source: 'debug_simulation',
        error: 'Simulated network error for testing',
        timestamp: Date.now()
      });
      
      console.log('🧪 Simulated network error');
    } catch (error) {
      console.error('Failed to simulate network error:', error);
    }
  },

  async testOfflineOperations(count = 10) {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return;

    console.log(`🧪 Testing ${count} offline operations`);
    
    // Enable offline mode
    await adapter.enableOfflineMode('debug_test');
    
    // Generate test operations
    const operations = [];
    for (let i = 0; i < count; i++) {
      operations.push({
        id: `test_op_${i}`,
        type: 'test',
        storeName: 'product',
        method: 'update',
        data: { testId: i, timestamp: Date.now() },
        queuedAt: Date.now(),
        priority: Math.floor(Math.random() * 5)
      });
    }
    
    // Add operations to queue
    adapter.offlineQueue.push(...operations);
    
    console.log(`📦 Added ${count} test operations to offline queue`);
    
    // Return to online mode after a delay
    setTimeout(async () => {
      await adapter.disableOfflineMode();
      console.log('🧪 Offline operations test completed');
    }, 5000);
    
    return operations;
  },

  async stressTestEnhanced(duration = 30000, operationsPerSecond = 20) {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return;

    console.log(`🏋️ Starting enhanced stress test: ${duration}ms at ${operationsPerSecond} ops/sec`);
    
    const startTime = Date.now();
    let operations = 0;
    let errors = 0;
    let offlineOperations = 0;
    let syncOperations = 0;
    
    const interval = setInterval(async () => {
      try {
        const operation = Math.floor(Math.random() * 6);
        
        switch (operation) {
          case 0:
            await adapter.syncStores();
            syncOperations++;
            break;
          case 1:
            await adapter.eventBus.emit('test:enhanced_stress_operation', { 
              operation: operations,
              timestamp: Date.now() 
            });
            break;
          case 2:
            adapter.getEnhancedMetrics();
            break;
          case 3:
            if (Math.random() > 0.8) {
              await adapter.enableOfflineMode('stress_test');
              offlineOperations++;
            }
            break;
          case 4:
            if (adapter.offlineMode && Math.random() > 0.7) {
              await adapter.disableOfflineMode();
            }
            break;
          case 5:
            await adapter.optimizePerformance();
            break;
        }
        
        operations++;
      } catch (error) {
        errors++;
        console.error('Enhanced stress test operation failed:', error);
      }
      
      if (Date.now() - startTime >= duration) {
        clearInterval(interval);
        
        const results = {
          duration,
          totalOperations: operations,
          errors,
          offlineOperations,
          syncOperations,
          successRate: ((operations - errors) / operations * 100).toFixed(2),
          operationsPerSecond: (operations / (duration / 1000)).toFixed(2),
          finalState: {
            offlineMode: adapter.offlineMode,
            queueSizes: {
              offline: adapter.offlineQueue.length,
              retry: adapter.retryQueue.length
            },
            syncHealth: adapter.syncHealth
          }
        };
        
        console.log('🏁 Enhanced stress test completed:', results);
        return results;
      }
    }, 1000 / operationsPerSecond);
  },

  generateEnhancedReport() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return null;

    return adapter.generateEnhancedDiagnosticReport();
  }
};

// ===================================================================
//  📈 ENHANCED PERFORMANCE OPTIMIZATION UTILITIES
// ===================================================================

export const EnhancedStoreOptimizer = {
  async optimizeEnhancedPerformance() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return;

    console.log('⚡ Starting enhanced performance optimization...');
    
    // Base optimization
    await adapter.optimizePerformance();
    
    // Enhanced optimizations
    await this.optimizeConflictResolution();
    await this.optimizeBatchProcessing();
    await this.optimizeNetworkOperations();
    
    console.log('✅ Enhanced performance optimization completed');
  },

  async optimizeConflictResolution() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return;

    console.log('🔧 Optimizing conflict resolution...');
    
    // Clear old conflict data
    if (adapter.preOfflineSnapshot) {
      const snapshotAge = Date.now() - adapter.preOfflineSnapshot.timestamp;
      if (snapshotAge > 60 * 60 * 1000) { // 1 hour
        adapter.preOfflineSnapshot = null;
        console.log('🧹 Cleared old offline snapshot');
      }
    }
    
    // Optimize conflict strategies
    for (const [storeName, strategy] of adapter.conflictStrategies.entries()) {
      const store = adapter.stores.get(storeName);
      if (!store || !store.isActive) {
        adapter.conflictStrategies.delete(storeName);
      }
    }
  },

  async optimizeBatchProcessing() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter?.batchProcessor) return;

    console.log('📦 Optimizing batch processing...');
    
    const processor = adapter.batchProcessor;
    const now = Date.now();
    
    // Process old batches
    const oldBatches = Array.from(processor.batches.values())
      .filter(batch => now - batch.createdAt > adapter.batchTimeout * 3);
    
    for (const batch of oldBatches) {
      try {
        await adapter.processBatch(batch);
        processor.batches.delete(batch.key);
        console.log(`📤 Processed old batch: ${batch.key}`);
      } catch (error) {
        console.error(`Failed to process old batch ${batch.key}:`, error);
        // Remove failed batch to prevent memory leak
        processor.batches.delete(batch.key);
      }
    }
    
    // Optimize batch queue
    if (processor.queue.length > 100) {
      processor.queue = processor.queue.slice(-50);
      console.log('🧹 Trimmed batch queue');
    }
  },

  async optimizeNetworkOperations() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return;

    console.log('🌐 Optimizing network operations...');
    
    // Reset connection attempts if successful
    if (adapter.networkStatus === 'online') {
      adapter.reconnectAttempts = 0;
    }
    
    // Clean up sync health data
    if (adapter.syncHealth.syncTimes.length > 50) {
      adapter.syncHealth.syncTimes = adapter.syncHealth.syncTimes.slice(-25);
      
      // Recalculate average
      const sum = adapter.syncHealth.syncTimes.reduce((a, b) => a + b, 0);
      adapter.syncHealth.averageSyncTime = sum / adapter.syncHealth.syncTimes.length;
    }
    
    // Reset consecutive failures if we've had recent success
    const timeSinceLastSuccess = adapter.syncHealth.lastSuccessfulSync ? 
      Date.now() - adapter.syncHealth.lastSuccessfulSync : Infinity;
      
    if (timeSinceLastSuccess < 5 * 60 * 1000 && adapter.syncHealth.consecutiveFailures > 0) {
      adapter.syncHealth.consecutiveFailures = Math.max(0, adapter.syncHealth.consecutiveFailures - 1);
    }
  },

  async analyzeEnhancedBottlenecks() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return null;

    const metrics = adapter.getEnhancedMetrics();
    const bottlenecks = [];
    
    // Analyze base bottlenecks
    const baseBottlenecks = await adapter.analyzePerfBottlenecks?.() || [];
    bottlenecks.push(...baseBottlenecks);
    
    // Enhanced bottleneck analysis
    if (metrics.enhanced.offlineQueueSize > 100) {
      bottlenecks.push({
        type: 'large_offline_queue',
        queueSize: metrics.enhanced.offlineQueueSize,
        severity: metrics.enhanced.offlineQueueSize > 500 ? 'critical' : 'warning'
      });
    }
    
    if (metrics.enhanced.retryQueueSize > 20) {
      bottlenecks.push({
        type: 'high_retry_failures',
        retryQueueSize: metrics.enhanced.retryQueueSize,
        severity: 'warning'
      });
    }
    
    if (metrics.enhanced.syncHealth.consecutiveFailures > 3) {
      bottlenecks.push({
        type: 'sync_failures',
        failures: metrics.enhanced.syncHealth.consecutiveFailures,
        severity: 'critical'
      });
    }
    
    if (metrics.enhanced.activeSyncLocks > 5) {
      bottlenecks.push({
        type: 'too_many_sync_locks',
        lockCount: metrics.enhanced.activeSyncLocks,
        severity: 'warning'
      });
    }
    
    if (metrics.enhanced.batchProcessor?.activeBatches > 50) {
      bottlenecks.push({
        type: 'batch_processor_overload',
        batchCount: metrics.enhanced.batchProcessor.activeBatches,
        severity: 'warning'
      });
    }
    
    return {
      timestamp: Date.now(),
      bottlenecks,
      recommendations: this.generateEnhancedOptimizationRecommendations(bottlenecks)
    };
  },

  generateEnhancedOptimizationRecommendations(bottlenecks) {
    const recommendations = [];
    
    bottlenecks.forEach(bottleneck => {
      switch (bottleneck.type) {
        case 'large_offline_queue':
          recommendations.push('Process offline queue or increase batch processing capacity');
          break;
        case 'high_retry_failures':
          recommendations.push('Investigate persistent operation failures and improve error handling');
          break;
        case 'sync_failures':
          recommendations.push('Check network connectivity and server health');
          break;
        case 'too_many_sync_locks':
          recommendations.push('Reduce concurrent sync operations or increase timeout values');
          break;
        case 'batch_processor_overload':
          recommendations.push('Increase batch processing frequency or reduce batch size');
          break;
        case 'slow_operation':
          recommendations.push(`Optimize ${bottleneck.operation} - currently taking ${bottleneck.duration}ms`);
          break;
        case 'high_error_rate':
          recommendations.push('Investigate error sources and add comprehensive error handling');
          break;
        case 'high_memory_usage':
          recommendations.push('Implement enhanced memory cleanup strategies and queue optimization');
          break;
      }
    });
    
    return recommendations;
  }
};

// ===================================================================
//  🔄 ENHANCED BACKUP & RECOVERY UTILITIES
// ===================================================================

export const EnhancedStoreBackupManager = {
  async createEnhancedStateSnapshot() {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) return null;

    const baseSnapshot = await adapter.createDetailedStateSnapshot();
    
    const enhancedSnapshot = {
      ...baseSnapshot,
      enhanced: {
        offlineMode: adapter.offlineMode,
        offlineQueue: [...adapter.offlineQueue],
        retryQueue: [...adapter.retryQueue],
        syncHealth: { ...adapter.syncHealth },
        syncLocks: Array.from(adapter.syncLocks.entries()),
        networkStatus: adapter.networkStatus,
        conflictStrategies: Object.fromEntries(adapter.conflictStrategies),
        batchProcessor: adapter.batchProcessor ? {
          batches: Array.from(adapter.batchProcessor.batches.entries()),
          queue: [...adapter.batchProcessor.queue],
          processing: adapter.batchProcessor.processing
        } : null,
        lastSyncTimestamp: adapter.lastSyncTimestamp,
        reconnectAttempts: adapter.reconnectAttempts
      },
      version: '2.0.0-enhanced'
    };

    return enhancedSnapshot;
  },

  async restoreFromEnhancedSnapshot(snapshot) {
    const adapter = getEnhancedStoreAdapter();
    if (!adapter) throw new Error('No enhanced adapter available for restore');

    console.log('🔄 Restoring from enhanced snapshot...');

    // Validate enhanced snapshot
    if (!snapshot.enhanced) {
      throw new Error('Invalid enhanced snapshot format');
    }

    let restoredCount = 0;
    let errorCount = 0;

    try {
      // Restore base state
      const baseResult = await adapter.restoreFromSnapshot?.(snapshot);
      if (baseResult) {
        restoredCount += baseResult.restoredCount;
        errorCount += baseResult.errorCount;
      }

      // Restore enhanced state
      const enhanced = snapshot.enhanced;

      // Restore queues
      if (enhanced.offlineQueue) {
        adapter.offlineQueue.push(...enhanced.offlineQueue);
        console.log(`📥 Restored ${enhanced.offlineQueue.length} offline operations`);
      }

      if (enhanced.retryQueue) {
        adapter.retryQueue.push(...enhanced.retryQueue);
        console.log(`📥 Restored ${enhanced.retryQueue.length} retry operations`);
      }

      // Restore sync health
      if (enhanced.syncHealth) {
        adapter.syncHealth = { ...enhanced.syncHealth };
        console.log('📊 Restored sync health data');
      }

      // Restore network status
      if (enhanced.networkStatus) {
        adapter.networkStatus = enhanced.networkStatus;
      }

      // Restore offline mode if it was active
      if (enhanced.offlineMode && !adapter.offlineMode) {
        await adapter.enableOfflineMode('snapshot_restore');
        console.log('📴 Restored offline mode');
      }

      // Restore conflict strategies
      if (enhanced.conflictStrategies) {
        adapter.conflictStrategies = new Map(Object.entries(enhanced.conflictStrategies));
        console.log('🔧 Restored conflict resolution strategies');
      }

      // Restore batch processor state
      if (enhanced.batchProcessor && adapter.batchProcessor) {
        if (enhanced.batchProcessor.batches) {
          adapter.batchProcessor.batches = new Map(enhanced.batchProcessor.batches);
        }
        if (enhanced.batchProcessor.queue) {
          adapter.batchProcessor.queue = [...enhanced.batchProcessor.queue];
        }
        console.log('📦 Restored batch processor state');
      }

      // Restore other enhanced properties
      if (enhanced.lastSyncTimestamp) {
        adapter.lastSyncTimestamp = enhanced.lastSyncTimestamp;
      }

      if (enhanced.reconnectAttempts !== undefined) {
        adapter.reconnectAttempts = enhanced.reconnectAttempts;
      }

      restoredCount++;

    } catch (error) {
      console.error('Failed to restore enhanced state:', error);
      errorCount++;
    }

    console.log(`✅ Enhanced snapshot restore completed: ${restoredCount} restored, ${errorCount} errors`);
    return { restoredCount, errorCount, enhancedRestore: true };
  },

  async createPeriodicBackup(interval = 10 * 60 * 1000) { // 10 minutes
    console.log(`🔄 Starting periodic backup every ${interval}ms`);
    
    return setInterval(async () => {
      try {
        const snapshot = await this.createEnhancedStateSnapshot();
        if (snapshot) {
          // Store snapshot (in a real implementation, this would be persisted)
          this.lastBackup = {
            timestamp: Date.now(),
            snapshot,
            size: JSON.stringify(snapshot).length
          };
          
          console.log(`💾 Periodic backup created: ${this.lastBackup.size} bytes`);
        }
      } catch (error) {
        console.error('❌ Periodic backup failed:', error);
      }
    }, interval);
  },

  stopPeriodicBackup(intervalId) {
    if (intervalId) {
      clearInterval(intervalId);
      console.log('⏹️ Periodic backup stopped');
    }
  },

  getLastBackup() {
    return this.lastBackup || null;
  }
};

// ===================================================================
//  🎯 ENHANCED SYSTEM INITIALIZATION
// ===================================================================

export const initializeEnhancedStoreSystem = async (config = {}) => {
  try {
    console.log('🚀 Initializing Enhanced Store System...');
    
    const enhancedConfig = {
      // Enhanced features enabled by default
      ENABLE_ADVANCED_MONITORING: true,
      ENABLE_CONNECTION_MONITORING: true,
      ENABLE_BATCH_PROCESSING: true,
      ENABLE_CONFLICT_RESOLUTION: true,
      ENABLE_PERIODIC_BACKUP: false,
      BACKUP_INTERVAL: 10 * 60 * 1000, // 10 minutes
      
      // Performance optimizations
      ENABLE_PERFORMANCE_OPTIMIZATION: true,
      OPTIMIZATION_INTERVAL: 5 * 60 * 1000, // 5 minutes
      
      ...config
    };
    
    // Create and initialize enhanced adapter
    const adapter = await createEnhancedStoreAdapter(enhancedConfig);
    
    // Setup enhanced monitoring if enabled
    if (enhancedConfig.ENABLE_MONITORING !== false) {
      EnhancedStoreAdapterDashboard.startEnhancedMonitoring(
        enhancedConfig.MONITORING_INTERVAL || 30000
      );
    }
    
    // Setup periodic backup if enabled
    let backupInterval = null;
    if (enhancedConfig.ENABLE_PERIODIC_BACKUP) {
      backupInterval = await EnhancedStoreBackupManager.createPeriodicBackup(
        enhancedConfig.BACKUP_INTERVAL
      );
    }
    
    // Setup performance optimization if enabled
    let optimizationInterval = null;
    if (enhancedConfig.ENABLE_PERFORMANCE_OPTIMIZATION) {
      optimizationInterval = setInterval(async () => {
        try {
          await EnhancedStoreOptimizer.optimizeEnhancedPerformance();
        } catch (error) {
          console.error('❌ Periodic optimization failed:', error);
        }
      }, enhancedConfig.OPTIMIZATION_INTERVAL);
    }
    
    // Enable debug mode in development
    if (process.env.NODE_ENV === 'development' && enhancedConfig.ENABLE_DEBUG_LOGS !== false) {
      EnhancedStoreAdapterDevTools.enableEnhancedDebugMode();
    }
    
    console.log('✅ Enhanced Store System initialized successfully');
    
    return {
      adapter,
      backupInterval,
      optimizationInterval,
      config: enhancedConfig
    };
    
  } catch (error) {
    console.error('❌ Enhanced Store System initialization failed:', error);
    throw error;
  }
};

export const shutdownEnhancedStoreSystem = async (systemComponents = {}) => {
  try {
    console.log('🛑 Shutting down Enhanced Store System...');
    
    // Stop periodic processes
    if (systemComponents.backupInterval) {
      EnhancedStoreBackupManager.stopPeriodicBackup(systemComponents.backupInterval);
    }
    
    if (systemComponents.optimizationInterval) {
      clearInterval(systemComponents.optimizationInterval);
    }
    
    // Create final backup
    try {
      const finalSnapshot = await EnhancedStoreBackupManager.createEnhancedStateSnapshot();
      console.log('💾 Final backup created before shutdown');
    } catch (error) {
      console.warn('⚠️ Failed to create final backup:', error);
    }
    
    // Destroy enhanced adapter
    await destroyEnhancedStoreAdapter();
    
    console.log('✅ Enhanced Store System shutdown complete');
  } catch (error) {
    console.error('❌ Enhanced Store System shutdown failed:', error);
    throw error;
  }
};
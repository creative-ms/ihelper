// src/adapters/EnhancedStoreAdapter.js
// ===================================================================
//  🚀 ENHANCED STORE ADAPTER - CONTINUATION & ADVANCED FEATURES
//  Additional Features: Offline Mode + Conflict Resolution + Advanced Sync
// ===================================================================

import { StoreAdapter } from './StoreAdapter.js';
import { StoreEventHandler } from './handlers/StoreEventHandler.js';

// ===================================================================
//  🔧 ENHANCED STORE ADAPTER CLASS
// ===================================================================

export class EnhancedStoreAdapter extends StoreAdapter {
  constructor(config = {}) {
    super(config);
    
    // Enhanced features
    this.offlineMode = false;
    this.offlineQueue = [];
    this.conflictResolver = null;
    this.syncStrategy = 'merge'; // merge, overwrite, manual
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
    
    // Batch processing
    this.batchProcessor = null;
    this.batchSize = config.BATCH_SIZE || 50;
    this.batchTimeout = config.BATCH_TIMEOUT || 5000;
    
    console.log('🚀 Enhanced Store Adapter initialized');
  }

  // ===================================================================
  //  🔌 OFFLINE MODE MANAGEMENT
  // ===================================================================

  async enableOfflineMode() {
    if (this.offlineMode) return;
    
    console.log('📴 Enabling offline mode...');
    this.offlineMode = true;
    this.networkStatus = 'offline';
    
    // Notify all stores about offline mode
    for (const [storeName, store] of this.stores.entries()) {
      if (store.isActive) {
        try {
          const storeState = store.hook.getState();
          if (typeof storeState.enableOfflineMode === 'function') {
            await storeState.enableOfflineMode();
          }
        } catch (error) {
          console.error(`Error enabling offline mode for store "${storeName}":`, error);
        }
      }
    }
    
    // Emit offline mode event
    await this.eventBus.emit('system:offline_mode_enabled', {
      timestamp: Date.now(),
      queuedOperations: this.offlineQueue.length
    });
    
    console.log('✅ Offline mode enabled');
  }

  async disableOfflineMode() {
    if (!this.offlineMode) return;
    
    console.log('🔌 Disabling offline mode...');
    this.offlineMode = false;
    this.networkStatus = 'online';
    
    // Process offline queue
    await this.processOfflineQueue();
    
    // Notify all stores about online mode
    for (const [storeName, store] of this.stores.entries()) {
      if (store.isActive) {
        try {
          const storeState = store.hook.getState();
          if (typeof storeState.disableOfflineMode === 'function') {
            await storeState.disableOfflineMode();
          }
        } catch (error) {
          console.error(`Error disabling offline mode for store "${storeName}":`, error);
        }
      }
    }
    
    // Full sync after coming back online
    await this.performFullSync();
    
    // Emit online mode event
    await this.eventBus.emit('system:online_mode_restored', {
      timestamp: Date.now(),
      processedOperations: this.offlineQueue.length
    });
    
    console.log('✅ Online mode restored');
  }

  addToOfflineQueue(operation) {
    if (!this.offlineMode) return false;
    
    const queuedOperation = {
      id: this.generateOperationId(),
      ...operation,
      queuedAt: Date.now(),
      attempts: 0,
      maxAttempts: 3
    };
    
    this.offlineQueue.push(queuedOperation);
    console.log(`📥 Operation queued for offline processing: ${operation.type}`);
    return true;
  }

  async processOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    
    console.log(`🔄 Processing ${this.offlineQueue.length} offline operations...`);
    const results = [];
    
    for (const operation of this.offlineQueue) {
      try {
        const result = await this.executeOfflineOperation(operation);
        results.push({ operation: operation.id, success: true, result });
      } catch (error) {
        console.error(`Failed to process offline operation ${operation.id}:`, error);
        results.push({ operation: operation.id, success: false, error: error.message });
        
        // Add to retry queue if not exceeded max attempts
        if (operation.attempts < operation.maxAttempts) {
          operation.attempts++;
          this.retryQueue.push(operation);
        }
      }
    }
    
    // Clear successful operations from queue
    this.offlineQueue = this.offlineQueue.filter(op => 
      !results.find(r => r.operation === op.id && r.success)
    );
    
    console.log(`✅ Processed offline queue: ${results.filter(r => r.success).length}/${results.length} successful`);
    return results;
  }

  async executeOfflineOperation(operation) {
    const { type, storeName, method, args } = operation;
    
    switch (type) {
      case 'store_method':
        return await this.executeStoreMethod(storeName, method, args);
      case 'sync_operation':
        return await this.syncSingleStore(storeName);
      case 'event_emission':
        return await this.eventBus.emit(operation.eventName, operation.payload);
      default:
        throw new Error(`Unknown offline operation type: ${type}`);
    }
  }

  async executeStoreMethod(storeName, method, args) {
    const store = this.stores.get(storeName);
    if (!store || !store.isActive) {
      throw new Error(`Store "${storeName}" not available`);
    }
    
    const storeState = store.hook.getState();
    if (typeof storeState[method] !== 'function') {
      throw new Error(`Method "${method}" not found in store "${storeName}"`);
    }
    
    return await storeState[method](...args);
  }

  // ===================================================================
  //  🔄 ADVANCED SYNCHRONIZATION
  // ===================================================================

  async performFullSync() {
    const operationId = this.performanceMonitor.startOperation('full-sync');
    
    try {
      console.log('🔄 Starting full synchronization...');
      
      // Get sync timestamp before starting
      const syncStartTime = Date.now();
      
      // Sync stores in dependency order
      const syncOrder = this.determineSyncOrder();
      const syncResults = [];
      
      for (const storeName of syncOrder) {
        if (this.syncLocks.has(storeName)) {
          console.warn(`Store "${storeName}" sync already in progress, skipping...`);
          continue;
        }
        
        try {
          this.syncLocks.set(storeName, syncStartTime);
          const result = await this.syncStoreWithConflictResolution(storeName);
          syncResults.push({ store: storeName, success: true, result });
        } catch (error) {
          console.error(`Full sync failed for store "${storeName}":`, error);
          syncResults.push({ store: storeName, success: false, error: error.message });
        } finally {
          this.syncLocks.delete(storeName);
        }
      }
      
      // Update sync health metrics
      const syncDuration = Date.now() - syncStartTime;
      this.updateSyncHealth(true, syncDuration);
      this.lastSyncTimestamp = Date.now();
      
      // Emit sync completion event
      await this.eventBus.emit('system:full_sync_completed', {
        timestamp: this.lastSyncTimestamp,
        duration: syncDuration,
        results: syncResults,
        successful: syncResults.filter(r => r.success).length,
        failed: syncResults.filter(r => !r.success).length
      });
      
      this.performanceMonitor.endOperation(operationId, true);
      console.log(`✅ Full sync completed in ${syncDuration}ms`);
      return syncResults;
      
    } catch (error) {
      this.updateSyncHealth(false, 0);
      this.performanceMonitor.endOperation(operationId, false, error);
      console.error('❌ Full sync failed:', error);
      throw error;
    }
  }

  determineSyncOrder() {
    // Create dependency graph
    const graph = new Map();
    const visited = new Set();
    const result = [];
    
    // Initialize graph
    for (const [storeName, store] of this.stores.entries()) {
      graph.set(storeName, store.dependencies || []);
    }
    
    // Topological sort
    const visit = (storeName) => {
      if (visited.has(storeName)) return;
      visited.add(storeName);
      
      const dependencies = graph.get(storeName) || [];
      for (const dep of dependencies) {
        if (dep !== '*' && graph.has(dep)) {
          visit(dep);
        }
      }
      
      result.push(storeName);
    };
    
    // Visit all stores
    for (const storeName of graph.keys()) {
      visit(storeName);
    }
    
    return result;
  }

  async syncStoreWithConflictResolution(storeName) {
    const store = this.stores.get(storeName);
    if (!store || !store.isActive) {
      throw new Error(`Store "${storeName}" not available for sync`);
    }
    
    try {
      // Get current state
      const currentState = store.hook.getState();
      const lastKnownState = this.storeStates.get(storeName);
      
      // Detect conflicts
      const conflicts = this.detectConflicts(storeName, currentState, lastKnownState);
      
      if (conflicts.length > 0) {
        console.log(`⚠️ Detected ${conflicts.length} conflicts in store "${storeName}"`);
        await this.resolveConflicts(storeName, conflicts);
      }
      
      // Perform actual sync
      const syncResult = await this.syncSingleStore(storeName);
      
      // Verify sync success
      await this.verifySyncIntegrity(storeName);
      
      return syncResult;
      
    } catch (error) {
      console.error(`Conflict resolution sync failed for "${storeName}":`, error);
      throw error;
    }
  }

  detectConflicts(storeName, currentState, lastKnownState) {
    if (!lastKnownState) return [];
    
    const conflicts = [];
    
    // Compare timestamps if available
    if (currentState.lastModified && lastKnownState.lastModified) {
      if (currentState.lastModified < lastKnownState.lastModified) {
        conflicts.push({
          type: 'timestamp_conflict',
          field: 'lastModified',
          current: currentState.lastModified,
          known: lastKnownState.lastModified
        });
      }
    }
    
    // Compare version numbers if available
    if (currentState.version && lastKnownState.version) {
      if (currentState.version < lastKnownState.version) {
        conflicts.push({
          type: 'version_conflict',
          field: 'version',
          current: currentState.version,
          known: lastKnownState.version
        });
      }
    }
    
    // Deep compare specific fields that shouldn't change during offline mode
    const criticalFields = ['products', 'inventory', 'sales', 'customers'];
    for (const field of criticalFields) {
      if (currentState[field] && lastKnownState[field]) {
        const conflicts_found = this.compareObjects(
          currentState[field], 
          lastKnownState[field], 
          field
        );
        conflicts.push(...conflicts_found);
      }
    }
    
    return conflicts;
  }

  compareObjects(current, known, fieldName) {
    const conflicts = [];
    
    // Handle arrays
    if (Array.isArray(current) && Array.isArray(known)) {
      if (current.length !== known.length) {
        conflicts.push({
          type: 'array_length_conflict',
          field: fieldName,
          currentLength: current.length,
          knownLength: known.length
        });
      }
      
      // Compare individual items by ID if available
      const currentIds = new Set(current.map(item => item._id || item.id).filter(Boolean));
      const knownIds = new Set(known.map(item => item._id || item.id).filter(Boolean));
      
      const addedIds = [...currentIds].filter(id => !knownIds.has(id));
      const removedIds = [...knownIds].filter(id => !currentIds.has(id));
      
      if (addedIds.length > 0) {
        conflicts.push({
          type: 'items_added',
          field: fieldName,
          addedIds
        });
      }
      
      if (removedIds.length > 0) {
        conflicts.push({
          type: 'items_removed',
          field: fieldName,
          removedIds
        });
      }
    }
    
    return conflicts;
  }

  async resolveConflicts(storeName, conflicts) {
    console.log(`🔧 Resolving ${conflicts.length} conflicts for store "${storeName}"`);
    
    const resolutionStrategy = this.getResolutionStrategy(storeName);
    
    switch (resolutionStrategy) {
      case 'merge':
        await this.mergeConflicts(storeName, conflicts);
        break;
      case 'overwrite':
        await this.overwriteConflicts(storeName, conflicts);
        break;
      case 'manual':
        await this.requestManualResolution(storeName, conflicts);
        break;
      default:
        throw new Error(`Unknown resolution strategy: ${resolutionStrategy}`);
    }
  }

  getResolutionStrategy(storeName) {
    // Store-specific strategies
    const strategies = {
      'inventory': 'merge',    // Always merge inventory changes
      'sales': 'overwrite',    // Sales data should be authoritative
      'audit': 'merge',        // Audit trails should be merged  
      'auth': 'overwrite',     // Auth state should be current
      'settings': 'manual'     // Settings conflicts need manual review
    };
    
    return strategies[storeName] || this.syncStrategy;
  }

  async mergeConflicts(storeName, conflicts) {
    const store = this.stores.get(storeName);
    const currentState = store.hook.getState();
    
    for (const conflict of conflicts) {
      try {
        switch (conflict.type) {
          case 'items_added':
            await this.mergeAddedItems(storeName, conflict);
            break;
          case 'items_removed':
            await this.handleRemovedItems(storeName, conflict);
            break;
          case 'timestamp_conflict':
            await this.resolveTimestampConflict(storeName, conflict);
            break;
          default:
            console.warn(`Unknown conflict type: ${conflict.type}`);
        }
      } catch (error) {
        console.error(`Failed to merge conflict:`, error);
      }
    }
  }

  async mergeAddedItems(storeName, conflict) {
    // Implementation depends on store structure
    // This is a placeholder for the actual merge logic
    console.log(`🔀 Merging added items for ${storeName}:`, conflict.addedIds);
    
    // Emit conflict resolution event
    await this.eventBus.emit('system:conflict_resolved', {
      storeName,
      conflictType: conflict.type,
      resolution: 'merged',
      affectedIds: conflict.addedIds
    });
  }

  async handleRemovedItems(storeName, conflict) {
    console.log(`🗑️ Handling removed items for ${storeName}:`, conflict.removedIds);
    
    // Emit conflict resolution event
    await this.eventBus.emit('system:conflict_resolved', {
      storeName,
      conflictType: conflict.type,
      resolution: 'handled',
      affectedIds: conflict.removedIds
    });
  }

  async resolveTimestampConflict(storeName, conflict) {
    console.log(`⏰ Resolving timestamp conflict for ${storeName}`);
    
    // Use the most recent timestamp
    const store = this.stores.get(storeName);
    const storeState = store.hook.getState();
    
    if (typeof storeState.updateTimestamp === 'function') {
      await storeState.updateTimestamp(Math.max(conflict.current, conflict.known));
    }
  }

  async verifySyncIntegrity(storeName) {
    const store = this.stores.get(storeName);
    if (!store) return false;
    
    try {
      const storeState = store.hook.getState();
      
      // Check if store has integrity verification methods
      if (typeof storeState.verifyIntegrity === 'function') {
        const isValid = await storeState.verifyIntegrity();
        if (!isValid) {
          throw new Error(`Store "${storeName}" failed integrity check`);
        }
      }
      
      // Basic checks
      if (storeState.error) {
        throw new Error(`Store "${storeName}" is in error state: ${storeState.error}`);
      }
      
      return true;
      
    } catch (error) {
      console.error(`Integrity verification failed for "${storeName}":`, error);
      throw error;
    }
  }

  // ===================================================================
  //  📊 BATCH PROCESSING
  // ===================================================================

  initializeBatchProcessor() {
    if (this.batchProcessor) return;
    
    this.batchProcessor = {
      batches: new Map(),
      queue: [],
      processing: false,
      processInterval: null
    };
    
    // Start batch processing
    this.batchProcessor.processInterval = setInterval(() => {
      this.processBatches();
    }, this.batchTimeout);
  }

  addToBatch(operation) {
    if (!this.batchProcessor) {
      this.initializeBatchProcessor();
    }
    
    const batchKey = this.getBatchKey(operation);
    
    if (!this.batchProcessor.batches.has(batchKey)) {
      this.batchProcessor.batches.set(batchKey, {
        key: batchKey,
        operations: [],
        createdAt: Date.now(),
        priority: operation.priority || 0
      });
    }
    
    const batch = this.batchProcessor.batches.get(batchKey);
    batch.operations.push(operation);
    
    // Process immediately if batch is full
    if (batch.operations.length >= this.batchSize) {
      this.processBatch(batch);
      this.batchProcessor.batches.delete(batchKey);
    }
  }

  getBatchKey(operation) {
    // Group operations by type and store
    return `${operation.type}-${operation.storeName || 'global'}`;
  }

  async processBatches() {
    if (this.batchProcessor.processing) return;
    
    this.batchProcessor.processing = true;
    
    try {
      const batchesToProcess = Array.from(this.batchProcessor.batches.values())
        .filter(batch => Date.now() - batch.createdAt > this.batchTimeout)
        .sort((a, b) => b.priority - a.priority);
      
      for (const batch of batchesToProcess) {
        await this.processBatch(batch);
        this.batchProcessor.batches.delete(batch.key);
      }
      
    } catch (error) {
      console.error('Batch processing error:', error);
    } finally {
      this.batchProcessor.processing = false;
    }
  }

  async processBatch(batch) {
    console.log(`📦 Processing batch: ${batch.key} (${batch.operations.length} operations)`);
    
    try {
      const results = [];
      
      for (const operation of batch.operations) {
        try {
          const result = await this.executeOperation(operation);
          results.push({ operation: operation.id, success: true, result });
        } catch (error) {
          results.push({ operation: operation.id, success: false, error: error.message });
        }
      }
      
      // Emit batch completion event
      await this.eventBus.emit('system:batch_processed', {
        batchKey: batch.key,
        operationCount: batch.operations.length,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
        duration: Date.now() - batch.createdAt
      });
      
      return results;
      
    } catch (error) {
      console.error(`Batch processing failed for ${batch.key}:`, error);
      throw error;
    }
  }

  async executeOperation(operation) {
    switch (operation.type) {
      case 'sync':
        return await this.syncSingleStore(operation.storeName);
      case 'event':
        return await this.eventBus.emit(operation.eventName, operation.payload);
      case 'method':
        return await this.executeStoreMethod(operation.storeName, operation.method, operation.args);
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  // ===================================================================
  //  📈 HEALTH MONITORING & METRICS
  // ===================================================================

  updateSyncHealth(success, duration) {
    if (success) {
      this.syncHealth.consecutiveFailures = 0;
      this.syncHealth.lastSuccessfulSync = Date.now();
      
      // Update average sync time
      this.syncHealth.syncTimes.push(duration);
      if (this.syncHealth.syncTimes.length > 10) {
        this.syncHealth.syncTimes.shift();
      }
      
      this.syncHealth.averageSyncTime = 
        this.syncHealth.syncTimes.reduce((a, b) => a + b, 0) / this.syncHealth.syncTimes.length;
        
    } else {
      this.syncHealth.consecutiveFailures++;
    }
  }

  getEnhancedMetrics() {
    const baseMetrics = this.getAdapterMetrics();
    
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
        batchProcessor: this.batchProcessor ? {
          activeBatches: this.batchProcessor.batches.size,
          processing: this.batchProcessor.processing
        } : null
      }
    };
  }

  getSystemHealth() {
    const baseHealth = this.getStoreHealth();
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
    
    return {
      ...baseHealth,
      enhanced: {
        status: enhancedStatus,
        issues,
        metrics: this.getEnhancedMetrics().enhanced,
        recommendations: this.generateHealthRecommendations()
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
    
    return recommendations;
  }

  // ===================================================================
  //  🔧 UTILITIES & HELPERS
  // ===================================================================

  generateOperationId() {
    return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async requestManualResolution(storeName, conflicts) {
    // Emit event for UI to handle manual conflict resolution
    await this.eventBus.emit('system:manual_conflict_resolution_required', {
      storeName,
      conflicts,
      timestamp: Date.now()
    });
    
    console.log(`🤝 Manual conflict resolution requested for store "${storeName}"`);
    
    // This would typically wait for user input or another system to resolve
    // For now, we'll just log it
    return new Promise((resolve) => {
      // In a real implementation, this would wait for resolution
      setTimeout(resolve, 1000);
    });
  }

  async overwriteConflicts(storeName, conflicts) {
    console.log(`🔄 Overwriting conflicts for store "${storeName}"`);
    
    // Force sync to overwrite local changes
    await this.syncSingleStore(storeName);
    
    // Emit resolution event
    await this.eventBus.emit('system:conflicts_overwritten', {
      storeName,
      conflictCount: conflicts.length,
      timestamp: Date.now()
    });
  }

  // ===================================================================
  //  🧹 ENHANCED CLEANUP
  // ===================================================================

  async destroy() {
    console.log('🧹 Destroying Enhanced Store Adapter...');
    
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
  //  🏭 ENHANCED FACTORY METHODS
  // ===================================================================

  static async createEnhanced(config = {}) {
    const enhancedConfig = {
      AUTO_SYNC_INTERVAL: 5 * 60 * 1000,
      BATCH_SIZE: 50,
      BATCH_TIMEOUT: 5000,
      RETRY_ATTEMPTS: 3,
      OFFLINE_QUEUE_LIMIT: 1000,
      SYNC_STRATEGY: 'merge',
      PERFORMANCE_TRACKING: true,
      ...config
    };
    
    const adapter = new EnhancedStoreAdapter(enhancedConfig);
    await adapter.init();
    
    // Initialize event handler
    adapter.eventHandler = new StoreEventHandler(adapter);
    
    // Initialize batch processor
    adapter.initializeBatchProcessor();
    
    return adapter;
  }
}

// ===================================================================
//  🎯 CONVENIENCE FUNCTIONS
// ===================================================================

let globalEnhancedAdapter = null;

export const createEnhancedStoreAdapter = async (config = {}) => {
  if (globalEnhancedAdapter) {
    console.warn('Global enhanced store adapter already exists');
    return globalEnhancedAdapter;
  }

  globalEnhancedAdapter = await EnhancedStoreAdapter.createEnhanced(config);
  return globalEnhancedAdapter;
};

export const getEnhancedStoreAdapter = () => {
  return globalEnhancedAdapter;
};

export const destroyEnhancedStoreAdapter = async () => {
  if (globalEnhancedAdapter) {
    await globalEnhancedAdapter.destroy();
    globalEnhancedAdapter = null;
  }
};

// Export default
export default EnhancedStoreAdapter;
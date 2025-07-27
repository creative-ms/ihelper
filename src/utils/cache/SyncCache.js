// ===================================
// src/utils/cache/SyncCache.js - Fixed with conflict resolution
// ===================================
import { syncMetadataDB } from './databases.js';

const SyncCache = {
  // Improved updateSyncMetadata with retry logic and conflict resolution
  async updateSyncMetadata(key, value, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const metadata = {
          _id: key,
          value,
          timestamp: new Date().toISOString(),
          version: Date.now()
        };
        
        // Get existing metadata to preserve _rev
        try {
          const existingMetadata = await syncMetadataDB.get(key);
          metadata._rev = existingMetadata._rev;
        } catch (error) {
          if (error.name !== 'not_found') {
            throw error;
          }
          // Document doesn't exist, no _rev needed
        }
        
        await syncMetadataDB.put(metadata);
        return; // Success, exit retry loop
        
      } catch (error) {
        if (error.name === 'conflict' && attempt < maxRetries - 1) {
          console.log(`⚠️ Sync metadata conflict for key "${key}", retrying (${attempt + 1}/${maxRetries})...`);
          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
          continue;
        }
        
        // If it's not a conflict or we've exhausted retries
        console.error(`Error updating sync metadata for key "${key}":`, error);
        if (attempt === maxRetries - 1) {
          // Last attempt failed, but don't throw to prevent breaking the main operation
          console.warn(`Failed to update sync metadata for "${key}" after ${maxRetries} attempts`);
        }
        return;
      }
    }
  },

  async getSyncMetadata(key) {
    try {
      const metadata = await syncMetadataDB.get(key);
      return metadata;
    } catch (error) {
      if (error.name === 'not_found') {
        return null;
      }
      console.error('Error getting sync metadata:', error);
      return null;
    }
  },

  async getLastSyncTime(key = 'products') {
    try {
      const metadata = await this.getSyncMetadata(key);
      return metadata ? new Date(metadata.timestamp) : null;
    } catch (error) {
      console.error('Error getting last sync time:', error);
      return null;
    }
  },

  async isCacheStale(hours = 1, key = 'products') {
    try {
      const last = await this.getLastSyncTime(key);
      if (!last) return true;
      
      const now = new Date();
      const diff = (now - last) / 1000 / 60 / 60;
      return diff > hours;
    } catch (error) {
      console.error('Error checking cache staleness:', error);
      return true;
    }
  },

  // Batch update multiple sync metadata entries
  async batchUpdateSyncMetadata(updates) {
    const promises = updates.map(({ key, value }) => 
      this.updateSyncMetadata(key, value)
    );
    
    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error in batch sync metadata update:', error);
    }
  },

  // Clear sync metadata for a specific key
  async clearSyncMetadata(key) {
    try {
      const doc = await syncMetadataDB.get(key);
      await syncMetadataDB.remove(doc);
    } catch (error) {
      if (error.name !== 'not_found') {
        console.error(`Error clearing sync metadata for key "${key}":`, error);
      }
    }
  },

  // Get all sync metadata
  async getAllSyncMetadata() {
    try {
      const result = await syncMetadataDB.allDocs({ include_docs: true });
      return result.rows.reduce((acc, row) => {
        acc[row.doc._id] = {
          value: row.doc.value,
          timestamp: row.doc.timestamp,
          version: row.doc.version
        };
        return acc;
      }, {});
    } catch (error) {
      console.error('Error getting all sync metadata:', error);
      return {};
    }
  }
};

export default SyncCache;
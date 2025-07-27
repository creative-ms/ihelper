// src/pages/audit/AuditPage.jsx
import React, { useState, useCallback } from 'react';
import { useAuditStore } from '../../stores/auditStore.js';
import ProductSearch from '../../components/purchases/ProductSearch.jsx';
import AuditTrailTable from './AuditTrailTable.jsx';
import { X } from 'lucide-react';

const AuditPage = () => {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const fetchLogsForProduct = useAuditStore(state => state.fetchLogsForProduct);

  const handleProductSelect = useCallback((product) => {
    if (!product) return;
    
    // ✅ FIX: Check for both `_id` (from CouchDB) and `id` (from MeiliSearch)
    const productId = product._id || product.id;

    setSelectedProduct(product);
    // Ab hum hamesha sahi ID bhejenge
    fetchLogsForProduct(productId);
    
  }, [fetchLogsForProduct]);

  const handleClear = () => {
    setSelectedProduct(null);
    // Clear the logs in the store as well
    useAuditStore.getState().fetchLogsForProduct(null);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-dark-text">Product Audit Trail</h1>
          <p className="text-slate-500 dark:text-dark-text-secondary mt-1">Track every action for a specific product from creation to sale.</p>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-secondary p-4 rounded-2xl shadow-lg">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Search for a Product</label>
        <div className="flex items-center gap-4">
          <div className="flex-grow">
            <ProductSearch onProductSelect={handleProductSelect} />
          </div>
          {selectedProduct && (
            <button 
              onClick={handleClear} 
              className="btn-secondary flex items-center bg-red-100 text-red-700 border-red-200 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30 dark:hover:bg-red-500/30"
            >
              <X size={16} className="mr-2" />
              Clear
            </button>
          )}
        </div>
      </div>
      
      <AuditTrailTable product={selectedProduct} />

    </div>
  );
};

export default AuditPage;

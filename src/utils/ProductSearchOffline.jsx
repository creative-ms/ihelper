import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner'; // optional
import CacheManager from './utils/cacheManager';

const ProductSearchOffline = ({ onProductSelect }) => {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check if Meilisearch is available through secure proxy
  const checkMeiliHealth = async () => {
    try {
      if (window.electronAPI && window.electronAPI.search) {
        // Try a simple search to test connectivity
        await window.electronAPI.search({
          indexName: 'products',
          searchTerm: '',
          options: { limit: 1 }
        });
        setIsOfflineMode(false);
      } else {
        setIsOfflineMode(true);
      }
    } catch (error) {
      console.log('Meilisearch not available, using offline mode');
      setIsOfflineMode(true);
    }
  };

  useEffect(() => {
    checkMeiliHealth();
  }, []);

  // Enhanced search using secure Meilisearch proxy
  const searchMeiliProducts = async (searchTerm) => {
    try {
      if (!window.electronAPI || !window.electronAPI.search) {
        return [];
      }

      const results = await window.electronAPI.search({
        indexName: 'products',
        searchTerm,
        options: {
          limit: 20,
          attributesToRetrieve: [
            '_id',
            'name', 
            'sku', 
            'category', 
            'brand',
            'batches',
            'saleUnits',
            'totalQuantity'
          ],
          attributesToHighlight: ['name', 'sku'],
        }
      });

      return Array.isArray(results) ? results : [];
    } catch (error) {
      console.error('Meilisearch search failed:', error);
      return [];
    }
  };

  const handleSearch = async (value) => {
    setKeyword(value);
    setLoading(true);
    let data = [];
    
    try {
      if (!value.trim()) {
        setResults([]);
        return;
      }

      if (isOfflineMode) {
        // Use offline cache search
        console.log('🔌 Using offline search');
        data = await CacheManager.searchProductsOffline(value);
      } else {
        // Use secure Meilisearch proxy
        console.log('🌐 Using secure Meilisearch proxy');
        data = await searchMeiliProducts(value);
        
        // If online search fails, fallback to offline
        if (data.length === 0) {
          console.log('Fallback to offline search');
          data = await CacheManager.searchProductsOffline(value);
        }
      }

      // Enhance results with latest pricing info
      const enhancedResults = data.map(product => {
        // Get latest retail price from newest batch
        let latestRetailPrice = 0;
        if (product.batches && product.batches.length > 0) {
          const sortedBatches = product.batches.sort((a, b) => 
            new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
          );
          latestRetailPrice = sortedBatches[0].retailPrice || 0;
        }

        return {
          ...product,
          latestRetailPrice,
          totalQuantity: product.totalQuantity || 0
        };
      });

      setResults(enhancedResults);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Search product by name or SKU"
          value={keyword}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1"
        />
        <div className="text-xs text-gray-500 flex items-center gap-1">
          {isOfflineMode ? (
            <>
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              Offline
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Online
            </>
          )}
        </div>
      </div>

      {loading && (
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="w-4 h-4" />
          Searching...
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-2 border rounded-md max-h-60 overflow-y-auto bg-white shadow-sm dark:bg-slate-800">
          {results.map((prod) => (
            <div
              key={prod._id}
              className="p-3 border-b last:border-none cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              onClick={() => onProductSelect(prod)}
            >
              <div className="font-medium text-sm">{prod.name}</div>
              {prod.sku && (
                <div className="text-xs text-muted-foreground mt-1">
                  SKU: {prod.sku}
                </div>
              )}
              <div className="flex justify-between items-center mt-2 text-xs">
                <span className="text-green-600 font-medium">
                  Rs {prod.latestRetailPrice?.toLocaleString() || '0'}
                </span>
                <span className="text-gray-500">
                  Stock: {prod.totalQuantity || 0}
                </span>
              </div>
              {prod.category && (
                <div className="text-xs text-blue-600 mt-1 bg-blue-50 px-2 py-1 rounded inline-block">
                  {prod.category}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && keyword && results.length === 0 && (
        <div className="text-xs mt-3 text-center text-muted-foreground p-4 border rounded-md bg-gray-50 dark:bg-slate-800">
          <div className="mb-1">No products found for "{keyword}"</div>
          <div className="text-gray-400">
            {isOfflineMode 
              ? 'Try syncing data when online' 
              : 'Check spelling or try different keywords'
            }
          </div>
        </div>
      )}

      {!loading && !keyword && (
        <div className="text-xs mt-2 text-center text-muted-foreground">
          Start typing to search products...
        </div>
      )}
    </div>
  );
};

export default ProductSearchOffline;
// src/stores/cartStore.js - FIXED VERSION with correct inventory method call
import { create } from 'zustand';
import axios from 'axios';
import { useProductStore } from './productStore.js';
import { useInventoryStore } from './inventoryStore.js';
import { useSalesStore } from './salesStore.js';
import { getUnitConversionFactor, checkStockAvailability, isItemExpired } from './validationService.js';

// --- Database Configuration ---
const PRODUCTS_DB_URL = 'http://localhost:5984/products';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

// --- Performance Configuration ---
const PERFORMANCE_CONFIG = {
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  DEBOUNCE_DELAY: 200,
  BATCH_SIZE: 50,
  MAX_CACHE_SIZE: 100
};

// 🚀 OPTIMIZATION: Enhanced in-memory cache with LRU eviction
class ProductCache {
  constructor(maxSize = PERFORMANCE_CONFIG.MAX_CACHE_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.hitCount = 0;
    this.missCount = 0;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.missCount++;
      return null;
    }

    if (Date.now() - item.timestamp > PERFORMANCE_CONFIG.CACHE_DURATION) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    this.hitCount++;
    return item.data;
  }

  set(key, data) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clear() {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  getStats() {
    const total = this.hitCount + this.missCount;
    return {
      hitRate: total > 0 ? (this.hitCount / total * 100).toFixed(2) + '%' : '0%',
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }
}

// 🚀 OPTIMIZATION: Initialize enhanced cache
const productCache = new ProductCache();

// 🚀 OPTIMIZATION: Performance monitor for cart operations
class CartPerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }

  start(operation) {
    this.metrics.set(operation, performance.now());
  }

  end(operation) {
    const startTime = this.metrics.get(operation);
    if (startTime) {
      const duration = performance.now() - startTime;
      if (duration > 100) { // Only log slow operations
        console.log(`🛒 ${operation}: ${duration.toFixed(2)}ms`);
      }
      this.metrics.delete(operation);
      return duration;
    }
  }
}

const perfMonitor = new CartPerformanceMonitor();

// 🚀 OPTIMIZATION: Batch product fetching
const batchFetchProducts = async (productIds) => {
  const uncachedIds = productIds.filter(id => !productCache.get(id));
  
  if (uncachedIds.length === 0) {
    return productIds.map(id => productCache.get(id)).filter(Boolean);
  }

  try {
    const requests = uncachedIds.map(id => 
      axios.get(`${PRODUCTS_DB_URL}/${id}`, DB_AUTH).catch(err => ({ error: err, id }))
    );
    
    const responses = await Promise.all(requests);
    const products = [];
    
    responses.forEach((response, index) => {
      if (response.error) {
        console.error(`Error fetching product ${uncachedIds[index]}:`, response.error);
        return;
      }
      
      const product = response.data;
      productCache.set(product._id, product);
      products.push(product);
    });

    // Return all requested products (cached + newly fetched)
    return productIds.map(id => productCache.get(id)).filter(Boolean);
  } catch (error) {
    console.error('Batch fetch failed:', error);
    return [];
  }
};

// 🚀 OPTIMIZATION: Optimized debounce with idle callback
const createOptimizedDebounce = (func, delay) => {
  let timeoutId;
  let lastExecution = 0;
  
  return function executedFunction(...args) {
    const later = () => {
      const now = Date.now();
      const timeSinceLastExecution = now - lastExecution;
      
      if (timeSinceLastExecution >= delay) {
        lastExecution = now;
        
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => func.apply(this, args), { timeout: 50 });
        } else {
          setTimeout(() => func.apply(this, args), 0);
        }
      }
    };

    clearTimeout(timeoutId);
    timeoutId = setTimeout(later, delay);
  };
};

// 🚀 OPTIMIZATION: Debounced stock validation
const debouncedStockCheck = createOptimizedDebounce((callback) => {
  callback();
}, PERFORMANCE_CONFIG.DEBOUNCE_DELAY);

export const useCartStore = create((set, get) => ({
    items: [],
    selectedCustomer: null,
    walkInCustomerName: '',
    isExpiryModalOpen: false,
    itemToAddAfterConfirmation: null,
    isLoading: false,

    // --- Performance Metrics ---
    getCacheStats: () => productCache.getStats(),
    clearPerformanceCache: () => {
      productCache.clear();
      console.log('🧹 Cart cache cleared');
    },

    // --- Basic Actions ---
    selectCustomer: (customer) => set({ selectedCustomer: customer }),
    setItems: (newItems) => set({ items: newItems }),
    addToCart: (product) => get().addToCartWithUnit(product, 'Box'),
    clearCart: () => {
      set({ items: [], selectedCustomer: null, walkInCustomerName: ''  });
      
      // Clear cache periodically to prevent memory leaks
      if (Math.random() < 0.1) { // 10% chance
        productCache.clear();
      }
    },
    setLoading: (loading) => set({ isLoading: loading }),
    // ✅ NEW: Action to set walk-in customer name
    setWalkInCustomerName: (name) => set({ walkInCustomerName: name }),

    
    // --- Optimized Cart Utility Functions ---
    getTotalItemsCount: () => {
        const { items } = get();
        return items.reduce((total, item) => total + item.quantity, 0);
    },
    
    getTotalPrice: () => {
        const { items } = get();
        return items.reduce((total, item) => {
            const itemPrice = (item.sellingPrice * item.quantity) - (item.extraDiscount || 0);
            return total + itemPrice;
        }, 0);
    },
    
    // --- Expiry Modal Actions ---
    openExpiryModal: (itemData) => set({ isExpiryModalOpen: true, itemToAddAfterConfirmation: itemData }),
    closeExpiryModal: () => set({ isExpiryModalOpen: false, itemToAddAfterConfirmation: null }),
    
    // 🚀 OPTIMIZATION: Streamlined item addition
    _proceedToAddItem: (product, unitName, activeBatch) => {
        perfMonitor.start('addItem');
        
        const conversionFactor = getUnitConversionFactor(product, unitName);
        const sellingPrice = (parseFloat(activeBatch.retailPrice) || 0) * conversionFactor;
        const cartItemId = `${product._id}-${activeBatch.id}-${unitName}`;
        
        set(state => {
            const existingItemIndex = state.items.findIndex(item => item.cartItemId === cartItemId);
            
            if (existingItemIndex !== -1) {
                // Update existing item
                const updatedItems = [...state.items];
                updatedItems[existingItemIndex] = {
                    ...updatedItems[existingItemIndex],
                    quantity: updatedItems[existingItemIndex].quantity + 1
                };
                perfMonitor.end('addItem');
                return { items: updatedItems };
            } else {
                // Add new item
                const newItem = {
                    ...product,
                    cartItemId,
                    quantity: 1,
                    sellingUnit: unitName,
                    sellingPrice,
                    extraDiscount: 0,
                    sourceBatchInfo: {
                        id: activeBatch.id,
                        batchNumber: activeBatch.batchNumber,
                        expDate: activeBatch.expDate,
                        retailPrice: activeBatch.retailPrice,
                        purchasePrice: activeBatch.purchasePrice 
                    }
                };
                perfMonitor.end('addItem');
                return { items: [...state.items, newItem] };
            }
        });
    },

    confirmAndAddItem: () => {
        const { itemToAddAfterConfirmation } = get();
        if (itemToAddAfterConfirmation) {
            get()._proceedToAddItem(
                itemToAddAfterConfirmation.product, 
                itemToAddAfterConfirmation.unitName, 
                itemToAddAfterConfirmation.activeBatch
            );
        }
        get().closeExpiryModal();
    },

    addManualItemToCart: (itemData) => {
        const { name, costPrice, sellingPrice, quantity } = itemData;
        const uniqueId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const newItem = {
            name,
            quantity,
            sellingPrice,
            extraDiscount: 0,
            isManual: true,
            manualCostPrice: costPrice,
            _id: uniqueId,
            cartItemId: uniqueId,
            taxRate: 0,
            discountRate: 0,
            sellingUnit: 'Unit',
            sourceBatchInfo: { batchNumber: 'MANUAL' },
        };

        set(state => ({ items: [...state.items, newItem] }));
    },

    // 🚀 OPTIMIZED: Enhanced addToCartWithUnit with better caching
    addToCartWithUnit: async (product, unitName) => {
        perfMonitor.start('addToCartWithUnit');
        set({ isLoading: true });
        
        try {
            // 🚀 Try cache first
            let fullProduct = productCache.get(product._id);
            
            if (!fullProduct) {
                // Fetch with retry logic
                let retries = 2;
                while (retries > 0 && !fullProduct) {
                    try {
                        const response = await axios.get(`${PRODUCTS_DB_URL}/${product._id}`, DB_AUTH);
                        fullProduct = response.data;
                        productCache.set(product._id, fullProduct);
                        break;
                    } catch (error) {
                        retries--;
                        if (retries === 0) {
                            console.error('Failed to fetch product after retries:', error);
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay
                    }
                }
            }

            if (!fullProduct) {
                console.error('Product not found or failed to fetch');
                return;
            }
            
            const { items } = get();
            
            // 🚀 OPTIMIZATION: Parallel stock calculations
            const [stockAlreadyInCart, stockRequiredForNewUnit] = await Promise.all([
                Promise.resolve(items
                    .filter(i => i._id === fullProduct._id)
                    .reduce((total, item) => total + (item.quantity * getUnitConversionFactor(item, item.sellingUnit)), 0)),
                Promise.resolve(getUnitConversionFactor(fullProduct, unitName))
            ]);

            // 🚀 Quick stock validation
            if (!checkStockAvailability(fullProduct, stockAlreadyInCart, stockRequiredForNewUnit)) {
                return;
            }

            // 🚀 OPTIMIZATION: Optimized batch selection with early exit
            const boxConversionFactor = getUnitConversionFactor(fullProduct, 'Box');
            const availableBatches = (fullProduct.batches || [])
                .filter(b => (Number(b.quantity) || 0) > 0)
                .sort((a, b) => new Date(a.expDate) - new Date(b.expDate)); // FEFO

            if (availableBatches.length === 0) {
                alert(`'${fullProduct.name}' ka stock khatam ho gaya hai.`);
                return;
            }

            let activeBatch;
            
            if (unitName.toLowerCase() === 'box') {
                activeBatch = availableBatches.find(b => (Number(b.quantity) || 0) >= boxConversionFactor);
                if (!activeBatch) {
                    alert(`'${fullProduct.name}' ka koi bhi sealed box dastyaab nahi hai.`);
                    return;
                }
            } else {
                // Prefer opened boxes first
                activeBatch = availableBatches.find(b => (Number(b.quantity) || 0) < boxConversionFactor) || availableBatches[0];
            }

            if (!activeBatch) {
                alert(`'${fullProduct.name}' ke liye munasib batch nahi mil saka.`);
                return;
            }

            // 🚀 Quick expiry check
            if (activeBatch.expDate && new Date(activeBatch.expDate) < new Date()) {
                get().openExpiryModal({ product: fullProduct, unitName, activeBatch });
                return;
            }

            get()._proceedToAddItem(fullProduct, unitName, activeBatch);

        } catch (error) { 
            console.error("Cart mein item add karte waqt error:", error); 
        } finally {
            set({ isLoading: false });
            perfMonitor.end('addToCartWithUnit');
        }
    },

    // 🚀 OPTIMIZED: Batch increase quantity for multiple items
    batchIncreaseQuantity: async (cartItemIds) => {
        if (!Array.isArray(cartItemIds) || cartItemIds.length === 0) return;
        
        perfMonitor.start('batchIncreaseQuantity');
        const { items } = get();
        
        try {
            const itemsToIncrease = items.filter(item => cartItemIds.includes(item.cartItemId));
            const productIds = [...new Set(itemsToIncrease.map(item => item._id))];
            
            // Batch fetch products
            const fullProducts = await batchFetchProducts(productIds);
            const productMap = new Map(fullProducts.map(p => [p._id, p]));
            
            // Validate all items can be increased
            const validUpdates = [];
            
            for (const item of itemsToIncrease) {
                const fullProduct = productMap.get(item._id);
                if (!fullProduct) continue;
                
                const stockAlreadyInCart = items
                    .filter(i => i._id === fullProduct._id)
                    .reduce((total, cartItem) => total + (cartItem.quantity * getUnitConversionFactor(cartItem, cartItem.sellingUnit)), 0);
                
                const stockRequiredForOneMore = getUnitConversionFactor(fullProduct, item.sellingUnit);
                
                if (checkStockAvailability(fullProduct, stockAlreadyInCart, stockRequiredForOneMore)) {
                    validUpdates.push(item.cartItemId);
                }
            }
            
            if (validUpdates.length > 0) {
                set(state => ({
                    items: state.items.map(item => 
                        validUpdates.includes(item.cartItemId)
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                    )
                }));
            }
            
            perfMonitor.end('batchIncreaseQuantity');
        } catch (error) {
            console.error('Batch increase quantity error:', error);
            perfMonitor.end('batchIncreaseQuantity');
        }
    },

    // 🚀 OPTIMIZED: increaseQuantity with cache
    increaseQuantity: async (cartItemId) => {
        const { items, batchIncreaseQuantity } = get();
        const itemToIncrease = items.find(item => item.cartItemId === cartItemId);
        if (!itemToIncrease) return;
        
        // Use batch operation for consistency
        await batchIncreaseQuantity([cartItemId]);
    },

    decreaseQuantity: (cartItemId) => {
        set(state => ({
            items: state.items.map(item => 
                item.cartItemId === cartItemId && item.quantity > 1 
                ? { ...item, quantity: item.quantity - 1 } 
                : item
            )
        }));
    },

    // 🚀 OPTIMIZATION: Batch remove multiple items
    batchRemoveFromCart: (cartItemIds) => {
        if (!Array.isArray(cartItemIds)) return;
        
        set(state => ({
            items: state.items.filter(item => !cartItemIds.includes(item.cartItemId))
        }));
    },

    removeFromCart: (cartItemId) => {
        get().batchRemoveFromCart([cartItemId]);
    },

    // 🚀 OPTIMIZATION: Batch apply discounts
    batchApplyExtraDiscount: (discountUpdates) => {
        if (!Array.isArray(discountUpdates)) return;
        
        set(state => ({
            items: state.items.map(item => {
                const update = discountUpdates.find(u => u.cartItemId === item.cartItemId);
                return update 
                    ? { ...item, extraDiscount: parseFloat(update.discount) || 0 }
                    : item;
            })
        }));
    },

    applyExtraDiscount: (cartItemId, discount) => {
        get().batchApplyExtraDiscount([{ cartItemId, discount }]);
    },

    // 🚀 OPTIMIZED: updateSellingUnit with better error handling
    updateSellingUnit: async (cartItemId, newUnitName) => {
        const { items, removeFromCart, addToCartWithUnit } = get();
        const itemToUpdate = items.find(item => item.cartItemId === cartItemId);
        if (!itemToUpdate) return;
        
        perfMonitor.start('updateSellingUnit');
        const originalQuantity = itemToUpdate.quantity;
        
        try {
            removeFromCart(cartItemId);
            
            // Add multiple units if original quantity > 1
            for (let i = 0; i < originalQuantity; i++) {
                await addToCartWithUnit(itemToUpdate, newUnitName);
            }
            
            perfMonitor.end('updateSellingUnit');
        } catch (error) {
            console.error('Error updating selling unit:', error);
            // Restore original item if update fails
            set(state => ({ items: [...state.items, itemToUpdate] }));
            perfMonitor.end('updateSellingUnit');
        }
    },

    // 🚀 OPTIMIZED: Checkout with selective inventory update - FIXED METHOD NAME
  checkout: async (saleDetails) => {
    const { items, selectedCustomer, walkInCustomerName } = get();
    
    if (!items || items.length === 0) {
      console.error("Checkout attempt with no items.");
      return null;
    }

    perfMonitor.start('checkout');
    set({ isLoading: true });

    try {
      const saleRecordToSave = {
        ...saleDetails,
        items,
        customer: selectedCustomer,
        customerName: selectedCustomer?.name || walkInCustomerName || 'Walk-in Customer',
        customerId: selectedCustomer?._id || null,
      };

      // Process the sale
      const result = await useSalesStore.getState().addSale(saleRecordToSave);
      
      if (result) {
        // ✅ FIXED: Use correct method name - updateForSoldItems instead of updateInventoryForSoldItems
        console.log('🔄 Updating inventory for sold items...');
        
        const inventoryUpdateResult = await useInventoryStore.getState()
          .updateForSoldItems(items);
        
        if (inventoryUpdateResult.success) {
          console.log(`✅ Inventory updated for ${inventoryUpdateResult.updatedProducts} products`);
        } else {
          console.warn('⚠️ Inventory update failed, falling back to lightweight sync');
          // Fallback: lightweight sync only if necessary
          await useInventoryStore.getState().smartSync();
        }
        
        // Clear cache after successful checkout
        productCache.clear();
      }
      
      perfMonitor.end('checkout');
      return result;
    } catch (error) {
      console.error('Checkout failed:', error);
      perfMonitor.end('checkout');
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

    // 🚀 OPTIMIZATION: Enhanced validation with caching
    validateCartItems: async () => {
        const { items } = get();
        if (items.length === 0) return { valid: true, issues: [] };
        
        perfMonitor.start('validateCart');
        const issues = [];
        
        try {
            const productIds = [...new Set(items.filter(item => !item.isManual).map(item => item._id))];
            const fullProducts = await batchFetchProducts(productIds);
            const productMap = new Map(fullProducts.map(p => [p._id, p]));
            
            for (const item of items) {
                if (item.isManual) continue;
                
                const fullProduct = productMap.get(item._id);
                if (!fullProduct) {
                    issues.push(`Product ${item.name} not found`);
                    continue;
                }
                
                const factor = getUnitConversionFactor(fullProduct, item.sellingUnit);
                const requiredStock = item.quantity * factor;
                const availableStock = (fullProduct.batches || [])
                    .reduce((total, batch) => total + (Number(batch.quantity) || 0), 0);
                
                if (requiredStock > availableStock) {
                    issues.push(`Insufficient stock for ${item.name}`);
                }
            }
            
            perfMonitor.end('validateCart');
            return { valid: issues.length === 0, issues };
        } catch (error) {
            console.error('Cart validation error:', error);
            perfMonitor.end('validateCart');
            return { valid: false, issues: ['Validation failed'] };
        }
    },
}));
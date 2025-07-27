// src/stores/invenotory/inventoryFilters.js
export const applyInventoryFilters = (inventory, filters) => {
  if (!inventory || inventory.length === 0) return [];

  let filtered = [...inventory];

  // Category filter
  if (filters.category) {
    filtered = filtered.filter(product => 
      product.category?.toLowerCase() === filters.category.toLowerCase()
    );
  }

  // Stock status filter
  if (filters.stockStatus) {
    filtered = filtered.filter(product => {
      const totalQuantity = product.totalQuantity || 0;
      const lowStockThreshold = product.lowStockThreshold || 10;
      const overstockThreshold = product.overstockThreshold || 100;

      switch (filters.stockStatus) {
        case 'out-of-stock':
          return totalQuantity <= 0;
        case 'low-stock':
          return totalQuantity > 0 && totalQuantity <= lowStockThreshold;
        case 'in-stock':
          return totalQuantity > lowStockThreshold && totalQuantity <= overstockThreshold;
        case 'overstock':
          return totalQuantity > overstockThreshold;
        default:
          return true;
      }
    });
  }

  // Expiry status filter
  if (filters.expiryStatus) {
    const now = new Date();
    const expiringSoonDate = new Date();
    expiringSoonDate.setDate(now.getDate() + 30);

    filtered = filtered.filter(product => {
      if (!product.batches || product.batches.length === 0) {
        return filters.expiryStatus === 'fresh'; // Products without batches are considered fresh
      }

      const hasExpiredBatch = product.batches.some(batch => {
        if (!batch.expDate) return false;
        return new Date(batch.expDate) < now;
      });

      const hasExpiringSoonBatch = product.batches.some(batch => {
        if (!batch.expDate) return false;
        const expiryDate = new Date(batch.expDate);
        return expiryDate >= now && expiryDate <= expiringSoonDate;
      });

      const hasFreshBatch = product.batches.some(batch => {
        if (!batch.expDate) return true; // No expiry date means fresh
        return new Date(batch.expDate) > expiringSoonDate;
      });

      switch (filters.expiryStatus) {
        case 'expired':
          return hasExpiredBatch;
        case 'expiring-soon':
          return hasExpiringSoonBatch && !hasExpiredBatch;
        case 'fresh':
          return hasFreshBatch && !hasExpiredBatch && !hasExpiringSoonBatch;
        default:
          return true;
      }
    });
  }

  // Supplier filter
  if (filters.supplier) {
    filtered = filtered.filter(product => {
      // Check product-level supplier
      if (product.supplier?.toLowerCase() === filters.supplier.toLowerCase()) {
        return true;
      }
      
      // Check batch-level suppliers
      if (product.batches) {
        return product.batches.some(batch => 
          batch.supplier?.toLowerCase() === filters.supplier.toLowerCase()
        );
      }
      
      return false;
    });
  }

  // Price range filter
  if (filters.priceRange.min || filters.priceRange.max) {
    const minPrice = parseFloat(filters.priceRange.min) || 0;
    const maxPrice = parseFloat(filters.priceRange.max) || Infinity;

    filtered = filtered.filter(product => {
      const price = parseFloat(product.retailPrice) || 0;
      return price >= minPrice && price <= maxPrice;
    });
  }

  // Date range filter
  if (filters.dateRange.start || filters.dateRange.end) {
    const startDate = filters.dateRange.start ? new Date(filters.dateRange.start) : new Date(0);
    const endDate = filters.dateRange.end ? new Date(filters.dateRange.end) : new Date();
    
    // Set end date to end of day
    endDate.setHours(23, 59, 59, 999);

    filtered = filtered.filter(product => {
      const productDate = new Date(product.createdAt || product.dateAdded || 0);
      return productDate >= startDate && productDate <= endDate;
    });
  }

  // Apply sorting
  if (filters.sortBy) {
    filtered.sort((a, b) => {
      let aValue, bValue;

      switch (filters.sortBy) {
        case 'name':
          aValue = (a.name || '').toLowerCase();
          bValue = (b.name || '').toLowerCase();
          break;
        case 'sku':
          aValue = (a.sku || '').toLowerCase();
          bValue = (b.sku || '').toLowerCase();
          break;
        case 'category':
          aValue = (a.category || '').toLowerCase();
          bValue = (b.category || '').toLowerCase();
          break;
        case 'totalQuantity':
          aValue = a.totalQuantity || 0;
          bValue = b.totalQuantity || 0;
          break;
        case 'retailPrice':
          aValue = parseFloat(a.retailPrice) || 0;
          bValue = parseFloat(b.retailPrice) || 0;
          break;
        case 'stockValue':
          aValue = calculateStockValue(a);
          bValue = calculateStockValue(b);
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt || a.dateAdded || 0);
          bValue = new Date(b.createdAt || b.dateAdded || 0);
          break;
        case 'lastUpdated':
          aValue = new Date(a.lastUpdated || a.updatedAt || 0);
          bValue = new Date(b.lastUpdated || b.updatedAt || 0);
          break;
        default:
          aValue = 0;
          bValue = 0;
      }

      // Handle different data types
      if (typeof aValue === 'string') {
        const comparison = aValue.localeCompare(bValue);
        return filters.sortOrder === 'asc' ? comparison : -comparison;
      } else if (aValue instanceof Date) {
        const comparison = aValue.getTime() - bValue.getTime();
        return filters.sortOrder === 'asc' ? comparison : -comparison;
      } else {
        const comparison = aValue - bValue;
        return filters.sortOrder === 'asc' ? comparison : -comparison;
      }
    });
  }

  return filtered;
};

// Helper function to calculate stock value
const calculateStockValue = (product) => {
  if (!product.batches || product.batches.length === 0) {
    const quantity = product.totalQuantity || 0;
    const price = parseFloat(product.purchasePrice || product.retailPrice) || 0;
    return quantity * price;
  }

  return product.batches.reduce((total, batch) => {
    const quantity = parseFloat(batch.quantity) || 0;
    const price = parseFloat(batch.purchasePrice || product.purchasePrice || product.retailPrice) || 0;
    return total + (quantity * price);
  }, 0);
};

// Helper function to get filter suggestions based on current inventory
export const getFilterSuggestions = (inventory) => {
  const suggestions = {
    categories: new Set(),
    suppliers: new Set(),
    priceRanges: {
      min: Infinity,
      max: 0
    }
  };

  inventory.forEach(product => {
    // Categories
    if (product.category) {
      suggestions.categories.add(product.category);
    }

    // Suppliers
    if (product.supplier) {
      suggestions.suppliers.add(product.supplier);
    }

    // Check batch suppliers
    if (product.batches) {
      product.batches.forEach(batch => {
        if (batch.supplier) {
          suggestions.suppliers.add(batch.supplier);
        }
      });
    }

    // Price ranges
    const retailPrice = parseFloat(product.retailPrice) || 0;
    if (retailPrice > 0) {
      suggestions.priceRanges.min = Math.min(suggestions.priceRanges.min, retailPrice);
      suggestions.priceRanges.max = Math.max(suggestions.priceRanges.max, retailPrice);
    }
  });

  return {
    categories: Array.from(suggestions.categories).sort(),
    suppliers: Array.from(suggestions.suppliers).sort(),
    priceRanges: {
      min: suggestions.priceRanges.min === Infinity ? 0 : suggestions.priceRanges.min,
      max: suggestions.priceRanges.max
    }
  };
};

// Helper function to validate filters
export const validateFilters = (filters) => {
  const errors = {};

  // Validate price range
  if (filters.priceRange.min && filters.priceRange.max) {
    const min = parseFloat(filters.priceRange.min);
    const max = parseFloat(filters.priceRange.max);
    if (min > max) {
      errors.priceRange = 'Minimum price cannot be greater than maximum price';
    }
  }

  // Validate date range
  if (filters.dateRange.start && filters.dateRange.end) {
    const start = new Date(filters.dateRange.start);
    const end = new Date(filters.dateRange.end);
    if (start > end) {
      errors.dateRange = 'Start date cannot be later than end date';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Helper function to get filter summary for display
export const getFilterSummary = (filters, inventory) => {
  const activeFilters = [];
  
  if (filters.category) activeFilters.push(`Category: ${filters.category}`);
  if (filters.stockStatus) activeFilters.push(`Stock: ${filters.stockStatus.replace('-', ' ')}`);
  if (filters.expiryStatus) activeFilters.push(`Expiry: ${filters.expiryStatus.replace('-', ' ')}`);
  if (filters.supplier) activeFilters.push(`Supplier: ${filters.supplier}`);
  
  if (filters.priceRange.min || filters.priceRange.max) {
    const min = filters.priceRange.min || '0';
    const max = filters.priceRange.max || '∞';
    activeFilters.push(`Price: ${min} - ${max} PKR`);
  }
  
  if (filters.dateRange.start || filters.dateRange.end) {
    const start = filters.dateRange.start || 'beginning';
    const end = filters.dateRange.end || 'now';
    activeFilters.push(`Date: ${start} to ${end}`);
  }

  return {
    count: activeFilters.length,
    text: activeFilters.join(', '),
    hasActiveFilters: activeFilters.length > 0
  };
};
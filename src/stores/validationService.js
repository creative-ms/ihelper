// src/stores/validationService.js - Optimized version with enhanced validation
import axios from 'axios';

const PRODUCTS_DB_URL = 'http://localhost:5984/products';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

// Performance cache for unit conversion calculations
const conversionCache = new Map();

// =================================================================
//  ID GENERATION FUNCTIONS
// =================================================================

/**
 * Generate unique product ID
 * @returns {string} - Unique product ID
 */
export const generateProductId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `product_${timestamp}_${random}`;
};

/**
 * Generate unique batch ID
 * @returns {string} - Unique batch ID
 */
export const generateBatchId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `batch_${timestamp}_${random}`;
};

// =================================================================
//  VALIDATION FUNCTIONS
// =================================================================

/**
 * Validate product data
 * @param {object} productData - Product data to validate
 * @returns {object} - { isValid, errors }
 */
export const validateProduct = (productData) => {
    const errors = [];
    
    // Basic validations
    if (!productData.name || productData.name.trim() === '') {
        errors.push('Product name is required');
    }
    
    if (!productData.category || productData.category.trim() === '') {
        errors.push('Category is required');
    }
    
    // Price validations
    if (productData.retailPrice && productData.retailPrice <= 0) {
        errors.push('Retail price must be greater than 0');
    }
    
    if (productData.wholesalePrice && productData.wholesalePrice <= 0) {
        errors.push('Wholesale price must be greater than 0');
    }
    
    // Unit configuration validations
    const stripsPerBox = parseInt(productData.stripsPerBox) || 0;
    const tabletsPerStrip = parseInt(productData.tabletsPerStrip) || 0;
    const unitsPerPack = parseInt(productData.unitsPerPack) || 0;
    
    if (stripsPerBox > 0 && tabletsPerStrip <= 0) {
        errors.push('If strips per box is specified, tablets per strip must also be specified');
    }
    
    if (unitsPerPack > 0 && (!productData.subUnitName || productData.subUnitName.trim() === '')) {
        errors.push('If units per pack is specified, sub-unit name must also be specified');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Validate batch data
 * @param {object} batchData - Batch data to validate
 * @returns {object} - { isValid, errors }
 */
export const validateBatch = (batchData) => {
    const errors = [];
    
    // Quantity validation
    if (!batchData.quantity || isNaN(batchData.quantity) || Number(batchData.quantity) <= 0) {
        errors.push('Batch quantity must be greater than 0');
    }
    
    // Price validations
    if (!batchData.purchasePrice || isNaN(batchData.purchasePrice) || Number(batchData.purchasePrice) <= 0) {
        errors.push('Purchase price must be greater than 0');
    }
    
    if (!batchData.retailPrice || isNaN(batchData.retailPrice) || Number(batchData.retailPrice) <= 0) {
        errors.push('Retail price must be greater than 0');
    }
    
    // Batch number validation
    if (!batchData.batchNumber || batchData.batchNumber.trim() === '') {
        errors.push('Batch number is required');
    }
    
    // Expiry date validation (if provided)
    if (batchData.expDate && batchData.expDate !== 'N/A') {
        const expiryDate = new Date(batchData.expDate);
        if (isNaN(expiryDate.getTime())) {
            errors.push('Invalid expiry date format');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

// =================================================================
//  UNIT CONVERSION FUNCTIONS
// =================================================================

/**
 * Helper function: Yeh calculate karta hai ke ek unit (e.g., Tablet) poore box ka kitna hissa hai.
 * Enhanced with caching for better performance.
 */
export const getUnitConversionFactor = (product, unitName) => {
    if (!product || !unitName) return 1;
    
    const cacheKey = `${product._id || 'unknown'}-${unitName.toLowerCase()}`;
    
    // Check cache first
    if (conversionCache.has(cacheKey)) {
        return conversionCache.get(cacheKey);
    }
    
    const unitNameLower = unitName.toLowerCase();
    let factor = 1;
    
    if (unitNameLower === 'box') {
        factor = 1;
    } else if (unitNameLower === 'strip') {
        const stripsPerBox = parseInt(product.stripsPerBox) || 1;
        factor = stripsPerBox > 0 ? 1 / stripsPerBox : 1;
    } else if (unitNameLower === 'tablet') {
        const stripsPerBox = parseInt(product.stripsPerBox) || 1;
        const tabletsPerStrip = parseInt(product.tabletsPerStrip) || 1;
        const totalTablets = stripsPerBox * tabletsPerStrip;
        factor = totalTablets > 0 ? 1 / totalTablets : 1;
    } else if (product.subUnitName && unitNameLower === product.subUnitName.toLowerCase()) {
        const unitsPerPack = parseInt(product.unitsPerPack) || 1;
        factor = unitsPerPack > 0 ? 1 / unitsPerPack : 1;
    }
    
    // Cache the result
    conversionCache.set(cacheKey, factor);
    return factor;
};

// =================================================================
//  STOCK AVAILABILITY FUNCTIONS
// =================================================================

/**
 * Stock ki availability check karta hai with enhanced error messages.
 * @param {object} product - Product jiska stock check karna hai.
 * @param {number} quantityInCart - Is product ki kitni quantity pehle se cart mein hai (base units mein).
 * @param {number} quantityToAdd - Kitni nayi quantity add karni hai (base units mein).
 * @returns {boolean} - True agar stock available hai, warna false.
 */
export const checkStockAvailability = (product, quantityInCart, quantityToAdd) => {
    if (!product) {
        console.error('Product data missing for stock availability check');
        return false;
    }
    
    const totalStockInBaseUnits = (product.batches || [])
        .reduce((total, batch) => total + (Number(batch.quantity) || 0), 0);
    
    const epsilon = 1e-9; // Floating point errors se bachne ke liye
    const requiredQuantity = quantityInCart + quantityToAdd;

    if (totalStockInBaseUnits <= 0) {
        alert(`'${product.name}' is out of stock.`);
        return false;
    }

    if (totalStockInBaseUnits < requiredQuantity - epsilon) {
        const availableDisplay = totalStockInBaseUnits % 1 === 0 ? 
            totalStockInBaseUnits.toString() : 
            totalStockInBaseUnits.toFixed(2);
        const requiredDisplay = requiredQuantity % 1 === 0 ? 
            requiredQuantity.toString() : 
            requiredQuantity.toFixed(2);
            
        alert(`Not enough stock available for '${product.name}'. Available: ${availableDisplay}, Required: ${requiredDisplay}.`);
        return false;
    }
    
    return true;
};

// =================================================================
//  EXPIRY CHECK FUNCTIONS
// =================================================================

/**
 * Check karta hai ke product expire to nahi ho gaya with better batch handling.
 * @param {object} product - Product jiska FEFO batch check karna hai.
 * @returns {boolean} - True agar item expired hai, warna false.
 */
export const isItemExpired = (product) => {
    if (!product || !product.batches) return false;
    
    const activeBatches = product.batches.filter(b => (Number(b.quantity) || 0) > 0);
    if (activeBatches.length === 0) return false; // Stock hi nahi to expiry ka sawal nahi

    const batchesWithExpiry = activeBatches.filter(b => b.expDate && b.expDate !== 'N/A');
    
    if (batchesWithExpiry.length === 0) return false; // Koi expiry date nahi hai
    
    // FEFO: First Expiry First Out - earliest expiry batch check karte hain
    const sortedBatches = batchesWithExpiry.sort((a, b) => new Date(a.expDate) - new Date(b.expDate));
    const earliestExpiryBatch = sortedBatches[0];
    
    return new Date(earliestExpiryBatch.expDate) < new Date();
};

/**
 * Enhanced function: Check karta hai ke batch expire hone wala hai ya nahi
 * @param {object} batch - Batch object
 * @param {number} daysThreshold - Kitne din pehle warning deni hai (default: 30)
 * @returns {object} - { isExpiring, daysRemaining, isExpired }
 */
export const checkBatchExpiryStatus = (batch, daysThreshold = 30) => {
    if (!batch || !batch.expDate || batch.expDate === 'N/A') {
        return { isExpiring: false, daysRemaining: null, isExpired: false };
    }
    
    const today = new Date();
    const expiryDate = new Date(batch.expDate);
    const timeDiff = expiryDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    return {
        isExpired: daysRemaining < 0,
        isExpiring: daysRemaining >= 0 && daysRemaining <= daysThreshold,
        daysRemaining: daysRemaining
    };
};

/**
 * Enhanced function: Product ki overall expiry status check karta hai
 * @param {object} product - Product object
 * @param {number} expiryThreshold - Days threshold for expiry warning
 * @returns {object} - { status, nearestExpiryDays, expiredBatches, expiringSoonBatches }
 */
export const getProductExpiryStatus = (product, expiryThreshold = 30) => {
    if (!product || !product.batches || product.batches.length === 0) {
        return { status: 'no-expiry', nearestExpiryDays: null, expiredBatches: [], expiringSoonBatches: [] };
    }
    
    const activeBatches = product.batches.filter(b => (Number(b.quantity) || 0) > 0);
    const expiredBatches = [];
    const expiringSoonBatches = [];
    let nearestExpiryDays = null;
    
    activeBatches.forEach(batch => {
        const expiryStatus = checkBatchExpiryStatus(batch, expiryThreshold);
        
        if (expiryStatus.isExpired) {
            expiredBatches.push(batch);
        } else if (expiryStatus.isExpiring) {
            expiringSoonBatches.push(batch);
            if (nearestExpiryDays === null || expiryStatus.daysRemaining < nearestExpiryDays) {
                nearestExpiryDays = expiryStatus.daysRemaining;
            }
        }
    });
    
    let status = 'fresh';
    if (expiredBatches.length > 0) {
        status = 'expired';
    } else if (expiringSoonBatches.length > 0) {
        status = 'expiring-soon';
    }
    
    return {
        status,
        nearestExpiryDays,
        expiredBatches,
        expiringSoonBatches
    };
};

/**
 * Validate karta hai ke product form data correct hai ya nahi
 * @param {object} productData - Product form data
 * @param {string} inventoryMethod - 'batch' or 'simple'
 * @returns {object} - { isValid, errors }
 */
export const validateProductData = (productData, inventoryMethod = 'batch') => {
    const errors = [];
    
    // Basic validations
    if (!productData.name || productData.name.trim() === '') {
        errors.push('Product name is required');
    }
    
    if (!productData.category || productData.category.trim() === '') {
        errors.push('Category is required');
    }
    
    // Inventory method specific validations
    if (inventoryMethod === 'simple') {
        if (!productData.initialQuantity || productData.initialQuantity <= 0) {
            errors.push('Initial quantity must be greater than 0');
        }
        if (!productData.wholesalePrice || productData.wholesalePrice <= 0) {
            errors.push('Cost price must be greater than 0');
        }
        if (!productData.retailPrice || productData.retailPrice <= 0) {
            errors.push('Retail price must be greater than 0');
        }
    } else {
        if (!productData.batches || productData.batches.length === 0) {
            errors.push('At least one batch is required');
        } else {
            productData.batches.forEach((batch, index) => {
                if (!batch.quantity || batch.quantity <= 0) {
                    errors.push(`Batch ${index + 1}: Quantity must be greater than 0`);
                }
                if (!batch.purchasePrice || batch.purchasePrice <= 0) {
                    errors.push(`Batch ${index + 1}: Purchase price must be greater than 0`);
                }
                if (!batch.retailPrice || batch.retailPrice <= 0) {
                    errors.push(`Batch ${index + 1}: Retail price must be greater than 0`);
                }
            });
        }
    }
    
    // Unit configuration validations
    const stripsPerBox = parseInt(productData.stripsPerBox) || 0;
    const tabletsPerStrip = parseInt(productData.tabletsPerStrip) || 0;
    const unitsPerPack = parseInt(productData.unitsPerPack) || 0;
    
    if (stripsPerBox > 0 && tabletsPerStrip <= 0) {
        errors.push('If strips per box is specified, tablets per strip must also be specified');
    }
    
    if (unitsPerPack > 0 && (!productData.subUnitName || productData.subUnitName.trim() === '')) {
        errors.push('If units per pack is specified, sub-unit name must also be specified');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

// =================================================================
//  CACHE MANAGEMENT FUNCTIONS
// =================================================================

/**
 * Clear conversion cache - memory management ke liye
 */
export const clearConversionCache = () => {
    conversionCache.clear();
};

/**
 * Get cache stats - debugging ke liye
 */
export const getCacheStats = () => {
    return {
        size: conversionCache.size,
        keys: Array.from(conversionCache.keys())
    };
};
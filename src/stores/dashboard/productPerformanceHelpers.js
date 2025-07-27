// =================================================================================
// PRODUCT PERFORMANCE ANALYTICS - Helper Functions
// =================================================================================

// --- Helper Functions for Product Performance Analysis ---

/**
 * Calculates top-selling and slow-moving products based on sales data
 * @param {Array} salesDocs - Array of sales documents
 * @param {Array} productsDocs - Array of products documents
 * @param {string} timeframe - 'today', 'week', 'month', 'custom'
 * @param {Object} customDateRange - {start: Date, end: Date} for custom timeframe
 * @param {number} topCount - Number of top products to return (default: 5)
 * @returns {Object} Analysis results with top selling and slow moving products
 */
export const analyzeProductPerformance = (salesDocs, productsDocs, timeframe = 'month', customDateRange = {}, topCount = 5) => {
    // Date filtering logic (same as your existing calculateStats function)
    let startDate, endDate = new Date();
    const now = new Date();

    if (timeframe === 'custom' && customDateRange.start && customDateRange.end) {
        startDate = new Date(customDateRange.start);
        endDate = new Date(customDateRange.end);
    } else if (timeframe === 'today') {
        startDate = new Date(new Date().setHours(0, 0, 0, 0));
    } else if (timeframe === 'week') {
        const firstDay = now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1);
        startDate = new Date(new Date().setDate(firstDay));
        startDate.setHours(0, 0, 0, 0);
    } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    endDate.setHours(23, 59, 59, 999);

    // Filter sales by date and type
    const filteredSales = salesDocs.filter(doc => {
        if (doc.type !== 'SALE') return false;
        const docDate = new Date(doc.createdAt);
        return !isNaN(docDate) && docDate >= startDate && docDate <= endDate;
    });

    // Create product performance map
    const productPerformance = new Map();
    
    // Initialize all products with zero values
    productsDocs.forEach(product => {
        if (product._id && product.name && !product._id.startsWith('_design')) {
            productPerformance.set(product._id, {
                productId: product._id,
                productName: product.name,
                category: product.category || 'Uncategorized',
                manufacturer: product.manufacturer || 'Unknown',
                quantitySold: 0,
                totalRevenue: 0,
                totalProfit: 0,
                salesCount: 0,
                averageSellingPrice: 0,
                lastSaleDate: null,
                currentStock: calculateCurrentStock(product),
                isActive: product.isActive !== false
            });
        }
    });

    // Process sales data
    filteredSales.forEach(sale => {
        if (!sale.items || !Array.isArray(sale.items)) return;

        sale.items.forEach(item => {
            if (!item._id || item.isManual) return;

            const performance = productPerformance.get(item._id);
            if (!performance) return;

            const quantity = item.quantity || 0;
            const revenue = (item.sellingPrice || 0) * quantity;
            const itemDiscount = revenue * (((item.discountRate || 0) + (item.extraDiscount || 0)) / 100);
            const netRevenue = revenue - itemDiscount;
            
            // Calculate profit (COGS)
            const purchasePrice = item.sourceBatchInfo?.purchasePrice || 0;
            const cogs = calculateItemCogs(item, purchasePrice) * quantity;
            const profit = netRevenue - cogs;

            // Update performance metrics
            performance.quantitySold += quantity;
            performance.totalRevenue += netRevenue;
            performance.totalProfit += profit;
            performance.salesCount += 1;
            performance.lastSaleDate = new Date(sale.createdAt);
            
            // Update average selling price
            performance.averageSellingPrice = performance.quantitySold > 0 
                ? performance.totalRevenue / performance.quantitySold 
                : 0;
        });
    });

    // Convert to array and filter active products
    const allProducts = Array.from(productPerformance.values())
        .filter(product => product.isActive);

    // Sort by quantity sold (descending) for top sellers
    const topSellingProducts = [...allProducts]
        .filter(product => product.quantitySold > 0)
        .sort((a, b) => {
            // Primary sort: quantity sold
            if (b.quantitySold !== a.quantitySold) {
                return b.quantitySold - a.quantitySold;
            }
            // Secondary sort: total revenue
            return b.totalRevenue - a.totalRevenue;
        })
        .slice(0, topCount);

    // Identify slow-moving products
    const slowMovingProducts = [...allProducts]
        .filter(product => {
            const daysSinceLastSale = product.lastSaleDate 
                ? Math.floor((now - product.lastSaleDate) / (1000 * 60 * 60 * 24))
                : Infinity;
            
            // Consider products slow-moving if:
            // 1. No sales in the period, OR
            // 2. Very low sales (bottom 20% of sold products), OR
            // 3. No sales in last 30 days (for longer timeframes)
            return (
                product.quantitySold === 0 || 
                daysSinceLastSale > 30 ||
                (product.quantitySold > 0 && product.quantitySold <= getSlowMovingThreshold(allProducts))
            ) && product.currentStock > 0; // Only include products with stock
        })
        .sort((a, b) => {
            // Sort by days since last sale (descending), then by current stock (descending)
            const daysA = a.lastSaleDate ? Math.floor((now - a.lastSaleDate) / (1000 * 60 * 60 * 24)) : Infinity;
            const daysB = b.lastSaleDate ? Math.floor((now - b.lastSaleDate) / (1000 * 60 * 60 * 24)) : Infinity;
            
            if (daysB !== daysA) {
                return daysB - daysA;
            }
            return b.currentStock - a.currentStock;
        })
        .slice(0, topCount);

    // Calculate additional insights
    const totalProductsWithSales = allProducts.filter(p => p.quantitySold > 0).length;
    const totalRevenue = allProducts.reduce((sum, p) => sum + p.totalRevenue, 0);
    const totalProfit = allProducts.reduce((sum, p) => sum + p.totalProfit, 0);
    const averageProductRevenue = totalProductsWithSales > 0 ? totalRevenue / totalProductsWithSales : 0;

    return {
        timeframe,
        periodStart: startDate,
        periodEnd: endDate,
        topSellingProducts: topSellingProducts.map(addPerformanceMetrics),
        slowMovingProducts: slowMovingProducts.map(addSlowMovingMetrics),
        summary: {
            totalProducts: allProducts.length,
            productsWithSales: totalProductsWithSales,
            productsWithoutSales: allProducts.length - totalProductsWithSales,
            totalRevenue,
            totalProfit,
            averageProductRevenue,
            slowMovingCount: slowMovingProducts.length
        }
    };
};

/**
 * Helper function to calculate current stock from product batches
 */
const calculateCurrentStock = (product) => {
    if (!product.batches || !Array.isArray(product.batches)) return 0;
    
    return product.batches.reduce((total, batch) => {
        return total + (Number(batch.quantity) || 0);
    }, 0);
};

/**
 * Helper function to calculate COGS per item
 */
const calculateItemCogs = (item, fallbackPurchasePrice = 0) => {
    const purchasePrice = item.sourceBatchInfo?.purchasePrice || fallbackPurchasePrice;
    if (purchasePrice === 0) return 0;
    
    const sellingUnit = item.sellingUnit;
    const stripsPerBox = Number(item.stripsPerBox) || 0;
    const tabletsPerStrip = Number(item.tabletsPerStrip) || 0;
    const unitsPerPack = Number(item.unitsPerPack) || 0;
    const subUnitName = item.subUnitName || 'Unit';
    
    if (sellingUnit === 'Box') return purchasePrice;
    if (sellingUnit === 'Strip' && stripsPerBox > 0) return purchasePrice / stripsPerBox;
    if (sellingUnit === 'Tablet' && stripsPerBox > 0 && tabletsPerStrip > 0) {
        return purchasePrice / (stripsPerBox * tabletsPerStrip);
    }
    if (sellingUnit === subUnitName && unitsPerPack > 0) return purchasePrice / unitsPerPack;
    
    return purchasePrice;
};

/**
 * Helper function to determine slow-moving threshold (bottom 20%)
 */
const getSlowMovingThreshold = (allProducts) => {
    const productsWithSales = allProducts
        .filter(p => p.quantitySold > 0)
        .map(p => p.quantitySold)
        .sort((a, b) => a - b);
    
    if (productsWithSales.length === 0) return 0;
    
    const percentile20Index = Math.floor(productsWithSales.length * 0.2);
    return productsWithSales[percentile20Index] || 0;
};

/**
 * Add performance metrics to top selling products
 */
const addPerformanceMetrics = (product) => {
    const profitMargin = product.totalRevenue > 0 
        ? ((product.totalProfit / product.totalRevenue) * 100) 
        : 0;
    
    return {
        ...product,
        profitMargin: Math.round(profitMargin * 100) / 100,
        revenuePerSale: product.salesCount > 0 
            ? Math.round((product.totalRevenue / product.salesCount) * 100) / 100 
            : 0,
        performance: 'top-seller'
    };
};

/**
 * Add slow-moving specific metrics
 */
const addSlowMovingMetrics = (product) => {
    const now = new Date();
    const daysSinceLastSale = product.lastSaleDate 
        ? Math.floor((now - product.lastSaleDate) / (1000 * 60 * 60 * 24))
        : null;
    
    return {
        ...product,
        daysSinceLastSale,
        stockValue: product.currentStock * (product.averageSellingPrice || 0),
        riskLevel: getRiskLevel(daysSinceLastSale, product.currentStock),
        performance: 'slow-moving'
    };
};

/**
 * Determine risk level for slow-moving products
 */
const getRiskLevel = (daysSinceLastSale, currentStock) => {
    if (daysSinceLastSale === null) return 'high'; // Never sold
    if (daysSinceLastSale > 90) return 'high';
    if (daysSinceLastSale > 60) return 'medium';
    if (daysSinceLastSale > 30) return 'low';
    return 'normal';
};

/**
 * Get product performance summary for dashboard
 * @param {Array} salesDocs - Sales documents
 * @param {Array} productsDocs - Products documents
 * @param {string} timeframe - Time period for analysis
 * @param {Object} customDateRange - Custom date range if applicable
 * @returns {Object} Simplified summary for dashboard widgets
 */
export const getProductPerformanceSummary = (salesDocs, productsDocs, timeframe = 'month', customDateRange = {}) => {
    const analysis = analyzeProductPerformance(salesDocs, productsDocs, timeframe, customDateRange, 3);
    
    return {
        topSellingProducts: analysis.topSellingProducts.map(product => ({
            name: product.productName,
            quantitySold: product.quantitySold,
            revenue: Math.round(product.totalRevenue),
            profitMargin: product.profitMargin
        })),
        slowMovingProducts: analysis.slowMovingProducts.map(product => ({
            name: product.productName,
            daysSinceLastSale: product.daysSinceLastSale,
            currentStock: product.currentStock,
            riskLevel: product.riskLevel
        })),
        metrics: {
            totalActiveProducts: analysis.summary.totalProducts,
            productsWithSales: analysis.summary.productsWithSales,
            slowMovingCount: analysis.summary.slowMovingCount,
            salesPerformanceRate: analysis.summary.totalProducts > 0 
                ? Math.round((analysis.summary.productsWithSales / analysis.summary.totalProducts) * 100)
                : 0
        }
    };
};

/**
 * Export function to be used in dashboardStore helpers
 * This integrates with your existing dashboard system
 */
export const processProductPerformanceData = (allDocs, timeframe, customDateRange) => {
    if (!allDocs.sales || !allDocs.products) {
        return {
            topSellingProducts: [],
            slowMovingProducts: [],
            productPerformanceSummary: null
        };
    }

    const analysis = analyzeProductPerformance(
        allDocs.sales, 
        allDocs.products, 
        timeframe, 
        customDateRange
    );

    const summary = getProductPerformanceSummary(
        allDocs.sales, 
        allDocs.products, 
        timeframe, 
        customDateRange
    );

    return {
        topSellingProducts: analysis.topSellingProducts,
        slowMovingProducts: analysis.slowMovingProducts,
        productPerformanceSummary: summary
    };
};
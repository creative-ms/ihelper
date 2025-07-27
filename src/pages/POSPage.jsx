import React, { useState, useRef, useCallback, useMemo, memo } from 'react';
import { useCartStore } from '../stores/cartStore.js';
import { useProductStore } from '../stores/productStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner.js';
import { useReactToPrint } from 'react-to-print';

// ✅ OPTIMIZED: Conditional component imports based on view style
const GridViewComponents = {
  ProductGrid: React.lazy(() => import('../components/pos/ProductGrid.jsx')),
  CartPanel: React.lazy(() => import('../components/pos/CartPanel.jsx')),
};

const MinimalViewComponents = {
  TopInfoPanel: React.lazy(() => import('../components/pos/TopInfoPanel.jsx')),
  ProductSearch: React.lazy(() => import('../components/purchases/ProductSearch.jsx')),
  CartItemsTable: React.lazy(() => import('../components/pos/CartItemsTable.jsx')),
  TransactionSummary: React.lazy(() => import('../components/pos/TransactionSummary.jsx')),
};

// Shared modal components (loaded only when needed)
const SharedModals = {
  POSCheckoutModal: React.lazy(() => import('../components/pos/POSCheckoutModal.jsx')),
  CustomerPaymentModal: React.lazy(() => import('../components/pos/CustomerPaymentModal.jsx')),
  SaleCompleteModal: React.lazy(() => import('../components/pos/SaleCompleteModal.jsx')),
  POSSaleReceiptPrint: React.lazy(() => import('../components/pos/POSSaleReceiptPrint.jsx')),
  HoldModal: React.lazy(() => import('../components/pos/HoldModal.jsx')),
  HeldOrdersModal: React.lazy(() => import('../components/pos/HeldOrdersModal.jsx')),
  ExpiredItemModal: React.lazy(() => import('../components/pos/ExpiredItemModal.jsx')),
  AddManualProductModal: React.lazy(() => import('../components/pos/AddManualProductModal.jsx')),
  PaymentDisplay: React.lazy(() => import('../components/pos/PaymentDisplay.jsx')),
};

// ✅ OPTIMIZED: Simplified print styles
const pageStyle = `
  @page { size: 72mm auto; margin: 5mm; }
  @media print { body { -webkit-print-color-adjust: exact; } }
`;

// ✅ OPTIMIZED: Lightweight backdrop with CSS-only animations
const Backdrop = memo(({ className, children }) => (
  <div className={`absolute inset-0 bg-white/20 dark:bg-slate-900/20 backdrop-blur-sm rounded-3xl border border-white/20 dark:border-slate-700/20 shadow-lg ${className}`}>
    {children}
  </div>
));

// ✅ OPTIMIZED: Simplified glass container
const GlassContainer = memo(({ children, className = "", height = "h-full" }) => (
  <div className={`${height} relative ${className}`}>
    <Backdrop />
    <div className="relative z-10 h-full p-4 xl:p-6 overflow-y-auto">
      {children}
    </div>
  </div>
));

// ✅ OPTIMIZED: Simplified cart container for grid view only
const CartContainer = memo(({ children }) => (
  <div className="h-[calc(100vh-128px)] relative">
    <Backdrop className="bg-white/30 dark:bg-slate-800/30" />
    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500/60 to-blue-500/60 rounded-t-3xl" />
    <div className="relative z-10 h-full flex flex-col">
      {children}
    </div>
  </div>
));

// ✅ OPTIMIZED: Lightweight loading component
const LoadingSpinner = memo(() => (
  <div className="fixed inset-0 bg-black/10 z-50 flex items-center justify-center">
    <div className="bg-white dark:bg-slate-800 rounded-lg p-4 shadow-lg">
      <div className="flex items-center space-x-2">
        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading...</span>
      </div>
    </div>
  </div>
));

// ✅ OPTIMIZED: Single modal state manager
const useModalManager = () => {
  const [modals, setModals] = useState({
    checkout: false,
    payment: false,
    saleComplete: false,
    hold: false,
    heldOrders: false,
    manualAdd: false,
  });

  const openModal = useCallback((modal) => {
    setModals(prev => ({ ...prev, [modal]: true }));
  }, []);

  const closeModal = useCallback((modal) => {
    setModals(prev => ({ ...prev, [modal]: false }));
  }, []);

  const closeAllModals = useCallback(() => {
    setModals({
      checkout: false,
      payment: false,
      saleComplete: false,
      hold: false,
      heldOrders: false,
      manualAdd: false,
    });
  }, []);

  return { modals, openModal, closeModal, closeAllModals };
};

// ✅ OPTIMIZED: Simplified cart calculations with better memoization
const useCartCalculations = (cartItems) => {
  return useMemo(() => {
    let subtotal = 0;
    let totalDiscountAmount = 0;
    let totalTaxAmount = 0;

    cartItems.forEach(item => {
      const itemTotal = (item.sellingPrice || 0) * item.quantity;
      const discountPercent = (Number(item.discountRate) || 0) + (Number(item.extraDiscount) || 0);
      const discountAmount = itemTotal * discountPercent / 100;
      const taxableAmount = itemTotal - discountAmount;
      const taxAmount = taxableAmount * ((parseFloat(item.taxRate) || 0) / 100);

      subtotal += itemTotal;
      totalDiscountAmount += discountAmount;
      totalTaxAmount += taxAmount;
    });

    return {
      subtotal,
      totalDiscountAmount,
      totalTaxAmount,
      total: subtotal - totalDiscountAmount + totalTaxAmount
    };
  }, [cartItems]);
};

// ✅ OPTIMIZED: Grid Layout component (only renders grid-specific components)
const GridLayout = memo(({ 
  heldOrders, 
  openModal, 
  calculations, 
  cartItems 
}) => {
  const { ProductGrid, CartPanel } = GridViewComponents;

  return (
    <div className="min-h-[calc(100vh-64px)] w-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="min-h-[calc(100vh-64px)] flex">
        <main className="flex-1 min-w-0 p-4 xl:p-6">
          <GlassContainer height="h-full min-h-[calc(100vh-128px)]">
            <React.Suspense fallback={<LoadingSpinner />}>
              <ProductGrid 
                heldOrders={heldOrders} 
                setShowHeldOrders={() => openModal('heldOrders')} 
                onAddManually={() => openModal('manualAdd')} 
              />
            </React.Suspense>
          </GlassContainer>
        </main>

        <aside className="w-full max-w-[460px] min-w-[320px] flex-shrink-0 p-4 xl:p-6">
          <CartContainer>
            <React.Suspense fallback={<LoadingSpinner />}>
              <CartPanel 
                onCheckout={() => openModal('checkout')} 
                onPayBalance={() => openModal('payment')}
                onHold={() => openModal('hold')} 
              />
            </React.Suspense>
          </CartContainer>
        </aside>
      </div>
    </div>
  );
});

// ✅ OPTIMIZED: Minimal Layout component (only renders minimal-specific components)
const MinimalLayout = memo(({ 
  cartItems, 
  calculations, 
  addToCart, 
  clearCart, 
  openModal 
}) => {
  const { TopInfoPanel, ProductSearch, CartItemsTable, TransactionSummary } = MinimalViewComponents;

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="min-h-screen p-4 sm:p-6 lg:p-8 flex flex-col gap-6 lg:gap-8">
        <GlassContainer className="flex-shrink-0">
          <React.Suspense fallback={<LoadingSpinner />}>
            <TopInfoPanel 
              onAddManually={() => openModal('manualAdd')}
              onShowHeldOrders={() => openModal('heldOrders')}
              onPayBalance={() => openModal('payment')}
            />
          </React.Suspense>
        </GlassContainer>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-10 gap-6 lg:gap-8 min-h-0">
          <div className="lg:col-span-7 min-h-0">
            <GlassContainer className="h-full min-h-[400px] flex flex-col">
              <div className="flex-shrink-0 mb-4">
                <React.Suspense fallback={<div>Loading search...</div>}>
                  <ProductSearch onProductSelect={addToCart} />
                </React.Suspense>
              </div>
              <div className="flex-1 h-[400px]">
                <React.Suspense fallback={<LoadingSpinner />}>
                  <CartItemsTable />
                </React.Suspense>
              </div>
            </GlassContainer>
          </div>
          
          <div className="lg:col-span-3 min-h-0">
            <GlassContainer className="h-full min-h-[400px]">
              <React.Suspense fallback={<LoadingSpinner />}>
                <TransactionSummary
                  cartDetails={{ items: cartItems, ...calculations }}
                  onCheckout={() => openModal('checkout')}
                  onHold={() => openModal('hold')}
                  clearCart={clearCart}
                />
              </React.Suspense>
            </GlassContainer>
          </div>
        </div>
      </div>
    </div>
  );
});

const POSPage = memo(() => {
  const { posViewStyle } = useSettingsStore();
  const { modals, openModal, closeModal } = useModalManager();

  // ✅ OPTIMIZED: Simplified store selectors
  const {
    items: cartItems,
    selectedCustomer,
    walkInCustomerName,
    checkout,
    addToCart,
    isExpiryModalOpen,
    itemToAddAfterConfirmation,
    confirmAndAddItem,
    closeExpiryModal,
    addManualItemToCart,
    clearCart,
  } = useCartStore();

  const { findProductByBarcode } = useProductStore();

  const [saleDetails, setSaleDetails] = useState(null);
  const [heldOrders, setHeldOrders] = useState([]);
  const printComponentRef = useRef();

  // ✅ OPTIMIZED: Use custom hook for calculations
  const calculations = useCartCalculations(cartItems);

  // ✅ OPTIMIZED: Simplified barcode handler
  const handleBarcodeScan = useCallback(async (barcode) => {
    const product = await findProductByBarcode(barcode);
    if (product) addToCart(product);
  }, [findProductByBarcode, addToCart]);

  useBarcodeScanner(handleBarcodeScan);

  const handlePrint = useReactToPrint({
    contentRef: printComponentRef,
    pageStyle,
    documentTitle: 'Sale Receipt'
  });

  // ✅ OPTIMIZED: Simplified checkout handler
  const handleConfirmCheckout = useCallback(async (paymentData) => {
    const result = await checkout({
      items: cartItems,
      customer: selectedCustomer,
      walkInCustomerName,
      ...calculations,
      ...paymentData,
    });

    if (result?._id) {
      setSaleDetails(result);
      closeModal('checkout');
      openModal('saleComplete');
    }
  }, [cartItems, selectedCustomer, walkInCustomerName, calculations, checkout, closeModal, openModal]);

  // ✅ OPTIMIZED: Simplified hold handler
  const handleConfirmHold = useCallback((remark) => {
    if (cartItems.length === 0) return;
    const newOrder = { id: Date.now(), remark, items: [...cartItems] };
    setHeldOrders(prev => [...prev, newOrder]);
    clearCart();
    closeModal('hold');
  }, [cartItems, clearCart, closeModal]);

  // ✅ OPTIMIZED: Simplified restore handler
  const handleRestoreHeldOrder = useCallback((id) => {
    const order = heldOrders.find(o => o.id === id);
    if (!order) return;
    useCartStore.getState().setItems(order.items);
    setHeldOrders(prev => prev.filter(o => o.id !== id));
    closeModal('heldOrders');
  }, [heldOrders, closeModal]);

  // ✅ OPTIMIZED: Simplified manual add handler
  const handleConfirmManualAdd = useCallback((itemData) => {
    addManualItemToCart(itemData);
    closeModal('manualAdd');
  }, [addManualItemToCart, closeModal]);

  return (
    <>
      {/* ✅ OPTIMIZED: PaymentDisplay - always available */}
      <React.Suspense fallback={null}>
        <SharedModals.PaymentDisplay />
      </React.Suspense>

      {/* ✅ OPTIMIZED: Conditional layout rendering - only one layout renders */}
      {posViewStyle === 'grid' ? (
        <GridLayout 
          heldOrders={heldOrders}
          openModal={openModal}
          calculations={calculations}
          cartItems={cartItems}
        />
      ) : (
        <MinimalLayout 
          cartItems={cartItems}
          calculations={calculations}
          addToCart={addToCart}
          clearCart={clearCart}
          openModal={openModal}
        />
      )}

      {/* ✅ OPTIMIZED: Conditional modal rendering - only render when open */}
      <React.Suspense fallback={<LoadingSpinner />}>
        {modals.checkout && (
          <SharedModals.POSCheckoutModal
            isOpen={modals.checkout}
            onClose={() => closeModal('checkout')}
            cartDetails={{ items: cartItems, ...calculations }}
            onConfirm={handleConfirmCheckout}
          />
        )}
        
        {modals.payment && (
          <SharedModals.CustomerPaymentModal 
            isOpen={modals.payment}
            onClose={() => closeModal('payment')}
            customer={selectedCustomer}
          />
        )}
        
        {modals.saleComplete && (
          <SharedModals.SaleCompleteModal
            isOpen={modals.saleComplete}
            onClose={() => closeModal('saleComplete')}
            saleDetails={saleDetails}
            onPrint={handlePrint}
          />
        )}
        
        {modals.hold && (
          <SharedModals.HoldModal
            isOpen={modals.hold}
            onClose={() => closeModal('hold')}
            onConfirm={handleConfirmHold}
          />
        )}
        
        {modals.heldOrders && (
          <SharedModals.HeldOrdersModal
            isOpen={modals.heldOrders}
            onClose={() => closeModal('heldOrders')}
            heldOrders={heldOrders}
            onRestore={handleRestoreHeldOrder}
          />
        )}
        
        {modals.manualAdd && (
          <SharedModals.AddManualProductModal
            isOpen={modals.manualAdd}
            onClose={() => closeModal('manualAdd')}
            onConfirm={handleConfirmManualAdd}
          />
        )}
      </React.Suspense>

      {/* ✅ OPTIMIZED: Expiry modal - outside suspense for immediate availability */}
      {isExpiryModalOpen && (
        <React.Suspense fallback={<LoadingSpinner />}>
          <SharedModals.ExpiredItemModal
            isOpen={isExpiryModalOpen}
            onClose={closeExpiryModal}
            onConfirm={confirmAndAddItem}
            productName={itemToAddAfterConfirmation?.product?.name || ''}
          />
        </React.Suspense>
      )}

      {/* ✅ OPTIMIZED: Print component - only render when needed */}
      {saleDetails && (
        <div style={{ display: 'none' }}>
          <React.Suspense fallback={<div>Loading print...</div>}>
            <SharedModals.POSSaleReceiptPrint ref={printComponentRef} saleDetails={saleDetails} />
          </React.Suspense>
        </div>
      )}
    </>
  );
});

POSPage.displayName = 'POSPage';

export default POSPage;
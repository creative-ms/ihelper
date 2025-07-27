// src/stores/supplierStore.js
import { create } from 'zustand';
import axios from 'axios';

const SUPPLIERS_DB_URL = 'http://localhost:5984/suppliers';
const PURCHASES_DB_URL = 'http://localhost:5984/purchases';
const TRANSACTIONS_DB_URL = 'http://localhost:5984/transactions'; // ✅ Transactions DB ka URL
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useSupplierStore = create((set, get) => ({
    suppliers: [],
    isLoading: false,

    fetchSuppliers: async () => {
        set({ isLoading: true });
        try {
            const response = await axios.get(`${SUPPLIERS_DB_URL}/_all_docs?include_docs=true`, DB_AUTH);
            const fetchedSuppliers = response.data.rows.map(row => row.doc);
            set({ suppliers: fetchedSuppliers, isLoading: false });
        } catch (error) {
            console.error("Error fetching suppliers:", error);
            set({ isLoading: false });
        }
    },

    addSupplier: async (newSupplierData) => {
        try {
            const supplierToSave = {
                ...newSupplierData,
                balance: parseFloat(newSupplierData.balance) || 0,
            };
            await axios.post(SUPPLIERS_DB_URL, supplierToSave, DB_AUTH);
            get().fetchSuppliers();
        } catch (error) {
            console.error("Error adding supplier:", error);
        }
    },

    updateSupplier: async (supplierToUpdate) => {
        try {
            await axios.put(`${SUPPLIERS_DB_URL}/${supplierToUpdate._id}`, supplierToUpdate, DB_AUTH);
            get().fetchSuppliers();
        } catch (error) {
            console.error("Error updating supplier:", error);
        }
    },

    deleteSupplier: async (supplierToDelete) => {
        try {
            await axios.delete(`${SUPPLIERS_DB_URL}/${supplierToDelete._id}?rev=${supplierToDelete._rev}`, DB_AUTH);
            get().fetchSuppliers();
        } catch (error) {
            console.error("Error deleting supplier:", error);
        }
    },

    _updateSupplierBalance: async (supplierId, amount) => {
        try {
            const res = await axios.get(`${SUPPLIERS_DB_URL}/${supplierId}`, DB_AUTH);
            const supplier = res.data;
            const newBalance = (supplier.balance || 0) + amount;
            await axios.put(`${SUPPLIERS_DB_URL}/${supplierId}`, { ...supplier, balance: newBalance }, DB_AUTH);
            return { ...supplier, balance: newBalance };
        } catch (error) {
            console.error(`Failed to update balance for supplier ${supplierId}:`, error);
            return null;
        }
    },
    
    makePaymentToSupplier: async (supplierId, amountPaid, paymentMethod) => {
    set({ isLoading: true });
    try {
      const supplier = get().suppliers.find(s => s._id === supplierId);
      if (!supplier) {
        throw new Error("Supplier not found during payment process.");
      }

      // ✅ FIX: Determine the direction of cash flow
      const direction = (supplier.balance > 0) ? 'out' : 'in';

      const paymentRecord = {
        type: 'SUPPLIER_PAYMENT', // A more generic type
        direction: direction, // 'in' for receiving, 'out' for paying
        supplierId: supplierId,
        supplierName: supplier.name,
        amountPaid: amountPaid,
        paymentMethod: paymentMethod,
        createdAt: new Date().toISOString(),
      };
      const transResponse = await axios.post(TRANSACTIONS_DB_URL, paymentRecord, DB_AUTH);

      // Determine the amount to update the balance by
      const amountToUpdate = direction === 'out' ? -amountPaid : +amountPaid;

      const updatedSupplier = await get()._updateSupplierBalance(supplierId, amountToUpdate);

      get().fetchSuppliers();
      
      set({ isLoading: false });
      return { success: true, updatedSupplier, _id: transResponse.data.id };

    } catch (error) {
      console.error("Error making payment to supplier:", error);
      set({ isLoading: false });
      return { success: false, message: "Payment failed." };
    }
  },

    // ✅ FIX: Ledger ab purchases aur payments dono databases se data fetch karega.
    fetchSupplierLedger: async (supplierId) => {
        try {
            // Purchases (Credit) fetch karein
            const purchaseQuery = { selector: { supplierId: supplierId, type: 'PURCHASE' } };
            const purchaseRes = await axios.post(`${PURCHASES_DB_URL}/_find`, purchaseQuery, DB_AUTH);
            const purchases = purchaseRes.data.docs;

            // Payments (Debit) fetch karein
            const paymentQuery = { selector: { supplierId: supplierId, type: 'PAYMENT_TO_SUPPLIER' } };
            const paymentRes = await axios.post(`${TRANSACTIONS_DB_URL}/_find`, paymentQuery, DB_AUTH);
            const payments = paymentRes.data.docs;

            // Dono ko mila kar date ke hisaab se sort karein
            const ledgerEntries = [...purchases, ...payments];
            ledgerEntries.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            
            return ledgerEntries;
        } catch (error) {
            console.error("Error fetching supplier ledger:", error);
            return [];
        }
    }
}));

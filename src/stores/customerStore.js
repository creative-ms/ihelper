// src/stores/customerStore.js
import { create } from 'zustand';
import axios from 'axios';
import { useCartStore } from './cartStore.js';
import { useTransactionStore } from './transactionStore.js'; // Ye import zaroori hai

const CUSTOMERS_DB_URL = 'http://localhost:5984/customers';
const TRANSACTIONS_DB_URL = 'http://localhost:5984/transactions';
const SALES_DB_URL = 'http://localhost:5984/sales'; // Ye URL bhi zaroori hai
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useCustomerStore = create((set, get) => ({
  customers: [],
  isLoading: false,

  fetchCustomers: async () => {
    set({ isLoading: true });
    try {
      const response = await axios.get(`${CUSTOMERS_DB_URL}/_all_docs?include_docs=true`, DB_AUTH);
      const docs = response.data.rows.map(row => row.doc).filter(doc => doc.name);
      const sortedCustomers = docs.sort((a, b) => a.name.localeCompare(b.name));
      set({ customers: sortedCustomers, isLoading: false });
    } catch (error) {
      console.error("Error fetching customers:", error);
      set({ isLoading: false });
    }
  },

  addCustomer: async (customerData) => {
    try {
        const openingBalance = parseFloat(customerData.balance) || 0;
        const customerToSave = { ...customerData, balance: openingBalance };
        const response = await axios.post(CUSTOMERS_DB_URL, customerToSave, DB_AUTH);
        
        const newCustomer = { ...customerToSave, _id: response.data.id, _rev: response.data.rev };

        if (openingBalance !== 0) {
            const transaction = {
                customerId: response.data.id,
                type: 'OPENING_BALANCE',
                amount: openingBalance,
                date: new Date().toISOString(),
                description: 'Opening Balance'
            };
            await axios.post(TRANSACTIONS_DB_URL, transaction, DB_AUTH);
        }
        
        // ✅ FIX: Update state directly instead of re-fetching
        set(state => ({ customers: [...state.customers, newCustomer].sort((a, b) => a.name.localeCompare(b.name)) }));

    } catch (error) {
        console.error("Error adding customer:", error);
    }
  },

  updateCustomer: async (customerData) => {
    try {
      const response = await axios.put(`${CUSTOMERS_DB_URL}/${customerData._id}`, customerData, DB_AUTH);
      const updatedCustomer = { ...customerData, _rev: response.data.rev };

      // ✅ FIX: Update state directly instead of re-fetching
      set(state => ({
          customers: state.customers.map(c => c._id === updatedCustomer._id ? updatedCustomer : c)
      }));

    } catch (error) {
      console.error("Error updating customer:", error);
    }
  },
  
  deleteCustomer: async (customer) => {
    try {
      await axios.delete(`${CUSTOMERS_DB_URL}/${customer._id}?rev=${customer._rev}`, DB_AUTH);
      
      // ✅ FIX: Update state directly instead of re-fetching
      set(state => ({
          customers: state.customers.filter(c => c._id !== customer._id)
      }));

    } catch (error) {
      console.error("Error deleting customer:", error);
    }
  },

  _updateCustomerBalance: async (customerId, newBalance) => {
    try {
        const customerRes = await axios.get(`${CUSTOMERS_DB_URL}/${customerId}`, DB_AUTH);
        const customerDoc = customerRes.data;
        const updatedCustomerDoc = { ...customerDoc, balance: newBalance };
        await axios.put(`${CUSTOMERS_DB_URL}/${customerId}`, updatedCustomerDoc, DB_AUTH);
        return updatedCustomerDoc;
    } catch (error) {
        console.error(`Failed to update balance for customer ${customerId}:`, error);
        return null;
    }
  },

  applyAutomatedPayment: async (customerId, amountPaid, paymentMethod) => {
    set({ isLoading: true });
    try {
      const unpaidInvoices = await useTransactionStore.getState().fetchUnpaidInvoicesForCustomer(customerId);

      if (unpaidInvoices.length === 0 && amountPaid > 0) {
        console.warn("Payment received but no unpaid invoices found to apply it to.");
      }

      const paymentTransaction = {
        customerId: customerId, type: 'PAYMENT', amount: -amountPaid,
        date: new Date().toISOString(),
        description: `Payment received via ${paymentMethod}`,
      };
      const transResponse = await axios.post(TRANSACTIONS_DB_URL, paymentTransaction, DB_AUTH);

      let remainingPayment = amountPaid;
      for (const invoice of unpaidInvoices) {
        if (remainingPayment <= 0) break;
        const dueAmount = (invoice.total || 0) - (invoice.amountPaid || 0);
        const amountToApply = Math.min(remainingPayment, dueAmount);
        invoice.amountPaid = (invoice.amountPaid || 0) + amountToApply;
        remainingPayment -= amountToApply;
        await axios.put(`${SALES_DB_URL}/${invoice._id}`, invoice, DB_AUTH);
      }

      const customerRes = await axios.get(`${CUSTOMERS_DB_URL}/${customerId}`, DB_AUTH);
      const customerDoc = customerRes.data;
      const newBalance = (customerDoc.balance || 0) - amountPaid;
      
      customerDoc.balance = newBalance;
      const finalRevResponse = await axios.put(`${CUSTOMERS_DB_URL}/${customerId}`, customerDoc, DB_AUTH);
      const updatedCustomer = { ...customerDoc, _rev: finalRevResponse.data.rev };

      // ✅ FIX: Update state directly instead of re-fetching
      set(state => ({
          customers: state.customers.map(c => c._id === customerId ? updatedCustomer : c),
          isLoading: false
      }));
      
      // Refresh invoices list to show updated status
      useTransactionStore.getState().fetchInvoices();
      
      return { 
        _id: transResponse.data.id, 
        customerName: customerDoc.name, 
        total: amountPaid,
        updatedCustomer: updatedCustomer
      };

    } catch (error) {
      console.error("Failed to make payment:", error);
      set({ isLoading: false });
      return null;
    }
  },

  fetchCustomerTransactions: async (customerId) => {
    try {
        const query = { selector: { customerId: customerId } };
        const response = await axios.post(`${TRANSACTIONS_DB_URL}/_find`, query, DB_AUTH);
        return response.data.docs.sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return [];
    }
  },

  processSaleAndUpdateBalance: async (customerId, saleAmount, paymentAmount, saleId, settlePreviousBalance) => {
    try {
      if (saleAmount > 0) {
        const saleTransaction = {
          customerId: customerId, type: 'SALE', amount: saleAmount,
          date: new Date().toISOString(),
          description: `Sale (Invoice: ${saleId.substring(0, 7)})`,
          referenceId: saleId,
        };
        await axios.post(TRANSACTIONS_DB_URL, saleTransaction, DB_AUTH);
      }
      
      if (paymentAmount > 0) {
        const paymentDescription = settlePreviousBalance 
            ? `Payment (Sale + Old Balance)` 
            : `Payment for Sale`;
        
        const paymentTransaction = {
          customerId: customerId, type: 'PAYMENT', amount: -paymentAmount,
          date: new Date().toISOString(),
          description: `${paymentDescription} (Invoice: ${saleId.substring(0, 7)})`,
          referenceId: saleId,
        };
        await axios.post(TRANSACTIONS_DB_URL, paymentTransaction, DB_AUTH);
      }
      
      const netBalanceChange = saleAmount - paymentAmount;
      const customerRes = await axios.get(`${CUSTOMERS_DB_URL}/${customerId}`, DB_AUTH);
      const customerDoc = customerRes.data;
      const newBalance = (customerDoc.balance || 0) + netBalanceChange;
      
      const updatedCustomerDoc = { ...customerDoc, balance: newBalance };
      const finalRevResponse = await axios.put(`${CUSTOMERS_DB_URL}/${customerId}`, updatedCustomerDoc, DB_AUTH);

      const finalUpdatedCustomer = { ...updatedCustomerDoc, _rev: finalRevResponse.data.rev };

      // ✅ FIX: Update state directly instead of re-fetching
      set(state => ({
          customers: state.customers.map(c => c._id === customerId ? finalUpdatedCustomer : c)
      }));

      return finalUpdatedCustomer;

    } catch (error) {
      console.error(`Failed to process sale transactions for customer ${customerId}:`, error.response ? error.response.data : error);
      return null;
    }
  },
}));

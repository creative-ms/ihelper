// src/stores/auditStore.js
import { create } from 'zustand';
import axios from 'axios';
import { useAuthStore } from './authStore'; // User info ke liye

const AUDIT_DB_URL = 'http://localhost:5984/audit_log';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useAuditStore = create((set, get) => ({
  logs: [],
  isLoading: false,

  /**
   * Yeh central function hai jo har event ko log karega.
   * @param {object} eventData - Event ki poori maloomat.
   */
  logEvent: async (eventData) => {
    try {
      const { user } = useAuthStore.getState(); 

      const logEntry = {
        ...eventData,
        timestamp: new Date().toISOString(),
        userId: user?._id || 'system',
        userName: user?.name || 'System',
      };
      
      await axios.post(AUDIT_DB_URL, logEntry, DB_AUTH);

    } catch (error) {
      console.error(`Audit log banate waqt error (Type: ${eventData.eventType}):`, error);
    }
  },

  /**
   * Yeh function ek makhsoos product ke saare logs fetch karega.
   * @param {string} productId - Product ka ID.
   */
  fetchLogsForProduct: async (productId) => {
    // ✅ FIX: Ek guard clause add kiya gaya hai.
    // Agar productId mojood nahi hai, to function yahin ruk jayega.
    if (!productId) {
      set({ logs: [], isLoading: false }); // State ko reset karein
      return; // Function ko yahin rok dein
    }

    set({ isLoading: true, logs: [] });
    try {
      const query = {
        selector: { productId: productId },
        sort: [{ timestamp: 'desc' }] // Sabse naya event sabse upar
      };
      const response = await axios.post(`${AUDIT_DB_URL}/_find`, query, DB_AUTH);
      set({ logs: response.data.docs, isLoading: false });
    } catch (error) {
      console.error(`Logs fetch karte waqt error (Product: ${productId}):`, error);
      set({ isLoading: false });
    }
  },
}));

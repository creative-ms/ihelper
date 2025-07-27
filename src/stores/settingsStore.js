import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import axios from 'axios';

const SETTINGS_DB_URL = 'http://localhost:5984/settings';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

const PAYMENT_SETTINGS_DOC_ID = 'paymentMethods';
const PRIVILEGES_DOC_ID = 'rolePrivileges';

const DEFAULT_PRIVILEGES = {
  'Store Manager': {
    canGiveDiscount: true,
    canChangePrice: true,
    canDeleteCartItem: true,
    canViewDashboard: true,
    canProcessPurchaseReturn: true,
  },
  'Cashier': {
    canGiveDiscount: false,
    canChangePrice: false,
    canDeleteCartItem: false,
    canViewDashboard: false,
    canProcessPurchaseReturn: false,
  },
};

// Convert file to base64
const toBase64 = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      // ✅ Local pharmacy POS config
      posViewStyle: 'grid', // 'grid' or 'minimal'
      setPosViewStyle: (style) => set({ posViewStyle: style }),

      // Server-side settings
      paymentMethods: [],
      rolePrivileges: {},
      isLoading: false,

      // --- Payment Methods ---
      fetchPaymentSettings: async () => {
        set({ isLoading: true });
        try {
          const res = await axios.get(`${SETTINGS_DB_URL}/${PAYMENT_SETTINGS_DOC_ID}`, DB_AUTH);
          set({ paymentMethods: res.data.methods || [], isLoading: false });
        } catch (err) {
          if (err.response?.status === 404) {
            console.warn("Payment settings not found.");
            set({ paymentMethods: [], isLoading: false });
          } else {
            console.error("Payment fetch error:", err);
            set({ isLoading: false });
          }
        }
      },

      updatePaymentSettings: async (methodsWithFiles) => {
        set({ isLoading: true });
        try {
          await axios.get(SETTINGS_DB_URL, DB_AUTH).catch(async e => {
            if (e.response?.status === 404) {
              await axios.put(SETTINGS_DB_URL, null, DB_AUTH);
            } else throw e;
          });

          const processedMethods = await Promise.all(
            methodsWithFiles.map(async (method) => {
              let qrCodeData = method.qrCodeData;
              if (method.qrCodeFile instanceof File) {
                qrCodeData = await toBase64(method.qrCodeFile);
              }
              return { ...method, qrCodeData };
            })
          );

          let existingDoc = null;
          try {
            const res = await axios.get(`${SETTINGS_DB_URL}/${PAYMENT_SETTINGS_DOC_ID}`, DB_AUTH);
            existingDoc = res.data;
          } catch (e) {
            if (e.response?.status !== 404) throw e;
          }

          const docToSave = {
            _id: PAYMENT_SETTINGS_DOC_ID,
            methods: processedMethods,
            ...(existingDoc && { _rev: existingDoc._rev }),
          };

          await axios.put(`${SETTINGS_DB_URL}/${PAYMENT_SETTINGS_DOC_ID}`, docToSave, DB_AUTH);
          set({ paymentMethods: processedMethods, isLoading: false });
          alert('Payment settings saved successfully!');
        } catch (err) {
          console.error("Save error:", err);
          alert('Failed to save payment settings.');
          set({ isLoading: false });
        }
      },

      // --- Role Privileges ---
      fetchRolePrivileges: async () => {
        set({ isLoading: true });
        try {
          const res = await axios.get(`${SETTINGS_DB_URL}/${PRIVILEGES_DOC_ID}`, DB_AUTH);
          set({ rolePrivileges: res.data.roles || {}, isLoading: false });
        } catch (err) {
          if (err.response?.status === 404) {
            console.warn("Privileges not found. Using default.");
            set({ rolePrivileges: DEFAULT_PRIVILEGES, isLoading: false });
          } else {
            console.error("Privilege fetch error:", err);
            set({ isLoading: false });
          }
        }
      },

      updateRolePrivileges: async (privileges) => {
        set({ isLoading: true });
        try {
          await axios.get(SETTINGS_DB_URL, DB_AUTH).catch(async e => {
            if (e.response?.status === 404) {
              await axios.put(SETTINGS_DB_URL, null, DB_AUTH);
            } else throw e;
          });

          let existingDoc = null;
          try {
            const res = await axios.get(`${SETTINGS_DB_URL}/${PRIVILEGES_DOC_ID}`, DB_AUTH);
            existingDoc = res.data;
          } catch (e) {
            if (e.response?.status !== 404) throw e;
          }

          const docToSave = {
            _id: PRIVILEGES_DOC_ID,
            roles: privileges,
            ...(existingDoc && { _rev: existingDoc._rev }),
          };

          await axios.put(`${SETTINGS_DB_URL}/${PRIVILEGES_DOC_ID}`, docToSave, DB_AUTH);
          set({ rolePrivileges: privileges, isLoading: false });
          alert('Role privileges saved successfully!');
        } catch (err) {
          console.error("Privilege save error:", err);
          alert('Failed to save privileges.');
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'app-config-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        posViewStyle: state.posViewStyle,
      }),
    }
  )
);

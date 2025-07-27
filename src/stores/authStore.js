import { create } from 'zustand';
import axios from 'axios';
import { persist } from 'zustand/middleware';
import bcrypt from 'bcryptjs';

const USER_DB_URL = 'http://localhost:5984/users';
const SETTINGS_DB_URL = 'http://localhost:5984/settings';
const PRIVILEGES_DOC_ID = 'rolePrivileges';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useAuthStore = create(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      currentUser: null,
      users: [],
      privileges: null,
      isLoading: false,
      error: null,

      fetchUsers: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await axios.post(`${USER_DB_URL}/_find`, {
            selector: { type: 'user' }
          }, DB_AUTH);
          set({ users: response.data.docs, isLoading: false });
        } catch (error) {
          const errorMessage = error.response?.data?.reason || error.message;
          console.error("Error fetching users:", errorMessage);
          set({ error: 'Could not fetch users.', isLoading: false });
        }
      },

      login: async (userIdOrName, password, pin) => {
        set({ isLoading: true, error: null });
        try {
          let user = null;
          
          // Check if the first parameter is a user ID or username
          if (userIdOrName.includes('_')) {
            // It's likely a user ID, fetch by ID
            try {
              const userResponse = await axios.get(`${USER_DB_URL}/${userIdOrName}`, DB_AUTH);
              user = userResponse.data;
            } catch (error) {
              if (error.response?.status === 404) {
                set({ error: 'User not found.', isLoading: false });
                return false;
              }
              throw error;
            }
          } else {
            // It's a username, search by name
            const findResponse = await axios.post(`${USER_DB_URL}/_find`, {
              selector: { name: userIdOrName, type: 'user' },
              limit: 1
            }, DB_AUTH);

            if (findResponse.data.docs.length === 0) {
              set({ error: 'Invalid username or password.', isLoading: false });
              return false;
            }
            user = findResponse.data.docs[0];
          }

          // Check if user has a password field in the database
          const userHasPassword = user.password && user.password.trim() !== '';

          // Handle different login scenarios
          if (password && !pin) {
            // Password-only login (first time login or password verification)
            if (!userHasPassword) {
              // User doesn't have a password yet, need to set one
              const hashedPassword = await bcrypt.hash(password, 10);
              const updatedUser = { ...user, password: hashedPassword };
              await axios.put(`${USER_DB_URL}/${user._id}`, updatedUser, DB_AUTH);
              user = updatedUser;
            } else {
              // Verify existing password
              const isPasswordCorrect = await bcrypt.compare(password, user.password);
              if (!isPasswordCorrect) {
                set({ error: 'Invalid password. Please try again.', isLoading: false });
                return false;
              }
            }
          } else if (!password && pin) {
            // PIN-only login (subsequent logins with stored password)
            if (user.pin !== pin) {
              set({ error: 'Invalid PIN. Please try again.', isLoading: false });
              return false;
            }
          } else if (password && pin) {
            // Full authentication (password + PIN)
            if (!userHasPassword) {
              // User doesn't have a password yet, set it
              const hashedPassword = await bcrypt.hash(password, 10);
              const updatedUser = { ...user, password: hashedPassword };
              await axios.put(`${USER_DB_URL}/${user._id}`, updatedUser, DB_AUTH);
              user = updatedUser;
            } else {
              // Verify existing password
              const isPasswordCorrect = await bcrypt.compare(password, user.password);
              if (!isPasswordCorrect) {
                set({ error: 'Invalid password. Please try again.', isLoading: false });
                return false;
              }
            }

            if (user.pin !== pin) {
              set({ error: 'Invalid PIN. Please try again.', isLoading: false });
              return false;
            }
          } else {
            set({ error: 'Invalid login parameters.', isLoading: false });
            return false;
          }

          // Fetch privileges
          let userPrivileges = null;
          if (user.privileges && Object.keys(user.privileges).length > 0) {
            userPrivileges = user.privileges;
          } else if (user.role === 'admin') {
            userPrivileges = {
              canGiveDiscount: true,
              canChangePrice: true,
              canDeleteCartItem: true,
              canViewDashboard: true,
              canProcessPurchaseReturn: true
            };
          } else {
            try {
              const response = await axios.get(`${SETTINGS_DB_URL}/${PRIVILEGES_DOC_ID}`, DB_AUTH);
              userPrivileges = response.data.roles[user.role] || {};
            } catch (e) {
              userPrivileges = {};
            }
          }

          set({
            isAuthenticated: true,
            currentUser: user,
            privileges: userPrivileges,
            users: [user],
            isLoading: false,
            error: null,
          });
          return true;

        } catch (error) {
          console.error("Login error:", error);
          set({ error: 'An unexpected error occurred.', isLoading: false });
          return false;
        }
      },

      // Clear stored passwords for a user (useful for logout or security purposes)
      clearStoredPassword: (userId) => {
        try {
          const storedPasswords = JSON.parse(localStorage.getItem('userPasswords') || '{}');
          delete storedPasswords[userId];
          localStorage.setItem('userPasswords', JSON.stringify(storedPasswords));
        } catch (error) {
          console.error('Error clearing stored password:', error);
        }
      },

      // Clear all stored passwords
      clearAllStoredPasswords: () => {
        try {
          localStorage.removeItem('userPasswords');
        } catch (error) {
          console.error('Error clearing all stored passwords:', error);
        }
      },

      logout: () => {
        set({
          isAuthenticated: false,
          currentUser: null,
          privileges: null,
          users: [],
          error: null
        });
        // Optionally clear stored passwords on logout
        // get().clearAllStoredPasswords();
      },

      updateUserPrivileges: async (userId, newPrivileges) => {
        set({ isLoading: true });
        try {
          const userDoc = await axios.get(`${USER_DB_URL}/${userId}`, DB_AUTH);
          const docToSave = { ...userDoc.data, privileges: newPrivileges };
          await axios.put(`${USER_DB_URL}/${userId}`, docToSave, DB_AUTH);

          const { currentUser } = get();
          if (currentUser?._id === userId) {
            set({
              currentUser: { ...currentUser, privileges: newPrivileges },
              privileges: newPrivileges,
            });
          }

          await get().fetchUsers();
          set({ isLoading: false });
          alert('User privileges updated successfully!');
        } catch (error) {
          console.error("Error updating user privileges:", error);
          alert('Failed to update privileges.');
          set({ isLoading: false });
        }
      }

    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        currentUser: state.currentUser,
        privileges: state.privileges,
        users: state.users,
      }),
    }
  )
);
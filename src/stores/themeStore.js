// src/stores/themeStore.js (New File)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useThemeStore = create(
  persist(
    (set) => ({
      theme: 'light', // 'light' or 'dark'
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
    }),
    {
      name: 'app-theme-storage', // localStorage key
    }
  )
);

// tailwind.config.js (Updated)
/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class', // Enable class-based dark mode
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            colors: {
                // Custom colors for your dark theme
                'dark-primary': '#1e1e1e',   // Main background
                'dark-secondary': '#2e2e2e', // Cards, modals background
                'dark-text': '#e5e7eb',      // Primary text color
                'dark-text-secondary': '#9ca3af', // Muted text color
            },
        },
    },
    plugins: [],
};
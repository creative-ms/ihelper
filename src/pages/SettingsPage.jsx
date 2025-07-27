// src/pages/SettingsPage.jsx (Updated with Sync Tab)
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SlidersHorizontal, Palette, CreditCard, Users, DatabaseZap } from 'lucide-react'; // DatabaseZap icon import karein
import { useAuthStore } from '../stores/authStore';

// Tamam setting components import karein
import StoreSettings from '../components/settings/StoreSettings';
import AppearanceSettings from '../components/settings/AppearanceSettings';
import PaymentSettings from '../components/settings/PaymentSettings';
import PrivilegeSettings from '../components/settings/PrivilegeSettings';
import SyncSettings from '../components/settings/SyncSettings'; // Naya sync component import karein
import InventorySettings from '../components/settings/inventorySettings';

const SettingsPage = () => {
  const { privileges } = useAuthStore();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('General');

  useEffect(() => {
    if (location.state?.activeTab) {
      setActiveTab(location.state.activeTab);
    }
  }, [location.state]);

  const allTabs = [
    { name: 'General', icon: SlidersHorizontal, component: <StoreSettings /> },
    { name: 'Appearance', icon: Palette, component: <AppearanceSettings /> },
    { name: 'Payments', icon: CreditCard, component: <PaymentSettings /> },
    { name: 'Inventory', icon: CreditCard, component: <InventorySettings /> },
    {
      name: 'Users & Privileges',
      icon: Users,
      component: <PrivilegeSettings />,
      requires: 'canProcessPurchaseReturn',
    },
    // Naya Data Sync tab add karein
    {
      name: 'Data Sync',
      icon: DatabaseZap, // Naya icon istemal karein
      component: <SyncSettings />, // Naya component istemal karein
      requires: 'canProcessPurchaseReturn', // Sirf admin/manager ke liye
    },
  ];

  const visibleTabs = allTabs.filter(
    (tab) => !tab.requires || privileges?.[tab.requires]
  );

  const ActiveComponent = visibleTabs.find(tab => tab.name === activeTab)?.component;

  return (
    <div className="p-4 sm:p-6 bg-white dark:bg-dark-secondary rounded-2xl shadow-lg">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-dark-text mb-6">Settings</h1>
      
      <div className="flex flex-col md:flex-row gap-6 md:gap-10">
        <nav className="flex md:flex-col md:w-1/4 lg:w-1/5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.name}
              onClick={() => setActiveTab(tab.name)}
              className={`flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.name
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-dark-text-secondary dark:hover:bg-slate-700/50'
              }`}
            >
              <tab.icon size={18} />
              <span className="hidden md:inline">{tab.name}</span>
            </button>
          ))}
        </nav>

        <main className="flex-1 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-700 pt-6 md:pt-0 md:pl-10">
          {ActiveComponent}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;

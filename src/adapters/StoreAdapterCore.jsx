//src/adapters/StoreAdapterCore.jsx
import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Loader, Database, Settings, Activity } from 'lucide-react';

// Store Adapter Core - Main Interface and Configuration
const StoreAdapterCore = () => {
  const [adapterStatus, setAdapterStatus] = useState('initializing');
  const [storeStatuses, setStoreStatuses] = useState({});
  const [eventBusStatus, setEventBusStatus] = useState('disconnected');
  const [activeStores, setActiveStores] = useState([]);
  const [logs, setLogs] = useState([]);

  // Simulated store adapter functionality
  useEffect(() => {
    // Initialize adapter
    setTimeout(() => {
      setAdapterStatus('ready');
      setEventBusStatus('connected');
      setStoreStatuses({
        authStore: 'active',
        productStore: 'active',
        inventoryStore: 'active',
        dashboardStore: 'active',
        cartStore: 'active',
        salesStore: 'active'
      });
      setActiveStores(['authStore', 'productStore', 'inventoryStore', 'dashboardStore']);
      
      // Add some sample logs
      setLogs([
        { time: new Date().toLocaleTimeString(), level: 'info', message: 'Store adapter initialized successfully' },
        { time: new Date().toLocaleTimeString(), level: 'info', message: 'Event bus connection established' },
        { time: new Date().toLocaleTimeString(), level: 'success', message: 'All stores synchronized' }
      ]);
    }, 2000);
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': case 'ready': case 'connected': return 'text-green-600';
      case 'initializing': case 'loading': return 'text-yellow-600';
      case 'error': case 'disconnected': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active': case 'ready': case 'connected': return <CheckCircle className="w-4 h-4" />;
      case 'initializing': case 'loading': return <Loader className="w-4 h-4 animate-spin" />;
      case 'error': case 'disconnected': return <AlertCircle className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Store Adapter Dashboard</h1>
        <p className="text-gray-600">Unified interface for managing iHelper application stores</p>
      </div>

      {/* Adapter Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Adapter Status</h3>
              <p className={`text-sm ${getStatusColor(adapterStatus)} capitalize`}>{adapterStatus}</p>
            </div>
            <div className={getStatusColor(adapterStatus)}>
              {getStatusIcon(adapterStatus)}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Event Bus</h3>
              <p className={`text-sm ${getStatusColor(eventBusStatus)} capitalize`}>{eventBusStatus}</p>
            </div>
            <div className={getStatusColor(eventBusStatus)}>
              {getStatusIcon(eventBusStatus)}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Active Stores</h3>
              <p className="text-sm text-gray-600">{activeStores.length} / {Object.keys(storeStatuses).length}</p>
            </div>
            <Database className="w-5 h-5 text-blue-600" />
          </div>
        </div>
      </div>

      {/* Store Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {Object.entries(storeStatuses).map(([storeName, status]) => (
          <div key={storeName} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 capitalize">
                {storeName.replace('Store', ' Store')}
              </h3>
              <div className={getStatusColor(status)}>
                {getStatusIcon(status)}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Status:</span>
                <span className={`capitalize ${getStatusColor(status)}`}>{status}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Listeners:</span>
                <span className="text-gray-900">
                  {Math.floor(Math.random() * 10) + 1}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Last Sync:</span>
                <span className="text-gray-900">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
            </div>
            <div className="mt-4 flex space-x-2">
              <button className="flex-1 px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200 transition-colors">
                Sync
              </button>
              <button className="flex-1 px-3 py-1 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200 transition-colors">
                Reset
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Activity Logs */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Activity Logs</h3>
        </div>
        <div className="p-6">
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {logs.map((log, index) => (
              <div key={index} className="flex items-start space-x-3">
                <div className={`w-2 h-2 rounded-full mt-2 ${
                  log.level === 'success' ? 'bg-green-500' :
                  log.level === 'error' ? 'bg-red-500' :
                  'bg-blue-500'
                }`} />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-500">{log.time}</span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      log.level === 'success' ? 'bg-green-100 text-green-700' :
                      log.level === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {log.level.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 mt-1">{log.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Configuration</h3>
          <Settings className="w-5 h-5 text-gray-500" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Auto-sync Interval (minutes)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              defaultValue="5"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Event Bus Timeout (seconds)
            </label>
            <input
              type="number"
              min="1"
              max="30"
              defaultValue="5"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="mt-6 flex space-x-4">
          <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
            Apply Changes
          </button>
          <button className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors">
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoreAdapterCore;
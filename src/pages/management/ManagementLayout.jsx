import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Box, Users, Tag, Building, BarChart3, Settings, ListFilter
} from 'lucide-react';

const tabs = [
  { name: 'Products', path: '/management/products', icon: Tag },
  { name: 'Categories', path: '/management/categories', icon: ListFilter },
  { name: 'Brands', path: '/management/brands', icon: Building },
  { name: 'Suppliers', path: '/management/suppliers', icon: Users },
  { name: 'Generics', path: '/management/generics', icon: Box },
  { name: 'Customers', path: '/management/customers', icon: Users },
  { name: 'Analytics', path: '/management/analytics', icon: BarChart3 },
  { name: 'Settings', path: '/management/settings', icon: Settings },
];

const ManagementLayout = () => {
  const getTabClass = ({ isActive }) =>
    `flex items-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ease-in-out transform hover:scale-105 ${
      isActive
        ? 'bg-gradient-to-r from-cyan-500 to-sky-600 text-white shadow-lg shadow-cyan-500/25'
        : 'bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm text-slate-600 dark:text-slate-300 hover:bg-cyan-50 dark:hover:bg-slate-700/80 hover:text-cyan-600 dark:hover:text-cyan-400 border border-slate-200/50 dark:border-slate-700/50'
    }`;

  return (
    <div className="space-y-6">
      {/* Navigation Tabs */}
      <div className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-lg">
        <div className="flex flex-wrap gap-3">
          {tabs.map(({ name, path, icon: Icon }) => (
            <NavLink
              key={name}
              to={path}
              className={getTabClass}
            >
              <Icon className="w-4 h-4" />
              <span className="whitespace-nowrap">{name}</span>
            </NavLink>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl shadow-xl">
        <div className="p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default ManagementLayout;
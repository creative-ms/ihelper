// src/pages/audit/AuditTrailTable.jsx
import React from 'react';
import { useAuditStore } from '../../stores/auditStore.js';
import AuditLogRow from './AuditLogRow.jsx';

const AuditTrailTable = ({ product }) => {
  const { logs, isLoading } = useAuditStore();

  if (isLoading) {
    return <div className="text-center p-10">Loading audit trail...</div>;
  }
  
  if (!product) {
     return <div className="text-center p-10 text-slate-500">Please select a product to view its audit trail.</div>;
  }

  if (logs.length === 0) {
    return <div className="text-center p-10 text-slate-500">No audit records found for {product.name}.</div>;
  }

  return (
    <div className="mt-6 bg-white dark:bg-dark-secondary rounded-2xl shadow-lg overflow-hidden">
      <div className="p-4 border-b dark:border-slate-700">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Audit Trail for: {product.name}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">SKU: {product.sku || 'N/A'}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="p-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Timestamp</th>
              <th className="p-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Event Type</th>
              <th className="p-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Description</th>
              <th className="p-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {logs.map(log => (
              <AuditLogRow key={log._id} log={log} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditTrailTable;
// src/pages/audit/AuditLogRow.jsx
import React from 'react';
import { ShoppingCart, ShoppingBag, Undo2, CornerLeftUp, PackagePlus } from 'lucide-react';

// Helper function to get style for each event type
const getEventStyle = (eventType) => {
  switch (eventType) {
    case 'CREATE':
      return { icon: <PackagePlus size={16} />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300', text: 'Created' };
    case 'PURCHASE':
      return { icon: <ShoppingCart size={16} />, color: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300', text: 'Purchase' };
    case 'SALE':
      return { icon: <ShoppingBag size={16} />, color: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300', text: 'Sale' };
    case 'RETURN_CUSTOMER':
      return { icon: <Undo2 size={16} />, color: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300', text: 'Customer Return' };
    case 'RETURN_SUPPLIER':
      return { icon: <CornerLeftUp size={16} />, color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300', text: 'Supplier Return' };
    default:
      return { icon: null, color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300', text: eventType };
  }
};


// Helper function to generate a readable description for each log entry
const generateDescription = (log) => {
  const { eventType, details } = log;
  if (!details) return `Event: ${eventType}`; // Fallback for old logs

  switch (eventType) {
    case 'CREATE':
      return (
        <div>
          <p><strong>{details.message || 'Product created.'}</strong></p>
          <ul className="text-xs list-disc list-inside mt-1 pl-2 text-slate-500 dark:text-slate-400">
            <li>Initial Qty: <strong>{details.quantity || 0}</strong></li>
            <li>Cost Price: PKR {Number(details.purchasePrice || 0).toFixed(2)}</li>
            <li>Retail Price: PKR {Number(details.retailPrice || 0).toFixed(2)}</li>
            <li>Batch #: {details.batchNumber || 'N/A'}</li>
            <li>Expiry: {details.expDate || 'N/A'}</li>
          </ul>
        </div>
      );

    case 'PURCHASE':
      return (
        <div>
          <p>Purchased <strong>{details.quantity || 0} units</strong> from <strong>{details.supplierName || 'N/A'}</strong>.</p>
          <ul className="text-xs list-disc list-inside mt-1 pl-2 text-slate-500 dark:text-slate-400">
            <li>Rate: PKR {(details.rate || 0).toFixed(2)}</li>
            {(details.discount > 0) && <li>Discount: -PKR {(details.discount || 0).toFixed(2)}</li>}
            {(details.salesTax > 0) && <li>Sales Tax: +PKR {(details.salesTax || 0).toFixed(2)}</li>}
            {(details.furtherTax > 0) && <li>Further Tax: +PKR {(details.furtherTax || 0).toFixed(2)}</li>}
            {(details.advanceTax > 0) && <li>Advance Tax: +PKR {(details.advanceTax || 0).toFixed(2)}</li>}
          </ul>
        </div>
      );

    case 'SALE':
      const quantity = details.quantity || 1;
      const basePrice = details.basePrice || 0;
      const itemDiscountAmount = details.itemDiscount?.amount ?? 0;
      const taxAmount = details.taxes?.amount ?? 0;
      const costOfGoodsSold = details.costOfGoodsSold ?? 0;
      const netPrice = basePrice - (itemDiscountAmount / quantity) + (taxAmount / quantity);
      
      if (basePrice === 0) {
        return `Sold ${details.quantity} ${details.sellingUnit}(s) to ${details.customerName}. (Simple Log)`;
      }

      return (
        <div>
          <p>Sold <strong>{details.quantity} {details.sellingUnit}(s)</strong> to <strong>{details.customerName || 'N/A'}</strong>.</p>
          <ul className="text-xs list-disc list-inside mt-1 pl-2 text-slate-500 dark:text-slate-400">
            <li>Net Price/Unit: ~ PKR {netPrice.toFixed(2)}</li>
            <li className="font-semibold">Profit/Unit: ~ PKR {(netPrice - (costOfGoodsSold / quantity)).toFixed(2)}</li>
          </ul>
        </div>
      );

    case 'RETURN_CUSTOMER':
      return `Customer returned ${details.quantity || 0} ${details.sellingUnit || 'unit'}(s).`;

    case 'RETURN_SUPPLIER':
      return `Returned ${details.quantity || 0} units to ${details.supplierName || 'N/A'}.`;

    default:
      return JSON.stringify(details);
  }
};


const AuditLogRow = ({ log }) => {
  const { icon, color, text } = getEventStyle(log.eventType);
  const description = generateDescription(log);

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td className="p-4 align-top">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {new Date(log.timestamp).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {new Date(log.timestamp).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })}
        </div>
      </td>
      <td className="p-4 align-top">
        <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
          {icon}
          {text}
        </span>
      </td>
      <td className="p-4 text-sm text-slate-600 dark:text-slate-300 align-top">
        {description}
      </td>
      <td className="p-4 text-sm text-slate-500 dark:text-slate-400 align-top">
        {log.userName}
      </td>
    </tr>
  );
};

export default AuditLogRow;

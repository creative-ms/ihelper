// ✅ BEAUTIFUL UPDATED FILE: src/pages/export/ReportCard.jsx
import React, { useState } from 'react';
import { CSVLink } from 'react-csv';
import { FileText, Download, Calendar, Filter } from 'lucide-react';

const ReportCard = ({ title, description, onExportPDF, onPrepareCSV, showReturnCheckbox = false }) => {
  const [timeframe, setTimeframe] = useState('today');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [includeReturns, setIncludeReturns] = useState(false);
  const [csvData, setCsvData] = useState({ headers: [], data: [], filename: 'report.csv' });
  
  const handleExportClick = (format) => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    if (format === 'pdf') {
      onExportPDF(range, includeReturns);
    }
  };

  const handlePrepareCSVClick = async () => {
    const range = timeframe === 'custom' ? customRange : timeframe;
    const data = await onPrepareCSV(range, includeReturns);
    setCsvData(data);
  };

  return (
    <div className="
      relative overflow-hidden bg-white dark:bg-gray-800 
      rounded-2xl shadow-lg 
      border border-gray-100 dark:border-gray-700
      cursor-pointer
    ">
      {/* Gradient Background Overlay - Similar to stats cards */}
      <div className="absolute inset-0 opacity-5 bg-gradient-to-br from-purple-500 to-blue-600" />
      
      {/* Content */}
      <div className="relative p-6">
        {/* Header with Icon - Similar to stats cards */}
        <div className="flex items-center justify-between mb-4">
          <div className="
            p-3 rounded-xl 
            bg-purple-500 bg-opacity-10
          ">
            <FileText className="h-6 w-6 text-purple-500" />
          </div>
        </div>
        
        {/* Title - Similar to stats cards */}
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 tracking-wide">
          {title}
        </h3>
        
        {/* Description */}
        <p className="text-xs text-gray-500 dark:text-gray-500 mb-6">
          {description}
        </p>
        
        {/* Configuration Section */}
        <div className="space-y-4">
          {/* Timeframe Selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              Time Period
            </label>
            <select 
              onChange={(e) => setTimeframe(e.target.value)} 
              value={timeframe} 
              className="
                w-full px-3 py-2 text-sm rounded-lg
                bg-gray-50 dark:bg-gray-700
                border border-gray-200 dark:border-gray-600
                text-gray-900 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-purple-500
              "
            >
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {/* Custom Date Range */}
          {timeframe === 'custom' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    From
                  </label>
                  <input 
                    type="date" 
                    value={customRange.start} 
                    onChange={e => setCustomRange(p => ({...p, start: e.target.value}))} 
                    className="
                      w-full px-3 py-2 text-sm rounded-lg
                      bg-gray-50 dark:bg-gray-700
                      border border-gray-200 dark:border-gray-600
                      text-gray-900 dark:text-white
                      focus:outline-none focus:ring-2 focus:ring-purple-500
                    "
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    To
                  </label>
                  <input 
                    type="date" 
                    value={customRange.end} 
                    onChange={e => setCustomRange(p => ({...p, end: e.target.value}))} 
                    className="
                      w-full px-3 py-2 text-sm rounded-lg
                      bg-gray-50 dark:bg-gray-700
                      border border-gray-200 dark:border-gray-600
                      text-gray-900 dark:text-white
                      focus:outline-none focus:ring-2 focus:ring-purple-500
                    "
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* Returns Checkbox */}
          {showReturnCheckbox && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-gray-300">
                <input 
                  type="checkbox" 
                  checked={includeReturns} 
                  onChange={(e) => setIncludeReturns(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                Include Returns
              </label>
            </div>
          )}
        </div>

        {/* Export Buttons */}
        <div className="mt-6 space-y-3">
          {/* PDF Export Button */}
          <button 
            onClick={() => handleExportClick('pdf')} 
            className="
              w-full px-4 py-3 rounded-lg
              bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800
              text-white font-medium text-sm
              focus:outline-none focus:ring-2 focus:ring-red-500
              flex items-center justify-center gap-2
            "
          >
            <FileText className="h-4 w-4" />
            Export as PDF
          </button>

          {/* CSV Export Button */}
          <CSVLink
            data={csvData.data}
            headers={csvData.headers}
            filename={csvData.filename}
            target="_blank"
            onClick={handlePrepareCSVClick}
            className="
              w-full px-4 py-3 rounded-lg
              bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800
              text-white font-medium text-sm
              focus:outline-none focus:ring-2 focus:ring-green-500
              flex items-center justify-center gap-2
              no-underline
            "
          >
            <Download className="h-4 w-4" />
            Export as CSV
          </CSVLink>
        </div>
      </div>
      
      {/* Bottom accent line - Similar to stats cards */}
      <div className="
        absolute bottom-0 left-0 right-0 h-1 
        bg-gradient-to-br from-purple-500 to-blue-600
      " />
    </div>
  );
};

export default ReportCard;
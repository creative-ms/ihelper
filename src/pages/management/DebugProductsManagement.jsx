import React, { useState } from 'react';
import { PlusIcon } from '@heroicons/react/24/solid';

// Simplified FormModal for debugging
const DebugFormModal = ({ isOpen, onClose, title, children }) => {
  console.log('FormModal render - isOpen:', isOpen);
  
  if (!isOpen) {
    console.log('Modal not open, returning null');
    return null;
  }

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
        
        {/* Footer */}
        <div className="border-t border-slate-200 p-6 bg-slate-50">
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Product
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Simplified AddProductModal for debugging
const DebugAddProductModal = ({ isOpen, onClose }) => {
  console.log('AddProductModal render - isOpen:', isOpen);
  
  return (
    <DebugFormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Product - DEBUG"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Product Name
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter product name"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            SKU
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter SKU"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Price
          </label>
          <input
            type="number"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter price"
          />
        </div>
      </div>
    </DebugFormModal>
  );
};

// Main debug component
const DebugProductsManagement = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const handleAddProduct = () => {
    console.log('Add Product button clicked');
    console.log('Current isModalOpen state:', isModalOpen);
    setIsModalOpen(true);
    console.log('Setting isModalOpen to true');
  };

  const handleCloseModal = () => {
    console.log('Closing modal');
    setIsModalOpen(false);
  };

  console.log('Main component render - isModalOpen:', isModalOpen);

  return (
    <div className="space-y-6 p-6">
      {/* Header Bar */}
      <div className="bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 p-6 rounded-2xl shadow-xl">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold text-white">Products Management - DEBUG</h2>
            <p className="text-cyan-100">Debug version to test modal functionality</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleAddProduct}
              className="bg-white hover:bg-cyan-50 text-cyan-600 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <PlusIcon className="w-5 h-5" />
              Add Product
            </button>
          </div>
        </div>
      </div>

      {/* Debug Info */}
      <div className="bg-yellow-100 border border-yellow-300 rounded-lg p-4">
        <h3 className="font-bold text-yellow-800 mb-2">Debug Information:</h3>
        <p className="text-yellow-700">Modal Open State: {isModalOpen ? 'TRUE' : 'FALSE'}</p>
        <p className="text-yellow-700">Check browser console for more debug logs</p>
      </div>

      {/* Content Area */}
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <p className="text-gray-600">Click the "Add Product" button above to test the modal.</p>
        <p className="text-gray-600 mt-2">The modal should appear with a high z-index and dark backdrop.</p>
      </div>

      {/* Debug Modal */}
      <DebugAddProductModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
};

export default DebugProductsManagement;
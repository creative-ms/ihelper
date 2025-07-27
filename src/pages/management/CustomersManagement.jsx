import React, { useState, useEffect, useMemo } from 'react';
import { useCustomerStore } from '../../stores/customerStore.js';
import AddCustomerModal from '../../components/management/AddCustomerModal.jsx';
import { PlusIcon, BookOpenIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/solid';
import Pagination from '../../components/common/Pagination.jsx';
import CustomerLedgerModal from '../../components/management/CustomerLedgerModal.jsx';

const CustomerCard = ({ customer, onEdit, onDelete, onViewLedger }) => (
  <div className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 border border-slate-200/50 dark:border-slate-700/50">
    <div className="bg-gradient-to-r from-pink-500 to-rose-500 dark:from-pink-600 dark:to-rose-600 px-4 py-3 flex justify-between items-center">
      <h3 className="text-white text-lg font-bold truncate">{customer.name}</h3>
      <div className="flex space-x-1">
        <button onClick={() => onViewLedger(customer)} className="p-2 rounded-full hover:bg-white/20 transition-colors" title="View Ledger">
          <BookOpenIcon className="w-5 h-5 text-white" />
        </button>
        <button onClick={() => onEdit(customer)} className="p-2 rounded-full hover:bg-white/20 transition-colors" title="Edit">
          <PencilSquareIcon className="w-5 h-5 text-white" />
        </button>
        <button onClick={() => onDelete(customer)} className="p-2 rounded-full hover:bg-white/20 transition-colors" title="Delete">
          <TrashIcon className="w-5 h-5 text-white" />
        </button>
      </div>
    </div>
    <div className="p-4 space-y-2">
      <p className="text-slate-600 dark:text-slate-300 text-sm">
        <span className="font-medium">Address:</span> {customer.address || 'No address'}
      </p>
      <p className="text-slate-600 dark:text-slate-300 text-sm">
        <span className="font-medium">Mobile:</span> {customer.mobileNumbers?.join(', ') || 'N/A'}
      </p>
      <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
        <p className="text-xs text-slate-500 dark:text-slate-400">Balance</p>
        <p className={`text-lg font-bold ${(customer.balance || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          PKR {Math.abs(customer.balance || 0).toFixed(2)}
          {(customer.balance || 0) > 0 && <span className="text-xs ml-1">(Receivable)</span>}
          {(customer.balance || 0) < 0 && <span className="text-xs ml-1">(Payable)</span>}
        </p>
      </div>
    </div>
  </div>
);

const CustomersManagementPage = () => {
  const { customers, fetchCustomers, deleteCustomer } = useCustomerStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState(null);
  const [viewingLedgerFor, setViewingLedgerFor] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const itemsPerPage = 30;

  // Filter customers based on search term
  const filteredCustomers = useMemo(() => {
    if (!searchTerm) return customers;
    const lowercasedTerm = searchTerm.toLowerCase();
    return customers.filter(customer => 
      customer.name?.toLowerCase().includes(lowercasedTerm) ||
      customer.address?.toLowerCase().includes(lowercasedTerm) ||
      customer.mobileNumbers?.some(num => num.includes(searchTerm))
    );
  }, [customers, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / itemsPerPage));
  const currentCustomers = filteredCustomers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { 
    if (currentPage > totalPages) { 
      setCurrentPage(totalPages); 
    } 
  }, [filteredCustomers, currentPage, totalPages]);

  const handleSearchChange = (term) => {
    setCurrentPage(1);
    setSearchTerm(term);
  };

  const handleAdd = () => { setCustomerToEdit(null); setIsModalOpen(true); };
  const handleEdit = (customer) => { setCustomerToEdit(customer); setIsModalOpen(true); };
  const handleDelete = (customer) => { deleteCustomer(customer); };
  const closeModal = () => { setIsModalOpen(false); setCustomerToEdit(null); };
  const handleViewLedger = (customer) => { setViewingLedgerFor(customer); };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-gradient-to-r from-pink-500 via-rose-500 to-red-600 dark:from-pink-600 dark:via-rose-600 dark:to-red-700 p-6 rounded-2xl shadow-xl">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold text-white">Customers Management</h2>
            <p className="text-pink-100 dark:text-pink-50">Manage your customer relationships and balances</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <input
                type="text"
                placeholder="Search customers..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 pr-4 py-3 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-gray-700 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-300 dark:focus:ring-pink-400 transition w-56 sm:w-72"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
              </svg>
            </div>
            <button
              onClick={handleAdd}
              className="bg-white hover:bg-pink-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-pink-600 dark:text-pink-400 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <PlusIcon className="w-5 h-5" />
              Add Customer
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl shadow-xl p-6">
        <div className="mb-4 flex justify-between items-center">
          <span className="text-slate-600 dark:text-slate-300 text-sm font-medium">
            Showing {currentCustomers.length} of {filteredCustomers.length} customers
          </span>
          <div className="w-16 h-1 bg-gradient-to-r from-pink-500 to-rose-500 rounded-full"></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {currentCustomers.map((customer) => (
            <CustomerCard
              key={customer._id}
              customer={customer}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onViewLedger={handleViewLedger}
            />
          ))}
        </div>

        {filteredCustomers.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-2">No customers found</div>
            <p className="text-gray-500 text-sm">
              {searchTerm ? 'Try adjusting your search terms' : 'Click "Add Customer" to get started'}
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      <AddCustomerModal isOpen={isModalOpen} onClose={closeModal} editingCustomer={customerToEdit} />
      
      <CustomerLedgerModal 
        isOpen={!!viewingLedgerFor}
        onClose={() => setViewingLedgerFor(null)}
        customer={viewingLedgerFor}
      />
    </div>
  );
};

export default CustomersManagementPage;
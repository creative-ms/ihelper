import React, { useState, useEffect, useMemo } from 'react';
import { useSupplierStore } from '../../stores/supplierStore.js';
import AddSupplierModal from '../../components/management/AddSupplierModal.jsx';
import SupplierLedgerModal from '../../components/management/SupplierLedgerModal.jsx';
import SupplierPaymentModal from '../../components/management/SupplierPaymentModal.jsx';
import { PlusIcon, BookOpenIcon, Pencil, TrashIcon, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import Pagination from '../../components/common/Pagination.jsx';

const SupplierCard = ({ supplier, onEdit, onDelete, onViewLedger, onPayReceive }) => {
    const balance = supplier.balance || 0;
    const isPayable = balance > 0;
    const isReceivable = balance < 0;

    return (
        <div className="w-full rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-slate-200/50 dark:border-slate-700/50">
            <div className="bg-gradient-to-r from-emerald-500 to-green-600 dark:from-emerald-600 dark:to-green-700 px-4 py-3 flex justify-between items-center">
                <h3 className="text-white text-lg font-bold truncate">{supplier.name}</h3>
                <div className="flex space-x-1">
                    <button 
                        onClick={() => onEdit(supplier)} 
                        className="p-1.5 rounded-full hover:bg-white/20 transition-colors duration-200" 
                        title="Edit"
                    >
                        <Pencil className="w-4 h-4 text-white" />
                    </button>
                    <button 
                        onClick={() => onDelete(supplier)} 
                        className="p-1.5 rounded-full hover:bg-white/20 transition-colors duration-200" 
                        title="Delete"
                    >
                        <TrashIcon className="w-4 h-4 text-white" />
                    </button>
                </div>
            </div>
            
            <div className="p-4 space-y-3">
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Contact:</span>
                        <span className="text-slate-800 dark:text-slate-200 font-medium">{supplier.contactPerson || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Phone:</span>
                        <span className="text-slate-800 dark:text-slate-200 font-medium">{supplier.phone || 'N/A'}</span>
                    </div>
                </div>
                
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                    {isPayable && (
                        <div className="text-center">
                            <p className="text-xs text-red-600 dark:text-red-400 font-medium">Payable to Supplier</p>
                            <p className="font-bold text-xl text-red-600 dark:text-red-400">PKR {balance.toFixed(2)}</p>
                        </div>
                    )}
                    {isReceivable && (
                        <div className="text-center">
                            <p className="text-xs text-green-600 dark:text-green-400 font-medium">Credit with Supplier</p>
                            <p className="font-bold text-xl text-green-600 dark:text-green-400">PKR {Math.abs(balance).toFixed(2)}</p>
                        </div>
                    )}
                    {!isPayable && !isReceivable && (
                        <div className="text-center">
                            <p className="text-xs text-slate-500 font-medium">Balance</p>
                            <p className="font-bold text-xl text-slate-500">Settled</p>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="bg-slate-50/80 dark:bg-slate-700/50 p-3 flex justify-between items-center">
                <button 
                    onClick={() => onViewLedger(supplier)} 
                    className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors duration-200"
                >
                    <BookOpenIcon className="w-4 h-4" /> 
                    Ledger
                </button>
                {(isPayable || isReceivable) && (
                    <button 
                        onClick={() => onPayReceive(supplier)} 
                        className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-200 ${
                            isPayable 
                            ? 'text-red-600 hover:bg-red-100 bg-red-50 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20' 
                            : 'text-green-600 hover:bg-green-100 bg-green-50 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20'
                        }`}
                    >
                        {isPayable ? <ArrowUpFromLine className="w-4 h-4" /> : <ArrowDownToLine className="w-4 h-4" />}
                        {isPayable ? 'Pay' : 'Receive'}
                    </button>
                )}
            </div>
        </div>
    );
};

const SuppliersManagementPage = () => {
    const suppliers = useSupplierStore(state => state.suppliers);
    const fetchSuppliers = useSupplierStore(state => state.fetchSuppliers);
    const deleteSupplier = useSupplierStore(state => state.deleteSupplier);

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [supplierToEdit, setSupplierToEdit] = useState(null);
    const [viewingLedgerFor, setViewingLedgerFor] = useState(null);
    const [payingOrReceivingFrom, setPayingOrReceivingFrom] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const itemsPerPage = 30;

    const filteredSuppliers = useMemo(() => {
        if (!searchTerm) return suppliers;
        const lowercasedTerm = searchTerm.toLowerCase();
        return suppliers.filter(supplier => 
            supplier.name?.toLowerCase().includes(lowercasedTerm) ||
            supplier.contactPerson?.toLowerCase().includes(lowercasedTerm) ||
            supplier.phone?.includes(lowercasedTerm)
        );
    }, [suppliers, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / itemsPerPage));
    const currentSuppliers = filteredSuppliers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    useEffect(() => {
        fetchSuppliers();
    }, [fetchSuppliers]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [filteredSuppliers, currentPage, totalPages]);

    const handleSearchChange = (term) => {
        setCurrentPage(1);
        setSearchTerm(term);
    };

    const handleAdd = () => { setSupplierToEdit(null); setIsAddModalOpen(true); };
    const handleEdit = (supplier) => { setSupplierToEdit(supplier); setIsAddModalOpen(true); };
    const handleDelete = (supplier) => {
        if (window.confirm(`Are you sure you want to delete ${supplier.name}? This cannot be undone.`)) {
            deleteSupplier(supplier);
        }
    };
    const closeModal = () => { setIsAddModalOpen(false); setSupplierToEdit(null); };

    const handleViewLedger = (supplier) => setViewingLedgerFor(supplier);
    const handlePayReceive = (supplier) => setPayingOrReceivingFrom(supplier);

    return (
        <div className="space-y-6">
            {/* Header Bar */}
            <div className="bg-gradient-to-r from-emerald-500 via-green-500 to-teal-600 dark:from-emerald-600 dark:via-green-600 dark:to-teal-700 p-6 rounded-2xl shadow-xl">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <div className="space-y-2">
                        <h1 className="text-2xl md:text-3xl font-bold text-white">Suppliers Management</h1>
                        <p className="text-emerald-100 dark:text-emerald-50">Manage your vendors and their balances</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search suppliers..."
                                value={searchTerm}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                className="pl-10 pr-4 py-3 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-gray-700 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:focus:ring-emerald-400 transition w-56 sm:w-72"
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
                            </svg>
                        </div>
                        <button 
                            onClick={handleAdd} 
                            className="bg-white hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-emerald-600 dark:text-emerald-400 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                        >
                            <PlusIcon className="w-5 h-5" />
                            Add Supplier
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl shadow-xl p-6">
                <div className="mb-4 flex justify-between items-center">
                    <span className="text-slate-600 dark:text-slate-300 text-sm font-medium">
                        Showing {currentSuppliers.length} of {filteredSuppliers.length} suppliers
                    </span>
                    <div className="w-16 h-1 bg-gradient-to-r from-emerald-500 to-green-500 rounded-full"></div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {currentSuppliers.map((supplier) => (
                        <SupplierCard
                            key={supplier._id}
                            supplier={supplier}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onViewLedger={handleViewLedger}
                            onPayReceive={handlePayReceive}
                        />
                    ))}
                </div>
            </div>

            {/* Pagination */}
            <Pagination 
                currentPage={currentPage} 
                totalPages={totalPages} 
                onPageChange={setCurrentPage}
            />

            {/* All Modals */}
            <AddSupplierModal isOpen={isAddModalOpen} onClose={closeModal} editingSupplier={supplierToEdit} />
            <SupplierLedgerModal
                isOpen={!!viewingLedgerFor}
                onClose={() => setViewingLedgerFor(null)}
                supplier={viewingLedgerFor}
            />
            <SupplierPaymentModal
                isOpen={!!payingOrReceivingFrom}
                onClose={() => setPayingOrReceivingFrom(null)}
                supplier={payingOrReceivingFrom}
            />
        </div>
    );
};

export default SuppliersManagementPage;
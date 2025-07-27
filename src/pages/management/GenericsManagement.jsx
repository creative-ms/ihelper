import React, { useState, useEffect, useMemo } from 'react';
import { useGenericStore } from '../../stores/genericStore.js';
import AddGenericModal from '../../components/management/AddGenericModal.jsx';
import { PlusIcon, Pencil, TrashIcon } from 'lucide-react';
import Pagination from '../../components/common/Pagination.jsx';

const GenericCard = ({ generic, onEdit, onDelete }) => {
    return (
        <div className="w-full rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-slate-200/50 dark:border-slate-700/50">
            <div className="bg-gradient-to-r from-purple-500 to-indigo-600 dark:from-purple-600 dark:to-indigo-700 px-4 py-3 flex justify-between items-center">
                <h3 className="text-white text-lg font-bold truncate">{generic.name}</h3>
                <div className="flex space-x-1">
                    <button 
                        onClick={() => onEdit(generic)} 
                        className="p-1.5 rounded-full hover:bg-white/20 transition-colors duration-200" 
                        title="Edit"
                    >
                        <Pencil className="w-4 h-4 text-white" />
                    </button>
                    <button 
                        onClick={() => onDelete(generic)} 
                        className="p-1.5 rounded-full hover:bg-white/20 transition-colors duration-200" 
                        title="Delete"
                    >
                        <TrashIcon className="w-4 h-4 text-white" />
                    </button>
                </div>
            </div>
            
            <div className="p-4">
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Name:</span>
                        <span className="text-slate-800 dark:text-slate-200 font-medium">{generic.name}</span>
                    </div>
                    {generic.description && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                            <p className="text-slate-600 dark:text-slate-400 text-xs">Description:</p>
                            <p className="text-slate-800 dark:text-slate-200 text-sm mt-1">{generic.description}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const GenericsManagementPage = () => {
    const generics = useGenericStore((state) => state.generics);
    const fetchGenerics = useGenericStore((state) => state.fetchGenerics);
    const deleteGeneric = useGenericStore((state) => state.deleteGeneric);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [genericToEdit, setGenericToEdit] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const itemsPerPage = 30;

    const filteredGenerics = useMemo(() => {
        if (!searchTerm) return generics;
        const lowercasedTerm = searchTerm.toLowerCase();
        return generics.filter(generic => 
            generic.name?.toLowerCase().includes(lowercasedTerm) ||
            generic.description?.toLowerCase().includes(lowercasedTerm)
        );
    }, [generics, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filteredGenerics.length / itemsPerPage));
    const currentGenerics = filteredGenerics.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    useEffect(() => {
        fetchGenerics();
    }, [fetchGenerics]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [filteredGenerics, currentPage, totalPages]);

    const handleSearchChange = (term) => {
        setCurrentPage(1);
        setSearchTerm(term);
    };

    const handleEdit = (generic) => {
        setGenericToEdit(generic);
        setIsModalOpen(true);
    };

    const handleAdd = () => {
        setGenericToEdit(null);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setGenericToEdit(null);
    };

    const handleDelete = (generic) => {
        if (window.confirm(`Are you sure you want to delete "${generic.name}"?`)) {
            deleteGeneric(generic);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Bar */}
            <div className="bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-600 dark:from-purple-600 dark:via-indigo-600 dark:to-blue-700 p-6 rounded-2xl shadow-xl">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <div className="space-y-2">
                        <h2 className="text-2xl md:text-3xl font-bold text-white">Generics Management</h2>
                        <p className="text-purple-100 dark:text-purple-50">Manage your generic drug categories</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search generics..."
                                value={searchTerm}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                className="pl-10 pr-4 py-3 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-gray-700 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-400 transition w-56 sm:w-72"
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
                            </svg>
                        </div>
                        <button
                            onClick={handleAdd}
                            className="bg-white hover:bg-purple-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-purple-600 dark:text-purple-400 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                        >
                            <PlusIcon className="w-5 h-5" />
                            Add Generic
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl shadow-xl p-6">
                <div className="mb-4 flex justify-between items-center">
                    <span className="text-slate-600 dark:text-slate-300 text-sm font-medium">
                        Showing {currentGenerics.length} of {filteredGenerics.length} generics
                    </span>
                    <div className="w-16 h-1 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"></div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {currentGenerics.map((generic) => (
                        <GenericCard
                            key={generic._id}
                            generic={generic}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
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

            <AddGenericModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                editingGeneric={genericToEdit}
            />
        </div>
    );
};

export default GenericsManagementPage;
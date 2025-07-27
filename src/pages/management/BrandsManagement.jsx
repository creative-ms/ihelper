import React, { useState, useEffect, useMemo } from 'react';
import { useBrandStore } from '../../stores/brandStore.js';
import AddBrandModal from '../../components/management/AddBrandModal.jsx';
import { PlusIcon, Pencil, TrashIcon } from 'lucide-react';
import Pagination from '../../components/common/Pagination.jsx';

const BrandCard = ({ brand, onEdit, onDelete }) => {
    return (
        <div className="w-full rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-slate-200/50 dark:border-slate-700/50">
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 dark:from-amber-600 dark:to-orange-700 px-4 py-3 flex justify-between items-center">
                <h3 className="text-white text-lg font-bold truncate">{brand.name}</h3>
                <div className="flex space-x-1">
                    <button 
                        onClick={() => onEdit(brand)} 
                        className="p-1.5 rounded-full hover:bg-white/20 transition-colors duration-200" 
                        title="Edit"
                    >
                        <Pencil className="w-4 h-4 text-white" />
                    </button>
                    <button 
                        onClick={() => onDelete(brand)} 
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
                        <span className="text-slate-600 dark:text-slate-400">Brand Name:</span>
                        <span className="text-slate-800 dark:text-slate-200 font-medium">{brand.name}</span>
                    </div>
                    {brand.description && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                            <p className="text-slate-600 dark:text-slate-400 text-xs">Description:</p>
                            <p className="text-slate-800 dark:text-slate-200 text-sm mt-1">{brand.description}</p>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="bg-slate-50/80 dark:bg-slate-700/50 p-3 text-center">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                    Brand ID: {brand._id?.slice(-8) || 'N/A'}
                </span>
            </div>
        </div>
    );
};

const BrandsManagementPage = () => {
    const brands = useBrandStore((state) => state.brands);
    const fetchBrands = useBrandStore((state) => state.fetchBrands);
    const deleteBrand = useBrandStore((state) => state.deleteBrand);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [brandToEdit, setBrandToEdit] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const itemsPerPage = 30;

    const filteredBrands = useMemo(() => {
        if (!searchTerm) return brands;
        const lowercasedTerm = searchTerm.toLowerCase();
        return brands.filter(brand => 
            brand.name?.toLowerCase().includes(lowercasedTerm) ||
            brand.description?.toLowerCase().includes(lowercasedTerm)
        );
    }, [brands, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filteredBrands.length / itemsPerPage));
    const currentBrands = filteredBrands.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    useEffect(() => {
        fetchBrands();
    }, [fetchBrands]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [filteredBrands, currentPage, totalPages]);

    const handleSearchChange = (term) => {
        setCurrentPage(1);
        setSearchTerm(term);
    };

    const handleEdit = (brand) => {
        setBrandToEdit(brand);
        setIsModalOpen(true);
    };

    const handleAdd = () => {
        setBrandToEdit(null);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setBrandToEdit(null);
    };

    const handleDelete = (brand) => {
        if (window.confirm(`Are you sure you want to delete "${brand.name}"?`)) {
            deleteBrand(brand);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Bar */}
            <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-600 dark:from-amber-600 dark:via-orange-600 dark:to-red-700 p-6 rounded-2xl shadow-xl">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <div className="space-y-2">
                        <h2 className="text-2xl md:text-3xl font-bold text-white">Brands Management</h2>
                        <p className="text-amber-100 dark:text-amber-50">Manage your pharmaceutical brands</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search brands..."
                                value={searchTerm}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                className="pl-10 pr-4 py-3 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-gray-700 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-400 transition w-56 sm:w-72"
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
                            </svg>
                        </div>
                        <button
                            onClick={handleAdd}
                            className="bg-white hover:bg-amber-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                        >
                            <PlusIcon className="w-5 h-5" />
                            Add Brand
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl shadow-xl p-6">
                <div className="mb-4 flex justify-between items-center">
                    <span className="text-slate-600 dark:text-slate-300 text-sm font-medium">
                        Showing {currentBrands.length} of {filteredBrands.length} brands
                    </span>
                    <div className="w-16 h-1 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"></div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {currentBrands.map((brand) => (
                        <BrandCard
                            key={brand._id}
                            brand={brand}
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

            <AddBrandModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                editingBrand={brandToEdit}
            />
        </div>
    );
};

export default BrandsManagementPage;
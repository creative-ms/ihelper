import React, { useState, useEffect, useMemo } from 'react';
import { useCategoryStore } from '../../stores/categoryStore.js';
import AddCategoryModal from '../../components/management/AddCategoryModal.jsx';
import { PlusIcon } from '@heroicons/react/24/solid';
import { CategoryCard } from '../../components/management/ManagementModalCards.jsx';
import Pagination from '../../components/common/Pagination.jsx';

const CategoriesManagementPage = () => {
  const { categories, fetchCategories, deleteCategory } = useCategoryStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [categoryToEdit, setCategoryToEdit] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const itemsPerPage = 30;

  // Filter categories based on search term
  const filteredCategories = useMemo(() => {
    if (!searchTerm) return categories;
    const lowercasedTerm = searchTerm.toLowerCase();
    return categories.filter(category => 
      category.name?.toLowerCase().includes(lowercasedTerm) ||
      category.description?.toLowerCase().includes(lowercasedTerm)
    );
  }, [categories, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / itemsPerPage));
  const currentCategories = filteredCategories.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [filteredCategories, currentPage, totalPages]);

  const handleSearchChange = (term) => {
    setCurrentPage(1);
    setSearchTerm(term);
  };

  const handleEdit = (category) => {
    setCategoryToEdit(category);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setCategoryToEdit(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setCategoryToEdit(null);
  };

  const handleDelete = (category) => {
    if (window.confirm(`Are you sure you want to delete "${category.name}"?`)) {
      deleteCategory(category);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-gradient-to-r from-pink-500 via-pink-500 to-red-600 dark:from-red-600 dark:via-red-600 dark:to-red-800 p-6 rounded-2xl shadow-xl">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold text-white">Categories Management</h2>
            <p className="text-emerald-100 dark:text-emerald-50">Organize your products by categories</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <input
                type="text"
                placeholder="Search categories..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 pr-4 py-3 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-gray-700 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-400 transition w-56 sm:w-72"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
              </svg>
            </div>
            <button
              onClick={handleAdd}
              className="bg-white hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-pink-600 dark:text-pink-400 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <PlusIcon className="w-5 h-5" />
              Add Category
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl shadow-xl p-6">
        <div className="mb-4 flex justify-between items-center">
          <span className="text-slate-600 dark:text-slate-300 text-sm font-medium">
            Showing {currentCategories.length} of {filteredCategories.length} categories
          </span>
          <div className="w-16 h-1 bg-gradient-to-r from-emerald-500 to-green-500 rounded-full"></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {currentCategories.map((category) => (
            <CategoryCard
              key={category._id}
              category={category}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>

        {filteredCategories.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-2">No categories found</div>
            <p className="text-gray-500 text-sm">
              {searchTerm ? 'Try adjusting your search terms' : 'Click "Add Category" to get started'}
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={(page) => setCurrentPage(page)}
        />
      )}

      <AddCategoryModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        editingCategory={categoryToEdit}
      />
    </div>
  );
};

export default CategoriesManagementPage;
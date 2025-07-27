import React, { useState, useEffect, useMemo } from 'react';
import { useProductStore } from '../../stores/productStore.js';
import ProductTable from '../../components/management/ProductTable.jsx';
import ProductCard from '../../components/management/ProductCard.jsx';
import Pagination from '../../components/common/Pagination.jsx';
import AddProductModal from '../../components/management/AddProductModal.jsx';
import { PlusIcon, Bars3Icon, Squares2X2Icon } from '@heroicons/react/24/solid';

const ProductsManagementPage = () => {
  // Updated to use the correct store methods
  const { 
    allProducts, 
    filteredProducts,
    productsPerPage, 
    initializeCache, // Use this instead of fetchProducts
    deleteProduct,
    isLoading,
    filters,
    sortConfig,
    updateFilters,
    updateSort,
    applyFiltersAndSort
  } = useProductStore();

  const [viewMode, setViewMode] = useState('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  // Initialize the store on component mount
  useEffect(() => {
    initializeCache(); // Use initializeCache instead of fetchProducts
  }, [initializeCache]);

  // Use filteredProducts from store instead of local filtering
  const currentItems = filteredProducts.slice(
    (currentPage - 1) * productsPerPage,
    currentPage * productsPerPage
  );
  
  const totalPages = Math.ceil(filteredProducts.length / productsPerPage) || 1;

  const handleSearchChange = (term) => {
    setCurrentPage(1);
    setSearchTerm(term);
    // Update store filters instead of local state
    updateFilters({ search: term });
  };
  
  const handleSort = (key) => {
    updateSort(key); // Use store's updateSort method
  };

  const handleAddProduct = () => {
    console.log('Add Product clicked, current isModalOpen:', isModalOpen);
    setProductToEdit(null);
    setIsModalOpen(true);
    console.log('Set isModalOpen to true');
  };

  const handleEditProduct = (product) => {
    setProductToEdit(product);
    setIsModalOpen(true);
  };

  const handleDeleteProduct = (product) => {
    deleteProduct(product);
  };

  const handleCloseModal = () => setIsModalOpen(false);

  // Show loading state while initializing
  if (isLoading && allProducts.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 dark:from-cyan-600 dark:via-sky-600 dark:to-blue-700 p-6 rounded-2xl shadow-xl">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold text-white">Products Management</h2>
            <p className="text-cyan-100 dark:text-cyan-50">Manage your product inventory with ease</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 pr-4 py-3 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm text-gray-700 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-300 dark:focus:ring-cyan-400 transition w-56 sm:w-72"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
              </svg>
            </div>
            <button
              onClick={handleAddProduct}
              className="bg-white hover:bg-cyan-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-cyan-600 dark:text-cyan-400 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <PlusIcon className="w-5 h-5" />
              Add Product
            </button>
            <div className="flex gap-2 bg-white/20 dark:bg-slate-800/20 backdrop-blur-sm rounded-xl p-1">
              <button 
                onClick={() => setViewMode('list')} 
                className={`p-2 rounded-lg transition-all duration-200 ${viewMode === 'list' ? 'bg-white text-cyan-600 shadow-md' : 'text-white hover:bg-white/20'}`} 
                title="List View"
              >
                <Bars3Icon className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setViewMode('grid')} 
                className={`p-2 rounded-lg transition-all duration-200 ${viewMode === 'grid' ? 'bg-white text-cyan-600 shadow-md' : 'text-white hover:bg-white/20'}`} 
                title="Grid View"
              >
                <Squares2X2Icon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl shadow-xl p-6">
        <div className="mb-4 flex justify-between items-center">
          <span className="text-slate-600 dark:text-slate-300 text-sm font-medium">
            Showing {currentItems.length} of {filteredProducts.length} products
          </span>
          <div className="w-16 h-1 bg-gradient-to-r from-cyan-500 to-sky-500 rounded-full"></div>
        </div>
        
        <AddProductModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          editingProduct={productToEdit}
        />

        {viewMode === 'list' ? (
          <ProductTable
            products={currentItems}
            onEdit={handleEditProduct}
            onDelete={handleDeleteProduct}
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {currentItems.map((product) => (
              <ProductCard
                key={product._id}
                product={product}
                onEdit={handleEditProduct}
                onDelete={handleDeleteProduct}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={(page) => setCurrentPage(page)}
      />
    </div>
  );
};

export default ProductsManagementPage;
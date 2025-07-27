// src/stores/categoryStore.js
import { create } from 'zustand';
import axios from 'axios';

const DB_URL = 'http://localhost:5984/categories';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useCategoryStore = create((set, get) => ({
  categories: [],
  fetchCategories: async () => {
    try {
      const response = await axios.get(`${DB_URL}/_all_docs?include_docs=true`, DB_AUTH);
      set({ categories: response.data.rows.map(row => ({ ...row.doc, id: row.doc._id, rev: row.doc._rev })) });
    } catch (error) { console.error("Error fetching categories:", error.response?.data || error.message); }
  },
  addCategory: async (categoryData) => {
    try {
      await axios.post(DB_URL, { name: categoryData.name }, DB_AUTH);
      get().fetchCategories();
    } catch (error) { console.error("Error adding category:", error.response?.data || error.message); }
  },
  updateCategory: async (categoryToUpdate) => {
    try {
      const { id, rev, name } = categoryToUpdate;
      const docToSave = { _id: id, _rev: rev, name: name };
      await axios.put(`${DB_URL}/${docToSave._id}`, docToSave, DB_AUTH);
      get().fetchCategories();
    } catch (error) { console.error("Error updating category:", error.response?.data || error.message); }
  },
  deleteCategory: async (categoryToDelete) => {
    try {
      await axios.delete(`${DB_URL}/${categoryToDelete._id}?rev=${categoryToDelete._rev}`, DB_AUTH);
      get().fetchCategories();
    } catch (error) { console.error("Error deleting category:", error.response?.data || error.message); }
  },
}));
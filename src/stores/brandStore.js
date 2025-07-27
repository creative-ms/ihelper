// src/stores/brandStore.js

import { create } from 'zustand';
import axios from 'axios';

const DB_URL = 'http://localhost:5984/brands';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useBrandStore = create((set, get) => ({

    brands: [],
    isLoading: false,

    fetchBrands: async() => {
        set({ isLoading: true });
        try {
            const response = await axios.get(`${DB_URL}/_all_docs?include_docs=true`, DB_AUTH);
            const fetchedBrands = response.data.rows.map(row => ({...row.doc, id: row.doc._id, rev: row.doc._rev }));
            set({ brands: fetchedBrands, isLoading: false });
        } catch (error) {
            console.error("Error fetching brands:", error);
            set({ isLoading: false });
        }
    },

    addBrand: async(brandData) => {
        try {
            await axios.post(DB_URL, { name: brandData.name }, DB_AUTH);
            get().fetchBrands();
        } catch (error) {
            console.error("Error adding brand:", error.response ? error.response.data : error.message);
        }
    },

    updateBrand: async(brandToUpdate) => {
        try {
            const { id, rev, name } = brandToUpdate;
            const docToSave = { _id: id, _rev: rev, name: name };
            await axios.put(`${DB_URL}/${docToSave._id}`, docToSave, DB_AUTH);
            get().fetchBrands();
        } catch (error) {
            console.error("Error updating brand:", error.response ? error.response.data : error.message);
        }
    },

    deleteBrand: async(brandToDelete) => {
        try {
            await axios.delete(`${DB_URL}/${brandToDelete._id}?rev=${brandToDelete._rev}`, DB_AUTH);
            get().fetchBrands();
        } catch (error) {
            console.error("Error deleting brand:", error.response ? error.response.data : error.message);
        }
    },

}));
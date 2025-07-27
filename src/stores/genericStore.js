// src/stores/genericStore.js
import { create } from 'zustand';
import axios from 'axios';

const DB_URL = 'http://localhost:5984/generics';
const DB_AUTH = { auth: { username: 'admin', password: 'mynewsecretpassword' } };

export const useGenericStore = create((set, get) => ({
    generics: [],
    fetchGenerics: async() => {
        try {
            const response = await axios.get(`${DB_URL}/_all_docs?include_docs=true`, DB_AUTH);
            const fetchedGenerics = response.data.rows.map(row => ({...row.doc, id: row.doc._id, rev: row.doc._rev }));
            set({ generics: fetchedGenerics });
        } catch (error) { console.error("Error fetching generics:", error); }
    },

    addGeneric: async(genericData) => {
        try {
            await axios.post(DB_URL, { name: genericData.name }, DB_AUTH);
            get().fetchGenerics();
        } catch (error) { console.error("Error adding generic:", error.response ? error.response.data : error.message); }
    },

    updateGeneric: async(genericToUpdate) => {
        try {
            const { id, rev, name } = genericToUpdate;
            const docToSave = { _id: id, _rev: rev, name: name };
            await axios.put(`${DB_URL}/${docToSave._id}`, docToSave, DB_AUTH);
            get().fetchGenerics();
        } catch (error) { console.error("Error updating generic:", error.response ? error.response.data : error.message); }
    },

    deleteGeneric: async(genericToDelete) => {
        try {
            await axios.delete(`${DB_URL}/${genericToDelete._id}?rev=${genericToDelete._rev}`, DB_AUTH);
            get().fetchGenerics();
        } catch (error) { console.error("Error deleting generic:", error.response ? error.response.data : error.message); }
    },
}));
// File: src/api.js
import axios from 'axios';

const api = axios.create({
    baseURL: 'http://127.0.0.1:8000', // URL default server FastAPI Anda
    headers: {
        'Content-Type': 'application/json',
    },
});

export default api;
// File: src/api.js
import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

const CACHE_PREFIX = 'sf_cache_v1:';
const memoryCache = new Map();
const inFlightRequests = new Map();

// Batas waktu maksimal request agar loading tidak pernah melebihi 3 detik
const DEFAULT_TIMEOUT_MS = 2800;

const rawAxios = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
        'Content-Type': 'application/json',
    },
});

/**
 * Ambil metadata lengkap dari cache ({ data, timestamp }) untuk indikator kesegaran data (Stale Data Indicator)
 */
export const getCacheMeta = (url) => {
    if (!url) return null;
    const mem = memoryCache.get(url);
    if (mem) return mem;

    try {
        const raw = sessionStorage.getItem(CACHE_PREFIX + url);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data) {
                memoryCache.set(url, parsed);
                return parsed;
            }
        }
    } catch {
        // Abaikan error sessionStorage
    }
    return null;
};

/**
 * Ambil data dari cache (memori atau sessionStorage) secara sinkron (0ms)
 */
export const getCachedData = (url) => {
    const meta = getCacheMeta(url);
    return meta ? meta.data : null;
};

/**
 * Simpan respons API ke cache memori & sessionStorage
 */
export const setCachedData = (url, data) => {
    if (!url || !data) return;
    const entry = { data, timestamp: Date.now() };
    memoryCache.set(url, entry);
    try {
        sessionStorage.setItem(CACHE_PREFIX + url, JSON.stringify(entry));
    } catch {
        // Abaikan jika sessionStorage penuh
    }
};

/**
 * Hapus cache untuk URL tertentu (dipanggil otomatis setelah POST/update)
 */
export const invalidateCache = (urlPrefix = '') => {
    for (const key of memoryCache.keys()) {
        if (!urlPrefix || key.includes(urlPrefix)) {
            memoryCache.delete(key);
        }
    }
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(CACHE_PREFIX)) {
                const subKey = k.slice(CACHE_PREFIX.length);
                if (!urlPrefix || subKey.includes(urlPrefix)) {
                    sessionStorage.removeItem(k);
                }
            }
        }
    } catch {
        // Abaikan error storage
    }
};

/**
 * Login admin secara eksplisit menggunakan username dan password
 */
export const loginAdmin = async (username, password) => {
    try {
        if (!username || !password) {
            return { success: false, message: 'Username dan password wajib diisi' };
        }
        const res = await axios.post(
            `${API_BASE_URL}/api/auth/login`,
            { username, password },
            { timeout: 5000 }
        );
        const token = res.data?.token || res.data?.access_token || res.data?.data?.token;
        if (token) {
            localStorage.setItem('token', token);
            localStorage.setItem('role', res.data?.role || 'admin');
            return { success: true, token, message: res.data?.message };
        }
        return { success: false, message: res.data?.message || 'Login gagal' };
    } catch (err) {
        return {
            success: false,
            message: err.response?.data?.detail || err.message || 'Gagal login. Periksa username dan password.'
        };
    }
};

/**
 * Hapus token admin dari sesi browser (Logout)
 */
export const logoutAdmin = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
};

/**
 * Cek apakah browser saat ini memiliki token aktif
 */
export const isAuthenticated = () => {
    const token = localStorage.getItem('token');
    return Boolean(token && token !== 'undefined' && token !== 'null');
};

// Sisipkan Authorization Bearer token ke setiap request jika ada
rawAxios.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Jika menerima 401 Unauthorized dari server, bersihkan sesi token lokal
rawAxios.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && !error.config?.url?.includes('/api/auth/login')) {
            logoutAdmin();
        }
        return Promise.reject(error);
    }
);

// Tentukan TTL cache berdasarkan jenis endpoint (ms)
const getCacheTtl = (url = '') => {
    if (url.includes('/api/command/status')) return 2000;
    if (url.includes('/api/dashboard/')) return 3500;
    if (url.includes('/api/sensor/history/')) return 15000;
    if (url.includes('/api/feeding-log') || url.includes('/api/sampling') || url.includes('/api/calibration')) {
        return 10000;
    }
    return 5000;
};

// Wrapper API dengan deduplikasi request, cache cepat, dan batas waktu < 3 detik
const api = {
    get: async (url, config = {}) => {
        const forceRefresh = Boolean(config?.forceRefresh);
        const ttl = getCacheTtl(url);
        const memEntry = memoryCache.get(url);
        const cachedData = getCachedData(url);

        // Jika data di cache masih segar (dalam rentang TTL) dan tidak dipaksa refresh, kembalikan instan (0ms)
        if (!forceRefresh && memEntry && Date.now() - memEntry.timestamp < ttl) {
            return { data: memEntry.data, status: 200, fromCache: true };
        }

        // Gunakan kembali request yang sedang berjalan untuk URL yang sama (deduplikasi)
        let networkPromise = inFlightRequests.get(url);
        if (!networkPromise) {
            networkPromise = rawAxios
                .get(url, { timeout: DEFAULT_TIMEOUT_MS, ...config })
                .then((res) => {
                    if (res?.data) {
                        setCachedData(url, res.data);
                    }
                    return res;
                })
                .finally(() => {
                    inFlightRequests.delete(url);
                });
            inFlightRequests.set(url, networkPromise);
        }

        // Jika sudah ada data di cache namun stale, batasi tunggu jaringan maks 1.2 detik
        // lalu kembalikan cache sementara jaringan tetap memperbarui di latar belakang
        if (!forceRefresh && cachedData) {
            return Promise.race([
                networkPromise.catch(() => ({ data: cachedData, status: 200, fromCache: true })),
                new Promise((resolve) =>
                    setTimeout(() => resolve({ data: cachedData, status: 200, fromCache: true }), 1200)
                ),
            ]);
        }

        return networkPromise;
    },

    post: async (url, payload, config = {}) => {
        // Untuk aksi tulis (POST), beri batas waktu wajar dan invalidasi cache terkait
        const res = await rawAxios.post(url, payload, { timeout: 6000, ...config });
        if (url.includes('/api/feeding-log')) {
            invalidateCache('/api/feeding-log');
        } else if (url.includes('/api/sampling')) {
            invalidateCache('/api/sampling');
            invalidateCache('/api/feeding-log');
        } else if (url.includes('/api/calibration')) {
            invalidateCache('/api/calibration');
            invalidateCache('/api/dashboard/');
        } else if (url.includes('/api/command')) {
            invalidateCache('/api/command/status');
        } else {
            invalidateCache();
        }
        return res;
    },

    put: (...args) => rawAxios.put(...args),
    delete: (...args) => rawAxios.delete(...args),
};

/**
 * Prefetch endpoint utama di latar belakang agar perpindahan antar halaman instan (< 0.1 detik)
 */
export const prefetchAppData = () => {
    const endpoints = [
        '/api/dashboard/adm',
        '/api/dashboard/kontrol',
        '/api/sensor/history/adm',
        '/api/sensor/history/kontrol',
        '/api/feeding-log',
        '/api/sampling',
        '/api/calibration',
    ];
    endpoints.forEach((ep) => {
        if (!getCachedData(ep)) {
            api.get(ep).catch(() => {});
        }
    });
};

export default api;

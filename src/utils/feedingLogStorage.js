// File: src/utils/feedingLogStorage.js
// Penyimpanan sinkronisasi & override lokal untuk Feeding Log (Kolam A Kontrol & Kolam B ADM)
// Memastikan input manual dan pengeditan log pakan (tanggal, jumlah pakan, target fuzzy, durasi, status)
// tersimpan secara konsisten di seluruh halaman (Analysis, FeedingLog, LandingPage).

import { parseUtc, dateKeyWita } from './time';

const LEGACY_DATE_OVERRIDE_KEY = 'smart_feeder_kolam_a_date_overrides';
const LOG_OVERRIDES_STORAGE_KEY = 'smart_feeder_feeding_log_overrides_v2';

/**
 * Deteksi apakah string tipe kolam merupakan Kolam A (Kontrol / Timer)
 */
export const isControlPondType = (pondType = '') => {
    const s = String(pondType).trim();
    if (/adm|perlakuan|kolam\s*b/i.test(s)) return false;
    return /kontrol|timer|kolam\s*a/i.test(s);
};

/**
 * Dapatkan kunci unik stabil untuk sebuah item feeding log
 */
export const getStableLogKey = (item) => {
    if (!item) return '';
    return String(
        item.id ||
        item.key ||
        item.timestamp_iso ||
        item.timestamp ||
        `${item.tanggal || ''}_${item.pond_type || item.pondType || ''}_${item.jumlah_pakan ?? item.jumlahPakan ?? 0}`
    );
};

/**
 * Baca state override dari localStorage (termasuk migrasi dari key legacy Kolam A)
 */
export const loadFeedingLogOverrides = () => {
    let legacyDates = {};
    try {
        const rawLegacy = localStorage.getItem(LEGACY_DATE_OVERRIDE_KEY);
        if (rawLegacy) {
            legacyDates = JSON.parse(rawLegacy) || {};
        }
    } catch {
        // Abaikan error parse
    }

    try {
        const raw = localStorage.getItem(LOG_OVERRIDES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const edits = parsed.edits && typeof parsed.edits === 'object' ? parsed.edits : {};
        const deleted = Array.isArray(parsed.deleted) ? parsed.deleted : [];
        const localLogs = Array.isArray(parsed.localLogs) ? parsed.localLogs : [];

        // Gabungkan legacy date overrides ke dalam edits
        Object.entries(legacyDates).forEach(([k, dateStr]) => {
            if (k && dateStr && !edits[k]?.tanggal) {
                edits[k] = { ...(edits[k] || {}), tanggal: dateStr };
            }
        });

        return { edits, deleted, localLogs };
    } catch {
        const edits = {};
        Object.entries(legacyDates).forEach(([k, dateStr]) => {
            if (k && dateStr) edits[k] = { tanggal: dateStr };
        });
        return { edits, deleted: [], localLogs: [] };
    }
};

/**
 * Simpan state override ke localStorage
 */
const writeFeedingLogOverrides = (state) => {
    try {
        localStorage.setItem(LOG_OVERRIDES_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Abaikan jika storage penuh
    }
};

/**
 * Simpan atau perbarui override atribut untuk sebuah log berdasarkan kuncinya
 */
export const saveFeedingLogEdit = (logKey, patch = {}) => {
    if (!logKey) return;
    const state = loadFeedingLogOverrides();
    state.edits[logKey] = {
        ...(state.edits[logKey] || {}),
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    if (patch.tanggal) {
        try {
            const rawLegacy = localStorage.getItem(LEGACY_DATE_OVERRIDE_KEY);
            const legacy = rawLegacy ? JSON.parse(rawLegacy) : {};
            legacy[logKey] = patch.tanggal;
            localStorage.setItem(LEGACY_DATE_OVERRIDE_KEY, JSON.stringify(legacy));
        } catch {
            // Abaikan
        }
    }
    // Jika log ini ada di localLogs, perbarui juga langsung
    state.localLogs = state.localLogs.map((item) => {
        if (getStableLogKey(item) === logKey) {
            return { ...item, ...patch };
        }
        return item;
    });
    writeFeedingLogOverrides(state);
};

/**
 * Tandai sebuah log sebagai dihapus (agar tidak muncul lagi di tabel maupun perhitungan pakan)
 */
export const markFeedingLogDeleted = (logKey) => {
    if (!logKey) return;
    const state = loadFeedingLogOverrides();
    if (!state.deleted.includes(logKey)) {
        state.deleted.push(logKey);
    }
    state.localLogs = state.localLogs.filter((item) => getStableLogKey(item) !== logKey);
    writeFeedingLogOverrides(state);
};

/**
 * Tambahkan log lokal (digunakan sebagai cadangan jika penambahan log baru belum langsung terindeks atau saat penyesuaian)
 */
export const addLocalFeedingLog = (logItem) => {
    if (!logItem) return;
    const state = loadFeedingLogOverrides();
    const key = getStableLogKey(logItem);
    state.localLogs = [
        logItem,
        ...state.localLogs.filter((item) => getStableLogKey(item) !== key),
    ];
    writeFeedingLogOverrides(state);
};

/**
 * Dapatkan tanggal YYYY-MM-DD (WITA) dari sebuah item log pakan
 */
export const resolveLogDateKey = (item, customEdits = null) => {
    if (!item) return null;
    const key = getStableLogKey(item);
    const edits = customEdits || loadFeedingLogOverrides().edits;
    const overrideDate = key && edits[key]?.tanggal;
    if (typeof overrideDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
        return overrideDate;
    }
    if (typeof item.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.tanggal)) {
        return item.tanggal;
    }
    const dateObj =
        parseUtc(item?.timestamp_iso) ||
        parseUtc(item?.timestamp) ||
        parseUtc(item?.key);
    return dateObj ? dateKeyWita(dateObj) : null;
};

/**
 * Terapkan seluruh edit, override tanggal, dan filter penghapusan pada array feeding log dari backend
 */
export const applyFeedingLogOverrides = (rawLogs) => {
    const { edits, deleted, localLogs } = loadFeedingLogOverrides();
    const deletedSet = new Set(deleted);
    const baseList = Array.isArray(rawLogs) ? rawLogs : [];

    const seenKeys = new Set();
    const merged = [];

    const processItem = (item) => {
        if (!item) return;
        const key = getStableLogKey(item);
        if (!key || deletedSet.has(key) || seenKeys.has(key)) return;
        seenKeys.add(key);

        const patch = edits[key] || {};
        const mergedItem = { ...item, ...patch };

        // Sinkronkan nama properti camelCase & snake_case agar kompatibel di Analysis.jsx & FeedingLog.jsx
        const jumlah = Number(
            patch.jumlah_pakan ??
            patch.jumlahPakan ??
            mergedItem.jumlahPakan ??
            mergedItem.jumlah_pakan ??
            0
        );
        const target =
            patch.target_pakan ??
            patch.targetPakan ??
            mergedItem.targetPakan ??
            mergedItem.target_pakan ??
            jumlah;
        const durasi = Number(
            patch.durasi_servo ??
            patch.durasi ??
            mergedItem.durasi ??
            mergedItem.durasi_servo ??
            0
        );

        const rawPond = patch.pond_type || patch.pondType || mergedItem.pondType || mergedItem.pond_type || 'adm';
        const isKontrol = isControlPondType(rawPond);
        const canonicalPondType = isKontrol ? 'Kolam Kontrol (Timer)' : 'Kolam Perlakuan (ADM)';
        const canonicalPondCode = isKontrol ? 'kontrol' : 'adm';

        const resolvedDate = resolveLogDateKey(mergedItem, edits);
        let timestampIso = mergedItem.timestamp_iso || mergedItem.timestamp || mergedItem.key;

        // Jika tanggal di-override oleh pengguna, selaraskan jam pada tanggal tersebut agar tabel & filter tanggal konsisten
        if (patch.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(patch.tanggal)) {
            const origDate = parseUtc(timestampIso);
            if (origDate) {
                const origDateKey = dateKeyWita(origDate);
                if (origDateKey !== patch.tanggal) {
                    timestampIso = patch.timestamp_iso || `${patch.tanggal}T04:00:00.000Z`;
                }
            } else {
                timestampIso = patch.timestamp_iso || `${patch.tanggal}T04:00:00.000Z`;
            }
        }

        merged.push({
            ...mergedItem,
            id: mergedItem.id || key,
            key: mergedItem.key || key,
            jumlah_pakan: jumlah,
            jumlahPakan: jumlah,
            target_pakan: target,
            targetPakan: target,
            durasi_servo: durasi,
            durasi: durasi,
            pond_type: canonicalPondCode,
            pondType: mergedItem.pondType || canonicalPondType,
            tanggal: resolvedDate || mergedItem.tanggal,
            timestamp_iso: timestampIso,
            timestamp: patch.tanggal ? timestampIso : (mergedItem.timestamp || timestampIso),
            status: mergedItem.status || 'Berhasil',
        });
    };

    baseList.forEach(processItem);
    localLogs.forEach(processItem);

    return merged;
};


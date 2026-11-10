// File: src/utils/time.js
// Helper waktu bersama. Semua timestamp dari backend (InfluxDB) dianggap UTC
// jika tidak mencantumkan zona waktu, lalu ditampilkan dalam WITA.

export const TIME_ZONE = 'Asia/Makassar'; // WITA

/**
 * Parse berbagai format timestamp backend menjadi Date (atau null jika gagal):
 * - "2026-10-12 08:18:08.386834+00:00" (ISO dengan spasi & mikrodetik)
 * - "2026-10-12T08:18:08Z"
 * - "12/10/2026 08:18:08" (DD/MM/YYYY HH:mm:ss, dianggap UTC)
 */
export const parseUtc = (input) => {
    if (input === null || input === undefined || input === '') return null;
    if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

    const str = String(input).trim();

    // Format ISO (spasi atau 'T', mikrodetik opsional, zona opsional)
    const iso = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
    if (iso) {
        const [, date, time, frac = '', zone] = iso;
        const ms = frac ? frac.slice(0, 4).padEnd(4, '0') : ''; // ".123"
        const d = new Date(`${date}T${time}${ms}${zone ? zone.toUpperCase() : 'Z'}`);
        return isNaN(d.getTime()) ? null : d;
    }

    // Format DD/MM/YYYY HH:mm(:ss)
    const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (dmy) {
        const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = dmy;
        const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss));
        return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
};

/** Format tanggal + jam lengkap dalam WITA, contoh "12/10/2026, 16.18.08 WITA" */
export const formatDateTimeWita = (input) => {
    const d = parseUtc(input);
    if (!d) return input ? String(input) : '-';
    return d.toLocaleString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }) + ' WITA';
};

/** Format jam:menit dalam WITA */
export const formatJamWita = (input) => {
    const d = parseUtc(input);
    return d ? d.toLocaleTimeString('id-ID', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
};

/** Kunci tanggal YYYY-MM-DD dalam WITA */
export const dateKeyWita = (d) => d.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

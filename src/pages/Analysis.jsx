import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Card, Row, Col, Typography, Alert, Divider, Statistic, Space,
    Form, Select, InputNumber, Button, Table, message, Spin, Tag, Tooltip, DatePicker
} from 'antd';
import {
    InfoCircleOutlined, ExperimentOutlined, SaveOutlined,
    CalculatorOutlined, CheckCircleOutlined, PlusCircleOutlined, CalendarOutlined, ReloadOutlined
} from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import dayjs from 'dayjs';
import api, { getCachedData } from '../api';
import { parseUtc, formatJamWita as formatJam, dateKeyWita } from '../utils/time';
import { EmptyState, ErrorState, DataFreshnessBadge } from '../components/SystemStates';

const { Title, Text } = Typography;
const { Option } = Select;

// --- 1. KONSTANTA & HELPER DATA RIIL ---
// Konsisten di seluruh aplikasi: Kolam A = Kontrol (Timer), Kolam B = Perlakuan (ADM)
const LABEL_KONTROL = 'Kolam A — Kontrol (Timer)';
const LABEL_ADM = 'Kolam B — Perlakuan (ADM)';
const COLOR_ADM = '#4649e5';
const COLOR_KONTROL = '#d97706';

const DATE_OVERRIDE_STORAGE_KEY = 'smart_feeder_kolam_a_date_overrides';

const loadDateOverrides = () => {
    try {
        const raw = localStorage.getItem(DATE_OVERRIDE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const saveDateOverride = (logKey, dateKey) => {
    if (!logKey || !dateKey) return;
    try {
        const current = loadDateOverrides();
        current[logKey] = dateKey;
        localStorage.setItem(DATE_OVERRIDE_STORAGE_KEY, JSON.stringify(current));
    } catch {
        // Abaikan jika storage penuh
    }
};

// Rentang normal kualitas air
const NORMAL_RANGE = { suhu: [24, 32], do: [4, 8], ph: [6.5, 8.5], tds: [400, 1500] };

// Parameter kualitas air (murni data riil tanpa dummy)
const WATER_PARAMS = [
    { key: 'suhu', name: 'Suhu', title: 'Suhu Air (°C)', unit: '°C', decimals: 1 },
    { key: 'do', name: 'DO', title: 'Dissolved Oxygen / DO (mg/L)', unit: 'mg/L', decimals: 2 },
    { key: 'ph', name: 'pH', title: 'Derajat Keasaman (pH)', unit: '', decimals: 2 },
    { key: 'tds', name: 'TDS', title: 'Total Padatan / TDS (ppm)', unit: 'ppm', decimals: 0 },
];

const round = (value, decimals) => Number(Number(value).toFixed(decimals));
const formatNumber = (value, decimals = 0) =>
    Number(value || 0).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimals });

// YYYY-MM-DD -> DD/MM
const shortDateLabel = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

// Ubah histori sensor [{time, value}] menjadi rata-rata per jam dalam 24 jam terakhir
const toHourlySeries = (arr, decimals) => {
    const validPoints = [];
    (Array.isArray(arr) ? arr : []).forEach((p) => {
        const dateObj = parseUtc(p?.time);
        const value = Number(p?.value);
        if (!dateObj || p?.value === null || p?.value === undefined || isNaN(value)) return;
        validPoints.push({ ms: dateObj.getTime(), value });
    });
    if (validPoints.length === 0) return [];

    const maxTime = Math.max(...validPoints.map((p) => p.ms));
    const cutoff = maxTime - 24 * 60 * 60 * 1000;
    const buckets = new Map();

    validPoints.forEach(({ ms, value }) => {
        if (ms < cutoff) return;
        const hour = Math.floor(ms / 3600000) * 3600000;
        const bucket = buckets.get(hour) || { sum: 0, count: 0 };
        bucket.sum += value;
        bucket.count += 1;
        buckets.set(hour, bucket);
    });

    return [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([hour, b]) => ({ hour, value: round(b.sum / b.count, decimals) }));
};

// Gabungkan data sensor riil Kolam B (ADM) dan Kolam A (Kontrol)
const buildWaterChartData = (hourlyAdm, hourlyKontrol) =>
    [
        ...hourlyAdm.map(({ hour, value }) => ({
            time: new Date(hour),
            type: LABEL_ADM,
            value,
        })),
        ...hourlyKontrol.map(({ hour, value }) => ({
            time: new Date(hour),
            type: LABEL_KONTROL,
            value,
        })),
    ].sort((a, b) => a.time - b.time);

// Deteksi apakah log pakan berasal dari Kolam A (Kontrol / Timer)
const isControlPond = (pondType = '') => {
    const s = String(pondType).trim();
    if (/adm|perlakuan/i.test(s)) return false;
    return /kontrol|timer|kolam\s*a/i.test(s);
};

// Ambil tanggal log pakan (mendukung override tanggal input manual Kolam A)
const getLogDateKey = (item, overrides = {}) => {
    const idKey = item?.id || item?.key || item?.timestamp_iso || item?.timestamp;
    if (idKey && overrides[idKey]) {
        return overrides[idKey];
    }
    if (typeof item?.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.tanggal)) {
        return item.tanggal;
    }
    const dateObj =
        parseUtc(item?.timestamp_iso) ||
        parseUtc(item?.timestamp) ||
        parseUtc(item?.key);
    return dateObj ? dateKeyWita(dateObj) : null;
};

// Akumulasi pakan harian riil dari feeding log (hanya event berstatus 'Berhasil', tanpa data dummy)
const buildDailyFeed = (logs, overrides = {}) => {
    const totalsAdm = new Map();
    const totalsKontrol = new Map();

    (Array.isArray(logs) ? logs : []).forEach((item) => {
        if (item?.status !== 'Berhasil') return;
        const key = getLogDateKey(item, overrides);
        if (!key) return;
        const target = isControlPond(item.pondType || item.pond_type) ? totalsKontrol : totalsAdm;
        target.set(key, (target.get(key) || 0) + (Number(item.jumlahPakan ?? item.jumlah_pakan) || 0));
    });

    const keys = [...new Set([...totalsAdm.keys(), ...totalsKontrol.keys()])].sort();
    if (keys.length === 0) return { days: [], totalsAdm, totalsKontrol };

    const days = [];
    const end = new Date(`${keys[keys.length - 1]}T00:00:00Z`).getTime();
    for (let t = new Date(`${keys[0]}T00:00:00Z`).getTime(); t <= end; t += 86400000) {
        const key = new Date(t).toISOString().slice(0, 10);
        days.push({
            key,
            feedAdm: round(totalsAdm.get(key) || 0, 1),
            feedKontrol: round(totalsKontrol.get(key) || 0, 1),
        });
    }
    return { days, totalsAdm, totalsKontrol };
};

// Opsi pilihan minggu untuk input sampling (Minggu 1 s.d. 12)
const WEEK_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: `Minggu ${i + 1}`,
}));

// Konfigurasi Kolom Tabel Sampling FCR Mingguan
const fcrColumns = [
    { title: 'Minggu ke-', dataIndex: 'week', key: 'week', align: 'center', fixed: 'left', width: 95 },
    {
        title: 'Akumulasi Pakan Diberikan (gram)',
        children: [
            {
                title: 'Kolam B (ADM)',
                dataIndex: 'feedA',
                key: 'feedA',
                align: 'right',
                render: (val) => (val !== undefined && val !== null ? formatNumber(val, 1) : '—'),
            },
            {
                title: 'Kolam A (Kontrol)',
                dataIndex: 'feedB',
                key: 'feedB',
                align: 'right',
                render: (val) => (val !== undefined && val !== null ? formatNumber(val, 1) : '—'),
            },
        ],
    },
    {
        title: 'Estimasi Biomassa Ikan (gram)',
        children: [
            {
                title: 'Kolam B (ADM)',
                dataIndex: 'bioA',
                key: 'bioA',
                align: 'right',
                render: (val) => (val !== undefined && val !== null ? formatNumber(val, 1) : '—'),
            },
            {
                title: 'Kolam A (Kontrol)',
                dataIndex: 'bioB',
                key: 'bioB',
                align: 'right',
                render: (val) => (val !== undefined && val !== null ? formatNumber(val, 1) : '—'),
            },
        ],
    },
    {
        title: 'FCR Saat Ini',
        children: [
            {
                title: 'Kolam B (ADM)',
                dataIndex: 'fcrA',
                key: 'fcrA',
                align: 'center',
                render: (val) => (
                    <Text strong style={{ color: COLOR_ADM }}>
                        {val !== undefined && val !== null ? formatNumber(val, 2) : '—'}
                    </Text>
                ),
            },
            {
                title: 'Kolam A (Kontrol)',
                dataIndex: 'fcrB',
                key: 'fcrB',
                align: 'center',
                render: (val) => (
                    <Text strong style={{ color: COLOR_KONTROL }}>
                        {val !== undefined && val !== null ? formatNumber(val, 2) : '—'}
                    </Text>
                ),
            },
        ],
    },
];

// --- 2. KOMPONEN CHART GARIS GANDA ---
const MiniDualLineChart = ({ data, title, unit = '', latestAdm, latestKontrol }) => {
    const config = {
        data,
        xField: 'time',
        yField: 'value',
        colorField: 'type',
        shapeField: 'smooth',
        height: 165,
        autoFit: true,
        legend: false,
        scale: {
            color: { domain: [LABEL_ADM, LABEL_KONTROL], range: [COLOR_ADM, COLOR_KONTROL] },
            y: { nice: true, zero: false },
        },
        style: {
            lineWidth: 2,
        },
        axis: {
            x: { title: false, tickCount: 5, labelFormatter: formatJam, labelFontSize: 10, labelFill: '#5b5e8d' },
            y: { title: false, labelFontSize: 10, labelFill: '#5b5e8d', gridStroke: '#e4e6f5', gridLineDash: [3, 3] },
        },
        tooltip: {
            title: (d) => `${formatJam(d.time)} WITA`,
            items: [(d) => ({ name: d.type, value: `${d.value} ${unit}`.trim() })],
        },
    };
    return (
        <div className="sf-chart-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 4 }}>
                <span className="sf-metric-label">{title}</span>
                <Space size={8} style={{ fontSize: 11 }}>
                    {latestAdm !== null && latestAdm !== undefined && (
                        <span className="sf-mono" style={{ color: COLOR_ADM, fontWeight: 600 }}>
                            B: {latestAdm}
                        </span>
                    )}
                    {latestKontrol !== null && latestKontrol !== undefined && (
                        <span className="sf-mono" style={{ color: COLOR_KONTROL, fontWeight: 600 }}>
                            A: {latestKontrol}
                        </span>
                    )}
                </Space>
            </div>
            {data.length ? (
                <Line {...config} />
            ) : (
                <EmptyState height={165} title="Belum Ada Data" description="Menunggu histori sensor 24 jam" />
            )}
        </div>
    );
};

// Helper pengelompokan data FCR dari respons /api/sampling
const parseSamplingRows = (rawData) => {
    const grouped = {};
    (Array.isArray(rawData) ? rawData : []).forEach((item) => {
        const w = item.minggu_ke;
        if (!grouped[w]) {
            grouped[w] = { key: String(w), week: String(w) };
        }
        const isAdm = /adm|perlakuan/i.test(item.kolam);
        if (isAdm) {
            grouped[w].feedA = item.jumlah_pakan;
            grouped[w].bioA = item.berat_akhir;
            grouped[w].fcrA = item.fcr;
            grouped[w].startDateA = item.start_date;
            grouped[w].endDateA = item.end_date;
        } else {
            grouped[w].feedB = item.jumlah_pakan;
            grouped[w].bioB = item.berat_akhir;
            grouped[w].fcrB = item.fcr;
        }
    });
    return Object.values(grouped).sort((a, b) => Number(a.week) - Number(b.week));
};

const Analysis = () => {
    const [form] = Form.useForm();
    const [feedForm] = Form.useForm();
    const [loadingForm, setLoadingForm] = useState(false);
    const [loadingManualFeed, setLoadingManualFeed] = useState(false);
    const [fetchError, setFetchError] = useState(null);

    // Inisialisasi langsung dari cache jika tersedia agar tampil instan (< 0.1 detik)
    const cachedAdm = getCachedData('/api/sensor/history/adm')?.data;
    const cachedKontrol = getCachedData('/api/sensor/history/kontrol')?.data;
    const cachedLogs = getCachedData('/api/feeding-log')?.data;
    const cachedSampling = getCachedData('/api/sampling')?.data;

    const [fcrTableData, setFcrTableData] = useState(() =>
        Array.isArray(cachedSampling) ? parseSamplingRows(cachedSampling) : []
    );
    const [loadingTable, setLoadingTable] = useState(() => !Array.isArray(cachedSampling));

    // State data riil Section A (sensor kedua kolam) & Section B (feeding log)
    const [sensorHistoryAdm, setSensorHistoryAdm] = useState(() => cachedAdm || {});
    const [sensorHistoryKontrol, setSensorHistoryKontrol] = useState(() => cachedKontrol || {});
    const [feedingLogs, setFeedingLogs] = useState(() => (Array.isArray(cachedLogs) ? cachedLogs : []));
    const [dateOverrides, setDateOverrides] = useState(() => loadDateOverrides());
    const [loadingWater, setLoadingWater] = useState(() => !(cachedAdm || cachedKontrol));
    const [loadingFeed, setLoadingFeed] = useState(() => !Array.isArray(cachedLogs));

    // Section A: histori sensor riil Kolam B (ADM) & Kolam A (Kontrol) secara paralel & independen
    const fetchSensorHistory = useCallback(async (forceRefresh = false) => {
        const reqAdm = api
            .get('/api/sensor/history/adm', { forceRefresh })
            .then((res) => {
                if (res.data?.status === 'success') {
                    setSensorHistoryAdm(res.data.data || {});
                    setLoadingWater(false);
                }
            })
            .catch(() => {});

        const reqKontrol = api
            .get('/api/sensor/history/kontrol', { forceRefresh })
            .then((res) => {
                if (res.data?.status === 'success') {
                    setSensorHistoryKontrol(res.data.data || {});
                    setLoadingWater(false);
                }
            })
            .catch(() => {});

        await Promise.allSettled([reqAdm, reqKontrol]);
        setLoadingWater(false);
    }, []);

    // Section B: riwayat pemberian pakan
    const fetchFeedingLogs = useCallback(async (forceRefresh = false) => {
        try {
            const res = await api.get('/api/feeding-log', { forceRefresh });
            setLoadingFeed(false);
            if (res.data.status === 'success') {
                const list = Array.isArray(res.data.data) ? res.data.data : [];
                setFeedingLogs(list);
                return list;
            }
        } catch {
            setLoadingFeed(false);
        }
        return [];
    }, []);

    // Olah data sensor -> rata-rata per jam untuk Kolam B (ADM) dan Kolam A (Kontrol)
    const waterData = useMemo(() => {
        const result = {};
        let latestTimestamp = null;
        WATER_PARAMS.forEach((param) => {
            const hourlyAdm = toHourlySeries(sensorHistoryAdm?.[param.key], param.decimals);
            const hourlyKontrol = toHourlySeries(sensorHistoryKontrol?.[param.key], param.decimals);
            const lastHourAdm = hourlyAdm.length ? hourlyAdm[hourlyAdm.length - 1].hour : null;
            const lastHourKontrol = hourlyKontrol.length ? hourlyKontrol[hourlyKontrol.length - 1].hour : null;
            const maxHour = Math.max(lastHourAdm || 0, lastHourKontrol || 0);
            if (maxHour > 0 && (!latestTimestamp || maxHour > latestTimestamp)) {
                latestTimestamp = maxHour;
            }
            result[param.key] = {
                chart: buildWaterChartData(hourlyAdm, hourlyKontrol),
                latestAdm: hourlyAdm.length ? hourlyAdm[hourlyAdm.length - 1].value : null,
                latestKontrol: hourlyKontrol.length ? hourlyKontrol[hourlyKontrol.length - 1].value : null,
            };
        });
        result.latestTimestamp = latestTimestamp ? new Date(latestTimestamp) : null;
        return result;
    }, [sensorHistoryAdm, sensorHistoryKontrol]);

    // Kesimpulan kualitas air berdasarkan data riil kedua kolam
    const waterInsight = useMemo(() => {
        const availAdm = WATER_PARAMS.filter((p) => waterData[p.key]?.latestAdm !== null);
        const availKontrol = WATER_PARAMS.filter((p) => waterData[p.key]?.latestKontrol !== null);

        if (availAdm.length === 0 && availKontrol.length === 0) {
            return { type: 'info', text: 'Belum ada data sensor Kolam A (Kontrol) maupun Kolam B (ADM) dalam 24 jam terakhir.' };
        }

        const issues = [];
        availAdm.forEach((p) => {
            const v = waterData[p.key].latestAdm;
            const [min, max] = NORMAL_RANGE[p.key];
            if (v < min || v > max) {
                issues.push(`Kolam B (ADM) ${p.name}: ${v} ${p.unit}`.trim() + ` (normal ${min}–${max})`);
            }
        });
        availKontrol.forEach((p) => {
            const v = waterData[p.key].latestKontrol;
            const [min, max] = NORMAL_RANGE[p.key];
            if (v < min || v > max) {
                issues.push(`Kolam A (Kontrol) ${p.name}: ${v} ${p.unit}`.trim() + ` (normal ${min}–${max})`);
            }
        });

        if (issues.length === 0) {
            return {
                type: 'success',
                text: 'Kualitas air Kolam A (Kontrol) dan Kolam B (ADM) dalam 24 jam terakhir berada dalam rentang optimal (Suhu 24–32 °C, DO 4–8 mg/L, pH 6.5–8.5, TDS 400–1500 ppm).',
            };
        }
        return {
            type: 'warning',
            text: `Parameter di luar rentang normal: ${issues.join(', ')}.`,
        };
    }, [waterData]);

    // Olah feeding log -> akumulasi pakan harian riil
    const { days: feedDays, totalsKontrol } = useMemo(
        () => buildDailyFeed(feedingLogs, dateOverrides),
        [feedingLogs, dateOverrides]
    );

    const feedChartData = useMemo(
        () =>
            feedDays.flatMap((d) => [
                { day: shortDateLabel(d.key), type: LABEL_ADM, value: d.feedAdm },
                { day: shortDateLabel(d.key), type: LABEL_KONTROL, value: d.feedKontrol },
            ]),
        [feedDays]
    );

    const feedSummary = useMemo(() => {
        const n = feedDays.length;
        const totalAdm = feedDays.reduce((s, d) => s + d.feedAdm, 0);
        const totalKontrol = feedDays.reduce((s, d) => s + d.feedKontrol, 0);
        const saving = totalKontrol - totalAdm;
        const todayKey = dateKeyWita(new Date());
        const todayKontrol = totalsKontrol.get(todayKey) || 0;
        return {
            days: n,
            totalAdm,
            totalKontrol,
            avgAdm: n ? totalAdm / n : 0,
            avgKontrol: n ? totalKontrol / n : 0,
            minAdm: n ? Math.min(...feedDays.map((d) => d.feedAdm)) : 0,
            maxAdm: n ? Math.max(...feedDays.map((d) => d.feedAdm)) : 0,
            minKontrol: n ? Math.min(...feedDays.map((d) => d.feedKontrol)) : 0,
            maxKontrol: n ? Math.max(...feedDays.map((d) => d.feedKontrol)) : 0,
            saving,
            savingPct: totalKontrol > 0 ? (saving / totalKontrol) * 100 : 0,
            todayKontrol,
        };
    }, [feedDays, totalsKontrol]);

    // Handler input manual pakan harian Kolam A (Kontrol)
    const onFinishManualFeedKontrol = async (values) => {
        const gram = round(Number(values.jumlahPakanKontrol), 1);
        if (!gram || gram <= 0) {
            message.warning('Masukkan jumlah pakan harian Kolam A yang valid (> 0 gram).');
            return;
        }

        setLoadingManualFeed(true);
        try {
            const rawDate = values.tanggal?.toDate ? values.tanggal.toDate() : new Date(values.tanggal || Date.now());
            const selectedDateKey = dateKeyWita(rawDate);
            const timestampIso = `${selectedDateKey}T04:00:00.000Z`;

            const prevKeys = new Set(
                feedingLogs.map((item) => item?.id || item?.key || item?.timestamp_iso || item?.timestamp).filter(Boolean)
            );

            const suhuVal = waterData.suhu?.latestKontrol ?? 30.0;
            const doVal = waterData.do?.latestKontrol ?? 6.0;
            const phVal = waterData.ph?.latestKontrol ?? 7.5;
            const tdsVal = waterData.tds?.latestKontrol ?? 500.0;

            await api.post('/api/feeding-log', {
                pond_type: 'kontrol',
                target_pakan: gram,
                jumlah_pakan: gram,
                durasi_servo: 0,
                status: 'Berhasil',
                tanggal: selectedDateKey,
                timestamp: timestampIso,
                timestamp_iso: timestampIso,
                suhu: Number(suhuVal),
                do: Number(doVal),
                ph: Number(phVal),
                tds: Number(tdsVal),
            });

            const updatedList = await fetchFeedingLogs(true);

            const newlyCreated = updatedList.find((item) => {
                const k = item?.id || item?.key || item?.timestamp_iso || item?.timestamp;
                return k && !prevKeys.has(k) && isControlPond(item.pondType || item.pond_type);
            });
            if (newlyCreated) {
                const newKey = newlyCreated.id || newlyCreated.key || newlyCreated.timestamp_iso || newlyCreated.timestamp;
                saveDateOverride(newKey, selectedDateKey);
                setDateOverrides(loadDateOverrides());
            }

            message.success(`Pakan harian Kolam A (Kontrol) sebesar ${formatNumber(gram, 1)} g untuk tanggal ${shortDateLabel(selectedDateKey)} berhasil disimpan.`);
            feedForm.resetFields(['jumlahPakanKontrol']);
        } catch (error) {
            const errDetail = error.response?.data?.detail || 'Gagal menyimpan data pakan harian Kolam A.';
            message.error(errDetail);
        } finally {
            setLoadingManualFeed(false);
        }
    };

    // Ringkasan evaluasi akhir FCR & akumulasi pakan/biomassa terbaru
    const fcrSummary = useMemo(() => {
        if (!fcrTableData || fcrTableData.length === 0) {
            return { feedA: null, feedB: null, bioA: null, bioB: null, fcrA: null, fcrB: null };
        }
        const latestRow = fcrTableData[fcrTableData.length - 1];
        return {
            feedA: latestRow.feedA ?? null,
            feedB: latestRow.feedB ?? null,
            bioA: latestRow.bioA ?? null,
            bioB: latestRow.bioB ?? null,
            fcrA: latestRow.fcrA ?? null,
            fcrB: latestRow.fcrB ?? null,
        };
    }, [fcrTableData]);

    // Fungsi untuk menarik data sampling FCR dari database (tanpa estimasi dummy)
    const fetchFCRData = useCallback(async (forceRefresh = false) => {
        try {
            const response = await api.get('/api/sampling', { forceRefresh });
            setLoadingTable(false);
            if (response.data.status === 'success') {
                setFetchError(null);
                const rawData = response.data.data;
                const baseWeight = (Array.isArray(rawData) && rawData.length > 0 && rawData[0]?.berat_awal) ? Number(rawData[0].berat_awal) : 800.0;

                const sortedRows = parseSamplingRows(rawData);
                setFcrTableData(sortedRows);

                const maxWeek = sortedRows.length > 0 ? Math.max(...sortedRows.map(d => Number(d.week) || 0)) : 0;
                form.setFieldsValue({
                    minggu: String(maxWeek + 1),
                    kolam: 'adm',
                    beratAwal: baseWeight
                });
            }
        } catch {
            setFetchError('Sebagian data evaluasi gagal dimuat dari server.');
            setLoadingTable(false);
        }
    }, [form]);

    const handleRefreshAll = () => {
        setFetchError(null);
        fetchFCRData(true);
        fetchSensorHistory(true);
        fetchFeedingLogs(true);
    };

    useEffect(() => {
        const initTimeout = setTimeout(() => {
            fetchFCRData();
            fetchSensorHistory();
            fetchFeedingLogs();
        }, 0);

        const interval = setInterval(() => {
            fetchSensorHistory();
            fetchFeedingLogs();
        }, 300000);
        return () => {
            clearTimeout(initTimeout);
            clearInterval(interval);
        };
    }, [fetchFCRData, fetchSensorHistory, fetchFeedingLogs]);

    // Hitung otomatis akumulasi pakan Kolam A (Kontrol) saat pengguna memilih rentang tanggal di Section C
    const handleKontrolDateRangeChange = (dates) => {
        if (!dates || dates.length !== 2 || !dates[0] || !dates[1]) return;
        const startKey = dateKeyWita(dates[0].toDate ? dates[0].toDate() : new Date(dates[0]));
        const endKey = dateKeyWita(dates[1].toDate ? dates[1].toDate() : new Date(dates[1]));
        let sum = 0;
        totalsKontrol.forEach((val, key) => {
            if (key >= startKey && key <= endKey) {
                sum += val;
            }
        });
        if (sum > 0) {
            form.setFieldsValue({ jumlahPakan: round(sum, 1) });
        }
    };

    const onFinishSampling = async (values) => {
        if (Number(values.beratAkhir) <= Number(values.beratAwal)) {
            message.error('Pertambahan biomassa nol atau negatif. Berat akhir harus lebih besar dari berat awal.');
            return;
        }

        setLoadingForm(true);
        try {
            const isAdm = values.kolam === 'adm';
            const payload = {
                minggu_ke: parseInt(values.minggu),
                kolam: isAdm ? 'adm' : 'kontrol',
                berat_awal: Number(values.beratAwal),
                berat_akhir: Number(values.beratAkhir)
            };

            if (isAdm) {
                if (values.dateRange && values.dateRange.length === 2) {
                    const start = values.dateRange[0]?.toDate ? values.dateRange[0].toDate() : new Date(values.dateRange[0]);
                    const end = values.dateRange[1]?.toDate ? values.dateRange[1].toDate() : new Date(values.dateRange[1]);
                    payload.tgl_mulai = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0)).toISOString();
                    payload.tgl_akhir = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)).toISOString();
                } else if (values.jumlahPakan !== undefined && values.jumlahPakan !== null) {
                    payload.jumlah_pakan = Number(values.jumlahPakan);
                } else {
                    message.warning('Harap pilih rentang tanggal log pakan untuk akumulasi otomatis Kolam B (ADM).');
                    setLoadingForm(false);
                    return;
                }
            } else {
                if (values.jumlahPakan === undefined || values.jumlahPakan === null || Number(values.jumlahPakan) <= 0) {
                    message.warning('Harap masukkan jumlah pakan aktual (positif) untuk Kolam A (Kontrol).');
                    setLoadingForm(false);
                    return;
                }
                payload.jumlah_pakan = Number(values.jumlahPakan);
            }

            const response = await api.post('/api/sampling', payload);
            if (response.data.status === 'success') {
                const totalFeedStr = response.data.total_pakan !== undefined ? ` (~${response.data.total_pakan} g pakan)` : '';
                message.success(`Data sampling tersimpan di Firestore. Nilai FCR: ${response.data.fcr}${totalFeedStr}`);
                form.resetFields(['beratAkhir', 'jumlahPakan', 'dateRange', 'kontrolDateRange']);
                fetchFCRData(true);
            }
        } catch (error) {
            const errDetail = error.response?.data?.detail || 'Gagal menyimpan data sampling.';
            message.error(errDetail);
        } finally {
            setLoadingForm(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {fetchError && (
                <ErrorState
                    title="Peringatan Sinkronisasi Data"
                    description={fetchError}
                    onRetry={handleRefreshAll}
                />
            )}

            {/* HEADER PAGE */}
            <div className="sf-page-header">
                <div>
                    <span className="sf-section-label">EVALUASI ILMIAH & BUSINESS INTELLIGENCE</span>
                    <Title level={4} style={{ margin: '0 0 4px 0' }}>
                        Analisis Komparatif Kolam B (ADM) vs Kolam A (Kontrol)
                    </Title>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                        Evaluasi sistematis parameter fisika-kimia air, konsumsi pakan harian, dan rasio konversi pakan (FCR) berbasis data riil.
                    </Text>
                </div>
                <Space size="small" wrap>
                    <DataFreshnessBadge timestamp={waterData.latestTimestamp} />
                    <Button size="small" icon={<ReloadOutlined />} onClick={handleRefreshAll}>
                        Segarkan Semua
                    </Button>
                </Space>
            </div>

            {/* SECTION A: TREN KUALITAS AIR MAKRO */}
            <Card
                title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <Space size={8}>
                            <span>A. Tren Kualitas Air Makro (Rata-Rata per Jam • 24 Jam Terakhir)</span>
                            <Tooltip title="Membandingkan rata-rata per jam dari sensor riil Kolam B (ADM) dan Kolam A (Kontrol)">
                                <InfoCircleOutlined style={{ color: 'var(--text-muted)' }} />
                            </Tooltip>
                        </Space>
                        <Space size="middle" wrap>
                            <Space size={6}>
                                <span style={{ display: 'inline-block', width: 16, height: 3, background: COLOR_ADM, borderRadius: 2 }} />
                                <Text style={{ fontSize: 12 }}>{LABEL_ADM}</Text>
                            </Space>
                            <Space size={6}>
                                <span style={{ display: 'inline-block', width: 16, height: 3, background: COLOR_KONTROL, borderRadius: 2 }} />
                                <Text style={{ fontSize: 12 }}>{LABEL_KONTROL}</Text>
                            </Space>
                        </Space>
                    </div>
                }
            >
                <Spin spinning={loadingWater}>
                    <Row gutter={[16, 16]}>
                        {WATER_PARAMS.map((param) => (
                            <Col key={param.key} xs={24} sm={12} lg={6}>
                                <MiniDualLineChart
                                    data={waterData[param.key].chart}
                                    title={param.title}
                                    unit={param.unit}
                                    latestAdm={waterData[param.key].latestAdm}
                                    latestKontrol={waterData[param.key].latestKontrol}
                                />
                            </Col>
                        ))}
                    </Row>
                </Spin>

                <Alert
                    message={waterInsight.text}
                    type={waterInsight.type}
                    showIcon
                    icon={waterInsight.type === 'success' ? <CheckCircleOutlined /> : undefined}
                    style={{ marginTop: 16 }}
                />
            </Card>

            {/* SECTION B: ANALISIS PEMBERIAN PAKAN & INPUT HARIAN KOLAM A */}
            <Card title="B. Analisis Pemberian Pakan & Pencatatan Pakan Harian Kolam A (Kontrol)">
                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={15}>
                        <div className="sf-chart-box" style={{ padding: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <span className="sf-metric-label">Kurva Akumulasi Pakan Harian (gram/hari)</span>
                                <Text type="secondary" style={{ fontSize: 12 }}>Periode: {feedSummary.days} Hari Tercatat</Text>
                            </div>
                            <Spin spinning={loadingFeed}>
                                {feedChartData.length ? (
                                    <Line
                                        data={feedChartData}
                                        xField="day"
                                        yField="value"
                                        colorField="type"
                                        height={260}
                                        autoFit
                                        scale={{
                                            color: { domain: [LABEL_ADM, LABEL_KONTROL], range: [COLOR_ADM, COLOR_KONTROL] },
                                            y: { nice: true, zero: true },
                                        }}
                                        style={{
                                            lineWidth: 2,
                                        }}
                                        point={{ sizeField: 3 }}
                                        legend={{ color: { position: 'top', layout: { justifyContent: 'center' } } }}
                                        axis={{
                                            x: { title: false, labelFontSize: 10, labelFill: '#5b5e8d', labelAutoHide: true, labelAutoRotate: false },
                                            y: { title: false, labelFontSize: 10, labelFill: '#5b5e8d', gridStroke: '#e4e6f5', gridLineDash: [3, 3] },
                                        }}
                                        tooltip={{
                                            title: (d) => `Tanggal ${d.day}`,
                                            items: [(d) => ({ name: d.type, value: `${formatNumber(d.value, 1)} g` })],
                                        }}
                                    />
                                ) : (
                                    <EmptyState
                                        height={260}
                                        title="Belum Ada Data Pemberian Pakan"
                                        description="Grafik akan terbentuk setelah ada log pakan Kolam B (ADM) atau input pakan harian Kolam A (Kontrol)."
                                    />
                                )}
                            </Spin>
                        </div>

                        <Alert
                            message={
                                feedSummary.days
                                    ? `Pakan Kolam B (ADM) berfluktuasi antara ${formatNumber(feedSummary.minAdm, 1)}–${formatNumber(feedSummary.maxAdm, 1)} g/hari mengikuti kualitas air, sedangkan Kolam A (Kontrol) tercatat ${formatNumber(feedSummary.minKontrol, 1)}–${formatNumber(feedSummary.maxKontrol, 1)} g/hari dari input aktual harian.`
                                    : 'Belum ada event pemberian pakan berstatus Berhasil yang tercatat.'
                            }
                            type="info"
                            showIcon
                            style={{ marginTop: 16 }}
                        />
                    </Col>

                    <Col xs={24} lg={9}>
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {/* FORM INPUT MANUAL PAKAN HARIAN KOLAM A (KONTROL) */}
                            <div
                                style={{
                                    background: 'var(--bg-subtle)',
                                    padding: '16px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-subtle)',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
                                    <Space size={6}>
                                        <PlusCircleOutlined style={{ color: COLOR_KONTROL }} />
                                        <Text strong style={{ fontSize: 13 }}>
                                            Input Pakan Harian Kolam A (Kontrol)
                                        </Text>
                                    </Space>
                                    <Tag color="orange" style={{ margin: 0 }}>
                                        Hari ini: {formatNumber(feedSummary.todayKontrol, 1)} g
                                    </Tag>
                                </div>

                                <Form
                                    form={feedForm}
                                    layout="vertical"
                                    onFinish={onFinishManualFeedKontrol}
                                    initialValues={{ tanggal: dayjs() }}
                                >
                                    <Row gutter={12}>
                                        <Col xs={24} sm={11}>
                                            <Form.Item
                                                name="tanggal"
                                                label="Tanggal Pemberian"
                                                rules={[{ required: true, message: 'Pilih tanggal' }]}
                                                style={{ marginBottom: 12 }}
                                            >
                                                <DatePicker
                                                    style={{ width: '100%' }}
                                                    format="DD/MM/YYYY"
                                                    allowClear={false}
                                                    suffixIcon={<CalendarOutlined />}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={13}>
                                            <Form.Item
                                                name="jumlahPakanKontrol"
                                                label="Jumlah Pakan Kolam A"
                                                rules={[{ required: true, message: 'Masukkan pakan (g)' }]}
                                                style={{ marginBottom: 12 }}
                                            >
                                                <InputNumber
                                                    style={{ width: '100%' }}
                                                    min={0.1}
                                                    step={10}
                                                    placeholder="Contoh: 1000"
                                                    addonAfter="gram"
                                                />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                    <Button
                                        type="primary"
                                        htmlType="submit"
                                        icon={<SaveOutlined />}
                                        loading={loadingManualFeed}
                                        block
                                    >
                                        Simpan Pakan Harian Kolam A
                                    </Button>
                                </Form>
                            </div>

                            {/* KARTU RINGKASAN PAKAN */}
                            <Card type="inner" loading={loadingFeed} title={<><ExperimentOutlined /> Ringkasan Konsumsi Pakan ({feedSummary.days} Hari)</>}>
                                <Row gutter={16}>
                                    <Col span={12}>
                                        <Text strong style={{ color: COLOR_ADM }}>Kolam B (ADM)</Text>
                                        <Divider style={{ margin: '8px 0' }} />
                                        <Statistic title="Total Pakan" value={formatNumber(feedSummary.totalAdm, 1)} suffix="g" valueStyle={{ color: COLOR_ADM, fontSize: 18, fontWeight: 700 }} />
                                        <Statistic title="Rata-rata / Hari" value={formatNumber(feedSummary.avgAdm, 1)} suffix="g" valueStyle={{ fontSize: 14 }} style={{ marginTop: 8 }} />
                                    </Col>
                                    <Col span={12} style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: 16 }}>
                                        <Text strong style={{ color: COLOR_KONTROL }}>Kolam A (Kontrol)</Text>
                                        <Divider style={{ margin: '8px 0' }} />
                                        <Statistic title="Total Pakan" value={formatNumber(feedSummary.totalKontrol, 1)} suffix="g" valueStyle={{ fontSize: 18, color: COLOR_KONTROL, fontWeight: 700 }} />
                                        <Statistic title="Rata-rata / Hari" value={formatNumber(feedSummary.avgKontrol, 1)} suffix="g" valueStyle={{ fontSize: 14 }} style={{ marginTop: 8 }} />
                                    </Col>
                                </Row>
                                {feedSummary.days > 0 && feedSummary.totalKontrol > 0 && (
                                    <div
                                        style={{
                                            marginTop: 14,
                                            padding: '10px 12px',
                                            borderRadius: 'var(--radius-sm)',
                                            background: feedSummary.saving >= 0 ? 'var(--status-success-bg)' : 'var(--status-warning-bg)',
                                            border: `1px solid ${feedSummary.saving >= 0 ? 'var(--status-success-border)' : 'var(--status-warning-border)'}`,
                                        }}
                                    >
                                        <Text style={{ color: feedSummary.saving >= 0 ? 'var(--status-success)' : 'var(--status-warning)', fontSize: 12 }}>
                                            <CheckCircleOutlined />{' '}
                                            {feedSummary.saving >= 0 ? (
                                                <>Kolam B (ADM) menghemat <b>{formatNumber(feedSummary.saving, 1)} g</b> pakan ({formatNumber(feedSummary.savingPct, 2)}%) dibanding Kolam A (Kontrol).</>
                                            ) : (
                                                <>Kolam B (ADM) memberi <b>{formatNumber(Math.abs(feedSummary.saving), 1)} g</b> pakan ({formatNumber(Math.abs(feedSummary.savingPct), 2)}%) lebih banyak dibanding Kolam A (Kontrol).</>
                                            )}
                                        </Text>
                                    </div>
                                )}
                            </Card>
                        </Space>
                    </Col>
                </Row>
            </Card>

            {/* SECTION C: SAMPLING MINGGUAN & FCR */}
            <Card title="C. Sampling Biomassa Mingguan (20 Ekor per Kolam) & Evaluasi FCR">
                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={7}>
                        <div style={{ background: 'var(--bg-subtle)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                            <Text strong style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                                Input Sampling Mingguan & Kalkulasi FCR
                            </Text>
                            <Form form={form} layout="vertical" onFinish={onFinishSampling} initialValues={{ minggu: '1', kolam: 'adm', beratAwal: 800.0 }}>
                                <Row gutter={12}>
                                    <Col span={11}>
                                        <Form.Item name="minggu" label="Minggu ke-">
                                            <Select options={WEEK_OPTIONS} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={13}>
                                        <Form.Item name="kolam" label="Kolam">
                                            <Select>
                                                <Option value="adm">Kolam B (ADM)</Option>
                                                <Option value="kontrol">Kolam A (Kontrol)</Option>
                                            </Select>
                                        </Form.Item>
                                    </Col>
                                </Row>
                                <Form.Item
                                    name="beratAwal"
                                    label="Biomassa Awal (gram)"
                                    tooltip="Biomassa awal saat tebar / awal siklus sampling"
                                    rules={[{ required: true, message: 'Masukkan berat awal' }]}
                                >
                                    <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} addonAfter="gram" />
                                </Form.Item>
                                <Form.Item
                                    name="beratAkhir"
                                    label="Biomassa Akhir Minggu Ini (gram)"
                                    tooltip="Total biomassa ikan hasil sampling minggu ini (harus lebih besar dari berat awal)"
                                    rules={[{ required: true, message: 'Masukkan berat akhir' }]}
                                >
                                    <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} addonAfter="gram" />
                                </Form.Item>

                                {/* Form adaptif berdasarkan tipe kolam */}
                                <Form.Item noStyle shouldUpdate={(prev, curr) => prev.kolam !== curr.kolam}>
                                    {({ getFieldValue }) => {
                                        const isAdm = getFieldValue('kolam') === 'adm';
                                        return isAdm ? (
                                            <div>
                                                <Form.Item
                                                    name="dateRange"
                                                    label="Rentang Log Pakan Kolam B (ADM)"
                                                    tooltip="Backend otomatis mengakumulasi log pakan berstatus Berhasil dari Firestore pada rentang ini"
                                                    rules={[{ required: true, message: 'Pilih rentang tanggal log pakan' }]}
                                                >
                                                    <DatePicker.RangePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                                                </Form.Item>
                                                <Alert
                                                    type="info"
                                                    showIcon
                                                    message="Akumulasi Otomatis Kolam B (ADM)"
                                                    description="Total pakan Kolam B (ADM) dihitung otomatis dari Firestore feeding_logs."
                                                    style={{ marginBottom: 16, fontSize: 12 }}
                                                />
                                            </div>
                                        ) : (
                                            <div>
                                                <Form.Item
                                                    name="kontrolDateRange"
                                                    label="Filter Rentang Log Kolam A (Opsional)"
                                                    tooltip="Pilih rentang tanggal untuk menjumlahkan otomatis pakan harian Kolam A yang telah diinput"
                                                >
                                                    <DatePicker.RangePicker
                                                        style={{ width: '100%' }}
                                                        format="DD/MM/YYYY"
                                                        onChange={handleKontrolDateRangeChange}
                                                    />
                                                </Form.Item>
                                                <Form.Item
                                                    name="jumlahPakan"
                                                    label="Jumlah Pakan Aktual Kolam A (gram)"
                                                    tooltip="Akumulasi total pakan yang diberikan untuk Kolam A (Kontrol)"
                                                    rules={[{ required: true, message: 'Masukkan total pakan Kolam A' }]}
                                                >
                                                    <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} addonAfter="gram" />
                                                </Form.Item>
                                                <Alert
                                                    type="warning"
                                                    showIcon
                                                    message="Pakan Aktual Kolam A (Kontrol)"
                                                    description="Pilih rentang tanggal di atas untuk mengisi otomatis dari input harian Kolam A, atau ketik langsung total pakannya."
                                                    style={{ marginBottom: 16, fontSize: 12 }}
                                                />
                                            </div>
                                        );
                                    }}
                                </Form.Item>

                                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} block loading={loadingForm}>
                                    Hitung & Simpan FCR
                                </Button>
                            </Form>
                        </div>
                    </Col>

                    <Col xs={24} lg={17}>
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {fcrTableData.length === 0 && !loadingTable ? (
                                <EmptyState
                                    height={220}
                                    title="Belum Ada Data Sampling Mingguan"
                                    description="Silakan isi form di samping untuk menyimpan hasil penimbangan sampling pertama."
                                />
                            ) : (
                                <Table
                                    columns={fcrColumns}
                                    dataSource={fcrTableData}
                                    loading={loadingTable}
                                    pagination={false}
                                    size="small"
                                    bordered
                                    scroll={{ x: 640 }}
                                    summary={() => {
                                        if (!fcrTableData || fcrTableData.length === 0) return null;
                                        return (
                                            <Table.Summary fixed>
                                                <Table.Summary.Row style={{ background: 'var(--bg-subtle)', fontWeight: 700 }}>
                                                    <Table.Summary.Cell index={0} align="center">
                                                        <Tooltip title="Nilai akumulasi pakan & biomassa ikan minggu terakhir serta evaluasi FCR kumulatif terkini">
                                                            <span style={{ cursor: 'help' }}>TERKINI</span>
                                                        </Tooltip>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={1} align="right">
                                                        {fcrSummary.feedA !== null ? formatNumber(fcrSummary.feedA, 1) : '—'}
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={2} align="right">
                                                        {fcrSummary.feedB !== null ? formatNumber(fcrSummary.feedB, 1) : '—'}
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={3} align="right">
                                                        {fcrSummary.bioA !== null ? formatNumber(fcrSummary.bioA, 1) : '—'}
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={4} align="right">
                                                        {fcrSummary.bioB !== null ? formatNumber(fcrSummary.bioB, 1) : '—'}
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={5} align="center">
                                                        <Text strong style={{ color: COLOR_ADM }}>
                                                            {fcrSummary.fcrA !== null ? formatNumber(fcrSummary.fcrA, 2) : '—'}
                                                        </Text>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={6} align="center">
                                                        <Text strong style={{ color: COLOR_KONTROL }}>
                                                            {fcrSummary.fcrB !== null ? formatNumber(fcrSummary.fcrB, 2) : '—'}
                                                        </Text>
                                                    </Table.Summary.Cell>
                                                </Table.Summary.Row>
                                            </Table.Summary>
                                        );
                                    }}
                                />
                            )}

                            {/* Kotak Metodologi FCR */}
                            <div
                                style={{
                                    background: 'var(--color-adm-bg)',
                                    border: '1px solid var(--color-adm-border)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: 12,
                                }}
                            >
                                <Space size={8}>
                                    <CalculatorOutlined style={{ color: COLOR_ADM }} />
                                    <Text style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <b>Rumus Evaluasi:</b> <span className="sf-mono">FCR = Total Pakan (g) / (Biomassa Akhir − Biomassa Awal) (g)</span>. Semakin rendah FCR, semakin efisien konversi pakan.
                                    </Text>
                                </Space>
                                {(fcrSummary.fcrA !== null || fcrSummary.fcrB !== null) && (
                                    <Space size="middle">
                                        <Tag color="blue" style={{ margin: 0 }}>
                                            FCR Kolam B (ADM): <b>{fcrSummary.fcrA !== null ? formatNumber(fcrSummary.fcrA, 2) : '—'}</b>
                                        </Tag>
                                        <Tag color="orange" style={{ margin: 0 }}>
                                            FCR Kolam A (Kontrol): <b>{fcrSummary.fcrB !== null ? formatNumber(fcrSummary.fcrB, 2) : '—'}</b>
                                        </Tag>
                                    </Space>
                                )}
                            </div>
                        </Space>
                    </Col>
                </Row>
            </Card>
        </div>
    );
};

export default Analysis;

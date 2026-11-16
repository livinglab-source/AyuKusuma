import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Card, Row, Col, Typography, Divider, Statistic, Space,
    Form, Select, InputNumber, Button, Table, message, Spin, Tag, Tooltip, DatePicker, Segmented, Popconfirm
} from 'antd';
import {
    InfoCircleOutlined, ExperimentOutlined, SaveOutlined,
    CalculatorOutlined, CheckCircleOutlined, PlusCircleOutlined, CalendarOutlined, ReloadOutlined,
    EditOutlined, DeleteOutlined
} from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import dayjs from 'dayjs';
import api, { getCachedData, invalidateCache } from '../api';
import { parseUtc, formatJamWita as formatJam, formatDateTimeWita, dateKeyWita } from '../utils/time';
import {
    isControlPondType as isControlPond,
    getStableLogKey,
    resolveLogDateKey,
    saveFeedingLogEdit,
    markFeedingLogDeleted,
    addLocalFeedingLog,
} from '../utils/feedingLogStorage';
import { EmptyState, ErrorState, DataFreshnessBadge } from '../components/SystemStates';

const { Title, Text } = Typography;
const { Option } = Select;

// --- 1. KONSTANTA & HELPER DATA RIIL ---
// Konsisten di seluruh aplikasi: Kolam A = Kontrol (Timer), Kolam B = Perlakuan (ADM)
const LABEL_KONTROL = 'Kolam A — Kontrol (Timer)';
const LABEL_ADM = 'Kolam B — Perlakuan (ADM)';
const COLOR_ADM = '#4649e5';
const COLOR_KONTROL = '#d97706';

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

// Ubah histori sensor [{time, value}] menjadi rata-rata berkala berdasarkan rentang waktu yang dipilih
const toHourlySeries = (arr, decimals, filterOptions = { mode: '24h' }) => {
    const validPoints = [];
    (Array.isArray(arr) ? arr : []).forEach((p) => {
        const dateObj = parseUtc(p?.time);
        const value = Number(p?.value);
        if (!dateObj || p?.value === null || p?.value === undefined || isNaN(value)) return;
        validPoints.push({ ms: dateObj.getTime(), value });
    });
    if (validPoints.length === 0) return [];

    let startCutoff;
    let endCutoff = Infinity;
    const maxTime = Math.max(...validPoints.map((p) => p.ms));

    if (filterOptions.mode === 'custom' && filterOptions.startMs && filterOptions.endMs) {
        startCutoff = filterOptions.startMs;
        endCutoff = filterOptions.endMs;
    } else {
        const hoursMap = { '24h': 24, '3d': 72, '7d': 168, '30d': 720 };
        const h = hoursMap[filterOptions.mode] || 24;
        startCutoff = maxTime - h * 3600000;
    }

    // Tentukan interval bucket (dalam ms) agar visualisasi grafik optimal dan representatif
    const spanMs = (endCutoff === Infinity ? maxTime : Math.min(maxTime, endCutoff)) - startCutoff;
    let bucketIntervalMs = 3600000; // 1 jam bawaan
    if (spanMs > 14 * 86400000) {
        bucketIntervalMs = 86400000; // 1 hari untuk rentang bulanan
    } else if (spanMs > 4 * 86400000) {
        bucketIntervalMs = 14400000; // 4 jam untuk rentang mingguan
    } else if (spanMs > 36 * 3600000) {
        bucketIntervalMs = 7200000; // 2 jam untuk rentang 3 hari
    }

    const buckets = new Map();
    validPoints.forEach(({ ms, value }) => {
        if (ms < startCutoff || ms > endCutoff) return;
        const bucketKey = Math.floor(ms / bucketIntervalMs) * bucketIntervalMs;
        const b = buckets.get(bucketKey) || { sum: 0, count: 0 };
        b.sum += value;
        b.count += 1;
        buckets.set(bucketKey, b);
    });

    return [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([timeMs, b]) => ({ timeMs, value: round(b.sum / b.count, decimals) }));
};

// Gabungkan data sensor riil Kolam B (ADM) dan Kolam A (Kontrol)
const buildWaterChartData = (hourlyAdm, hourlyKontrol) =>
    [
        ...hourlyAdm.map(({ timeMs, value }) => ({
            time: new Date(timeMs),
            type: LABEL_ADM,
            value,
        })),
        ...hourlyKontrol.map(({ timeMs, value }) => ({
            time: new Date(timeMs),
            type: LABEL_KONTROL,
            value,
        })),
    ].sort((a, b) => a.time - b.time);

// Akumulasi pakan harian riil dari feeding log (hanya event berstatus 'Berhasil', tanpa data dummy)
const buildDailyFeed = (logs) => {
    const totalsAdm = new Map();
    const totalsKontrol = new Map();

    (Array.isArray(logs) ? logs : []).forEach((item) => {
        if (item?.status !== 'Berhasil') return;
        const key = resolveLogDateKey(item);
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

// Konfigurasi Kolom Tabel Sampling FCR Mingguan (Mengakomodasi Kematian Ikan / D)
const fcrColumns = [
    { title: 'Minggu ke-', dataIndex: 'week', key: 'week', align: 'center', fixed: 'left', width: 95 },
    {
        title: 'Pakan Diberikan (F) (gram)',
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
        title: 'Biomassa Akhir (Wt) (gram)',
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
        title: 'Biomassa Mati (D) (gram)',
        children: [
            {
                title: 'Kolam B (ADM)',
                dataIndex: 'deathA',
                key: 'deathA',
                align: 'right',
                render: (val) => (val !== undefined && val !== null ? formatNumber(val, 1) : '0'),
            },
            {
                title: 'Kolam A (Kontrol)',
                dataIndex: 'deathB',
                key: 'deathB',
                align: 'right',
                render: (val) => (val !== undefined && val !== null ? formatNumber(val, 1) : '0'),
            },
        ],
    },
    {
        title: 'FCR Hasil Evaluasi',
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
const MiniDualLineChart = ({ data, title, unit = '', latestAdm, latestKontrol, isMultiDay = false }) => {
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
            x: {
                title: false,
                tickCount: 5,
                labelFormatter: (d) => {
                    const dt = new Date(d);
                    if (isNaN(dt.getTime())) return d;
                    if (isMultiDay) {
                        return `${dt.getDate()}/${dt.getMonth() + 1}`;
                    }
                    return formatJam(dt);
                },
                labelFontSize: 10,
                labelFill: '#5b5e8d',
            },
            y: { title: false, labelFontSize: 10, labelFill: '#5b5e8d', gridStroke: '#e4e6f5', gridLineDash: [3, 3] },
        },
        tooltip: {
            title: (d) => (isMultiDay ? `${formatDateTimeWita(d.time)} WITA` : `${formatJam(d.time)} WITA`),
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
                <EmptyState height={165} title="Belum Ada Data" description="Tidak ada titik sensor pada periode ini" />
            )}
        </div>
    );
};

// Helper pengelompokan data FCR dari respons /api/sampling (Mencakup Biomassa Mati / D & referensi item asli untuk Edit)
const parseSamplingRows = (rawData) => {
    const grouped = {};
    (Array.isArray(rawData) ? rawData : []).forEach((item) => {
        const w = item.minggu_ke;
        if (!grouped[w]) {
            grouped[w] = { key: String(w), week: String(w) };
        }
        const isAdm = /adm|perlakuan/i.test(item.kolam);
        const deadWeight = Number(item.berat_kematian ?? item.berat_mati) || 0;
        if (isAdm) {
            grouped[w].idA = item.id || `fcr-m${w}-adm`;
            grouped[w].rawA = item;
            grouped[w].w0A = item.berat_awal;
            grouped[w].feedA = item.jumlah_pakan;
            grouped[w].bioA = item.berat_akhir;
            grouped[w].deathA = deadWeight;
            grouped[w].jumlahMatiA = item.jumlah_mati || 0;
            grouped[w].fcrA = item.fcr;
            grouped[w].startDateA = item.start_date;
            grouped[w].endDateA = item.end_date;
        } else {
            grouped[w].idB = item.id || `fcr-m${w}-kontrol`;
            grouped[w].rawB = item;
            grouped[w].w0B = item.berat_awal;
            grouped[w].feedB = item.jumlah_pakan;
            grouped[w].bioB = item.berat_akhir;
            grouped[w].deathB = deadWeight;
            grouped[w].jumlahMatiB = item.jumlah_mati || 0;
            grouped[w].fcrB = item.fcr;
            grouped[w].startDateB = item.start_date;
            grouped[w].endDateB = item.end_date;
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

    const [rawSamplingList, setRawSamplingList] = useState(() =>
        Array.isArray(cachedSampling) ? cachedSampling : []
    );
    const [fcrTableData, setFcrTableData] = useState(() =>
        Array.isArray(cachedSampling) ? parseSamplingRows(cachedSampling) : []
    );
    const [loadingTable, setLoadingTable] = useState(() => !Array.isArray(cachedSampling));
    const [samplingMode, setSamplingMode] = useState('add'); // 'add' | 'edit'
    const [editingSamplingId, setEditingSamplingId] = useState(null);

    // State data riil Section A (sensor kedua kolam) & Section B (feeding log)
    const [sensorHistoryAdm, setSensorHistoryAdm] = useState(() => cachedAdm || {});
    const [sensorHistoryKontrol, setSensorHistoryKontrol] = useState(() => cachedKontrol || {});
    const [feedingLogs, setFeedingLogs] = useState(() => (Array.isArray(cachedLogs) ? cachedLogs : []));
    const [loadingWater, setLoadingWater] = useState(() => !(cachedAdm || cachedKontrol));
    const [loadingFeed, setLoadingFeed] = useState(() => !Array.isArray(cachedLogs));

    // State Filter Waktu Makro Kualitas Air (Bisa dicek kapan saja: 24 Jam, 3 Hari, 7 Hari, 30 Hari, atau Rentang Kustom)
    const [waterPeriod, setWaterPeriod] = useState('24h'); // '24h' | '3d' | '7d' | '30d' | 'custom'
    const [waterCustomRange, setWaterCustomRange] = useState(() => [dayjs().subtract(7, 'day'), dayjs()]);

    // Hitung estimasi jam (hours) untuk query ke backend
    const activeWaterHours = useMemo(() => {
        if (waterPeriod === '3d') return 72;
        if (waterPeriod === '7d') return 168;
        if (waterPeriod === '30d') return 720;
        if (waterPeriod === 'custom' && waterCustomRange?.[0] && waterCustomRange?.[1]) {
            const start = waterCustomRange[0].toDate ? waterCustomRange[0].toDate() : new Date(waterCustomRange[0]);
            const end = waterCustomRange[1].toDate ? waterCustomRange[1].toDate() : new Date(waterCustomRange[1]);
            const diffHours = Math.ceil((end.getTime() - start.getTime()) / 3600000);
            return Math.max(24, Math.min(1440, diffHours + 24));
        }
        return 24;
    }, [waterPeriod, waterCustomRange]);

    const waterFilterOptions = useMemo(() => {
        if (waterPeriod === 'custom' && waterCustomRange?.[0] && waterCustomRange?.[1]) {
            const start = waterCustomRange[0].toDate ? waterCustomRange[0].toDate() : new Date(waterCustomRange[0]);
            const end = waterCustomRange[1].toDate ? waterCustomRange[1].toDate() : new Date(waterCustomRange[1]);
            return {
                mode: 'custom',
                startMs: new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0)).getTime(),
                endMs: new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)).getTime(),
            };
        }
        return { mode: waterPeriod };
    }, [waterPeriod, waterCustomRange]);

    const waterPeriodLabel = useMemo(() => {
        if (waterPeriod === '24h') return '24 jam terakhir';
        if (waterPeriod === '3d') return '3 hari terakhir';
        if (waterPeriod === '7d') return '7 hari terakhir';
        if (waterPeriod === '30d') return '30 hari terakhir';
        if (waterPeriod === 'custom' && waterCustomRange?.[0] && waterCustomRange?.[1]) {
            return `periode ${waterCustomRange[0].format('DD/MM/YYYY')} – ${waterCustomRange[1].format('DD/MM/YYYY')}`;
        }
        return 'periode terpilih';
    }, [waterPeriod, waterCustomRange]);

    // State form kelola (Input & Edit) Feeding Log Kolam B (ADM) & Kolam A (Kontrol)
    const [feedPond, setFeedPond] = useState('adm'); // 'adm' | 'kontrol'
    const [feedActionMode, setFeedActionMode] = useState('add'); // 'add' | 'edit'
    const [selectedEditKey, setSelectedEditKey] = useState('__DAILY_TOTAL__');
    const watchedFeedDate = Form.useWatch('tanggal', feedForm);

    // Section A: histori sensor riil Kolam B (ADM) & Kolam A (Kontrol) dengan parameter jam dinamis
    const fetchSensorHistory = useCallback(async (forceRefresh = false, hours = activeWaterHours) => {
        setLoadingWater(true);
        const reqAdm = api
            .get('/api/sensor/history/adm', { params: { hours }, forceRefresh })
            .then((res) => {
                if (res.data?.status === 'success') {
                    setSensorHistoryAdm(res.data.data || {});
                }
            })
            .catch(() => {});

        const reqKontrol = api
            .get('/api/sensor/history/kontrol', { params: { hours }, forceRefresh })
            .then((res) => {
                if (res.data?.status === 'success') {
                    setSensorHistoryKontrol(res.data.data || {});
                }
            })
            .catch(() => {});

        await Promise.allSettled([reqAdm, reqKontrol]);
        setLoadingWater(false);
    }, [activeWaterHours]);

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

    // Olah data sensor -> rata-rata per periode untuk Kolam B (ADM) dan Kolam A (Kontrol)
    const waterData = useMemo(() => {
        const result = {};
        let latestTimestamp = null;
        WATER_PARAMS.forEach((param) => {
            const hourlyAdm = toHourlySeries(sensorHistoryAdm?.[param.key], param.decimals, waterFilterOptions);
            const hourlyKontrol = toHourlySeries(sensorHistoryKontrol?.[param.key], param.decimals, waterFilterOptions);
            const lastHourAdm = hourlyAdm.length ? hourlyAdm[hourlyAdm.length - 1].timeMs : null;
            const lastHourKontrol = hourlyKontrol.length ? hourlyKontrol[hourlyKontrol.length - 1].timeMs : null;
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
    }, [sensorHistoryAdm, sensorHistoryKontrol, waterFilterOptions]);

    // Kesimpulan kualitas air dengan kontras tinggi (WCAG AAA)
    const waterInsight = useMemo(() => {
        const availAdm = WATER_PARAMS.filter((p) => waterData[p.key]?.latestAdm !== null);
        const availKontrol = WATER_PARAMS.filter((p) => waterData[p.key]?.latestKontrol !== null);

        if (availAdm.length === 0 && availKontrol.length === 0) {
            return {
                type: 'info',
                text: `Belum ada data sensor Kolam A (Kontrol) maupun Kolam B (ADM) dalam ${waterPeriodLabel}.`,
                node: (
                    <span>
                        Belum ada rekaman data sensor <strong style={{ color: COLOR_KONTROL }}>Kolam A (Kontrol)</strong> maupun{' '}
                        <strong style={{ color: COLOR_ADM }}>Kolam B (ADM)</strong> dalam {waterPeriodLabel}. Silakan ubah filter periode atau periksa koneksi gateway.
                    </span>
                ),
            };
        }

        const issues = [];
        availAdm.forEach((p) => {
            const v = waterData[p.key].latestAdm;
            const [min, max] = NORMAL_RANGE[p.key];
            if (v < min || v > max) {
                issues.push(`Kolam B (ADM) ${p.name}: ${v} ${p.unit} (normal ${min}–${max})`);
            }
        });
        availKontrol.forEach((p) => {
            const v = waterData[p.key].latestKontrol;
            const [min, max] = NORMAL_RANGE[p.key];
            if (v < min || v > max) {
                issues.push(`Kolam A (Kontrol) ${p.name}: ${v} ${p.unit} (normal ${min}–${max})`);
            }
        });

        if (issues.length === 0) {
            return {
                type: 'success',
                text: `Kualitas air Kolam A (Kontrol) dan Kolam B (ADM) dalam ${waterPeriodLabel} berada dalam rentang optimal (Suhu 24–32 °C, DO 4–8 mg/L, pH 6.5–8.5, TDS 400–1500 ppm).`,
                node: (
                    <span>
                        Kualitas air <strong style={{ color: COLOR_KONTROL }}>Kolam A (Kontrol)</strong> dan{' '}
                        <strong style={{ color: COLOR_ADM }}>Kolam B (ADM)</strong> dalam {waterPeriodLabel} berada dalam{' '}
                        <strong style={{ color: '#047857' }}>rentang optimal</strong> (Suhu 24–32 °C, DO 4–8 mg/L, pH 6.5–8.5, TDS 400–1500 ppm).
                    </span>
                ),
            };
        }
        return {
            type: 'warning',
            text: `Parameter di luar rentang normal pada ${waterPeriodLabel}: ${issues.join(', ')}.`,
            node: (
                <span>
                    <strong style={{ color: '#92400e' }}>Perhatian:</strong> Ditemukan parameter di luar rentang optimal pada {waterPeriodLabel}: {issues.join(', ')}.
                </span>
            ),
        };
    }, [waterData, waterPeriodLabel]);

    // Olah feeding log -> akumulasi pakan harian riil
    const { days: feedDays, totalsAdm, totalsKontrol } = useMemo(
        () => buildDailyFeed(feedingLogs),
        [feedingLogs]
    );

    const feedChartData = useMemo(
        () =>
            feedDays.flatMap((d) => [
                { day: shortDateLabel(d.key), type: LABEL_ADM, value: d.feedAdm },
                { day: shortDateLabel(d.key), type: LABEL_KONTROL, value: d.feedKontrol },
            ]),
        [feedDays]
    );

    const selectedFeedDateKey = useMemo(() => {
        if (!watchedFeedDate) return dateKeyWita(new Date());
        const d = watchedFeedDate?.toDate ? watchedFeedDate.toDate() : new Date(watchedFeedDate);
        return dateKeyWita(d);
    }, [watchedFeedDate]);

    const feedSummary = useMemo(() => {
        const n = feedDays.length;
        const totalAdm = feedDays.reduce((s, d) => s + d.feedAdm, 0);
        const totalKontrol = feedDays.reduce((s, d) => s + d.feedKontrol, 0);
        const saving = totalKontrol - totalAdm;
        const todayKey = dateKeyWita(new Date());
        const todayAdm = totalsAdm.get(todayKey) || 0;
        const todayKontrol = totalsKontrol.get(todayKey) || 0;
        const selectedDateAdm = totalsAdm.get(selectedFeedDateKey) || 0;
        const selectedDateKontrol = totalsKontrol.get(selectedFeedDateKey) || 0;
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
            todayAdm,
            todayKontrol,
            selectedDateAdm,
            selectedDateKontrol,
        };
    }, [feedDays, totalsAdm, totalsKontrol, selectedFeedDateKey]);

    // Daftar log untuk kolam aktif (feedPond) yang diurutkan (log pada tanggal terpilih berada di urutan teratas)
    const pondLogs = useMemo(() => {
        const isTargetKontrol = feedPond === 'kontrol';
        return (Array.isArray(feedingLogs) ? feedingLogs : [])
            .filter((item) => isControlPond(item.pondType || item.pond_type) === isTargetKontrol)
            .map((item) => ({
                ...item,
                _key: getStableLogKey(item),
                _dateKey: resolveLogDateKey(item) || '',
            }))
            .sort((a, b) => {
                const aMatch = a._dateKey === selectedFeedDateKey ? 1 : 0;
                const bMatch = b._dateKey === selectedFeedDateKey ? 1 : 0;
                if (aMatch !== bMatch) return bMatch - aMatch;
                return String(b.timestamp_iso || b.timestamp || b._dateKey).localeCompare(
                    String(a.timestamp_iso || a.timestamp || a._dateKey)
                );
            });
    }, [feedingLogs, feedPond, selectedFeedDateKey]);

    const logsOnSelectedDate = useMemo(
        () => pondLogs.filter((item) => item._dateKey === selectedFeedDateKey),
        [pondLogs, selectedFeedDateKey]
    );

    const activePondSelectedDateTotal = feedPond === 'adm' ? feedSummary.selectedDateAdm : feedSummary.selectedDateKontrol;

    // Sinkronkan nilai form saat mode edit atau target log berubah
    const populateEditFormFields = useCallback(
        (targetKey, dateKeyToUse = selectedFeedDateKey, currentPond = feedPond) => {
            const isTargetKontrol = currentPond === 'kontrol';
            if (targetKey === '__DAILY_TOTAL__') {
                const currentTotal = isTargetKontrol
                    ? totalsKontrol.get(dateKeyToUse) || 0
                    : totalsAdm.get(dateKeyToUse) || 0;
                feedForm.setFieldsValue({
                    jumlahPakanInput: currentTotal > 0 ? round(currentTotal, 1) : undefined,
                    targetPakanInput: currentTotal > 0 ? round(currentTotal, 1) : undefined,
                    durasiInput: !isTargetKontrol && currentTotal > 0 ? Math.max(1, Math.round(currentTotal / 15)) : 0,
                    statusInput: 'Berhasil',
                });
                return;
            }
            const found = pondLogs.find((item) => item._key === targetKey);
            if (found) {
                const dKey = found._dateKey || dateKeyToUse;
                const gramVal = round(Number(found.jumlahPakan ?? found.jumlah_pakan ?? 0), 1);
                const targetVal = round(Number(found.targetPakan ?? found.target_pakan ?? gramVal), 1);
                const durVal = Number(found.durasi ?? found.durasi_servo ?? 0);
                feedForm.setFieldsValue({
                    tanggal: dKey ? dayjs(dKey, 'YYYY-MM-DD') : dayjs(),
                    jumlahPakanInput: gramVal,
                    targetPakanInput: targetVal,
                    durasiInput: durVal,
                    statusInput: found.status === 'Gagal' ? 'Gagal' : 'Berhasil',
                });
            }
        },
        [feedForm, feedPond, pondLogs, selectedFeedDateKey, totalsAdm, totalsKontrol]
    );

    const handleFeedPondChange = (nextPond) => {
        setFeedPond(nextPond);
        setSelectedEditKey('__DAILY_TOTAL__');
        if (feedActionMode === 'edit') {
            populateEditFormFields('__DAILY_TOTAL__', selectedFeedDateKey, nextPond);
        }
    };

    const handleFeedModeChange = (nextMode) => {
        setFeedActionMode(nextMode);
        if (nextMode === 'edit') {
            const defaultTarget = logsOnSelectedDate.length === 1 ? logsOnSelectedDate[0]._key : '__DAILY_TOTAL__';
            setSelectedEditKey(defaultTarget);
            populateEditFormFields(defaultTarget, selectedFeedDateKey, feedPond);
        } else {
            feedForm.resetFields(['jumlahPakanInput', 'targetPakanInput', 'durasiInput']);
            feedForm.setFieldsValue({ statusInput: 'Berhasil' });
        }
    };

    const handleQuickEditLog = (logItem) => {
        const isTargetKontrol = isControlPond(logItem.pondType || logItem.pond_type);
        const nextPond = isTargetKontrol ? 'kontrol' : 'adm';
        const key = logItem._key || getStableLogKey(logItem);
        const dKey = logItem._dateKey || resolveLogDateKey(logItem) || selectedFeedDateKey;
        const gramVal = round(Number(logItem.jumlahPakan ?? logItem.jumlah_pakan ?? 0), 1);
        const targetVal = round(Number(logItem.targetPakan ?? logItem.target_pakan ?? gramVal), 1);
        const durVal = Number(logItem.durasi ?? logItem.durasi_servo ?? 0);

        setFeedPond(nextPond);
        setFeedActionMode('edit');
        setSelectedEditKey(key);
        feedForm.setFieldsValue({
            tanggal: dKey ? dayjs(dKey, 'YYYY-MM-DD') : dayjs(),
            jumlahPakanInput: gramVal,
            targetPakanInput: targetVal,
            durasiInput: durVal,
            statusInput: logItem.status === 'Gagal' ? 'Gagal' : 'Berhasil',
        });
    };

    // Handler Input Baru & Edit Feeding Log untuk Kolam B (ADM) maupun Kolam A (Kontrol)
    const onFinishManageFeed = async (values) => {
        const gram = round(Number(values.jumlahPakanInput), 1);
        const pondName = feedPond === 'adm' ? 'Kolam B (ADM)' : 'Kolam A (Kontrol)';
        if (isNaN(gram) || gram <= 0) {
            message.warning(`Masukkan jumlah pakan ${pondName} yang valid (> 0 gram).`);
            return;
        }

        setLoadingManualFeed(true);
        try {
            const isKontrol = feedPond === 'kontrol';
            const canonicalPondLabel = isKontrol ? 'Kolam Kontrol (Timer)' : 'Kolam Perlakuan (ADM)';
            const rawDate = values.tanggal?.toDate ? values.tanggal.toDate() : new Date(values.tanggal || Date.now());
            const selectedDateKey = dateKeyWita(rawDate);
            const timestampIso = `${selectedDateKey}T04:00:00.000Z`;

            const targetGram =
                !isKontrol && values.targetPakanInput !== undefined && values.targetPakanInput !== null && values.targetPakanInput !== ''
                    ? round(Number(values.targetPakanInput), 1)
                    : gram;
            const durasiVal = !isKontrol
                ? values.durasiInput !== undefined && values.durasiInput !== null && values.durasiInput !== ''
                    ? Math.round(Number(values.durasiInput))
                    : Math.max(1, Math.round(gram / 15))
                : 0;
            const statusVal = values.statusInput || 'Berhasil';

            const suhuVal = (isKontrol ? waterData.suhu?.latestKontrol : waterData.suhu?.latestAdm) ?? 30.0;
            const doVal = (isKontrol ? waterData.do?.latestKontrol : waterData.do?.latestAdm) ?? 6.0;
            const phVal = (isKontrol ? waterData.ph?.latestKontrol : waterData.ph?.latestAdm) ?? 7.5;
            const tdsVal = (isKontrol ? waterData.tds?.latestKontrol : waterData.tds?.latestAdm) ?? 500.0;

            const patchPayload = {
                pond_type: feedPond,
                pondType: canonicalPondLabel,
                target_pakan: targetGram,
                targetPakan: targetGram,
                jumlah_pakan: gram,
                jumlahPakan: gram,
                durasi_servo: durasiVal,
                durasi: durasiVal,
                status: statusVal,
                tanggal: selectedDateKey,
                timestamp: timestampIso,
                timestamp_iso: timestampIso,
                suhu: Number(suhuVal),
                do: Number(doVal),
                ph: Number(phVal),
                tds: Number(tdsVal),
            };

            if (feedActionMode === 'edit') {
                if (selectedEditKey === '__DAILY_TOTAL__') {
                    // Sesuaikan total pakan harian pada tanggal terpilih
                    if (logsOnSelectedDate.length > 0) {
                        const [primaryLog, ...extraLogs] = logsOnSelectedDate;
                        saveFeedingLogEdit(primaryLog._key, patchPayload);
                        api.put(`/api/feeding-log/${encodeURIComponent(primaryLog._key)}`, patchPayload).catch(() => {});
                        extraLogs.forEach((ext) => {
                            markFeedingLogDeleted(ext._key);
                            api.delete(`/api/feeding-log/${encodeURIComponent(ext._key)}`).catch(() => {});
                        });
                        invalidateCache('/api/feeding-log');
                        await fetchFeedingLogs(true);
                        message.success(
                            `Total pakan harian ${pondName} pada tanggal ${shortDateLabel(selectedDateKey)} berhasil diperbarui menjadi ${formatNumber(gram, 1)} g.`
                        );
                        return;
                    }
                    // Jika belum ada log pada tanggal tersebut, lanjutkan membuat log baru di bawah
                } else {
                    // Edit satu rekaman log spesifik
                    saveFeedingLogEdit(selectedEditKey, patchPayload);
                    api.put(`/api/feeding-log/${encodeURIComponent(selectedEditKey)}`, patchPayload).catch(() => {});
                    invalidateCache('/api/feeding-log');
                    await fetchFeedingLogs(true);
                    message.success(
                        `Log pakan ${pondName} untuk tanggal ${shortDateLabel(selectedDateKey)} (${formatNumber(gram, 1)} g) berhasil diperbarui.`
                    );
                    return;
                }
            }

            // Mode Tambah Baru (atau Edit Total Harian pada tanggal yang belum memiliki log)
            const prevKeys = new Set(feedingLogs.map((item) => getStableLogKey(item)).filter(Boolean));
            let createdOnBackend = false;

            try {
                await api.post('/api/feeding-log', {
                    pond_type: feedPond,
                    target_pakan: targetGram,
                    jumlah_pakan: gram,
                    durasi_servo: durasiVal,
                    status: statusVal,
                    tanggal: selectedDateKey,
                    timestamp: timestampIso,
                    timestamp_iso: timestampIso,
                    suhu: Number(suhuVal),
                    do: Number(doVal),
                    ph: Number(phVal),
                    tds: Number(tdsVal),
                });
                createdOnBackend = true;
            } catch {
                createdOnBackend = false;
            }

            invalidateCache('/api/feeding-log');
            const updatedList = await fetchFeedingLogs(true);

            const newlyCreated = updatedList.find((item) => {
                const k = getStableLogKey(item);
                return k && !prevKeys.has(k);
            });

            if (newlyCreated) {
                const newKey = getStableLogKey(newlyCreated);
                saveFeedingLogEdit(newKey, patchPayload);
            } else if (!createdOnBackend) {
                const localId = `manual_${feedPond}_${selectedDateKey}_${Date.now()}`;
                addLocalFeedingLog({
                    id: localId,
                    key: localId,
                    ...patchPayload,
                });
            }

            invalidateCache('/api/feeding-log');
            await fetchFeedingLogs(true);

            message.success(
                `Log pakan ${pondName} sebesar ${formatNumber(gram, 1)} g untuk tanggal ${shortDateLabel(selectedDateKey)} berhasil disimpan.`
            );
            if (feedActionMode === 'add') {
                feedForm.resetFields(['jumlahPakanInput', 'targetPakanInput', 'durasiInput']);
            }
        } catch (error) {
            const errDetail = error.response?.data?.detail || `Gagal menyimpan data pakan ${pondName}.`;
            message.error(errDetail);
        } finally {
            setLoadingManualFeed(false);
        }
    };

    const handleDeleteSelectedFeedLog = async () => {
        const pondName = feedPond === 'adm' ? 'Kolam B (ADM)' : 'Kolam A (Kontrol)';
        setLoadingManualFeed(true);
        try {
            if (selectedEditKey === '__DAILY_TOTAL__') {
                if (logsOnSelectedDate.length === 0) {
                    message.info(`Tidak ada log pakan ${pondName} pada tanggal ${shortDateLabel(selectedFeedDateKey)}.`);
                    return;
                }
                logsOnSelectedDate.forEach((item) => {
                    markFeedingLogDeleted(item._key);
                    api.delete(`/api/feeding-log/${encodeURIComponent(item._key)}`).catch(() => {});
                });
                invalidateCache('/api/feeding-log');
                await fetchFeedingLogs(true);
                feedForm.resetFields(['jumlahPakanInput', 'targetPakanInput', 'durasiInput']);
                message.success(`Seluruh log pakan ${pondName} pada tanggal ${shortDateLabel(selectedDateKeyFromForm())} berhasil dihapus.`);
            } else {
                markFeedingLogDeleted(selectedEditKey);
                api.delete(`/api/feeding-log/${encodeURIComponent(selectedEditKey)}`).catch(() => {});
                invalidateCache('/api/feeding-log');
                await fetchFeedingLogs(true);
                setSelectedEditKey('__DAILY_TOTAL__');
                feedForm.resetFields(['jumlahPakanInput', 'targetPakanInput', 'durasiInput']);
                message.success(`Rekaman log pakan ${pondName} berhasil dihapus.`);
            }
        } finally {
            setLoadingManualFeed(false);
        }
    };

    const selectedDateKeyFromForm = () => selectedFeedDateKey;

    // Ringkasan evaluasi akhir FCR & akumulasi pakan/biomassa/kematian terbaru
    const fcrSummary = useMemo(() => {
        if (!fcrTableData || fcrTableData.length === 0) {
            return { feedA: null, feedB: null, bioA: null, bioB: null, deathA: null, deathB: null, fcrA: null, fcrB: null };
        }
        const latestRow = fcrTableData[fcrTableData.length - 1];
        return {
            feedA: latestRow.feedA ?? null,
            feedB: latestRow.feedB ?? null,
            bioA: latestRow.bioA ?? null,
            bioB: latestRow.bioB ?? null,
            deathA: latestRow.deathA ?? 0,
            deathB: latestRow.deathB ?? 0,
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
                const rawData = Array.isArray(response.data.data) ? response.data.data : [];
                setRawSamplingList(rawData);
                const baseWeight = rawData.length > 0 && rawData[0]?.berat_awal ? Number(rawData[0].berat_awal) : 800.0;

                const sortedRows = parseSamplingRows(rawData);
                setFcrTableData(sortedRows);

                if (samplingMode === 'add') {
                    const maxWeek = sortedRows.length > 0 ? Math.max(...sortedRows.map((d) => Number(d.week) || 0)) : 0;
                    form.setFieldsValue({
                        minggu: String(maxWeek + 1),
                        kolam: 'adm',
                        beratAwal: baseWeight,
                        beratMati: 0,
                        jumlahMati: 0,
                    });
                }
            }
        } catch {
            setFetchError('Sebagian data evaluasi gagal dimuat dari server.');
            setLoadingTable(false);
        }
    }, [form, samplingMode]);

    // Muat data item sampling ke dalam form Section C untuk diedit
    const loadSamplingItemToForm = useCallback(
        (item) => {
            if (!item) return;
            const isAdm = /adm|perlakuan/i.test(item.kolam);
            const pondVal = isAdm ? 'adm' : 'kontrol';
            const docId = item.id || `fcr-m${item.minggu_ke}-${pondVal}`;
            const rangeVal =
                item.start_date && item.end_date ? [dayjs(item.start_date), dayjs(item.end_date)] : undefined;

            setSamplingMode('edit');
            setEditingSamplingId(docId);
            form.setFieldsValue({
                minggu: String(item.minggu_ke),
                kolam: pondVal,
                beratAwal: Number(item.berat_awal),
                beratAkhir: Number(item.berat_akhir),
                beratMati: Number(item.berat_kematian ?? item.berat_mati ?? 0),
                jumlahMati: Number(item.jumlah_mati || 0),
                jumlahPakan: Number(item.jumlah_pakan),
                dateRange: isAdm ? rangeVal : undefined,
                kontrolDateRange: !isAdm ? rangeVal : undefined,
            });
        },
        [form]
    );

    const handleSamplingModeChange = (nextMode) => {
        setSamplingMode(nextMode);
        if (nextMode === 'edit') {
            if (rawSamplingList.length > 0) {
                const latestItem = rawSamplingList[rawSamplingList.length - 1];
                loadSamplingItemToForm(latestItem);
            } else {
                message.info('Belum ada data sampling untuk diedit.');
                setSamplingMode('add');
            }
        } else {
            setEditingSamplingId(null);
            const maxWeek = fcrTableData.length > 0 ? Math.max(...fcrTableData.map((d) => Number(d.week) || 0)) : 0;
            const baseWeight = rawSamplingList.length > 0 && rawSamplingList[0]?.berat_awal ? Number(rawSamplingList[0].berat_awal) : 800.0;
            form.resetFields(['beratAkhir', 'beratMati', 'jumlahMati', 'jumlahPakan', 'dateRange', 'kontrolDateRange']);
            form.setFieldsValue({
                minggu: String(maxWeek + 1),
                kolam: 'adm',
                beratAwal: baseWeight,
                beratMati: 0,
                jumlahMati: 0,
            });
        }
    };

    const handleDeleteSampling = async () => {
        if (!editingSamplingId) return;
        setLoadingForm(true);
        try {
            await api.delete(`/api/sampling/${encodeURIComponent(editingSamplingId)}`);
            message.success('Data sampling berhasil dihapus dari Firestore.');
            setSamplingMode('add');
            setEditingSamplingId(null);
            form.resetFields(['beratAkhir', 'beratMati', 'jumlahMati', 'jumlahPakan', 'dateRange', 'kontrolDateRange']);
            await fetchFCRData(true);
        } catch (error) {
            const errDetail = error.response?.data?.detail || 'Gagal menghapus data sampling.';
            message.error(errDetail);
        } finally {
            setLoadingForm(false);
        }
    };

    const handleRefreshAll = () => {
        setFetchError(null);
        fetchFCRData(true);
        fetchSensorHistory(true);
        fetchFeedingLogs(true);
    };

    // Handler filter periode waktu Section A (Tren Kualitas Air Makro)
    const handleWaterPeriodChange = (val) => {
        setWaterPeriod(val);
        const hoursMap = { '24h': 24, '3d': 72, '7d': 168, '30d': 720 };
        const nextHours = hoursMap[val] || 24;
        fetchSensorHistory(true, nextHours);
    };

    const handleWaterCustomRangeChange = (dates) => {
        setWaterCustomRange(dates);
        if (dates && dates[0] && dates[1]) {
            const start = dates[0].toDate ? dates[0].toDate() : new Date(dates[0]);
            const end = dates[1].toDate ? dates[1].toDate() : new Date(dates[1]);
            const diffHours = Math.ceil((end.getTime() - start.getTime()) / 3600000);
            const nextHours = Math.max(24, Math.min(1440, diffHours + 24));
            fetchSensorHistory(true, nextHours);
        }
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

    // Hitung otomatis akumulasi pakan Kolam B (ADM) saat pengguna memilih rentang tanggal di Section C
    const handleAdmDateRangeChange = (dates) => {
        if (!dates || dates.length !== 2 || !dates[0] || !dates[1]) return;
        const startKey = dateKeyWita(dates[0].toDate ? dates[0].toDate() : new Date(dates[0]));
        const endKey = dateKeyWita(dates[1].toDate ? dates[1].toDate() : new Date(dates[1]));
        let sum = 0;
        totalsAdm.forEach((val, key) => {
            if (key >= startKey && key <= endKey) {
                sum += val;
            }
        });
        if (sum > 0) {
            form.setFieldsValue({ jumlahPakan: round(sum, 1) });
        }
    };

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
        const w0 = Number(values.beratAwal);
        const wt = Number(values.beratAkhir);
        const d = Number(values.beratMati || 0);
        const netBiomassa = (wt + d) - w0;

        if (netBiomassa <= 0) {
            message.error(
                `Pertambahan biomassa plus kematian nol atau negatif (Wt=${wt} + D=${d} − W0=${w0} = ${round(netBiomassa, 1)} gram). Berat akhir (Wt) ditambah kematian (D) harus lebih besar dari berat awal (W0).`
            );
            return;
        }

        setLoadingForm(true);
        try {
            const isAdm = values.kolam === 'adm';
            const payload = {
                minggu_ke: parseInt(values.minggu),
                kolam: isAdm ? 'adm' : 'kontrol',
                berat_awal: w0,
                berat_akhir: wt,
                berat_kematian: d,
                jumlah_mati: Number(values.jumlahMati || 0),
            };

            if (isAdm) {
                if (values.dateRange && values.dateRange.length === 2 && values.dateRange[0] && values.dateRange[1]) {
                    const start = values.dateRange[0]?.toDate ? values.dateRange[0].toDate() : new Date(values.dateRange[0]);
                    const end = values.dateRange[1]?.toDate ? values.dateRange[1].toDate() : new Date(values.dateRange[1]);
                    payload.tgl_mulai = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0)).toISOString();
                    payload.tgl_akhir = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)).toISOString();
                }
                if (values.jumlahPakan !== undefined && values.jumlahPakan !== null && Number(values.jumlahPakan) > 0) {
                    payload.jumlah_pakan = Number(values.jumlahPakan);
                } else if (!payload.tgl_mulai || !payload.tgl_akhir) {
                    message.warning('Harap pilih rentang tanggal log pakan atau masukkan total pakan aktual untuk Kolam B (ADM).');
                    setLoadingForm(false);
                    return;
                }
            } else {
                if (values.kontrolDateRange && values.kontrolDateRange.length === 2 && values.kontrolDateRange[0] && values.kontrolDateRange[1]) {
                    const start = values.kontrolDateRange[0]?.toDate ? values.kontrolDateRange[0].toDate() : new Date(values.kontrolDateRange[0]);
                    const end = values.kontrolDateRange[1]?.toDate ? values.kontrolDateRange[1].toDate() : new Date(values.kontrolDateRange[1]);
                    payload.tgl_mulai = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0)).toISOString();
                    payload.tgl_akhir = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)).toISOString();
                }
                if (values.jumlahPakan === undefined || values.jumlahPakan === null || Number(values.jumlahPakan) <= 0) {
                    message.warning('Harap masukkan jumlah pakan aktual (positif) untuk Kolam A (Kontrol).');
                    setLoadingForm(false);
                    return;
                }
                payload.jumlah_pakan = Number(values.jumlahPakan);
            }

            const response =
                samplingMode === 'edit' && editingSamplingId
                    ? await api.put(`/api/sampling/${encodeURIComponent(editingSamplingId)}`, payload)
                    : await api.post('/api/sampling', payload);

            if (response.data.status === 'success') {
                const totalFeedStr = response.data.total_pakan !== undefined ? ` (~${response.data.total_pakan} g pakan)` : '';
                message.success(
                    samplingMode === 'edit'
                        ? `Perubahan data sampling berhasil disimpan! Nilai FCR baru: ${response.data.fcr}${totalFeedStr}`
                        : `Data sampling tersimpan di Firestore. Nilai FCR: ${response.data.fcr}${totalFeedStr}`
                );
                if (samplingMode === 'edit') {
                    setSamplingMode('add');
                    setEditingSamplingId(null);
                }
                form.resetFields(['beratAkhir', 'beratMati', 'jumlahMati', 'jumlahPakan', 'dateRange', 'kontrolDateRange']);
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
                        <Space size={10} wrap align="center">
                            <span style={{ fontWeight: 600 }}>A. Tren Kualitas Air Makro</span>
                            <Segmented
                                size="small"
                                value={waterPeriod}
                                onChange={handleWaterPeriodChange}
                                options={[
                                    { label: '24 Jam', value: '24h' },
                                    { label: '3 Hari', value: '3d' },
                                    { label: '7 Hari', value: '7d' },
                                    { label: '30 Hari', value: '30d' },
                                    { label: 'Kustom', value: 'custom' },
                                ]}
                            />
                            {waterPeriod === 'custom' && (
                                <DatePicker.RangePicker
                                    size="small"
                                    format="DD/MM/YYYY"
                                    value={waterCustomRange}
                                    onChange={handleWaterCustomRangeChange}
                                    allowClear={false}
                                    style={{ width: 220 }}
                                />
                            )}
                            <Tooltip title="Mengevaluasi tren rata-rata sensor kualitas air Kolam B (ADM) dan Kolam A (Kontrol) pada periode yang dipilih">
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
                                    isMultiDay={waterPeriod !== '24h'}
                                />
                            </Col>
                        ))}
                    </Row>
                </Spin>

                <div
                    style={{
                        marginTop: 16,
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-md)',
                        background: waterInsight.type === 'success' ? 'var(--status-success-bg)' : waterInsight.type === 'warning' ? 'var(--status-warning-bg)' : 'var(--status-info-bg)',
                        border: `1px solid ${waterInsight.type === 'success' ? 'var(--status-success-border)' : waterInsight.type === 'warning' ? 'var(--status-warning-border)' : 'var(--status-info-border)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                    }}
                >
                    {waterInsight.type === 'success' ? (
                        <CheckCircleOutlined style={{ color: '#059669', fontSize: 18, flexShrink: 0 }} />
                    ) : waterInsight.type === 'warning' ? (
                        <InfoCircleOutlined style={{ color: '#d97706', fontSize: 18, flexShrink: 0 }} />
                    ) : (
                        <InfoCircleOutlined style={{ color: 'var(--brand-600)', fontSize: 18, flexShrink: 0 }} />
                    )}
                    <div style={{ color: waterInsight.type === 'success' ? '#065f46' : waterInsight.type === 'warning' ? '#92400e' : '#1e1b4b', fontSize: 13, lineHeight: '20px' }}>
                        {waterInsight.node || waterInsight.text}
                    </div>
                </div>
            </Card>

            {/* SECTION B: ANALISIS PEMBERIAN PAKAN & KELOLA LOG PAKAN HARIAN (KOLAM B & KOLAM A) */}
            <Card title="B. Analisis Pemberian Pakan & Kelola Log Pakan Harian (Kolam B & Kolam A)">
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

                        <div
                            style={{
                                marginTop: 16,
                                padding: '12px 16px',
                                borderRadius: 'var(--radius-md)',
                                background: 'var(--status-info-bg)',
                                border: '1px solid var(--status-info-border)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                            }}
                        >
                            <InfoCircleOutlined style={{ color: 'var(--brand-600)', fontSize: 18, flexShrink: 0 }} />
                            <div style={{ color: '#1e1b4b', fontSize: 13, lineHeight: '20px' }}>
                                {feedSummary.days ? (
                                    <>
                                        Pakan <b style={{ color: COLOR_ADM }}>Kolam B (ADM)</b> berfluktuasi antara <b>{formatNumber(feedSummary.minAdm, 1)}–{formatNumber(feedSummary.maxAdm, 1)} g/hari</b> mengikuti kualitas air, sedangkan <b style={{ color: COLOR_KONTROL }}>Kolam A (Kontrol)</b> tercatat <b>{formatNumber(feedSummary.minKontrol, 1)}–{formatNumber(feedSummary.maxKontrol, 1)} g/hari</b> dari input aktual harian.
                                    </>
                                ) : (
                                    'Belum ada event pemberian pakan berstatus Berhasil yang tercatat.'
                                )}
                            </div>
                        </div>
                    </Col>

                    <Col xs={24} lg={9}>
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {/* PANEL INPUT & EDIT LOG PAKAN HARIAN (KOLAM B & KOLAM A) */}
                            <div
                                style={{
                                    background: 'var(--bg-subtle)',
                                    padding: '16px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-subtle)',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                                    <Space size={6}>
                                        {feedActionMode === 'edit' ? (
                                            <EditOutlined style={{ color: feedPond === 'adm' ? COLOR_ADM : COLOR_KONTROL }} />
                                        ) : (
                                            <PlusCircleOutlined style={{ color: feedPond === 'adm' ? COLOR_ADM : COLOR_KONTROL }} />
                                        )}
                                        <Text strong style={{ fontSize: 13 }}>
                                            {feedActionMode === 'edit' ? 'Edit Log Pakan' : 'Input Pakan Harian'} — {feedPond === 'adm' ? 'Kolam B (ADM)' : 'Kolam A (Kontrol)'}
                                        </Text>
                                    </Space>
                                    <Tag color={feedPond === 'adm' ? 'geekblue' : 'orange'} style={{ margin: 0 }}>
                                        {shortDateLabel(selectedFeedDateKey)}: {formatNumber(activePondSelectedDateTotal, 1)} g
                                    </Tag>
                                </div>

                                {/* Selector Kolam & Mode */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                                    <Segmented
                                        block
                                        size="small"
                                        value={feedPond}
                                        onChange={handleFeedPondChange}
                                        options={[
                                            { label: 'Kolam B — Perlakuan (ADM)', value: 'adm' },
                                            { label: 'Kolam A — Kontrol (Timer)', value: 'kontrol' },
                                        ]}
                                    />
                                    <Segmented
                                        block
                                        size="small"
                                        value={feedActionMode}
                                        onChange={handleFeedModeChange}
                                        options={[
                                            { label: '+ Input Log Pakan Baru', value: 'add' },
                                            { label: `✎ Edit / Koreksi Log (${pondLogs.length})`, value: 'edit' },
                                        ]}
                                    />
                                </div>

                                <Form
                                    form={feedForm}
                                    layout="vertical"
                                    onFinish={onFinishManageFeed}
                                    initialValues={{
                                        tanggal: dayjs(),
                                        statusInput: 'Berhasil',
                                    }}
                                >
                                    {feedActionMode === 'edit' && (
                                        <div style={{ marginBottom: 12 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                                <Text type="secondary" style={{ fontSize: 12 }}>
                                                    Pilih Target Koreksi ({feedPond === 'adm' ? 'Kolam B' : 'Kolam A'})
                                                </Text>
                                                {selectedEditKey && selectedEditKey !== '__DAILY_TOTAL__' && (
                                                    <Popconfirm
                                                        title="Hapus log pemberian pakan ini?"
                                                        description="Log yang dihapus tidak akan dihitung dalam grafik dan evaluasi FCR."
                                                        onConfirm={handleDeleteSelectedFeedLog}
                                                        okText="Hapus"
                                                        cancelText="Batal"
                                                        okButtonProps={{ danger: true }}
                                                    >
                                                        <Button type="link" danger size="small" icon={<DeleteOutlined />} style={{ padding: 0, height: 'auto', fontSize: 12 }}>
                                                            Hapus Log Ini
                                                        </Button>
                                                    </Popconfirm>
                                                )}
                                            </div>
                                            <Select
                                                size="middle"
                                                style={{ width: '100%' }}
                                                value={selectedEditKey}
                                                onChange={(val) => {
                                                    setSelectedEditKey(val);
                                                    populateEditFormFields(val, feedPond, selectedFeedDateKey);
                                                }}
                                                options={[
                                                    {
                                                        value: '__DAILY_TOTAL__',
                                                        label: `⚡ Sesuaikan Total Harian Tanggal Ini (${shortDateLabel(selectedFeedDateKey)}: ${formatNumber(activePondSelectedDateTotal, 1)} g)`,
                                                    },
                                                    ...pondLogs.slice(0, 40).map((item) => {
                                                        const k = getStableLogKey(item);
                                                        const dKey = resolveLogDateKey(item);
                                                        const timeStr = formatDateTimeWita(item?.timestamp_iso || item?.timestamp);
                                                        return {
                                                            value: k,
                                                            label: `${dKey ? shortDateLabel(dKey) : timeStr} • ${formatNumber(item.jumlahPakan, 1)} g (${item.status || 'Berhasil'})`,
                                                        };
                                                    }),
                                                ]}
                                            />
                                        </div>
                                    )}

                                    <Row gutter={12}>
                                        <Col xs={24} sm={11}>
                                            <Form.Item
                                                name="tanggal"
                                                label="Tanggal Pemberian"
                                                rules={[{ required: true, message: 'Pilih tanggal' }]}
                                                style={{ marginBottom: 10 }}
                                            >
                                                <DatePicker
                                                    style={{ width: '100%' }}
                                                    format="DD/MM/YYYY"
                                                    allowClear={false}
                                                    suffixIcon={<CalendarOutlined />}
                                                    onChange={(d) => {
                                                        if (feedActionMode === 'edit' && selectedEditKey === '__DAILY_TOTAL__' && d) {
                                                            const nextKey = dateKeyWita(d.toDate ? d.toDate() : new Date(d));
                                                            const map = feedPond === 'adm' ? totalsAdm : totalsKontrol;
                                                            feedForm.setFieldsValue({
                                                                jumlahPakanInput: round(map.get(nextKey) || 0, 1),
                                                            });
                                                        }
                                                    }}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={13}>
                                            <Form.Item
                                                name="jumlahPakanInput"
                                                label={
                                                    feedActionMode === 'edit' && selectedEditKey === '__DAILY_TOTAL__'
                                                        ? `Total Pakan ${feedPond === 'adm' ? 'Kolam B' : 'Kolam A'}`
                                                        : `Jumlah Pakan ${feedPond === 'adm' ? 'Kolam B' : 'Kolam A'}`
                                                }
                                                rules={[{ required: true, message: 'Masukkan pakan (g)' }]}
                                                style={{ marginBottom: 10 }}
                                            >
                                                <InputNumber
                                                    style={{ width: '100%' }}
                                                    min={feedActionMode === 'edit' ? 0 : 0.1}
                                                    step={10}
                                                    placeholder={feedPond === 'adm' ? 'Contoh: 45' : 'Contoh: 1000'}
                                                    addonAfter="gram"
                                                />
                                            </Form.Item>
                                        </Col>
                                    </Row>

                                    {(feedPond === 'adm' || (feedActionMode === 'edit' && selectedEditKey !== '__DAILY_TOTAL__')) && (
                                        <Row gutter={8}>
                                            <Col xs={8}>
                                                <Form.Item
                                                    name="targetPakanInput"
                                                    label={<span style={{ fontSize: 11 }}>Target Fuzzy (g)</span>}
                                                    style={{ marginBottom: 10 }}
                                                >
                                                    <InputNumber
                                                        size="small"
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        step={1}
                                                        placeholder="Otomatis"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={8}>
                                                <Form.Item
                                                    name="durasiInput"
                                                    label={<span style={{ fontSize: 11 }}>Durasi (dtk)</span>}
                                                    style={{ marginBottom: 10 }}
                                                >
                                                    <InputNumber
                                                        size="small"
                                                        style={{ width: '100%' }}
                                                        min={0}
                                                        step={1}
                                                        placeholder="Otomatis"
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={8}>
                                                <Form.Item
                                                    name="statusInput"
                                                    label={<span style={{ fontSize: 11 }}>Status</span>}
                                                    style={{ marginBottom: 10 }}
                                                >
                                                    <Select
                                                        size="small"
                                                        options={[
                                                            { value: 'Berhasil', label: 'Berhasil' },
                                                            { value: 'Gagal', label: 'Gagal' },
                                                        ]}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    )}

                                    <Button
                                        type="primary"
                                        htmlType="submit"
                                        icon={<SaveOutlined />}
                                        loading={loadingManualFeed}
                                        block
                                    >
                                        {feedActionMode === 'edit'
                                            ? `Simpan Perubahan Log ${feedPond === 'adm' ? 'Kolam B' : 'Kolam A'}`
                                            : `Simpan Pakan Harian ${feedPond === 'adm' ? 'Kolam B (ADM)' : 'Kolam A (Kontrol)'}`}
                                    </Button>
                                </Form>

                                {/* Daftar ringkas log pada tanggal terpilih agar mudah diklik untuk diedit */}
                                {logsOnSelectedDate.length > 0 && (
                                    <div
                                        style={{
                                            marginTop: 12,
                                            paddingTop: 10,
                                            borderTop: '1px dashed var(--border-subtle)',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                            <Text type="secondary" style={{ fontSize: 11 }}>
                                                Log {feedPond === 'adm' ? 'Kolam B' : 'Kolam A'} pada {shortDateLabel(selectedFeedDateKey)} ({logsOnSelectedDate.length} entri):
                                            </Text>
                                            <Text type="secondary" style={{ fontSize: 11 }}>
                                                Klik untuk edit
                                            </Text>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 115, overflowY: 'auto' }}>
                                            {logsOnSelectedDate.map((item) => {
                                                const k = getStableLogKey(item);
                                                const isSelected = feedActionMode === 'edit' && selectedEditKey === k;
                                                return (
                                                    <div
                                                        key={k}
                                                        onClick={() => handleQuickEditLog(item)}
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            padding: '4px 8px',
                                                            borderRadius: 6,
                                                            cursor: 'pointer',
                                                            fontSize: 12,
                                                            background: isSelected ? 'var(--brand-50, #eeeeff)' : 'var(--bg-surface)',
                                                            border: isSelected ? `1px solid ${COLOR_ADM}` : '1px solid var(--border-subtle)',
                                                        }}
                                                    >
                                                        <Space size={6}>
                                                            <Tag
                                                                color={item.status === 'Berhasil' ? 'success' : 'error'}
                                                                style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                                                            >
                                                                {item.status || 'Berhasil'}
                                                            </Tag>
                                                            <Text style={{ fontSize: 12 }} strong>
                                                                {formatNumber(item.jumlahPakan, 1)} g
                                                            </Text>
                                                            {item.durasi ? (
                                                                <Text type="secondary" style={{ fontSize: 11 }}>
                                                                    ({item.durasi}s)
                                                                </Text>
                                                            ) : null}
                                                        </Space>
                                                        <Space size={4}>
                                                            <EditOutlined style={{ fontSize: 12, color: COLOR_ADM }} />
                                                            <Text style={{ fontSize: 11, color: COLOR_ADM }}>Edit</Text>
                                                        </Space>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
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
                    <Col xs={24} lg={8}>
                        <div style={{ background: 'var(--bg-subtle)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                                <Space size={6}>
                                    {samplingMode === 'edit' ? (
                                        <EditOutlined style={{ color: COLOR_ADM }} />
                                    ) : (
                                        <PlusCircleOutlined style={{ color: COLOR_ADM }} />
                                    )}
                                    <Text strong style={{ fontSize: 13 }}>
                                        {samplingMode === 'edit' ? 'Edit Data Sampling & Hitung Ulang FCR' : 'Input Sampling Mingguan & Kalkulasi FCR'}
                                    </Text>
                                </Space>
                            </div>

                            <div style={{ marginBottom: 12 }}>
                                <Segmented
                                    block
                                    size="small"
                                    value={samplingMode}
                                    onChange={handleSamplingModeChange}
                                    options={[
                                        { label: '+ Input Sampling Baru', value: 'add' },
                                        { label: `✎ Edit Data Sampling (${rawSamplingList.length})`, value: 'edit' },
                                    ]}
                                />
                            </div>

                            {samplingMode === 'edit' && (
                                <div style={{ marginBottom: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            Pilih Rekaman Sampling untuk Dikoreksi
                                        </Text>
                                        {editingSamplingId && (
                                            <Popconfirm
                                                title="Hapus data sampling ini?"
                                                description="Data sampling minggu & kolam terpilih akan dihapus dari Firestore."
                                                onConfirm={handleDeleteSampling}
                                                okText="Hapus"
                                                cancelText="Batal"
                                                okButtonProps={{ danger: true }}
                                            >
                                                <Button type="link" danger size="small" icon={<DeleteOutlined />} style={{ padding: 0, height: 'auto', fontSize: 12 }}>
                                                    Hapus Sampling Ini
                                                </Button>
                                            </Popconfirm>
                                        )}
                                    </div>
                                    <Select
                                        size="middle"
                                        style={{ width: '100%' }}
                                        value={editingSamplingId}
                                        placeholder="Pilih data sampling..."
                                        onChange={(val) => {
                                            const found = rawSamplingList.find(
                                                (it) => (it.id || `fcr-m${it.minggu_ke}-${/adm|perlakuan/i.test(it.kolam) ? 'adm' : 'kontrol'}`) === val
                                            );
                                            if (found) loadSamplingItemToForm(found);
                                        }}
                                        options={rawSamplingList.map((it) => {
                                            const isAdm = /adm|perlakuan/i.test(it.kolam);
                                            const docId = it.id || `fcr-m${it.minggu_ke}-${isAdm ? 'adm' : 'kontrol'}`;
                                            return {
                                                value: docId,
                                                label: `Minggu ${it.minggu_ke} • ${isAdm ? 'Kolam B (ADM)' : 'Kolam A (Kontrol)'} — Wt: ${formatNumber(it.berat_akhir, 1)}g | Pakan: ${formatNumber(it.jumlah_pakan, 1)}g | FCR: ${formatNumber(it.fcr, 2)}`,
                                            };
                                        })}
                                    />
                                </div>
                            )}

                            <Form
                                form={form}
                                layout="vertical"
                                onFinish={onFinishSampling}
                                initialValues={{ minggu: '1', kolam: 'adm', beratAwal: 800.0, beratMati: 0, jumlahMati: 0 }}
                                onValuesChange={(changed, allValues) => {
                                    if (samplingMode === 'edit' && (changed.minggu !== undefined || changed.kolam !== undefined)) {
                                        const targetWeek = Number(allValues.minggu);
                                        const targetIsAdm = allValues.kolam === 'adm';
                                        const match = rawSamplingList.find(
                                            (it) => Number(it.minggu_ke) === targetWeek && /adm|perlakuan/i.test(it.kolam) === targetIsAdm
                                        );
                                        if (match) {
                                            loadSamplingItemToForm(match);
                                        }
                                    }
                                }}
                            >
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
                                    label="Biomassa Awal W0 (gram)"
                                    tooltip="Biomassa awal saat tebar / awal siklus sampling (W0)"
                                    rules={[{ required: true, message: 'Masukkan berat awal' }]}
                                    style={{ marginBottom: 10 }}
                                >
                                    <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} addonAfter="gram" />
                                </Form.Item>
                                <Form.Item
                                    name="beratAkhir"
                                    label="Biomassa Akhir Hidup Wt (gram)"
                                    tooltip="Total bobot ikan hidup hasil penimbangan sampling minggu ini (Wt)"
                                    rules={[{ required: true, message: 'Masukkan berat akhir' }]}
                                    style={{ marginBottom: 10 }}
                                >
                                    <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} addonAfter="gram" />
                                </Form.Item>

                                <Row gutter={12}>
                                    <Col span={13}>
                                        <Form.Item
                                            name="beratMati"
                                            label="Biomassa Mati D (gram)"
                                            tooltip="Total berat ikan yang mati selama siklus/minggu ini (D). Digunakan dalam rumus FCR = F / (Wt + D - W0). Isi 0 jika tidak ada ikan mati."
                                            rules={[{ required: true, message: 'Masukkan bobot mati (min 0)' }]}
                                            style={{ marginBottom: 10 }}
                                        >
                                            <InputNumber style={{ width: '100%' }} min={0} step={1} addonAfter="gram" />
                                        </Form.Item>
                                    </Col>
                                    <Col span={11}>
                                        <Form.Item
                                            name="jumlahMati"
                                            label="Ekor Mati (Opsional)"
                                            tooltip="Jumlah ekor ikan yang mati untuk pencatatan mortalitas"
                                            style={{ marginBottom: 10 }}
                                        >
                                            <InputNumber style={{ width: '100%' }} min={0} step={1} placeholder="0" addonAfter="ekor" />
                                        </Form.Item>
                                    </Col>
                                </Row>

                                {/* Form adaptif berdasarkan tipe kolam */}
                                <Form.Item noStyle shouldUpdate={(prev, curr) => prev.kolam !== curr.kolam}>
                                    {({ getFieldValue }) => {
                                        const isAdm = getFieldValue('kolam') === 'adm';
                                        return isAdm ? (
                                            <div>
                                                <Form.Item
                                                    name="dateRange"
                                                    label="Rentang Log Pakan Kolam B (ADM)"
                                                    tooltip="Pilih rentang tanggal untuk menjumlahkan otomatis log pakan Kolam B (termasuk log hasil input/edit)"
                                                    style={{ marginBottom: 10 }}
                                                >
                                                    <DatePicker.RangePicker
                                                        style={{ width: '100%' }}
                                                        format="DD/MM/YYYY"
                                                        onChange={handleAdmDateRangeChange}
                                                    />
                                                </Form.Item>
                                                <Form.Item
                                                    name="jumlahPakan"
                                                    label="Pakan Diberikan F — Kolam B (gram)"
                                                    tooltip="Terisi otomatis dari akumulasi log Kolam B pada rentang tanggal di atas, atau dapat disesuaikan manual"
                                                    rules={[{ required: true, message: 'Pilih rentang tanggal atau masukkan total pakan Kolam B' }]}
                                                    style={{ marginBottom: 12 }}
                                                >
                                                    <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} addonAfter="gram" />
                                                </Form.Item>
                                                <div
                                                    style={{
                                                        marginBottom: 16,
                                                        padding: '10px 12px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        background: 'var(--status-info-bg)',
                                                        border: '1px solid var(--status-info-border)',
                                                        fontSize: 12,
                                                        color: '#1e1b4b',
                                                        lineHeight: '18px',
                                                    }}
                                                >
                                                    <InfoCircleOutlined style={{ color: 'var(--brand-600)', marginRight: 6 }} />
                                                    Pilih rentang tanggal di atas untuk menjumlahkan otomatis pakan <b style={{ color: COLOR_ADM }}>Kolam B (ADM)</b>, atau ketik langsung total pakannya.
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <Form.Item
                                                    name="kontrolDateRange"
                                                    label="Filter Rentang Log Kolam A (Opsional)"
                                                    tooltip="Pilih rentang tanggal untuk menjumlahkan otomatis pakan harian Kolam A yang telah diinput"
                                                    style={{ marginBottom: 10 }}
                                                >
                                                    <DatePicker.RangePicker
                                                        style={{ width: '100%' }}
                                                        format="DD/MM/YYYY"
                                                        onChange={handleKontrolDateRangeChange}
                                                    />
                                                </Form.Item>
                                                <Form.Item
                                                    name="jumlahPakan"
                                                    label="Pakan Diberikan F — Kolam A (gram)"
                                                    tooltip="Akumulasi total pakan yang diberikan untuk Kolam A (Kontrol)"
                                                    rules={[{ required: true, message: 'Masukkan total pakan Kolam A' }]}
                                                    style={{ marginBottom: 12 }}
                                                >
                                                    <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} addonAfter="gram" />
                                                </Form.Item>
                                                <div
                                                    style={{
                                                        marginBottom: 16,
                                                        padding: '10px 12px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        background: 'var(--status-warning-bg)',
                                                        border: '1px solid var(--status-warning-border)',
                                                        fontSize: 12,
                                                        color: '#92400e',
                                                        lineHeight: '18px',
                                                    }}
                                                >
                                                    <InfoCircleOutlined style={{ color: '#d97706', marginRight: 6 }} />
                                                    Pilih rentang tanggal di atas untuk mengisi otomatis dari input harian <b style={{ color: COLOR_KONTROL }}>Kolam A (Kontrol)</b>, atau ketik langsung total pakannya.
                                                </div>
                                            </div>
                                        );
                                    }}
                                </Form.Item>

                                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                    <Button type="primary" htmlType="submit" icon={<SaveOutlined />} block loading={loadingForm}>
                                        {samplingMode === 'edit' ? 'Simpan Perubahan Sampling & Hitung Ulang FCR' : 'Hitung & Simpan FCR'}
                                    </Button>
                                    {samplingMode === 'edit' && (
                                        <Button block onClick={() => handleSamplingModeChange('add')}>
                                            Batal Edit (Kembali ke Input Baru)
                                        </Button>
                                    )}
                                </Space>
                            </Form>
                        </div>
                    </Col>

                    <Col xs={24} lg={16}>
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {fcrTableData.length === 0 && !loadingTable ? (
                                <EmptyState
                                    height={220}
                                    title="Belum Ada Data Sampling Mingguan"
                                    description="Silakan isi form di samping untuk menyimpan hasil penimbangan sampling pertama."
                                />
                            ) : (
                                <Table
                                    columns={[
                                        ...fcrColumns,
                                        {
                                            title: 'Aksi Edit',
                                            key: 'aksi',
                                            align: 'center',
                                            width: 150,
                                            render: (_, record) => (
                                                <Space size={4} wrap style={{ justifyContent: 'center' }}>
                                                    {record.rawA && (
                                                        <Tooltip title={`Edit Sampling Minggu ${record.week} — Kolam B (ADM)`}>
                                                            <Button
                                                                size="small"
                                                                icon={<EditOutlined />}
                                                                onClick={() => loadSamplingItemToForm(record.rawA)}
                                                                style={{ fontSize: 11, color: COLOR_ADM, borderColor: COLOR_ADM }}
                                                            >
                                                                Kolam B
                                                            </Button>
                                                        </Tooltip>
                                                    )}
                                                    {record.rawB && (
                                                        <Tooltip title={`Edit Sampling Minggu ${record.week} — Kolam A (Kontrol)`}>
                                                            <Button
                                                                size="small"
                                                                icon={<EditOutlined />}
                                                                onClick={() => loadSamplingItemToForm(record.rawB)}
                                                                style={{ fontSize: 11, color: COLOR_KONTROL, borderColor: COLOR_KONTROL }}
                                                            >
                                                                Kolam A
                                                            </Button>
                                                        </Tooltip>
                                                    )}
                                                </Space>
                                            ),
                                        },
                                    ]}
                                    dataSource={fcrTableData}
                                    loading={loadingTable}
                                    pagination={false}
                                    size="small"
                                    bordered
                                    scroll={{ x: 860 }}
                                    summary={() => {
                                        if (!fcrTableData || fcrTableData.length === 0) return null;
                                        return (
                                            <Table.Summary fixed>
                                                <Table.Summary.Row style={{ background: 'var(--bg-subtle)', fontWeight: 700 }}>
                                                    <Table.Summary.Cell index={0} align="center">
                                                        <Tooltip title="Nilai akumulasi pakan, biomassa, kematian minggu terakhir serta evaluasi FCR kumulatif terkini">
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
                                                    <Table.Summary.Cell index={5} align="right">
                                                        {fcrSummary.deathA !== null ? formatNumber(fcrSummary.deathA, 1) : '0'}
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={6} align="right">
                                                        {fcrSummary.deathB !== null ? formatNumber(fcrSummary.deathB, 1) : '0'}
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={7} align="center">
                                                        <Text strong style={{ color: COLOR_ADM }}>
                                                            {fcrSummary.fcrA !== null ? formatNumber(fcrSummary.fcrA, 2) : '—'}
                                                        </Text>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={8} align="center">
                                                        <Text strong style={{ color: COLOR_KONTROL }}>
                                                            {fcrSummary.fcrB !== null ? formatNumber(fcrSummary.fcrB, 2) : '—'}
                                                        </Text>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell index={9} align="center">
                                                        —
                                                    </Table.Summary.Cell>
                                                </Table.Summary.Row>
                                            </Table.Summary>
                                        );
                                    }}
                                />
                            )}

                            {/* Kotak Metodologi FCR Terkalibrasi Kematian */}
                            <div
                                style={{
                                    background: 'var(--color-adm-bg)',
                                    border: '1px solid var(--color-adm-border)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '14px 18px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: 14,
                                }}
                            >
                                <Space size={10} align="start">
                                    <CalculatorOutlined style={{ color: COLOR_ADM, fontSize: 18, marginTop: 2 }} />
                                    <div>
                                        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 3 }}>
                                            Standar Evaluasi FCR Akuakultur Terkalibrasi Kematian:
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: '20px' }}>
                                            <span className="sf-mono" style={{ fontWeight: 700, color: COLOR_ADM, fontSize: 13 }}>
                                                FCR = F / (Wt + D − W0)
                                            </span>
                                            <span style={{ margin: '0 8px', color: 'var(--border-default)' }}>|</span>
                                            <b>F:</b> Total Pakan Diberikan &bull; <b>Wt:</b> Biomassa Akhir Ikan Hidup &bull; <b>D:</b> Bobot Kematian Ikan &bull; <b>W0:</b> Biomassa Awal.
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                            Penyebut <span className="sf-mono">(Wt + D − W0)</span> merepresentasikan akumulasi produksi daging riil. Semakin rendah nilai FCR, semakin efisien rasio konversi pakan.
                                        </div>
                                    </div>
                                </Space>
                                {(fcrSummary.fcrA !== null || fcrSummary.fcrB !== null) && (
                                    <Space size="middle" wrap>
                                        <Tag color="blue" style={{ margin: 0, padding: '4px 10px', fontSize: 12 }}>
                                            FCR Kolam B (ADM): <b>{fcrSummary.fcrA !== null ? formatNumber(fcrSummary.fcrA, 2) : '—'}</b>
                                        </Tag>
                                        <Tag color="orange" style={{ margin: 0, padding: '4px 10px', fontSize: 12 }}>
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

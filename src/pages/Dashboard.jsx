import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Row, Col, Typography, Badge, Space, Button, InputNumber, message, Tooltip, Tag } from 'antd';
import {
    ThunderboltOutlined,
    SettingOutlined,
    PlayCircleOutlined,
    PauseCircleOutlined,
    ExperimentOutlined,
    InfoCircleOutlined,
    ReloadOutlined,
} from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import { parseUtc, formatJamWita } from '../utils/time';
import api, { getCachedData } from '../api';
import {
    DataFreshnessBadge,
    StaleDataBanner,
    EmptyState,
    ErrorState,
    LoadingState,
    confirmAction,
    pushSystemNotification,
} from '../components/SystemStates';

const { Text } = Typography;

// Opsi pemilihan kolam di halaman Dashboard
const POND_TABS = [
    { key: 'kontrol', label: 'Kolam A — Kontrol (Timer)', datasetId: 'dst_fde703a09fb3cb06' },
    { key: 'adm', label: 'Kolam B — Perlakuan (ADM)', datasetId: 'dst_1e6020ea929def09' },
];

const NORMAL_BOUNDS = {
    suhu: { min: 24, max: 32, label: '24 – 32 °C' },
    do: { min: 4, max: 8, label: '4 – 8 mg/L' },
    ph: { min: 6.5, max: 8.5, label: '6.5 – 8.5' },
    tds: { min: 400, max: 1500, label: '400 – 1500 ppm' },
};

// Ubah array dari backend [{time: '...', value: 32.4}] menjadi data siap pakai chart
const toSeries = (arr) =>
    (Array.isArray(arr) ? arr : [])
        .map((p) => {
            if (!p || p.value === null || p.value === undefined) return null;
            const d = parseUtc(p.time);
            const v = Number(p.value);
            if (!d || isNaN(v)) return null;
            return { time: d, value: v };
        })
        .filter(Boolean);

// Fungsi hitung kadar NH3 (Emerson et al.) & Penentuan Status Toksisitas
const hitungKadarNH3 = (suhuStr, phStr) => {
    const suhu = parseFloat(suhuStr);
    const ph = parseFloat(phStr);

    if (isNaN(suhu) || isNaN(ph)) {
        return { persen: '—', status: 'Menunggu Data', color: 'var(--text-muted)', badgeStatus: 'default' };
    }

    const pKa = 0.09018 + 2729.92 / (suhu + 273.15);
    const fraksi = 1 / (Math.pow(10, pKa - ph) + 1);
    const persenNum = fraksi * 100;
    const persen = persenNum.toFixed(2);

    if (persenNum < 1) {
        return { persen, status: 'Sangat Rendah', color: 'var(--status-success)', badgeStatus: 'success' };
    }
    if (persenNum <= 3) {
        return { persen, status: 'Aman', color: 'var(--color-adm)', badgeStatus: 'processing' };
    }
    if (persenNum <= 5) {
        return { persen, status: 'Waspada', color: 'var(--status-warning)', badgeStatus: 'warning' };
    }
    return { persen, status: 'Bahaya / Toksik', color: 'var(--status-danger)', badgeStatus: 'error' };
};

// Evaluasi status parameter terhadap rentang normal
const evaluateParamStatus = (key, rawVal) => {
    const num = parseFloat(rawVal);
    const bounds = NORMAL_BOUNDS[key];
    if (isNaN(num) || !bounds) return { status: 'default', text: `Normal: ${bounds?.label || '—'}` };
    if (num < bounds.min) return { status: 'warning', text: `Rendah (< ${bounds.min})` };
    if (num > bounds.max) return { status: 'warning', text: `Tinggi (> ${bounds.max})` };
    return { status: 'success', text: `Optimal (${bounds.label})` };
};

// Komponen Grafik Parameter Individual
const MiniChart = ({ title, data, color = '#4649e5', unit = '', loading = false }) => {
    const latest = data.length ? data[data.length - 1].value : null;

    const values = data.map((d) => d.value);
    const minVal = values.length ? Math.min(...values) : 0;
    const maxVal = values.length ? Math.max(...values) : 10;
    const isConstant = minVal === maxVal;

    const config = {
        data,
        xField: 'time',
        yField: 'value',
        shapeField: 'smooth',
        height: 165,
        autoFit: true,
        style: { stroke: color, lineWidth: 2 },
        scale: {
            y: isConstant
                ? { domain: [Math.max(0, minVal - 2), minVal + 2], nice: true }
                : { nice: true, zero: false },
        },
        axis: {
            x: {
                title: false,
                tickCount: 5,
                labelFormatter: (d) => formatJamWita(d),
                labelFontSize: 10,
                labelFill: '#5b5e8d',
            },
            y: {
                title: false,
                labelFontSize: 10,
                labelFill: '#5b5e8d',
                gridStroke: '#e4e6f5',
                gridLineDash: [3, 3],
            },
        },
        tooltip: {
            title: (d) => `${formatJamWita(d?.time || d)} WITA`,
            items: [{ channel: 'y', name: title, valueFormatter: (v) => `${v} ${unit}`.trim() }],
        },
    };

    return (
        <div className="sf-chart-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span className="sf-metric-label">{title}</span>
                {latest !== null && (
                    <Text strong className="sf-mono" style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                        {latest} <Text type="secondary" style={{ fontSize: 11 }}>{unit}</Text>
                    </Text>
                )}
            </div>
            {loading && !data.length ? (
                <LoadingState compact tip="Memuat grafik..." />
            ) : data.length ? (
                <Line {...config} />
            ) : (
                <EmptyState height={165} title="Belum Ada Data" description="Menunggu rekaman histori 24 jam" />
            )}
        </div>
    );
};

// Komponen Kartu Sensor Minimalis Enterprise
const SensorCard = ({ paramKey, title, value, unit }) => {
    const evalInfo = evaluateParamStatus(paramKey, value);
    return (
        <div className="sf-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span className="sf-metric-label">{title}</span>
            </div>
            <div style={{ margin: '4px 0 10px' }}>
                <span className="sf-metric-value">{value}</span>
                {value !== '—' && unit && <span className="sf-metric-unit">{unit}</span>}
            </div>
            <Badge
                status={evalInfo.status}
                text={<Text style={{ fontSize: 11, color: 'var(--text-muted)' }}>{evalInfo.text}</Text>}
            />
        </div>
    );
};

const Dashboard = () => {
    const [pondType, setPondType] = useState('adm');
    const activePondRef = useRef(pondType);

    const [loadingSensor, setLoadingSensor] = useState(true);
    const [sensorError, setSensorError] = useState(null);
    const [isDataFromCache, setIsDataFromCache] = useState(false);
    const [sensorTimestamp, setSensorTimestamp] = useState(null);

    const [sensorData, setSensorData] = useState({
        suhu: '—',
        do: '—',
        ph: '—',
        tds: '—',
        rule_aktif: '—',
        pakan_gram: 0,
        lbl_suhu: '—',
        lbl_do: '—',
        lbl_ph: '—',
        lbl_tds: '—',
        feeder_g_per_s: 15.0,
    });
    const [nh3Info, setNh3Info] = useState({ persen: '—', status: 'Memuat...', color: 'var(--text-muted)', badgeStatus: 'default' });

    const [manualDuration, setManualDuration] = useState(5);
    const [loadingCmd, setLoadingCmd] = useState(false);
    const [loadingClear, setLoadingClear] = useState(false);
    const [loadingChart, setLoadingChart] = useState(true);
    const [chartData, setChartData] = useState({ suhu: [], do: [], ph: [], tds: [] });
    const [esp32Status, setEsp32Status] = useState({
        is_esp32_online: false,
        local_ip: '192.168.10.30',
        current_command: { action: 'none', duration: 0 },
    });

    const applySensorPayload = useCallback((resData, fromCacheFlag = false) => {
        const d = resData.data || resData;
        const suhuVal = d.suhu !== undefined && d.suhu !== null ? Number(d.suhu).toFixed(1) : '—';
        const doVal = d.do !== undefined && d.do !== null ? Number(d.do).toFixed(1) : '—';
        const phVal = d.ph !== undefined && d.ph !== null ? Number(d.ph).toFixed(2) : '—';
        const tdsVal = d.tds !== undefined && d.tds !== null ? Number(d.tds).toFixed(0) : '—';

        setSensorData({
            suhu: suhuVal,
            do: doVal,
            ph: phVal,
            tds: tdsVal,
            rule_aktif: d.rule_aktif || '—',
            pakan_gram: d.pakan_gram !== undefined && d.pakan_gram !== null ? Number(d.pakan_gram).toFixed(1) : 0,
            lbl_suhu: d.lbl_suhu || '—',
            lbl_do: d.lbl_do || '—',
            lbl_ph: d.lbl_ph || '—',
            lbl_tds: d.lbl_tds || '—',
            feeder_g_per_s: d.feeder_g_per_s !== undefined && d.feeder_g_per_s !== null ? Number(d.feeder_g_per_s) : 15.0,
        });

        const backendPersen = d.kadar_nh3 || resData.kadar_nh3;
        const backendStatus = d.status_nh3 || resData.status_nh3 || resData.status_toksisitas;

        if (backendPersen && backendStatus) {
            let color = 'var(--status-success)';
            let badgeStatus = 'success';
            if (backendStatus.includes('Aman')) {
                color = 'var(--color-adm)';
                badgeStatus = 'processing';
            } else if (backendStatus.includes('Waspada')) {
                color = 'var(--status-warning)';
                badgeStatus = 'warning';
            } else if (backendStatus.includes('Bahaya')) {
                color = 'var(--status-danger)';
                badgeStatus = 'error';
            }
            setNh3Info({
                persen: String(backendPersen).replace('%', ''),
                status: backendStatus,
                color,
                badgeStatus,
            });
        } else {
            setNh3Info(hitungKadarNH3(suhuVal, phVal));
        }

        if (d.timestamp || resData.timestamp) {
            setSensorTimestamp(d.timestamp || resData.timestamp);
        }
        setIsDataFromCache(Boolean(fromCacheFlag));

        // Catat ke Riwayat Notifikasi jika ada parameter kualitas air di luar kategori Normal
        const abnormalParams = [
            { name: 'DO', lbl: d.lbl_do, val: doVal, unit: 'mg/L' },
            { name: 'Suhu', lbl: d.lbl_suhu, val: suhuVal, unit: '°C' },
            { name: 'pH', lbl: d.lbl_ph, val: phVal, unit: '' },
            { name: 'TDS', lbl: d.lbl_tds, val: tdsVal, unit: 'ppm' },
        ].filter((p) => p.lbl && p.lbl !== 'Normal' && p.lbl !== '—');

        if (abnormalParams.length > 0) {
            const summaryStr = abnormalParams
                .map((p) => `${p.name}: ${p.lbl} (${p.val}${p.unit ? ' ' + p.unit : ''})`)
                .join(', ');
            pushSystemNotification({
                id: `param-warn-${activePondRef.current}-${abnormalParams.map((p) => `${p.name}:${p.lbl}`).join('-')}`,
                type: 'info',
                title: 'Klasifikasi Parameter di Luar Normal',
                description: `Terdeteksi parameter perlu perhatian: ${summaryStr}. Sistem ADM otomatis menyesuaikan takaran pakan.`,
                badgeText: `Rule: ${d.rule_aktif || '—'}`,
            });
        }
    }, []);

    // 1. TARIK DATA DASHBOARD SESUAI POND_TYPE
    const fetchLatestSensor = useCallback(
        async (targetPond = activePondRef.current, forceRefresh = false) => {
            try {
                const res = await api.get(`/api/dashboard/${targetPond}`, { forceRefresh });
                if (activePondRef.current !== targetPond) return;

                if (res.data?.status === 'success') {
                    setSensorError(null);
                    applySensorPayload(res.data, res.fromCache);
                } else {
                    setNh3Info({ persen: '—', status: 'Data Tidak Tersedia', color: 'var(--text-muted)', badgeStatus: 'default' });
                }

                if (targetPond === 'adm') {
                    try {
                        const cmdRes = await api.get('/api/command/status', { forceRefresh });
                        if (activePondRef.current === targetPond && cmdRes.data?.status === 'success') {
                            setEsp32Status(cmdRes.data);
                        }
                    } catch {
                        // Abaikan jika endpoint command status belum merespons
                    }
                }
            } catch {
                if (activePondRef.current === targetPond) {
                    setSensorError('Gagal memperbarui telemetri terbaru dari server.');
                }
            } finally {
                if (activePondRef.current === targetPond) {
                    setLoadingSensor(false);
                }
            }
        },
        [applySensorPayload]
    );

    // 2. TARIK HISTORI GRAFIK 24 JAM
    const fetchChartData = useCallback(async (targetPond = activePondRef.current, forceRefresh = false) => {
        try {
            const res = await api.get(`/api/sensor/history/${targetPond}`, { forceRefresh });
            if (activePondRef.current !== targetPond) return;

            if (res.data?.status === 'success') {
                const d = res.data.data || {};
                const parsedSuhu = toSeries(d.suhu);
                const parsedDo = toSeries(d.do);
                const parsedPh = toSeries(d.ph);
                const parsedTds = toSeries(d.tds);

                setChartData({
                    suhu: parsedSuhu,
                    do: parsedDo,
                    ph: parsedPh,
                    tds: parsedTds,
                });

                // Gunakan timestamp titik histori terakhir jika endpoint dashboard tidak menyertakan timestamp eksplisit
                const lastPoint =
                    parsedSuhu[parsedSuhu.length - 1] ||
                    parsedDo[parsedDo.length - 1] ||
                    parsedPh[parsedPh.length - 1] ||
                    parsedTds[parsedTds.length - 1];
                if (lastPoint?.time) {
                    setSensorTimestamp((prev) => prev || lastPoint.time);
                }
            }
        } catch {
            // Error ditangani secara non-intrusif
        } finally {
            if (activePondRef.current === targetPond) {
                setLoadingChart(false);
            }
        }
    }, []);

    // 3. EKSEKUSI PERINTAH SERVO DENGAN DIALOG KONFIRMASI
    const executeCommand = async (action) => {
        setLoadingCmd(true);
        try {
            const duration = manualDuration || 5;
            const res = await api.post('/api/command', { action, duration });
            const cmdId = res.data?.command_id ? ` (ID: ${res.data.command_id.slice(0, 8)})` : '';

            if (action === 'feed') {
                const feederRate = sensorData.feeder_g_per_s || 15.0;
                const gram = Number((duration * feederRate).toFixed(1));
                const s = sensorData;
                const targetGram = s.pakan_gram && s.pakan_gram !== '—' ? Number(s.pakan_gram) : gram;

                try {
                    await api.post('/api/feeding-log', {
                        pond_type: 'adm',
                        target_pakan: targetGram,
                        jumlah_pakan: gram,
                        durasi_servo: duration,
                        status: 'Berhasil',
                        suhu: s.suhu !== '—' ? Number(s.suhu) : 30.0,
                        do: s.do !== '—' ? Number(s.do) : 6.0,
                        ph: s.ph !== '—' ? Number(s.ph) : 7.8,
                        tds: s.tds !== '—' ? Number(s.tds) : 570.0,
                    });
                    message.success(`Perintah pakan (${duration} dtk / ~${gram} g)${cmdId} terkirim & tercatat di Firestore.`);
                } catch {
                    message.success(`Perintah pakan (${duration} detik)${cmdId} telah masuk antrean ESP32.`);
                }
            } else {
                message.success(`Perintah "${action.toUpperCase()}" (${duration} dtk)${cmdId} dikirim ke antrean ESP32.`);
            }

            try {
                const cmdRes = await api.get('/api/command/status', { forceRefresh: true });
                if (cmdRes.data?.status === 'success') {
                    setEsp32Status(cmdRes.data);
                }
            } catch {
                // Abaikan
            }
        } catch (error) {
            const errDetail = error.response?.data?.detail || 'Gagal mengirim perintah. Pastikan sesi admin aktif.';
            message.error(errDetail);
        } finally {
            setLoadingCmd(false);
        }
    };

    const handleConfirmCommand = (action) => {
        const duration = manualDuration || 5;
        const feederRate = sensorData.feeder_g_per_s || 15.0;
        const estGram = Number((duration * feederRate).toFixed(1));

        const labels = {
            open: {
                title: 'Konfirmasi Buka Katup Servo',
                content: `Katup pakan Kolam B (ADM) akan dibuka selama ${duration} detik.`,
            },
            close: {
                title: 'Konfirmasi Tutup Katup Servo',
                content: 'Katup pakan Kolam B (ADM) akan segera ditutup.',
                danger: true,
            },
            feed: {
                title: 'Konfirmasi Eksekusi Pemberian Pakan',
                content: `Sistem akan menjatuhkan pakan selama ${duration} detik (estimasi ~${estGram} gram) pada Kolam B (ADM) dan mencatatnya ke Feeding Log.`,
            },
        };

        const cfg = labels[action];
        confirmAction({
            title: cfg.title,
            content: cfg.content,
            danger: Boolean(cfg.danger),
            okText: 'Eksekusi Sekarang',
            onConfirm: () => executeCommand(action),
        });
    };

    // 4. BATALKAN ANTREAN PERINTAH SERVO
    const clearCommandQueue = () => {
        confirmAction({
            title: 'Batalkan Antrean Perintah Servo?',
            content: 'Perintah servo yang sedang menunggu di antrean akan dihapus dan tidak dieksekusi oleh ESP32.',
            danger: true,
            okText: 'Batalkan Antrean',
            onConfirm: async () => {
                setLoadingClear(true);
                try {
                    await api.post('/api/command/clear');
                    message.success('Antrean perintah servo berhasil dibatalkan.');
                    const cmdRes = await api.get('/api/command/status', { forceRefresh: true });
                    if (cmdRes.data?.status === 'success') {
                        setEsp32Status(cmdRes.data);
                    }
                } catch {
                    message.error('Gagal membatalkan antrean perintah servo.');
                } finally {
                    setLoadingClear(false);
                }
            },
        });
    };

    // Sinkronisasi API setiap kali tab kolam berganti
    useEffect(() => {
        activePondRef.current = pondType;

        const cachedSensor = getCachedData(`/api/dashboard/${pondType}`);
        const cachedHistory = getCachedData(`/api/sensor/history/${pondType}`);

        const syncTimer = setTimeout(() => {
            setSensorError(null);
            if (cachedSensor?.status === 'success') {
                applySensorPayload(cachedSensor, true);
                setLoadingSensor(false);
            } else {
                setLoadingSensor(true);
            }

            if (cachedHistory?.status === 'success') {
                const d = cachedHistory.data || {};
                setChartData({
                    suhu: toSeries(d.suhu),
                    do: toSeries(d.do),
                    ph: toSeries(d.ph),
                    tds: toSeries(d.tds),
                });
                setLoadingChart(false);
            } else {
                setLoadingChart(true);
                setChartData({ suhu: [], do: [], ph: [], tds: [] });
            }

            fetchLatestSensor(pondType, false);
            fetchChartData(pondType, false);
        }, 0);

        const otherPond = pondType === 'adm' ? 'kontrol' : 'adm';
        api.get(`/api/dashboard/${otherPond}`).catch(() => {});
        api.get(`/api/sensor/history/${otherPond}`).catch(() => {});

        const intervalSensor = setInterval(() => fetchLatestSensor(pondType, false), 5000);
        const intervalChart = setInterval(() => fetchChartData(pondType, false), 30000);

        return () => {
            clearTimeout(syncTimer);
            clearInterval(intervalSensor);
            clearInterval(intervalChart);
        };
    }, [pondType, applySensorPayload, fetchLatestSensor, fetchChartData]);

    const activePondMeta = POND_TABS.find((t) => t.key === pondType) || POND_TABS[1];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {sensorError && (
                <ErrorState
                    title="Sinkronisasi Telemetri Terhambat"
                    description={sensorError}
                    onRetry={() => {
                        fetchLatestSensor(pondType, true);
                        fetchChartData(pondType, true);
                    }}
                />
            )}

            <StaleDataBanner
                timestamp={sensorTimestamp}
                isFromCache={isDataFromCache}
                hasNetworkError={Boolean(sensorError)}
                onRefresh={() => {
                    fetchLatestSensor(pondType, true);
                    fetchChartData(pondType, true);
                }}
            />

            {/* BAGIAN 0: PEMILIHAN KOLAM & INDIKATOR KESEGARAN DATA */}
            <Card styles={{ body: { padding: '14px 20px' } }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div role="tablist" aria-label="Pemilihan Kolam" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {POND_TABS.map((tab) => {
                            const isActive = pondType === tab.key;
                            return (
                                <Button
                                    key={tab.key}
                                    role="tab"
                                    aria-selected={isActive}
                                    type={isActive ? 'primary' : 'default'}
                                    onClick={() => setPondType(tab.key)}
                                >
                                    {tab.label}
                                </Button>
                            );
                        })}
                    </div>

                    <Space size="small" wrap>
                        <Tag style={{ margin: 0 }}>
                            Dataset: <span className="sf-mono">{activePondMeta.datasetId}</span>
                        </Tag>
                        <DataFreshnessBadge
                            timestamp={sensorTimestamp}
                            isFromCache={isDataFromCache}
                            hasNetworkError={Boolean(sensorError)}
                        />
                        <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={() => {
                                fetchLatestSensor(pondType, true);
                                fetchChartData(pondType, true);
                            }}
                        >
                            Segarkan
                        </Button>
                    </Space>
                </div>
            </Card>

            {/* BAGIAN 1: 5 KARTU TELEMETRI SENSOR */}
            {loadingSensor && sensorData.suhu === '—' ? (
                <LoadingState rows={2} />
            ) : (
                <div className="sensor-grid">
                    <SensorCard paramKey="suhu" title="Suhu Air" value={sensorData.suhu} unit="°C" />
                    <SensorCard paramKey="do" title="Dissolved Oxygen (DO)" value={sensorData.do} unit="mg/L" />
                    <SensorCard paramKey="ph" title="Derajat Keasaman (pH)" value={sensorData.ph} unit="" />
                    <SensorCard paramKey="tds" title="Total Padatan (TDS)" value={sensorData.tds} unit="ppm" />

                    {/* Kartu Kadar NH3 & Toksisitas */}
                    <div className="sf-metric-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span className="sf-metric-label">Fraksi Amonia (NH₃)</span>
                            <Tooltip title="Dihitung dengan persamaan Emerson dari Suhu dan pH air">
                                <InfoCircleOutlined style={{ color: 'var(--text-muted)', fontSize: 13 }} />
                            </Tooltip>
                        </div>
                        <div style={{ margin: '4px 0 10px' }}>
                            <span className="sf-metric-value" style={{ color: nh3Info.color }}>
                                {nh3Info.persen !== '—' ? `${nh3Info.persen}%` : '—'}
                            </span>
                        </div>
                        <Badge
                            status={nh3Info.badgeStatus}
                            text={<Text strong style={{ color: nh3Info.color, fontSize: 11 }}>{nh3Info.status}</Text>}
                        />
                    </div>
                </div>
            )}

            {/* BAGIAN 2: STATUS KEPUTUSAN FUZZY ADM & KONTROL SERVO (KHUSUS KOLAM B / ADM) */}
            {pondType === 'adm' && (
                <Row gutter={[16, 16]}>
                    {/* Status Fuzzy Sugeno */}
                    <Col xs={24} lg={12}>
                        <Card
                            title={
                                <Space size={8}>
                                    <ThunderboltOutlined style={{ color: 'var(--color-adm)' }} />
                                    <span>Inferensi Sistem Cerdas (Fuzzy Sugeno ADM)</span>
                                </Space>
                            }
                            style={{ height: '100%' }}
                        >
                            <div
                                style={{
                                    background: 'var(--color-adm-bg)',
                                    padding: '14px 16px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-adm-border)',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                                    <Text strong style={{ fontSize: 15, color: 'var(--brand-900)' }}>
                                        Rule Aktif: {sensorData.rule_aktif}
                                    </Text>
                                    <span
                                        style={{
                                            background: 'var(--brand-600)',
                                            color: '#ffffff',
                                            padding: '4px 10px',
                                            borderRadius: 6,
                                            fontSize: 12,
                                            fontWeight: 600,
                                        }}
                                    >
                                        Target: {sensorData.pakan_gram} g / pemberian
                                    </span>
                                </div>
                                <Text style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                                    Rekomendasi takaran pakan dihitung secara otomatis berdasarkan klasifikasi derajat keanggotaan kualitas air saat ini.
                                </Text>
                            </div>

                            <div style={{ marginTop: 16 }}>
                                <span className="sf-metric-label" style={{ display: 'block', marginBottom: 10, color: 'var(--text-secondary)' }}>
                                    Klasifikasi Membership Parameter
                                </span>
                                <Space size={[10, 10]} wrap>
                                    {[
                                        { label: 'DO', val: sensorData.lbl_do },
                                        { label: 'Suhu', val: sensorData.lbl_suhu },
                                        { label: 'pH', val: sensorData.lbl_ph },
                                        { label: 'TDS', val: sensorData.lbl_tds },
                                    ].map((m) => {
                                        const isNormal = m.val === 'Normal';
                                        const isEmpty = !m.val || m.val === '—';
                                        const variantClass = isNormal
                                            ? 'sf-membership-pill--normal'
                                            : isEmpty
                                              ? 'sf-membership-pill--neutral'
                                              : 'sf-membership-pill--warning';
                                        const dotClass = isNormal
                                            ? 'sf-dot--live'
                                            : isEmpty
                                              ? ''
                                              : 'sf-dot--stale';

                                        return (
                                            <span key={m.label} className={`sf-membership-pill ${variantClass}`}>
                                                <span
                                                    className={`sf-dot ${dotClass}`}
                                                    style={isEmpty ? { backgroundColor: '#94a3b8' } : undefined}
                                                />
                                                <span style={{ color: '#1b1c4b', fontWeight: 600 }}>{m.label}:</span>
                                                <span style={{ fontWeight: 700 }}>{m.val}</span>
                                            </span>
                                        );
                                    })}
                                </Space>
                            </div>
                        </Card>
                    </Col>

                    {/* Kontrol Manual Servo & Antrean */}
                    <Col xs={24} lg={12}>
                        <Card
                            title={
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                    <Space size={8}>
                                        <SettingOutlined style={{ color: 'var(--text-secondary)' }} />
                                        <span>Kendali Aktuator Servo & Antrean</span>
                                    </Space>
                                    {esp32Status.is_esp32_online ? (
                                        <span className="sf-status-pill sf-status-pill--live">
                                            <span className="sf-dot sf-dot--live" />
                                            <span>ESP32 Online</span>
                                        </span>
                                    ) : (
                                        <Tooltip title={`Menunggu koneksi mikrokontroler ESP32 ke server (${esp32Status.local_ip || '192.168.10.30'}:8000)`}>
                                            <span className="sf-status-pill sf-status-pill--stale">
                                                <span className="sf-dot sf-dot--stale" />
                                                <span>ESP32 Standby / Offline</span>
                                            </span>
                                        </Tooltip>
                                    )}
                                </div>
                            }
                            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                            styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 } }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {/* Baris 1: Kontrol Katup Manual (Simetris 50% : 50%) */}
                                <Row gutter={[12, 12]}>
                                    <Col xs={24} sm={12}>
                                        <Button
                                            icon={<PlayCircleOutlined />}
                                            onClick={() => handleConfirmCommand('open')}
                                            block
                                            loading={loadingCmd}
                                            style={{ height: 40, fontWeight: 600 }}
                                        >
                                            Buka Katup
                                        </Button>
                                    </Col>
                                    <Col xs={24} sm={12}>
                                        <Button
                                            danger
                                            icon={<PauseCircleOutlined />}
                                            onClick={() => handleConfirmCommand('close')}
                                            block
                                            loading={loadingCmd}
                                            style={{ height: 40, fontWeight: 600 }}
                                        >
                                            Tutup Katup
                                        </Button>
                                    </Col>
                                </Row>

                                {/* Baris 2: Input Durasi & Eksekusi Pakan (Simetris 50% : 50% Sejajar Baris 1) */}
                                <Row gutter={[12, 12]}>
                                    <Col xs={24} sm={12}>
                                        <InputNumber
                                            min={1}
                                            max={60}
                                            value={manualDuration}
                                            onChange={setManualDuration}
                                            prefix={
                                                <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, marginRight: 6 }}>
                                                    Durasi:
                                                </span>
                                            }
                                            suffix={
                                                <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>
                                                    detik
                                                </span>
                                            }
                                            style={{ width: '100%', height: 40, display: 'flex', alignItems: 'center' }}
                                        />
                                    </Col>
                                    <Col xs={24} sm={12}>
                                        <Button
                                            type="primary"
                                            icon={<ExperimentOutlined />}
                                            onClick={() => handleConfirmCommand('feed')}
                                            loading={loadingCmd}
                                            block
                                            style={{ height: 40, fontWeight: 600 }}
                                        >
                                            Beri Pakan (~{((manualDuration || 5) * (sensorData.feeder_g_per_s || 15)).toFixed(0)} g)
                                        </Button>
                                    </Col>
                                </Row>
                            </div>

                            {/* Baris 3: Bar Status Endpoint & Antrean Perintah */}
                            {esp32Status.current_command?.action && esp32Status.current_command.action !== 'none' ? (
                                <div
                                    style={{
                                        background: 'var(--color-adm-bg)',
                                        border: '1px solid var(--color-adm-border)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '10px 14px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 8,
                                    }}
                                >
                                    <div>
                                        <Badge
                                            status="processing"
                                            text={
                                                <Text strong style={{ fontSize: 12, color: 'var(--brand-900)' }}>
                                                    Antrean Aktif: {esp32Status.current_command.action.toUpperCase()} ({esp32Status.current_command.duration} dtk)
                                                </Text>
                                            }
                                        />
                                        {esp32Status.current_command.command_id && (
                                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                                                ID: {esp32Status.current_command.command_id.slice(0, 8)} • Status: {esp32Status.current_command.status || 'pending'}
                                            </Text>
                                        )}
                                    </div>
                                    <Button size="small" danger onClick={clearCommandQueue} loading={loadingClear}>
                                        Batalkan
                                    </Button>
                                </div>
                            ) : (
                                <div
                                    style={{
                                        background: 'var(--bg-subtle)',
                                        border: '1px solid var(--border-subtle)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '10px 14px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 8,
                                    }}
                                >
                                    <Text style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        Endpoint Gateway:{' '}
                                        <Text strong className="sf-mono" style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                                            {esp32Status.local_ip || '192.168.10.30'}:8000
                                        </Text>
                                    </Text>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Antrean Perintah:</span>
                                        <span className="sf-dot sf-dot--live" />
                                        <Text strong style={{ fontSize: 12, color: '#065f46' }}>
                                            Kosong (Siap)
                                        </Text>
                                    </span>
                                </div>
                            )}
                        </Card>
                    </Col>
                </Row>
            )}

            {/* BAGIAN 3: GRAFIK TREN KUALITAS AIR 24 JAM TERAKHIR */}
            <Card
                title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <span>Tren Kualitas Air 24 Jam Terakhir — {activePondMeta.label}</span>
                        <Tag style={{ margin: 0 }}>Sumber: Raspberry Pi Gateway</Tag>
                    </div>
                }
            >
                <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                        <MiniChart title="Suhu Air (°C)" data={chartData.suhu} color="#4649e5" unit="°C" loading={loadingChart} />
                    </Col>
                    <Col xs={24} md={12}>
                        <MiniChart title="Dissolved Oxygen / DO (mg/L)" data={chartData.do} color="#059669" unit="mg/L" loading={loadingChart} />
                    </Col>
                    <Col xs={24} md={12}>
                        <MiniChart title="Derajat Keasaman (pH)" data={chartData.ph} color="#d97706" unit="" loading={loadingChart} />
                    </Col>
                    <Col xs={24} md={12}>
                        <MiniChart title="Total Padatan Terlarut / TDS (ppm)" data={chartData.tds} color="#3032a3" unit="ppm" loading={loadingChart} />
                    </Col>
                </Row>
            </Card>
        </div>
    );
};

export default Dashboard;

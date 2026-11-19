import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, Row, Col, Typography, Form, InputNumber, Button, message, Statistic, Divider, Tag, Space, Tooltip } from 'antd';
import {
    SaveOutlined,
    ThunderboltOutlined,
    CloudSyncOutlined,
    ReloadOutlined,
    CheckCircleOutlined,
    InfoCircleOutlined,
    AimOutlined,
} from '@ant-design/icons';
import api, { getCachedData, invalidateCache } from '../api';
import { formatDateTimeWita } from '../utils/time';
import { ErrorState, confirmAction } from '../components/SystemStates';

const { Text } = Typography;

const roundVal = (val, dec = 2) => Number(Number(val || 0).toFixed(dec));

const POND_TABS = [
    { key: 'kontrol', label: 'Kolam A — Kontrol', docName: 'settings/calibration_kontrol' },
    { key: 'adm', label: 'Kolam B — Perlakuan (ADM)', docName: 'settings/calibration' },
];

const Settings = () => {
    const [form] = Form.useForm();
    const [pondType, setPondType] = useState('adm');
    const activePondRef = useRef(pondType);

    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState(null);

    const initialDash = getCachedData(`/api/dashboard/${pondType}`)?.data || getCachedData(`/api/dashboard/${pondType}`) || {};
    const [rawVoltage, setRawVoltage] = useState({
        v_ph: initialDash.v_ph ?? 0.0,
        v_tds: initialDash.v_tds ?? 0.0,
        suhu: initialDash.suhu ?? 0.0,
        ph: initialDash.ph ?? 0.0,
        tds: initialDash.tds ?? 0,
        raw_suhu: initialDash.raw_suhu ?? initialDash.suhu ?? 0.0,
        raw_ph: initialDash.raw_ph ?? initialDash.ph ?? 0.0,
        raw_tds: initialDash.raw_tds ?? initialDash.tds ?? 0,
        is_telemetry_synced: initialDash.is_telemetry_synced ?? false,
        timestamp: initialDash.timestamp || null,
    });
    const [updatedAt, setUpdatedAt] = useState(() => getCachedData(`/api/calibration/${pondType}`)?.updated_at || null);
    const [localIp, setLocalIp] = useState(() => getCachedData(`/api/calibration/${pondType}`)?.local_ip || null);
    const [lastDeviceSync, setLastDeviceSync] = useState(() => getCachedData(`/api/calibration/${pondType}`)?.last_device_sync || null);

    // Watch nilai form untuk menampilkan preview hasil kalibrasi secara real-time
    const watchedOffsetSuhu = Form.useWatch('offset_suhu', form);
    const watchedPh401 = Form.useWatch('ph_401', form);
    const watchedPh686 = Form.useWatch('ph_686', form);
    const watchedPh918 = Form.useWatch('ph_918', form);
    const watchedTdsK = Form.useWatch('tds_k', form);

    const fetchRawSensors = useCallback(async (targetPond = activePondRef.current, forceRefresh = false) => {
        try {
            const response = await api.get(`/api/dashboard/${targetPond}`, { forceRefresh });
            if (activePondRef.current !== targetPond) return;
            if (response.data?.status === 'success') {
                const d = response.data.data || response.data;
                setRawVoltage({
                    v_ph: d.v_ph ?? 0.0,
                    v_tds: d.v_tds ?? 0.0,
                    suhu: d.suhu ?? 0.0,
                    ph: d.ph ?? 0.0,
                    tds: d.tds ?? 0,
                    raw_suhu: d.raw_suhu ?? d.suhu ?? 0.0,
                    raw_ph: d.raw_ph ?? d.ph ?? 0.0,
                    raw_tds: d.raw_tds ?? d.tds ?? 0,
                    is_telemetry_synced: Boolean(d.is_telemetry_synced),
                    timestamp: d.timestamp || null,
                });
            }
        } catch {
            // Abaikan error polling latar belakang
        }
    }, []);

    const fetchCalibration = useCallback(
        async (targetPond = activePondRef.current, forceRefresh = false) => {
            setFetchError(null);
            try {
                const response = await api.get(`/api/calibration/${targetPond}`, { forceRefresh });
                if (activePondRef.current !== targetPond) return;
                if (response.data) {
                    form.setFieldsValue({
                        offset_suhu: response.data.offset_suhu,
                        ph_401: response.data.ph_401,
                        ph_686: response.data.ph_686,
                        ph_918: response.data.ph_918,
                        tds_k: response.data.tds_k,
                        feeder_g_per_s: response.data.feeder_g_per_s ?? (targetPond === 'adm' ? 5.0 : 0.0),
                        jam_pakan_1: response.data.jam_pakan_1 ?? 9,
                        menit_pakan_1: response.data.menit_pakan_1 ?? 0,
                        jam_pakan_2: response.data.jam_pakan_2 ?? 15,
                        menit_pakan_2: response.data.menit_pakan_2 ?? 0,
                    });
                    setUpdatedAt(response.data.updated_at || null);
                    setLocalIp(response.data.local_ip || null);
                    setLastDeviceSync(response.data.last_device_sync || null);
                }
            } catch {
                if (activePondRef.current === targetPond) {
                    setFetchError('Gagal menarik parameter kalibrasi dari Cloud Firestore.');
                }
            }
        },
        [form]
    );

    useEffect(() => {
        activePondRef.current = pondType;

        const initTimer = setTimeout(() => {
            const cachedDash = getCachedData(`/api/dashboard/${pondType}`)?.data || getCachedData(`/api/dashboard/${pondType}`);
            if (cachedDash) {
                setRawVoltage({
                    v_ph: cachedDash.v_ph ?? 0.0,
                    v_tds: cachedDash.v_tds ?? 0.0,
                    suhu: cachedDash.suhu ?? 0.0,
                    ph: cachedDash.ph ?? 0.0,
                    tds: cachedDash.tds ?? 0,
                    raw_suhu: cachedDash.raw_suhu ?? cachedDash.suhu ?? 0.0,
                    raw_ph: cachedDash.raw_ph ?? cachedDash.ph ?? 0.0,
                    raw_tds: cachedDash.raw_tds ?? cachedDash.tds ?? 0,
                    is_telemetry_synced: Boolean(cachedDash.is_telemetry_synced),
                    timestamp: cachedDash.timestamp || null,
                });
            } else {
                setRawVoltage({
                    v_ph: 0.0,
                    v_tds: 0.0,
                    suhu: 0.0,
                    ph: 0.0,
                    tds: 0,
                    raw_suhu: 0.0,
                    raw_ph: 0.0,
                    raw_tds: 0,
                    is_telemetry_synced: false,
                    timestamp: null,
                });
            }
            fetchCalibration(pondType, false);
            fetchRawSensors(pondType, true);
        }, 0);
        const interval = setInterval(() => fetchRawSensors(pondType, true), 5000);
        return () => {
            clearTimeout(initTimer);
            clearInterval(interval);
        };
    }, [pondType, fetchCalibration, fetchRawSensors]);

    // Kalkulasi preview langsung (identik dengan algoritma di ESP32 & FastAPI)
    const livePreview = useMemo(() => {
        const offset = Number(watchedOffsetSuhu ?? 0);
        const p401 = Number(watchedPh401 ?? 1.4638);
        const p686 = Number(watchedPh686 ?? 1.7832);
        const p918 = Number(watchedPh918 ?? 1.9691);
        const kVal = Number(watchedTdsK ?? 1.0);

        const baseRawTemp = Number(rawVoltage.raw_suhu || 25.0);
        const estSuhu = rawVoltage.is_telemetry_synced
            ? roundVal(baseRawTemp, 1)
            : pondType === 'adm'
            ? roundVal(baseRawTemp - 0.25 + offset, 1)
            : roundVal(baseRawTemp + offset, 1);

        let estPh = rawVoltage.ph || 0;
        const vPh = Number(rawVoltage.v_ph || 0);
        if (vPh > 0) {
            const faktorSuhu = (estSuhu + 273.15) / 298.15;
            if (vPh < p686) {
                if (Math.abs(p686 - p401) > 0.0001) {
                    const slopeAcid = ((6.86 - 4.01) / (p686 - p401)) * faktorSuhu;
                    estPh = 6.86 + slopeAcid * (vPh - p686);
                } else {
                    estPh = 6.86;
                }
            } else {
                if (Math.abs(p918 - p686) > 0.0001) {
                    const slopeBase = ((9.18 - 6.86) / (p918 - p686)) * faktorSuhu;
                    estPh = 6.86 + slopeBase * (vPh - p686);
                } else {
                    estPh = 6.86;
                }
            }
            estPh = Math.max(0, Math.min(14, Number(estPh.toFixed(2))));
        }

        let estTds = rawVoltage.tds || 0;
        const vTds = Number(rawVoltage.v_tds || 0);
        if (vTds > 0) {
            const tempCoef = 1.0 + 0.02 * (estSuhu - 25.0);
            const vComp = tempCoef !== 0 ? vTds / tempCoef : vTds;
            const rawTdsCalc = 133.42 * Math.pow(vComp, 3) - 255.86 * Math.pow(vComp, 2) + 857.39 * vComp;
            estTds = Math.round(Math.max(0, rawTdsCalc * kVal));
        }

        return { suhu: estSuhu, ph: estPh, tds: estTds };
    }, [watchedOffsetSuhu, watchedPh401, watchedPh686, watchedPh918, watchedTdsK, rawVoltage, pondType]);

    const saveCalibration = async (values) => {
        setLoading(true);
        try {
            const payload = {
                ...values,
                feeder_g_per_s: values.feeder_g_per_s ?? (pondType === 'adm' ? 5.0 : 0.0),
            };
            const res = await api.post(`/api/calibration/${pondType}`, payload);
            invalidateCache('/api/dashboard');
            invalidateCache('/api/sensor');
            message.success(res.data?.message || 'Parameter kalibrasi berhasil disimpan ke Cloud Firestore.');
            await Promise.all([fetchCalibration(pondType, true), fetchRawSensors(pondType, true)]);
        } catch (error) {
            const errDetail = error.response?.data?.detail || 'Gagal menyimpan kalibrasi. Pastikan sesi admin aktif.';
            message.error(errDetail);
        } finally {
            setLoading(false);
        }
    };

    const handleUseCurrentVoltage = (fieldName, label) => {
        if (!rawVoltage.v_ph || rawVoltage.v_ph <= 0) {
            message.warning('Tegangan v_ph saat ini belum terbaca dari sensor.');
            return;
        }
        const roundedV = Number(Number(rawVoltage.v_ph).toFixed(4));
        form.setFieldsValue({ [fieldName]: roundedV });
        message.info(`Tegangan ${roundedV} V disalin ke ${label}. Klik Simpan Konfigurasi untuk menerapkan.`);
    };

    const onFinish = (values) => {
        const pondLabel = pondType === 'kontrol' ? 'Kolam A (Kontrol)' : 'Kolam B (ADM)';
        confirmAction({
            title: `Simpan Kalibrasi ${pondLabel}?`,
            content:
                pondType === 'kontrol'
                    ? 'Nilai kalibrasi sensor (pH, TDS, Suhu) akan langsung diterapkan pada Cloud Firestore serta perangkat ESP32 Kolam A.'
                    : 'Nilai kalibrasi sensor, laju lontaran servo, dan jadwal pakan baru akan langsung diterapkan pada Cloud Firestore serta perangkat ESP32 Kolam B.',
            okText: 'Simpan Konfigurasi',
            onConfirm: () => saveCalibration(values),
        });
    };

    const activePondMeta = POND_TABS.find((t) => t.key === pondType) || POND_TABS[1];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {fetchError && (
                <ErrorState
                    title="Sinkronisasi Kalibrasi Gagal"
                    description={fetchError}
                    onRetry={() => fetchCalibration(pondType, true)}
                />
            )}

            {/* PEMILIHAN KOLAM UNTUK KALIBRASI */}
            <Card styles={{ body: { padding: '14px 20px' } }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div role="tablist" aria-label="Pilih Kolam Kalibrasi" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                        {localIp && (
                            <Tooltip title="Alamat IP lokal server FastAPI saat ini">
                                <Tag style={{ margin: 0, padding: '4px 10px' }}>
                                    IP Backend: <span className="sf-mono">{localIp}:8000</span>
                                </Tag>
                            </Tooltip>
                        )}
                        {lastDeviceSync && (
                            <Tag color="green" style={{ margin: 0, padding: '4px 10px' }}>
                                Sync ESP32: <span className="sf-mono">{formatDateTimeWita(lastDeviceSync)}</span>
                            </Tag>
                        )}
                        {updatedAt && (
                            <Tag icon={<CloudSyncOutlined />} color="blue" style={{ margin: 0, padding: '4px 10px' }}>
                                Tersinkron: <span className="sf-mono">{formatDateTimeWita(updatedAt)}</span>
                            </Tag>
                        )}
                        <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={() => {
                                fetchCalibration(pondType, true);
                                fetchRawSensors(pondType, true);
                            }}
                        >
                            Muat Ulang
                        </Button>
                    </Space>
                </div>
            </Card>

            {/* BANNER STATUS SINKRONISASI TELEMETRI RASPI & CLOUD FIRESTORE */}
            <div
                className={`sf-status-banner ${rawVoltage.is_telemetry_synced ? 'sf-status-banner-success' : 'sf-status-banner-info'}`}
                style={{
                    background: rawVoltage.is_telemetry_synced ? 'var(--status-success-bg)' : 'var(--status-info-bg)',
                    border: `1px solid ${rawVoltage.is_telemetry_synced ? 'var(--status-success-border)' : 'var(--status-info-border)'}`,
                }}
            >
                {rawVoltage.is_telemetry_synced ? (
                    <CheckCircleOutlined className="sf-status-icon" style={{ color: '#059669', fontSize: 18 }} />
                ) : (
                    <InfoCircleOutlined className="sf-status-icon" style={{ color: 'var(--brand-600)', fontSize: 18 }} />
                )}
                <div style={{ color: rawVoltage.is_telemetry_synced ? '#065f46' : '#1e1b4b', fontSize: 13, lineHeight: '20px' }}>
                    <strong>Sinkronisasi Kalibrasi Dua Jalur (FastAPI Lokal & Cloud Firestore) — {activePondMeta.label}:</strong>{' '}
                    Perubahan parameter disimpan ke Cloud Firestore (<span className="sf-mono">{activePondMeta.docName}</span>) dan otomatis ditarik oleh ESP32 baik melalui FastAPI lokal maupun langsung dari Cloud Firestore REST API setiap siklus pembacaan.{' '}
                    {rawVoltage.is_telemetry_synced ? (
                        <strong style={{ color: '#047857' }}>
                            Paket telemetri terakhir di Raspi Gateway sudah menggunakan parameter kalibrasi terbaru.
                        </strong>
                    ) : (
                        <span>
                            Paket telemetri terakhir di Raspi (<span className="sf-mono">pH={rawVoltage.raw_ph}, TDS={rawVoltage.raw_tds} ppm, Suhu={rawVoltage.raw_suhu}°C</span>) akan diperbarui pada siklus pengiriman 5 menit berikutnya setelah ESP32 menyinkronkan konfigurasi ini.
                        </span>
                    )}
                </div>
            </div>

            <Form form={form} layout="vertical" onFinish={onFinish}>
                <Row gutter={[16, 16]}>
                    {/* PANEL pH */}
                    <Col xs={24} md={12}>
                        <Card title="1. Kalibrasi Sensor pH (3-Point Buffer)" style={{ height: '100%' }}>
                            <Row gutter={12}>
                                <Col span={8}>
                                    <Statistic
                                        title="Tegangan (v_ph)"
                                        value={rawVoltage.v_ph}
                                        precision={4}
                                        suffix="V"
                                        valueStyle={{ fontSize: 18 }}
                                        prefix={<ThunderboltOutlined style={{ color: 'var(--status-warning)' }} />}
                                    />
                                </Col>
                                <Col span={8}>
                                    <Statistic
                                        title="Telemetri Raspi"
                                        value={rawVoltage.raw_ph}
                                        precision={2}
                                        valueStyle={{ fontSize: 18, color: 'var(--text-secondary)' }}
                                    />
                                </Col>
                                <Col span={8}>
                                    <Statistic
                                        title="Preview Kalibrasi"
                                        value={livePreview.ph}
                                        precision={2}
                                        valueStyle={{ fontSize: 18, color: 'var(--color-adm)', fontWeight: 700 }}
                                    />
                                </Col>
                            </Row>
                            <Divider style={{ margin: '14px 0' }} />
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                Celupkan probe ke larutan buffer standar, tunggu tegangan stabil, lalu masukkan atau salin nilai tegangan pada masing-masing titik buffer.
                            </Text>
                            <Row gutter={12}>
                                <Col xs={24} sm={8}>
                                    <Form.Item name="ph_401" label="Buffer pH 4.01 (V)" style={{ marginBottom: 6 }}>
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                    <Button
                                        size="small"
                                        type="dashed"
                                        icon={<AimOutlined />}
                                        block
                                        onClick={() => handleUseCurrentVoltage('ph_401', 'Buffer pH 4.01')}
                                        style={{ fontSize: 11, marginBottom: 8 }}
                                    >
                                        Gunakan v_ph Saat Ini
                                    </Button>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <Form.Item name="ph_686" label="Buffer pH 6.86 (V)" style={{ marginBottom: 6 }}>
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                    <Button
                                        size="small"
                                        type="dashed"
                                        icon={<AimOutlined />}
                                        block
                                        onClick={() => handleUseCurrentVoltage('ph_686', 'Buffer pH 6.86')}
                                        style={{ fontSize: 11, marginBottom: 8 }}
                                    >
                                        Gunakan v_ph Saat Ini
                                    </Button>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <Form.Item name="ph_918" label="Buffer pH 9.18 (V)" style={{ marginBottom: 6 }}>
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                    <Button
                                        size="small"
                                        type="dashed"
                                        icon={<AimOutlined />}
                                        block
                                        onClick={() => handleUseCurrentVoltage('ph_918', 'Buffer pH 9.18')}
                                        style={{ fontSize: 11, marginBottom: 8 }}
                                    >
                                        Gunakan v_ph Saat Ini
                                    </Button>
                                </Col>
                            </Row>
                        </Card>
                    </Col>

                    {/* PANEL TDS */}
                    <Col xs={24} md={12}>
                        <Card title="2. Kalibrasi Sensor TDS" style={{ height: '100%' }}>
                            <Row gutter={12}>
                                <Col span={8}>
                                    <Statistic
                                        title="Tegangan (v_tds)"
                                        value={rawVoltage.v_tds}
                                        precision={4}
                                        suffix="V"
                                        valueStyle={{ fontSize: 18 }}
                                        prefix={<ThunderboltOutlined style={{ color: 'var(--status-warning)' }} />}
                                    />
                                </Col>
                                <Col span={8}>
                                    <Statistic
                                        title="Telemetri Raspi"
                                        value={rawVoltage.raw_tds}
                                        precision={0}
                                        suffix="ppm"
                                        valueStyle={{ fontSize: 18, color: 'var(--text-secondary)' }}
                                    />
                                </Col>
                                <Col span={8}>
                                    <Statistic
                                        title="Preview Kalibrasi"
                                        value={livePreview.tds}
                                        precision={0}
                                        suffix="ppm"
                                        valueStyle={{ fontSize: 18, color: 'var(--color-adm)', fontWeight: 700 }}
                                    />
                                </Col>
                            </Row>
                            <Divider style={{ margin: '14px 0' }} />
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                Bandingkan pembacaan ppm dengan TDS meter acuan, lalu sesuaikan faktor pengali K-Value.
                            </Text>
                            <Form.Item name="tds_k" label="K-Value (Faktor Pengali)">
                                <InputNumber style={{ width: '100%' }} step="0.01" />
                            </Form.Item>
                        </Card>
                    </Col>

                    {/* PANEL SUHU */}
                    <Col xs={24} md={pondType === 'adm' ? 12 : 24}>
                        <Card title="3. Kalibrasi Sensor Suhu (DS18B20)" style={{ height: '100%' }}>
                            <Row gutter={12} style={{ marginBottom: 12 }}>
                                <Col span={12}>
                                    <Statistic
                                        title="Suhu di Telemetri Raspi"
                                        value={rawVoltage.raw_suhu}
                                        precision={1}
                                        suffix="°C"
                                        valueStyle={{ fontSize: 18, color: 'var(--text-secondary)' }}
                                    />
                                </Col>
                                <Col span={12}>
                                    <Statistic
                                        title="Preview Suhu Terkalibrasi"
                                        value={livePreview.suhu}
                                        precision={1}
                                        suffix="°C"
                                        valueStyle={{ fontSize: 18, color: 'var(--color-adm)', fontWeight: 700 }}
                                    />
                                </Col>
                            </Row>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                Gunakan nilai Offset Suhu untuk mengoreksi selisih pembacaan suhu terhadap termometer standar laboratorium.
                            </Text>
                            <Form.Item name="offset_suhu" label="Offset Koreksi Suhu (°C)">
                                <InputNumber style={{ width: '100%' }} step="0.05" addonAfter="°C" />
                            </Form.Item>
                        </Card>
                    </Col>

                    {/* PANEL SERVO FEEDER & JADWAL PAKAN (KHUSUS KOLAM B / ADM) */}
                    {pondType === 'adm' && (
                        <>
                            <Col xs={24} md={12}>
                                <Card title="4. Kalibrasi Laju Lontaran Servo Feeder" style={{ height: '100%' }}>
                                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                        Tentukan berat pakan (gram) yang berhasil dikeluarkan oleh katup mekanisme servo per 1 detik bukaan penuh.
                                    </Text>
                                    <Form.Item name="feeder_g_per_s" label="Kapasitas Bukaan (Gram / Detik)">
                                        <InputNumber style={{ width: '100%' }} min={0.1} step="0.1" addonAfter="g / dtk" />
                                    </Form.Item>
                                </Card>
                            </Col>

                            <Col xs={24}>
                                <Card title="5. Jadwal Pemberian Pakan Otomatis Harian (Zona Waktu WITA)">
                                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
                                        Atur waktu eksekusi pemberian pakan terjadwal untuk Sesi 1 (Pagi) dan Sesi 2 (Sore) dalam Waktu Indonesia Tengah (WITA).
                                    </Text>
                                    <Row gutter={[24, 16]}>
                                        <Col xs={24} md={12}>
                                            <div style={{ padding: 14, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                                <Text strong style={{ display: 'block', marginBottom: 10, color: 'var(--color-adm)' }}>
                                                    Sesi 1 — Jadwal Pagi
                                                </Text>
                                                <Row gutter={12}>
                                                    <Col span={12}>
                                                        <Form.Item name="jam_pakan_1" label="Jam (0–23)" style={{ marginBottom: 0 }}>
                                                            <InputNumber min={0} max={23} style={{ width: '100%' }} />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={12}>
                                                        <Form.Item name="menit_pakan_1" label="Menit (0–59)" style={{ marginBottom: 0 }}>
                                                            <InputNumber min={0} max={59} style={{ width: '100%' }} />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                            </div>
                                        </Col>
                                        <Col xs={24} md={12}>
                                            <div style={{ padding: 14, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                                <Text strong style={{ display: 'block', marginBottom: 10, color: 'var(--text-secondary)' }}>
                                                    Sesi 2 — Jadwal Sore
                                                </Text>
                                                <Row gutter={12}>
                                                    <Col span={12}>
                                                        <Form.Item name="jam_pakan_2" label="Jam (0–23)" style={{ marginBottom: 0 }}>
                                                            <InputNumber min={0} max={23} style={{ width: '100%' }} />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col span={12}>
                                                        <Form.Item name="menit_pakan_2" label="Menit (0–59)" style={{ marginBottom: 0 }}>
                                                            <InputNumber min={0} max={59} style={{ width: '100%' }} />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                            </div>
                                        </Col>
                                    </Row>
                                </Card>
                            </Col>
                        </>
                    )}
                </Row>

                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading} size="large">
                        {pondType === 'kontrol' ? 'Simpan Parameter Kalibrasi Kolam A' : 'Simpan Parameter Kalibrasi & Jadwal'}
                    </Button>
                </div>
            </Form>
        </div>
    );
};

export default Settings;

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Row, Col, Typography, Form, InputNumber, Button, message, Statistic, Divider, Alert, Tag, Space } from 'antd';
import { SaveOutlined, ThunderboltOutlined, CloudSyncOutlined, ReloadOutlined } from '@ant-design/icons';
import api, { getCachedData } from '../api';
import { formatDateTimeWita } from '../utils/time';
import { ErrorState, confirmAction } from '../components/SystemStates';

const { Text } = Typography;

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
        v_ph: initialDash.v_ph || 0.0,
        v_tds: initialDash.v_tds || 0.0,
        suhu: initialDash.suhu || 0.0,
        ph: initialDash.ph || 0.0,
        tds: initialDash.tds || 0,
    });
    const [updatedAt, setUpdatedAt] = useState(() => getCachedData(`/api/calibration/${pondType}`)?.updated_at || null);

    const fetchRawSensors = useCallback(async (targetPond = activePondRef.current) => {
        try {
            const response = await api.get(`/api/dashboard/${targetPond}`);
            if (activePondRef.current !== targetPond) return;
            if (response.data?.status === 'success') {
                const d = response.data.data || response.data;
                setRawVoltage({
                    v_ph: d.v_ph || 0.0,
                    v_tds: d.v_tds || 0.0,
                    suhu: d.suhu || 0.0,
                    ph: d.ph || 0.0,
                    tds: d.tds || 0,
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
                        feeder_g_per_s: response.data.feeder_g_per_s ?? (targetPond === 'adm' ? 15.0 : 0.0),
                        jam_pakan_1: response.data.jam_pakan_1 ?? 9,
                        menit_pakan_1: response.data.menit_pakan_1 ?? 0,
                        jam_pakan_2: response.data.jam_pakan_2 ?? 16,
                        menit_pakan_2: response.data.menit_pakan_2 ?? 0,
                    });
                    setUpdatedAt(response.data.updated_at || null);
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
                    v_ph: cachedDash.v_ph || 0.0,
                    v_tds: cachedDash.v_tds || 0.0,
                    suhu: cachedDash.suhu || 0.0,
                    ph: cachedDash.ph || 0.0,
                    tds: cachedDash.tds || 0,
                });
            } else {
                setRawVoltage({ v_ph: 0.0, v_tds: 0.0, suhu: 0.0, ph: 0.0, tds: 0 });
            }
            fetchCalibration(pondType, false);
            fetchRawSensors(pondType);
        }, 0);
        const interval = setInterval(() => fetchRawSensors(pondType), 5000);
        return () => {
            clearTimeout(initTimer);
            clearInterval(interval);
        };
    }, [pondType, fetchCalibration, fetchRawSensors]);

    const saveCalibration = async (values) => {
        setLoading(true);
        try {
            const payload = {
                ...values,
                feeder_g_per_s: values.feeder_g_per_s ?? (pondType === 'adm' ? 15.0 : 0.0),
            };
            const res = await api.post(`/api/calibration/${pondType}`, payload);
            message.success(res.data?.message || 'Parameter kalibrasi berhasil disimpan ke Cloud Firestore.');
            await fetchCalibration(pondType, true);
        } catch (error) {
            const errDetail = error.response?.data?.detail || 'Gagal menyimpan kalibrasi. Pastikan sesi admin aktif.';
            message.error(errDetail);
        } finally {
            setLoading(false);
        }
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
                        {updatedAt && (
                            <Tag icon={<CloudSyncOutlined />} color="blue" style={{ margin: 0, padding: '4px 10px' }}>
                                Tersinkron: <span className="sf-mono">{formatDateTimeWita(updatedAt)}</span>
                            </Tag>
                        )}
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchCalibration(pondType, true)}>
                            Muat Ulang
                        </Button>
                    </Space>
                </div>
            </Card>

            <Alert
                message={`Sinkronisasi Tegangan Mentah Real-Time — ${activePondMeta.label}`}
                description={`Nilai tegangan mentah (Raw Voltage) sensor diperbarui setiap 5 detik dari telemetri ESP32 ${activePondMeta.label}. Perubahan parameter langsung aktif di Cloud Firestore (${activePondMeta.docName}).`}
                type="info"
                showIcon
            />

            <Form form={form} layout="vertical" onFinish={onFinish}>
                <Row gutter={[16, 16]}>
                    {/* PANEL pH */}
                    <Col xs={24} md={12}>
                        <Card title="1. Kalibrasi Sensor pH (3-Point Buffer)" style={{ height: '100%' }}>
                            <Statistic
                                title="Tegangan Mentah Saat Ini (v_ph)"
                                value={rawVoltage.v_ph}
                                precision={4}
                                suffix="V"
                                prefix={<ThunderboltOutlined style={{ color: 'var(--status-warning)' }} />}
                            />
                            <Divider style={{ margin: '14px 0' }} />
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                Celupkan probe ke larutan buffer standar, tunggu tegangan stabil, lalu masukkan nilai tegangan pada masing-masing titik buffer.
                            </Text>
                            <Row gutter={12}>
                                <Col xs={24} sm={8}>
                                    <Form.Item name="ph_401" label="Buffer pH 4.01 (V)">
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <Form.Item name="ph_686" label="Buffer pH 6.86 (V)">
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <Form.Item name="ph_918" label="Buffer pH 9.18 (V)">
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Card>
                    </Col>

                    {/* PANEL TDS */}
                    <Col xs={24} md={12}>
                        <Card title="2. Kalibrasi Sensor TDS" style={{ height: '100%' }}>
                            <Statistic
                                title="Tegangan Mentah Saat Ini (v_tds)"
                                value={rawVoltage.v_tds}
                                precision={4}
                                suffix="V"
                                prefix={<ThunderboltOutlined style={{ color: 'var(--status-warning)' }} />}
                            />
                            <Divider style={{ margin: '14px 0' }} />
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                Bandingkan pembacaan ppm di Dashboard dengan TDS meter acuan, lalu sesuaikan faktor pengali K-Value.
                            </Text>
                            <Form.Item name="tds_k" label="K-Value (Faktor Pengali)">
                                <InputNumber style={{ width: '100%' }} step="0.01" />
                            </Form.Item>
                        </Card>
                    </Col>

                    {/* PANEL SUHU */}
                    <Col xs={24} md={pondType === 'adm' ? 12 : 24}>
                        <Card title="3. Kalibrasi Sensor Suhu (DS18B20)" style={{ height: '100%' }}>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                Gunakan nilai Offset Suhu untuk mengoreksi selisih pembacaan suhu terhadap termometer standar laboratorium.
                            </Text>
                            <Form.Item name="offset_suhu" label="Offset Koreksi Suhu (°C)">
                                <InputNumber style={{ width: '100%' }} step="0.1" addonAfter="°C" />
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

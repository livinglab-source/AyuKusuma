import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Typography, Form, InputNumber, Button, message, Statistic, Divider, Alert, Tag, Space } from 'antd';
import { SaveOutlined, ThunderboltOutlined, CloudSyncOutlined, ReloadOutlined } from '@ant-design/icons';
import api, { getCachedData } from '../api';
import { formatDateTimeWita } from '../utils/time';
import { ErrorState, confirmAction } from '../components/SystemStates';

const { Text } = Typography;

const Settings = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState(null);

    const cachedAdm = getCachedData('/api/dashboard/adm')?.data || getCachedData('/api/dashboard/adm') || {};
    const [rawVoltage, setRawVoltage] = useState({
        v_ph: cachedAdm.v_ph || 0.0,
        v_tds: cachedAdm.v_tds || 0.0,
        suhu: cachedAdm.suhu || 0.0,
        ph: cachedAdm.ph || 0.0,
        tds: cachedAdm.tds || 0,
    });
    const [updatedAt, setUpdatedAt] = useState(() => getCachedData('/api/calibration')?.updated_at || null);

    const fetchRawSensors = useCallback(async () => {
        try {
            const response = await api.get('/api/dashboard/adm');
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
        async (forceRefresh = false) => {
            setFetchError(null);
            try {
                const response = await api.get('/api/calibration', { forceRefresh });
                if (response.data) {
                    form.setFieldsValue({
                        offset_suhu: response.data.offset_suhu,
                        ph_401: response.data.ph_401,
                        ph_686: response.data.ph_686,
                        ph_918: response.data.ph_918,
                        tds_k: response.data.tds_k,
                        feeder_g_per_s: response.data.feeder_g_per_s ?? 15.0,
                        jam_pakan_1: response.data.jam_pakan_1 ?? 9,
                        menit_pakan_1: response.data.menit_pakan_1 ?? 0,
                        jam_pakan_2: response.data.jam_pakan_2 ?? 16,
                        menit_pakan_2: response.data.menit_pakan_2 ?? 0,
                    });
                    if (response.data.updated_at) {
                        setUpdatedAt(response.data.updated_at);
                    }
                }
            } catch {
                setFetchError('Gagal menarik parameter kalibrasi dari Cloud Firestore.');
            }
        },
        [form]
    );

    useEffect(() => {
        const initTimer = setTimeout(() => {
            fetchCalibration(false);
            fetchRawSensors();
        }, 0);
        const interval = setInterval(fetchRawSensors, 5000);
        return () => {
            clearTimeout(initTimer);
            clearInterval(interval);
        };
    }, [fetchCalibration, fetchRawSensors]);

    const saveCalibration = async (values) => {
        setLoading(true);
        try {
            const res = await api.post('/api/calibration', values);
            message.success(res.data?.message || 'Parameter kalibrasi berhasil disimpan ke Cloud Firestore.');
            await fetchCalibration(true);
        } catch (error) {
            const errDetail = error.response?.data?.detail || 'Gagal menyimpan kalibrasi. Pastikan sesi admin aktif.';
            message.error(errDetail);
        } finally {
            setLoading(false);
        }
    };

    const onFinish = (values) => {
        confirmAction({
            title: 'Simpan Perubahan Kalibrasi & Jadwal?',
            content: 'Nilai kalibrasi sensor, laju lontaran servo, dan jadwal pakan baru akan langsung diterapkan pada Cloud Firestore serta perangkat ESP32.',
            okText: 'Simpan Konfigurasi',
            onConfirm: () => saveCalibration(values),
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {fetchError && (
                <ErrorState
                    title="Sinkronisasi Kalibrasi Gagal"
                    description={fetchError}
                    onRetry={() => fetchCalibration(true)}
                />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <Alert
                    message="Sinkronisasi Tegangan Mentah Real-Time"
                    description="Nilai tegangan mentah (Raw Voltage) sensor diperbarui setiap 5 detik dari telemetri ESP32. Perubahan parameter langsung aktif di Cloud Firestore (settings/calibration)."
                    type="info"
                    showIcon
                    style={{ flex: 1, minWidth: 280 }}
                />
                <Space size="small" wrap>
                    {updatedAt && (
                        <Tag icon={<CloudSyncOutlined />} color="blue" style={{ margin: 0, padding: '4px 10px' }}>
                            Tersinkron: <span className="sf-mono">{formatDateTimeWita(updatedAt)}</span>
                        </Tag>
                    )}
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchCalibration(true)}>
                        Muat Ulang
                    </Button>
                </Space>
            </div>

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
                    <Col xs={24} md={12}>
                        <Card title="3. Kalibrasi Sensor Suhu (DS18B20)" style={{ height: '100%' }}>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
                                Gunakan nilai Offset Suhu untuk mengoreksi selisih pembacaan suhu terhadap termometer standar laboratorium.
                            </Text>
                            <Form.Item name="offset_suhu" label="Offset Koreksi Suhu (°C)">
                                <InputNumber style={{ width: '100%' }} step="0.1" addonAfter="°C" />
                            </Form.Item>
                        </Card>
                    </Col>

                    {/* PANEL SERVO FEEDER */}
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

                    {/* PANEL JADWAL PAKAN OTOMATIS */}
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
                </Row>

                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading} size="large">
                        Simpan Parameter Kalibrasi & Jadwal
                    </Button>
                </div>
            </Form>
        </div>
    );
};

export default Settings;

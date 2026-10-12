import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Typography, Form, InputNumber, Button, message, Statistic, Divider, Alert } from 'antd';
import { SaveOutlined, ThunderboltOutlined, SettingOutlined } from '@ant-design/icons';
import api from '../api';

const { Title, Text } = Typography;

const Settings = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [rawVoltage, setRawVoltage] = useState({ v_ph: 0.0, v_tds: 0.0 });

    const fetchRawSensors = async () => {
        try {
            const response = await api.get('/api/sensor/latest/adm');
            if (response.data.status === 'success') {
                setRawVoltage({
                    v_ph: response.data.data.v_ph || 0.0,
                    v_tds: response.data.data.v_tds || 0.0,
                });
            }
        } catch (error) {
            // Abaikan error di console agar tidak berisik saat polling
        }
    };

    const fetchCalibration = async () => {
        try {
            const response = await api.get('/api/calibration');
            form.setFieldsValue(response.data);
        } catch (error) {
            console.error("Gagal menarik data kalibrasi");
        }
    };

    useEffect(() => {
        fetchCalibration();
        fetchRawSensors();
        const interval = setInterval(fetchRawSensors, 5000);
        return () => clearInterval(interval);
    }, []);

    const onFinish = async (values) => {
        setLoading(true);
        try {
            await api.post('/api/calibration', values);
            message.success('Data kalibrasi berhasil disimpan! ESP32 akan langsung menggunakan nilai baru.');
        } catch (error) {
            message.error('Gagal menyimpan kalibrasi.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Title level={3}>Pengaturan & Kalibrasi Sistem</Title>
            <Alert
                message="Informasi Kalibrasi"
                description="Nilai tegangan mentah akan otomatis ter-update setiap 5 detik saat ESP32 aktif dan terhubung ke server."
                type="info" showIcon
                style={{ marginBottom: '8px' }}
            />

            <Form form={form} layout="vertical" onFinish={onFinish}>
                <Row gutter={[16, 16]}>

                    {/* PANEL pH */}
                    <Col xs={24} md={12}>
                        <Card title="Kalibrasi Sensor pH" bordered={false} style={{ height: '100%', borderRadius: '12px' }}>
                            <Statistic title="Tegangan Mentah Saat Ini" value={rawVoltage.v_ph} precision={4} suffix="V" prefix={<ThunderboltOutlined style={{ color: '#f59e0b' }} />} />
                            <Divider />
                            <Text type="secondary">Celupkan probe ke cairan buffer, tunggu hingga tegangan stabil, lalu catat angka tersebut ke kolom di bawah.</Text>
                            <Row gutter={16} style={{ marginTop: 16 }}>
                                <Col span={8}>
                                    <Form.Item name="ph_401" label="Buffer 4.01">
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item name="ph_686" label="Buffer 6.86">
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item name="ph_918" label="Buffer 9.18">
                                        <InputNumber style={{ width: '100%' }} step="0.0001" />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Card>
                    </Col>

                    {/* PANEL TDS */}
                    <Col xs={24} md={12}>
                        <Card title="Kalibrasi Sensor TDS" bordered={false} style={{ height: '100%', borderRadius: '12px' }}>
                            <Statistic title="Tegangan Mentah Saat Ini" value={rawVoltage.v_tds} precision={4} suffix="V" prefix={<ThunderboltOutlined style={{ color: '#f59e0b' }} />} />
                            <Divider />
                            <Text type="secondary">Bandingkan nilai ppm yang tampil di Dashboard dengan TDS Meter pabrikan, lalu ubah rasio K-Value.</Text>
                            <Form.Item name="tds_k" label="K-Value (Faktor Pengali)" style={{ marginTop: 16 }}>
                                <InputNumber style={{ width: '100%' }} step="0.01" />
                            </Form.Item>
                        </Card>
                    </Col>

                    {/* PANEL SUHU */}
                    <Col xs={24} md={12}>
                        <Card title="Kalibrasi Sensor Suhu (DS18B20)" bordered={false} style={{ height: '100%', borderRadius: '12px' }}>
                            <Text type="secondary">Gunakan nilai Offset untuk menyeimbangkan pembacaan suhu ESP32 dengan termometer raksa acuan.</Text>
                            <Form.Item name="offset_suhu" label="Offset Suhu (°C)" style={{ marginTop: 16 }}>
                                <InputNumber style={{ width: '100%' }} step="0.1" />
                            </Form.Item>
                        </Card>
                    </Col>

                    {/* PANEL SERVO FEEDER */}
                    <Col xs={24} md={12}>
                        <Card title="Kalibrasi Servo Feeder" bordered={false} style={{ height: '100%', borderRadius: '12px' }}>
                            <Text type="secondary">Tentukan berapa gram pakan yang berhasil dijatuhkan oleh aktuator servo dalam waktu 1 detik bukaan.</Text>
                            <Form.Item name="feeder_g_per_s" label="Kapasitas Keluar (Gram/Detik)" style={{ marginTop: 16 }}>
                                <InputNumber style={{ width: '100%' }} step="0.1" addonAfter="gram / dtk" />
                            </Form.Item>
                        </Card>
                    </Col>

                </Row>

                {/* TOMBOL SIMPAN UTAMA */}
                <div style={{ marginTop: '24px' }}>
                    <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading} block size="large" style={{ borderRadius: '8px' }}>
                        SIMPAN SEMUA PARAMETER KALIBRASI
                    </Button>
                </div>
            </Form>
        </div>
    );
};

export default Settings;
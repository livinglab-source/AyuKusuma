import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Typography, Badge, Space, Divider, Button, InputNumber, message, Tooltip, Empty } from 'antd';
import {
    ThunderboltOutlined,
    DashboardOutlined,
    CheckCircleOutlined,
    SettingOutlined,
    PlayCircleOutlined,
    PauseCircleOutlined,
    ExperimentOutlined,
    InfoCircleOutlined,
    ClockCircleOutlined
} from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import api from '../api';

const { Title, Text } = Typography;

// Format sumbu waktu menjadi Jam:Menit
const formatJam = (d) => new Date(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

// Ubah array dari backend [{time: '...', value: 32.4}] menjadi data siap pakai chart
const toSeries = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((p) => p && p.time && p.value !== null && p.value !== undefined)
    .map((p) => ({ time: new Date(p.time), value: Number(p.value) }))
    .filter((p) => !isNaN(p.time.getTime()) && !isNaN(p.value));

// Konfigurasi Ant Design Charts (v2) untuk Sparkline per parameter
// Didefinisikan di luar komponen Dashboard agar grafik tidak di-mount ulang setiap polling sensor (5 detik)
const MiniChart = ({ title, data, color, unit = '' }) => {
    const latest = data.length ? data[data.length - 1].value : null;

    const config = {
        data,
        xField: 'time',
        yField: 'value',
        shapeField: 'smooth',
        height: 160,
        autoFit: true,
        style: { stroke: color, lineWidth: 2 },
        scale: { y: { nice: true, zero: false } },
        axis: {
            x: { title: false, tickCount: 5, labelFormatter: formatJam, labelFontSize: 10, labelFill: '#8c8c8c' },
            y: { title: false, labelFontSize: 10, labelFill: '#8c8c8c', gridStroke: '#f0f0f0', gridLineDash: [4, 4] },
        },
        tooltip: {
            title: (d) => formatJam(d.time),
            items: [{ channel: 'y', name: title, valueFormatter: (v) => `${v} ${unit}`.trim() }],
        },
    };

    return (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: '10px', padding: '12px 12px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <Text type="secondary" style={{ fontWeight: 600, fontSize: '12px' }}>{title}</Text>
                {latest !== null && (
                    <Text strong style={{ color }}>{latest} <Text type="secondary" style={{ fontSize: '12px' }}>{unit}</Text></Text>
                )}
            </div>
            {data.length ? (
                <Line {...config} />
            ) : (
                <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Belum ada data" />
                </div>
            )}
        </div>
    );
};

const Dashboard = () => {
    const [loadingSensor, setLoadingSensor] = useState(true);
    const [sensorData, setSensorData] = useState({
        suhu: '-', do: '-', ph: '-', tds: '-',
        rule_aktif: '-', pakan_gram: 0,
        lbl_suhu: '-', lbl_do: '-', lbl_ph: '-', lbl_tds: '-'
    });
    const [lastUpdate, setLastUpdate] = useState('-');

    // State untuk Kontrol Manual (Sama seperti sebelumnya)
    const [manualDuration, setManualDuration] = useState(5);
    const [loadingCmd, setLoadingCmd] = useState(false);

    // State untuk Data Grafik (Dummy sementara jika InfluxDB belum cukup riwayat)
    const [chartData, setChartData] = useState({ suhu: [], do: [], ph: [], tds: [] });

    // 1. FUNGSI TARIK DATA SENSOR TERAKHIR DARI INFLUXDB
    const fetchLatestSensor = async () => {
        try {
            const res = await api.get('/api/sensor/latest/adm');
            if (res.data.status === 'success') {
                const d = res.data.data;
                setSensorData({
                    suhu: d.suhu?.toFixed(1) || '-',
                    do: d.do?.toFixed(1) || '-',
                    ph: d.ph?.toFixed(1) || '-',
                    tds: d.tds?.toFixed(0) || '-',
                    // Tambahan tarik data fuzzy
                    rule_aktif: d.rule_aktif || '-',
                    pakan_gram: d.pakan_gram?.toFixed(1) || 0,
                    lbl_suhu: d.lbl_suhu || '-',
                    lbl_do: d.lbl_do || '-',
                    lbl_ph: d.lbl_ph || '-',
                    lbl_tds: d.lbl_tds || '-'
                });

                // Buat format jam update
                const now = new Date();
                setLastUpdate(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
            }
        } catch (error) {
            console.error("Gagal menarik sensor real-time");
        } finally {
            setLoadingSensor(false);
        }
    };

    // 2. FUNGSI KIRIM PERINTAH MANUAL KE FASTAPI
    const sendCommand = async (action) => {
        setLoadingCmd(true);
        try {
            await api.post('/api/command', { action: action, duration: manualDuration || 5 });
            message.success(`Perintah "${action}" telah dikirim ke ESP32!`);
        } catch (error) {
            message.error("Gagal mengirim perintah. Cek koneksi server.");
        } finally {
            setLoadingCmd(false);
        }
    };

    // 3. FUNGSI GENERATE DATA GRAFIK (Gabungan nyata + dummy jika data kurang)
    // Nanti Anda bisa mengganti ini dengan endpoint /api/sensor/history/24h yang asli
    // FUNGSI TARIK DATA HISTORI ASLI (Menggantikan generateChartData)
    const fetchChartData = async () => {
        try {
            const res = await api.get('/api/sensor/history/adm');
            if (res.data.status === 'success') {
                // Data sudah diformat dari backend menjadi {suhu: [...], do: [...], ph: [...], tds: [...]}
                const d = res.data.data || {};
                setChartData({
                    suhu: toSeries(d.suhu),
                    do: toSeries(d.do),
                    ph: toSeries(d.ph),
                    tds: toSeries(d.tds),
                });
            }
        } catch (error) {
            console.error("Gagal menarik data histori grafik dari InfluxDB");
        }
    };

    // Efek Polling (Auto-Update setiap 5 detik)
    useEffect(() => {
        fetchLatestSensor();
        fetchChartData(); // Memanggil data asli di sini

        const intervalSensor = setInterval(fetchLatestSensor, 5000);

        // Grafik riwayat 24 jam cukup di-refresh setiap 5 menit sekali agar tidak membebani database
        const intervalChart = setInterval(fetchChartData, 300000);

        return () => {
            clearInterval(intervalSensor);
            clearInterval(intervalChart);
        };
    }, []);

    // Komponen kecil untuk Kartu Sensor agar rapi
    const SensorCard = ({ title, value, unit, normalRange, icon, color }) => (
        <Card bordered={false} loading={loadingSensor} style={{ height: '100%', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ background: `${color}15`, padding: '8px', borderRadius: '8px', marginRight: '12px' }}>
                    {React.cloneElement(icon, { style: { color, fontSize: '20px' } })}
                </div>
                <Text type="secondary" style={{ fontWeight: 600 }}>{title}</Text>
            </div>
            <div style={{ marginBottom: '8px' }}>
                <Text style={{ fontSize: '28px', fontWeight: 'bold', color: '#1f2937' }}>{value}</Text>
                <Text type="secondary" style={{ fontSize: '16px', marginLeft: '4px' }}>{unit}</Text>
            </div>
            <Badge color="green" text={`Normal: ${normalRange}`} style={{ fontSize: '12px', color: '#8c8c8c' }} />
        </Card>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* BAGIAN 1: BARIS SENSOR */}
            <Row gutter={[16, 16]}>
                <Col xs={12} md={6}>
                    <SensorCard title="SUHU AIR" value={sensorData.suhu} unit="°C" normalRange="24 - 32 °C" color="#ff4d4f" icon={<DashboardOutlined />} />
                </Col>
                <Col xs={12} md={6}>
                    <SensorCard title="DO" value={sensorData.do} unit="mg/L" normalRange="4 - 8 mg/L" color="#1890ff" icon={<DashboardOutlined />} />
                </Col>
                <Col xs={12} md={6}>
                    <SensorCard title="pH AIR" value={sensorData.ph} unit="" normalRange="6.5 - 8.5" color="#52c41a" icon={<DashboardOutlined />} />
                </Col>
                <Col xs={12} md={6}>
                    <SensorCard title="TDS" value={sensorData.tds} unit="ppm" normalRange="400 - 1500" color="#722ed1" icon={<DashboardOutlined />} />
                </Col>
            </Row>

            {/* BAGIAN 2: BARIS STATUS ADM & KONTROL SERVO */}
            <Row gutter={[16, 16]}>

                {/* Status Fuzzy Sugeno */}
                {/* GANTI KODE PANEL STATUS ADAPTASI SISTEM ANDA MENJADI INI */}
                <Col xs={24} lg={12}>
                    <Card bordered={false} style={{ height: '100%', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                            <ThunderboltOutlined style={{ color: '#f59e0b', fontSize: '20px', marginRight: '8px' }} />
                            <Text strong style={{ color: '#4b5563' }}>STATUS ADAPTASI SISTEM (ADM)</Text>
                        </div>

                        <div style={{ background: '#fffbeb', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                            {/* Menampilkan Rule Aktif dinamis dari ESP32 */}
                            <Title level={4} style={{ color: '#d97706', margin: '0 0 8px 0' }}>Rule {sensorData.rule_aktif} Aktif</Title>
                            <Text style={{ color: '#4b5563' }}>
                                Sistem saat ini ditargetkan memberi pakan <Text strong>{sensorData.pakan_gram} gram</Text> berdasarkan kondisi perairan saat ini.
                            </Text>
                        </div>

                        <div style={{ marginTop: '16px' }}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>Klasifikasi Membership:</Text>
                            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {/* Label dinamis: Merah jika Rendah/Tinggi, Biru jika Normal */}
                                <Badge color={sensorData.lbl_do === 'Normal' ? 'blue' : 'volcano'} text={`DO ${sensorData.lbl_do}`} />
                                <Badge color={sensorData.lbl_suhu === 'Normal' ? 'blue' : 'volcano'} text={`Suhu ${sensorData.lbl_suhu}`} />
                                <Badge color={sensorData.lbl_ph === 'Normal' ? 'blue' : 'volcano'} text={`pH ${sensorData.lbl_ph}`} />
                                <Badge color={sensorData.lbl_tds === 'Normal' ? 'blue' : 'volcano'} text={`TDS ${sensorData.lbl_tds}`} />
                            </div>
                        </div>
                    </Card>
                </Col>

                {/* Kolom Kontrol Manual & Status */}
                <Col xs={24} lg={12}>
                    <Card bordered={false} style={{ height: '100%', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>

                        {/* Header Kartu Kanan */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <Space>
                                <SettingOutlined style={{ color: '#722ed1', fontSize: '18px' }} />
                                <Text strong style={{ color: '#4b5563' }}>KONTROL SERVO</Text>
                            </Space>
                            <Badge status="processing" text="ONLINE" color="green" />
                        </div>

                        {/* Tombol Kontrol */}
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            <Row gutter={8}>
                                <Col span={12}>
                                    <Button type="primary" style={{ background: '#10b981', borderColor: '#10b981' }}
                                        icon={<PlayCircleOutlined />} onClick={() => sendCommand('open')} block loading={loadingCmd}>
                                        BUKA
                                    </Button>
                                </Col>
                                <Col span={12}>
                                    <Button type="primary" danger icon={<PauseCircleOutlined />}
                                        onClick={() => sendCommand('close')} block loading={loadingCmd}>
                                        TUTUP
                                    </Button>
                                </Col>
                            </Row>

                            <div style={{ display: 'flex', gap: '8px' }}>
                                <InputNumber min={1} max={60} value={manualDuration} onChange={setManualDuration} addonAfter="detik" style={{ width: '100%' }} />
                                <Button type="primary" icon={<ExperimentOutlined />} onClick={() => sendCommand('feed')} loading={loadingCmd} style={{ background: '#3b82f6' }}>
                                    BERI PAKAN
                                </Button>
                            </div>
                        </Space>

                        <Divider style={{ margin: '16px 0' }} />

                        {/* Info Status Update Terakhir */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                <ClockCircleOutlined style={{ marginRight: '6px' }} />
                                Update Terakhir: {lastUpdate}
                            </Text>
                            <Tooltip title="Data ditarik dari ESP32 (Edge Computing) secara realtime">
                                <InfoCircleOutlined style={{ color: '#bfbfbf' }} />
                            </Tooltip>
                        </div>

                    </Card>
                </Col>
            </Row>

            {/* BAGIAN 3: BARIS GRAFIK */}
            <Row gutter={[16, 16]}>
                {/* Grafik Kualitas Air */}
                <Col span={24}>
                    <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                        <div style={{ marginBottom: '16px' }}>
                            <Text strong style={{ color: '#4b5563' }}>TREND KUALITAS AIR 24 JAM TERAKHIR</Text>
                        </div>
                        {/* Komponen Line Chart dari @ant-design/charts (satu grafik per parameter karena skalanya berbeda jauh) */}
                        <Row gutter={[16, 16]}>
                            <Col xs={24} md={12}>
                                <MiniChart title="SUHU AIR" data={chartData.suhu} color="#ff4d4f" unit="°C" />
                            </Col>
                            <Col xs={24} md={12}>
                                <MiniChart title="DO" data={chartData.do} color="#1890ff" unit="mg/L" />
                            </Col>
                            <Col xs={24} md={12}>
                                <MiniChart title="pH AIR" data={chartData.ph} color="#52c41a" />
                            </Col>
                            <Col xs={24} md={12}>
                                <MiniChart title="TDS" data={chartData.tds} color="#722ed1" unit="ppm" />
                            </Col>
                        </Row>
                    </Card>
                </Col>
            </Row>

        </div>
    );
};

export default Dashboard;
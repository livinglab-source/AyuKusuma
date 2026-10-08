import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Typography, Tag, Divider, Space } from 'antd';
import {
    CheckCircleOutlined,
    SyncOutlined,
    DashboardOutlined,
    ThunderboltOutlined,
    SettingOutlined,
    LineChartOutlined
} from '@ant-design/icons';
import { Area } from '@ant-design/charts';
import api from '../api'; // Impor konfigurasi axios yang baru dibuat

const { Title, Text } = Typography;

// --- MOCK DATA UNTUK GRAFIK SPARKLINE 24 JAM ---
const mockChartData = (baseValue, variance) => {
    return Array.from({ length: 24 }).map((_, i) => ({
        time: `${i.toString().padStart(2, '0')}:00`,
        value: parseFloat((baseValue + (Math.random() * variance - variance / 2)).toFixed(1))
    }));
};

const dataSuhu = mockChartData(28.4, 2);
const dataDO = mockChartData(5.8, 1.5);
const dataPH = mockChartData(7.3, 0.5);
const dataTDS = mockChartData(840, 50);

// --- KOMPONEN REUSABLE UNTUK KARTU SENSOR ---
const SensorCard = ({ icon, title, value, unit, status, range }) => (
    <Card bordered={false} style={{ borderRadius: '12px', height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <Space>
            <div style={{ padding: '8px', background: '#e6f7ff', borderRadius: '8px', color: '#1890ff' }}>
                {icon}
            </div>
            <Text type="secondary" style={{ fontSize: '12px', fontWeight: 600 }}>{title}</Text>
        </Space>
        <div style={{ marginTop: '12px', marginBottom: '8px' }}>
            <Text style={{ fontSize: '28px', fontWeight: 'bold' }}>{value}</Text>
            <Text style={{ fontSize: '16px', marginLeft: '4px' }}>{unit}</Text>
        </div>
        <Tag color={status === 'Normal' ? 'success' : 'error'} style={{ borderRadius: '12px', padding: '2px 12px' }}>
            {status}
        </Tag>
        <div style={{ marginTop: '16px' }}>
            <Text type="secondary" style={{ fontSize: '11px' }}>Rentang Normal: {range}</Text>
        </div>
    </Card>
);

// --- KOMPONEN GRAFIK MINI (SPARKLINE) ---
const MiniAreaChart = ({ data, color }) => {
    const config = {
        data,
        xField: 'time',
        yField: 'value',
        smooth: true,
        height: 120,
        color: color,
        areaStyle: { fill: `l(270) 0:#ffffff 1:${color}33` }, // Efek gradasi transparan
        line: { color: color, size: 2 },
        xAxis: { tickCount: 5, label: { style: { fill: '#bfbfbf', fontSize: 10 } }, grid: null },
        yAxis: { label: { style: { fill: '#bfbfbf', fontSize: 10 } }, grid: { line: { style: { stroke: '#f0f0f0', lineDash: [4, 4] } } } },
        tooltip: { showMarkers: false },
    };
    return <Area {...config} />;
};

const Dashboard = () => {
    // 1. Buat state untuk menyimpan data sensor yang ditarik dari API
    const [sensorData, setSensorData] = useState({
        suhu: '-',
        do: '-',
        ph: '-',
        tds: '-'
    });
    const [lastSync, setLastSync] = useState('Belum sinkronisasi');

    // 2. Buat fungsi untuk memanggil API
    const fetchLatestSensorData = async () => {
        try {
            // Mengambil data terbaru khusus untuk kolam perlakuan (adm)
            const response = await api.get('/api/sensor/latest/adm');

            if (response.data.status === 'success') {
                const data = response.data.data;
                setSensorData({
                    suhu: data.suhu?.toFixed(1) || '-',
                    do: data.do?.toFixed(1) || '-',
                    ph: data.ph?.toFixed(1) || '-',
                    tds: data.tds || '-'
                });

                // Perbarui waktu sinkronisasi terakhir
                const now = new Date();
                setLastSync(`${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`);
            }
        } catch (error) {
            console.error("Gagal mengambil data dari API:", error);
        }
    };

    // 3. Gunakan useEffect untuk polling data setiap 5 detik
    useEffect(() => {
        fetchLatestSensorData(); // Ambil data saat halaman pertama kali dimuat

        const interval = setInterval(() => {
            fetchLatestSensorData();
        }, 5000); // 5000 ms = 5 detik

        return () => clearInterval(interval); // Bersihkan interval saat pengguna pindah halaman
    }, []);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* BARIS 1: Kartu Sensor & Servo */}
            <Row gutter={[16, 16]}>
                <Col xs={12} sm={12} lg={4}>
                    <SensorCard
                        icon={<DashboardOutlined />}
                        title="SUHU AIR"
                        value={sensorData.suhu} // Ganti nilai statis dengan variabel state
                        unit="°C"
                        status={sensorData.suhu >= 24 && sensorData.suhu <= 32 ? "Normal" : "Peringatan"}
                        range="24 - 32 °C"
                    />
                </Col>
                <Col xs={12} sm={12} lg={5}>
                    <SensorCard
                        icon={<DashboardOutlined />}
                        title="DISSOLVED OXYGEN (DO)"
                        value={sensorData.do}
                        unit="mg/L"
                        status={sensorData.do >= 4 && sensorData.do <= 8 ? "Normal" : "Peringatan"}
                        range="4 - 8 mg/L"
                    />
                </Col>
                <Col xs={12} sm={12} lg={4}>
                    <SensorCard
                        icon={<DashboardOutlined />}
                        title="pH AIR"
                        value={sensorData.ph}
                        unit=""
                        status={sensorData.ph >= 6.5 && sensorData.ph <= 8.5 ? "Normal" : "Peringatan"}
                        range="6.5 - 8.5"
                    />
                </Col>
                <Col xs={12} sm={12} lg={5}>
                    <SensorCard
                        icon={<DashboardOutlined />}
                        title="TDS"
                        value={sensorData.tds}
                        unit="ppm"
                        status={sensorData.tds >= 400 && sensorData.tds <= 1500 ? "Normal" : "Peringatan"}
                        range="400 - 1500 ppm"
                    />
                </Col>
                <Col xs={24} sm={24} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Space>
                                <div style={{ padding: '8px', background: '#f9f0ff', borderRadius: '8px', color: '#722ed1' }}>
                                    <SettingOutlined />
                                </div>
                                <Text type="secondary" style={{ fontSize: '12px', fontWeight: 600 }}>STATUS SERVO</Text>
                            </Space>
                            <Text style={{ color: '#722ed1', fontWeight: 'bold' }}>ACTIVE</Text>
                        </Space>
                        <div style={{ marginTop: '24px' }}>
                            <Row>
                                <Col span={12}>
                                    <Text type="secondary" style={{ fontSize: '12px' }}>Durasi:</Text><br />
                                    <Text style={{ fontSize: '16px', fontWeight: 600 }}>12 detik</Text>
                                </Col>
                                <Col span={12}>
                                    <Text type="secondary" style={{ fontSize: '12px' }}>Pakan:</Text><br />
                                    <Text style={{ fontSize: '16px', fontWeight: 600 }}>800 gram</Text>
                                </Col>
                            </Row>
                        </div>
                    </Card>
                </Col>
            </Row>

            {/* BARIS 2: Status ADM & Ringkasan Sistem */}
            <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                    <Card bordered={false} style={{ borderRadius: '12px', height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Space>
                            <ThunderboltOutlined style={{ color: '#1890ff', fontSize: '20px' }} />
                            <Title level={5} style={{ margin: 0 }}>STATUS ADAPTASI SISTEM (ADM)</Title>
                        </Space>
                        <Divider style={{ margin: '16px 0' }} />
                        <Row align="middle" gutter={24}>
                            <Col span={8} style={{ textAlign: 'center', borderRight: '1px solid #f0f0f0' }}>
                                <Title level={4} style={{ color: '#1890ff', margin: 0 }}>Rule #24 Aktif</Title>
                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                    DO Rendah • Suhu Normal<br />pH Normal • TDS Normal
                                </Text>
                            </Col>
                            <Col span={16}>
                                <Title level={5} style={{ fontWeight: 400, marginTop: 0 }}>
                                    Sistem memberi pakan <b>20 gram</b> karena DO menurun.
                                </Title>
                                <Space style={{ marginTop: '8px' }}>
                                    <SyncOutlined spin style={{ color: '#bfbfbf' }} />
                                    <Text type="secondary" style={{ fontSize: '12px' }}>Terakhir Update: 08:30:32 AM</Text>
                                </Space>
                            </Col>
                        </Row>
                    </Card>
                </Col>

                <Col xs={24} lg={10}>
                    <Card bordered={false} style={{ borderRadius: '12px', height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Title level={5} style={{ margin: '0 0 16px 0' }}><DashboardOutlined /> RINGKASAN SISTEM</Title>
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            <Row justify="space-between">
                                <Text><CheckCircleOutlined style={{ color: '#52c41a', marginRight: '8px' }} /> ESP32 (Gateway)</Text>
                                <Text type="success">Online</Text>
                            </Row>
                            <Row justify="space-between">
                                <Text><CheckCircleOutlined style={{ color: '#52c41a', marginRight: '8px' }} /> Raspberry Pi (Edge)</Text>
                                <Text type="success">Online</Text>
                            </Row>
                            <Row justify="space-between">
                                <Text><CheckCircleOutlined style={{ color: '#52c41a', marginRight: '8px' }} /> InfluxDB (Database)</Text>
                                <Text type="success">Online</Text>
                            </Row>
                            <Row justify="space-between">
                                <Text><CheckCircleOutlined style={{ color: '#52c41a', marginRight: '8px' }} /> Servo Feeder</Text>
                                <Text style={{ color: '#722ed1' }}>Active</Text>
                            </Row>
                            <Divider style={{ margin: '8px 0' }} />
                            <Row justify="space-between">
                                <Text type="secondary" style={{ fontSize: '12px' }}>Last Sync</Text>
                                <Text type="secondary" style={{ fontSize: '12px' }}>2 detik yang lalu</Text>
                            </Row>
                        </Space>
                    </Card>
                </Col>
            </Row>

            {/* BARIS 3: Trend Kualitas Air 24 Jam Terakhir */}
            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <Title level={5} style={{ margin: '0 0 24px 0' }}><LineChartOutlined /> TREND KUALITAS AIR 24 JAM TERAKHIR</Title>
                <Row gutter={[24, 24]}>
                    <Col xs={24} sm={12} lg={6}>
                        <Row justify="space-between" style={{ marginBottom: '8px' }}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>Suhu (°C)</Text>
                            <Text style={{ color: '#1890ff', fontWeight: 600 }}>28.4</Text>
                        </Row>
                        <MiniAreaChart data={dataSuhu} color="#1890ff" />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Row justify="space-between" style={{ marginBottom: '8px' }}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>DO (mg/L)</Text>
                            <Text style={{ color: '#13c2c2', fontWeight: 600 }}>5.8</Text>
                        </Row>
                        <MiniAreaChart data={dataDO} color="#13c2c2" />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Row justify="space-between" style={{ marginBottom: '8px' }}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>pH</Text>
                            <Text style={{ color: '#52c41a', fontWeight: 600 }}>7.3</Text>
                        </Row>
                        <MiniAreaChart data={dataPH} color="#52c41a" />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Row justify="space-between" style={{ marginBottom: '8px' }}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>TDS (ppm)</Text>
                            <Text style={{ color: '#722ed1', fontWeight: 600 }}>840</Text>
                        </Row>
                        <MiniAreaChart data={dataTDS} color="#722ed1" />
                    </Col>
                </Row>
            </Card>
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <Text type="secondary" style={{ fontSize: '12px' }}>Sistem Smart Feeder Aquaculture - Monitoring Real-time Kualitas Air & Pemberian Pakan</Text>
            </div>
        </div>
    );
};

export default Dashboard;
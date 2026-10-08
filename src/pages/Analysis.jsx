import React, { useState, useEffect } from 'react';
import {
    Card, Row, Col, Typography, Alert, Divider, Statistic, Space,
    Form, Select, InputNumber, Button, Table, message
} from 'antd';
import {
    InfoCircleOutlined, ExperimentOutlined, SaveOutlined,
    CalculatorOutlined, CheckCircleOutlined
} from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import api from '../api'; // Pastikan Axios diimpor

const { Title, Text } = Typography;
const { Option } = Select;

// --- 1. MOCK DATA GENERATOR UNTUK GRAFIK ---
const generateDualData = (baseA, baseB, variance, length = 24) => {
    const data = [];
    for (let i = 0; i < length; i++) {
        const time = `${i.toString().padStart(2, '0')}:00`;
        data.push({ time, type: 'Kolam Perlakuan (A)', value: parseFloat((baseA + Math.random() * variance).toFixed(1)) });
        data.push({ time, type: 'Kolam Kontrol (Timer)', value: parseFloat((baseB + Math.random() * variance).toFixed(1)) });
    }
    return data;
};

const dataSuhu = generateDualData(28.0, 28.1, 1.5);
const dataDO = generateDualData(5.0, 5.1, 1.0);
const dataPH = generateDualData(7.0, 7.1, 0.4);
const dataTDS = generateDualData(800, 810, 60);

// Mock Data untuk Grafik Pakan (25 Hari)
const dataPakan = [];
for (let i = 1; i <= 25; i++) {
    dataPakan.push({ day: i.toString(), type: 'Kolam Kontrol (Timer)', value: 1000 });
    // Fluktuasi pakan perlakuan (misal turun saat hari ke-5, naik saat hari ke-12)
    let pakanA = 1000;
    if (i > 3 && i < 8) pakanA = 600 + Math.random() * 200;
    if (i > 10 && i < 15) pakanA = 900 + Math.random() * 200;
    if (i > 17 && i < 22) pakanA = 500 + Math.random() * 200;
    dataPakan.push({ day: i.toString(), type: 'Kolam Perlakuan (A)', value: Math.round(pakanA) });
}

// --- 2. MOCK DATA UNTUK TABEL FCR MINGGUAN ---
const fcrData = [
    { key: '1', week: '1', feedA: 1000, feedB: 1000, bioA: 648, bioB: 622, fcrA: 1.54, fcrB: 1.61 },
    { key: '2', week: '2', feedA: 2150, feedB: 2000, bioA: 952, bioB: 884, fcrA: 2.26, fcrB: 2.26 },
    { key: '3', week: '3', feedA: 3200, feedB: 3000, bioA: 1336, bioB: 1206, fcrA: 2.40, fcrB: 2.49 },
    { key: '4', week: '4', feedA: 4300, feedB: 4000, bioA: 1730, bioB: 1508, fcrA: 2.49, fcrB: 2.65 },
    { key: '5', week: '5', feedA: 5400, feedB: 5000, bioA: 2194, bioB: 1892, fcrA: 2.46, fcrB: 2.64 },
];

const fcrColumns = [
    { title: 'Minggu ke-', dataIndex: 'week', key: 'week', align: 'center', fixed: 'left', width: 90 },
    {
        title: 'Akumulasi Pakan Diberikan (gram)',
        children: [
            { title: 'Perlakuan (A)', dataIndex: 'feedA', key: 'feedA', align: 'center' },
            { title: 'Kontrol (Timer)', dataIndex: 'feedB', key: 'feedB', align: 'center' },
        ],
    },
    {
        title: 'Estimasi Biomassa Ikan (gram)',
        children: [
            { title: 'Perlakuan (A)', dataIndex: 'bioA', key: 'bioA', align: 'center' },
            { title: 'Kontrol (Timer)', dataIndex: 'bioB', key: 'bioB', align: 'center' },
        ],
    },
    {
        title: 'FCR Saat Ini',
        children: [
            { title: 'Perlakuan (A)', dataIndex: 'fcrA', key: 'fcrA', align: 'center', render: val => <Text strong style={{ color: '#1890ff' }}>{val}</Text> },
            { title: 'Kontrol (Timer)', dataIndex: 'fcrB', key: 'fcrB', align: 'center', render: val => <Text strong type="secondary">{val}</Text> },
        ],
    },
];

// --- 3. KOMPONEN CHART KECIL ---
const MiniDualLineChart = ({ data, title }) => {
    const config = {
        data,
        xField: 'time',
        yField: 'value',
        seriesField: 'type',
        color: ['#1890ff', '#bfbfbf'],
        smooth: true,
        height: 150,
        legend: false,
        xAxis: { tickCount: 5, label: { style: { fontSize: 10 } } },
        yAxis: { label: { style: { fontSize: 10 } } },
    };
    return (
        <div>
            <Text type="secondary" style={{ fontSize: '12px' }}>{title}</Text>
            <Line {...config} />
        </div>
    );
};

const Analysis = () => {
    const [form] = Form.useForm();
    const [loadingForm, setLoadingForm] = useState(false);
    const [fcrTableData, setFcrTableData] = useState([]); // State untuk tabel
    const [loadingTable, setLoadingTable] = useState(false);

    // Fungsi untuk menarik data dari SQLite dan mengelompokkannya per minggu
    const fetchFCRData = async () => {
        setLoadingTable(true);
        try {
            const response = await api.get('/api/sampling');
            if (response.data.status === 'success') {
                const rawData = response.data.data;

                // Transformasi data agar Kolam A dan Kontrol sejajar dalam 1 baris
                const grouped = {};
                rawData.forEach(item => {
                    if (!grouped[item.minggu_ke]) {
                        grouped[item.minggu_ke] = { key: item.minggu_ke, week: item.minggu_ke.toString() };
                    }
                    if (item.kolam === 'Perlakuan (A)') {
                        grouped[item.minggu_ke].feedA = item.jumlah_pakan;
                        grouped[item.minggu_ke].bioA = item.berat_akhir;
                        grouped[item.minggu_ke].fcrA = item.fcr;
                    } else {
                        grouped[item.minggu_ke].feedB = item.jumlah_pakan;
                        grouped[item.minggu_ke].bioB = item.berat_akhir;
                        grouped[item.minggu_ke].fcrB = item.fcr;
                    }
                });

                // Ubah objek menjadi array untuk Ant Design Table
                setFcrTableData(Object.values(grouped));
            }
        } catch (error) {
            console.error("Gagal menarik data FCR:", error);
        } finally {
            setLoadingTable(false);
        }
    };

    // Panggil data saat halaman pertama kali dibuka
    useEffect(() => {
        fetchFCRData();
    }, []);

    const onFinishSampling = async (values) => {
        setLoadingForm(true);
        try {
            const payload = {
                minggu_ke: parseInt(values.minggu),
                kolam: values.kolam,
                berat_awal: values.beratAwal,
                berat_akhir: values.beratAkhir,
                jumlah_pakan: values.jumlahPakan
            };

            const response = await api.post('/api/sampling', payload);
            if (response.data.status === 'success') {
                message.success(`Data tersimpan! Nilai FCR terhitung: ${response.data.fcr}`);
                form.resetFields(['beratAkhir', 'jumlahPakan']); // Reset input tertentu
                fetchFCRData(); // <--- Refresh tabel secara otomatis!
            }
        } catch (error) {
            message.error("Gagal menyimpan data sampling.");
            console.error(error);
        } finally {
            setLoadingForm(false);
        }
    };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* HEADER PAGE */}
            <div>
                <Title level={3} style={{ margin: 0 }}>ANALISIS</Title>
                <Text type="secondary">Evaluasi Kinerja Sistem & Perbandingan Kolam Perlakuan (A) vs Kolam Kontrol (Timer)</Text>
            </div>

            {/* SECTION A: TREN KUALITAS AIR MAKRO */}
            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <Space align="center" style={{ marginBottom: '16px' }}>
                    <Title level={5} style={{ margin: 0 }}>A. TREN KUALITAS AIR MAKRO (24 JAM TERAKHIR)</Title>
                    <InfoCircleOutlined style={{ color: '#bfbfbf' }} />
                </Space>

                <Row gutter={[24, 24]}>
                    <Col xs={24} sm={12} lg={6}><MiniDualLineChart data={dataSuhu} title="🌡️ Suhu (°C)" /></Col>
                    <Col xs={24} sm={12} lg={6}><MiniDualLineChart data={dataDO} title="🫧 Dissolved Oxygen (DO) (mg/L)" /></Col>
                    <Col xs={24} sm={12} lg={6}><MiniDualLineChart data={dataPH} title="💧 pH" /></Col>
                    <Col xs={24} sm={12} lg={6}><MiniDualLineChart data={dataTDS} title="❄️ TDS (ppm)" /></Col>
                </Row>

                <Alert
                    message="Kualitas air kedua kolam bergerak beriringan dan berada dalam rentang normal. Ini membuktikan lingkungan makro relatif setara."
                    type="success"
                    showIcon
                    icon={<CheckCircleOutlined />}
                    style={{ marginTop: '24px', borderRadius: '8px' }}
                />
            </Card>

            {/* SECTION B: ANALISIS PEMBERIAN PAKAN */}
            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <Title level={5} style={{ margin: '0 0 24px 0' }}>B. ANALISIS PEMBERIAN PAKAN (AKUMULASI PAKAN HARIAN)</Title>
                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={16}>
                        <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '8px' }}>Total Pakan Harian (gram)</Text>
                        <Line
                            data={dataPakan}
                            xField="day"
                            yField="value"
                            seriesField="type"
                            color={['#bfbfbf', '#1890ff']}
                            smooth
                            height={250}
                            legend={{ position: 'top' }}
                            annotations={[
                                { type: 'text', position: ['4', 1100], content: 'DO turun\npakan diturunkan', style: { fill: '#f5222d', fontSize: 10, textAlign: 'center' } },
                                { type: 'text', position: ['11', 1100], content: 'DO meningkat\npakan dinaikkan', style: { fill: '#52c41a', fontSize: 10, textAlign: 'center' } },
                            ]}
                        />
                        <Alert
                            message="Garis kolam kontrol stabil (timer statis) sedangkan kolam perlakuan berfluktuasi mengikuti kondisi kualitas air terutama DO."
                            type="info"
                            showIcon
                            style={{ marginTop: '16px', borderRadius: '8px' }}
                        />
                    </Col>

                    <Col xs={24} lg={8}>
                        <Card type="inner" title={<><ExperimentOutlined /> RINGKASAN PAKAN (25 HARI)</>} style={{ borderRadius: '8px', height: '100%' }}>
                            <Row>
                                <Col span={12}>
                                    <Text strong style={{ color: '#1890ff' }}>Kolam Perlakuan (A)</Text>
                                    <Divider style={{ margin: '12px 0' }} />
                                    <Statistic title="Total Pakan" value={22450} suffix="g" valueStyle={{ color: '#1890ff', fontSize: '20px', fontWeight: 'bold' }} />
                                    <Statistic title="Rata-rata/Hari" value={898} suffix="g" valueStyle={{ fontSize: '16px' }} style={{ marginTop: '8px' }} />
                                    <Statistic title="Penghematan" value="-10.95%" valueStyle={{ color: '#52c41a', fontSize: '16px', fontWeight: 'bold' }} style={{ marginTop: '8px' }} />
                                </Col>
                                <Col span={12} style={{ borderLeft: '1px solid #f0f0f0', paddingLeft: '16px' }}>
                                    <Text strong type="secondary">Kolam Kontrol (Timer)</Text>
                                    <Divider style={{ margin: '12px 0' }} />
                                    <Statistic title="Total Pakan" value={25000} suffix="g" valueStyle={{ fontSize: '20px', color: '#595959' }} />
                                    <Statistic title="Rata-rata/Hari" value={1000} suffix="g" valueStyle={{ fontSize: '16px' }} style={{ marginTop: '8px' }} />
                                </Col>
                            </Row>
                            <div style={{ marginTop: '24px', padding: '12px', background: '#f6ffed', borderRadius: '8px', border: '1px solid #b7eb8f' }}>
                                <Text style={{ color: '#389e0d', fontSize: '13px' }}>
                                    <CheckCircleOutlined /> Sistem AI menghemat <b>2.550 gram</b> pakan (10.95%) dibanding sistem timer.
                                </Text>
                            </div>
                        </Card>
                    </Col>
                </Row>
            </Card>

            {/* SECTION C: SAMPLING MINGGUAN & FCR */}
            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <Title level={5} style={{ margin: '0 0 24px 0' }}>C. SAMPLING MINGGUAN (20 EKOR SAMPLING PER KOLAM) & EVALUASI FCR</Title>
                <Row gutter={[24, 24]}>

                    <Col xs={24} lg={6}>
                        <div style={{ background: '#fafafa', padding: '16px', borderRadius: '8px', border: '1px solid #f0f0f0' }}>
                            <Title level={5} style={{ marginBottom: '16px', fontSize: '14px' }}>INPUT SAMPLING MINGGUAN</Title>
                            <Form form={form} layout="vertical" onFinish={onFinishSampling} initialValues={{ minggu: '5', kolam: 'Perlakuan (A)', beratAwal: 152.6 }}>
                                <Row gutter={12}>
                                    <Col span={12}>
                                        <Form.Item name="minggu" label="Minggu ke-">
                                            <Select><Option value="1">1</Option><Option value="2">2</Option><Option value="3">3</Option><Option value="4">4</Option><Option value="5">5</Option></Select>
                                        </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                        <Form.Item name="kolam" label="Kolam">
                                            <Select>
                                                <Option value="Perlakuan (A)">Perlakuan (A)</Option>
                                                <Option value="Kontrol (Timer)">Kontrol (Timer)</Option>
                                            </Select>
                                        </Form.Item>
                                    </Col>
                                </Row>
                                <Form.Item name="beratAwal" label="Berat Awal (gram)">
                                    <InputNumber style={{ width: '100%' }} disabled />
                                </Form.Item>
                                <Form.Item name="beratAkhir" label="Berat Akhir (gram)" tooltip="Total biomassa ikan saat ini" rules={[{ required: true, message: 'Masukkan berat akhir' }]}>
                                    <InputNumber style={{ width: '100%' }} />
                                </Form.Item>
                                <Form.Item name="jumlahPakan" label="Jumlah Pakan (gram)" tooltip="Akumulasi pakan sejak awal siklus" rules={[{ required: true, message: 'Masukkan akumulasi pakan' }]}>
                                    <InputNumber style={{ width: '100%' }} />
                                </Form.Item>
                                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} block loading={loadingForm}>
                                    Simpan Data
                                </Button>
                            </Form>
                        </div>
                    </Col>

                    <Col xs={24} lg={14}>
                        <Table
                            columns={fcrColumns}
                            dataSource={fcrTableData}
                            loading={loadingTable}
                            pagination={false}
                            size="small"
                            bordered
                            summary={() => (
                                <Table.Summary fixed>
                                    <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                                        <Table.Summary.Cell index={0} align="center">TOTAL / RATA-RATA</Table.Summary.Cell>
                                        <Table.Summary.Cell index={1} align="center">5.400</Table.Summary.Cell>
                                        <Table.Summary.Cell index={2} align="center">5.000</Table.Summary.Cell>
                                        <Table.Summary.Cell index={3} align="center">2.194</Table.Summary.Cell>
                                        <Table.Summary.Cell index={4} align="center">1.892</Table.Summary.Cell>
                                        <Table.Summary.Cell index={5} align="center"><Text style={{ color: '#1890ff' }}>2.46</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={6} align="center">2.64</Table.Summary.Cell>
                                    </Table.Summary.Row>
                                </Table.Summary>
                            )}
                        />
                    </Col>

                    <Col xs={24} lg={4}>
                        <div style={{ background: '#e6f7ff', padding: '16px', borderRadius: '8px', border: '1px solid #91d5ff', height: '100%' }}>
                            <Title level={5} style={{ marginBottom: '16px', fontSize: '14px', color: '#096dd9' }}><CalculatorOutlined /> KETERANGAN</Title>
                            <div style={{ background: '#fff', padding: '8px', borderRadius: '4px', textAlign: 'center', marginBottom: '16px' }}>
                                <Text style={{ fontSize: '12px', fontWeight: 'bold' }}>FCR = Total Pakan (g) / (Biomassa Akhir - Biomassa Awal) (g)</Text>
                            </div>
                            <Space direction="vertical" size="small">
                                <Text style={{ fontSize: '12px' }}><InfoCircleOutlined style={{ color: '#1890ff' }} /> Semakin rendah nilai FCR, semakin efisien penggunaan pakan.</Text>
                                <Text style={{ fontSize: '12px' }}><InfoCircleOutlined style={{ color: '#1890ff' }} /> Data sampling langsung tersimpan ke database MySQL dan FCR dihitung otomatis.</Text>
                            </Space>
                        </div>
                    </Col>

                </Row>
            </Card>

        </div>
    );
};

export default Analysis;
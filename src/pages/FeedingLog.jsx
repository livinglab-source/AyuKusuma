import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Typography, Select, Button, Table, Tag, Space, Divider, message } from 'antd';
import { SyncOutlined, FileTextOutlined, FileExcelOutlined, FilePdfOutlined, EyeOutlined, CheckCircleOutlined, CloseCircleOutlined, ContainerOutlined } from '@ant-design/icons';
import api from '../api'; // Impor axios

const { Title, Text } = Typography;
const { Option } = Select;

const FeedingLog = () => {
    const [loading, setLoading] = useState(false);
    const [logData, setLogData] = useState([]);

    // State untuk Kartu Ringkasan
    const [summary, setSummary] = useState({ totalEvent: 0, totalPakan: 0, successCount: 0, failCount: 0 });

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const response = await api.get('/api/feeding-log');
            if (response.data.status === 'success') {
                const data = response.data.data;
                setLogData(data);

                // Kalkulasi data untuk kartu summary di atas tabel
                const success = data.filter(item => item.status === 'Berhasil').length;
                const totalFeed = data.reduce((sum, item) => sum + (item.jumlahPakan || 0), 0);

                setSummary({
                    totalEvent: data.length,
                    totalPakan: totalFeed,
                    successCount: success,
                    failCount: data.length - success
                });
            }
        } catch (error) {
            message.error("Gagal menarik data log dari database.");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // Panggil fungsi saat halaman dimuat
    useEffect(() => {
        fetchLogs();
    }, []);

    const handleRefresh = () => {
        fetchLogs();
    };

    // Konfigurasi Kolom Tabel
    const columns = [
        { title: 'Timestamp', dataIndex: 'timestamp', key: 'timestamp', width: 150 },
        { title: 'Pond Type', dataIndex: 'pondType', key: 'pondType', render: (text) => (<Text style={{ color: text.includes('ADM') ? '#1890ff' : '#595959', fontWeight: 500 }}>{text}</Text>) },
        { title: 'Suhu (°C)', dataIndex: 'suhu', key: 'suhu', align: 'center' },
        { title: 'DO (mg/L)', dataIndex: 'do', key: 'do', align: 'center' },
        { title: 'pH', dataIndex: 'ph', key: 'ph', align: 'center' },
        { title: 'TDS (ppm)', dataIndex: 'tds', key: 'tds', align: 'center' },
        { title: 'Output Fuzzy (Target Pakan)', dataIndex: 'targetPakan', key: 'targetPakan', align: 'center' },
        { title: 'Jumlah Pakan (gram)', dataIndex: 'jumlahPakan', key: 'jumlahPakan', align: 'center' },
        { title: 'Durasi Servo (detik)', dataIndex: 'durasi', key: 'durasi', align: 'center' },
        { title: 'Status Eksekusi', dataIndex: 'status', key: 'status', align: 'center', render: (status) => (<Tag color={status === 'Berhasil' ? 'success' : 'error'} style={{ borderRadius: '12px', padding: '2px 10px' }}>{status}</Tag>) },
        { title: 'Aksi', key: 'aksi', align: 'center', render: () => (<Button type="text" icon={<EyeOutlined style={{ color: '#1890ff' }} />} />) },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* HEADER & FILTER */}
            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <Title level={4} style={{ margin: 0 }}>Feeding Log</Title>
                <Text type="secondary">Riwayat keputusan dan eksekusi pemberian pakan (Audit Trail)</Text>

                <Divider style={{ margin: '16px 0' }} />

                <Row justify="space-between" align="middle" gutter={[16, 16]}>
                    <Col>
                        <Space size="middle" wrap>
                            <div>
                                <Text type="secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Rentang Waktu</Text>
                                <Select defaultValue="hari_ini" style={{ width: 150 }}>
                                    <Option value="hari_ini">Hari Ini</Option>
                                    <Option value="kemarin">Kemarin</Option>
                                    <Option value="minggu_ini">Minggu Ini</Option>
                                </Select>
                            </div>
                            <div>
                                <Text type="secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Pond Type</Text>
                                <Select defaultValue="semua" style={{ width: 180 }}>
                                    <Option value="semua">Semua Kolam</Option>
                                    <Option value="adm">Perlakuan (ADM)</Option>
                                    <Option value="timer">Kontrol (Timer)</Option>
                                </Select>
                            </div>
                            <div>
                                <Text type="secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Status Eksekusi</Text>
                                <Select defaultValue="semua" style={{ width: 150 }}>
                                    <Option value="semua">Semua Status</Option>
                                    <Option value="berhasil">Berhasil</Option>
                                    <Option value="gagal">Gagal</Option>
                                </Select>
                            </div>
                        </Space>
                    </Col>
                    <Col>
                        <Space wrap>
                            <Button type="primary" icon={<SyncOutlined />} loading={loading} onClick={handleRefresh}>
                                Refresh Data
                            </Button>
                            <Button icon={<FileTextOutlined style={{ color: '#52c41a' }} />}>Export CSV</Button>
                            <Button icon={<FileExcelOutlined style={{ color: '#52c41a' }} />}>Export Excel</Button>
                            <Button icon={<FilePdfOutlined style={{ color: '#f5222d' }} />}>Export PDF</Button>
                        </Space>
                    </Col>
                </Row>
            </Card>

            {/* SUMMARY CARDS */}
            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 600 }}>TOTAL FEEDING EVENT</Text>
                        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                            <div style={{ background: '#e6f7ff', padding: '12px', borderRadius: '50%' }}>
                                <ContainerOutlined style={{ fontSize: '24px', color: '#1890ff' }} />
                            </div>
                            <div style={{ textAlign: 'left' }}>
                                <Title level={2} style={{ margin: 0, color: '#1890ff' }}>18</Title>
                                <Text type="secondary" style={{ fontSize: '12px' }}>Event hari ini</Text>
                            </div>
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 600 }}>TOTAL PAKAN HARI INI</Text>
                        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                            <div style={{ background: '#f6ffed', padding: '12px', borderRadius: '50%' }}>
                                <ContainerOutlined style={{ fontSize: '24px', color: '#52c41a' }} />
                            </div>
                            <div style={{ textAlign: 'left' }}>
                                <Title level={2} style={{ margin: 0, color: '#52c41a' }}>14,850 g</Title>
                                <Text type="secondary" style={{ fontSize: '12px' }}>14.85 kg</Text>
                            </div>
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 600 }}>FEEDING BERHASIL</Text>
                        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                            <div style={{ background: '#f6ffed', padding: '12px', borderRadius: '50%' }}>
                                <CheckCircleOutlined style={{ fontSize: '24px', color: '#52c41a' }} />
                            </div>
                            <div style={{ textAlign: 'left' }}>
                                <Title level={2} style={{ margin: 0, color: '#52c41a' }}>{summary.successCount}</Title>
                                <Text type="secondary" style={{ fontSize: '12px' }}>{(summary.successCount / summary.totalEvent * 100).toFixed(2)} %</Text>
                            </div>
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 600 }}>FEEDING GAGAL</Text>
                        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                            <div style={{ background: '#fff1f0', padding: '12px', borderRadius: '50%' }}>
                                <CloseCircleOutlined style={{ fontSize: '24px', color: '#f5222d' }} />
                            </div>
                            <div style={{ textAlign: 'left' }}>
                                <Title level={2} style={{ margin: 0, color: '#f5222d' }}>1</Title>
                                <Text type="secondary" style={{ fontSize: '12px' }}>5.56%</Text>
                            </div>
                        </div>
                    </Card>
                </Col>
            </Row>

            {/* DATA TABLE */}
            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <Table
                    columns={columns}
                    dataSource={logData}
                    loading={loading}
                    pagination={{
                        total: logData.length,
                        pageSize: 10,
                        showSizeChanger: true,
                        showTotal: (total, range) => `Menampilkan ${range[0]}-${range[1]} dari ${total} data`
                    }}
                    scroll={{ x: 'max-content' }}
                />
            </Card>

        </div>
    );
};

export default FeedingLog;
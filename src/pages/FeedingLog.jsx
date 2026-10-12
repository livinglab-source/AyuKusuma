import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Typography, Select, Button, Table, Tag, message } from 'antd';
import {
    SyncOutlined,
    ContainerOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    EyeOutlined,
    FileExcelOutlined,
    FilePdfOutlined,
    FileTextOutlined
} from '@ant-design/icons';
import api from '../api'; // Pastikan path import axios ini benar

const { Title, Text } = Typography;
const { Option } = Select;

const FeedingLog = () => {
    const [loading, setLoading] = useState(false);
    const [logData, setLogData] = useState([]);

    // State untuk menyimpan angka perhitungan kartu atas
    const [summary, setSummary] = useState({
        totalEvent: 0,
        totalPakan: 0,
        successCount: 0,
        failCount: 0
    });

    // Fungsi untuk menarik data aktual dari database
    const fetchLogs = async () => {
        setLoading(true);
        try {
            const response = await api.get('/api/feeding-log');
            if (response.data.status === 'success') {
                const data = response.data.data;
                setLogData(data);

                // --- PROSES MATEMATIKA UNTUK KARTU SUMMARY ---
                const success = data.filter(item => item.status === 'Berhasil').length;
                const fail = data.length - success;

                // Jumlahkan semua pakan (gram)
                const totalFeed = data.reduce((sum, item) => sum + (item.jumlahPakan || 0), 0);

                setSummary({
                    totalEvent: data.length,
                    totalPakan: totalFeed,
                    successCount: success,
                    failCount: fail
                });
            }
        } catch (error) {
            message.error("Gagal menarik data log dari database.");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // Otomatis tarik data saat halaman pertama kali dibuka
    useEffect(() => {
        fetchLogs();
    }, []);

    const handleRefresh = () => {
        fetchLogs();
    };

    // Konfigurasi Kolom Tabel
    const columns = [
        {
            title: 'Timestamp',
            dataIndex: 'timestamp',
            key: 'timestamp',
            width: 190,
            render: (text) => {
                if (!text) return '-';
                try {
                    // 1. Buat objek Date dari string UTC (InfluxDB biasanya mengirim UTC berakhiran 'Z')
                    // Jika teks dari InfluxDB tidak berakhiran Z, tambahkan secara manual agar JS tahu itu UTC
                    const utcString = text.endsWith('Z') ? text : `${text}Z`;
                    const dateObj = new Date(utcString);

                    // 2. Jika valid, konversi ke format Indonesia dengan zona waktu Makassar (WITA)
                    if (!isNaN(dateObj.getTime())) {
                        return dateObj.toLocaleString('id-ID', {
                            timeZone: 'Asia/Makassar',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false // Pastikan format 24 jam
                        }) + ' WITA'; // Tambahkan teks WITA untuk kejelasan
                    }
                    // Jika gagal parsing, kembalikan teks asli
                    return text;
                } catch (e) {
                    return text;
                }
            }
        },
        { title: 'Pond Type', dataIndex: 'pondType', key: 'pondType', render: (text) => (<Text style={{ color: text?.includes('ADM') ? '#1890ff' : '#595959', fontWeight: 500 }}>{text}</Text>) },
        { title: 'Suhu (°C)', dataIndex: 'suhu', key: 'suhu', align: 'center' },
        { title: 'DO (mg/L)', dataIndex: 'do', key: 'do', align: 'center' },
        { title: 'pH', dataIndex: 'ph', key: 'ph', align: 'center' },
        { title: 'TDS (ppm)', dataIndex: 'tds', key: 'tds', align: 'center' },
        { title: 'Output Fuzzy', dataIndex: 'targetPakan', key: 'targetPakan', align: 'center' },
        { title: 'Jumlah Pakan (g)', dataIndex: 'jumlahPakan', key: 'jumlahPakan', align: 'center', render: (val) => <Text strong>{val}</Text> },
        { title: 'Durasi (detik)', dataIndex: 'durasi', key: 'durasi', align: 'center' },
        { title: 'Status', dataIndex: 'status', key: 'status', align: 'center', render: (status) => (<Tag color={status === 'Berhasil' ? 'success' : 'error'} style={{ borderRadius: '12px', padding: '2px 10px' }}>{status}</Tag>) },
        { title: 'Aksi', key: 'aksi', align: 'center', render: () => (<Button type="text" icon={<EyeOutlined style={{ color: '#1890ff' }} />} />) },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* HEADER */}
            <div>
                <Title level={3} style={{ margin: 0 }}>Feeding Log</Title>
                <Text type="secondary">Riwayat keputusan dan eksekusi pemberian pakan (Audit Trail)</Text>
            </div>

            {/* FILTER & TOMBOL */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <Select defaultValue="Hari Ini" style={{ width: 120 }}><Option value="Hari Ini">Hari Ini</Option></Select>
                <Select defaultValue="Semua Kolam" style={{ width: 150 }}><Option value="Semua Kolam">Semua Kolam</Option></Select>
                <Select defaultValue="Semua Status" style={{ width: 150 }}><Option value="Semua Status">Semua Status</Option></Select>

                <Button type="primary" icon={<SyncOutlined />} onClick={handleRefresh} loading={loading}>
                    Refresh Data
                </Button>
                <Button icon={<FileTextOutlined />}>Export CSV</Button>
                <Button icon={<FileExcelOutlined />}>Export Excel</Button>
                <Button icon={<FilePdfOutlined />}>Export PDF</Button>
            </div>

            {/* 4 KARTU SUMMARY DINAMIS */}
            <Row gutter={[16, 16]}>

                {/* KARTU 1: TOTAL EVENT */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'bold' }}>TOTAL FEEDING EVENT</Text>
                        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
                            <div style={{ background: '#e6f4ff', padding: '12px', borderRadius: '50%' }}>
                                <ContainerOutlined style={{ fontSize: '24px', color: '#1677ff' }} />
                            </div>
                            <Title level={2} style={{ margin: 0, color: '#1677ff' }}>{summary.totalEvent}</Title>
                        </div>
                        <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>Event terekam</Text>
                    </Card>
                </Col>

                {/* KARTU 2: TOTAL PAKAN */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'bold' }}>TOTAL PAKAN</Text>
                        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
                            <div style={{ background: '#f6ffed', padding: '12px', borderRadius: '50%' }}>
                                <ContainerOutlined style={{ fontSize: '24px', color: '#52c41a' }} />
                            </div>
                            <Title level={2} style={{ margin: 0, color: '#52c41a' }}>{summary.totalPakan.toLocaleString('id-ID')} g</Title>
                        </div>
                        {/* Konversi gram ke kg otomatis */}
                        <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>
                            {(summary.totalPakan / 1000).toFixed(2)} kg
                        </Text>
                    </Card>
                </Col>

                {/* KARTU 3: BERHASIL */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'bold' }}>FEEDING BERHASIL</Text>
                        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
                            <div style={{ background: '#f6ffed', padding: '12px', borderRadius: '50%' }}>
                                <CheckCircleOutlined style={{ fontSize: '24px', color: '#52c41a' }} />
                            </div>
                            <Title level={2} style={{ margin: 0, color: '#52c41a' }}>{summary.successCount}</Title>
                        </div>
                        {/* Hitung persentase keberhasilan otomatis */}
                        <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>
                            {summary.totalEvent > 0 ? ((summary.successCount / summary.totalEvent) * 100).toFixed(2) : 0} %
                        </Text>
                    </Card>
                </Col>

                {/* KARTU 4: GAGAL */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: '12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                        <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'bold' }}>FEEDING GAGAL</Text>
                        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
                            <div style={{ background: '#fff1f0', padding: '12px', borderRadius: '50%' }}>
                                <CloseCircleOutlined style={{ fontSize: '24px', color: '#ff4d4f' }} />
                            </div>
                            <Title level={2} style={{ margin: 0, color: '#ff4d4f' }}>{summary.failCount}</Title>
                        </div>
                        {/* Hitung persentase kegagalan otomatis */}
                        <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>
                            {summary.totalEvent > 0 ? ((summary.failCount / summary.totalEvent) * 100).toFixed(2) : 0} %
                        </Text>
                    </Card>
                </Col>
            </Row>

            {/* TABEL LOG */}
            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <Table
                    columns={columns}
                    dataSource={logData}
                    loading={loading}
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        showTotal: (total, range) => `Menampilkan ${range[0]}-${range[1]} dari ${total} log`
                    }}
                    scroll={{ x: 'max-content' }}
                />
            </Card>
        </div>
    );
};

export default FeedingLog;
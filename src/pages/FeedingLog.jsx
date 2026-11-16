import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, Row, Col, Typography, Select, Button, Table, Tag, message, Modal, Descriptions, Space, Form, InputNumber, DatePicker, Popconfirm } from 'antd';
import {
    SyncOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    EyeOutlined,
    EditOutlined,
    DeleteOutlined,
    FileExcelOutlined,
    FilePdfOutlined,
    FileTextOutlined,
    ExperimentOutlined,
    UnorderedListOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { getCachedData, invalidateCache } from '../api';
import { TIME_ZONE, parseUtc, formatDateTimeWita, dateKeyWita } from '../utils/time';
import { getStableLogKey, saveFeedingLogEdit, markFeedingLogDeleted, isControlPondType } from '../utils/feedingLogStorage';
import { EmptyState, ErrorState } from '../components/SystemStates';

const { Text } = Typography;

// Pilihan filter periode
const PERIOD_OPTIONS = [
    { value: 'today', label: 'Hari Ini' },
    { value: '7d', label: '7 Hari Terakhir' },
    { value: '30d', label: '30 Hari Terakhir' },
    { value: 'all', label: 'Semua Waktu' },
];

// Pilihan filter status
const STATUS_OPTIONS = [
    { value: 'all', label: 'Semua Status' },
    { value: 'Berhasil', label: 'Berhasil' },
    { value: 'Gagal', label: 'Gagal' },
];

const getItemDate = (item) => parseUtc(item?.timestamp_iso) || parseUtc(item?.timestamp) || parseUtc(item?.key);
const normalizeStatus = (status) => (status === 'Berhasil' ? 'Berhasil' : 'Gagal');

// Definisi kolom untuk file export (CSV / Excel / PDF)
const EXPORT_COLUMNS = [
    { header: 'Timestamp', get: (r) => formatDateTimeWita(r.timestamp_iso || r.timestamp) },
    { header: 'Pond Type', get: (r) => r.pondType ?? '—' },
    { header: 'Suhu (°C)', get: (r) => r.suhu ?? '—' },
    { header: 'DO (mg/L)', get: (r) => r.do ?? '—' },
    { header: 'pH', get: (r) => r.ph ?? '—' },
    { header: 'TDS (ppm)', get: (r) => r.tds ?? '—' },
    { header: 'Output Fuzzy', get: (r) => r.targetPakan ?? '—' },
    { header: 'Jumlah Pakan (g)', get: (r) => r.jumlahPakan ?? '—' },
    { header: 'Durasi (detik)', get: (r) => r.durasi ?? '—' },
    { header: 'Status', get: (r) => r.status ?? '—' },
];

const buildFileName = () => {
    const now = new Date();
    const date = dateKeyWita(now);
    const time = now
        .toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
        .replace(':', '');
    return `feeding-log_${date}_${time}`;
};

const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const FeedingLog = () => {
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState(null);
    const [logData, setLogData] = useState(() => getCachedData('/api/feeding-log')?.data || []);
    const [exporting, setExporting] = useState(null);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState(null);
    const [editForm] = Form.useForm();

    // State filter
    const [period, setPeriod] = useState('today');
    const [pond, setPond] = useState('all');
    const [status, setStatus] = useState('all');

    const fetchLogs = useCallback(async (showToast = false) => {
        if (showToast) setLoading(true);
        setFetchError(null);
        try {
            const response = await api.get('/api/feeding-log', { forceRefresh: showToast });
            setLoading(false);
            if (response.data.status === 'success') {
                setLogData(Array.isArray(response.data.data) ? response.data.data : []);
                if (showToast) message.success('Data riwayat pakan berhasil diperbarui.');
            } else {
                setFetchError('Server tidak mengembalikan daftar log pakan.');
            }
        } catch {
            setLoading(false);
            setFetchError('Gagal menarik data log pakan dari database.');
        }
    }, []);

    const handleOpenEditModal = (record) => {
        setSelectedRecord(record);
        const dt = getItemDate(record);
        editForm.setFieldsValue({
            tanggal: dt ? dayjs(dt) : dayjs(),
            pondType: isControlPondType(record?.pondType) ? 'kontrol' : 'adm',
            jumlahPakan: Number(record?.jumlahPakan) || 0,
            targetPakan: record?.targetPakan !== undefined && record?.targetPakan !== '—' ? Number(record.targetPakan) : undefined,
            durasi: record?.durasi !== undefined && record?.durasi !== '—' ? Number(record.durasi) : undefined,
            status: record?.status === 'Gagal' ? 'Gagal' : 'Berhasil',
        });
        setEditModalOpen(true);
    };

    const handleSaveEdit = async () => {
        try {
            const values = await editForm.validateFields();
            if (!selectedRecord) return;
            const dateObj = values.tanggal?.toDate ? values.tanggal.toDate() : new Date(values.tanggal);
            const dateKey = dateKeyWita(dateObj);
            const pondLabel = values.pondType === 'kontrol' ? 'Kolam A (Kontrol)' : 'Kolam B (Perlakuan - ADM)';
            saveFeedingLogEdit(selectedRecord, {
                dateKey,
                pondType: pondLabel,
                jumlahPakan: Number(values.jumlahPakan),
                targetPakan: values.targetPakan !== undefined && values.targetPakan !== null ? Number(values.targetPakan) : undefined,
                durasi: values.durasi !== undefined && values.durasi !== null ? Number(values.durasi) : undefined,
                status: values.status || 'Berhasil',
            });
            invalidateCache('/api/feeding-log');
            setEditModalOpen(false);
            message.success('Log pemberian pakan berhasil diperbarui.');
            await fetchLogs(false);
        } catch {
            // validasi form
        }
    };

    const handleDeleteLog = async (record) => {
        markFeedingLogDeleted(record);
        invalidateCache('/api/feeding-log');
        setDetailModalOpen(false);
        setEditModalOpen(false);
        message.success('Log pemberian pakan berhasil dihapus.');
        await fetchLogs(false);
    };

    useEffect(() => {
        const initTimer = setTimeout(() => {
            fetchLogs(false);
        }, 0);
        return () => clearTimeout(initTimer);
    }, [fetchLogs]);

    const pondOptions = useMemo(() => {
        const ponds = [...new Set(logData.map((item) => item.pondType).filter(Boolean))].sort();
        return [
            { value: 'all', label: 'Semua Kolam' },
            ...ponds.map((p) => ({ value: p, label: p })),
        ];
    }, [logData]);

    const filteredData = useMemo(() => {
        const now = new Date();
        const todayKey = dateKeyWita(now);
        const days = period === '7d' ? 7 : period === '30d' ? 30 : null;
        const minTime = days ? now.getTime() - days * 24 * 60 * 60 * 1000 : null;

        return logData
            .filter((item) => {
                if (period !== 'all') {
                    const dateObj = getItemDate(item);
                    if (!dateObj) return false;
                    if (period === 'today' && dateKeyWita(dateObj) !== todayKey) return false;
                    if (minTime !== null && dateObj.getTime() < minTime) return false;
                }
                if (pond !== 'all' && item.pondType !== pond) return false;
                if (status !== 'all' && normalizeStatus(item.status) !== status) return false;
                return true;
            })
            .sort((a, b) => (getItemDate(b)?.getTime() ?? 0) - (getItemDate(a)?.getTime() ?? 0));
    }, [logData, period, pond, status]);

    const summary = useMemo(() => {
        const success = filteredData.filter((item) => item.status === 'Berhasil').length;
        const totalFeed = filteredData.reduce((sum, item) => sum + (Number(item.jumlahPakan) || 0), 0);
        return {
            totalEvent: filteredData.length,
            totalPakan: totalFeed,
            successCount: success,
            failCount: filteredData.length - success,
        };
    }, [filteredData]);

    const filterDescription = () => {
        const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label;
        const pondLabel = pondOptions.find((o) => o.value === pond)?.label ?? pond;
        const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label;
        return `Periode: ${periodLabel}  |  Kolam: ${pondLabel}  |  Status: ${statusLabel}`;
    };

    const ensureData = () => {
        if (filteredData.length === 0) {
            message.warning('Tidak ada data untuk diekspor pada filter ini.');
            return false;
        }
        return true;
    };

    // ---------- EXPORT CSV ----------
    const handleExportCSV = () => {
        if (!ensureData()) return;
        setExporting('csv');
        try {
            const escape = (val) => {
                const str = String(val ?? '');
                return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
            };
            const lines = [
                EXPORT_COLUMNS.map((c) => escape(c.header)).join(','),
                ...filteredData.map((row) => EXPORT_COLUMNS.map((c) => escape(c.get(row))).join(',')),
            ];
            const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
            downloadBlob(blob, `${buildFileName()}.csv`);
            message.success('Berhasil mengekspor laporan CSV.');
        } catch {
            message.error('Gagal mengekspor CSV.');
        } finally {
            setExporting(null);
        }
    };

    // ---------- EXPORT EXCEL ----------
    const handleExportExcel = async () => {
        if (!ensureData()) return;
        setExporting('excel');
        try {
            const XLSX = await import('xlsx');
            const rows = filteredData.map((row) =>
                Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.header, c.get(row)]))
            );
            const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS.map((c) => c.header) });
            worksheet['!cols'] = EXPORT_COLUMNS.map((c) => ({ wch: c.header === 'Timestamp' ? 26 : Math.max(12, c.header.length + 2) }));

            const summarySheet = XLSX.utils.aoa_to_sheet([
                ['Ringkasan Feeding Log'],
                [filterDescription()],
                [],
                ['Total Feeding Event', summary.totalEvent],
                ['Total Pakan (g)', summary.totalPakan],
                ['Feeding Berhasil', summary.successCount],
                ['Feeding Gagal', summary.failCount],
            ]);
            summarySheet['!cols'] = [{ wch: 24 }, { wch: 16 }];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Feeding Log');
            XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan');
            XLSX.writeFile(workbook, `${buildFileName()}.xlsx`);
            message.success('Berhasil mengekspor laporan Excel.');
        } catch {
            message.error('Gagal mengekspor Excel.');
        } finally {
            setExporting(null);
        }
    };

    // ---------- EXPORT PDF ----------
    const handleExportPDF = async () => {
        if (!ensureData()) return;
        setExporting('pdf');
        try {
            const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const pageWidth = doc.internal.pageSize.getWidth();

            doc.setFontSize(15);
            doc.text('Feeding Audit Trail — Smart Feeder Aquaculture', 40, 40);
            doc.setFontSize(9);
            doc.setTextColor(100);
            doc.text(filterDescription(), 40, 58);
            doc.text(`Dicetak: ${formatDateTimeWita(new Date())}`, 40, 72);
            doc.text(
                `Total Event: ${summary.totalEvent}   |   Total Pakan: ${summary.totalPakan.toLocaleString('id-ID')} g   |   Berhasil: ${summary.successCount}   |   Gagal: ${summary.failCount}`,
                40,
                86
            );

            autoTable(doc, {
                startY: 100,
                head: [EXPORT_COLUMNS.map((c) => c.header)],
                body: filteredData.map((row) => EXPORT_COLUMNS.map((c) => String(c.get(row)))),
                styles: { fontSize: 8, cellPadding: 4 },
                headStyles: { fillColor: [70, 73, 229], textColor: 255 },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                columnStyles: { 0: { cellWidth: 120 } },
                didParseCell: (data) => {
                    if (data.section === 'body' && data.column.index === EXPORT_COLUMNS.length - 1) {
                        data.cell.styles.textColor = data.cell.raw === 'Berhasil' ? [5, 150, 105] : [220, 38, 38];
                        data.cell.styles.fontStyle = 'bold';
                    }
                },
                didDrawPage: () => {
                    const pageHeight = doc.internal.pageSize.getHeight();
                    doc.setFontSize(8);
                    doc.setTextColor(140);
                    doc.text(`Halaman ${doc.getNumberOfPages()}`, pageWidth - 80, pageHeight - 20);
                },
            });

            doc.save(`${buildFileName()}.pdf`);
            message.success('Berhasil mengekspor laporan PDF.');
        } catch {
            message.error('Gagal mengekspor PDF.');
        } finally {
            setExporting(null);
        }
    };

    const columns = [
        {
            title: 'Waktu Eksekusi (WITA)',
            dataIndex: 'timestamp',
            key: 'timestamp',
            width: 185,
            render: (text, record) => <span className="sf-mono">{formatDateTimeWita(record?.timestamp_iso || record?.timestamp || text)}</span>,
        },
        {
            title: 'Kolam',
            dataIndex: 'pondType',
            key: 'pondType',
            render: (text) => (
                <Text strong style={{ color: /adm|perlakuan/i.test(text) ? 'var(--color-adm)' : 'var(--text-secondary)' }}>
                    {text || '—'}
                </Text>
            ),
        },
        { title: 'Suhu (°C)', dataIndex: 'suhu', key: 'suhu', align: 'right', render: (v) => v ?? '—' },
        { title: 'DO (mg/L)', dataIndex: 'do', key: 'do', align: 'right', render: (v) => v ?? '—' },
        { title: 'pH', dataIndex: 'ph', key: 'ph', align: 'right', render: (v) => v ?? '—' },
        { title: 'TDS (ppm)', dataIndex: 'tds', key: 'tds', align: 'right', render: (v) => v ?? '—' },
        { title: 'Target Fuzzy (g)', dataIndex: 'targetPakan', key: 'targetPakan', align: 'right', render: (v) => v ?? '—' },
        {
            title: 'Pakan Aktual (g)',
            dataIndex: 'jumlahPakan',
            key: 'jumlahPakan',
            align: 'right',
            render: (val) => <Text strong>{val ?? '—'}</Text>,
        },
        { title: 'Durasi (dtk)', dataIndex: 'durasi', key: 'durasi', align: 'right', render: (v) => v ?? '—' },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            align: 'center',
            render: (st) => (
                <Tag color={st === 'Berhasil' ? 'success' : 'error'} style={{ margin: 0 }}>
                    {st}
                </Tag>
            ),
        },
        {
            title: 'Aksi',
            key: 'aksi',
            align: 'center',
            width: 110,
            render: (_, record) => (
                <Space size={4}>
                    <Button
                        type="text"
                        size="small"
                        title="Lihat Detail"
                        icon={<EyeOutlined style={{ color: 'var(--color-adm)' }} />}
                        onClick={() => {
                            setSelectedRecord(record);
                            setDetailModalOpen(true);
                        }}
                    />
                    <Button
                        type="text"
                        size="small"
                        title="Edit Log Pakan"
                        icon={<EditOutlined style={{ color: 'var(--color-adm)' }} />}
                        onClick={() => handleOpenEditModal(record)}
                    />
                    <Popconfirm
                        title="Hapus log pakan ini?"
                        description="Log yang dihapus tidak akan dihitung dalam grafik dan FCR."
                        onConfirm={() => handleDeleteLog(record)}
                        okText="Hapus"
                        cancelText="Batal"
                        okButtonProps={{ danger: true }}
                    >
                        <Button
                            type="text"
                            size="small"
                            danger
                            title="Hapus Log Pakan"
                            icon={<DeleteOutlined />}
                        />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {fetchError && (
                <ErrorState
                    title="Gagal Memuat Audit Trail"
                    description={fetchError}
                    onRetry={() => fetchLogs(true)}
                />
            )}

            {/* 4 KARTU RINGKASAN AUDIT TRAIL */}
            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <div className="sf-metric-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span className="sf-metric-label">Total Feeding Event</span>
                            <UnorderedListOutlined style={{ color: 'var(--color-adm)' }} />
                        </div>
                        <div className="sf-metric-value">{summary.totalEvent}</div>
                        <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                            Event terekam sesuai filter
                        </Text>
                    </div>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <div className="sf-metric-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span className="sf-metric-label">Akumulasi Pakan</span>
                            <ExperimentOutlined style={{ color: 'var(--status-success)' }} />
                        </div>
                        <div>
                            <span className="sf-metric-value">{summary.totalPakan.toLocaleString('id-ID')}</span>
                            <span className="sf-metric-unit">gram</span>
                        </div>
                        <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                            Setara {(summary.totalPakan / 1000).toFixed(2)} kg pakan
                        </Text>
                    </div>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <div className="sf-metric-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span className="sf-metric-label">Eksekusi Berhasil</span>
                            <CheckCircleOutlined style={{ color: 'var(--status-success)' }} />
                        </div>
                        <div className="sf-metric-value" style={{ color: 'var(--status-success)' }}>
                            {summary.successCount}
                        </div>
                        <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                            Rasio keberhasilan: {summary.totalEvent > 0 ? ((summary.successCount / summary.totalEvent) * 100).toFixed(1) : 0}%
                        </Text>
                    </div>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <div className="sf-metric-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span className="sf-metric-label">Eksekusi Gagal</span>
                            <CloseCircleOutlined style={{ color: 'var(--status-danger)' }} />
                        </div>
                        <div className="sf-metric-value" style={{ color: summary.failCount > 0 ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                            {summary.failCount}
                        </div>
                        <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                            Rasio kegagalan: {summary.totalEvent > 0 ? ((summary.failCount / summary.totalEvent) * 100).toFixed(1) : 0}%
                        </Text>
                    </div>
                </Col>
            </Row>

            {/* FILTER BAR & TABEL LOG */}
            <Card
                title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '8px 0' }}>
                        <Space size={8} wrap>
                            <Select id="filter-period" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} style={{ width: 155 }} />
                            <Select id="filter-pond" value={pond} onChange={setPond} options={pondOptions} style={{ width: 180 }} />
                            <Select id="filter-status" value={status} onChange={setStatus} options={STATUS_OPTIONS} style={{ width: 145 }} />
                            <Button id="btn-refresh" icon={<SyncOutlined spin={loading} />} onClick={() => fetchLogs(true)}>
                                Segarkan
                            </Button>
                        </Space>

                        <Space size={8} wrap>
                            <Button id="btn-export-csv" icon={<FileTextOutlined />} onClick={handleExportCSV} loading={exporting === 'csv'} disabled={loading || filteredData.length === 0}>
                                CSV
                            </Button>
                            <Button id="btn-export-excel" icon={<FileExcelOutlined />} onClick={handleExportExcel} loading={exporting === 'excel'} disabled={loading || filteredData.length === 0}>
                                Excel
                            </Button>
                            <Button id="btn-export-pdf" icon={<FilePdfOutlined />} onClick={handleExportPDF} loading={exporting === 'pdf'} disabled={loading || filteredData.length === 0}>
                                PDF
                            </Button>
                        </Space>
                    </div>
                }
            >
                {filteredData.length === 0 && !loading ? (
                    <EmptyState
                        title="Tidak Ada Rekaman Pemberian Pakan"
                        description={
                            period === 'today'
                                ? 'Belum ada pemberian pakan yang tercatat pada hari ini. Ubah filter periode ke "Semua Waktu" untuk melihat riwayat sebelumnya.'
                                : 'Tidak ditemukan riwayat pakan yang sesuai dengan kombinasi filter saat ini.'
                        }
                        actionLabel={period === 'today' ? 'Tampilkan Semua Waktu' : undefined}
                        onAction={period === 'today' ? () => setPeriod('all') : undefined}
                    />
                ) : (
                    <Table
                        columns={columns}
                        dataSource={filteredData}
                        rowKey={(row) => getStableLogKey(row)}
                        loading={loading}
                        size="small"
                        pagination={{
                            pageSize: 10,
                            showSizeChanger: true,
                            showTotal: (total, range) => `${range[0]}–${range[1]} dari ${total} log`,
                        }}
                        scroll={{ x: 860 }}
                    />
                )}
            </Card>

            {/* Modal Detail Feeding Log */}
            <Modal
                title="Rincian Audit Pemberian Pakan (Firestore)"
                open={detailModalOpen}
                onCancel={() => setDetailModalOpen(false)}
                footer={[
                    <Button
                        key="edit"
                        icon={<EditOutlined />}
                        onClick={() => {
                            setDetailModalOpen(false);
                            if (selectedRecord) handleOpenEditModal(selectedRecord);
                        }}
                    >
                        Edit Log Ini
                    </Button>,
                    <Button key="close" type="primary" onClick={() => setDetailModalOpen(false)}>
                        Tutup
                    </Button>,
                ]}
                centered
            >
                {selectedRecord && (
                    <Descriptions bordered column={1} size="small" style={{ marginTop: 12 }}>
                        <Descriptions.Item label="ID Dokumen">
                            <Text code copyable>{selectedRecord.id || selectedRecord.key || '—'}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Waktu Eksekusi">
                            <span className="sf-mono">{formatDateTimeWita(selectedRecord?.timestamp_iso || selectedRecord?.timestamp)}</span>
                        </Descriptions.Item>
                        <Descriptions.Item label="Tipe Kolam">
                            <Text strong style={{ color: /adm|perlakuan/i.test(selectedRecord.pondType) ? 'var(--color-adm)' : 'var(--text-secondary)' }}>
                                {selectedRecord.pondType || '—'}
                            </Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Status">
                            <Tag color={selectedRecord.status === 'Berhasil' ? 'success' : 'error'}>
                                {selectedRecord.status}
                            </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Jumlah Pakan">
                            <Text strong>{selectedRecord.jumlahPakan} gram</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Output Fuzzy ADM">
                            {selectedRecord.targetPakan ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="Durasi Servo">
                            {selectedRecord.durasi ?? '—'} detik
                        </Descriptions.Item>
                        <Descriptions.Item label="Suhu Air">
                            {selectedRecord.suhu ?? '—'} °C
                        </Descriptions.Item>
                        <Descriptions.Item label="Dissolved Oxygen (DO)">
                            {selectedRecord.do ?? '—'} mg/L
                        </Descriptions.Item>
                        <Descriptions.Item label="pH Air">
                            {selectedRecord.ph ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="TDS">
                            {selectedRecord.tds ?? '—'} ppm
                        </Descriptions.Item>
                    </Descriptions>
                )}
            </Modal>

            {/* Modal Edit Feeding Log (Kolam B & Kolam A) */}
            <Modal
                title="Edit Log Pemberian Pakan"
                open={editModalOpen}
                onCancel={() => setEditModalOpen(false)}
                onOk={handleSaveEdit}
                okText="Simpan Perubahan"
                cancelText="Batal"
                centered
            >
                <Form form={editForm} layout="vertical" style={{ marginTop: 12 }}>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="tanggal" label="Tanggal Pemberian" rules={[{ required: true, message: 'Pilih tanggal' }]}>
                                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" allowClear={false} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="pondType" label="Kolam" rules={[{ required: true }]}>
                                <Select
                                    options={[
                                        { value: 'adm', label: 'Kolam B — Perlakuan (ADM)' },
                                        { value: 'kontrol', label: 'Kolam A — Kontrol (Timer)' },
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="jumlahPakan" label="Jumlah Pakan Aktual (g)" rules={[{ required: true, message: 'Masukkan pakan' }]}>
                                <InputNumber style={{ width: '100%' }} min={0} step={1} addonAfter="gram" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="status" label="Status Eksekusi" rules={[{ required: true }]}>
                                <Select
                                    options={[
                                        { value: 'Berhasil', label: 'Berhasil' },
                                        { value: 'Gagal', label: 'Gagal' },
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="targetPakan" label="Target Fuzzy ADM (g)">
                                <InputNumber style={{ width: '100%' }} min={0} step={1} placeholder="Opsional" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="durasi" label="Durasi Servo (detik)">
                                <InputNumber style={{ width: '100%' }} min={0} step={1} placeholder="Opsional" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </div>
    );
};

export default FeedingLog;

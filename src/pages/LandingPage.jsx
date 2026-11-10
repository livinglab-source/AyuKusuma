import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Typography, Button, Card, Row, Col, Badge, Space, Divider,
    Table, Tag, Modal, Form, Input, Statistic, Alert, Progress
} from 'antd';
import {
    LockOutlined,
    UserOutlined,
    DashboardOutlined,
    ThunderboltOutlined,
    ExperimentOutlined,
    CheckCircleOutlined,
    WarningOutlined,
    TrophyOutlined,
    SyncOutlined,
    CompassOutlined,
    DatabaseOutlined,
    RiseOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import api, { loginAdmin, logoutAdmin, isAuthenticated, getCachedData } from '../api';
import {
    OfflineBanner,
    DataFreshnessBadge,
    StaleDataBanner,
    NotificationBell,
    EmptyState,
    ErrorState,
    LoadingState,
    confirmAction,
} from '../components/SystemStates';

const { Title, Text, Paragraph } = Typography;

const formatNum = (val, decimals = 1) =>
    val !== undefined && val !== null && !isNaN(Number(val))
        ? Number(val).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
        : '—';

const LandingPage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const initAdm = getCachedData('/api/dashboard/adm');
    const initKontrol = getCachedData('/api/dashboard/kontrol');
    const initFeed = getCachedData('/api/feeding-log')?.data;
    const initSamp = getCachedData('/api/sampling')?.data;

    const [loading, setLoading] = useState(() => !(initAdm || initKontrol || initFeed || initSamp));
    const [refreshing, setRefreshing] = useState(false);
    const [apiError, setApiError] = useState(null);
    const [isFromCache, setIsFromCache] = useState(Boolean(initAdm || initKontrol));

    // Data Telemetri & Evaluasi (Murni dari API/Database tanpa angka palsu)
    const [admData, setAdmData] = useState(() => initAdm?.data || initAdm || null);
    const [kontrolData, setKontrolData] = useState(() => initKontrol?.data || initKontrol || null);
    const [feedingLogs, setFeedingLogs] = useState(() => (Array.isArray(initFeed) ? initFeed : []));
    const [samplingList, setSamplingList] = useState(() => (Array.isArray(initSamp) ? initSamp : []));

    // State Autentikasi Admin & Modal Login
    const [isLoggedIn, setIsLoggedIn] = useState(isAuthenticated());
    const [loginModalOpen, setLoginModalOpen] = useState(false);
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState(null);
    const [form] = Form.useForm();

    const fetchData = useCallback(async (isManualRefresh = false) => {
        if (isManualRefresh) setRefreshing(true);
        setApiError(null);

        const opts = isManualRefresh ? { forceRefresh: true } : {};
        let anySuccess = false;
        let allFromCache = true;

        const p1 = api.get('/api/dashboard/adm', opts).then((res) => {
            if (res.data?.status === 'success') {
                anySuccess = true;
                if (!res.fromCache) allFromCache = false;
                const d = res.data.data || res.data;
                setAdmData({
                    ...d,
                    kadar_nh3: res.data.kadar_nh3 ?? d.kadar_nh3 ?? null,
                    status_nh3: res.data.status_nh3 ?? d.status_nh3 ?? null,
                });
                setLoading(false);
            }
        });

        const p2 = api.get('/api/dashboard/kontrol', opts).then((res) => {
            if (res.data?.status === 'success') {
                anySuccess = true;
                if (!res.fromCache) allFromCache = false;
                const d = res.data.data || res.data;
                setKontrolData({
                    ...d,
                    kadar_nh3: res.data.kadar_nh3 ?? d.kadar_nh3 ?? null,
                    status_nh3: res.data.status_nh3 ?? d.status_nh3 ?? null,
                });
                setLoading(false);
            }
        });

        const p3 = api.get('/api/feeding-log', opts).then((res) => {
            if (res.data?.status === 'success') {
                anySuccess = true;
                if (!res.fromCache) allFromCache = false;
                setFeedingLogs(Array.isArray(res.data.data) ? res.data.data : []);
                setLoading(false);
            }
        });

        const p4 = api.get('/api/sampling', opts).then((res) => {
            if (res.data?.status === 'success') {
                anySuccess = true;
                if (!res.fromCache) allFromCache = false;
                setSamplingList(Array.isArray(res.data.data) ? res.data.data : []);
                setLoading(false);
            }
        });

        const results = await Promise.allSettled([p1, p2, p3, p4]);
        const allRejected = results.every((r) => r.status === 'rejected');
        if (allRejected && !anySuccess) {
            setApiError('Tidak dapat terhubung ke server telemetri. Pastikan backend FastAPI aktif.');
        }
        setIsFromCache(allFromCache);
        setLoading(false);
        setRefreshing(false);
    }, []);

    useEffect(() => {
        const initTimer = setTimeout(() => {
            setIsLoggedIn(isAuthenticated());
            fetchData(false);
            if (location.state?.openLoginModal && !isAuthenticated()) {
                setLoginError('Silakan masukkan kredensial administrator untuk mengakses ruang kerja.');
                setLoginModalOpen(true);
            }
        }, 0);

        const interval = setInterval(() => {
            fetchData(false);
        }, 30000);

        return () => {
            clearTimeout(initTimer);
            clearInterval(interval);
        };
    }, [location.state, fetchData]);

    const handleOpenLoginModal = () => {
        setLoginError(null);
        form.resetFields();
        setLoginModalOpen(true);
    };

    const handleLoginSubmit = async (values) => {
        setLoginLoading(true);
        setLoginError(null);
        try {
            const res = await loginAdmin(values.username, values.password);
            if (res.success) {
                setIsLoggedIn(true);
                setLoginModalOpen(false);
                form.resetFields();
                const destination = location.state?.from || '/dashboard';
                navigate(destination, { replace: true });
            } else {
                setLoginError(res.message || 'Username atau password tidak sesuai.');
            }
        } catch {
            setLoginError('Terjadi kendala koneksi saat menghubungi server autentikasi.');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        confirmAction({
            title: 'Keluar dari Sesi Administrator?',
            content: 'Sesi aktif Anda akan dihapus dari perangkat ini.',
            okText: 'Logout',
            danger: true,
            onConfirm: () => {
                logoutAdmin();
                setIsLoggedIn(false);
            },
        });
    };

    // --- KALKULASI DATA RIIL (TANPA ESTIMASI PALSU) ---

    // 1. Akumulasi Pakan Riil dari Feeding Logs & Sampling
    const feedStats = useMemo(() => {
        let totalAdm = 0;
        let totalKontrol = 0;

        feedingLogs.forEach((log) => {
            if (log?.status === 'Berhasil') {
                const pondStr = String(log.pondType || log.pond_type || '');
                const isKontrol = !/adm|perlakuan/i.test(pondStr) && /kontrol|timer|kolam\s*a/i.test(pondStr);
                const gram = Number(log.jumlahPakan ?? log.jumlah_pakan) || 0;
                if (isKontrol) totalKontrol += gram;
                else totalAdm += gram;
            }
        });

        // Jika feedingLogs belum memuat salah satu kolam, gunakan data terverifikasi dari sampling_fcr
        if (totalAdm === 0 || totalKontrol === 0) {
            let sampAdm = 0;
            let sampKontrol = 0;
            samplingList.forEach((item) => {
                const isAdm = /adm|perlakuan/i.test(item.kolam);
                const pakan = Number(item.jumlah_pakan) || 0;
                if (isAdm) sampAdm = Math.max(sampAdm, pakan);
                else sampKontrol = Math.max(sampKontrol, pakan);
            });
            if (totalAdm === 0) totalAdm = sampAdm;
            if (totalKontrol === 0) totalKontrol = sampKontrol;
        }

        const hasBoth = totalAdm > 0 && totalKontrol > 0;
        const selisih = hasBoth ? totalKontrol - totalAdm : null;
        const persentaseHemat = hasBoth && totalKontrol > 0 ? (selisih / totalKontrol) * 100 : null;

        return {
            totalAdm: Number(totalAdm.toFixed(1)),
            totalKontrol: Number(totalKontrol.toFixed(1)),
            selisih: selisih !== null ? Number(selisih.toFixed(1)) : null,
            persentaseHemat: persentaseHemat !== null ? Number(persentaseHemat.toFixed(1)) : null,
            hasBoth,
        };
    }, [samplingList, feedingLogs]);

    // 2. Perbandingan FCR Riil dari Database Sampling
    const fcrStats = useMemo(() => {
        if (!samplingList || samplingList.length === 0) {
            return {
                fcrAdm: null,
                fcrKontrol: null,
                persentaseEfisiensi: null,
                mingguTerakhir: null,
            };
        }

        const admSamples = samplingList.filter((s) => /adm|perlakuan/i.test(s.kolam));
        const kontrolSamples = samplingList.filter((s) => !/adm|perlakuan/i.test(s.kolam));

        const latestAdm = admSamples.length > 0 ? admSamples[admSamples.length - 1] : null;
        const latestKontrol = kontrolSamples.length > 0 ? kontrolSamples[kontrolSamples.length - 1] : null;

        const fcrAdm = latestAdm?.fcr !== undefined && latestAdm?.fcr !== null ? Number(latestAdm.fcr) : null;
        const fcrKontrol = latestKontrol?.fcr !== undefined && latestKontrol?.fcr !== null ? Number(latestKontrol.fcr) : null;

        const persentaseEfisiensi =
            fcrAdm !== null && fcrKontrol !== null && fcrKontrol > 0
                ? Number((((fcrKontrol - fcrAdm) / fcrKontrol) * 100).toFixed(1))
                : null;
        const maxWeek = Math.max(...samplingList.map((s) => Number(s.minggu_ke) || 1));

        return {
            fcrAdm,
            fcrKontrol,
            persentaseEfisiensi,
            mingguTerakhir: maxWeek,
        };
    }, [samplingList]);

    // 3. Tabel Perbandingan Sampling Mingguan
    const samplingTableData = useMemo(() => {
        const weeks = {};
        samplingList.forEach((item) => {
            const w = item.minggu_ke;
            if (!weeks[w]) weeks[w] = { key: w, week: `Minggu ${w}` };
            const isAdm = /adm|perlakuan/i.test(item.kolam);
            if (isAdm) {
                weeks[w].admFeed = item.jumlah_pakan;
                weeks[w].admBio = item.berat_akhir;
                weeks[w].admFcr = item.fcr;
            } else {
                weeks[w].ctrlFeed = item.jumlah_pakan;
                weeks[w].ctrlBio = item.berat_akhir;
                weeks[w].ctrlFcr = item.fcr;
            }
        });
        return Object.values(weeks).sort((a, b) => parseInt(a.key) - parseInt(b.key));
    }, [samplingList]);

    const samplingColumns = [
        {
            title: 'Periode',
            dataIndex: 'week',
            key: 'week',
            fixed: 'left',
            width: 110,
            render: (text) => <Text strong>{text}</Text>,
        },
        {
            title: 'Kolam B — Perlakuan (ADM)',
            children: [
                {
                    title: 'Pakan (g)',
                    dataIndex: 'admFeed',
                    key: 'admFeed',
                    align: 'right',
                    render: (v) => (v !== undefined && v !== null ? `${formatNum(v, 1)} g` : '—'),
                },
                {
                    title: 'Biomassa (g)',
                    dataIndex: 'admBio',
                    key: 'admBio',
                    align: 'right',
                    render: (v) => (v !== undefined && v !== null ? `${formatNum(v, 1)} g` : '—'),
                },
                {
                    title: 'FCR',
                    dataIndex: 'admFcr',
                    key: 'admFcr',
                    align: 'center',
                    render: (v) =>
                        v !== undefined && v !== null ? (
                            <Text strong style={{ color: 'var(--color-adm)' }}>{formatNum(v, 2)}</Text>
                        ) : (
                            '—'
                        ),
                },
            ],
        },
        {
            title: 'Kolam A — Kontrol (Timer)',
            children: [
                {
                    title: 'Pakan (g)',
                    dataIndex: 'ctrlFeed',
                    key: 'ctrlFeed',
                    align: 'right',
                    render: (v) => (v !== undefined && v !== null ? `${formatNum(v, 1)} g` : '—'),
                },
                {
                    title: 'Biomassa (g)',
                    dataIndex: 'ctrlBio',
                    key: 'ctrlBio',
                    align: 'right',
                    render: (v) => (v !== undefined && v !== null ? `${formatNum(v, 1)} g` : '—'),
                },
                {
                    title: 'FCR',
                    dataIndex: 'ctrlFcr',
                    key: 'ctrlFcr',
                    align: 'center',
                    render: (v) =>
                        v !== undefined && v !== null ? (
                            <Text strong style={{ color: 'var(--text-secondary)' }}>{formatNum(v, 2)}</Text>
                        ) : (
                            '—'
                        ),
                },
            ],
        },
    ];

    const latestTelemetryTimestamp = admData?.timestamp || kontrolData?.timestamp || null;

    return (
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>

            {/* ENTERPRISE TOP NAVIGATION BAR */}
            <header
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    backgroundColor: 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border-subtle)',
                    padding: '0 20px',
                }}
            >
                <div
                    style={{
                        maxWidth: 1280,
                        margin: '0 auto',
                        minHeight: 64,
                        padding: '8px 0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                    }}
                >
                    {/* Brand Identity */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                background: 'linear-gradient(135deg, #4649e5 0%, #3032a3 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <CompassOutlined style={{ fontSize: 18, color: '#ffffff' }} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <Text strong style={{ fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                                    SMART FEEDER AQUACULTURE
                                </Text>
                                <span className="sf-status-pill sf-status-pill--neutral" style={{ fontSize: 11, padding: '2px 8px' }}>
                                    RESEARCH BI
                                </span>
                            </div>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                                Automated Decision Making (Fuzzy Sugeno) vs Conventional Timer Control
                            </Text>
                        </div>
                    </div>

                    {/* Status & Admin Action */}
                    <Space size="small" wrap>
                        <DataFreshnessBadge
                            timestamp={latestTelemetryTimestamp}
                            isFromCache={isFromCache}
                            hasNetworkError={Boolean(apiError)}
                        />
                        <NotificationBell />

                        {isLoggedIn ? (
                            <Space size="small">
                                <Button
                                    type="primary"
                                    icon={<DashboardOutlined />}
                                    onClick={() => navigate('/dashboard')}
                                >
                                    Panel Admin
                                </Button>
                                <Button onClick={handleLogout}>
                                    Logout
                                </Button>
                            </Space>
                        ) : (
                            <Button
                                type="primary"
                                icon={<LockOutlined />}
                                onClick={handleOpenLoginModal}
                            >
                                Login Admin
                            </Button>
                        )}
                    </Space>
                </div>
            </header>

            {/* MAIN CONTENT CONTAINER */}
            <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 20px 64px' }}>
                <OfflineBanner apiOffline={Boolean(apiError)} onRetry={() => fetchData(true)} />
                {apiError && (
                    <ErrorState
                        title="Gangguan Sinkronisasi Server Telemetri"
                        description={apiError}
                        onRetry={() => fetchData(true)}
                    />
                )}
                <StaleDataBanner
                    timestamp={latestTelemetryTimestamp}
                    isFromCache={isFromCache}
                    hasNetworkError={Boolean(apiError)}
                    onRefresh={() => fetchData(true)}
                />

                {/* EXECUTIVE SUMMARY HEADER & KPI METRICS */}
                <section style={{ marginBottom: 40 }}>
                    <div className="sf-page-header" style={{ marginBottom: 24 }}>
                        <div style={{ maxWidth: 780 }}>
                            <span className="sf-section-label">RINGKASAN EKSEKUTIF PENELITIAN</span>
                            <Title level={2} style={{ margin: '0 0 8px 0', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
                                Evaluasi Kinerja Sistem Pakan Cerdas (ADM) vs Kontrol Konvensional
                            </Title>
                            <Text type="secondary" style={{ fontSize: 14 }}>
                                Pemantauan terbuka parameter kualitas air, adaptasi takaran pakan berbasis logika Fuzzy Sugeno, serta perbandingan efisiensi konversi pakan (FCR) antara <b>Kolam B — Perlakuan (ADM)</b> dan <b>Kolam A — Kontrol (Timer)</b>.
                            </Text>
                        </div>
                        <Button
                            icon={<SyncOutlined spin={refreshing} />}
                            onClick={() => fetchData(true)}
                        >
                            Perbarui Data
                        </Button>
                    </div>

                    {loading ? (
                        <LoadingState rows={3} />
                    ) : (
                        <Row gutter={[16, 16]}>
                            {/* KPI 1: Efisiensi FCR */}
                            <Col xs={24} sm={12} lg={6}>
                                <div className="sf-metric-card">
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                            <span className="sf-metric-label">FCR Terkini (Kolam B ADM)</span>
                                            <TrophyOutlined style={{ color: 'var(--status-success)', fontSize: 16 }} />
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                            <span className="sf-metric-value" style={{ color: 'var(--color-adm)' }}>
                                                {fcrStats.fcrAdm !== null ? formatNum(fcrStats.fcrAdm, 2) : '—'}
                                            </span>
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                vs Kolam A: {fcrStats.fcrKontrol !== null ? formatNum(fcrStats.fcrKontrol, 2) : '—'}
                                            </Text>
                                        </div>
                                    </div>
                                    <div style={{ marginTop: 12 }}>
                                        {fcrStats.persentaseEfisiensi !== null ? (
                                            <Tag color={fcrStats.persentaseEfisiensi >= 0 ? 'success' : 'warning'} style={{ margin: 0 }}>
                                                {fcrStats.persentaseEfisiensi >= 0 ? `+${fcrStats.persentaseEfisiensi}% Lebih Efisien` : `${fcrStats.persentaseEfisiensi}%`}
                                            </Tag>
                                        ) : (
                                            <Text type="secondary" style={{ fontSize: 12 }}>Menunggu data sampling</Text>
                                        )}
                                    </div>
                                </div>
                            </Col>

                            {/* KPI 2: Total Pakan */}
                            <Col xs={24} sm={12} lg={6}>
                                <div className="sf-metric-card">
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                            <span className="sf-metric-label">Total Pakan Kolam B (ADM)</span>
                                            <ExperimentOutlined style={{ color: 'var(--color-adm)', fontSize: 16 }} />
                                        </div>
                                        <div>
                                            <span className="sf-metric-value">
                                                {feedStats.totalAdm > 0 ? formatNum(feedStats.totalAdm, 1) : '—'}
                                            </span>
                                            {feedStats.totalAdm > 0 && <span className="sf-metric-unit">gram</span>}
                                        </div>
                                    </div>
                                    <div style={{ marginTop: 12 }}>
                                        {feedStats.hasBoth ? (
                                            <Tag color={feedStats.selisih >= 0 ? 'blue' : 'orange'} style={{ margin: 0 }}>
                                                {feedStats.selisih >= 0
                                                    ? `Hemat ${formatNum(feedStats.selisih, 1)} g (${feedStats.persentaseHemat}%)`
                                                    : `Selisih +${formatNum(Math.abs(feedStats.selisih), 1)} g`}
                                            </Tag>
                                        ) : (
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                Kolam A: {feedStats.totalKontrol > 0 ? `${formatNum(feedStats.totalKontrol, 1)} g` : 'Belum diinput'}
                                            </Text>
                                        )}
                                    </div>
                                </div>
                            </Col>

                            {/* KPI 3: Rekomendasi Pakan Fuzzy */}
                            <Col xs={24} sm={12} lg={6}>
                                <div className="sf-metric-card">
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                            <span className="sf-metric-label">Keputusan Pakan ADM</span>
                                            <ThunderboltOutlined style={{ color: 'var(--status-warning)', fontSize: 16 }} />
                                        </div>
                                        <div>
                                            <span className="sf-metric-value">
                                                {admData?.pakan_gram !== undefined && admData?.pakan_gram !== null
                                                    ? formatNum(admData.pakan_gram, 1)
                                                    : '—'}
                                            </span>
                                            {admData?.pakan_gram !== undefined && admData?.pakan_gram !== null && (
                                                <span className="sf-metric-unit">g / sesi</span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ marginTop: 12 }}>
                                        <Tag color="default" style={{ margin: 0 }}>
                                            Rule Fuzzy: {admData?.rule_aktif || '—'}
                                        </Tag>
                                    </div>
                                </div>
                            </Col>

                            {/* KPI 4: Toksisitas Amonia */}
                            <Col xs={24} sm={12} lg={6}>
                                <div className="sf-metric-card">
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                            <span className="sf-metric-label">Fraksi Amonia (NH₃) ADM</span>
                                            <WarningOutlined style={{ color: 'var(--text-muted)', fontSize: 16 }} />
                                        </div>
                                        <div>
                                            <span className="sf-metric-value">
                                                {admData?.kadar_nh3 ? String(admData.kadar_nh3) : '—'}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ marginTop: 12 }}>
                                        {admData?.status_nh3 ? (
                                            <Tag
                                                color={
                                                    admData.status_nh3.includes('Aman') || admData.status_nh3.includes('Rendah')
                                                        ? 'success'
                                                        : admData.status_nh3.includes('Waspada')
                                                          ? 'warning'
                                                          : 'error'
                                                }
                                                style={{ margin: 0 }}
                                            >
                                                {admData.status_nh3}
                                            </Tag>
                                        ) : (
                                            <Text type="secondary" style={{ fontSize: 12 }}>Menunggu pembacaan sensor</Text>
                                        )}
                                    </div>
                                </div>
                            </Col>
                        </Row>
                    )}
                </section>

                {/* BAGIAN 1: PERBANDINGAN KUALITAS AIR SAAT INI */}
                <section style={{ marginBottom: 40 }}>
                    <div style={{ marginBottom: 16 }}>
                        <span className="sf-section-label">BAGIAN 1 • TELEMETRI LINGKUNGAN</span>
                        <Title level={4} style={{ margin: '0 0 4px 0' }}>
                            Perbandingan Kualitas Air Kedua Kolam
                        </Title>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                            Pembacaan parameter fisika-kimia air terakhir dari sensor masing-masing kolam.
                        </Text>
                    </div>

                    <Row gutter={[20, 20]}>
                        {/* KOLAM B — PERLAKUAN (ADM) */}
                        <Col xs={24} lg={12}>
                            <Card
                                title={
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                        <div>
                                            <Text strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                                                Kolam B — Perlakuan (ADM)
                                            </Text>
                                            <Text type="secondary" style={{ fontSize: 12, display: 'block', fontWeight: 400 }}>
                                                Pemberian Pakan Adaptif Berbasis Logika Fuzzy Sugeno
                                            </Text>
                                        </div>
                                        <Tag color="blue" style={{ margin: 0 }}>Sistem Adaptif</Tag>
                                    </div>
                                }
                            >
                                <Row gutter={[12, 12]}>
                                    {[
                                        { label: 'Suhu Air', val: admData?.suhu, unit: '°C', status: admData?.lbl_suhu, dec: 1 },
                                        { label: 'pH Air', val: admData?.ph, unit: '', status: admData?.lbl_ph, dec: 2 },
                                        { label: 'Dissolved Oxygen (DO)', val: admData?.do, unit: 'mg/L', status: admData?.lbl_do, dec: 2 },
                                        { label: 'Total Padatan Terlarut (TDS)', val: admData?.tds, unit: 'ppm', status: admData?.lbl_tds, dec: 0 },
                                    ].map((item) => (
                                        <Col xs={12} key={item.label}>
                                            <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                                                <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
                                                <div className="sf-metric-value" style={{ fontSize: 20, margin: '4px 0' }}>
                                                    {formatNum(item.val, item.dec)}{item.val !== undefined && item.val !== null && item.unit ? ` ${item.unit}` : ''}
                                                </div>
                                                <Badge
                                                    status={item.status === 'Normal' ? 'success' : item.status ? 'warning' : 'default'}
                                                    text={<Text style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status: {item.status || '—'}</Text>}
                                                />
                                            </div>
                                        </Col>
                                    ))}
                                </Row>

                                <div
                                    style={{
                                        marginTop: 16,
                                        padding: '12px 16px',
                                        borderRadius: 8,
                                        background: 'var(--color-adm-bg)',
                                        border: '1px solid var(--color-adm-border)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 8,
                                    }}
                                >
                                    <div>
                                        <Text style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>
                                            Rekomendasi Porsi Pakan Cerdas:
                                        </Text>
                                        <Text strong style={{ fontSize: 15, color: 'var(--color-adm)' }}>
                                            {admData?.pakan_gram !== undefined && admData?.pakan_gram !== null
                                                ? `${formatNum(admData.pakan_gram, 1)} gram / pemberian`
                                                : 'Menunggu kalkulasi sensor'}
                                        </Text>
                                    </div>
                                    <Tag color="blue" style={{ margin: 0 }}>
                                        Rule: {admData?.rule_aktif || '—'}
                                    </Tag>
                                </div>
                            </Card>
                        </Col>

                        {/* KOLAM A — KONTROL (TIMER STATIS) */}
                        <Col xs={24} lg={12}>
                            <Card
                                title={
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                        <div>
                                            <Text strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                                                Kolam A — Kontrol (Timer Statis)
                                            </Text>
                                            <Text type="secondary" style={{ fontSize: 12, display: 'block', fontWeight: 400 }}>
                                                Pemberian Pakan Konvensional Terjadwal Tanpa Adaptasi Sensor
                                            </Text>
                                        </div>
                                        <Tag color="default" style={{ margin: 0 }}>Timer Statis</Tag>
                                    </div>
                                }
                            >
                                <Row gutter={[12, 12]}>
                                    {[
                                        { label: 'Suhu Air', val: kontrolData?.suhu, unit: '°C', status: kontrolData?.lbl_suhu, dec: 1 },
                                        { label: 'pH Air', val: kontrolData?.ph, unit: '', status: kontrolData?.lbl_ph, dec: 2 },
                                        { label: 'Dissolved Oxygen (DO)', val: kontrolData?.do, unit: 'mg/L', status: kontrolData?.lbl_do, dec: 2 },
                                        { label: 'Total Padatan Terlarut (TDS)', val: kontrolData?.tds, unit: 'ppm', status: kontrolData?.lbl_tds, dec: 0 },
                                    ].map((item) => (
                                        <Col xs={12} key={item.label}>
                                            <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                                                <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
                                                <div className="sf-metric-value" style={{ fontSize: 20, margin: '4px 0' }}>
                                                    {formatNum(item.val, item.dec)}{item.val !== undefined && item.val !== null && item.unit ? ` ${item.unit}` : ''}
                                                </div>
                                                <Badge
                                                    status={item.status === 'Normal' ? 'success' : item.val !== undefined && item.val !== null ? 'processing' : 'default'}
                                                    text={<Text style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status: {item.status || (item.val !== undefined && item.val !== null ? 'Tercatat' : '—')}</Text>}
                                                />
                                            </div>
                                        </Col>
                                    ))}
                                </Row>

                                <div
                                    style={{
                                        marginTop: 16,
                                        padding: '12px 16px',
                                        borderRadius: 8,
                                        background: 'var(--bg-subtle)',
                                        border: '1px solid var(--border-subtle)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 8,
                                    }}
                                >
                                    <div>
                                        <Text style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>
                                            Metode Pemberian Pakan:
                                        </Text>
                                        <Text strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>
                                            Porsi Tetap Harian (Non-Adaptif)
                                        </Text>
                                    </div>
                                    <Tag color="default" style={{ margin: 0 }}>Konvensional</Tag>
                                </div>
                            </Card>
                        </Col>
                    </Row>
                </section>

                {/* BAGIAN 2: AKUMULASI PAKAN & EFISIENSI */}
                <section style={{ marginBottom: 40 }}>
                    <div style={{ marginBottom: 16 }}>
                        <span className="sf-section-label">BAGIAN 2 • ANALISIS KONSUMSI PAKAN</span>
                        <Title level={4} style={{ margin: '0 0 4px 0' }}>
                            Perbandingan Akumulasi Pakan Aktual
                        </Title>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                            Total pakan yang tercatat pada database penelitian untuk kedua kolam pemeliharaan.
                        </Text>
                    </div>

                    <Card>
                        {feedStats.totalAdm === 0 && feedStats.totalKontrol === 0 ? (
                            <EmptyState
                                title="Belum Ada Data Konsumsi Pakan"
                                description="Data akumulasi pakan akan muncul setelah sistem mencatat riwayat pemberian pakan."
                            />
                        ) : (
                            <Row gutter={[32, 24]} align="middle">
                                <Col xs={24} md={15}>
                                    <div style={{ marginBottom: 16 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                            <Text strong style={{ color: 'var(--color-adm)' }}>Kolam B — Perlakuan (ADM)</Text>
                                            <Text strong className="sf-mono">{formatNum(feedStats.totalAdm, 1)} g</Text>
                                        </div>
                                        <Progress
                                            percent={
                                                feedStats.totalKontrol > 0
                                                    ? Math.min(100, Math.round((feedStats.totalAdm / Math.max(feedStats.totalAdm, feedStats.totalKontrol)) * 100))
                                                    : 100
                                            }
                                            strokeColor="#4649e5"
                                            showInfo={false}
                                        />
                                    </div>

                                    <div style={{ marginBottom: 20 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                            <Text strong style={{ color: 'var(--text-secondary)' }}>Kolam A — Kontrol (Timer)</Text>
                                            <Text strong className="sf-mono">{formatNum(feedStats.totalKontrol, 1)} g</Text>
                                        </div>
                                        <Progress
                                            percent={
                                                feedStats.totalKontrol > 0
                                                    ? Math.min(100, Math.round((feedStats.totalKontrol / Math.max(feedStats.totalAdm, feedStats.totalKontrol)) * 100))
                                                    : 0
                                            }
                                            strokeColor="#8184f8"
                                            showInfo={false}
                                        />
                                    </div>

                                    {feedStats.hasBoth && (
                                        <Alert
                                            type={feedStats.selisih >= 0 ? 'success' : 'info'}
                                            showIcon
                                            icon={<CheckCircleOutlined />}
                                            message={
                                                feedStats.selisih >= 0
                                                    ? `Penghematan Pakan Aktual: ${feedStats.persentaseHemat}% (${formatNum(feedStats.selisih, 1)} gram)`
                                                    : `Selisih Konsumsi Pakan: ${formatNum(Math.abs(feedStats.selisih), 1)} gram`
                                            }
                                            description="Penyesuaian takaran pakan mengikuti kondisi DO, suhu, dan pH mencegah penumpukan sisa pakan tidak termakan di dasar kolam."
                                        />
                                    )}
                                </Col>

                                <Col xs={24} md={9}>
                                    <div
                                        style={{
                                            padding: 20,
                                            borderRadius: 8,
                                            background: 'var(--bg-subtle)',
                                            border: '1px solid var(--border-subtle)',
                                            textAlign: 'center',
                                        }}
                                    >
                                        <span className="sf-metric-label">Selisih Efisiensi Pakan</span>
                                        <div className="sf-metric-value" style={{ fontSize: 36, color: 'var(--status-success)', margin: '8px 0 4px' }}>
                                            {feedStats.persentaseHemat !== null ? `${feedStats.persentaseHemat}%` : '—'}
                                        </div>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            Perbandingan konsumsi pakan aktual
                                        </Text>
                                        <Divider style={{ margin: '14px 0' }} />
                                        <Row gutter={12}>
                                            <Col span={12}>
                                                <Statistic
                                                    title="Kolam B (ADM)"
                                                    value={formatNum(feedStats.totalAdm, 1)}
                                                    suffix="g"
                                                    valueStyle={{ fontSize: 15, fontWeight: 700, color: 'var(--color-adm)' }}
                                                />
                                            </Col>
                                            <Col span={12}>
                                                <Statistic
                                                    title="Kolam A (Kontrol)"
                                                    value={formatNum(feedStats.totalKontrol, 1)}
                                                    suffix="g"
                                                    valueStyle={{ fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}
                                                />
                                            </Col>
                                        </Row>
                                    </div>
                                </Col>
                            </Row>
                        )}
                    </Card>
                </section>

                {/* BAGIAN 3: EVALUASI FEED CONVERSION RATIO (FCR) */}
                <section style={{ marginBottom: 40 }}>
                    <div style={{ marginBottom: 16 }}>
                        <span className="sf-section-label">BAGIAN 3 • METRIK BIOLOGIS</span>
                        <Title level={4} style={{ margin: '0 0 4px 0' }}>
                            Evaluasi Feed Conversion Ratio (FCR) Mingguan
                        </Title>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                            Rasio jumlah pakan (gram) yang dibutuhkan untuk menghasilkan pertambahan 1 gram biomassa ikan. Semakin rendah FCR, semakin efisien penyerapan pakan.
                        </Text>
                    </div>

                    <Card>
                        {samplingTableData.length === 0 ? (
                            <EmptyState
                                title="Belum Ada Data Sampling FCR"
                                description="Data tabel komparasi FCR akan tampil setelah peneliti menginput hasil penimbangan mingguan."
                            />
                        ) : (
                            <Table
                                columns={samplingColumns}
                                dataSource={samplingTableData}
                                pagination={false}
                                size="small"
                                bordered
                                scroll={{ x: 640 }}
                            />
                        )}
                    </Card>
                </section>

                {/* BAGIAN 4: RINGKASAN METODOLOGI ILMIAH */}
                <section>
                    <div style={{ marginBottom: 16 }}>
                        <span className="sf-section-label">BAGIAN 4 • METODOLOGI SISTEM</span>
                        <Title level={4} style={{ margin: '0 0 4px 0' }}>
                            Prinsip Kerja Sistem Smart Feeder ADM
                        </Title>
                    </div>

                    <Row gutter={[16, 16]}>
                        {[
                            {
                                icon: <ThunderboltOutlined style={{ color: 'var(--color-adm)' }} />,
                                title: 'Inferensi Fuzzy Sugeno',
                                desc: 'Menentukan takaran pakan secara otomatis berdasarkan kombinasi oksigen terlarut (DO), suhu, pH, dan TDS air kolam.',
                            },
                            {
                                icon: <WarningOutlined style={{ color: 'var(--status-warning)' }} />,
                                title: 'Mitigasi Racun Amonia (NH₃)',
                                desc: 'Menghitung persentase amonia tak terionisasi dengan persamaan Emerson untuk mencegah pemberian pakan berlebih saat pH dan suhu tinggi.',
                            },
                            {
                                icon: <RiseOutlined style={{ color: 'var(--status-success)' }} />,
                                title: 'Optimasi FCR Budidaya',
                                desc: 'Menekan rasio konversi pakan (FCR) dengan mengurangi pelet yang terbuang akibat penurunan nafsu makan ikan.',
                            },
                            {
                                icon: <DatabaseOutlined style={{ color: 'var(--text-secondary)' }} />,
                                title: 'Audit Trail Terverifikasi',
                                desc: 'Setiap eksekusi pakan dan hasil sampling mingguan tercatat secara transparan di Cloud Firestore dengan penanda waktu WITA.',
                            },
                        ].map((card) => (
                            <Col xs={24} sm={12} lg={6} key={card.title}>
                                <div className="sf-metric-card" style={{ justifyContent: 'flex-start', gap: 10 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div
                                            style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 6,
                                                background: 'var(--bg-subtle)',
                                                border: '1px solid var(--border-subtle)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            {card.icon}
                                        </div>
                                        <Text strong style={{ fontSize: 13 }}>{card.title}</Text>
                                    </div>
                                    <Paragraph style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                                        {card.desc}
                                    </Paragraph>
                                </div>
                            </Col>
                        ))}
                    </Row>
                </section>
            </main>

            {/* MINIMALIST ENTERPRISE FOOTER */}
            <footer
                style={{
                    background: 'var(--bg-surface)',
                    borderTop: '1px solid var(--border-subtle)',
                    padding: '24px 20px',
                }}
            >
                <div
                    style={{
                        maxWidth: 1280,
                        margin: '0 auto',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                    }}
                >
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        © 2026 Smart Feeder Aquaculture • Automated Decision Making (ADM) Research Platform
                    </Text>
                    <Space size="middle">
                        <Button
                            type="link"
                            size="small"
                            style={{ padding: 0, fontSize: 12 }}
                            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                        >
                            Kembali ke Atas
                        </Button>
                        {isLoggedIn ? (
                            <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => navigate('/dashboard')}>
                                Buka Panel Admin
                            </Button>
                        ) : (
                            <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={handleOpenLoginModal}>
                                Login Administrator
                            </Button>
                        )}
                    </Space>
                </div>
            </footer>

            {/* MODAL LOGIN ADMIN */}
            <Modal
                title={
                    <Space align="center" size="small">
                        <LockOutlined style={{ color: 'var(--color-adm)' }} />
                        <span>Autentikasi Administrator</span>
                    </Space>
                }
                open={loginModalOpen}
                onCancel={() => {
                    setLoginModalOpen(false);
                    setLoginError(null);
                }}
                footer={null}
                destroyOnClose
                centered
                width={420}
            >
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
                    Masukkan kredensial administrator untuk mengakses kontrol servo, kalibrasi sensor, dan input data penelitian.
                </Text>

                {loginError && (
                    <Alert
                        type="error"
                        showIcon
                        message={loginError}
                        style={{ marginBottom: 16 }}
                    />
                )}

                <Form form={form} layout="vertical" onFinish={handleLoginSubmit} autoComplete="off">
                    <Form.Item
                        name="username"
                        label="Username"
                        rules={[{ required: true, message: 'Masukkan username admin' }]}
                    >
                        <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
                    </Form.Item>

                    <Form.Item
                        name="password"
                        label="Password"
                        rules={[{ required: true, message: 'Masukkan password admin' }]}
                    >
                        <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
                    </Form.Item>

                    <Form.Item style={{ marginBottom: 0, marginTop: 20 }}>
                        <Button type="primary" htmlType="submit" block loading={loginLoading} size="large">
                            Masuk ke Panel Admin
                        </Button>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default LandingPage;

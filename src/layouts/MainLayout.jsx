import { useState } from 'react';
import { Layout, Menu, Typography, Space, Button, Drawer, Grid, message, Tooltip } from 'antd';
import {
    AppstoreOutlined,
    UnorderedListOutlined,
    LineChartOutlined,
    SettingOutlined,
    LogoutOutlined,
    GlobalOutlined,
    MenuOutlined,
    CompassOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { isAuthenticated, logoutAdmin } from '../api';
import { OfflineBanner, NotificationBell, confirmAction } from '../components/SystemStates';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

const SIDER_EXPANDED_WIDTH = 240;
const SIDER_COLLAPSED_WIDTH = 72;
const HEADER_HEIGHT = 64;

const PAGE_TITLES = {
    '/dashboard': { title: 'Operational Telemetry & Control', subtitle: 'Pemantauan kualitas air real-time dan kendali aktuator kolam' },
    '/feeding-log': { title: 'Feeding Audit Trail', subtitle: 'Rekam jejak keputusan pemberian pakan dan ekspor laporan penelitian' },
    '/analysis': { title: 'Scientific & BI Evaluation', subtitle: 'Analisis komparatif Kolam B (ADM) vs Kolam A (Kontrol) dan evaluasi FCR' },
    '/settings': { title: 'Sensor Calibration & Schedule', subtitle: 'Konfigurasi parameter kalibrasi sensor dan jadwal pakan otomatis' },
};

const MainLayout = () => {
    const screens = useBreakpoint();
    const isDesktop = screens.lg ?? (typeof window !== 'undefined' ? window.innerWidth >= 992 : true);

    const [collapsed, setCollapsed] = useState(false);
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

    const navigate = useNavigate();
    const location = useLocation();
    const isLoggedIn = isAuthenticated();

    const siderWidth = isDesktop ? (collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_EXPANDED_WIDTH) : 0;

    const menuItems = [
        { key: '/dashboard', icon: <AppstoreOutlined />, label: 'Dashboard' },
        { key: '/feeding-log', icon: <UnorderedListOutlined />, label: 'Feeding Log' },
        { key: '/analysis', icon: <LineChartOutlined />, label: 'Analysis & FCR' },
        { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
        { type: 'divider' },
        { key: '/', icon: <GlobalOutlined />, label: 'Ringkasan Publik' },
    ];

    const handleMenuClick = ({ key }) => {
        setMobileDrawerOpen(false);
        navigate(key);
    };

    const handleLogout = () => {
        confirmAction({
            title: 'Keluar dari Sesi Administrator?',
            content: 'Anda akan keluar dari panel kendali admin dan kembali ke halaman ringkasan publik.',
            okText: 'Logout',
            danger: true,
            onConfirm: () => {
                logoutAdmin();
                message.success('Sesi administrator telah diakhiri.');
                navigate('/', { replace: true });
            },
        });
    };

    const currentMeta = PAGE_TITLES[location.pathname] || {
        title: 'Smart Feeder Aquaculture',
        subtitle: 'Automated Decision Making (ADM) Research Platform',
    };

    const renderBrandHeader = (isCompact = false) => (
        <div
            style={{
                height: HEADER_HEIGHT,
                padding: isCompact ? '0 12px' : '0 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                borderBottom: '1px solid var(--border-subtle)',
                flexShrink: 0,
            }}
        >
            <div
                style={{
                    width: 34,
                    height: 34,
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
            {!isCompact && (
                <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                    <Text strong style={{ fontSize: 13, color: 'var(--brand-950)', display: 'block', letterSpacing: '-0.01em' }}>
                        SMART FEEDER
                    </Text>
                    <Text style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>
                        Aquaculture BI v2.0
                    </Text>
                </div>
            )}
        </div>
    );

    const renderNavContent = (isCompact = false, hasCollapseTrigger = false) => (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                paddingBottom: hasCollapseTrigger ? 48 : 0,
            }}
        >
            {renderBrandHeader(isCompact)}
            <div style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
                <Menu
                    mode="inline"
                    selectedKeys={[location.pathname]}
                    items={menuItems}
                    onClick={handleMenuClick}
                    style={{ borderInlineEnd: 'none' }}
                />
            </div>
            <div style={{ padding: '12px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                <Button
                    type="text"
                    danger
                    icon={<LogoutOutlined />}
                    onClick={handleLogout}
                    block
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: isCompact ? 'center' : 'flex-start',
                        height: 38,
                    }}
                >
                    {!isCompact && 'Logout Admin'}
                </Button>
            </div>
        </div>
    );

    return (
        <>
            <Layout hasSider={isDesktop} style={{ minHeight: '100vh', background: 'var(--bg-canvas)' }}>
                {/* DESKTOP & LAPTOP FIXED SIDEBAR */}
                {isDesktop && (
                    <Sider
                        collapsible
                        collapsed={collapsed}
                        onCollapse={(val) => setCollapsed(val)}
                        width={SIDER_EXPANDED_WIDTH}
                        collapsedWidth={SIDER_COLLAPSED_WIDTH}
                        theme="light"
                        style={{
                            position: 'fixed',
                            top: 0,
                            bottom: 0,
                            left: 0,
                            height: '100vh',
                            borderRight: '1px solid var(--border-subtle)',
                            background: 'var(--bg-surface)',
                            zIndex: 100,
                            overflow: 'hidden',
                        }}
                    >
                        {renderNavContent(collapsed, true)}
                    </Sider>
                )}

                <Layout
                    style={{
                        background: 'var(--bg-canvas)',
                        minWidth: 0,
                        flex: 1,
                        marginLeft: siderWidth,
                        paddingTop: HEADER_HEIGHT,
                        transition: 'margin-left 0.2s ease',
                    }}
                >
                    {/* TOP FIXED ENTERPRISE HEADER */}
                    <Header
                        style={{
                            position: 'fixed',
                            top: 0,
                            right: 0,
                            left: siderWidth,
                            zIndex: 95,
                            height: HEADER_HEIGHT,
                            background: 'var(--bg-surface)',
                            borderBottom: '1px solid var(--border-subtle)',
                            padding: isDesktop ? '0 24px' : '0 16px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                            transition: 'left 0.2s ease',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                            {!isDesktop && (
                                <Button
                                    type="text"
                                    icon={<MenuOutlined />}
                                    onClick={() => setMobileDrawerOpen(true)}
                                    aria-label="Buka navigasi"
                                />
                            )}
                            <div style={{ minWidth: 0, lineHeight: 1.3 }}>
                                <Text
                                    strong
                                    style={{
                                        fontSize: isDesktop ? 15 : 14,
                                        color: 'var(--brand-950)',
                                        display: 'block',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}
                                >
                                    {currentMeta.title}
                                </Text>
                                {isDesktop && (
                                    <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                                        {currentMeta.subtitle}
                                    </Text>
                                )}
                            </div>
                        </div>

                        <Space size="small" wrap={false}>
                            <Tooltip title="Terhubung ke FastAPI & Cloud Firestore">
                                <span className="sf-status-pill sf-status-pill--live">
                                    <span className="sf-dot sf-dot--live" />
                                    <span>{isDesktop ? 'FastAPI • Firestore' : 'Online'}</span>
                                </span>
                            </Tooltip>
                            <NotificationBell />
                            {isLoggedIn && isDesktop && (
                                <span className="sf-status-pill sf-status-pill--neutral">
                                    Admin
                                </span>
                            )}
                        </Space>
                    </Header>

                    {/* MAIN WORKSPACE CONTENT */}
                    <Content
                        style={{
                            padding: isDesktop ? '24px' : '16px',
                            maxWidth: 1440,
                            width: '100%',
                            margin: '0 auto',
                            minWidth: 0,
                        }}
                    >
                        <OfflineBanner />
                        <Outlet />
                    </Content>
                </Layout>
            </Layout>

            {/* TABLET & SMARTPHONE DRAWER */}
            {!isDesktop && (
                <Drawer
                    placement="left"
                    open={mobileDrawerOpen}
                    onClose={() => setMobileDrawerOpen(false)}
                    width={260}
                    styles={{ body: { padding: 0 }, header: { display: 'none' } }}
                >
                    {renderNavContent(false, false)}
                </Drawer>
            )}
        </>
    );
};

export default MainLayout;

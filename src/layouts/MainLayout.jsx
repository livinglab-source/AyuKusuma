import React, { useState } from 'react';
import { Layout, Menu, Typography, Space, Badge } from 'antd';
import {
    AppstoreOutlined,
    UnorderedListOutlined,
    LineChartOutlined,
    SettingOutlined,
    LogoutOutlined
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

const MainLayout = () => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    const menuItems = [
        { key: '/dashboard', icon: <AppstoreOutlined />, label: 'Dashboard' },
        { key: '/feeding-log', icon: <UnorderedListOutlined />, label: 'Feeding Log' },
        { key: '/analysis', icon: <LineChartOutlined />, label: 'Analisis' },
        { key: '/settings', icon: <SettingOutlined />, label: 'Pengaturan' },
    ];

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider
                collapsible
                collapsed={collapsed}
                onCollapse={(value) => setCollapsed(value)}
                theme="light"
                style={{
                    overflow: 'auto',
                    height: '100vh',
                    position: 'sticky',
                    insetInlineStart: 0,
                    top: 0,
                    bottom: 0,
                }}
            >
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <Title level={4} style={{ color: '#1890ff', margin: 0 }}>
                        {collapsed ? 'SF' : 'SMART FEEDER'}
                    </Title>
                </div>
                <Menu
                    mode="inline"
                    selectedKeys={[location.pathname]}
                    items={menuItems}
                    onClick={({ key }) => navigate(key)}
                />
                <div style={{ position: 'absolute', bottom: 60, width: '100%' }}>
                    <Menu mode="inline" items={[{ key: 'logout', icon: <LogoutOutlined />, label: 'Logout' }]} />
                </div>
            </Sider>

            <Layout className="site-layout">
                <Header style={{ position: 'sticky', top: 0, zIndex: 10, width: '100%', background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.4 }}>
                        <Title level={5} style={{ margin: 0 }}>AQUACULTURE DASHBOARD</Title>
                        <Text type="secondary" style={{ fontSize: '12px' }}>Sistem Automated Decision Making Berbasis Fuzzy Sugeno</Text>
                    </div>
                    <Space size="large">
                        <Text><Badge status="success" text="Sistem Online" /></Text>
                        <Text><Badge status="success" text="Database Online" /></Text>
                    </Space>
                </Header>

                <Content style={{ margin: '24px 16px', padding: 24, minHeight: 280, background: '#f0f2f5' }}>
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
};

export default MainLayout;
import { Component, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Button, Card, Typography } from 'antd';
import MainLayout from './layouts/MainLayout';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import FeedingLog from './pages/FeedingLog';
import Analysis from './pages/Analysis';
import Settings from './pages/Settings';
import { isAuthenticated, prefetchAppData } from './api';
import { ConfirmModalHost } from './components/SystemStates';

// Enterprise Indigo Design Tokens (#eeeeff – #1b1c4b) untuk Ant Design ConfigProvider
const enterpriseTheme = {
  token: {
    colorPrimary: '#4649e5',
    colorPrimaryHover: '#383bca',
    colorPrimaryActive: '#3032a3',
    colorPrimaryBg: '#eeeeff',
    colorPrimaryBgHover: '#e0e1ff',
    colorPrimaryBorder: '#c7c8fe',
    colorPrimaryBorderHover: '#a5a7fc',
    colorInfo: '#4649e5',
    colorSuccess: '#059669',
    colorWarning: '#d97706',
    colorError: '#dc2626',
    colorTextBase: '#1b1c4b',
    colorBgLayout: '#f8f9fe',
    colorBgContainer: '#ffffff',
    colorBorder: '#e4e6f5',
    colorBorderSecondary: '#f3f4fb',
    borderRadius: 8,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    wireframe: false,
  },
  components: {
    Card: {
      headerBg: '#ffffff',
      headerFontSize: 14,
      paddingLG: 20,
    },
    Table: {
      headerBg: '#eeeeff',
      headerColor: '#2e3081',
      rowHoverBg: '#f3f4fb',
      borderColor: '#e4e6f5',
    },
    Menu: {
      itemSelectedBg: '#eeeeff',
      itemSelectedColor: '#4649e5',
      itemHoverBg: '#f3f4fb',
      itemHoverColor: '#383bca',
    },
    Button: {
      controlHeight: 36,
      controlHeightLG: 42,
      fontWeight: 500,
    },
  },
};

// Error Boundary agar jika ada kendala render pada komponen anak tidak pernah menghasilkan layar putih kosong
class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || 'Terjadi kesalahan saat memuat tampilan.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, maxWidth: 640, margin: '40px auto' }}>
          <Card>
            <Typography.Title level={5} style={{ marginTop: 0, color: '#1b1c4b' }}>
              Gagal Memuat Komponen Halaman
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              {this.state.errorMessage}
            </Typography.Paragraph>
            <Button
              type="primary"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
            >
              Muat Ulang Halaman
            </Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

// Route Guard: Melindungi seluruh rute admin panel
const ProtectedRoute = ({ children }) => {
  if (!isAuthenticated()) {
    return <Navigate to="/" state={{ openLoginModal: true }} replace />;
  }
  return children;
};

function App() {
  useEffect(() => {
    prefetchAppData();
  }, []);

  return (
    <ConfigProvider theme={enterpriseTheme}>
      <BrowserRouter>
        <ConfirmModalHost />
        <RouteErrorBoundary>
          <Routes>
            {/* Halaman Ringkasan Penelitian Publik */}
            <Route path="/" element={<LandingPage />} />

            {/* Panel Admin Terintegrasi */}
            <Route
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="feeding-log" element={<FeedingLog />} />
              <Route path="analysis" element={<Analysis />} />
              <Route path="settings" element={<Settings />} />
            </Route>

            {/* Fallback ke Halaman Publik */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RouteErrorBoundary>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;

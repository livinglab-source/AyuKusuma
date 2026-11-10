/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect } from 'react';
import { Alert, Badge, Button, Empty, Modal, Popover, Skeleton, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import {
    BellOutlined,
    CheckOutlined,
    ClockCircleOutlined,
    CloseOutlined,
    DeleteOutlined,
    DisconnectOutlined,
    ExclamationCircleOutlined,
    ReloadOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import { parseUtc, formatDateTimeWita } from '../utils/time';

const { Text } = Typography;

// Ambang waktu (3 menit) sebelum data telemetri ditandai sebagai "Data Tersimpan / Tidak Real-Time"
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
const NOTIF_STORAGE_KEY = 'sf_notification_history_v1';
const MAX_NOTIFICATIONS = 25;

// --- STORE RIWAYAT NOTIFIKASI SISTEM ---
const notificationListeners = new Set();

const loadStoredNotifications = () => {
    try {
        const raw = sessionStorage.getItem(NOTIF_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

let notificationsState = loadStoredNotifications();

const saveAndNotify = (nextList) => {
    notificationsState = nextList.slice(0, MAX_NOTIFICATIONS);
    try {
        sessionStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notificationsState));
    } catch {
        // Abaikan jika sessionStorage penuh
    }
    notificationListeners.forEach((listener) => listener([...notificationsState]));
};

/**
 * Tambahkan atau perbarui item ke dalam Riwayat Notifikasi Lonceng
 */
export const pushSystemNotification = ({
    id,
    type = 'warning',
    title,
    description,
    badgeText,
}) => {
    if (!id || !title) return;
    const nowFormatted = formatDateTimeWita(new Date());
    const existingIdx = notificationsState.findIndex((item) => item.id === id);

    if (existingIdx !== -1) {
        const existing = notificationsState[existingIdx];
        if (existing.description === description && existing.badgeText === badgeText) {
            return;
        }
        const updated = [...notificationsState];
        updated[existingIdx] = {
            ...existing,
            title,
            description,
            badgeText: badgeText || existing.badgeText,
        };
        saveAndNotify(updated);
        return;
    }

    const newEntry = {
        id,
        type,
        title,
        description,
        badgeText: badgeText || null,
        recordedAt: nowFormatted,
        read: false,
    };
    saveAndNotify([newEntry, ...notificationsState]);
};

export const markNotificationRead = (id) => {
    const next = notificationsState.map((n) => (n.id === id ? { ...n, read: true } : n));
    saveAndNotify(next);
};

export const markAllNotificationsRead = () => {
    const next = notificationsState.map((n) => ({ ...n, read: true }));
    saveAndNotify(next);
};

export const clearAllNotifications = () => {
    saveAndNotify([]);
};

/**
 * Komponen Lonceng Riwayat Notifikasi (Notification Bell) untuk Header
 */
export const NotificationBell = () => {
    const [items, setItems] = useState(() => [...notificationsState]);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const handler = (next) => setItems(next);
        notificationListeners.add(handler);
        return () => {
            notificationListeners.delete(handler);
        };
    }, []);

    const unreadCount = items.filter((n) => !n.read).length;

    const getIconStyle = (type) => {
        if (type === 'error') {
            return {
                bg: '#fef2f2',
                border: '#fecaca',
                color: '#dc2626',
                icon: <DisconnectOutlined style={{ color: '#dc2626', fontSize: 15 }} />,
            };
        }
        if (type === 'info') {
            return {
                bg: 'var(--brand-50)',
                border: 'var(--brand-200)',
                color: 'var(--brand-600)',
                icon: <ExclamationCircleOutlined style={{ color: 'var(--brand-600)', fontSize: 15 }} />,
            };
        }
        return {
            bg: '#fffbeb',
            border: '#fde68a',
            color: '#d97706',
            icon: <ClockCircleOutlined style={{ color: '#d97706', fontSize: 15 }} />,
        };
    };

    const popoverContent = (
        <div style={{ width: 370, maxWidth: 'calc(100vw - 40px)' }}>
            {/* Header Riwayat Notifikasi */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: 10,
                    marginBottom: 8,
                    borderBottom: '1px solid var(--border-subtle)',
                    gap: 8,
                }}
            >
                <Space size={6}>
                    <Text strong style={{ fontSize: 13, color: 'var(--brand-950)' }}>
                        Riwayat Notifikasi
                    </Text>
                    {unreadCount > 0 && (
                        <Tag
                            style={{
                                margin: 0,
                                background: 'var(--brand-50)',
                                borderColor: 'var(--brand-200)',
                                color: 'var(--brand-700)',
                                fontWeight: 600,
                                fontSize: 11,
                            }}
                        >
                            {unreadCount} Baru
                        </Tag>
                    )}
                </Space>

                {items.length > 0 && (
                    <Space size={4}>
                        {unreadCount > 0 && (
                            <Tooltip title="Tandai semua sudah dibaca">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<CheckOutlined style={{ fontSize: 12 }} />}
                                    onClick={markAllNotificationsRead}
                                    style={{ fontSize: 11, height: 26, padding: '0 6px', color: 'var(--brand-600)' }}
                                >
                                    Dibaca
                                </Button>
                            </Tooltip>
                        )}
                        <Tooltip title="Bersihkan seluruh riwayat">
                            <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                                onClick={clearAllNotifications}
                                style={{ fontSize: 11, height: 26, padding: '0 6px' }}
                            />
                        </Tooltip>
                    </Space>
                )}
            </div>

            {/* Daftar Item Notifikasi */}
            {items.length === 0 ? (
                <div style={{ padding: '24px 12px', textAlign: 'center' }}>
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        styles={{ image: { height: 34, marginBottom: 6 } }}
                        description={
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                Belum ada riwayat peringatan atau notifikasi sistem.
                            </Text>
                        }
                    />
                </div>
            ) : (
                <div
                    style={{
                        maxHeight: 340,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        paddingRight: 2,
                    }}
                >
                    {items.map((item) => {
                        const styleMeta = getIconStyle(item.type);
                        return (
                            <div
                                key={item.id}
                                onClick={() => markNotificationRead(item.id)}
                                style={{
                                    padding: '10px 12px',
                                    borderRadius: 8,
                                    background: item.read ? 'var(--bg-surface)' : 'var(--brand-50)',
                                    border: `1px solid ${item.read ? 'var(--border-subtle)' : 'var(--brand-200)'}`,
                                    cursor: 'pointer',
                                    transition: 'background 0.15s ease',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 10,
                                }}
                            >
                                <div
                                    style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 6,
                                        background: styleMeta.bg,
                                        border: `1px solid ${styleMeta.border}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        marginTop: 2,
                                    }}
                                >
                                    {styleMeta.icon}
                                </div>

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                        <Text strong style={{ fontSize: 12, color: 'var(--brand-950)', lineHeight: 1.3 }}>
                                            {item.title}
                                        </Text>
                                        {!item.read && (
                                            <span
                                                style={{
                                                    width: 7,
                                                    height: 7,
                                                    borderRadius: '50%',
                                                    background: 'var(--brand-600)',
                                                    flexShrink: 0,
                                                }}
                                            />
                                        )}
                                    </div>

                                    <Text style={{ fontSize: 12, color: '#334155', display: 'block', marginTop: 3, lineHeight: 1.45 }}>
                                        {item.description}
                                    </Text>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                                        {item.badgeText && (
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    fontWeight: 600,
                                                    padding: '1px 6px',
                                                    borderRadius: 4,
                                                    background: '#fffbeb',
                                                    color: '#92400e',
                                                    border: '1px solid #fde68a',
                                                }}
                                            >
                                                {item.badgeText}
                                            </span>
                                        )}
                                        <Text type="secondary" style={{ fontSize: 10 }}>
                                            Tercatat: {item.recordedAt}
                                        </Text>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <Popover
            content={popoverContent}
            trigger="click"
            open={open}
            onOpenChange={(nextOpen) => setOpen(nextOpen)}
            placement="bottomRight"
            arrow={false}
        >
            <Tooltip title="Riwayat Notifikasi Sistem">
                <Badge count={unreadCount} size="small" offset={[-4, 4]} color="#d97706">
                    <Button
                        type="text"
                        aria-label="Riwayat Notifikasi"
                        icon={<BellOutlined style={{ fontSize: 16, color: 'var(--brand-900)' }} />}
                        style={{
                            width: 34,
                            height: 34,
                            minHeight: 34,
                            padding: 0,
                            borderRadius: 9999,
                            background: open ? 'var(--brand-100)' : 'var(--brand-50)',
                            border: '1px solid var(--brand-200)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    />
                </Badge>
            </Tooltip>
        </Popover>
    );
};

/**
 * Evaluasi kesegaran data telemetri agar data lama tidak pernah ditampilkan seolah-olah real-time
 */
export const evaluateDataFreshness = (timestampInput, { isFromCache = false, hasNetworkError = false } = {}) => {
    const parsedDate = parseUtc(timestampInput);
    if (!parsedDate) {
        return {
            status: 'empty',
            isStale: true,
            isLive: false,
            ageMs: null,
            formattedTime: null,
            label: 'Belum Ada Data',
        };
    }

    const ageMs = Math.max(0, Date.now() - parsedDate.getTime());
    const formattedTime = formatDateTimeWita(parsedDate);
    const isOld = ageMs > STALE_THRESHOLD_MS;

    if (hasNetworkError || isFromCache || isOld) {
        const ageMinutes = Math.floor(ageMs / 60000);
        const ageText =
            ageMinutes >= 60
                ? `${Math.floor(ageMinutes / 60)} jam lalu`
                : ageMinutes >= 1
                  ? `${ageMinutes} menit lalu`
                  : 'baru saja (cache)';
        return {
            status: 'stale',
            isStale: true,
            isLive: false,
            ageMs,
            formattedTime,
            label: `Data Historis (${ageText})`,
        };
    }

    return {
        status: 'live',
        isStale: false,
        isLive: true,
        ageMs,
        formattedTime,
        label: 'Real-Time Aktif',
    };
};

/**
 * 1. OFFLINE STATE BANNER
 * Mendeteksi putusnya koneksi internet browser atau kegagalan koneksi ke server FastAPI
 */
export const OfflineBanner = ({ apiOffline = false, onRetry }) => {
    const [browserOffline, setBrowserOffline] = useState(() =>
        typeof navigator !== 'undefined' ? !navigator.onLine : false
    );

    useEffect(() => {
        const handleOnline = () => setBrowserOffline(false);
        const handleOffline = () => setBrowserOffline(true);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        if (browserOffline || apiOffline) {
            pushSystemNotification({
                id: browserOffline ? 'offline-browser' : 'offline-api',
                type: 'error',
                title: browserOffline ? 'Perangkat Offline' : 'Koneksi Server Telemetri Terputus',
                description: browserOffline
                    ? 'Koneksi internet perangkat terputus. Menampilkan data terakhir di memori.'
                    : 'Tidak dapat menghubungi backend FastAPI. Menampilkan data terakhir yang tersimpan.',
                badgeText: 'Offline',
            });
        }
    }, [browserOffline, apiOffline]);

    if (!browserOffline && !apiOffline) return null;

    return (
        <Alert
            type="error"
            showIcon
            icon={<DisconnectOutlined />}
            style={{
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--status-danger-border)',
                background: 'var(--status-danger-bg)',
                marginBottom: 'var(--space-4)',
            }}
            message={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <Text strong style={{ color: 'var(--status-danger)', fontSize: 'var(--text-sm)' }}>
                        {browserOffline
                            ? 'Perangkat Offline — Koneksi internet terputus.'
                            : 'Koneksi ke Server Telemetri Terputus — Menampilkan data terakhir yang tersimpan.'}
                    </Text>
                    {onRetry && (
                        <Button size="small" danger icon={<ReloadOutlined />} onClick={onRetry}>
                            Hubungkan Ulang
                        </Button>
                    )}
                </div>
            }
        />
    );
};

/**
 * 2. STALE DATA INDICATOR BADGE & FLOATING NOTIFICATION
 * Membedakan secara tegas antara data Real-Time dan data lama/cache, sekaligus mencatatnya ke lonceng notifikasi
 */
export const DataFreshnessBadge = ({ timestamp, isFromCache = false, hasNetworkError = false }) => {
    const info = evaluateDataFreshness(timestamp, { isFromCache, hasNetworkError });

    if (info.status === 'empty') {
        return (
            <span className="sf-status-pill sf-status-pill--neutral">
                <span className="sf-dot" style={{ background: '#94a3b8' }} />
                <span>Menunggu Data Sensor</span>
            </span>
        );
    }

    if (info.status === 'stale') {
        return (
            <Tooltip title={`Data ini bukan real-time saat ini. Rekaman terakhir pada: ${info.formattedTime}`}>
                <span className="sf-status-pill sf-status-pill--stale">
                    <span className="sf-dot sf-dot--stale" />
                    <span>{info.label} • {info.formattedTime}</span>
                </span>
            </Tooltip>
        );
    }

    return (
        <Tooltip title={`Sinkronisasi telemetri real-time: ${info.formattedTime}`}>
            <span className="sf-status-pill sf-status-pill--live">
                <span className="sf-dot sf-dot--live" />
                <span>Live • {info.formattedTime}</span>
            </span>
        </Tooltip>
    );
};

export const StaleDataBanner = ({ timestamp, isFromCache = false, hasNetworkError = false, onRefresh }) => {
    const [dismissedForTimestamp, setDismissedForTimestamp] = useState(null);
    const info = evaluateDataFreshness(timestamp, { isFromCache, hasNetworkError });

    // Catat otomatis ke Riwayat Notifikasi (Lonceng) setiap kali terdeteksi data tidak real-time
    useEffect(() => {
        if (info.status === 'stale' && info.formattedTime) {
            pushSystemNotification({
                id: `stale-${info.formattedTime}`,
                type: 'warning',
                title: 'Perhatian (Data Tidak Real-Time)',
                description: `Menampilkan rekaman terakhir pada ${info.formattedTime}. Perangkat sensor mungkin sedang tidak mengirim pembaruan baru.`,
                badgeText: info.label,
            });
        }
    }, [info.status, info.formattedTime, info.label]);

    if (info.status !== 'stale') return null;

    const currentKey = String(timestamp || 'stale');
    if (dismissedForTimestamp === currentKey) return null;

    return (
        <div
            className="sf-floating-notification"
            role="status"
            aria-live="polite"
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                    }}
                >
                    <ClockCircleOutlined style={{ color: '#d97706', fontSize: 16 }} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <Text strong style={{ color: '#92400e', fontSize: 13, lineHeight: 1.35 }}>
                            Perhatian (Data Tidak Real-Time)
                        </Text>
                        <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined style={{ fontSize: 12, color: '#64748b' }} />}
                            onClick={() => setDismissedForTimestamp(currentKey)}
                            aria-label="Tutup notifikasi"
                            style={{ minHeight: 24, height: 24, width: 24, padding: 0, marginTop: -2, marginRight: -4 }}
                        />
                    </div>

                    <Text style={{ color: '#475569', fontSize: 12, display: 'block', marginTop: 4, lineHeight: 1.5 }}>
                        Menampilkan rekaman terakhir pada <b style={{ color: '#1b1c4b' }}>{info.formattedTime}</b>. Perangkat sensor mungkin sedang tidak mengirim pembaruan baru.
                    </Text>

                    {onRefresh && (
                        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <Button
                                size="small"
                                onClick={() => setDismissedForTimestamp(currentKey)}
                                style={{ minHeight: 30, fontSize: 12 }}
                            >
                                Tutup
                            </Button>
                            <Button
                                size="small"
                                type="primary"
                                icon={<ReloadOutlined />}
                                onClick={onRefresh}
                                style={{ minHeight: 30, fontSize: 12 }}
                            >
                                Segarkan Data
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * 3. LOADING STATE COMPONENT
 */
export const LoadingState = ({ tip = 'Memuat data ilmiah...', rows = 3, compact = false }) => {
    if (compact) {
        return (
            <div style={{ height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Spin size="small" />
                <Text type="secondary" style={{ fontSize: 'var(--text-xs)' }}>{tip}</Text>
            </div>
        );
    }
    return (
        <div style={{ padding: 'var(--space-5)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
            <Skeleton active paragraph={{ rows }} />
        </div>
    );
};

/**
 * 4. EMPTY STATE COMPONENT
 */
export const EmptyState = ({
    title = 'Belum Ada Data Tercatat',
    description = 'Sistem belum menerima rekaman data untuk parameter atau periode ini.',
    actionLabel,
    onAction,
    height = 160,
}) => (
    <div
        style={{
            minHeight: height,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
            textAlign: 'center',
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-default)',
        }}
    >
        <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            styles={{ image: { height: 36, marginBottom: 8 } }}
            description={
                <Space direction="vertical" size={2}>
                    <Text strong style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {title}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                        {description}
                    </Text>
                </Space>
            }
        >
            {actionLabel && onAction && (
                <Button size="small" type="primary" onClick={onAction} icon={<ReloadOutlined />}>
                    {actionLabel}
                </Button>
            )}
        </Empty>
    </div>
);

/**
 * 5. ERROR STATE COMPONENT
 */
export const ErrorState = ({
    title = 'Gagal Memuat Data',
    description = 'Terjadi gangguan komunikasi saat menghubungi server.',
    onRetry,
}) => (
    <Alert
        type="error"
        showIcon
        icon={<WarningOutlined />}
        style={{
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--status-danger-border)',
            background: 'var(--status-danger-bg)',
            marginBottom: 'var(--space-4)',
        }}
        message={<Text strong style={{ color: 'var(--status-danger)', fontSize: 'var(--text-sm)' }}>{title}</Text>}
        description={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <Text style={{ color: '#991b1b', fontSize: 'var(--text-xs)' }}>{description}</Text>
                {onRetry && (
                    <Button size="small" danger icon={<ReloadOutlined />} onClick={onRetry}>
                        Coba Lagi
                    </Button>
                )}
            </div>
        }
    />
);

/**
 * 6. CONFIRMATION DIALOG HELPER & HOST (React 19 + Ant Design v6 Compatible)
 * Menggunakan controlled <Modal> agar kompatibel penuh dengan React 19
 */
let confirmListener = null;

export const confirmAction = ({
    title,
    content,
    okText = 'Ya, Lanjutkan',
    cancelText = 'Batal',
    danger = false,
    onConfirm,
}) => {
    if (confirmListener) {
        confirmListener({
            open: true,
            title,
            content,
            okText,
            cancelText,
            danger,
            onConfirm,
        });
    } else if (onConfirm) {
        onConfirm();
    }
};

export const ConfirmModalHost = () => {
    const [modalState, setModalState] = useState({
        open: false,
        title: '',
        content: '',
        okText: 'Ya, Lanjutkan',
        cancelText: 'Batal',
        danger: false,
        onConfirm: null,
    });
    const [confirmLoading, setConfirmLoading] = useState(false);

    useEffect(() => {
        confirmListener = (nextState) => setModalState(nextState);
        return () => {
            confirmListener = null;
        };
    }, []);

    const handleCancel = () => {
        if (confirmLoading) return;
        setModalState((prev) => ({ ...prev, open: false }));
    };

    const handleOk = async () => {
        if (!modalState.onConfirm) {
            setModalState((prev) => ({ ...prev, open: false }));
            return;
        }
        try {
            setConfirmLoading(true);
            await modalState.onConfirm();
            setModalState((prev) => ({ ...prev, open: false }));
        } finally {
            setConfirmLoading(false);
        }
    };

    return (
        <Modal
            open={modalState.open}
            title={
                <Space size={8}>
                    <ExclamationCircleOutlined
                        style={{ color: modalState.danger ? 'var(--status-danger)' : 'var(--color-adm)', fontSize: 18 }}
                    />
                    <span>{modalState.title}</span>
                </Space>
            }
            onCancel={handleCancel}
            onOk={handleOk}
            okText={modalState.okText}
            cancelText={modalState.cancelText}
            okButtonProps={{ danger: Boolean(modalState.danger), loading: confirmLoading }}
            centered
            width={420}
        >
            <div style={{ paddingTop: 6 }}>
                <Text style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    {modalState.content}
                </Text>
            </div>
        </Modal>
    );
};

import React from 'react';
import {
    Card,
    Typography,
    Tabs,
    Form,
    InputNumber,
    Switch,
    Button,
    Row,
    Col,
    Divider,
    TimePicker,
    Input,
    Space,
    message
} from 'antd';
import {
    SaveOutlined,
    ControlOutlined,
    ClockCircleOutlined,
    ToolOutlined,
    ApiOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const Settings = () => {
    const [formFuzzy] = Form.useForm();
    const [formTimer] = Form.useForm();
    const [formDevice] = Form.useForm();

    const handleSave = (section) => {
        message.success(`Pengaturan ${section} berhasil disimpan ke database!`);
    };

    // --- TAB 1: KONFIGURASI ADM (FUZZY SUGENO) ---
    const TabFuzzy = () => (
        <Form form={formFuzzy} layout="vertical" initialValues={{
            admEnabled: true, baseFeed: 3, doMin: 4.0, doMax: 8.0, tempMin: 25.0, tempMax: 32.0
        }}>
            <div style={{ marginBottom: '24px' }}>
                <Text type="secondary">Sesuaikan parameter keanggotaan (membership function) algoritma Fuzzy Sugeno untuk Kolam Perlakuan (A).</Text>
            </div>

            <Form.Item name="admEnabled" label="Status Sistem Automated Decision Making (ADM)" valuePropName="checked">
                <Switch checkedChildren="Aktif" unCheckedChildren="Nonaktif" />
            </Form.Item>

            <Divider />
            <Title level={5} style={{ marginBottom: '16px' }}>Parameter Pakan Basis & Lingkungan</Title>
            <Row gutter={24}>
                <Col xs={24} sm={12} lg={8}>
                    <Form.Item name="baseFeed" label="Target Pakan Normal (% dari Biomassa)" tooltip="Persentase dasar pakan harian sebelum dikalikan bobot fuzzy">
                        <InputNumber style={{ width: '100%' }} suffix="%" step={0.1} />
                    </Form.Item>
                </Col>
            </Row>

            <Row gutter={24}>
                <Col xs={24} sm={12} lg={8}>
                    <Form.Item name="doMin" label="Batas Bawah DO Normal (mg/L)">
                        <InputNumber style={{ width: '100%' }} step={0.1} />
                    </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                    <Form.Item name="tempMin" label="Batas Bawah Suhu Normal (°C)">
                        <InputNumber style={{ width: '100%' }} step={0.1} />
                    </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                    <Form.Item name="tempMax" label="Batas Atas Suhu Normal (°C)">
                        <InputNumber style={{ width: '100%' }} step={0.1} />
                    </Form.Item>
                </Col>
            </Row>

            <Button type="primary" icon={<SaveOutlined />} onClick={() => handleSave('Fuzzy Sugeno')}>
                Simpan Konfigurasi Fuzzy
            </Button>
        </Form>
    );

    // --- TAB 2: KONFIGURASI KOLAM KONTROL (TIMER) ---
    const TabTimer = () => (
        <Form form={formTimer} layout="vertical" initialValues={{
            time1: dayjs('08:00', 'HH:mm'), feed1: 1000,
            time2: dayjs('12:00', 'HH:mm'), feed2: 1000,
            time3: dayjs('16:00', 'HH:mm'), feed3: 1000,
            time4: dayjs('20:00', 'HH:mm'), feed4: 1000,
        }}>
            <div style={{ marginBottom: '24px' }}>
                <Text type="secondary">Atur jadwal statis dan dosis pemberian pakan untuk Kolam Kontrol (Timer).</Text>
            </div>

            <Row gutter={[24, 16]}>
                {[1, 2, 3, 4].map((num) => (
                    <Col xs={24} lg={12} key={`timer-${num}`}>
                        <Card type="inner" title={`Jadwal Feeding ${num}`} size="small">
                            <Row gutter={16}>
                                <Col span={12}>
                                    <Form.Item name={`time${num}`} label="Jam Eksekusi">
                                        <TimePicker format="HH:mm" style={{ width: '100%' }} />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item name={`feed${num}`} label="Dosis Pakan (gram)">
                                        <InputNumber style={{ width: '100%' }} />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                ))}
            </Row>

            <div style={{ marginTop: '24px' }}>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => handleSave('Jadwal Timer')}>
                    Simpan Jadwal Timer
                </Button>
            </div>
        </Form>
    );

    // --- TAB 3: MANAJEMEN PERANGKAT (IoT) ---
    const TabDevice = () => (
        <Form form={formDevice} layout="vertical" initialValues={{
            gatewayIp: '192.168.1.105', influxHost: 'http://localhost:8086', phOffset: 0.1, doOffset: -0.2
        }}>
            <div style={{ marginBottom: '24px' }}>
                <Text type="secondary">Konfigurasi alamat endpoint API, koneksi database InfluxDB, dan nilai kalibrasi sensor (offset).</Text>
            </div>

            <Title level={5} style={{ marginBottom: '16px' }}>Konektivitas</Title>
            <Row gutter={24}>
                <Col xs={24} lg={12}>
                    <Form.Item name="gatewayIp" label="IP Address Gateway (Raspberry Pi / ESP32)">
                        <Input prefix={<ApiOutlined style={{ color: '#bfbfbf' }} />} />
                    </Form.Item>
                </Col>
                <Col xs={24} lg={12}>
                    <Form.Item name="influxHost" label="Endpoint InfluxDB">
                        <Input prefix={<ApiOutlined style={{ color: '#bfbfbf' }} />} />
                    </Form.Item>
                </Col>
            </Row>

            <Divider />
            <Title level={5} style={{ marginBottom: '16px' }}>Kalibrasi Sensor (Offset)</Title>
            <Row gutter={24}>
                <Col xs={24} sm={12} lg={6}>
                    <Form.Item name="phOffset" label="Offset Sensor pH" tooltip="Nilai penyeimbang kalibrasi sensor PH-4502C">
                        <InputNumber style={{ width: '100%' }} step={0.1} />
                    </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Form.Item name="doOffset" label="Offset Sensor DO (mg/L)" tooltip="Nilai penyeimbang kalibrasi sensor BLE-9100">
                        <InputNumber style={{ width: '100%' }} step={0.1} />
                    </Form.Item>
                </Col>
            </Row>

            <Button type="primary" icon={<SaveOutlined />} onClick={() => handleSave('Perangkat & Sensor')}>
                Simpan Konfigurasi Perangkat
            </Button>
        </Form>
    );

    const tabItems = [
        { key: '1', label: <Space><ControlOutlined /> ADM Fuzzy Sugeno</Space>, children: <TabFuzzy /> },
        { key: '2', label: <Space><ClockCircleOutlined /> Kolam Kontrol (Timer)</Space>, children: <TabTimer /> },
        { key: '3', label: <Space><ToolOutlined /> Perangkat & Sensor</Space>, children: <TabDevice /> },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
                <Title level={3} style={{ margin: 0 }}>PENGATURAN</Title>
                <Text type="secondary">Konfigurasi algoritma decision making, jadwal statis, dan manajemen perangkat keras</Text>
            </div>

            <Card bordered={false} style={{ borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', minHeight: '60vh' }}>
                <Tabs defaultActiveKey="1" items={tabItems} size="large" />
            </Card>
        </div>
    );
};

export default Settings;
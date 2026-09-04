// server.js - الخادم الخلفي مع وقت التجهيز
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  مسارات الصفحات الثابتة
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/:page', (req, res) => {
    const page = req.params.page;
    const filePath = path.join(__dirname, 'public', `${page}.html`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('الصفحة غير موجودة');
    }
});

// ============================================================
//  إعداد مسار ملفات البيانات
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function readOrders() {
    try {
        if (!fs.existsSync(ORDERS_FILE)) return [];
        const data = fs.readFileSync(ORDERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('خطأ في قراءة الطلبات:', err);
        return [];
    }
}

function writeOrders(orders) {
    try {
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
    } catch (err) {
        console.error('خطأ في حفظ الطلبات:', err);
    }
}

function readUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            const defaultUsers = {
                restaurants: [
                    { username: 'rest1', displayName: 'مطعم اجعل لحد حوش', extra: '0599999999', password: '123456' },
                    { username: 'rest2', displayName: 'مطعم بيتزا', extra: '0598888888', password: '123456' },
                    { username: 'rest3', displayName: 'مطعم بروست', extra: '0597777777', password: '123456' }
                ],
                drivers: [
                    { username: 'driver1', displayName: 'أحمد', extra: '0596666666', password: '123456' },
                    { username: 'driver2', displayName: 'محمد', extra: '0595555555', password: '123456' }
                ]
            };
            fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
            return defaultUsers;
        }
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('خطأ في قراءة المستخدمين:', err);
        return { restaurants: [], drivers: [] };
    }
}

function writeUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (err) {
        console.error('خطأ في حفظ المستخدمين:', err);
    }
}

// ============================================================
//  منطق حساب رسوم التوصيل الذكية
// ============================================================
function updateDeliveryFeesForGroup(orderGroup, driverId, orders) {
    const groupOrders = orders.filter(o => o.orderGroup === orderGroup);
    if (groupOrders.length <= 1) return orders;
    const allHaveSameDriver = groupOrders.every(o => o.driverId === driverId && o.status !== 'cancelled');
    if (allHaveSameDriver) {
        let isFirst = true;
        groupOrders.forEach(o => {
            if (o.status !== 'cancelled') {
                if (isFirst) {
                    o.deliveryFee = 10;
                    isFirst = false;
                } else {
                    o.deliveryFee = 0;
                }
                const itemsTotal = o.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                o.total = itemsTotal + o.deliveryFee;
            }
        });
    } else {
        groupOrders.forEach(o => {
            if (o.status !== 'cancelled' && o.deliveryFee !== 7) {
                o.deliveryFee = 7;
                const itemsTotal = o.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                o.total = itemsTotal + o.deliveryFee;
            }
        });
    }
    return orders;
}

// ============================================================
//  مسارات API
// ============================================================
app.get('/api/orders', (req, res) => {
    try {
        const orders = readOrders();
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: 'فشل في جلب الطلبات' });
    }
});

app.post('/api/orders', (req, res) => {
    try {
        const orders = readOrders();
        const newOrder = req.body;
        const maxId = orders.reduce((max, o) => Math.max(max, o.id || 0), 0);
        newOrder.id = maxId + 1;
        if (!newOrder.createdAt) newOrder.createdAt = new Date().toISOString();
        if (!newOrder.updatedAt) newOrder.updatedAt = new Date().toISOString();
        if (!newOrder.driverAssigned) newOrder.driverAssigned = false;
        if (!newOrder.orderGroup) newOrder.orderGroup = `GROUP_${Date.now()}`;
        // إضافة حقل وقت التجهيز (افتراضي)
        if (!newOrder.estimatedPrepTime) newOrder.estimatedPrepTime = null;
        orders.push(newOrder);
        writeOrders(orders);
        res.status(201).json(newOrder);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في إنشاء الطلب' });
    }
});

app.put('/api/orders/:id', (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const updates = req.body;
        let orders = readOrders();
        const index = orders.findIndex(o => o.id === orderId);
        if (index === -1) {
            return res.status(404).json({ error: 'الطلب غير موجود' });
        }

        // دمج التحديثات
        orders[index] = {
            ...orders[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        // إذا تم تعيين كابتن، تحديث رسوم التوصيل
        if (updates.driverId && orders[index].orderGroup) {
            orders = updateDeliveryFeesForGroup(
                orders[index].orderGroup,
                updates.driverId,
                orders
            );
            const updatedIndex = orders.findIndex(o => o.id === orderId);
            if (updatedIndex !== -1) {
                orders[index] = orders[updatedIndex];
            }
        }

        writeOrders(orders);
        res.json(orders[index]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في تحديث الطلب' });
    }
});

// إشعار الكابتن (نقطة نهاية وهمية)
app.post('/api/orders/:id/notify-driver', (req, res) => {
    console.log(`📢 تم إرسال إشعار للكابتن للطلب رقم ${req.params.id}`);
    res.status(200).json({ success: true, message: 'تم إرسال الإشعار' });
});

// ============================================================
//  مسارات المستخدمين والأدمن
// ============================================================
app.get('/api/users', (req, res) => {
    try {
        const users = readUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'فشل في جلب المستخدمين' });
    }
});

app.put('/api/users', (req, res) => {
    try {
        const newUsers = req.body;
        if (!newUsers.restaurants || !newUsers.drivers) {
            return res.status(400).json({ error: 'بيانات غير صحيحة' });
        }
        writeUsers(newUsers);
        res.json({ success: true, message: 'تم حفظ المستخدمين بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في حفظ المستخدمين' });
    }
});

app.post('/api/admin/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const ADMIN_USERNAME = 'awad';
        const ADMIN_PASSWORD = '050313651';
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            res.json({ success: true, message: 'تم تسجيل الدخول بنجاح' });
        } else {
            res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'فشل في تسجيل الدخول' });
    }
});

// ============================================================
//  تشغيل الخادم
// ============================================================
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`📡 API Base: http://localhost:${PORT}/api`);
    console.log(`👑 بيانات الأدمن: awad / 050313651`);
});

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// التأكد من وجود مجلد data
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

// ========== إعداد Firebase Admin (لإرسال إشعارات Push) ==========
// نحاول قراءة بيانات حساب الخدمة من متغير بيئة FIREBASE_SERVICE_ACCOUNT أولاً (الأفضل أمنياً، مستخدم على Render)،
// وإذا غير موجود نجرب ملف محلي firebase-service-account.json (للتطوير المحلي فقط - لا يُرفع لـ GitHub أبداً).
let firebaseEnabled = false;
try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        const localPath = path.join(__dirname, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        }
    }
    if (serviceAccount) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        firebaseEnabled = true;
        console.log('✅ Firebase Admin مهيأ - الإشعارات الحقيقية (Push) مفعّلة');
    } else {
        console.log('⚠️ لم يتم العثور على بيانات اعتماد Firebase - إشعارات Push معطّلة (باقي التطبيق شغّال عادي)');
    }
} catch (err) {
    console.log('⚠️ فشل تهيئة Firebase Admin - إشعارات Push معطّلة:', err.message);
}

/**
 * يرسل إشعار Push لمجموعة من الأجهزة (Tokens) دفعة وحدة.
 * ما بيوقف السيرفر أو يرمي خطأ لو فشل الإرسال - بس بيسجل بالـ console.
 */
async function sendPushToTokens(tokens, title, body, data = {}) {
    if (!firebaseEnabled || !tokens || tokens.length === 0) return;
    const stringData = {};
    Object.keys(data).forEach(k => { stringData[k] = String(data[k]); });

    try {
        const response = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: { title, body },
            data: stringData,
            android: {
                priority: 'high',
                notification: { channelId: 'adhna_orders_channel', sound: 'default' }
            }
        });
        console.log(`🔔 تم إرسال ${response.successCount} إشعار بنجاح، فشل ${response.failureCount}`);

        // تنظيف التوكنات غير الصالحة (مثلاً لو المستخدم حذف التطبيق)
        if (response.failureCount > 0) {
            const invalidTokens = [];
            response.responses.forEach((r, i) => {
                if (!r.success) invalidTokens.push(tokens[i]);
            });
            if (invalidTokens.length > 0) removeInvalidTokens(invalidTokens);
        }
    } catch (err) {
        console.error('فشل إرسال إشعارات Push:', err.message);
    }
}

function removeInvalidTokens(invalidTokens) {
    try {
        const db = readDB();
        let changed = false;
        ['restaurants', 'drivers'].forEach(group => {
            (db.users[group] || []).forEach(u => {
                if (!Array.isArray(u.fcmTokens)) return;
                const before = u.fcmTokens.length;
                u.fcmTokens = u.fcmTokens.filter(t => !invalidTokens.includes(t));
                if (u.fcmTokens.length !== before) changed = true;
            });
        });
        if (changed) writeDB(db);
    } catch (err) {
        console.error('فشل تنظيف التوكنات غير الصالحة:', err.message);
    }
}

function readDB() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        const defaultDB = {
            orders: [],
            users: {
                restaurants: [
                    { username: 'shawarma', displayName: 'مطعم شاورما', extra: 'شاورما ووجبات', password: '1234', fcmTokens: [] },
                    { username: 'pizza', displayName: 'مطعم بيتزا', extra: 'بيتزا وإيطالي', password: '1234', fcmTokens: [] },
                    { username: 'broast', displayName: 'مطعم بروست', extra: 'بروست دجاج', password: '1234', fcmTokens: [] },
                    { username: 'arabic', displayName: 'مطعم الشرق الأوسط', extra: 'مأكولات عربية', password: '1234', fcmTokens: [] }
                ],
                drivers: [
                    { username: 'driver1', displayName: 'كابتن محمد', extra: 'سيارة', password: '1111', fcmTokens: [] },
                    { username: 'driver2', displayName: 'كابتن أحمد', extra: 'دراجة', password: '2222', fcmTokens: [] },
                    { username: 'driver3', displayName: 'كابتن خالد', extra: 'سكوتر', password: '3333', fcmTokens: [] }
                ]
            },
            admin: { username: 'awad', password: '050313651' }
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB, null, 2));
        return defaultDB;
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ========== API Routes ==========
app.get('/api/orders', (req, res) => {
    const db = readDB();
    res.json(db.orders);
});

app.post('/api/orders', async (req, res) => {
    const db = readDB();
    const newOrder = req.body;
    newOrder.id = Date.now();
    db.orders.push(newOrder);
    writeDB(db);
    res.status(201).json(newOrder);

    // إشعار المطعم المعني بطلب جديد (restaurantId من الواجهة مطابق لترتيب المطاعم بقائمة تسجيل الدخول)
    const restaurantIndex = (newOrder.restaurantId || 1) - 1;
    const targetRestaurant = db.users.restaurants[restaurantIndex];
    if (targetRestaurant && targetRestaurant.fcmTokens && targetRestaurant.fcmTokens.length) {
        sendPushToTokens(
            targetRestaurant.fcmTokens,
            '🆕 طلب جديد',
            `طلب #${newOrder.id} من ${newOrder.customerName || 'زبون'}`,
            { type: 'NEW_ORDER', orderId: newOrder.id }
        );
    }
});

app.put('/api/orders/:id', async (req, res) => {
    const db = readDB();
    const orderId = parseInt(req.params.id);
    const index = db.orders.findIndex(o => o.id === orderId);
    if (index === -1) return res.status(404).json({ error: 'الطلب غير موجود' });
    const previousStatus = db.orders[index].status;
    db.orders[index] = { ...db.orders[index], ...req.body };
    writeDB(db);
    res.json(db.orders[index]);

    // لما الطلب يصير "جاهز للاستلام"، منبعت إشعار لكل الكباتن المسجلين
    if (previousStatus !== 'ready_for_pickup' && db.orders[index].status === 'ready_for_pickup') {
        const allDriverTokens = (db.users.drivers || []).flatMap(d => d.fcmTokens || []);
        sendPushToTokens(
            allDriverTokens,
            '📦 طلب جاهز للاستلام',
            `طلب #${orderId} من ${db.orders[index].restaurantName || 'مطعم'}`,
            { type: 'ORDER_READY', orderId }
        );
    }
});

// إعادة إرسال إشعار للكباتن يدوياً (زر "🔔 إشعار الكابتن" بلوحة المطعم)
app.post('/api/orders/:id/notify-driver', async (req, res) => {
    const db = readDB();
    const orderId = parseInt(req.params.id);
    const order = db.orders.find(o => o.id === orderId);
    if (!order || order.status !== 'ready_for_pickup') {
        return res.status(400).json({ error: 'الطلب غير موجود أو ليس بحالة جاهز للاستلام' });
    }
    const allDriverTokens = (db.users.drivers || []).flatMap(d => d.fcmTokens || []);
    await sendPushToTokens(
        allDriverTokens,
        '🔔 تذكير: طلب جاهز للاستلام',
        `طلب #${orderId} من ${order.restaurantName || 'مطعم'}`,
        { type: 'ORDER_READY', orderId }
    );
    res.json({ success: true });
});

// تسجيل FCM Token لمطعم أو كابتن حتى يوصله إشعارات Push حقيقية
app.post('/api/notifications/register-token', (req, res) => {
    const { role, username, token } = req.body;
    if (!role || !username || !token) {
        return res.status(400).json({ error: 'role و username و token كلها مطلوبة' });
    }
    if (role !== 'restaurant' && role !== 'driver') {
        return res.status(400).json({ error: 'role لازم يكون restaurant أو driver' });
    }
    const db = readDB();
    const group = role === 'restaurant' ? db.users.restaurants : db.users.drivers;
    const user = group.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (!Array.isArray(user.fcmTokens)) user.fcmTokens = [];
    if (!user.fcmTokens.includes(token)) {
        user.fcmTokens.push(token);
        writeDB(db);
    }
    res.json({ success: true });
});

app.get('/api/users', (req, res) => {
    const db = readDB();
    res.json(db.users);
});

app.put('/api/users', (req, res) => {
    const db = readDB();
    db.users = req.body;
    writeDB(db);
    res.json(db.users);
});

app.post('/api/admin/login', (req, res) => {
    const db = readDB();
    const { username, password } = req.body;
    if (username === db.admin.username && password === db.admin.password) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

// ========== تشغيل الخادم ==========
app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});

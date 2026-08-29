const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

function readDB() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        const defaultDB = {
            orders: [],
            users: {
                restaurants: [
                    { username: 'shawarma', displayName: 'مطعم شاورما', extra: 'شاورما ووجبات', password: '1234' },
                    { username: 'pizza', displayName: 'مطعم بيتزا', extra: 'بيتزا وإيطالي', password: '1234' },
                    { username: 'broast', displayName: 'مطعم بروست', extra: 'بروست دجاج', password: '1234' },
                    { username: 'arabic', displayName: 'مطعم الشرق الأوسط', extra: 'مأكولات عربية', password: '1234' }
                ],
                drivers: [
                    { username: 'driver1', displayName: 'كابتن محمد', extra: 'سيارة', password: '1111' },
                    { username: 'driver2', displayName: 'كابتن أحمد', extra: 'دراجة', password: '2222' },
                    { username: 'driver3', displayName: 'كابتن خالد', extra: 'سكوتر', password: '3333' }
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

app.post('/api/orders', (req, res) => {
    const db = readDB();
    const newOrder = req.body;
    newOrder.id = Date.now();
    db.orders.push(newOrder);
    writeDB(db);
    res.status(201).json(newOrder);
});

app.put('/api/orders/:id', (req, res) => {
    const db = readDB();
    const orderId = parseInt(req.params.id);
    const index = db.orders.findIndex(o => o.id === orderId);
    if (index === -1) return res.status(404).json({ error: 'الطلب غير موجود' });
    db.orders[index] = { ...db.orders[index], ...req.body };
    writeDB(db);
    res.json(db.orders[index]);
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
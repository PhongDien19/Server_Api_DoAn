const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// 1. Cấu hình kết nối Database (Kết nối vào XAMPP MySQL)
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Aiven yêu cầu SSL để kết nối
    ssl: {
        rejectUnauthorized: false
    }
});

// Helper function để chạy query dạng Promise (cho gọn code)
const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// ================= ROUTE API =================

// API 1: Đăng ký tài khoản
// URL: POST http://<IP>:3000/api/auth/register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { fullName, email, password, phone } = req.body;

        if (!fullName || !email || !password) {
            return res.json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin!' });
        }

        const checkUser = await query("SELECT * FROM Users WHERE Email = ?", [email]);
        if (checkUser.length > 0) {
            return res.json({ success: false, message: 'Email này đã được đăng ký!' });
        }

        const sqlInsert = "INSERT INTO Users (FullName, Email, PasswordHash, Phone, RoleID) VALUES (?, ?, ?, ?, 2)";
        const result = await query(sqlInsert, [fullName, email, password, phone || null]);

        res.json({
            success: true,
            message: 'Đăng ký thành công!',
            user: {
                id: result.insertId,
                fullName: fullName,
                email: email,
                avatarUrl: null
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server khi đăng ký" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({ success: false, message: 'Vui lòng nhập Email và Mật khẩu!' });
        }

        const users = await query("SELECT * FROM Users WHERE Email = ?", [email]);

        if (users.length === 0) {
            return res.json({ success: false, message: 'Email không tồn tại!' });
        }

        const user = users[0];

        if (password !== user.PasswordHash) {
            return res.json({ success: false, message: 'Mật khẩu không đúng!' });
        }

        res.json({
            success: true,
            message: 'Đăng nhập thành công',
            user: {
                id: user.UserID,
                fullName: user.FullName,
                email: user.Email,
                avatarUrl: user.AvatarURL
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server khi đăng nhập" });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const sql = `
            SELECT 
                p.ProductID, 
                p.ProductName, 
                p.CategoryID, 
                p.Price, 
                p.ThumbnailURL, 
                p.ShortDescription,
                ps.SensorType
            FROM Products p
            LEFT JOIN ProductSpecs ps ON p.ProductID = ps.ProductID
            WHERE p.IsActive = 1
        `;

        const products = await query(sql);

        const formattedProducts = products.map(p => ({
            ...p,
            ThumbnailURL: p.ThumbnailURL || "https://via.placeholder.com/300x300.png?text=No+Image"
        }));

        res.json({
            success: true,
            data: formattedProducts,
            message: "Lấy danh sách thành công"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const sql = "SELECT CategoryID, CategoryName, ParentID FROM Categories WHERE IsActive = 1";
        const categories = await query(sql);

        res.json({
            success: true,
            data: categories
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;

        const sqlProduct = `
            SELECT p.*, ps.* FROM Products p 
            LEFT JOIN ProductSpecs ps ON p.ProductID = ps.ProductID
            WHERE p.ProductID = ?
        `;
        const products = await query(sqlProduct, [productId]);

        if (products.length === 0) {
            return res.status(404).json({ success: false, message: "Không tìm thấy sản phẩm" });
        }

        const product = products[0];

        const sqlImages = "SELECT ImageURL FROM ProductImages WHERE ProductID = ? ORDER BY SortOrder ASC";
        const images = await query(sqlImages, [productId]);

        product.Gallery = images.map(img => img.ImageURL);

        res.json({
            success: true,
            data: product
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});
// Khởi động server (đảm bảo dùng process.env.PORT cho Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
    console.log(`API Products: http://localhost:${PORT}/api/products`);
});
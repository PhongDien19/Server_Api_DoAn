const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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

// Cấu hình Nodemailer để gửi email
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true cho 465, false cho các port khác
    auth: {
        user: process.env.SMTP_USER, // Email gửi
        pass: process.env.SMTP_PASS  // Mật khẩu email hoặc App Password
    }
});

// Helper function để gửi email
const sendEmail = async (to, subject, html) => {
    try {
        const mailOptions = {
            from: `"CKC Digital" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            html: html
        };
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Lỗi gửi email:', error);
        return false;
    }
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

// API: Quên mật khẩu - Gửi email xác nhận
// URL: POST http://<IP>:3000/api/auth/forgot-password
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.json({ success: false, message: 'Vui lòng nhập Email!' });
        }

        // Kiểm tra email có tồn tại không
        const users = await query("SELECT * FROM Users WHERE Email = ?", [email]);
        
        if (users.length === 0) {
            // Không cho biết email không tồn tại để bảo mật
            return res.json({ 
                success: true, 
                message: 'Nếu email tồn tại, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu.' 
            });
        }

        const user = users[0];

        // Tạo token reset password (32 ký tự ngẫu nhiên)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 300000); // Hết hạn sau 5 phút

        // Lưu token vào database
        // Giả sử bảng Users có cột ResetToken và ResetTokenExpiry
        // Nếu chưa có, cần chạy SQL: ALTER TABLE Users ADD COLUMN ResetToken VARCHAR(64) NULL, ADD COLUMN ResetTokenExpiry DATETIME NULL;
        await query(
            "UPDATE Users SET ResetToken = ?, ResetTokenExpiry = ? WHERE UserID = ?",
            [resetToken, resetTokenExpiry, user.UserID]
        );

        // Tạo link reset password
        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

        // Nội dung email
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Yêu cầu đặt lại mật khẩu</h2>
                <p>Xin chào <strong>${user.FullName}</strong>,</p>
                <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
                <p>Vui lòng nhấp vào liên kết bên dưới để đặt lại mật khẩu:</p>
                <p style="margin: 20px 0;">
                    <a href="${resetLink}" 
                       style="background-color: #4CAF50; color: white; padding: 12px 24px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Đặt lại mật khẩu
                    </a>
                </p>
                <p>Hoặc copy và dán link sau vào trình duyệt:</p>
                <p style="word-break: break-all; color: #666;">${resetLink}</p>
                <p><strong>Lưu ý:</strong> Link này sẽ hết hạn sau 1 giờ.</p>
                <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">Email này được gửi tự động, vui lòng không trả lời.</p>
            </div>
        `;

        // Gửi email
        const emailSent = await sendEmail(
            email,
            'Yêu cầu đặt lại mật khẩu - CKC Digital',
            emailHtml
        );

        if (emailSent) {
            res.json({
                success: true,
                message: 'Email đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư của bạn.'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Không thể gửi email. Vui lòng thử lại sau.'
            });
        }

    } catch (error) {
        console.error('Lỗi quên mật khẩu:', error);
        res.status(500).json({ success: false, message: "Lỗi server khi xử lý yêu cầu" });
    }
});

// API: Đặt lại mật khẩu với token
// URL: POST http://<IP>:3000/api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin!' });
        }

        if (newPassword.length < 6) {
            return res.json({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự!' });
        }

        // Tìm user với token hợp lệ và chưa hết hạn
        const users = await query(
            "SELECT * FROM Users WHERE ResetToken = ? AND ResetTokenExpiry > NOW()",
            [token]
        );

        if (users.length === 0) {
            return res.json({ 
                success: false, 
                message: 'Token không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu đặt lại mật khẩu lại.' 
            });
        }

        const user = users[0];

        // Cập nhật mật khẩu mới và xóa token
        await query(
            "UPDATE Users SET PasswordHash = ?, ResetToken = NULL, ResetTokenExpiry = NULL WHERE UserID = ?",
            [newPassword, user.UserID]
        );

        res.json({
            success: true,
            message: 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập với mật khẩu mới.'
        });

    } catch (error) {
        console.error('Lỗi đặt lại mật khẩu:', error);
        res.status(500).json({ success: false, message: "Lỗi server khi đặt lại mật khẩu" });
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
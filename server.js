const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000; // Node.js sẽ chạy ở cổng 3000

// Middleware
app.use(cors());
app.use(bodyParser.json());

// 1. Cấu hình kết nối Database (Kết nối vào XAMPP MySQL)
const db = mysql.createPool({
    host: process.env.DB_HOST,              // Host của database
    user: process.env.DB_USER,              // User của database
    password: process.env.DB_PASSWORD,      // Password của database
    database: process.env.DB_NAME,          // Tên database
    port: process.env.DB_PORT,              // Cổng kết nối (nếu khác cổng mặc định)
    connectionLimit: 10,
    queueLimit: 0
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

// API 1: Lấy danh sách sản phẩm (Home Screen)
// URL: http://<IP>:3000/api/products
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
            FROM products p
            LEFT JOIN productspecs ps ON p.ProductID = ps.ProductID
            WHERE p.IsActive = 1
        `;
        
        const products = await query(sql);

        // Xử lý ảnh null (Giống logic PHP cũ)
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

// API 2: Lấy danh mục (Side Menu)
// URL: http://<IP>:3000/api/categories
app.get('/api/categories', async (req, res) => {
    try {
        const sql = "SELECT categoryID, CategoryName, ParentID FROM categories WHERE IsActive = 1";
        const categories = await query(sql);
        
        res.json({
            success: true,
            data: categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

// API 3: Lấy chi tiết sản phẩm + Ảnh Gallery
// URL: http://<IP>:3000/api/products/:id
app.get('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;

        // Lấy thông tin cơ bản
        const sqlProduct = `
            SELECT p.*, ps.* FROM products p 
            LEFT JOIN productspecs ps ON p.ProductID = ps.ProductID
            WHERE p.ProductID = ?
        `;
        const products = await query(sqlProduct, [productId]);

        if (products.length === 0) {
            return res.status(404).json({ success: false, message: "Không tìm thấy sản phẩm" });
        }

        const product = products[0];

        // Lấy thư viện ảnh
        const sqlImages = "SELECT imageURL FROM productimages WHERE ProductID = ? ORDER BY SortOrder ASC";
        const images = await query(sqlImages, [productId]);
        
        // Gộp mảng ảnh vào object product
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
//Lấy đánh giá 

// API: Lấy đánh giá dựa trên OrderID (Bao gồm tên người dùng)
// URL: http://localhost:3000/api/reviews/order/:orderId
// API lấy review cho trang Chi tiết sản phẩm
app.get('/api/products/:id/reviews', async (req, res) => {
    try {
        const productId = req.params.id;
        const sql = `
            SELECT 
                r.ReviewID, 
                r.Rating, 
                r.Comment, 
                r.ReviewDate, 
                u.FullName as UserName
            FROM reviews r
            JOIN users u ON r.UserID = u.UserID
            JOIN OrderDetails od ON r.OrderID = od.OrderID
            WHERE od.ProductID = ?
            ORDER BY r.ReviewDate DESC
        `;
        const reviews = await query(sql, [productId]);
        res.json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

// API Đăng nhập
// URL: http://localhost:3000/api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { Email, Password } = req.body;

        // Tìm user theo email và password
        const sql = "SELECT UserID, FullName, Email, Phone, AvatarURL, RoleID FROM users WHERE Email = ? AND PasswordHash = ? AND IsActive = 1";
        const users = await query(sql, [Email, Password]);

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: "Email hoặc mật khẩu không chính xác" });
        }

        const user = users[0];
        // Xóa mật khẩu trước khi gửi về client để bảo mật
        delete user.PasswordHash;

        res.json({
            success: true,
            message: "Đăng nhập thành công",
            data: user
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server khi đăng nhập" });
    }
});

// API Đăng ký
// URL: http://localhost:3000/api/auth/register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { FullName, Email, Phone, Password } = req.body;

        // 1. Kiểm tra Email đã tồn tại chưa
        const checkUser = await query("SELECT * FROM users WHERE Email = ?", [Email]);
        if (checkUser.length > 0) {
            return res.status(400).json({ success: false, message: "Email này đã được sử dụng" });
        }

        // 2. Thêm người dùng mới (Lưu ý: Trong thực tế nên dùng thư viện bcrypt để hash password)
        const sql = `
            INSERT INTO users (FullName, Email, Phone, PasswordHash, RoleID, IsActive, RegistrationDate) 
            VALUES (?, ?, ?, ?, 2, 1, NOW())
        `;
        const result = await query(sql, [FullName, Email, Phone, Password]);

        res.json({
            success: true,
            message: "Đăng ký tài khoản thành công!",
            userId: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server khi đăng ký" });
    }
});

// API Đăng xuất
// URL: http://localhost:3000/api/auth/logout
app.post('/api/auth/logout', (req, res) => {
    // Phía client (Android) chỉ cần xóa Token hoặc thông tin User lưu trong SharedPreferences
    res.json({ success: true, message: "Đăng xuất thành công" });
});

app.get('/api/addresses/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        // Câu lệnh SQL lấy tất cả địa chỉ, ưu tiên IsDefault = 1 lên đầu
        const sql = `
            SELECT 
                AddressID, 
                UserID, 
                ReceiverName, 
                PhoneNumber, 
                StreetAddress, 
                City, 
                IsDefault 
            FROM addresses 
            WHERE UserID = ? 
            ORDER BY IsDefault DESC, AddressID DESC
        `;
        
        const addresses = await query(sql, [userId]);

        // Trả về trực tiếp mảng (List) để khớp với ApiService.kt trong Android
        res.json(addresses);

    } catch (error) {
        console.error("Lỗi lấy địa chỉ:", error);
        res.status(500).json({ success: false, message: "Lỗi server khi lấy địa chỉ" });
    }
});

// API: Xóa địa chỉ (Dùng cho chức năng xóa trong AddressListScreen)
// URL: http://localhost:3000/api/addresses/:addressId
app.delete('/api/addresses/:addressId', async (req, res) => {
    try {
        const addressId = req.params.addressId;
        const sql = "DELETE FROM addresses WHERE AddressID = ?";
        
        await query(sql, [addressId]);

        res.json({ 
            success: true, 
            message: "Xóa địa chỉ thành công" 
        });
    } catch (error) {
        console.error("Lỗi xóa địa chỉ:", error);
        res.status(500).json({ success: false, message: "Lỗi server khi xóa" });
    }
});

app.put('/api/addresses/:addressId', async (req, res) => {
    try {
        const addressId = req.params.addressId;
        const { ReceiverName, PhoneNumber, StreetAddress, City, IsDefault } = req.body;

        // Nếu đặt địa chỉ này làm mặc định, phải bỏ mặc định của các địa chỉ khác cùng UserID
        if (IsDefault === 1) {
            const getUserIdSql = "SELECT UserID FROM addresses WHERE AddressID = ?";
            const userRow = await query(getUserIdSql, [addressId]);
            if (userRow.length > 0) {
                await query("UPDATE addresses SET IsDefault = 0 WHERE UserID = ?", [userRow[0].UserID]);
            }
        }

        const sql = `
            UPDATE addresses 
            SET ReceiverName = ?, PhoneNumber = ?, StreetAddress = ?, City = ?, IsDefault = ?
            WHERE AddressID = ?
        `;
        await query(sql, [ReceiverName, PhoneNumber, StreetAddress, City, IsDefault, addressId]);

        res.json({ success: true, message: "Cập nhật địa chỉ thành công" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.get('/api/addresses/detail/:addressId', async (req, res) => {
    try {
        const sql = "SELECT * FROM addresses WHERE AddressID = ?";
        const results = await query(sql, [req.params.addressId]);
        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.status(404).json({ message: "Không tìm thấy địa chỉ" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.post('/api/addresses', async (req, res) => {
    try {
        const { UserID, ReceiverName, PhoneNumber, StreetAddress, City, IsDefault } = req.body;

        // Nếu đặt làm mặc định (IsDefault = 1), gỡ mặc định của các địa chỉ cũ
        if (IsDefault === 1) {
            await query("UPDATE addresses SET IsDefault = 0 WHERE UserID = ?", [UserID]);
        }

        const sql = `
            INSERT INTO addresses (UserID, ReceiverName, PhoneNumber, StreetAddress, City, IsDefault)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const result = await query(sql, [UserID, ReceiverName, PhoneNumber, StreetAddress, City, IsDefault]);

        res.json({ 
            success: true, 
            message: "Thêm địa chỉ thành công",
            insertId: result.insertId 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server khi thêm địa chỉ" });
    }
});

app.get('/api/cart/:userId', async (req, res) => {
    try {
        // SỬA LỖI: Đổi 'cart_items' thành 'cartitems' cho khớp với Database và API Add
        const sql = `
            SELECT c.CartItemID, c.ProductID, c.Quantity, p.ProductName, p.Price, p.ThumbnailURL 
            FROM cartitems c 
            JOIN products p ON c.ProductID = p.ProductID 
            WHERE c.UserID = ?`;
            
        const items = await query(sql, [req.params.userId]);
        
        // Log ra để kiểm tra xem server có lấy được data không
        console.log("Cart items for User " + req.params.userId + ":", items); 
        
        res.json({ success: true, data: items });
    } catch (error) { 
        console.error("Lỗi lấy giỏ hàng:", error); // Log lỗi chi tiết để debug
        res.status(500).json({ success: false, message: "Lỗi server" }); 
    }
});


app.post('/api/cart/add', async (req, res) => {
    const { userId, productId, quantity } = req.body;
    try {
        // Kiểm tra xem sản phẩm đã có trong giỏ hàng của User này chưa
        const checkSql = "SELECT * FROM cartitems WHERE UserID = ? AND ProductID = ?";
        const existing = await query(checkSql, [userId, productId]);

        if (existing.length > 0) {
            // Nếu đã có, cập nhật số lượng
            const updateSql = "UPDATE cartitems SET Quantity = Quantity + ? WHERE UserID = ? AND ProductID = ?";
            await query(updateSql, [quantity, userId, productId]);
        } else {
            // Nếu chưa có, thêm mới
            const insertSql = "INSERT INTO cartitems (UserID, ProductID, Quantity) VALUES (?, ?, ?)";
            await query(insertSql, [userId, productId, quantity]);
        }
        res.json({ success: true, message: "Đã lưu vào giỏ hàng hệ thống" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/cart/update', async (req, res) => {
    try {
        const { cartItemId, quantity } = req.body;
        
        // Cập nhật số lượng mới
        const sql = "UPDATE cartitems SET Quantity = ? WHERE CartItemID = ?";
        await query(sql, [quantity, cartItemId]);

        res.json({ success: true, message: "Đã cập nhật số lượng" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.delete('/api/cart/remove/:cartItemId', async (req, res) => {
    try {
        const cartItemId = req.params.cartItemId;
        
        const sql = "DELETE FROM cartitems WHERE CartItemID = ?";
        await query(sql, [cartItemId]);

        res.json({ success: true, message: "Đã xóa sản phẩm" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.put('/api/auth/update-profile/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const { FullName, Phone } = req.body;

        const sql = "UPDATE users SET FullName = ?, Phone = ? WHERE UserID = ?";
        await query(sql, [FullName, Phone, userId]);

        // Lấy lại thông tin user mới sau khi cập nhật
        const updatedUser = await query("SELECT UserID, FullName, Email, Phone, RoleID FROM users WHERE UserID = ?", [userId]);

        res.json({
            success: true,
            message: "Cập nhật thông tin thành công",
            data: updatedUser[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.put('/api/auth/change-password/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const { oldPassword, newPassword } = req.body;

        // Truy vấn kiểm tra mật khẩu cũ
        const user = await query("SELECT PasswordHash FROM users WHERE UserID = ?", [userId]);
        
        if (user.length === 0 || user[0].PasswordHash !== oldPassword) {
            return res.status(400).json({ success: false, message: "Mật khẩu hiện tại không khớp" });
        }

        // Cập nhật mật khẩu mới
        await query("UPDATE users SET PasswordHash = ? WHERE UserID = ?", [newPassword, userId]);

        res.json({ success: true, message: "Thành công" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi kết nối database" });
    }
});

app.get('/api/promotions', async (req, res) => {
    try {
        // Lấy các voucher đang kích hoạt (IsActive=1) và còn hạn (EndDate >= ngày hiện tại)
        const sql = `
            SELECT * FROM promotions 
            WHERE IsActive = 1 
            AND EndDate >= NOW()
            ORDER BY PromotionID DESC
        `;
        const promotions = await query(sql);
        
        res.json({
            success: true,
            data: promotions
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi lấy danh sách khuyến mãi" });
    }
});

app.get('/api/shipping-methods', async (req, res) => {
    try {
        // Giả sử tên bảng là ShippingMethods (dựa theo ảnh bạn gửi)
        const sql = "SELECT * FROM ShippingMethods ORDER BY Cost ASC";
        const methods = await query(sql);
        res.json({ success: true, data: methods });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

// API Tạo đơn hàng (Đã sửa lỗi mất chi tiết sản phẩm)
app.post('/api/orders', async (req, res) => {
    try {
        // 1. Nhận dữ liệu từ Android (Android gửi keys là chữ thường)
        const { 
            userId, 
            totalAmount, 
            shipAddress, 
            receiverName, 
            phoneNumber, 
            paymentMethodId, 
            shippingMethodId, 
            items // Danh sách sản phẩm: [{ productId, quantity, price }, ...]
        } = req.body;

        // Kiểm tra dữ liệu đầu vào
        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: "Giỏ hàng trống" });
        }

        // 2. Insert vào bảng ORDERS
        const sqlOrder = `
            INSERT INTO orders 
            (UserID, ReceiverName, PhoneNumber, OrderDate, TotalAmount, OrderStatus, ShipAddress, PaymentMethodID, ShippingMethodID, PaymentStatus)
            VALUES (?, ?, ?, NOW(), ?, 'Chờ xử lý', ?, ?, ?, 'Chưa thanh toán')
        `;

        const orderResult = await query(sqlOrder, [
            userId, 
            receiverName, 
            phoneNumber, 
            totalAmount, 
            shipAddress, 
            paymentMethodId, 
            shippingMethodId
        ]);
        
        const newOrderId = orderResult.insertId; // Lấy ID đơn hàng vừa tạo (VD: 17)

        // 3. Insert vào bảng ORDERDETAILS (Quan trọng)
        // Dùng vòng lặp để insert từng sản phẩm
        const sqlDetail = `
            INSERT INTO orderdetails (OrderID, ProductID, Quantity, UnitPrice, TotalPrice)
            VALUES (?, ?, ?, ?, ?)
        `;

        for (const item of items) {
            // Android gửi: item.productId, item.quantity, item.price
            // Tính thành tiền = số lượng * đơn giá
            const totalPrice = item.quantity * item.price; 

            await query(sqlDetail, [
                newOrderId, 
                item.productId, // Chú ý: dùng đúng tên trường Android gửi (thường là chữ thường)
                item.quantity, 
                item.price, 
                totalPrice
            ]);
        }

        const sqlClearCart = "DELETE FROM cartitems WHERE UserID = ?";
        await query(sqlClearCart, [userId]);

        res.json({ success: true, message: "Tạo đơn hàng thành công", orderId: newOrderId });

    } catch (e) {
        console.error("Lỗi tạo đơn hàng:", e);
        res.status(500).json({ success: false, message: "Lỗi server: " + e.message });
    }
});

app.get('/api/orders/user/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const sql = `
            SELECT 
                o.OrderID, o.OrderDate, o.TotalAmount, o.OrderStatus, 
                (SELECT p.ProductName FROM orderdetails od JOIN products p ON od.ProductID = p.ProductID WHERE od.OrderID = o.OrderID LIMIT 1) as ProductName,
                (SELECT p.ThumbnailURL FROM orderdetails od JOIN products p ON od.ProductID = p.ProductID WHERE od.OrderID = o.OrderID LIMIT 1) as ThumbnailURL,
                (SELECT SUM(Quantity) FROM orderdetails WHERE OrderID = o.OrderID) as TotalQuantity
            FROM orders o
            WHERE o.UserID = ?
            ORDER BY o.OrderID DESC
        `;
        const orders = await query(sql, [userId]);
        res.json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// File: server.js (hoặc controller xử lý đơn hàng)

app.get('/api/orders/detail/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;

        // CẬP NHẬT CÂU SELECT: Lấy thêm ReceiverName và PhoneNumber từ bảng orders
        const sqlInfo = `
            SELECT 
                o.OrderID, 
                o.OrderDate, 
                o.OrderStatus, 
                o.TotalAmount, 
                o.ShipAddress,
                o.ReceiverName,  -- Quan trọng: Lấy tên người nhận từ đơn hàng
                o.PhoneNumber,   -- Quan trọng: Lấy SĐT từ đơn hàng
                pm.MethodName as PaymentMethod,
                sm.MethodName as ShippingMethod
            FROM orders o
            LEFT JOIN paymentmethods pm ON o.PaymentMethodID = pm.PaymentMethodID
            LEFT JOIN shippingmethods sm ON o.ShippingMethodID = sm.ShippingMethodID
            WHERE o.OrderID = ?
        `;

        const infoResult = await query(sqlInfo, [orderId]);

        if (infoResult.length === 0) {
            return res.json({ success: false, message: "Không tìm thấy đơn hàng" });
        }

        // Lấy sản phẩm (giữ nguyên)
        const sqlItems = `
            SELECT od.*, p.ProductName, p.ThumbnailURL 
            FROM orderdetails od
            JOIN products p ON od.ProductID = p.ProductID
            WHERE od.OrderID = ?
        `;
        const itemsResult = await query(sqlItems, [orderId]);

        res.json({
            success: true,
            data: {
                orderInfo: infoResult[0],
                orderItems: itemsResult
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});
// --- WISHLIST APIS ---

// 1. Toggle Wishlist (Thêm vào hoặc Xóa khỏi yêu thích)
// URL: POST /api/wishlist/toggle
app.post('/api/wishlist/toggle', async (req, res) => {
    try {
        const { userId, productId } = req.body;
        
        // Kiểm tra xem đã like chưa
        const checkSql = "SELECT * FROM Wishlist WHERE UserID = ? AND ProductID = ?";
        const existing = await query(checkSql, [userId, productId]);

        if (existing.length > 0) {
            // Nếu có rồi -> Xóa (Unlike)
            await query("DELETE FROM Wishlist WHERE UserID = ? AND ProductID = ?", [userId, productId]);
            res.json({ success: true, message: "Đã xóa khỏi yêu thích", isFavorite: false });
        } else {
            // Nếu chưa có -> Thêm (Like)
            await query("INSERT INTO Wishlist (UserID, ProductID) VALUES (?, ?)", [userId, productId]);
            res.json({ success: true, message: "Đã thêm vào yêu thích", isFavorite: true });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

// 2. Lấy danh sách yêu thích của User
// URL: GET /api/wishlist/:userId
app.get('/api/wishlist/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const sql = `
            SELECT w.WishlistID, p.ProductID, p.ProductName, p.Price, p.ThumbnailURL 
            FROM Wishlist w
            JOIN Products p ON w.ProductID = p.ProductID
            WHERE w.UserID = ?
            ORDER BY w.AddedDate DESC
        `;
        const list = await query(sql, [userId]);
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

// 3. Kiểm tra trạng thái yêu thích của 1 sản phẩm (Để tô màu trái tim)
// URL: GET /api/wishlist/check/:userId/:productId
app.get('/api/wishlist/check/:userId/:productId', async (req, res) => {
    try {
        const { userId, productId } = req.params;
        const sql = "SELECT * FROM Wishlist WHERE UserID = ? AND ProductID = ?";
        const result = await query(sql, [userId, productId]);
        
        res.json({ success: true, isFavorite: result.length > 0 });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.get('/api/admin/dashboard-stats', async (req, res) => {
    try {
        // 1. Tính doanh thu ngày hôm nay (Chỉ tính các đơn chưa hủy)
        // Lưu ý: CURDATE() lấy ngày hiện tại của server MySQL
        const sqlRevenue = `
            SELECT SUM(TotalAmount) as dailyRevenue 
            FROM orders 
            WHERE DATE(OrderDate) = CURDATE() 
            AND OrderStatus != 'Đã hủy'
        `;
        
        // 2. Đếm số đơn đang "Chờ xử lý" (Tất cả, không chỉ hôm nay)
        const sqlPending = `
            SELECT COUNT(*) as pendingOrders 
            FROM orders 
            WHERE OrderStatus = 'Chờ xử lý'
        `;

        // 3. Đếm số đơn "Hoàn thành" trong ngày hôm nay
        const sqlCompletedToday = `
            SELECT COUNT(*) as completedOrders 
            FROM orders 
            WHERE OrderStatus = 'Hoàn thành' 
            AND DATE(OrderDate) = CURDATE()
        `;

        // Chạy song song 3 câu lệnh (Promise.all) cho nhanh
        const [revenueResult, pendingResult, completedResult] = await Promise.all([
            query(sqlRevenue),
            query(sqlPending),
            query(sqlCompletedToday)
        ]);

        res.json({
            success: true,
            data: {
                dailyRevenue: revenueResult[0].dailyRevenue || 0,
                pendingOrders: pendingResult[0].pendingOrders || 0,
                completedOrdersToday: completedResult[0].completedOrders || 0
            }
        });

    } catch (error) {
        console.error("Lỗi Dashboard Stats:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        // CẬP NHẬT SQL: Thêm 'o.ReceiverName' vào câu SELECT
        const sqlOrders = `
            SELECT o.OrderID, 
                   o.OrderDate, 
                   o.TotalAmount, 
                   o.OrderStatus as Status, -- Hoặc OrderStatus tùy alias bạn dùng
                   o.ReceiverName,          -- <--- QUAN TRỌNG: Lấy tên người nhận
                   u.FullName               -- Tên tài khoản (để dự phòng)
            FROM orders o
            LEFT JOIN users u ON o.UserID = u.UserID
            ORDER BY o.OrderDate DESC
        `;
        const orders = await query(sqlOrders);
        
        // ... (Phần map items giữ nguyên nếu có)

        res.json({ success: true, data: orders });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

// --- ADMIN API: Cập nhật trạng thái đơn hàng ---
app.put('/api/orders/:orderId/status', async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { status, cancelReason } = req.body; // cancelReason là tùy chọn

        // Kiểm tra xem status có hợp lệ không (Tùy chọn)
        const validStatuses = ['Chờ xử lý', 'Chờ lấy hàng', 'Đang giao hàng', 'Hoàn thành', 'Đã hủy'];
        if (!validStatuses.includes(status)) {
            // Mapping từ tên API (pending, shipping...) sang tiếng Việt nếu cần,
            // hoặc App gửi trực tiếp tiếng Việt. 
            // Ở code Android, Enum OrderStatus đang gửi "pending", "shipping"...
            // Nên ta cần map lại sang tiếng Việt để lưu vào DB (nếu DB lưu tiếng Việt).
        }

        // Mapping trạng thái từ APP (Tiếng Anh/Code) -> DB (Tiếng Việt)
        // Nếu App gửi tiếng Việt sẵn thì bỏ qua bước này.
        let dbStatus = status;
        switch(status) {
            case 'pending': dbStatus = 'Chờ xử lý'; break;
            case 'shipping': dbStatus = 'Đang giao hàng'; break;
            case 'completed': dbStatus = 'Hoàn thành'; break;
            case 'cancelled': dbStatus = 'Đã hủy'; break;
            // case 'pickup': dbStatus = 'Chờ lấy hàng'; break; // Nếu có
        }

        // Cập nhật vào DB
        const sql = "UPDATE orders SET OrderStatus = ? WHERE OrderID = ?";
        await query(sql, [dbStatus, orderId]);

        // Nếu trạng thái là 'Đã hủy' và có lý do, bạn có thể lưu lý do vào 1 bảng log 
        // hoặc cột CancelReason nếu bảng Orders có cột đó.
        if (dbStatus === 'Đã hủy' && cancelReason) {
            console.log(`Đơn hàng ${orderId} bị hủy với lý do: ${cancelReason}`);
            // await query("UPDATE orders SET CancelReason = ? WHERE OrderID = ?", [cancelReason, orderId]);
        }

        res.json({
            success: true,
            message: `Cập nhật trạng thái thành: ${dbStatus}`
        });

    } catch (error) {
        console.error("Lỗi cập nhật trạng thái:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.get('/api/products/:id/reviews', async (req, res) => {
    try {
        const productId = req.params.id;
        const sql = `
            SELECT
                r.ReviewID,
                r.Rating,
                r.Comment,
                r.ReviewDate,
                u.FullName as UserName
            FROM reviews r
            JOIN users u ON r.UserID = u.UserID
            JOIN OrderDetails od ON r.OrderID = od.OrderID
            WHERE od.ProductID = ?       
            ORDER BY r.ReviewDate DESC
        `;
        const reviews = await query(sql, [productId]);
        res.json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});           

app.post('/api/products/:id/reviews', async (req, res) => {
    try {
        const productId = req.params.id;
        const { userId, orderId, rating, comment } = req.body;
        const sql = `
            INSERT INTO reviews (ProductID, UserID, OrderID, Rating, Comment, ReviewDate)
            VALUES (?, ?, ?, ?, ?, NOW())`;
        await query(sql, [productId, userId, orderId, rating, comment]);
        res.json({ success: true, message: "Đánh giá đã được thêm thành công." });
    } catch (error) {
        console.error("Lỗi thêm đánh giá:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

// Khởi động server
app.listen(process.env.PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${process.env.PORT}`);
    console.log(`API Products: http://localhost:${process.env.PORT}/api/products`);
});
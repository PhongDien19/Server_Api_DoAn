const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000; 

app.use(cors());
app.use(bodyParser.json());

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    connectionLimit: 10,
    queueLimit: 0
});

const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

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

app.get('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;

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

        const sqlImages = "SELECT imageURL FROM productimages WHERE ProductID = ? ORDER BY SortOrder ASC";
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

app.post('/api/auth/login', async (req, res) => {
    try {
        const { Email, Password } = req.body;

        const sql = "SELECT UserID, FullName, Email, Phone, AvatarURL, RoleID FROM users WHERE Email = ? AND PasswordHash = ? AND IsActive = 1";
        const users = await query(sql, [Email, Password]);

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: "Email hoặc mật khẩu không chính xác" });
        }

        const user = users[0];
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

app.post('/api/auth/register', async (req, res) => {
    try {
        const { FullName, Email, Phone, Password } = req.body;

        const checkUser = await query("SELECT * FROM users WHERE Email = ?", [Email]);
        if (checkUser.length > 0) {
            return res.status(400).json({ success: false, message: "Email này đã được sử dụng" });
        }

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

app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true, message: "Đăng xuất thành công" });
});

app.get('/api/addresses/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

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

        res.json(addresses);

    } catch (error) {
        console.error("Lỗi lấy địa chỉ:", error);
        res.status(500).json({ success: false, message: "Lỗi server khi lấy địa chỉ" });
    }
});

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
        const sql = `
            SELECT c.CartItemID, c.ProductID, c.Quantity, p.ProductName, p.Price, p.ThumbnailURL 
            FROM cartitems c 
            JOIN products p ON c.ProductID = p.ProductID 
            WHERE c.UserID = ?`;
            
        const items = await query(sql, [req.params.userId]);
        
        console.log("Cart items for User " + req.params.userId + ":", items); 
        
        res.json({ success: true, data: items });
    } catch (error) { 
        console.error("Lỗi lấy giỏ hàng:", error);
        res.status(500).json({ success: false, message: "Lỗi server" }); 
    }
});


app.post('/api/cart/add', async (req, res) => {
    const { userId, productId, quantity } = req.body;
    try {
        const checkSql = "SELECT * FROM cartitems WHERE UserID = ? AND ProductID = ?";
        const existing = await query(checkSql, [userId, productId]);

        if (existing.length > 0) {
            const updateSql = "UPDATE cartitems SET Quantity = Quantity + ? WHERE UserID = ? AND ProductID = ?";
            await query(updateSql, [quantity, userId, productId]);
        } else {
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

        const user = await query("SELECT PasswordHash FROM users WHERE UserID = ?", [userId]);
        
        if (user.length === 0 || user[0].PasswordHash !== oldPassword) {
            return res.status(400).json({ success: false, message: "Mật khẩu hiện tại không khớp" });
        }

        await query("UPDATE users SET PasswordHash = ? WHERE UserID = ?", [newPassword, userId]);

        res.json({ success: true, message: "Thành công" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi kết nối database" });
    }
});

app.get('/api/promotions', async (req, res) => {
    try {
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
        const sql = "SELECT * FROM ShippingMethods ORDER BY Cost ASC";
        const methods = await query(sql);
        res.json({ success: true, data: methods });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { 
            userId, 
            totalAmount, 
            shipAddress, 
            receiverName, 
            phoneNumber, 
            paymentMethodId, 
            shippingMethodId, 
            items
        } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: "Giỏ hàng trống" });
        }

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
        
        const newOrderId = orderResult.insertId;

        const sqlDetail = `
            INSERT INTO orderdetails (OrderID, ProductID, Quantity, UnitPrice, TotalPrice)
            VALUES (?, ?, ?, ?, ?)
        `;

        for (const item of items) {
            const totalPrice = item.quantity * item.price; 

            await query(sqlDetail, [
                newOrderId, 
                item.productId,
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

app.get('/api/orders/detail/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;

        const sqlInfo = `
            SELECT 
                o.OrderID, 
                o.OrderDate, 
                o.OrderStatus, 
                o.TotalAmount, 
                o.ShipAddress,
                o.ReceiverName,
                o.PhoneNumber,
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
app.post('/api/wishlist/toggle', async (req, res) => {
    try {
        const { userId, productId } = req.body;
        
        const checkSql = "SELECT * FROM Wishlist WHERE UserID = ? AND ProductID = ?";
        const existing = await query(checkSql, [userId, productId]);

        if (existing.length > 0) {
            await query("DELETE FROM Wishlist WHERE UserID = ? AND ProductID = ?", [userId, productId]);
            res.json({ success: true, message: "Đã xóa khỏi yêu thích", isFavorite: false });
        } else {
            await query("INSERT INTO Wishlist (UserID, ProductID) VALUES (?, ?)", [userId, productId]);
            res.json({ success: true, message: "Đã thêm vào yêu thích", isFavorite: true });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

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
        const sqlRevenue = `
            SELECT SUM(TotalAmount) as dailyRevenue 
            FROM orders 
            WHERE DATE(OrderDate) = CURDATE() 
            AND OrderStatus != 'Đã hủy'
        `;
        
        const sqlPending = `
            SELECT COUNT(*) as pendingOrders 
            FROM orders 
            WHERE OrderStatus = 'Chờ xử lý'
        `;

        const sqlCompletedToday = `
            SELECT COUNT(*) as completedOrders 
            FROM orders 
            WHERE OrderStatus = 'Hoàn thành' 
            AND DATE(OrderDate) = CURDATE()
        `;

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
        const sqlOrders = `
            SELECT o.OrderID, 
                   o.OrderDate, 
                   o.TotalAmount, 
                   o.OrderStatus as Status,
                   o.ReceiverName,
                   u.FullName
            FROM orders o
            LEFT JOIN users u ON o.UserID = u.UserID
            ORDER BY o.OrderDate DESC
        `;
        const orders = await query(sqlOrders);
        
        res.json({ success: true, data: orders });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

app.put('/api/orders/:orderId/status', async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { status, cancelReason } = req.body;

        const validStatuses = ['Chờ xử lý', 'Chờ lấy hàng', 'Đang giao hàng', 'Hoàn thành', 'Đã hủy'];
        if (!validStatuses.includes(status)) {
        }

        let dbStatus = status;
        switch(status) {
            case 'pending': dbStatus = 'Chờ xử lý'; break;
            case 'shipping': dbStatus = 'Đang giao hàng'; break;
            case 'completed': dbStatus = 'Hoàn thành'; break;
            case 'cancelled': dbStatus = 'Đã hủy'; break;
        }

        const sql = "UPDATE orders SET OrderStatus = ? WHERE OrderID = ?";
        await query(sql, [dbStatus, orderId]);

        if (dbStatus === 'Đã hủy' && cancelReason) {
            console.log(`Đơn hàng ${orderId} bị hủy với lý do: ${cancelReason}`);
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

app.listen(process.env.PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${process.env.PORT}`);
    console.log(`API Products: http://localhost:${process.env.PORT}/api/products`);
});
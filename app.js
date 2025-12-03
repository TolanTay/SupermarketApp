require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();
const path = require('path');

// Import controllers
const AuthController = require('./controllers/AuthController');
const CartController = require('./controllers/CartController');
const OrderController = require('./controllers/OrderController');
const PageController = require('./controllers/PageController');
const ProductController = require('./controllers/ProductController');
const AdminAnalyticsController = require('./controllers/AdminAnalyticsController');
const UserController = require('./controllers/UserController');
const FavoriteController = require('./controllers/FavoriteController');
const OrderItemController = require('./controllers/OrderItemController');

// Import middleware
const { checkAuthenticated, checkAdmin } = require('./middleware/auth');

// Multer for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    const short = safeName.length > 120 ? safeName.slice(-120) : safeName;
    cb(null, `${Date.now()}-${short}`);
  }
});
const upload = multer({ storage });

// parse bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// sessions & flash
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// Routes
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/shopping');
  return PageController.showHome(req, res);
});

// Auth
app.get('/register', AuthController.showRegister);
app.post('/register', AuthController.register);
app.get('/login', AuthController.showLogin);
app.post('/login', AuthController.login);
app.get('/logout', AuthController.logout);
app.get('/profile', checkAuthenticated, UserController.profile);
app.post('/profile', checkAuthenticated, upload.single('avatar'), UserController.updateProfile);

// Products / shopping
app.get('/shopping', checkAuthenticated, ProductController.getShoppingProducts);
app.get('/product/:id', checkAuthenticated, ProductController.getProductById);
// favourite toggle
app.post('/favorite/:id', checkAuthenticated, FavoriteController.toggle);
app.get('/favorites', checkAuthenticated, FavoriteController.listForUser);

app.get('/addProduct', checkAuthenticated, checkAdmin, ProductController.showAddProduct);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.addProduct);
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.showUpdateProduct);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.updateProduct);
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.deleteProduct);

// Cart
app.get('/cart', checkAuthenticated, CartController.viewCart);
app.post('/add-to-cart/:id', checkAuthenticated, CartController.addToCart);
app.post('/cart/update/:id', checkAuthenticated, CartController.updateItem);
app.post('/cart/delete/:id', checkAuthenticated, CartController.removeItem);

// Checkout / Orders
app.get('/checkout', checkAuthenticated, OrderController.checkoutView);
app.post('/checkout/confirm', checkAuthenticated, OrderController.confirmPurchase);
app.get('/history', checkAuthenticated, OrderController.purchaseHistory);
app.get('/orders/:orderId/items', checkAuthenticated, OrderItemController.listByOrder);

// Admin routes
app.get('/admin/analytics', checkAuthenticated, checkAdmin, AdminAnalyticsController.dashboard);
app.get('/admin/users', checkAuthenticated, checkAdmin, UserController.list);
app.post('/admin/users/create', checkAuthenticated, checkAdmin, UserController.create);
app.post('/admin/users/update/:id', checkAuthenticated, checkAdmin, UserController.update);
app.post('/admin/users/delete/:id', checkAuthenticated, checkAdmin, UserController.delete);
app.get('/admin/users/:id/profile', checkAuthenticated, checkAdmin, UserController.adminProfile);
app.post('/admin/users/:id/profile', checkAuthenticated, checkAdmin, upload.single('avatar'), UserController.adminUpdateProfile);
app.get('/admin/orders', checkAuthenticated, checkAdmin, OrderController.adminOrderHistory);
app.get('/admin/orders/export', checkAuthenticated, checkAdmin, OrderController.adminDownloadOrders);
// Admin order maintenance
app.post('/admin/orders/:orderId/delete', checkAuthenticated, checkAdmin, OrderController.adminDeleteOrder);
app.post('/admin/orders/:orderId/items/:itemId/delete', checkAuthenticated, checkAdmin, OrderController.adminDeleteOrderItem);
app.post('/admin/orders/delete-all', checkAuthenticated, checkAdmin, OrderController.adminDeleteAllOrders);
app.get('/admin/orders/:orderId/edit', checkAuthenticated, checkAdmin, OrderController.adminEditOrderForm);
app.post('/admin/orders/:orderId/edit', checkAuthenticated, checkAdmin, OrderController.adminUpdateOrder);

// Static & views
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
const NetsQrService = require('./services/NetsQrService');
const NetsTransaction = require('./models/NetsTransaction');
const WalletController = require('./controllers/WalletController');
const RefundController = require('./controllers/RefundController');

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

// Keep wallet balance fresh for navbar display
app.use((req, res, next) => {
  if (!req.session || !req.session.user) return next();
  const uid = req.session.user.id;
  if (!uid) return next();
  const db = require('./db');
  db.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [uid], (err, rows) => {
    if (!err && rows && rows[0]) {
      req.session.user.wallet_balance = Number(rows[0].wallet_balance || 0);
    }
    next();
  });
});

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
app.post('/checkout/confirm', checkAuthenticated, OrderController.startNetsQr);
app.post('/checkout/wallet', checkAuthenticated, OrderController.payWithWallet);
app.post('/api/paypal/create-order', checkAuthenticated, OrderController.createPaypalOrder);
app.post('/api/paypal/capture-order', checkAuthenticated, OrderController.capturePaypalOrder);
app.post('/stripe/create-session', checkAuthenticated, OrderController.createStripeSession);
app.get('/stripe/success', checkAuthenticated, OrderController.stripeSuccess);
app.get('/stripe/cancel', checkAuthenticated, OrderController.stripeCancel);
app.get('/nets-qr/success', checkAuthenticated, OrderController.finalizeNetsQr);
app.get('/nets-qr/fail', checkAuthenticated, (req, res) => {
  const pending = req.session && req.session.netsPending;
  if (pending && pending.txn_retrieval_ref) {
    NetsTransaction.updateByTxnRef(pending.txn_retrieval_ref, { status: 'failed' }, (err) => {
      if (err) console.error('nets-qr/fail update error', err);
    });
  }
  if (req.session) req.session.netsPending = null;
  res.render('netsTxnFailStatus', { message: 'Transaction Failed. Please try again.', user: req.session.user });
});

// Server-Sent Events (SSE) endpoint for NETS payment status
app.get('/sse/payment-status/:txnRetrievalRef', checkAuthenticated, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;
  const pending = req.session && req.session.netsPending;
  if (!pending || pending.txn_retrieval_ref !== txnRetrievalRef) {
    res.write(`data: ${JSON.stringify({ fail: true, error: 'Invalid transaction reference' })}\n\n`);
    return res.end();
  }

  let pollCount = 0;
  const maxPolls = 60; // 5 minutes if polling every 5s
  let frontendTimeoutStatus = 0;

  const interval = setInterval(async () => {
    pollCount++;
    try {
      const response = await NetsQrService.queryStatus({
        txn_retrieval_ref: txnRetrievalRef,
        frontend_timeout_status: frontendTimeoutStatus
      });

      res.write(`data: ${JSON.stringify(response)}\n\n`);
      const resData = response && response.result && response.result.data;

      if (resData && resData.response_code === '00' && resData.txn_status === 1) {
        NetsTransaction.updateByTxnRef(txnRetrievalRef, {
          status: 'success',
          response_code: resData.response_code,
          network_status: resData.network_status,
          txn_status: resData.txn_status,
          raw_response: JSON.stringify(response)
        }, (err) => {
          if (err) console.error('NETS status update error', err);
        });
        res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
        clearInterval(interval);
        return res.end();
      }

      if (frontendTimeoutStatus === 1 && resData && (resData.response_code !== '00' || resData.txn_status === 2)) {
        NetsTransaction.updateByTxnRef(txnRetrievalRef, {
          status: 'failed',
          response_code: resData.response_code,
          network_status: resData.network_status,
          txn_status: resData.txn_status,
          raw_response: JSON.stringify(response)
        }, (err) => {
          if (err) console.error('NETS status update error', err);
        });
        res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
        clearInterval(interval);
        return res.end();
      }
    } catch (err) {
      clearInterval(interval);
      NetsTransaction.updateByTxnRef(txnRetrievalRef, {
        status: 'error',
        error_message: err.message
      }, (uErr) => {
        if (uErr) console.error('NETS status update error', uErr);
      });
      res.write(`data: ${JSON.stringify({ fail: true, error: err.message })}\n\n`);
      return res.end();
    }

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      frontendTimeoutStatus = 1;
      NetsTransaction.updateByTxnRef(txnRetrievalRef, {
        status: 'timeout',
        error_message: 'Timeout'
      }, (err) => {
        if (err) console.error('NETS status update error', err);
      });
      res.write(`data: ${JSON.stringify({ fail: true, error: 'Timeout' })}\n\n`);
      return res.end();
    }
  }, 5000);

  req.on('close', () => clearInterval(interval));
});
app.get('/history', checkAuthenticated, OrderController.purchaseHistory);
app.get('/orders/:orderId/items', checkAuthenticated, OrderItemController.listByOrder);
app.post('/refunds/:orderId', checkAuthenticated, RefundController.create);
app.get('/wallet', checkAuthenticated, WalletController.show);
app.post('/wallet/topup/nets', checkAuthenticated, WalletController.topupNets);
app.post('/wallet/topup/admin', checkAuthenticated, WalletController.adminTopup);
app.post('/api/paypal/topup/create-order', checkAuthenticated, WalletController.createPaypalTopup);
app.post('/api/paypal/topup/capture-order', checkAuthenticated, WalletController.capturePaypalTopup);

// Admin routes
app.get('/admin/analytics', checkAuthenticated, checkAdmin, AdminAnalyticsController.dashboard);
app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
  res.render('admin/dashboard', { user: req.session.user, messages: req.flash() });
});
app.get('/admin/users', checkAuthenticated, checkAdmin, UserController.list);
app.post('/admin/users/create', checkAuthenticated, checkAdmin, UserController.create);
app.post('/admin/users/update/:id', checkAuthenticated, checkAdmin, UserController.update);
app.post('/admin/users/delete/:id', checkAuthenticated, checkAdmin, UserController.delete);
app.get('/admin/users/:id/profile', checkAuthenticated, checkAdmin, UserController.adminProfile);
app.post('/admin/users/:id/profile', checkAuthenticated, checkAdmin, upload.single('avatar'), UserController.adminUpdateProfile);
app.get('/admin/orders', checkAuthenticated, checkAdmin, OrderController.adminOrderHistory);
app.get('/admin/orders/export', checkAuthenticated, checkAdmin, OrderController.adminDownloadOrders);
app.post('/admin/orders/:orderId/refund/paypal', checkAuthenticated, checkAdmin, OrderController.adminRefundPaypal);
app.post('/admin/orders/:orderId/refund/wallet', checkAuthenticated, checkAdmin, OrderController.adminRefundWalletForNets);
app.post('/admin/orders/:orderId/refund/request/approve', checkAuthenticated, checkAdmin, RefundController.adminApprove);
app.post('/admin/orders/:orderId/refund/request/reject', checkAuthenticated, checkAdmin, RefundController.adminReject);
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

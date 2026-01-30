const db = require('../db');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const InvoiceService = require('../services/InvoiceService');
const OrderItem = require('../models/OrderItem');
const NetsQrService = require('../services/NetsQrService');
const PaypalService = require('../services/PaypalService');
const PaypalTransaction = require('../models/PaypalTransaction');
const StripeService = require('../services/StripeService');
const StripeTransaction = require('../models/StripeTransaction');
const Wallet = require('../models/Wallet');
const RefundRequest = require('../models/RefundRequest');
const NetsTransaction = require('../models/NetsTransaction');

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const WALLET_PIN_THRESHOLD = 50;

const getOrderItemsFromCart = (uid, cb) => {
  Cart.getUserCart(uid, (err, rows) => {
    if (err) return cb(err);
    if (!rows || rows.length === 0) return cb(null, [], 0);

    const productIds = Array.from(new Set(rows.map(r => r.productId)));
    const placeholders = productIds.map(() => '?').join(',');
    const sql = `SELECT id, price, discount_rate FROM products WHERE id IN (${placeholders})`;

    db.query(sql, productIds, (e, prodRows) => {
      if (e) return cb(e);

      const discMap = {};
      const priceMap = {};
      prodRows.forEach(p => {
        discMap[p.id] = Number(p.discount_rate || 0);
        priceMap[p.id] = Number(p.price || 0);
      });

      const grouped = new Map();
      rows.forEach(r => {
        const pid = r.productId;
        if (grouped.has(pid)) {
          grouped.get(pid).quantity += Number(r.quantity);
        } else {
          grouped.set(pid, {
            productId: pid,
            productName: r.productName,
            quantity: Number(r.quantity),
            price: Number(r.price)
          });
        }
      });

      const items = Array.from(grouped.values()).map(g => {
        const base_price = round2(priceMap[g.productId] != null ? priceMap[g.productId] : g.price);
        const discount_rate = discMap[g.productId] != null ? Number(discMap[g.productId]) : 0;
        const unit_price_after_discount = round2(base_price * (1 - (discount_rate/100)));
        const subtotal = round2(unit_price_after_discount * g.quantity);
        return {
          productId: g.productId,
          productName: g.productName,
          quantity: g.quantity,
          base_price,
          discount_rate,
          unit_price_after_discount,
          subtotal
        };
      });

      const total = round2(items.reduce((s,i) => s + i.subtotal, 0));
      return cb(null, items, total);
    });
  });
};

const OrderController = {
  // render checkout page (reads from cart model)
  checkoutView: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');
    Cart.getUserCart(uid, (err, rows) => {
      if (err) {
        console.error('checkoutView DB error', err);
        req.flash('error', 'Database error');
        return res.redirect('/shopping');
      }
      // Group by productId for display (combine duplicate products)
      const map = new Map();
      (rows || []).forEach(r => {
        const pid = r.productId;
        if (map.has(pid)) {
          const existing = map.get(pid);
          existing.qty += r.quantity;
          existing.subtotal = round2(existing.price * existing.qty);
        } else {
          map.set(pid, {
            productId: pid,
            name: r.productName,
            image: r.image,
            qty: r.quantity,
            quantity: r.quantity,
            price: Number(r.price),
            subtotal: round2(Number(r.price) * Number(r.quantity))
          });
        }
      });
      const items = Array.from(map.values());
      const total = round2(items.reduce((s,i) => s + i.subtotal, 0));
      Wallet.getBalance(uid, (bErr, balance) => {
        if (bErr) console.error('checkoutView wallet error', bErr);
        const walletPinRequired = total >= WALLET_PIN_THRESHOLD;
        res.render('checkout', { cartItems: items, total, walletBalance: balance || 0, walletPinRequired, user: req.session.user, messages: req.flash() });
      });
    });
  },

  // Start NETS QR flow: request QR, store pending order, render QR page
  startNetsQr: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');

    getOrderItemsFromCart(uid, async (err, items, total) => {
      if (err) {
        console.error('startNetsQr - cart error', err);
        req.flash('error', 'Database error while reading cart');
        return res.redirect('/checkout');
      }
      if (!items.length) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/checkout');
      }

      try {
        const txn_id = process.env.NETS_TXN_ID || 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b';
        const response = await NetsQrService.requestQr({
          txn_id,
          amt_in_dollars: Number(total.toFixed(2)),
          notify_mobile: 0
        });
        const data = response && response.result && response.result.data;
        if (!data || !data.qr_code || !data.txn_retrieval_ref) {
          req.flash('error', 'Failed to generate NETS QR.');
          return res.redirect('/checkout');
        }

        req.session.netsPending = {
          type: 'order',
          items,
          total,
          txn_id,
          txn_retrieval_ref: data.txn_retrieval_ref,
          txn_nets_qr_id: data.txn_nets_qr_id
        };

        NetsTransaction.createPending({
          userId: uid,
          txn_id,
          txn_retrieval_ref: data.txn_retrieval_ref,
          txn_nets_qr_id: data.txn_nets_qr_id,
          amount: total,
          status: 'pending',
          response_code: data.response_code,
          network_status: data.network_status,
          txn_status: data.txn_status,
          raw_response: JSON.stringify(response)
        }, (logErr, netsTxnId) => {
          if (logErr) console.error('startNetsQr - log transaction error', logErr);
          if (req.session && req.session.netsPending) {
            req.session.netsPending.netsTxnId = netsTxnId;
          }
        });

        return res.render('nets-qr', {
          qrCodeBase64: data.qr_code,
          txnRetrievalRef: data.txn_retrieval_ref,
          total,
          user: req.session.user
        });
      } catch (apiErr) {
        console.error('startNetsQr - NETS request error', apiErr);
        req.flash('error', 'Failed to connect to NETS QR service.');
        return res.redirect('/checkout');
      }
    });
  },

  // Finalize NETS QR: create order + order_items or wallet top-up, then clear cart
  finalizeNetsQr: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');
    const pending = req.session.netsPending;
    if (!pending || !pending.items || !pending.items.length) {
      if (pending && pending.type === 'wallet_topup') {
        const amount = Number(pending.amount || 0);
        return Wallet.credit(uid, amount, {
          type: 'topup',
          method: 'nets',
          status: 'completed',
          note: 'NETS QR top-up'
        }, (wErr) => {
          if (wErr) console.error('wallet topup finalize error', wErr);
          if (pending.txn_retrieval_ref) {
            NetsTransaction.updateByTxnRef(pending.txn_retrieval_ref, { status: 'success' }, () => {});
          }
          Wallet.getBalance(uid, (bErr, balance) => {
            if (!bErr && req.session && req.session.user) {
              req.session.user.wallet_balance = Number(balance || 0);
            }
          });
          req.session.netsPending = null;
          return res.render('netsTxnSuccessStatus', { message: 'Wallet top-up completed.', user: req.session.user });
        });
      }
      req.flash('error', 'No pending NETS payment found.');
      return res.redirect('/checkout');
    }

    const isTest = req.session.user && req.session.user.role === 'admin';
    Order.createOrderWithItems(uid, pending.items, pending.total, isTest, (orderErr, orderId) => {
      if (orderErr) {
        console.error('finalizeNetsQr - createOrderWithItems error', orderErr);
        req.flash('error', 'Failed to create order');
        return res.redirect('/checkout');
      }

      Cart.clearCart(uid, (clearErr) => {
        if (clearErr) {
          console.error('finalizeNetsQr - clearCart error', clearErr);
          req.flash('error', 'Order created but failed to clear cart. Please contact support.');
          return res.redirect('/checkout');
        }

        if (pending.netsTxnId) {
          NetsTransaction.attachOrder(pending.netsTxnId, orderId, (linkErr) => {
            if (linkErr) console.error('finalizeNetsQr - attachOrder error', linkErr);
          });
        }
        if (pending.txn_retrieval_ref) {
          NetsTransaction.attachOrderByTxnRef(pending.txn_retrieval_ref, orderId, (linkErr) => {
            if (linkErr) console.error('finalizeNetsQr - attachOrderByTxnRef error', linkErr);
          });
        }
        if (pending.txn_retrieval_ref) {
          NetsTransaction.updateByTxnRef(pending.txn_retrieval_ref, {
            status: 'success'
          }, (updErr) => {
            if (updErr) console.error('finalizeNetsQr - update status error', updErr);
          });
        }
        const orderObj = { id: orderId, total: pending.total };
        if (isTest) {
          req.session.netsPending = null;
          return res.render('netsTxnSuccessStatus', { message: 'Transaction Successful!', orderId, user: req.session.user });
        }
        const html = InvoiceService.formatHtml(orderObj, pending.items);
        InvoiceService.save(uid, html, (invErr) => {
          if (invErr) console.error('Failed to save invoice:', invErr);
          req.session.netsPending = null;
          return res.render('netsTxnSuccessStatus', { message: 'Transaction Successful!', orderId, user: req.session.user });
        });
      });
    });
  },

  payWithWallet: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');
    getOrderItemsFromCart(uid, (err, items, total) => {
      if (err) {
        console.error('payWithWallet - cart error', err);
        req.flash('error', 'Database error while reading cart');
        return res.redirect('/checkout');
      }
      if (!items.length) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/checkout');
      }

      const processWalletPayment = () => {
        Wallet.debit(uid, total, { type: 'payment', method: 'wallet', status: 'completed', note: 'Wallet payment' }, (wErr) => {
          if (wErr) {
            if (wErr.message === 'INSUFFICIENT_FUNDS') {
              Wallet.logFailure(uid, total, {
                type: 'payment',
                method: 'wallet',
                status: 'failed',
                note: 'Insufficient wallet balance'
              }, (logErr) => {
                if (logErr) console.error('wallet failure log error', logErr);
              });
              req.flash('error', 'Insufficient wallet balance.');
            } else {
              Wallet.logFailure(uid, total, {
                type: 'payment',
                method: 'wallet',
                status: 'failed',
                note: 'Wallet payment failed'
              }, (logErr) => {
                if (logErr) console.error('wallet failure log error', logErr);
              });
              console.error('payWithWallet wallet error', wErr);
              req.flash('error', 'Failed to charge wallet.');
            }
            return res.redirect('/checkout');
          }
          Wallet.getBalance(uid, (bErr, balance) => {
            if (!bErr && req.session && req.session.user) {
              req.session.user.wallet_balance = Number(balance || 0);
            }
          });
  
          const isTest = req.session.user && req.session.user.role === 'admin';
          Order.createOrderWithItems(uid, items, total, isTest, (orderErr, orderId) => {
            if (orderErr) {
              console.error('payWithWallet - createOrderWithItems error', orderErr);
              Wallet.credit(uid, total, {
                type: 'refund',
                method: 'wallet',
                status: 'completed',
                note: 'Auto-refund after order failure'
              }, (rErr) => {
                if (rErr) console.error('payWithWallet refund error', rErr);
              });
              req.flash('error', 'Failed to create order');
              return res.redirect('/checkout');
            }
  
            Wallet.attachOrderToLatestPayment(uid, total, orderId, (aErr) => {
              if (aErr) console.error('payWithWallet - attach wallet order error', aErr);
            });
  
            Cart.clearCart(uid, (clearErr) => {
              if (clearErr) {
                console.error('payWithWallet - clearCart error', clearErr);
                req.flash('error', 'Order created but failed to clear cart. Please contact support.');
                return res.redirect('/checkout');
              }
  
            const orderObj = { id: orderId, total };
            if (isTest) {
              req.flash('success', 'Wallet payment completed. Order #' + orderId);
              return res.redirect('/history');
            }
            const html = InvoiceService.formatHtml(orderObj, items);
            InvoiceService.save(uid, html, (invErr) => {
              if (invErr) console.error('Failed to save invoice:', invErr);
              req.flash('success', 'Wallet payment completed. Order #' + orderId);
              return res.redirect('/history');
            });
            });
          });
        });
      };

      if (total >= WALLET_PIN_THRESHOLD) {
        const pin = String(req.body.wallet_pin || '').trim();
        if (!/^\d{4}$/.test(pin)) {
          req.flash('error', 'Wallet PIN is required for this amount.');
          return res.redirect('/checkout');
        }
        const User = require('../models/User');
        return User.verifyWalletPin(uid, pin, (pinErr, ok) => {
          if (pinErr || !ok) {
            req.flash('error', 'Invalid wallet PIN.');
            return res.redirect('/checkout');
          }
          return processWalletPayment();
        });
      }

      return processWalletPayment();
    });
  },

  createPaypalOrder: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    getOrderItemsFromCart(uid, async (err, items, total) => {
      if (err) {
        console.error('createPaypalOrder - cart error', err);
        return res.status(500).json({ error: 'Failed to read cart' });
      }
      if (!items.length) return res.status(400).json({ error: 'Cart is empty' });

      try {
        const order = await PaypalService.createOrder(total);
        if (!order || !order.id) {
          return res.status(500).json({ error: 'Failed to create PayPal order' });
        }
        req.session.paypalPending = { items, total };
        return res.json({ id: order.id });
      } catch (e) {
        console.error('createPaypalOrder error', e);
        return res.status(500).json({ error: 'PayPal create order failed' });
      }
    });
  },

  capturePaypalOrder: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { orderID } = req.body;
    if (!orderID) return res.status(400).json({ error: 'Missing orderID' });

    const pending = req.session.paypalPending;
    if (!pending || !pending.items || !pending.items.length) {
      return res.status(400).json({ error: 'No pending PayPal checkout' });
    }

    PaypalService.captureOrder(orderID).then((capture) => {
      if (!capture || capture.status !== 'COMPLETED') {
        req.session.paypalPending = null;
        return res.status(400).json({ error: 'Payment not completed', details: capture });
      }

      const isTest = req.session.user && req.session.user.role === 'admin';
      Order.createOrderWithItems(uid, pending.items, pending.total, isTest, (orderErr, orderId) => {
        if (orderErr) {
          console.error('capturePaypalOrder - createOrderWithItems error', orderErr);
          return res.status(500).json({ error: 'Failed to create order' });
        }

        Cart.clearCart(uid, (clearErr) => {
          if (clearErr) {
            console.error('capturePaypalOrder - clearCart error', clearErr);
            return res.status(500).json({ error: 'Order created but failed to clear cart' });
          }

          const purchaseUnit = capture.purchase_units && capture.purchase_units[0];
          const captureInfo = purchaseUnit && purchaseUnit.payments && purchaseUnit.payments.captures && purchaseUnit.payments.captures[0];
          const amountInfo = captureInfo && captureInfo.amount ? captureInfo.amount : { value: pending.total, currency_code: 'SGD' };

          PaypalTransaction.create({
            userId: uid,
            orderId,
            paypal_order_id: capture.id,
            capture_id: captureInfo && captureInfo.id,
            payer_id: capture.payer && capture.payer.payer_id,
            payer_email: capture.payer && capture.payer.email_address,
            amount: Number(amountInfo.value),
            currency: amountInfo.currency_code || 'SGD',
            status: capture.status,
            refund_status: 'none',
            raw_response: JSON.stringify(capture)
          }, (logErr) => {
            if (logErr) console.error('capturePaypalOrder - log transaction error', logErr);
            req.session.paypalPending = null;
            if (isTest) return res.json({ success: true, orderId });
            const orderObj = { id: orderId, total: pending.total };
            const html = InvoiceService.formatHtml(orderObj, pending.items);
            InvoiceService.save(uid, html, (invErr) => {
              if (invErr) console.error('Failed to save invoice:', invErr);
              return res.json({ success: true, orderId });
            });
          });
        });
      });
    }).catch((err) => {
      console.error('capturePaypalOrder error', err);
      req.session.paypalPending = null;
      return res.status(500).json({ error: 'PayPal capture failed' });
    });
  },

  createStripeSession: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');
    if (!process.env.STRIPE_SECRET_KEY) {
      req.flash('error', 'Stripe is not configured.');
      return res.redirect('/checkout');
    }
    getOrderItemsFromCart(uid, async (err, items, total) => {
      if (err) {
        console.error('createStripeSession - cart error', err);
        req.flash('error', 'Failed to read cart');
        return res.redirect('/checkout');
      }
      if (!items.length) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/checkout');
      }
      if (Number(total) <= 0) {
        req.flash('error', 'Invalid order total.');
        return res.redirect('/checkout');
      }

      try {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const session = await StripeService.createCheckoutSession({
          items,
          successUrl: `${baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${baseUrl}/stripe/cancel`,
          metadata: { userId: String(uid), orderTotal: String(total) }
        });
        req.session.stripePending = { items, total };
        return res.redirect(303, session.url);
      } catch (e) {
        console.error('createStripeSession error', e);
        req.flash('error', 'Stripe checkout failed. Please try again.');
        return res.redirect('/checkout');
      }
    });
  },

  stripeSuccess: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');
    const sessionId = req.query.session_id;
    if (!sessionId) {
      req.flash('error', 'Missing Stripe session.');
      return res.redirect('/checkout');
    }

    StripeService.retrieveCheckoutSession(sessionId).then((session) => {
      if (!session || session.payment_status !== 'paid') {
        req.flash('error', 'Stripe payment not completed.');
        return res.redirect('/checkout');
      }

      const pending = req.session.stripePending;
      const usePending = pending && pending.items && pending.items.length;
      const handleOrder = (items, total) => {
        const isTest = req.session.user && req.session.user.role === 'admin';
        Order.createOrderWithItems(uid, items, total, isTest, (orderErr, orderId) => {
          if (orderErr) {
            console.error('stripeSuccess - createOrderWithItems error', orderErr);
            req.flash('error', 'Failed to create order');
            return res.redirect('/checkout');
          }

          Cart.clearCart(uid, (clearErr) => {
            if (clearErr) {
              console.error('stripeSuccess - clearCart error', clearErr);
              req.flash('error', 'Order created but failed to clear cart.');
              return res.redirect('/checkout');
            }

            const pi = session.payment_intent;
            StripeTransaction.create({
              userId: uid,
              orderId,
              session_id: session.id,
              payment_intent_id: (pi && pi.id) ? pi.id : pi || null,
              customer_email: session.customer_details && session.customer_details.email,
              amount: Number(total),
              currency: (session.currency || 'sgd').toUpperCase(),
              status: session.payment_status,
              raw_response: JSON.stringify(session)
            }, (logErr) => {
              if (logErr) console.error('stripeSuccess - log transaction error', logErr);
              req.session.stripePending = null;
              if (isTest) return res.redirect('/history');
              const orderObj = { id: orderId, total };
              const html = InvoiceService.formatHtml(orderObj, items);
              InvoiceService.save(uid, html, (invErr) => {
                if (invErr) console.error('Failed to save invoice:', invErr);
                return res.redirect('/history');
              });
            });
          });
        });
      };

      if (usePending) {
        return handleOrder(pending.items, pending.total);
      }

      return getOrderItemsFromCart(uid, (err, items, total) => {
        if (err || !items.length) {
          req.flash('error', 'Unable to complete order after Stripe payment.');
          return res.redirect('/checkout');
        }
        return handleOrder(items, total);
      });
    }).catch((err) => {
      console.error('stripeSuccess error', err);
      req.flash('error', 'Stripe verification failed.');
      return res.redirect('/checkout');
    });
  },

  stripeCancel: (req, res) => {
    req.flash('error', 'Stripe payment canceled. Please try again.');
    return res.redirect('/checkout');
  },

  // Purchase history - show user's orders and items grouped by order
  purchaseHistory: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');
    Order.getByUserGrouped(uid, (err, rows) => {
      if (err) {
        console.error('purchaseHistory DB error', err);
        req.flash('error', 'Database error');
        return res.redirect('/shopping');
      }

      const ordersMap = new Map();
      (rows || []).forEach(r => {
        const oid = r.orderId;
        if (!ordersMap.has(oid)) {
          ordersMap.set(oid, {
            id: oid,
            total: Number(r.total),
            created_at: r.created_at,
            is_test: r.is_test,
            items: []
          });
        }
        if (r.itemId) {
          ordersMap.get(oid).items.push({
            id: r.itemId,
            productId: r.productId,
            productName: r.productName,
            quantity: r.quantity,
            base_price: Number(r.base_price),
            discount_rate: Number(r.discount_rate || 0),
            unit_price_after_discount: Number(r.unit_price_after_discount),
            subtotal: Number(r.subtotal)
          });
        }
      });

      const orders = Array.from(ordersMap.values()).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      const orderIds = orders.map(o => o.id);
      PaypalTransaction.getByOrderIds(orderIds, (pErr, pRows) => {
        if (pErr) console.error('purchaseHistory paypal lookup error', pErr);
        const paypalMap = new Map();
        (pRows || []).forEach(r => paypalMap.set(String(r.orderId), r));
        NetsTransaction.getByOrderIds(orderIds, (nErr, nRows) => {
          if (nErr) console.error('purchaseHistory nets lookup error', nErr);
          const netsMap = new Map();
          (nRows || []).forEach(r => netsMap.set(String(r.orderId), r));
          Wallet.getPaymentByOrderIds(orderIds, (wErr, wRows) => {
            if (wErr) console.error('purchaseHistory wallet lookup error', wErr);
            const walletMap = new Map();
            (wRows || []).forEach(r => walletMap.set(String(r.orderId), r));
            StripeTransaction.getByOrderIds(orderIds, (sErr, sRows) => {
              if (sErr) console.error('purchaseHistory stripe lookup error', sErr);
              const stripeMap = new Map();
              (sRows || []).forEach(r => stripeMap.set(String(r.orderId), r));
              RefundRequest.getByOrderIds(orderIds, (rErr, rRows) => {
                if (rErr) console.error('purchaseHistory refund lookup error', rErr);
                const refundMap = new Map();
                (rRows || []).forEach(r => refundMap.set(String(r.orderId), r));
                res.render('purchaseHistory', { orders, paypalMap, netsMap, walletMap, stripeMap, refundMap, user: req.session.user, messages: req.flash() });
              });
            });
          });
        });
      });
    });
  },

  // Admin: view full order history with items
  adminOrderHistory: (req, res) => {
    Order.getAllWithUsersAndItems((err, rows) => {
      if (err) {
        console.error('adminOrderHistory DB error', err);
        req.flash('error', 'Failed to load order history');
        return res.redirect('/admin/analytics');
      }

      const map = new Map();
      (rows || []).forEach(r => {
        const oid = r.orderId;
        if (!map.has(oid)) {
          map.set(oid, {
            id: oid,
            userId: r.userId,
            username: r.username,
            email: r.email,
            total: Number(r.total),
            created_at: r.created_at,
            is_test: r.is_test,
            items: []
          });
        }
        if (r.itemId) {
          map.get(oid).items.push({
            id: r.itemId,
            productId: r.productId,
            productName: r.productName,
            quantity: r.quantity,
            base_price: Number(r.base_price),
            discount_rate: Number(r.discount_rate || 0),
            unit_price_after_discount: Number(r.unit_price_after_discount),
            subtotal: Number(r.subtotal)
          });
        }
      });

      const orders = Array.from(map.values()).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      const orderIds = orders.map(o => o.id);
      PaypalTransaction.getByOrderIds(orderIds, (pErr, pRows) => {
        if (pErr) console.error('adminOrderHistory paypal lookup error', pErr);
        const paypalMap = new Map();
        (pRows || []).forEach(r => paypalMap.set(String(r.orderId), r));
        NetsTransaction.getByOrderIds(orderIds, (nErr, nRows) => {
          if (nErr) console.error('adminOrderHistory nets lookup error', nErr);
          const netsMap = new Map();
          (nRows || []).forEach(r => netsMap.set(String(r.orderId), r));
          StripeTransaction.getByOrderIds(orderIds, (sErr, sRows) => {
            if (sErr) console.error('adminOrderHistory stripe lookup error', sErr);
            const stripeMap = new Map();
            (sRows || []).forEach(r => stripeMap.set(String(r.orderId), r));
            RefundRequest.getByOrderIds(orderIds, (rErr, rRows) => {
              if (rErr) console.error('adminOrderHistory refund lookup error', rErr);
              const refundMap = new Map();
              (rRows || []).forEach(r => refundMap.set(String(r.orderId), r));
              res.render('admin/orders', { orders, paypalMap, netsMap, stripeMap, refundMap, user: req.session.user, messages: req.flash() });
            });
          });
        });
      });
    });
  },

  // Admin: download CSV of full order summary
  adminDownloadOrders: (req, res) => {
    Order.getAllWithUsersAndItems((err, rows) => {
      if (err) {
        console.error('adminDownloadOrders DB error', err);
        req.flash('error', 'Failed to export order summary');
        return res.redirect('/admin/orders');
      }

      const header = [
        'Order ID',
        'User ID',
        'Username',
        'Email',
        'Created At',
        'Product ID',
        'Product Name',
        'Quantity',
        'Unit Price After Discount',
        'Subtotal',
        'Order Total'
      ];

      const esc = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const csvLines = [header.map(esc).join(',')];
      (rows || []).forEach(r => {
        csvLines.push([
          esc(r.orderId),
          esc(r.userId),
          esc(r.username || ''),
          esc(r.email || ''),
          esc(r.created_at),
          esc(r.productId || ''),
          esc(r.productName || ''),
          esc(r.quantity != null ? r.quantity : ''),
          esc(r.unit_price_after_discount != null ? Number(r.unit_price_after_discount).toFixed(2) : ''),
          esc(r.subtotal != null ? Number(r.subtotal).toFixed(2) : ''),
          esc(r.total != null ? Number(r.total).toFixed(2) : '')
        ].join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="order-summary.csv"');
      res.send(csvLines.join('\n'));
    });
  },

  // Admin: delete an order and its items
  adminDeleteOrder: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/analytics');
    }
    Order.remove(orderId, (err) => {
      if (err) {
        console.error('adminDeleteOrder error', err);
        req.flash('error', 'Failed to delete order');
      } else {
        req.flash('success', 'Order deleted');
      }
      return res.redirect('/admin/analytics');
    });
  },

  // Admin: delete a single order item and refresh order total
  adminDeleteOrderItem: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (!orderId || !itemId) {
      req.flash('error', 'Invalid order or item id');
      return res.redirect('/admin/analytics');
    }
    const OrderItem = require('../models/OrderItem'); // lazy require to avoid circular at top
    OrderItem.removeById(itemId, (err) => {
      if (err) {
        console.error('adminDeleteOrderItem error', err);
        req.flash('error', 'Failed to delete order item');
        return res.redirect('/admin/analytics');
      }
      Order.recalcTotal(orderId, (reErr) => {
        if (reErr) {
          console.error('adminDeleteOrderItem recalculation error', reErr);
          req.flash('error', 'Item removed but failed to update order total');
        } else {
          req.flash('success', 'Order item deleted');
        }
        return res.redirect('/admin/analytics');
      });
    });
  },

  // Admin: delete all orders and items
  adminDeleteAllOrders: (req, res) => {
    Order.removeAll((err) => {
      if (err) {
        console.error('adminDeleteAllOrders error', err);
        req.flash('error', 'Failed to delete all orders');
      } else {
        req.flash('success', 'All orders deleted');
      }
      return res.redirect('/admin/analytics');
    });
  },

  // Admin: view edit form for an order
  adminEditOrderForm: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/analytics');
    }
    Order.getWithItems(orderId, (err, rows) => {
      if (err || !rows || !rows.length) {
        req.flash('error', 'Order not found');
        return res.redirect('/admin/analytics');
      }
      const order = {
        id: rows[0].orderId,
        userId: rows[0].userId,
        total: rows[0].total,
        created_at: rows[0].created_at
      };
      const items = rows.filter(r => r.itemId).map(r => ({
        id: r.itemId,
        productId: r.productId,
        productName: r.productName,
        quantity: r.quantity,
        unit_price_after_discount: r.unit_price_after_discount,
        subtotal: r.subtotal
      }));
      res.render('admin/editOrder', { order, items, user: req.session.user, messages: req.flash() });
    });
  },

  // Admin: update order items (quantities/prices) and recalc totals
  adminUpdateOrder: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/analytics');
    }
    const itemIds = Array.isArray(req.body.itemId) ? req.body.itemId : [req.body.itemId];
    const quantities = Array.isArray(req.body.quantity) ? req.body.quantity : [req.body.quantity];
    const unitPrices = Array.isArray(req.body.unitPrice) ? req.body.unitPrice : [req.body.unitPrice];

    const tasks = [];
    for (let i = 0; i < itemIds.length; i++) {
      const itemId = parseInt(itemIds[i], 10);
      const qty = parseInt(quantities[i], 10);
      const unit = parseFloat(unitPrices[i]);
      if (!itemId || !qty || qty < 1 || isNaN(unit)) continue;
      tasks.push({ itemId, qty, unit });
    }

    if (!tasks.length) {
      req.flash('error', 'No valid item updates provided');
      return res.redirect(`/admin/orders/${orderId}/edit`);
    }

    const doNext = (idx) => {
      if (idx >= tasks.length) {
        return Order.recalcTotal(orderId, (reErr) => {
          if (reErr) {
            console.error('adminUpdateOrder recalculation error', reErr);
            req.flash('error', 'Items saved, but failed to update order total');
          } else {
            req.flash('success', 'Order updated');
          }
          return res.redirect(`/admin/orders/${orderId}/edit`);
        });
      }
      const t = tasks[idx];
      OrderItem.updateItem(t.itemId, { quantity: t.qty, unit_price_after_discount: t.unit }, (err) => {
        if (err) {
          console.error('adminUpdateOrder updateItem error', err);
          req.flash('error', 'Failed to update one or more items');
          return res.redirect(`/admin/orders/${orderId}/edit`);
        }
        doNext(idx + 1);
      });
    };

    doNext(0);
  }
  ,

  adminRefundPaypal: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
      if (!orderId) {
        req.flash('error', 'Invalid order id');
        return res.redirect(req.get('Referer') || '/admin/orders');
      }
    PaypalTransaction.getByOrderId(orderId, (err, txn) => {
      if (err) {
        console.error('adminRefundPaypal lookup error', err);
        req.flash('error', 'Failed to load PayPal transaction');
        return res.redirect(req.get('Referer') || '/admin/orders');
      }
      if (!txn || !txn.capture_id) {
        req.flash('error', 'No PayPal capture found for this order');
        return res.redirect(req.get('Referer') || '/admin/orders');
      }
      if (txn.refund_status === 'refunded') {
        req.flash('success', 'Order already refunded');
        return res.redirect(req.get('Referer') || '/admin/orders');
      }

      PaypalService.refundCapture(txn.capture_id, txn.amount).then((refund) => {
        const refundStatus = refund && refund.status ? refund.status.toLowerCase() : 'refunded';
        PaypalTransaction.updateRefund(txn.id, {
          refund_status: refundStatus,
          refund_id: refund.id,
          refund_response: JSON.stringify(refund)
        }, (uErr) => {
          if (uErr) console.error('adminRefundPaypal update error', uErr);
          req.flash('success', `Refund ${refundStatus}`);
          return res.redirect(req.get('Referer') || '/admin/orders');
        });
      }).catch((rErr) => {
        console.error('adminRefundPaypal refund error', rErr);
        PaypalTransaction.updateRefund(txn.id, {
          refund_status: 'failed',
          refund_response: JSON.stringify(rErr.response || { error: rErr.message })
        }, () => {
          req.flash('error', 'Refund failed');
          return res.redirect(req.get('Referer') || '/admin/orders');
        });
      });
    });
  }
  ,

  adminRefundWalletForNets: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect(req.get('Referer') || '/admin/orders');
    }
    Order.getWithItems(orderId, (oErr, rows) => {
      if (oErr || !rows || !rows.length) {
        req.flash('error', 'Order not found');
        return res.redirect(req.get('Referer') || '/admin/orders');
      }
      const order = {
        id: rows[0].orderId,
        userId: rows[0].userId,
        total: Number(rows[0].total)
      };
      NetsTransaction.getByOrderId(orderId, (nErr, txn) => {
        if (nErr) {
          console.error('adminRefundWalletForNets lookup error', nErr);
          req.flash('error', 'Failed to load NETS transaction');
          return res.redirect(req.get('Referer') || '/admin/orders');
        }
        if (!txn) {
          req.flash('error', 'No NETS transaction found for this order');
          return res.redirect(req.get('Referer') || '/admin/orders');
        }
        if (txn.status === 'refunded_wallet') {
          req.flash('success', 'Order already refunded to wallet');
          return res.redirect(req.get('Referer') || '/admin/orders');
        }

        Wallet.credit(order.userId, order.total, {
          type: 'refund',
          method: 'nets',
          status: 'completed',
          note: `NETS refund for order #${orderId}`
        }, (wErr) => {
          if (wErr) {
            console.error('adminRefundWalletForNets wallet error', wErr);
            req.flash('error', 'Failed to refund to wallet');
            return res.redirect(req.get('Referer') || '/admin/orders');
          }
          NetsTransaction.updateByTxnRef(txn.txn_retrieval_ref, { status: 'refunded_wallet' }, () => {});
          req.flash('success', 'Refunded to wallet');
          return res.redirect(req.get('Referer') || '/admin/orders');
        });
      });
    });
  }
};

module.exports = OrderController;

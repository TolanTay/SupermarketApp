const db = require('../db');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const InvoiceService = require('../services/InvoiceService');
const OrderItem = require('../models/OrderItem');

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

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
      res.render('checkout', { cartItems: items, total, user: req.session.user, messages: req.flash() });
    });
  },

  // Confirm purchase: create order + order_items (transactional), then clear cart
  confirmPurchase: (req, res) => {
    const uid = req.session.user && req.session.user.id; if (!uid) return res.redirect('/login');

    Cart.getUserCart(uid, (err, rows) => {
      if (err) {
        console.error('confirmPurchase - getUserCart error', err);
        req.flash('error', 'Database error while reading cart');
        return res.redirect('/checkout');
      }
      if (!rows || rows.length === 0) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/checkout');
      }

      // Fetch product discount rates for all cart items
      const productIds = Array.from(new Set(rows.map(r => r.productId)));
      const placeholders = productIds.map(() => '?').join(',');
      const sql = `SELECT id, price, discount_rate FROM products WHERE id IN (${placeholders})`;

      db.query(sql, productIds, (e, prodRows) => {
        if (e) {
          console.error('confirmPurchase - fetching product discounts error', e);
          req.flash('error', 'Database error');
          return res.redirect('/checkout');
        }

        const discMap = {};
        const priceMap = {};
        prodRows.forEach(p => {
          discMap[p.id] = Number(p.discount_rate || 0);
          priceMap[p.id] = Number(p.price || 0);
        });

        // Group cart rows by productId and sum quantities
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

        // Build order_items array with grouped quantities
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

        Order.createOrderWithItems(uid, items, total, (orderErr, orderId) => {
          if (orderErr) {
            console.error('confirmPurchase - createOrderWithItems error', orderErr);
            req.flash('error', 'Failed to create order');
            return res.redirect('/checkout');
          }

          Cart.clearCart(uid, (clearErr) => {
            if (clearErr) {
              console.error('confirmPurchase - clearCart error', clearErr);
              req.flash('error', 'Order created but failed to clear cart. Please contact support.');
              return res.redirect('/checkout');
            }

            const orderObj = { id: orderId, total };
            const html = InvoiceService.formatHtml(orderObj, items);
            InvoiceService.save(uid, html, (invErr, filepath) => {
              if (invErr) console.error('Failed to save invoice:', invErr);
              else console.log('Invoice saved to', filepath);
              req.flash('success', 'Purchase confirmed. Order #' + orderId);
              return res.redirect('/history');
            });
          });
        });
      });
    });
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
      res.render('purchaseHistory', { orders, user: req.session.user, messages: req.flash() });
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
      res.render('admin/orders', { orders, user: req.session.user, messages: req.flash() });
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
};

module.exports = OrderController;

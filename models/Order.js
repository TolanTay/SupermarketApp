const db = require('../db');
const OrderItem = require('./OrderItem');

const Order = {
  // Create an order row only
  create: (userId, total, cb) => {
    db.query('INSERT INTO orders (userId, total) VALUES (?, ?)', [userId, total], (err, result) => {
      if (err) return cb(err);
      cb(null, result.insertId);
    });
  },

  recalcTotal: (orderId, cb) => {
    OrderItem.sumByOrder(orderId, (err, total) => {
      if (err) return cb(err);
      if (total === 0) {
        // no items left, remove the order row
        return Order.remove(orderId, cb);
      }
      db.query('UPDATE orders SET total = ? WHERE id = ?', [total, orderId], cb);
    });
  },

  getWithItems: (orderId, cb) => {
    const sql = `
      SELECT o.id AS orderId, o.userId, o.total, o.created_at,
             oi.id AS itemId, oi.productId, oi.productName, oi.quantity, oi.base_price, oi.discount_rate, oi.unit_price_after_discount, oi.subtotal
      FROM orders o
      LEFT JOIN order_items oi ON oi.orderId = o.id
      WHERE o.id = ?
      ORDER BY oi.id ASC
    `;
    db.query(sql, [orderId], cb);
  },

  removeAll: (cb) => {
    db.beginTransaction(err => {
      if (err) return cb(err);
      db.query('DELETE FROM order_items', (itemsErr) => {
        if (itemsErr) return db.rollback(() => cb(itemsErr));
        db.query('DELETE FROM orders', (ordersErr) => {
          if (ordersErr) return db.rollback(() => cb(ordersErr));
          db.commit(commitErr => {
            if (commitErr) return db.rollback(() => cb(commitErr));
            cb(null);
          });
        });
      });
    });
  },

  remove: (orderId, cb) => {
    db.beginTransaction(err => {
      if (err) return cb(err);
      OrderItem.removeByOrder(orderId, (itemErr) => {
        if (itemErr) return db.rollback(() => cb(itemErr));
        db.query('DELETE FROM orders WHERE id = ?', [orderId], (ordErr) => {
          if (ordErr) return db.rollback(() => cb(ordErr));
          db.commit(commitErr => {
            if (commitErr) return db.rollback(() => cb(commitErr));
            cb(null);
          });
        });
      });
    });
  },

  // Transactional create of order and its items
  createOrderWithItems: (userId, items, total, cb) => {
    db.beginTransaction(err => {
      if (err) return cb(err);
      Order.create(userId, total, (orderErr, orderId) => {
        if (orderErr) return db.rollback(() => cb(orderErr));
        OrderItem.createMany(orderId, items, (itemErr) => {
          if (itemErr) return db.rollback(() => cb(itemErr));
          db.commit(commitErr => {
            if (commitErr) return db.rollback(() => cb(commitErr));
            cb(null, orderId);
          });
        });
      });
    });
  },

  getByUserGrouped: (userId, cb) => {
    const sql = `
      SELECT o.id AS orderId, o.total, o.created_at,
             oi.id AS itemId, oi.productId, oi.productName, oi.quantity, oi.base_price, oi.discount_rate, oi.unit_price_after_discount, oi.subtotal
      FROM orders o
      LEFT JOIN order_items oi ON oi.orderId = o.id
      WHERE o.userId = ?
      ORDER BY o.created_at DESC, oi.id ASC
    `;
    db.query(sql, [userId], cb);
  }
};

module.exports = Order;

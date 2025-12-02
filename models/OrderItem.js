const db = require('../db');

const OrderItem = {
  // Bulk insert order items for a given orderId
  createMany: (orderId, items, cb) => {
    if (!items || !items.length) return cb(null);
    const values = items.map(it => [
      orderId,
      it.productId,
      it.productName,
      it.quantity,
      it.base_price,
      it.discount_rate,
      it.unit_price_after_discount,
      it.subtotal
    ]);
    const sql = `
      INSERT INTO order_items
      (orderId, productId, productName, quantity, base_price, discount_rate, unit_price_after_discount, subtotal)
      VALUES ?
    `;
    db.query(sql, [values], cb);
  },

  listByOrder: (orderId, cb) => {
    db.query(
      'SELECT * FROM order_items WHERE orderId = ? ORDER BY id ASC',
      [orderId],
      cb
    );
  },

  removeByOrder: (orderId, cb) => {
    db.query('DELETE FROM order_items WHERE orderId = ?', [orderId], cb);
  },

  removeById: (itemId, cb) => {
    db.query('DELETE FROM order_items WHERE id = ?', [itemId], cb);
  },

  updateItem: (itemId, { quantity, unit_price_after_discount }, cb) => {
    const qty = Number(quantity);
    const unit = Number(unit_price_after_discount);
    const subtotal = +(qty * unit).toFixed(2);
    db.query(
      'UPDATE order_items SET quantity = ?, unit_price_after_discount = ?, subtotal = ? WHERE id = ?',
      [qty, unit, subtotal, itemId],
      cb
    );
  },

  sumByOrder: (orderId, cb) => {
    db.query('SELECT COALESCE(SUM(subtotal), 0) AS total FROM order_items WHERE orderId = ?', [orderId], (err, rows) => {
      if (err) return cb(err);
      const total = rows && rows[0] ? Number(rows[0].total) : 0;
      cb(null, total);
    });
  }
};

module.exports = OrderItem;

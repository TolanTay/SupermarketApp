const db = require('../db');

const PaypalTransaction = {
  create: (payload, cb) => {
    const sql = `
      INSERT INTO paypal_transactions
        (userId, orderId, paypal_order_id, capture_id, payer_id, payer_email, amount, currency, status, refund_status, raw_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      payload.userId,
      payload.orderId || null,
      payload.paypal_order_id,
      payload.capture_id || null,
      payload.payer_id || null,
      payload.payer_email || null,
      payload.amount,
      payload.currency,
      payload.status,
      payload.refund_status || 'none',
      payload.raw_response || null
    ];
    db.query(sql, params, cb);
  },

  getByOrderIds: (orderIds, cb) => {
    if (!orderIds || !orderIds.length) return cb(null, []);
    const placeholders = orderIds.map(() => '?').join(',');
    const sql = `SELECT * FROM paypal_transactions WHERE orderId IN (${placeholders})`;
    db.query(sql, orderIds, cb);
  },

  getByOrderId: (orderId, cb) => {
    db.query('SELECT * FROM paypal_transactions WHERE orderId = ? LIMIT 1', [orderId], (err, rows) => {
      if (err) return cb(err);
      return cb(null, rows && rows[0]);
    });
  },

  updateRefund: (id, fields, cb) => {
    const sql = `
      UPDATE paypal_transactions
      SET refund_status = ?, refund_id = ?, refund_response = ?
      WHERE id = ?
    `;
    const params = [
      fields.refund_status,
      fields.refund_id || null,
      fields.refund_response || null,
      id
    ];
    db.query(sql, params, cb);
  }
};

module.exports = PaypalTransaction;

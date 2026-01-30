const db = require('../db');

const StripeTransaction = {
  create: (payload, cb) => {
    const sql = `
      INSERT INTO stripe_transactions
        (userId, orderId, session_id, payment_intent_id, customer_email, amount, currency, status, refund_status, raw_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      payload.userId,
      payload.orderId || null,
      payload.session_id,
      payload.payment_intent_id || null,
      payload.customer_email || null,
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
    const sql = `SELECT * FROM stripe_transactions WHERE orderId IN (${placeholders})`;
    db.query(sql, orderIds, cb);
  },

  getByOrderId: (orderId, cb) => {
    db.query('SELECT * FROM stripe_transactions WHERE orderId = ? LIMIT 1', [orderId], (err, rows) => {
      if (err) return cb(err);
      return cb(null, rows && rows[0]);
    });
  },

  updateRefund: (id, fields, cb) => {
    const sql = `
      UPDATE stripe_transactions
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

module.exports = StripeTransaction;

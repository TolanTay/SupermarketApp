const db = require('../db');

const RefundRequest = {
  create: (payload, cb) => {
    const sql = `
      INSERT INTO refund_requests (orderId, userId, method, reason, status)
      VALUES (?, ?, ?, ?, 'pending')
    `;
    db.query(sql, [payload.orderId, payload.userId, payload.method, payload.reason], cb);
  },

  getByOrderIds: (orderIds, cb) => {
    if (!orderIds || !orderIds.length) return cb(null, []);
    const placeholders = orderIds.map(() => '?').join(',');
    const sql = `SELECT * FROM refund_requests WHERE orderId IN (${placeholders})`;
    db.query(sql, orderIds, cb);
  },

  getByOrderId: (orderId, cb) => {
    db.query('SELECT * FROM refund_requests WHERE orderId = ? LIMIT 1', [orderId], (err, rows) => {
      if (err) return cb(err);
      return cb(null, rows && rows[0]);
    });
  },

  updateStatus: (id, fields, cb) => {
    const sql = `
      UPDATE refund_requests
      SET status = ?, admin_message = ?, resolved_at = NOW()
      WHERE id = ?
    `;
    db.query(sql, [fields.status, fields.admin_message || null, id], cb);
  }
};

module.exports = RefundRequest;

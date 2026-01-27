const db = require('../db');

const NetsTransaction = {
  createPending: (payload, cb) => {
    const sql = `
      INSERT INTO nets_transactions
        (userId, txn_id, txn_retrieval_ref, txn_nets_qr_id, amount, status, response_code, network_status, txn_status, error_message, raw_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      payload.userId,
      payload.txn_id,
      payload.txn_retrieval_ref || null,
      payload.txn_nets_qr_id || null,
      payload.amount,
      payload.status || 'pending',
      payload.response_code || null,
      payload.network_status != null ? payload.network_status : null,
      payload.txn_status != null ? payload.txn_status : null,
      payload.error_message || null,
      payload.raw_response || null
    ];
    db.query(sql, params, (err, result) => {
      if (err) return cb(err);
      return cb(null, result.insertId);
    });
  },

  updateByTxnRef: (txnRetrievalRef, fields, cb) => {
    const sql = `
      UPDATE nets_transactions
      SET status = ?, response_code = ?, network_status = ?, txn_status = ?, error_message = ?, raw_response = ?
      WHERE txn_retrieval_ref = ?
    `;
    const params = [
      fields.status,
      fields.response_code || null,
      fields.network_status != null ? fields.network_status : null,
      fields.txn_status != null ? fields.txn_status : null,
      fields.error_message || null,
      fields.raw_response || null,
      txnRetrievalRef
    ];
    db.query(sql, params, cb);
  },

  attachOrder: (id, orderId, cb) => {
    const sql = 'UPDATE nets_transactions SET orderId = ? WHERE id = ?';
    db.query(sql, [orderId, id], cb);
  },
  attachOrderByTxnRef: (txnRef, orderId, cb) => {
    const sql = 'UPDATE nets_transactions SET orderId = ? WHERE txn_retrieval_ref = ?';
    db.query(sql, [orderId, txnRef], cb);
  },

  getByOrderIds: (orderIds, cb) => {
    if (!orderIds || !orderIds.length) return cb(null, []);
    const placeholders = orderIds.map(() => '?').join(',');
    const sql = `SELECT * FROM nets_transactions WHERE orderId IN (${placeholders})`;
    db.query(sql, orderIds, cb);
  },

  getByOrderId: (orderId, cb) => {
    db.query('SELECT * FROM nets_transactions WHERE orderId = ? LIMIT 1', [orderId], (err, rows) => {
      if (err) return cb(err);
      return cb(null, rows && rows[0]);
    });
  }
};

module.exports = NetsTransaction;

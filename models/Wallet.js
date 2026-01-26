const db = require('../db');

const Wallet = {
  getBalance: (userId, cb) => {
    db.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId], (err, rows) => {
      if (err) return cb(err);
      const bal = rows && rows[0] ? Number(rows[0].wallet_balance || 0) : 0;
      return cb(null, bal);
    });
  },

  getTransactionsByUser: (userId, cb) => {
    const sql = `
      SELECT * FROM wallet_transactions
      WHERE userId = ?
      ORDER BY created_at DESC, id DESC
    `;
    db.query(sql, [userId], cb);
  },

  getPaymentByOrderIds: (orderIds, cb) => {
    if (!orderIds || !orderIds.length) return cb(null, []);
    const placeholders = orderIds.map(() => '?').join(',');
    const sql = `
      SELECT * FROM wallet_transactions
      WHERE orderId IN (${placeholders}) AND type = 'payment'
    `;
    db.query(sql, orderIds, cb);
  },

  credit: (userId, amount, meta, cb) => {
    db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [amount, userId], (err) => {
      if (err) return cb(err);
      const sql = `
        INSERT INTO wallet_transactions (userId, orderId, type, method, amount, status, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        userId,
        meta.orderId || null,
        meta.type || 'topup',
        meta.method || 'manual',
        amount,
        meta.status || 'completed',
        meta.note || null
      ];
      db.query(sql, params, cb);
    });
  },

  debit: (userId, amount, meta, cb) => {
    db.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId], (err, rows) => {
      if (err) return cb(err);
      const bal = rows && rows[0] ? Number(rows[0].wallet_balance || 0) : 0;
      if (bal < amount) return cb(new Error('INSUFFICIENT_FUNDS'));

      db.query('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [amount, userId], (uErr) => {
        if (uErr) return cb(uErr);
        const sql = `
          INSERT INTO wallet_transactions (userId, orderId, type, method, amount, status, note)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
          userId,
          meta.orderId || null,
          meta.type || 'payment',
          meta.method || 'wallet',
          amount,
          meta.status || 'completed',
          meta.note || null
        ];
        db.query(sql, params, cb);
      });
    });
  },

  logFailure: (userId, amount, meta, cb) => {
    const sql = `
      INSERT INTO wallet_transactions (userId, orderId, type, method, amount, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      userId,
      meta.orderId || null,
      meta.type || 'payment',
      meta.method || 'wallet',
      amount,
      meta.status || 'failed',
      meta.note || null
    ];
    db.query(sql, params, cb);
  },

  attachOrderToLatestPayment: (userId, amount, orderId, cb) => {
    const sel = `
      SELECT id FROM wallet_transactions
      WHERE userId = ? AND type = 'payment' AND method = 'wallet' AND orderId IS NULL AND amount = ?
      ORDER BY id DESC
      LIMIT 1
    `;
    db.query(sel, [userId, amount], (err, rows) => {
      if (err) return cb(err);
      if (!rows || !rows.length) return cb(null);
      db.query('UPDATE wallet_transactions SET orderId = ? WHERE id = ?', [orderId, rows[0].id], cb);
    });
  }
};

module.exports = Wallet;

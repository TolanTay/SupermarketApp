const db = require('../db');

const Favorite = {
  add: (userId, productId, cb) => {
    db.query('INSERT IGNORE INTO favorites (userId, productId) VALUES (?, ?)', [userId, productId], cb);
  },

  remove: (userId, productId, cb) => {
    db.query('DELETE FROM favorites WHERE userId = ? AND productId = ?', [userId, productId], cb);
  },

  isFavorited: (userId, productId, cb) => {
    db.query('SELECT 1 FROM favorites WHERE userId = ? AND productId = ? LIMIT 1', [userId, productId], (err, rows) => {
      if (err) return cb(err);
      cb(null, !!(rows && rows.length));
    });
  },

  toggle: (userId, productId, cb) => {
    Favorite.isFavorited(userId, productId, (err, exists) => {
      if (err) return cb(err);
      if (exists) {
        Favorite.remove(userId, productId, (e) => cb(e, { action: 'removed' }));
      } else {
        Favorite.add(userId, productId, (e) => cb(e, { action: 'added' }));
      }
    });
  },

  listForUser: (userId, cb) => {
    db.query('SELECT productId FROM favorites WHERE userId = ?', [userId], cb);
  }
};

module.exports = Favorite;
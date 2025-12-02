const connection = require('../db');

const CartModel = {
  getUserCart: (userId, cb) => {
    const sql = `
      SELECT c.productId, c.quantity, c.price, p.productName, p.image
      FROM cart c
      JOIN products p ON c.productId = p.id
      WHERE c.userId = ?
    `;
    connection.query(sql, [userId], (err, rows) => {
      if (err) return cb(err);
      cb(null, rows);
    });
  },

  addToCart: (userId, productId, qty, cb) => {
    connection.beginTransaction(err => {
      if (err) return cb(err);

      connection.query('SELECT quantity, price, discount_rate FROM products WHERE id = ? FOR UPDATE', [productId], (err1, prodRows) => {
        if (err1) return connection.rollback(() => cb(err1));
        if (!prodRows || prodRows.length === 0) return connection.rollback(() => cb(new Error('Product not found')));

        const available = Number(prodRows[0].quantity || 0);
        const basePrice = parseFloat(prodRows[0].price) || 0;
        const discountRate = parseFloat(prodRows[0].discount_rate) || 0;
        const finalPrice = +((basePrice * (1 - (discountRate / 100))) || 0).toFixed(2);

        if (available < qty) return connection.rollback(() => cb(new Error('Not enough stock')));

        connection.query('UPDATE products SET quantity = quantity - ? WHERE id = ?', [qty, productId], (err2) => {
          if (err2) return connection.rollback(() => cb(err2));

          const insertSql = `
            INSERT INTO cart (userId, productId, quantity, price)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), price = VALUES(price)
          `;
          connection.query(insertSql, [userId, productId, qty, finalPrice], (err3) => {
            if (err3) return connection.rollback(() => cb(err3));

            connection.commit(commitErr => {
              if (commitErr) return connection.rollback(() => cb(commitErr));
              connection.query('SELECT quantity FROM products WHERE id = ?', [productId], (err4, rows4) => {
                const remaining = (err4 || !rows4 || !rows4[0]) ? null : Number(rows4[0].quantity);
                return cb(null, { productId, qty, remaining, price: finalPrice });
              });
            });
          });
        });
      });
    });
  },

  updateCartQuantity: (userId, productId, newQty, cb) => {
    connection.beginTransaction(err => {
      if (err) return cb(err);

      connection.query('SELECT quantity FROM cart WHERE userId = ? AND productId = ? FOR UPDATE', [userId, productId], (err1, cartRows) => {
        if (err1) return connection.rollback(() => cb(err1));
        const oldQty = (cartRows && cartRows.length) ? Number(cartRows[0].quantity) : 0;
        const diff = newQty - oldQty;
        if (diff === 0) return connection.rollback(() => cb(null, { changed: false }));

        if (diff > 0) {
          connection.query('SELECT quantity FROM products WHERE id = ? FOR UPDATE', [productId], (err2, prodRows) => {
            if (err2) return connection.rollback(() => cb(err2));
            const available = Number(prodRows[0].quantity || 0);
            if (available < diff) return connection.rollback(() => cb(new Error('Not enough stock')));
            connection.query('UPDATE products SET quantity = quantity - ? WHERE id = ?', [diff, productId], (err3) => {
              if (err3) return connection.rollback(() => cb(err3));
              connection.query('UPDATE cart SET quantity = ? WHERE userId = ? AND productId = ?', [newQty, userId, productId], (err4) => {
                if (err4) return connection.rollback(() => cb(err4));
                connection.commit(cErr => { if (cErr) return connection.rollback(() => cb(cErr)); return cb(null, { changed: true }); });
              });
            });
          });
        } else {
          const release = Math.abs(diff);
          connection.query('UPDATE products SET quantity = quantity + ? WHERE id = ?', [release, productId], (err5) => {
            if (err5) return connection.rollback(() => cb(err5));
            connection.query('UPDATE cart SET quantity = ? WHERE userId = ? AND productId = ?', [newQty, userId, productId], (err6) => {
              if (err6) return connection.rollback(() => cb(err6));
              connection.commit(cErr2 => { if (cErr2) return connection.rollback(() => cb(cErr2)); return cb(null, { changed: true }); });
            });
          });
        }
      });
    });
  },

  removeFromCart: (userId, productId, cb) => {
    connection.beginTransaction(err => {
      if (err) return cb(err);
      connection.query('SELECT quantity FROM cart WHERE userId = ? AND productId = ? FOR UPDATE', [userId, productId], (err1, cartRows) => {
        if (err1) return connection.rollback(() => cb(err1));
        if (!cartRows || cartRows.length === 0) return connection.rollback(() => cb(null, { removed: false }));
        const oldQty = Number(cartRows[0].quantity || 0);
        connection.query('UPDATE products SET quantity = quantity + ? WHERE id = ?', [oldQty, productId], (err2) => {
          if (err2) return connection.rollback(() => cb(err2));
          connection.query('DELETE FROM cart WHERE userId = ? AND productId = ?', [userId, productId], (err3) => {
            if (err3) return connection.rollback(() => cb(err3));
            connection.commit(cErr => { if (cErr) return connection.rollback(() => cb(cErr)); return cb(null, { removed: true }); });
          });
        });
      });
    });
  },

  clearCart: (userId, cb) => {
    connection.query('DELETE FROM cart WHERE userId = ?', [userId], (err) => cb(err));
  },

  resetProductsToInitial: (productIds, cb) => {
    if (!productIds || productIds.length === 0) return cb(null);
    // prefer DB column initialQuantity if exists
    connection.query("SHOW COLUMNS FROM products LIKE 'initialQuantity'", (err, rows) => {
      if (err) return cb(err);
      if (rows && rows.length) {
        const sql = `UPDATE products SET quantity = initialQuantity WHERE id IN (${productIds.map(() => '?').join(',')})`;
        return connection.query(sql, productIds, cb);
      } else {
        // fallback to in-memory snapshot
        try {
          const updates = productIds.slice();
          const doNext = () => {
            if (!updates.length) return cb(null);
            const pid = updates.shift();
            const orig = (connection.initialStock && typeof connection.initialStock[pid] === 'number') ? connection.initialStock[pid] : null;
            if (orig === null) return doNext();
            connection.query('UPDATE products SET quantity = ? WHERE id = ?', [orig, pid], (uErr) => {
              if (uErr) return cb(uErr);
              doNext();
            });
          };
          doNext();
        } catch (e) {
          return cb(e);
        }
      }
    });
  }
};

module.exports = CartModel;

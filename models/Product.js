const db = require('../db');

const Product = {
  // updated signature: getAll(filters = {}, userId, cb)
  getAll: (filters = {}, userId, cb) => {
    const where = [];
    const params = [];

    // We include favorites LEFT JOIN to detect per-user favorites
    // userId may be null -> no favorites marked
    const userParam = userId || null;

    if (filters.category) { where.push('p.category = ?'); params.push(filters.category); }

    let sql = `SELECT p.*, 
                      (p.price * (1 - COALESCE(p.discount_rate,0)/100)) AS effective_price,
                      (f.userId IS NOT NULL) AS isFavorited
               FROM products p
               LEFT JOIN favorites f ON f.productId = p.id AND f.userId = ?`;
    // first param is userId for the LEFT JOIN
    const finalParams = [userParam].concat(params);

    if (where.length) sql += ' WHERE ' + where.join(' AND ');

    if (filters.sort === 'price_asc') sql += ' ORDER BY effective_price ASC';
    else if (filters.sort === 'price_desc') sql += ' ORDER BY effective_price DESC';
    else if (filters.sort === 'name_asc') sql += ' ORDER BY p.productName ASC';
    else if (filters.sort === 'favourite' || filters.sort === 'favorite') {
      // show favourites first, then by id
      sql += ' ORDER BY (f.userId IS NOT NULL) DESC, p.id ASC';
    } else {
      sql += ' ORDER BY p.id ASC';
    }

    db.query(sql, finalParams, (err, rows) => cb(err, rows));
  },

  getById: (id, cb) => {
    db.query('SELECT * FROM products WHERE id = ?', [id], (err, rows) => cb(err, rows && rows[0]));
  },

  create: (data, cb) => {
    const sql = `INSERT INTO products (productName, price, description, quantity, initialQuantity, discount_rate, image, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [data.name, data.price || 0, data.description || null, data.quantity || 0, data.quantity || 0, data.discount || 0, data.image || null, data.category || null], cb);
  },

  update: (id, data, cb) => {
    const fields = [], params = [];
    if (data.name !== undefined) { fields.push('productName = ?'); params.push(data.name); }
    if (data.price !== undefined) { fields.push('price = ?'); params.push(data.price); }
    if (data.quantity !== undefined) { fields.push('quantity = ?'); params.push(data.quantity); fields.push('initialQuantity = ?'); params.push(data.quantity); }
    if (data.discount !== undefined) { fields.push('discount_rate = ?'); params.push(data.discount); }
    if (data.image !== undefined) { fields.push('image = ?'); params.push(data.image); }
    if (data.category !== undefined) { fields.push('category = ?'); params.push(data.category); }
    if (!fields.length) return cb(null, { affectedRows: 0 });
    params.push(id);
    db.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params, cb);
  },

  remove: (id, cb) => db.query('DELETE FROM products WHERE id = ?', [id], cb)
};

module.exports = Product;

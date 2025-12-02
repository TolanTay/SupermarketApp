const db = require('../db');

const User = {
  // Create user: expects { username, email, password, address, contact, role }
  create: (data, cb) => {
    const username = data.username || data.name || null;
    const email = data.email || null;
    const password = data.password || '';
    const address = data.address || null;
    const contact = data.contact || null;
    const role = data.role || 'user';
    const sql = `INSERT INTO users (username, email, password, address, contact, role)
                 VALUES (?, ?, SHA1(?), ?, ?, ?)`;
    db.query(sql, [username, email, password, address, contact, role], cb);
  },

  // Find by username/email and password (used for login)
  findByCredentials: (identifier, password, cb) => {
    const sql = `SELECT id, username, email, role, address, contact, avatar FROM users
                 WHERE (username = ? OR email = ?) AND password = SHA1(?) LIMIT 1`;
    db.query(sql, [identifier, identifier, password], (err, rows) => {
      if (err) return cb(err);
      return cb(null, rows && rows[0] ? rows[0] : null);
    });
  },

  // Find by id
  findById: (id, cb) => {
    db.query('SELECT id, username, email, role, address, contact, avatar FROM users WHERE id = ? LIMIT 1', [id], (err, rows) => {
      if (err) return cb(err);
      return cb(null, rows && rows[0] ? rows[0] : null);
    });
  },

  // Optional: list users (admin)
  getAll: (cb) => {
    db.query('SELECT id, username, email, role FROM users ORDER BY id DESC', (err, rows) => cb(err, rows));
  },

  // Update user fields; if password is provided, hash and update it.
  update: (id, data, cb) => {
    const fields = ['username = ?', 'email = ?', 'address = ?', 'contact = ?', 'role = ?'];
    const params = [
      data.username || null,
      data.email || null,
      data.address || null,
      data.contact || null,
      data.role || 'user'
    ];

    if (data.password && data.password.trim() !== '') {
      fields.push('password = SHA1(?)');
      params.push(data.password);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'avatar')) {
      fields.push('avatar = ?');
      params.push(data.avatar || null);
    }

    params.push(id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    db.query(sql, params, cb);
  },

  // Update without changing role (for self-service profile)
  updateProfile: (id, data, cb) => {
    const fields = [];
    const params = [];

    if (data.username) { fields.push('username = ?'); params.push(data.username); }
    if (data.email) { fields.push('email = ?'); params.push(data.email); }
    if (Object.prototype.hasOwnProperty.call(data, 'address')) { fields.push('address = ?'); params.push(data.address || null); }
    if (Object.prototype.hasOwnProperty.call(data, 'contact')) { fields.push('contact = ?'); params.push(data.contact || null); }
    if (Object.prototype.hasOwnProperty.call(data, 'avatar')) { fields.push('avatar = ?'); params.push(data.avatar || null); }
    if (data.password && data.password.trim() !== '') { fields.push('password = SHA1(?)'); params.push(data.password); }

    if (!fields.length) return cb(null); // nothing to update
    params.push(id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    db.query(sql, params, cb);
  },

  // Delete user by id
  remove: (id, cb) => {
    db.query('DELETE FROM users WHERE id = ?', [id], cb);
  }
};

module.exports = User;

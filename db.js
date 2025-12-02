const mysql = require('mysql2');
const connection = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'c372_supermarketdb'
});

connection.connect(err => {
  if (err) {
    console.error('DB connect error', err);
    process.exit(1);
  }
  console.log('DB connected');

  const createCart = `
    CREATE TABLE IF NOT EXISTS cart (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      productId INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      price DECIMAL(10,2) NOT NULL,
      UNIQUE KEY user_product (userId, productId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  connection.query(createCart, (err2) => {
    if (err2) console.error('Failed to create cart table:', err2);
  });

  // --- NEW: capture initial product stock snapshot on startup (prefer persistent initialQuantity) ---
  connection.query('SELECT id, quantity, initialQuantity FROM products', (err3, rows) => {
    if (err3) {
      console.error('Failed to load initial product stock snapshot:', err3);
      connection.initialStock = {};
      return;
    }
    connection.initialStock = {};
    rows.forEach(r => {
      // prefer initialQuantity column if present, else use quantity
      connection.initialStock[r.id] = (r.initialQuantity != null) ? Number(r.initialQuantity) : Number(r.quantity) || 0;
    });
    console.log('Initial product stock snapshot loaded:', connection.initialStock);
  });

  // --- NEW: ensure admin user exists (create if missing) ---
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPass = process.env.ADMIN_PASS || 'admin123'; // plain here; stored as SHA1() in DB
  const adminName = process.env.ADMIN_USER || 'admin';
  connection.query('SELECT id FROM users WHERE email = ?', [adminEmail], (err4, urows) => {
    if (err4) {
      console.error('Failed to check admin user existence:', err4);
      return;
    }
    if (!urows || urows.length === 0) {
      const insertSql = `INSERT INTO users (username, email, password, address, contact, role)
                         VALUES (?, ?, SHA1(?), ?, ?, 'admin')`;
      connection.query(insertSql, [adminName, adminEmail, adminPass, 'Admin address', '00000000'], (insErr) => {
        if (insErr) {
          console.error('Failed to create admin user:', insErr);
          return;
        }
        console.log('Admin user created:', adminEmail);
      });
    } else {
      console.log('Admin user already exists:', adminEmail);
    }
  });

  // Ensure avatar column exists for profile pictures
  connection.query("SHOW COLUMNS FROM users LIKE 'avatar'", (colErr, cols) => {
    if (colErr) {
      console.error('Failed to verify avatar column:', colErr);
      return;
    }
    if (!cols || !cols.length) {
      connection.query("ALTER TABLE users ADD COLUMN avatar VARCHAR(255) DEFAULT NULL", (alterErr) => {
        if (alterErr) console.error('Failed to add avatar column:', alterErr);
        else console.log('Avatar column added to users table');
      });
    }
  });
});

module.exports = connection;

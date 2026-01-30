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

  const ensureColumn = (table, column, definition) => {
    const sql = `SHOW COLUMNS FROM ${table} LIKE ?`;
    connection.query(sql, [column], (err, cols) => {
      if (err) return console.error(`Failed to verify ${table}.${column}:`, err);
      if (!cols || !cols.length) {
        connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (alterErr) => {
          if (alterErr) console.error(`Failed to add ${table}.${column}:`, alterErr);
        });
      }
    });
  };

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

  const createNetsTransactions = `
    CREATE TABLE IF NOT EXISTS nets_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      orderId INT NULL,
      txn_id VARCHAR(120) NOT NULL,
      txn_retrieval_ref VARCHAR(64),
      txn_nets_qr_id INT,
      amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) NOT NULL,
      response_code VARCHAR(10),
      network_status INT,
      txn_status INT,
      error_message VARCHAR(255),
      raw_response TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (userId),
      INDEX idx_order (orderId),
      INDEX idx_txn_ref (txn_retrieval_ref),
      INDEX idx_txn_id (txn_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  connection.query(createNetsTransactions, (errNets) => {
    if (errNets) console.error('Failed to create nets_transactions table:', errNets);
  });

  ensureColumn('orders', 'is_test', 'TINYINT(1) NOT NULL DEFAULT 0');

  const createPaypalTransactions = `
    CREATE TABLE IF NOT EXISTS paypal_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      orderId INT NULL,
      paypal_order_id VARCHAR(64) NOT NULL,
      capture_id VARCHAR(64),
      payer_id VARCHAR(64),
      payer_email VARCHAR(255),
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      status VARCHAR(30) NOT NULL,
      refund_status VARCHAR(20) NOT NULL DEFAULT 'none',
      refund_id VARCHAR(64),
      refund_response TEXT,
      raw_response TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (userId),
      INDEX idx_order (orderId),
      INDEX idx_paypal_order (paypal_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  connection.query(createPaypalTransactions, (errPaypal) => {
    if (errPaypal) console.error('Failed to create paypal_transactions table:', errPaypal);
  });

  ensureColumn('paypal_transactions', 'capture_id', 'VARCHAR(64)');
  ensureColumn('paypal_transactions', 'refund_status', "VARCHAR(20) NOT NULL DEFAULT 'none'");
  ensureColumn('paypal_transactions', 'refund_id', 'VARCHAR(64)');
  ensureColumn('paypal_transactions', 'refund_response', 'TEXT');

  const createStripeTransactions = `
    CREATE TABLE IF NOT EXISTS stripe_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      orderId INT NULL,
      session_id VARCHAR(255) NOT NULL,
      payment_intent_id VARCHAR(255),
      customer_email VARCHAR(255),
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      status VARCHAR(30) NOT NULL,
      refund_status VARCHAR(20) NOT NULL DEFAULT 'none',
      refund_id VARCHAR(255),
      refund_response TEXT,
      raw_response TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (userId),
      INDEX idx_order (orderId),
      INDEX idx_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  connection.query(createStripeTransactions, (errStripe) => {
    if (errStripe) console.error('Failed to create stripe_transactions table:', errStripe);
  });

  ensureColumn('stripe_transactions', 'refund_status', "VARCHAR(20) NOT NULL DEFAULT 'none'");
  ensureColumn('stripe_transactions', 'refund_id', 'VARCHAR(255)');
  ensureColumn('stripe_transactions', 'refund_response', 'TEXT');

  const createWalletTransactions = `
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      orderId INT NULL,
      type VARCHAR(20) NOT NULL,
      method VARCHAR(20) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) NOT NULL,
      note VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (userId),
      INDEX idx_order (orderId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  connection.query(createWalletTransactions, (errWallet) => {
    if (errWallet) console.error('Failed to create wallet_transactions table:', errWallet);
  });

  ensureColumn('users', 'wallet_balance', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
  ensureColumn('users', 'wallet_pin', 'VARCHAR(64)');

  // Set default wallet PIN for existing users (0000)
  connection.query("UPDATE users SET wallet_pin = SHA1('0000') WHERE wallet_pin IS NULL", (pinErr) => {
    if (pinErr) console.error('Failed to set default wallet PIN:', pinErr);
  });

  const createRefundRequests = `
    CREATE TABLE IF NOT EXISTS refund_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      orderId INT NOT NULL,
      userId INT NOT NULL,
      method VARCHAR(20) NOT NULL,
      reason VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      admin_message VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP NULL,
      INDEX idx_order (orderId),
      INDEX idx_user (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  connection.query(createRefundRequests, (errRefund) => {
    if (errRefund) console.error('Failed to create refund_requests table:', errRefund);
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

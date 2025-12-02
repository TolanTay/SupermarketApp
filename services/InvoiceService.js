const fs = require('fs');
const path = require('path');

module.exports = {
  formatHtml: (order, items) => `<h1>Invoice #${order.id}</h1><p>Total: $${order.total}</p>`,

  save: (userId, html, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'invoices');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `invoice_user${userId}_${Date.now()}.html`);
    fs.writeFile(f, html, 'utf8', err => cb(err, f));
  }
};
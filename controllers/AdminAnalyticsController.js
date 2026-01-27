const db = require('../db');

const AdminAnalyticsController = {
  dashboard: (req, res) => {
    // Query 1: top selling products by total quantity sold
    const topByQty = `
      SELECT oi.productId, oi.productName, SUM(oi.quantity) AS totalQty, COUNT(DISTINCT oi.orderId) AS orderCount
      FROM order_items oi
      JOIN orders o ON o.id = oi.orderId
      WHERE o.is_test = 0
      GROUP BY oi.productId, oi.productName
      ORDER BY totalQty DESC
      LIMIT 10
    `;

    // Query 2: top revenue products
    const topByRevenue = `
      SELECT oi.productId, oi.productName, SUM(oi.subtotal) AS totalRevenue, SUM(oi.quantity) AS totalQty
      FROM order_items oi
      JOIN orders o ON o.id = oi.orderId
      WHERE o.is_test = 0
      GROUP BY oi.productId, oi.productName
      ORDER BY totalRevenue DESC
      LIMIT 10
    `;

    // Query 3: recent orders summary
    const recentOrders = `
      SELECT o.id, o.userId, u.username, o.total, o.created_at, COUNT(oi.id) AS itemCount
      FROM orders o
      LEFT JOIN users u ON u.id = o.userId
      LEFT JOIN order_items oi ON oi.orderId = o.id
      WHERE o.is_test = 0
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 20
    `;

    db.query(topByQty, (e1, r1) => {
      if (e1) { console.error(e1); req.flash('error','Failed to load analytics'); return res.redirect('/shopping'); }
      db.query(topByRevenue, (e2, r2) => {
        if (e2) { console.error(e2); req.flash('error','Failed to load analytics'); return res.redirect('/shopping'); }
        db.query(recentOrders, (e3, r3) => {
          if (e3) { console.error(e3); req.flash('error','Failed to load analytics'); return res.redirect('/shopping'); }
          const orderList = r3 || [];
          const orderIds = orderList.map(o => o.id);
          if (!orderIds.length) {
            return res.render('admin/analytics', {
              user: req.session.user,
              messages: req.flash(),
              topByQty: r1 || [],
              topByRevenue: r2 || [],
              recentOrders: orderList,
              orderItems: {}
            });
          }
          const placeholders = orderIds.map(() => '?').join(',');
          const itemsSql = `
            SELECT id, orderId, productId, productName, quantity, base_price, discount_rate, unit_price_after_discount, subtotal
            FROM order_items
            WHERE orderId IN (${placeholders})
            ORDER BY orderId DESC, id ASC
          `;
          db.query(itemsSql, orderIds, (e4, r4) => {
            if (e4) { console.error(e4); req.flash('error','Failed to load analytics'); return res.redirect('/shopping'); }
            const orderItems = {};
            (r4 || []).forEach(it => {
              if (!orderItems[it.orderId]) orderItems[it.orderId] = [];
              orderItems[it.orderId].push(it);
            });
            res.render('admin/analytics', {
              user: req.session.user,
              messages: req.flash(),
              topByQty: r1 || [],
              topByRevenue: r2 || [],
              recentOrders: orderList,
              orderItems
            });
          });
        });
      });
    });
  }
};

module.exports = AdminAnalyticsController;

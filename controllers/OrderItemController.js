const OrderItem = require('../models/OrderItem');

const OrderItemController = {
  listByOrder: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) return res.status(400).json({ error: 'Invalid order id' });
    OrderItem.listByOrder(orderId, (err, items) => {
      if (err) return res.status(500).json({ error: 'Failed to load order items' });
      return res.json({ items });
    });
  }
};

module.exports = OrderItemController;

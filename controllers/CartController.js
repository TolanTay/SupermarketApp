const Cart = require('../models/Cart');

const CartController = {
  viewCart: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) return res.redirect('/login');
    Cart.getUserCart(uid, (err, rows) => {
      if (err) { console.error(err); req.flash('error','DB error'); return res.redirect('/shopping'); }
      const items = (rows || []).map(r => ({
        productId: r.productId,
        name: r.productName,
        image: r.image,
        quantity: r.quantity,
        price: Number(r.price),
        subtotal: Number((r.price * r.quantity).toFixed(2))
      }));
      const total = items.reduce((s,i) => s + i.subtotal, 0);
      res.render('cart', { cartItems: items, total, user: req.session.user, messages: req.flash() });
    });
  },

  addToCart: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) { req.flash('error','Please login'); return res.redirect('/login'); }
    const productId = parseInt(req.params.id,10);
    const qty = Math.max(1, parseInt(req.body.quantity,10) || 1);

    const skipStock = req.session.user && req.session.user.role === 'admin';
    Cart.addToCart(uid, productId, qty, (err, result) => {
      if (err) {
        console.error('addToCart error', err);
        req.flash('error', err.message || 'Failed to add to cart');
        return res.redirect(req.get('Referer') || '/shopping');
      }
      req.flash('success','Added to cart');
      return res.redirect(req.get('Referer') || '/shopping');
    }, { skipStock });
  },

  updateItem: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) { req.flash('error','Please login'); return res.redirect('/login'); }
    const productId = parseInt(req.params.id,10);
    const newQty = parseInt(req.body.quantity,10);
    if (!Number.isInteger(newQty) || newQty < 1) return CartController.removeItem(req, res);

    const skipStock = req.session.user && req.session.user.role === 'admin';
    Cart.updateCartQuantity(uid, productId, newQty, (err) => {
      if (err) {
        console.error('updateItem error', err);
        req.flash('error', err.message || 'Failed to update cart item');
      }
      return res.redirect('/cart');
    }, { skipStock });
  },

  removeItem: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) { req.flash('error','Please login'); return res.redirect('/login'); }
    const productId = parseInt(req.params.id,10);

    const skipStock = req.session.user && req.session.user.role === 'admin';
    Cart.removeFromCart(uid, productId, (err) => {
      if (err) {
        console.error('removeItem error', err);
        req.flash('error', err.message || 'Failed to remove item');
      }
      return res.redirect('/cart');
    }, { skipStock });
  }
};

module.exports = CartController;

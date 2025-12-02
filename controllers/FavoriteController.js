const Favorite = require('../models/Favorite');

const FavoriteController = {
  toggle: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) { req.flash('error','Please login'); return res.redirect('/login'); }
    const productId = parseInt(req.params.id, 10);
    Favorite.toggle(uid, productId, (err, info) => {
      if (err) {
        console.error('toggle favorite error', err);
        req.flash('error', 'Failed to update favourites');
        return res.redirect(req.get('Referer') || '/shopping');
      }
      if (req.xhr || req.get('Accept')?.includes('application/json')) {
        return res.json({ success: true, action: info.action });
      }
      req.flash('success', info.action === 'added' ? 'Added to favourites' : 'Removed from favourites');
      return res.redirect(req.get('Referer') || '/shopping');
    });
  },

  listForUser: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    Favorite.listForUser(uid, (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to load favourites' });
      res.json({ favorites: rows || [] });
    });
  }
};

module.exports = FavoriteController;

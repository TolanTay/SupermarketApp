module.exports = {
  checkAuthenticated: (req, res, next) => {
    if (req.session && req.session.user) return next();
    req.flash('error', 'Please log in to view this resource');
    return res.redirect('/login');
  },

  checkAdmin: (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
    req.flash('error', 'Access denied');
    return res.redirect('/shopping');
  }
};
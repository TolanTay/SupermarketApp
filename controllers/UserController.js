const User = require('../models/User');

const UserController = {
  list: (req, res) => {
    User.getAll((err, users) => {
      if (err) { req.flash('error', 'Failed to load users'); return res.redirect('/shopping'); }
      res.render('admin/users', { users, user: req.session.user, messages: req.flash() });
    });
  },

  create: (req, res) => {
    const { username, email, password, address, contact, role } = req.body;
    if (!username || !email || !password) {
      req.flash('error', 'Username, email and password are required');
      return res.redirect('/admin/users');
    }
    User.create({ username, email, password, address, contact, role: role || 'user' }, (err) => {
      if (err) { req.flash('error', 'Failed to create user'); }
      else { req.flash('success', 'User created'); }
      return res.redirect('/admin/users');
    });
  },

  update: (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { username, email, address, contact, password, role } = req.body;
    User.update(id, { username, email, address, contact, password, role }, (err) => {
      if (err) { req.flash('error', 'Failed to update user'); }
      else { req.flash('success', 'User updated'); }
      return res.redirect('/admin/users');
    });
  },

  delete: (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (req.session.user && req.session.user.id === id) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect('/admin/users');
    }
    User.remove(id, (err) => {
      if (err) { req.flash('error', 'Failed to delete user'); }
      else { req.flash('success', 'User deleted'); }
      return res.redirect('/admin/users');
    });
  }
};

module.exports = UserController;

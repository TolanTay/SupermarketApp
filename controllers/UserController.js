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
  },

  profile: (req, res) => {
    const uid = req.session.user?.id;
    if (!uid) return res.redirect('/login');
    User.findById(uid, (err, u) => {
      if (err || !u) {
        req.flash('error', 'Unable to load profile');
        return res.redirect('/shopping');
      }
      res.render('profile', { user: req.session.user, profile: u, messages: req.flash() });
    });
  },

  updateProfile: (req, res) => {
    const uid = req.session.user?.id;
    if (!uid) return res.redirect('/login');
    const { username, email, address, contact, password } = req.body;

    const errors = [];
    if (!username || !username.trim()) errors.push('Username is required');
    if (!email || !email.includes('@')) errors.push('Valid email is required');
    if (contact && !/^[0-9+\-\s()]{4,20}$/.test(contact)) errors.push('Contact number looks invalid');

    if (errors.length) {
      errors.forEach(e => req.flash('error', e));
      return res.redirect('/profile');
    }

    User.findById(uid, (err, existing) => {
      if (err || !existing) {
        req.flash('error', 'Unable to update profile');
        return res.redirect('/profile');
      }

      const payload = {
        username: username || existing.username,
        email: email || existing.email,
        address: typeof address !== 'undefined' ? address : existing.address,
        contact: typeof contact !== 'undefined' ? contact : existing.contact,
        avatar: existing.avatar || null,
        password
      };

      if (req.file && req.file.filename) {
        payload.avatar = req.file.filename;
      }

      User.updateProfile(uid, payload, (updErr) => {
        if (updErr) {
          req.flash('error', 'Failed to save profile');
          return res.redirect('/profile');
        }
        req.session.user = {
          ...req.session.user,
          username: payload.username,
          avatar: payload.avatar || null
        };
        req.flash('success', 'Profile updated');
        return res.redirect('/profile');
      });
    });
  },

  adminProfile: (req, res) => {
    const id = parseInt(req.params.id, 10);
    User.findById(id, (err, target) => {
      if (err || !target) {
        req.flash('error', 'User not found');
        return res.redirect('/admin/users');
      }
      res.render('admin/editUserProfile', { target, user: req.session.user, messages: req.flash() });
    });
  },

  adminUpdateProfile: (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { username, email, address, contact, password, role } = req.body;

    const errors = [];
    if (!username || !username.trim()) errors.push('Username is required');
    if (!email || !email.includes('@')) errors.push('Valid email is required');
    if (contact && !/^[0-9+\-\s()]{4,20}$/.test(contact)) errors.push('Contact number looks invalid');

    if (errors.length) {
      errors.forEach(e => req.flash('error', e));
      return res.redirect(`/admin/users/${id}/profile`);
    }

    User.findById(id, (err, existing) => {
      if (err || !existing) {
        req.flash('error', 'User not found');
        return res.redirect('/admin/users');
      }

      const payload = {
        username: username || existing.username,
        email: email || existing.email,
        address: typeof address !== 'undefined' ? address : existing.address,
        contact: typeof contact !== 'undefined' ? contact : existing.contact,
        avatar: existing.avatar || null,
        role: role || existing.role,
        password
      };

      if (req.file && req.file.filename) {
        payload.avatar = req.file.filename;
      }

      User.update(id, payload, (updErr) => {
        if (updErr) {
          req.flash('error', 'Failed to update user');
          return res.redirect(`/admin/users/${id}/profile`);
        }

        // If admin updated themselves, refresh session
        if (req.session.user && req.session.user.id === id) {
          req.session.user = {
            ...req.session.user,
            username: payload.username,
            role: payload.role,
            avatar: payload.avatar || null
          };
        }

        req.flash('success', 'User updated');
        return res.redirect(`/admin/users/${id}/profile`);
      });
    });
  }
};

module.exports = UserController;

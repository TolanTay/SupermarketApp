const db = require('../db');
const User = require('../models/User');

module.exports = {
  showLogin: (req, res) => {
    res.render('login', { messages: req.flash(), user: req.session.user });
  },

  showRegister: (req, res) => {
    const formData = req.session.formData || {};
    delete req.session.formData;
    res.render('register', { messages: req.flash(), user: req.session.user, formData });
  },

  register: (req, res) => {
    const { username, password, email, address, contact } = req.body;

    const errors = [];
    if (!username || !username.trim()) errors.push('Username is required');
    if (!password || password.length < 4) errors.push('Password must be at least 4 characters');
    if (!email || !email.includes('@')) errors.push('Valid email is required');
    // optional but helpful validation
    if (contact && !/^[0-9+\-\s()]{4,20}$/.test(contact)) errors.push('Contact number looks invalid');

    if (errors.length) {
      req.session.formData = { username: username || '', email: email || '', address: address || '', contact: contact || '' };
      errors.forEach(e => req.flash('error', e));
      return res.redirect('/register');
    }

    // check existing username/email before insert
    db.query('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email], (checkErr, rows) => {
      if (checkErr) {
        console.error('User existence check failed:', checkErr);
        req.flash('error', 'Server error, try again later.');
        req.session.formData = { username: username || '', email: email || '', address: address || '', contact: contact || '' };
        return res.redirect('/register');
      }
      if (rows && rows.length) {
        req.session.formData = { username: username || '', email: email || '', address: address || '', contact: contact || '' };
        req.flash('error', 'Username or email already in use.');
        return res.redirect('/register');
      }

      User.create({ username, email, password, address: address || null, contact: contact || null }, (err) => {
        if (err) {
          console.error('User.create error:', err);
          req.session.formData = { username: username || '', email: email || '', address: address || '', contact: contact || '' };
          req.flash('error', 'Registration failed. Try again or choose a different username/email.');
          return res.redirect('/register');
        }
        delete req.session.formData;
        req.flash('success', 'Account created successfully. Please login.');
        return res.redirect('/login');
      });
    });
  },

  login: (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      req.flash('error', 'Provide username and password');
      return res.redirect('/login');
    }
    User.findByCredentials(username, password, (err, user) => {
      if (err || !user) {
        req.flash('error', 'Invalid credentials');
        return res.redirect('/login');
      }
      req.session.user = { id: user.id, username: user.username, role: user.role };
      return res.redirect('/shopping');
    });
  },

  logout: (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  }
};
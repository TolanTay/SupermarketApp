const db = require('../db');
const path = require('path');
const fs = require('fs');
const Product = require('../models/Product');

const ProductController = {
    // Shopping page (user) - supports direct category filter, sorting, search and favourite flag
    getShoppingProducts: (req, res) => {
        // include search q
        const filters = { category: req.query.category || '', sort: req.query.sort || '', q: (req.query.q || '').trim() };
        const uid = req.session.user && req.session.user.id;

        // If there's a free-text search query, run a simple LIKE search (includes favourite flag)
        if (filters.q) {
            const qLike = '%' + filters.q + '%';
        const sql = `
              SELECT p.*, 
                     (p.price * (1 - COALESCE(p.discount_rate,0)/100)) AS effective_price,
                     (f.userId IS NOT NULL) AS isFavorited
              FROM products p
              LEFT JOIN favorites f ON f.productId = p.id AND f.userId = ?
              WHERE p.productName LIKE ? OR p.description LIKE ?
              ORDER BY effective_price ASC, p.id ASC
            `;
            db.query(sql, [uid || null, qLike, qLike], (err, rows) => {
              if (err) { console.error('Search error', err); req.flash('error','DB error'); return res.redirect('/'); }
            const products = (rows || []).map(r => {
                const basePrice = +r.price;
                const discountRate = +r.discount_rate || 0;
                const discountedPrice = +(basePrice * (1 - (discountRate/100))).toFixed(2);
                return {
                    id: r.id,
                    productName: r.productName,
                    image: r.image,
                    price: basePrice,
                    discount: discountRate,
                    discountedPrice,
                    quantity: r.quantity,
                    description: r.description,
                    category: r.category,
                    isFavorited: !!r.isFavorited
                };
            });
            return res.render('shopping', { products, user: req.session.user, filter: filters, messages: req.flash() });
          });
          return;
        }

        // default listing (no free-text search) delegates to Product model
        Product.getAll(filters, uid, (err, rows) => {
            if (err) { req.flash('error','DB error'); return res.redirect('/'); }
            const products = (rows || []).map(r => {
                const basePrice = +r.price;
                const discountRate = +r.discount_rate || 0;
                const discountedPrice = +(basePrice * (1 - (discountRate/100))).toFixed(2);
                return {
                    id: r.id,
                    productName: r.productName,
                    image: r.image,
                    price: basePrice,
                    discount: discountRate,
                    discountedPrice,
                    quantity: r.quantity,
                    description: r.description,
                    category: r.category,
                    isFavorited: !!r.isFavorited
                };
            });
            res.render('shopping', { products, user: req.session.user, filter: filters, messages: req.flash() });
        });
    },

    // Show add product form
    showAddProduct: (req, res) => {
        res.render('addProduct', { user: req.session.user });
    },

    // Add new product (persist category)
    addProduct: (req, res) => {
        const data = {
            name: req.body.name,
            price: parseFloat(req.body.price) || 0,
            description: req.body.description || null,
            quantity: parseInt(req.body.quantity,10) || 0,
            discount: parseFloat(req.body.discount) || 0,
            image: req.file ? req.file.filename : null,
            category: req.body.category || null
        };
        Product.create(data, (err) => {
            if (err) { req.flash('error','Failed to add product'); return res.redirect('/addProduct'); }
            req.flash('success','Product added'); return res.redirect('/shopping');
        });
    },

    // Show update form
    showUpdateProduct: (req, res) => {
        Product.getById(req.params.id, (err, product) => {
            if (err || !product) { req.flash('error','Product not found'); return res.redirect('/shopping'); }
            res.render('updateProduct', { product, user: req.session.user, messages: req.flash() });
        });
    },

    // Update product (allow changing category)
    updateProduct: (req, res) => {
        const upd = {
            name: req.body.name,
            price: req.body.price !== undefined ? parseFloat(req.body.price) : undefined,
            quantity: req.body.quantity !== undefined ? parseInt(req.body.quantity,10) : undefined,
            discount: req.body.discount !== undefined ? parseFloat(req.body.discount) : undefined,
            image: req.file ? req.file.filename : undefined,
            category: req.body.category !== undefined ? req.body.category : undefined,
            description: req.body.description
        };
        Product.update(req.params.id, upd, (err) => {
            if (err) { req.flash('error','Update failed'); return res.redirect('/updateProduct/' + req.params.id); }
            req.flash('success','Product updated'); return res.redirect('/shopping');
        });
    },

    // Delete product
    deleteProduct: (req, res) => {
        Product.remove(req.params.id, (err) => {
            if (err) { req.flash('error','Delete failed'); }
            else { req.flash('success','Product deleted'); }
            return res.redirect('/shopping');
        });
    },

    // Product details
    getProductById: (req, res) => {
        Product.getById(req.params.id, (err, p) => {
            if (err || !p) { req.flash('error','Product not found'); return res.redirect('/shopping'); }
            res.render('product', { product: p, user: req.session.user });
        });
    },

    // Search products (AJAX)
    searchProducts: (req, res) => {
        const query = req.query.q || '';
        if (!query) {
            return res.json({ results: [] });
        }
        const sql = 'SELECT * FROM products WHERE productName LIKE ? OR description LIKE ? LIMIT 10';
        const params = ['%' + query + '%', '%' + query + '%'];
        db.query(sql, params, (err, rows) => {
            if (err) {
                console.error('Failed to search products:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            const results = rows.map(r => {
                const price = (typeof r.price === 'number' ? r.price : parseFloat(r.price) || 0);
                const discount = (r.discount_rate != null) ? parseFloat(r.discount_rate) : 0;
                const discountedPrice = +(price * (1 - (discount / 100))).toFixed(2);
                return {
                    id: r.id,
                    productName: r.productName || r.name || '',
                    name: r.name || r.productName || '',
                    image: r.image || null,
                    quantity: (r.quantity != null ? r.quantity : (r.stock != null ? r.stock : 0)),
                    price,
                    discount,
                    discountedPrice,
                    description: r.description || ''
                };
            });
            res.json({ results });
        });
    },

    // Upload product image (AJAX)
    uploadImage: (req, res) => {
        const id = req.params.id;
        const image = req.file ? req.file.filename : null;
        if (!image) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }
        db.query('UPDATE products SET image = ? WHERE id = ?', [image, id], (err) => {
            if (err) {
                console.error('Failed to update product image:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true, image });
        });
    },

    // Remove product image (AJAX)
    removeImage: (req, res) => {
        const id = req.params.id;
        db.query('SELECT image FROM products WHERE id = ?', [id], (err, rows) => {
            if (err) {
                console.error('Failed to get product image for remove:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            const image = (rows && rows[0]) ? rows[0].image : null;
            if (image) {
                const imgPath = path.join(__dirname, '..', 'public', 'images', image);
                fs.unlink(imgPath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error('Failed to unlink image file:', unlinkErr);
                        return res.status(500).json({ error: 'Failed to remove image file' });
                    }
                    // Update database record
                    db.query('UPDATE products SET image = NULL WHERE id = ?', [id], (dbErr) => {
                        if (dbErr) {
                            console.error('Failed to update product image record:', dbErr);
                            return res.status(500).json({ error: 'Database error' });
                        }
                        res.json({ success: true });
                    });
                });
            } else {
                // No image found, just update the database
                db.query('UPDATE products SET image = NULL WHERE id = ?', [id], (dbErr) => {
                    if (dbErr) {
                        console.error('Failed to update product image record:', dbErr);
                        return res.status(500).json({ error: 'Database error' });
                    }
                    res.json({ success: true });
                });
            }
        });
    }
};

module.exports = ProductController;

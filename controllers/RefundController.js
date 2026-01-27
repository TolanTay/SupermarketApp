const Order = require('../models/Order');
const PaypalTransaction = require('../models/PaypalTransaction');
const NetsTransaction = require('../models/NetsTransaction');
const RefundRequest = require('../models/RefundRequest');
const PaypalService = require('../services/PaypalService');
const Wallet = require('../models/Wallet');

const RefundController = {
  create: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) return res.redirect('/login');
    const orderId = parseInt(req.params.orderId, 10);
    const reason = String(req.body.reason || '').trim();
    if (!orderId || !reason) {
      req.flash('error', 'Refund reason is required.');
      return res.redirect('/history');
    }

    Order.getByUserGrouped(uid, (err, rows) => {
      if (err) {
        req.flash('error', 'Unable to validate order');
        return res.redirect('/history');
      }
      const ownsOrder = (rows || []).some(r => r.orderId === orderId);
      if (!ownsOrder) {
        req.flash('error', 'Order not found');
        return res.redirect('/history');
      }

      RefundRequest.getByOrderId(orderId, (rErr, existing) => {
        if (rErr) {
          req.flash('error', 'Failed to create refund request');
          return res.redirect('/history');
        }
        if (existing) {
          req.flash('error', 'Refund already requested for this order');
          return res.redirect('/history');
        }

        PaypalTransaction.getByOrderId(orderId, (pErr, pTxn) => {
          if (pErr) {
            req.flash('error', 'Failed to create refund request');
            return res.redirect('/history');
          }
          NetsTransaction.getByOrderId(orderId, (nErr, nTxn) => {
            if (nErr) {
              req.flash('error', 'Failed to create refund request');
              return res.redirect('/history');
            }
            Wallet.getPaymentByOrderIds([orderId], (wErr, wRows) => {
              if (wErr) {
                req.flash('error', 'Failed to create refund request');
                return res.redirect('/history');
              }
              const wTxn = wRows && wRows[0];
              const method = pTxn ? 'paypal' : (nTxn ? 'nets' : (wTxn ? 'wallet' : null));
              if (!method) {
                req.flash('error', 'No payment method found for this order');
                return res.redirect('/history');
              }

              RefundRequest.create({ orderId, userId: uid, method, reason }, (cErr) => {
                if (cErr) {
                  req.flash('error', 'Failed to create refund request');
                } else {
                  req.flash('success', 'Refund request submitted');
                }
                return res.redirect('/history');
              });
            });
          });
        });
      });
    });
  },

  adminApprove: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/orders');
    }
    RefundRequest.getByOrderId(orderId, (err, reqRow) => {
      if (err || !reqRow) {
        req.flash('error', 'Refund request not found');
        return res.redirect('/admin/orders');
      }
      if (reqRow.status !== 'pending') {
        req.flash('success', 'Refund already processed');
        return res.redirect('/admin/orders');
      }

      if (reqRow.method === 'paypal') {
        PaypalTransaction.getByOrderId(orderId, (pErr, txn) => {
          if (pErr || !txn || !txn.capture_id) {
            req.flash('error', 'No PayPal capture found');
            return res.redirect('/admin/orders');
          }
          PaypalService.refundCapture(txn.capture_id, txn.amount).then((refund) => {
            PaypalTransaction.updateRefund(txn.id, {
              refund_status: refund && refund.status ? refund.status.toLowerCase() : 'refunded',
              refund_id: refund.id,
              refund_response: JSON.stringify(refund)
            }, () => {});
            RefundRequest.updateStatus(reqRow.id, { status: 'approved', admin_message: 'PayPal refund issued' }, () => {
              req.flash('success', 'Refund approved');
              return res.redirect('/admin/orders');
            });
          }).catch((rErr) => {
            RefundRequest.updateStatus(reqRow.id, { status: 'rejected', admin_message: 'PayPal refund failed' }, () => {
              req.flash('error', 'PayPal refund failed');
              return res.redirect('/admin/orders');
            });
          });
        });
      } else if (reqRow.method === 'nets') {
        Order.getWithItems(orderId, (oErr, rows) => {
          if (oErr || !rows || !rows.length) {
            req.flash('error', 'Order not found');
            return res.redirect('/admin/orders');
          }
          const order = { id: rows[0].orderId, userId: rows[0].userId, total: Number(rows[0].total) };
          Wallet.credit(order.userId, order.total, {
            type: 'refund',
            method: 'nets',
            status: 'completed',
            note: `NETS refund for order #${orderId}`
          }, (wErr) => {
            if (wErr) {
              req.flash('error', 'Failed to refund to wallet');
              return res.redirect('/admin/orders');
            }
            NetsTransaction.getByOrderId(orderId, (nErr, txn) => {
              if (!nErr && txn && txn.txn_retrieval_ref) {
                NetsTransaction.updateByTxnRef(txn.txn_retrieval_ref, { status: 'refunded_wallet' }, () => {});
              }
            });
            RefundRequest.updateStatus(reqRow.id, { status: 'approved', admin_message: 'Refunded to wallet' }, () => {
              req.flash('success', 'Refund approved');
              return res.redirect('/admin/orders');
            });
          });
        });
      } else if (reqRow.method === 'wallet') {
        Order.getWithItems(orderId, (oErr, rows) => {
          if (oErr || !rows || !rows.length) {
            req.flash('error', 'Order not found');
            return res.redirect('/admin/orders');
          }
          const order = { id: rows[0].orderId, userId: rows[0].userId, total: Number(rows[0].total) };
          Wallet.credit(order.userId, order.total, {
            type: 'refund',
            method: 'wallet',
            status: 'completed',
            note: `Wallet refund for order #${orderId}`
          }, (wErr) => {
            if (wErr) {
              req.flash('error', 'Failed to refund to wallet');
              return res.redirect('/admin/orders');
            }
            RefundRequest.updateStatus(reqRow.id, { status: 'approved', admin_message: 'Refunded to wallet' }, () => {
              req.flash('success', 'Refund approved');
              return res.redirect('/admin/orders');
            });
          });
        });
      } else {
        req.flash('error', 'Unsupported refund method');
        return res.redirect('/admin/orders');
      }
    });
  },

  adminReject: (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    const message = String(req.body.admin_message || '').trim();
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/orders');
    }
    RefundRequest.getByOrderId(orderId, (err, reqRow) => {
      if (err || !reqRow) {
        req.flash('error', 'Refund request not found');
        return res.redirect('/admin/orders');
      }
      if (reqRow.status !== 'pending') {
        req.flash('success', 'Refund already processed');
        return res.redirect('/admin/orders');
      }
      RefundRequest.updateStatus(reqRow.id, { status: 'rejected', admin_message: message || 'Rejected' }, () => {
        req.flash('success', 'Refund rejected');
        return res.redirect('/admin/orders');
      });
    });
  }
};

module.exports = RefundController;

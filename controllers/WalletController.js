const Wallet = require('../models/Wallet');
const NetsQrService = require('../services/NetsQrService');
const PaypalService = require('../services/PaypalService');
const PaypalTransaction = require('../models/PaypalTransaction');
const NetsTransaction = require('../models/NetsTransaction');

const WalletController = {
  show: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) return res.redirect('/login');
    Wallet.getBalance(uid, (err, balance) => {
      if (err) {
        console.error('wallet show balance error', err);
        req.flash('error', 'Failed to load wallet');
        return res.redirect('/shopping');
      }
      Wallet.getTransactionsByUser(uid, (tErr, rows) => {
        if (tErr) console.error('wallet transactions error', tErr);
        res.render('wallet', { balance, transactions: rows || [], user: req.session.user, messages: req.flash() });
      });
    });
  },

  topupNets: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) return res.redirect('/login');
    const amount = Number(req.body.amount);
    if (!amount || amount < 10) {
      req.flash('error', 'Minimum top-up amount is $10.');
      return res.redirect('/wallet');
    }

    const txn_id = process.env.NETS_TXN_ID || 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b';
    NetsQrService.requestQr({
      txn_id,
      amt_in_dollars: Number(amount.toFixed(2)),
      notify_mobile: 0
    }).then((response) => {
      const data = response && response.result && response.result.data;
      if (!data || !data.qr_code || !data.txn_retrieval_ref) {
        req.flash('error', 'Failed to generate NETS QR.');
        return res.redirect('/wallet');
      }

      req.session.netsPending = {
        type: 'wallet_topup',
        amount,
        txn_id,
        txn_retrieval_ref: data.txn_retrieval_ref,
        txn_nets_qr_id: data.txn_nets_qr_id
      };

      NetsTransaction.createPending({
        userId: uid,
        txn_id,
        txn_retrieval_ref: data.txn_retrieval_ref,
        txn_nets_qr_id: data.txn_nets_qr_id,
        amount,
        status: 'pending',
        response_code: data.response_code,
        network_status: data.network_status,
        txn_status: data.txn_status,
        raw_response: JSON.stringify(response)
      }, (logErr, netsTxnId) => {
        if (logErr) console.error('wallet topup log error', logErr);
        if (req.session && req.session.netsPending) req.session.netsPending.netsTxnId = netsTxnId;
        res.render('nets-qr', {
          qrCodeBase64: data.qr_code,
          txnRetrievalRef: data.txn_retrieval_ref,
          total: amount,
          user: req.session.user
        });
      });
    }).catch((err) => {
      console.error('wallet topup nets error', err);
      req.flash('error', 'Failed to connect to NETS QR service.');
      res.redirect('/wallet');
    });
  },

  createPaypalTopup: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const amount = Number(req.body.amount);
    if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum top-up amount is $10.' });

    PaypalService.createOrder(amount).then((order) => {
      if (!order || !order.id) return res.status(500).json({ error: 'Failed to create PayPal order' });
      req.session.paypalTopupPending = { amount };
      res.json({ id: order.id });
    }).catch((err) => {
      console.error('createPaypalTopup error', err);
      res.status(500).json({ error: 'PayPal create order failed' });
    });
  },

  capturePaypalTopup: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { orderID } = req.body;
    if (!orderID) return res.status(400).json({ error: 'Missing orderID' });
    const pending = req.session.paypalTopupPending;
    if (!pending || !pending.amount) return res.status(400).json({ error: 'No pending PayPal top-up' });

    PaypalService.captureOrder(orderID).then((capture) => {
      if (!capture || capture.status !== 'COMPLETED') {
        return res.status(400).json({ error: 'Payment not completed', details: capture });
      }

      const purchaseUnit = capture.purchase_units && capture.purchase_units[0];
      const captureInfo = purchaseUnit && purchaseUnit.payments && purchaseUnit.payments.captures && purchaseUnit.payments.captures[0];
      const amountInfo = captureInfo && captureInfo.amount ? captureInfo.amount : { value: pending.amount, currency_code: 'SGD' };

      Wallet.credit(uid, Number(amountInfo.value), {
        type: 'topup',
        method: 'paypal',
        status: 'completed',
        note: 'PayPal top-up'
      }, (wErr) => {
        if (wErr) {
          console.error('wallet topup credit error', wErr);
          return res.status(500).json({ error: 'Failed to credit wallet' });
        }
        Wallet.getBalance(uid, (bErr, balance) => {
          if (!bErr && req.session && req.session.user) {
            req.session.user.wallet_balance = Number(balance || 0);
          }
        });

        PaypalTransaction.create({
          userId: uid,
          orderId: null,
          paypal_order_id: capture.id,
          capture_id: captureInfo && captureInfo.id,
          payer_id: capture.payer && capture.payer.payer_id,
          payer_email: capture.payer && capture.payer.email_address,
          amount: Number(amountInfo.value),
          currency: amountInfo.currency_code || 'SGD',
          status: capture.status,
          refund_status: 'none',
          raw_response: JSON.stringify(capture)
        }, (logErr) => {
          if (logErr) console.error('paypal topup log error', logErr);
          req.session.paypalTopupPending = null;
          res.json({ success: true });
        });
      });
    }).catch((err) => {
      console.error('capturePaypalTopup error', err);
      res.status(500).json({ error: 'PayPal capture failed' });
    });
  }
  ,

  adminTopup: (req, res) => {
    const uid = req.session.user && req.session.user.id;
    const isAdmin = req.session.user && req.session.user.role === 'admin';
    if (!uid || !isAdmin) return res.redirect('/wallet');
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      req.flash('error', 'Enter a valid amount.');
      return res.redirect('/wallet');
    }
    Wallet.credit(uid, amount, {
      type: 'topup',
      method: 'admin',
      status: 'completed',
      note: 'Admin test top-up'
    }, (err) => {
      if (err) console.error('admin topup error', err);
      req.flash('success', 'Admin top-up added.');
      return res.redirect('/wallet');
    });
  }
};

module.exports = WalletController;

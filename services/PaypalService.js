const https = require('https');

const getPaypalHost = () => {
  const api = process.env.PAYPAL_API || 'https://api.sandbox.paypal.com';
  return new URL(api);
};

const requestJson = (options, body) => new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    let raw = '';
    res.on('data', (chunk) => { raw += chunk; });
    res.on('end', () => {
      let parsed = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch (e) {
        return reject(new Error('Invalid JSON response from PayPal'));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const err = new Error(`PayPal API error ${res.statusCode}`);
        err.response = parsed;
        return reject(err);
      }
      return resolve(parsed);
    });
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const getAccessToken = async () => {
  const url = getPaypalHost();
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const body = 'grant_type=client_credentials';
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: `${url.pathname.replace(/\/$/, '')}/v1/oauth2/token`,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  const data = await requestJson(options, body);
  return data.access_token;
};

const createOrder = async (amount) => {
  const token = await getAccessToken();
  const url = getPaypalHost();
  const body = JSON.stringify({
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'SGD',
        value: Number(amount).toFixed(2)
      }
    }]
  });
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: `${url.pathname.replace(/\/$/, '')}/v2/checkout/orders`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  return requestJson(options, body);
};

const captureOrder = async (orderId) => {
  const token = await getAccessToken();
  const url = getPaypalHost();
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: `${url.pathname.replace(/\/$/, '')}/v2/checkout/orders/${orderId}/capture`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  return requestJson(options);
};

const refundCapture = async (captureId, amount) => {
  const token = await getAccessToken();
  const url = getPaypalHost();
  const body = amount ? JSON.stringify({ amount: { value: Number(amount).toFixed(2), currency_code: 'SGD' } }) : '';
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: `${url.pathname.replace(/\/$/, '')}/v2/payments/captures/${captureId}/refund`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  return requestJson(options, body);
};

module.exports = { createOrder, captureOrder, refundCapture };

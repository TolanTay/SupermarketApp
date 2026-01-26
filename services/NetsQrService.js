const https = require('https');

const NETS_BASE_URL = 'https://sandbox.nets.openapipaas.com';

const postJson = (path, body, headers) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const options = {
    method: 'POST',
    hostname: new URL(NETS_BASE_URL).hostname,
    path,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      ...headers
    }
  };

  const req = https.request(options, (res) => {
    let raw = '';
    res.on('data', (chunk) => { raw += chunk; });
    res.on('end', () => {
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch (e) {
        return reject(new Error('Invalid JSON response from NETS'));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const err = new Error(`NETS API error ${res.statusCode}`);
        err.response = parsed;
        return reject(err);
      }
      return resolve(parsed);
    });
  });

  req.on('error', reject);
  req.write(data);
  req.end();
});

const buildHeaders = () => {
  const apiKey = String(process.env.API_KEY || '').trim();
  const projectId = String(process.env.PROJECT_ID || '').trim();
  return {
    'api-key': apiKey,
    'project-id': projectId
  };
};

const NetsQrService = {
  requestQr: (payload) => postJson('/api/v1/common/payments/nets-qr/request', payload, buildHeaders()),
  queryStatus: (payload) => postJson('/api/v1/common/payments/nets-qr/query', payload, buildHeaders())
};

module.exports = NetsQrService;

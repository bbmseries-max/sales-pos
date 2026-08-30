export default async function handler(req, res) {
  // CORS & Preflight Handling
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { endpoint, xmlBody, aadeUserId, subscriptionKey } = body;

    const aadeUrl = endpoint === 'production'
      ? 'https://mydatapi.aade.gr/myDATA/SendInvoices'
      : 'https://mydataapidev.aade.gr/SendInvoices';

    const response = await fetch(aadeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'aade-user-id': aadeUserId || '',
        'Ocp-Apim-Subscription-Key': subscriptionKey || ''
      },
      body: xmlBody || ''
    });

    const responseText = await response.text();
    return res.status(response.status).send(responseText);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Proxy Error' });
  }
}
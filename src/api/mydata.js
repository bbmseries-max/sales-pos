// api/mydata.js
export default async function handler(req, res) {
  // Allow only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { endpoint, xmlBody, aadeUserId, subscriptionKey } = req.body;

  try {
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
      body: xmlBody
    });

    const responseText = await response.text();
    return res.status(response.status).send(responseText);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'AADE Proxy Error' });
  }
}
function env(...names) {
  for (const name of names) if (process.env[name]) return process.env[name];
  return undefined;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ status: 'failed', message: 'Method not allowed' });
  try {
    const checkoutRequestId = req.query?.checkoutRequestId;
    const consumerKey = env('MPESA_CONSUMER_KEY', 'DARAJA_CONSUMER_KEY', 'CONSUMER_KEY');
    const consumerSecret = env('MPESA_CONSUMER_SECRET', 'DARAJA_CONSUMER_SECRET', 'CONSUMER_SECRET');
    const passkey = env('MPESA_PASSKEY', 'DARAJA_PASSKEY', 'PASSKEY');
    const shortcode = env('MPESA_SHORTCODE', 'DARAJA_SHORTCODE', 'SHORTCODE', 'BUSINESS_SHORTCODE');
    const transactionType = env('MPESA_TRANSACTION_TYPE', 'DARAJA_TRANSACTION_TYPE') || 'CustomerPayBillOnline';
    if (!checkoutRequestId || !consumerKey || !consumerSecret || !passkey || !shortcode) return res.status(400).json({ status: 'failed', message: 'Missing payment details.' });

    const baseUrl = process.env.MPESA_ENVIRONMENT === 'sandbox' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenResponse = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return res.status(502).json({ status: 'failed', message: 'Could not authenticate with M-Pesa.' });

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    const response = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, CheckoutRequestID: checkoutRequestId })
    });
    const data = await response.json();

    if (data.ResultCode === '0') return res.status(200).json({ status: 'success', message: data.ResultDesc || 'Payment received.' });
    if (data.ResultCode && data.ResultCode !== '1037') return res.status(200).json({ status: 'failed', message: data.ResultDesc || 'Payment was not completed.' });
    return res.status(200).json({ status: 'pending', message: data.ResultDesc || 'Payment is still pending.' });
  } catch (error) {
    console.error('STK status error:', error);
    return res.status(500).json({ status: 'pending' });
  }
};

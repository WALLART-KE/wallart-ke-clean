function env(...names) {
  for (const name of names) if (process.env[name]) return process.env[name];
  return undefined;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^2547\d{8}$/.test(digits)) return digits;
  if (/^07\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^01\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^2541\d{8}$/.test(digits)) return digits;
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const consumerKey = env('MPESA_CONSUMER_KEY', 'DARAJA_CONSUMER_KEY', 'CONSUMER_KEY');
    const consumerSecret = env('MPESA_CONSUMER_SECRET', 'DARAJA_CONSUMER_SECRET', 'CONSUMER_SECRET');
    const passkey = env('MPESA_PASSKEY', 'DARAJA_PASSKEY', 'PASSKEY');
    const shortcode = env('MPESA_SHORTCODE', 'DARAJA_SHORTCODE', 'SHORTCODE', 'BUSINESS_SHORTCODE');
    const callbackOverride = env('MPESA_CALLBACK_URL', 'DARAJA_CALLBACK_URL');
    const transactionType = env('MPESA_TRANSACTION_TYPE', 'DARAJA_TRANSACTION_TYPE') || 'CustomerPayBillOnline';

    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      return res.status(500).json({ success: false, error: 'M-Pesa environment variables are not configured on Vercel.' });
    }

    const phone = normalizePhone(req.body?.phone);
    const amount = Number(req.body?.amount);
    if (!phone) return res.status(400).json({ success: false, error: 'Enter a valid Kenyan M-Pesa number.' });
    if (amount !== 1200) return res.status(400).json({ success: false, error: 'This payment is for KSh 1,200.' });

    const baseUrl = process.env.MPESA_ENVIRONMENT === 'sandbox'
      ? 'https://sandbox.safaricom.co.ke'
      : 'https://api.safaricom.co.ke';

    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenResponse = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` }
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(502).json({ success: false, error: 'Could not authenticate with M-Pesa.' });
    }

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const callbackUrl = callbackOverride || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL}/api/mpesa-callback`;

    const stkResponse = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: 'WALLART.KE',
        TransactionDesc: 'WALLART.KE wall art'
      })
    });

    const data = await stkResponse.json();
    if (!stkResponse.ok || data.ResponseCode !== '0') {
      return res.status(502).json({ success: false, error: data.errorMessage || data.ResponseDescription || 'M-Pesa could not start the payment.' });
    }

    return res.status(200).json({
      success: true,
      message: data.CustomerMessage || 'STK Push sent.',
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID
    });
  } catch (error) {
    console.error('STK Push error:', error);
    return res.status(500).json({ success: false, error: 'Something went wrong while starting the M-Pesa payment.' });
  }
};

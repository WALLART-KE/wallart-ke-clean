export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      phone,
      amount,
      accountReference = "WALLART-KE",
      transactionDesc = "Wallart KE"
    } = req.body || {};

    if (!phone || !amount) {
      return res.status(400).json({
        error: "Phone number and amount are required"
      });
    }

    // M-Pesa credentials stored in Vercel Environment Variables
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (
      !consumerKey ||
      !consumerSecret ||
      !shortcode ||
      !passkey ||
      !callbackUrl
    ) {
      return res.status(500).json({
        error: "M-Pesa environment variables are missing"
      });
    }

    // Format Kenyan phone number to 254XXXXXXXXX
    let formattedPhone = String(phone).trim().replace(/\s+/g, "");

    if (formattedPhone.startsWith("+")) {
      formattedPhone = formattedPhone.substring(1);
    }

    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.substring(1);
    }

    if (!/^2547\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        error:
          "Enter a valid Kenyan Safaricom number, e.g. 0712345678"
      });
    }

    // Make sure amount is a whole positive number
    const paymentAmount = Math.round(Number(amount));

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({
        error: "Amount must be a valid positive number"
      });
    }

    // Get M-Pesa OAuth access token
    const credentials = Buffer.from(
      `${consumerKey}:${consumerSecret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("M-Pesa token error:", tokenData);

      return res.status(500).json({
        error: "Could not authenticate with M-Pesa"
      });
    }

    const accessToken = tokenData.access_token;

    // Create timestamp in YYYYMMDDHHMMSS format
    const now = new Date();

    const timestamp =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");

    // Generate M-Pesa password
    const password = Buffer.from(
      `${shortcode}${passkey}${timestamp}`
    ).toString("base64");

    // Send STK Push to customer's phone
    // CustomerBuyGoodsOnline is used for a Till / Buy Goods payment.
    const stkResponse = await fetch(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerBuyGoodsOnline",
          Amount: paymentAmount,
          PartyA: formattedPhone,
          PartyB: shortcode,
          PhoneNumber: formattedPhone,
          CallBackURL: callbackUrl,
          AccountReference: String(accountReference).substring(0, 12),
          TransactionDesc: String(transactionDesc).substring(0, 13)
        })
      }
    );

    const stkData = await stkResponse.json();

    console.log("M-Pesa STK Push response:", stkData);

    if (!stkResponse.ok) {
      return res.status(500).json({
        error: "M-Pesa STK Push failed",
        details: stkData
      });
    }

    if (stkData.ResponseCode && stkData.ResponseCode !== "0") {
      return res.status(400).json({
        error:
          stkData.ResponseDescription ||
          "M-Pesa could not start the payment"
      });
    }

    return res.status(200).json({
      success: true,
      message:
        stkData.CustomerMessage ||
        "STK Push sent. Please check your phone.",
      checkoutRequestID: stkData.CheckoutRequestID || null,
      merchantRequestID: stkData.MerchantRequestID || null,
      responseCode: stkData.ResponseCode || null
    });
  } catch (error) {
    console.error("STK Push error:", error);

    return res.status(500).json({
      error:
        "Something went wrong while processing the M-Pesa payment"
    });
  }
}

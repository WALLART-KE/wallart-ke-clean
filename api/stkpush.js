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
      transactionDesc = "Wallart KE artwork"
    } = req.body || {};

    if (!phone || !amount) {
      return res.status(400).json({
        error: "Phone number and amount are required"
      });
    }

    // Daraja credentials from Vercel Environment Variables
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;

    if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
      return res.status(500).json({
        error: "M-Pesa environment variables are missing"
      });
    }

    // Format Kenyan phone number to 254XXXXXXXXX
    let formattedPhone = String(phone).replace(/\s+/g, "");

    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.substring(1);
    }

    if (formattedPhone.startsWith("+")) {
      formattedPhone = formattedPhone.substring(1);
    }

    if (!/^2547\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        error: "Enter a valid Kenyan Safaricom number, e.g. 0712345678"
      });
    }

    // Get OAuth access token
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
      console.error("Daraja token error:", tokenData);

      return res.status(500).json({
        error: "Could not authenticate with M-Pesa"
      });
    }

    const accessToken = tokenData.access_token;

    // Create timestamp
    const now = new Date();

    const timestamp =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");

    // Generate password
    const password = Buffer.from(
      `${shortcode}${passkey}${timestamp}`
    ).toString("base64");

    // Send STK Push
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
          TransactionType: "CustomerPayBillOnline",
          Amount: Math.round(Number(amount)),
          PartyA: formattedPhone,
          PartyB: shortcode,
          PhoneNumber: formattedPhone,
          CallBackURL: process.env.MPESA_CALLBACK_URL,
          AccountReference: accountReference,
          TransactionDesc: transactionDesc
        })
      }
    );

    const stkData = await stkResponse.json();

    console.log("STK Push response:", stkData);

    if (!stkResponse.ok) {
      return res.status(500).json({
        error: "M-Pesa STK Push failed",
        details: stkData
      });
    }

    return res.status(200).json({
      success: true,
      message:
        stkData.CustomerMessage ||
        "STK Push sent. Please check your phone.",
      checkoutRequestID: stkData.CheckoutRequestID,
      merchantRequestID: stkData.MerchantRequestID,
      responseCode: stkData.ResponseCode
    });
  } catch (error) {
    console.error("STK Push error:", error);

    return res.status(500).json({
      error: "Something went wrong while processing the M-Pesa payment"
    });
  }
}

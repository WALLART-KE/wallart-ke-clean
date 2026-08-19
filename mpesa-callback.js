module.exports = async (req, res) => {
  console.log('M-Pesa callback:', JSON.stringify(req.body || {}));
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

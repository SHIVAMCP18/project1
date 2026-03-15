const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const crypto = require('crypto');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function otpExpiry() { return new Date(Date.now() + 10 * 60 * 1000); }

async function sendOTP(contact, otp) {
  console.log(`\n📧 OTP for ${contact}: ${otp}\n`);
  try {
    await resend.emails.send({
      from: 'CoreInventory <onboarding@resend.dev>',
      to: process.env.RESEND_TEST_EMAIL || contact,
      subject: `Your CoreInventory OTP: ${otp}`,
      html: `<div style="font-family:monospace;max-width:480px;margin:0 auto;background:#0a0a0f;color:#f5f3ee;padding:40px;"><div style="font-size:20px;font-weight:900;margin-bottom:8px;"><span style="color:#c8f53c">●</span> CoreInventory</div><div style="color:#6b6860;font-size:12px;margin-bottom:32px;">Stock Management System</div><div style="font-size:13px;color:#aaa;margin-bottom:16px;">Your one-time password:</div><div style="background:#1e1e24;border:1px solid #2a2a30;padding:24px;text-align:center;margin-bottom:24px;"><div style="font-size:48px;font-weight:900;letter-spacing:12px;color:#c8f53c;">${otp}</div></div><div style="font-size:12px;color:#555;">Expires in <strong style="color:#f5f3ee;">10 minutes</strong>.</div></div>`
    });
    console.log('✅ Email sent');
  } catch(err) { console.error('Email error:', err.message); }
}

async function initUsersTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255), email VARCHAR(255) UNIQUE, phone VARCHAR(50), role VARCHAR(50) DEFAULT 'staff', is_verified BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), last_login TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS otp_tokens (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), contact VARCHAR(255) NOT NULL, otp VARCHAR(10) NOT NULL, type VARCHAR(20) DEFAULT 'email', purpose VARCHAR(20) DEFAULT 'login', expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_otp_contact ON otp_tokens(contact)`);
}
initUsersTable().catch(console.error);

router.post('/send-otp', async (req, res) => {
  const { contact, name, purpose = 'login' } = req.body;
  if (!contact) return res.status(400).json({ success: false, error: 'Email is required' });
  const isEmail = contact.includes('@');
  try {
    if (purpose === 'signup') {
      if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR phone = $1', [contact]);
      if (existing.rows.length) return res.status(409).json({ success: false, error: 'Account already exists. Please sign in instead.' });
      await pool.query('INSERT INTO users (name, email, phone) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [name, isEmail ? contact : null, !isEmail ? contact : null]);
    } else {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR phone = $1', [contact]);
      if (!existing.rows.length) return res.status(404).json({ success: false, error: 'No account found. Please sign up first.' });
    }
    await pool.query('UPDATE otp_tokens SET used = true WHERE contact = $1 AND used = false', [contact]);
    const otp = generateOTP();
    await pool.query('INSERT INTO otp_tokens (contact, otp, type, purpose, expires_at) VALUES ($1,$2,$3,$4,$5)', [contact, otp, isEmail ? 'email' : 'sms', purpose, otpExpiry()]);
    await sendOTP(contact, otp);
    res.json({ success: true, message: `OTP sent to ${contact}` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/verify-otp', async (req, res) => {
  const { contact, otp } = req.body;
  if (!contact || !otp) return res.status(400).json({ success: false, error: 'Contact and OTP are required' });
  try {
    if (otp.toString().length !== 6) return res.status(401).json({ success: false, error: 'Please enter a 6-digit code.' });
    // Validate the OTP — must match, not be used, and not be expired
    const otpResult = await pool.query(
      "SELECT id FROM otp_tokens WHERE contact = $1 AND otp = $2 AND used = false AND expires_at > NOW() AND purpose IN ('login','signup') ORDER BY created_at DESC LIMIT 1",
      [contact, otp.toString()]
    );
    if (!otpResult.rows.length) return res.status(401).json({ success: false, error: 'Invalid or expired OTP. Please try again.' });
    // Mark OTP as used
    await pool.query('UPDATE otp_tokens SET used = true WHERE id = $1', [otpResult.rows[0].id]);
    let userResult = await pool.query('UPDATE users SET is_verified = true, last_login = NOW() WHERE email = $1 OR phone = $1 RETURNING id, name, email, phone, role', [contact]);
    if (!userResult.rows.length) return res.status(404).json({ success: false, error: 'User not found. Please sign up first.' });
    const user = userResult.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query("INSERT INTO otp_tokens (contact, otp, type, purpose, expires_at) VALUES ($1,$2,'session','token', NOW() + INTERVAL '7 days')", [contact, token]);
    res.json({ success: true, message: 'Login successful', token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'No token provided' });
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role
       FROM otp_tokens t
       JOIN users u ON (u.email = t.contact OR u.phone = t.contact)
       WHERE t.otp = $1 AND t.purpose = 'token' AND t.used = false AND t.expires_at > NOW()
       LIMIT 1`,
      [token]
    );
    if (!result.rows.length) return res.status(401).json({ success: false, error: 'Invalid or expired session' });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) await pool.query("UPDATE otp_tokens SET used = true WHERE otp = $1 AND purpose = 'token'", [token]);
  res.json({ success: true, message: 'Logged out' });
});

router.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, phone, role, is_verified, created_at, last_login FROM users ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;

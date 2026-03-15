const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const crypto = require('crypto');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);


// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function otpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}


// Send OTP email
async function sendOTP(contact, otp) {

  console.log(`📧 OTP for ${contact}: ${otp}`);

  try {

    await resend.emails.send({
      from: 'CoreInventory <onboarding@resend.dev>',
      to: process.env.RESEND_TEST_EMAIL || contact,
      subject: 'Your CoreInventory OTP',
      html: `
      <div style="font-family:monospace;max-width:480px;margin:auto;background:#0a0a0f;color:#f5f3ee;padding:40px;">
        <h2>CoreInventory</h2>
        <p>Your one-time password:</p>
        <h1 style="letter-spacing:10px;color:#c8f53c">${otp}</h1>
        <p>Expires in 10 minutes</p>
      </div>
      `
    });

    console.log("✅ Email sent");

  } catch (err) {
    console.error("Email error:", err.message);
  }

}


// Create tables
async function initUsersTable() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      phone VARCHAR(50),
      role VARCHAR(50) DEFAULT 'staff',
      is_verified BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact VARCHAR(255) NOT NULL,
      otp VARCHAR(10) NOT NULL,
      type VARCHAR(20),
      purpose VARCHAR(20),
      expires_at TIMESTAMPTZ,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

}


//////////////////////////////////////
// SEND OTP
//////////////////////////////////////

router.post('/send-otp', async (req, res) => {

  const { contact, name, purpose = "login" } = req.body;

  if (!contact)
    return res.status(400).json({ success:false,error:"Email required" });

  const isEmail = contact.includes("@");

  try {

    if (purpose === "signup") {

      if (!name)
        return res.status(400).json({ success:false,error:"Name required" });

      const existing = await pool.query(
        `SELECT id FROM users WHERE email=$1 OR phone=$1`,
        [contact]
      );

      if (existing.rows.length)
        return res.status(409).json({ success:false,error:"User already exists" });

      await pool.query(
        `INSERT INTO users (name,email,phone)
         VALUES ($1,$2,$3)`,
        [name, isEmail ? contact : null, !isEmail ? contact : null]
      );

    } else {

      const existing = await pool.query(
        `SELECT id FROM users WHERE email=$1 OR phone=$1`,
        [contact]
      );

      if (!existing.rows.length)
        return res.status(404).json({ success:false,error:"Account not found" });

    }

    const otp = generateOTP();

    await pool.query(
      `INSERT INTO otp_tokens (contact,otp,type,purpose,expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [contact, otp, isEmail ? "email" : "sms", purpose, otpExpiry()]
    );

    await sendOTP(contact, otp);

    res.json({ success:true,message:"OTP sent" });

  } catch(err) {
    res.status(500).json({ success:false,error:err.message });
  }

});


//////////////////////////////////////
// VERIFY OTP
//////////////////////////////////////

router.post('/verify-otp', async (req,res)=>{

  const { contact, otp } = req.body;

  if (!contact || !otp)
    return res.status(400).json({ success:false,error:"OTP required" });

  try {

    const result = await pool.query(

      `SELECT * FROM otp_tokens
       WHERE contact=$1
       AND otp=$2
       AND used=false
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,

      [contact, otp]
    );

    if (!result.rows.length)
      return res.status(401).json({ success:false,error:"Invalid or expired OTP" });

    await pool.query(
      `UPDATE otp_tokens SET used=true WHERE id=$1`,
      [result.rows[0].id]
    );

    const userResult = await pool.query(
      `UPDATE users
       SET is_verified=true,last_login=NOW()
       WHERE email=$1 OR phone=$1
       RETURNING id,name,email,phone,role`,
      [contact]
    );

    const user = userResult.rows[0];

    const token = crypto.randomBytes(32).toString("hex");

    await pool.query(
      `INSERT INTO otp_tokens (contact,otp,type,purpose,expires_at)
       VALUES ($1,$2,'session','token',NOW()+INTERVAL '7 days')`,
      [contact, token]
    );

    res.json({
      success:true,
      token,
      user
    });

  } catch(err) {
    res.status(500).json({ success:false,error:err.message });
  }

});


//////////////////////////////////////
// LOGOUT
//////////////////////////////////////

router.post('/logout', async (req,res)=>{

  const token = req.headers.authorization?.replace("Bearer ","");

  if (token) {
    await pool.query(
      `UPDATE otp_tokens SET used=true WHERE otp=$1`,
      [token]
    );
  }

  res.json({ success:true });

});


module.exports = router;
module.exports.initUsersTable = initUsersTable;

import twilio from 'twilio';
import config from '../config/app';
import { generateOTP } from '../utils/auth';
import db from '../config/db';
import { generateUUID } from '../utils/auth';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

// Send OTP via SMS
export const sendSMS = async (
  to: string, 
  message: string
): Promise<boolean> => {
  try {
    if (!config.twilio.accountSid || !config.twilio.authToken) {
      console.warn('Twilio credentials not set, SMS not sent');
      return false;
    }

    await client.messages.create({
      body: message,
      from: config.twilio.phoneNumber,
      to: to
    });
    
    return true;
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return false;
  }
};

// Generate and store OTP
export const generateAndStoreOTP = async (
  phone: string, 
  userId: string | null = null, 
  purpose: string = 'SIGNUP'
): Promise<string> => {
  try {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
    
    const query = `
      INSERT INTO verification_codes (
        code_id, user_id, phone, code, purpose, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    await db.query(query, [
      generateUUID(), 
      userId, 
      phone, 
      otp, 
      purpose, 
      expiresAt
    ]);
    
    return otp;
  } catch (error) {
    console.error('Failed to generate OTP:', error);
    throw new Error('Failed to generate OTP');
  }
};

// Verify OTP
export const verifyOTP = async (
  phone: string, 
  otp: string, 
  purpose: string = 'SIGNUP'
): Promise<boolean> => {
  try {
    const query = `
      SELECT * FROM verification_codes 
      WHERE phone = $1 AND code = $2 AND purpose = $3 
      AND expires_at > NOW() AND is_used = false
    `;
    
    const result = await db.query(query, [phone, otp, purpose]);
    
    if (result.rows.length === 0) {
      return false;
    }
    
    // Mark OTP as used
    await db.query(
      'UPDATE verification_codes SET is_used = true WHERE code_id = $1',
      [result.rows[0].code_id]
    );
    
    return true;
  } catch (error) {
    console.error('OTP verification failed:', error);
    return false;
  }
};

export default {
  sendSMS,
  generateAndStoreOTP,
  verifyOTP
}; 
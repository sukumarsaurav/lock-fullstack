import { Request, Response } from 'express';
import { hashPassword, comparePassword, generateToken, generateRefreshToken, generateUUID } from '../utils/auth';
import twilioService from '../services/twilioService';
import db from '../config/db';
import { ApiError } from '../middleware/error';

// Request phone verification OTP
export const requestPhoneVerification = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
      return;
    }
    
    // Generate OTP
    const otp = await twilioService.generateAndStoreOTP(phone, null, 'SIGNUP');
    
    // Send OTP via SMS
    const message = `Your verification code is ${otp}. Valid for 10 minutes.`;
    const smsSent = await twilioService.sendSMS(phone, message);
    
    // In development, return OTP in response
    const devResponse = process.env.NODE_ENV === 'development' ? { otp } : {};
    
    res.status(200).json({
      success: true,
      message: 'Verification code sent to your phone',
      smsSent,
      ...devResponse
    });
  } catch (error) {
    console.error('Phone verification request failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code'
    });
  }
};

// Verify phone with OTP
export const verifyPhone = async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    
    if (!phone || !otp) {
      res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
      return;
    }
    
    // Verify OTP
    const isValid = await twilioService.verifyOTP(phone, otp, 'SIGNUP');
    
    if (!isValid) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }
    
    res.status(200).json({
      success: true,
      message: 'Phone number verified successfully'
    });
  } catch (error) {
    console.error('Phone verification failed:', error);
    res.status(500).json({
      success: false,
      message: 'Phone verification failed'
    });
  }
};

// User signup
export const signup = async (req: Request, res: Response) => {
  try {
    const { email, phone, password, fullName } = req.body;
    
    if (!email || !phone || !password) {
      res.status(400).json({
        success: false,
        message: 'Email, phone, and password are required'
      });
      return;
    }
    
    // Normalize phone number by removing hyphens
    const normalizedPhone = phone.replace(/-/g, '');
    
    // Check if user exists
    const existingUser = await db.query(
      'SELECT * FROM users WHERE email = $1 OR phone = $2',
      [email, normalizedPhone]
    );
    
    if (existingUser.rows.length > 0) {
      res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
      return;
    }
    
    // Use a transaction to ensure atomicity
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Hash password
      const hashedPassword = await hashPassword(password);
      
      // Create user
      const userId = generateUUID();
      const newUser = await client.query(
        `INSERT INTO users (
          user_id, email, phone, full_name, password_hash, is_verified
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id, email, phone, full_name, is_verified`,
        [userId, email, normalizedPhone, fullName || null, hashedPassword, false]
      );
      
      // Create default user preferences
      await client.query(
        `INSERT INTO user_preferences (
          preference_id, user_id, receive_email_notifications, receive_sms_notifications, marketing_opt_in
        ) VALUES ($1, $2, $3, $4, $5)`,
        [generateUUID(), userId, true, true, false]
      );
      
      // Generate tokens
      const user = newUser.rows[0];
      console.log('User created:', user); // Debug log
      
      const token = generateToken({ 
        userId: user.user_id, 
        email: user.email, 
        phone: user.phone 
      });
      
      const refreshToken = generateRefreshToken({ 
        userId: user.user_id 
      });
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            userId: user.user_id,
            email: user.email,
            phone: user.phone,
            fullName: user.full_name,
            isVerified: user.is_verified
          },
          token,
          refreshToken
        }
      });
    } catch (innerError) {
      await client.query('ROLLBACK');
      console.error('Transaction failed:', innerError);
      throw innerError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Signup failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register user',
      error: process.env.NODE_ENV === 'development' ? error.toString() : undefined
    });
  }
};

// User login
export const login = async (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
      res.status(400).json({
        success: false,
        message: 'Phone and password are required'
      });
      return;
    }
    
    // Get user
    const userResult = await db.query(
      'SELECT * FROM users WHERE phone = $1',
      [phone]
    );
    
    if (userResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }
    
    const user = userResult.rows[0];
    
    // Verify password
    const isPasswordValid = await comparePassword(password, user.password_hash);
    
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
      return;
    }
    
    // Generate tokens
    const token = generateToken({ 
      userId: user.user_id, 
      email: user.email, 
      phone: user.phone 
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: user.user_id 
    });
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          userId: user.user_id,
          email: user.email,
          phone: user.phone,
          fullName: user.full_name,
          isVerified: user.is_verified
        },
        token,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

// Request login OTP for passwordless login
export const requestLoginOTP = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
      return;
    }
    
    // Check if user exists
    const userResult = await db.query(
      'SELECT * FROM users WHERE phone = $1',
      [phone]
    );
    
    if (userResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }
    
    const user = userResult.rows[0];
    
    // Generate OTP
    const otp = await twilioService.generateAndStoreOTP(phone, user.user_id, 'LOGIN');
    
    // Send OTP via SMS
    const message = `Your login code is ${otp}. Valid for 10 minutes.`;
    const smsSent = await twilioService.sendSMS(phone, message);
    
    // In development, return OTP in response
    const devResponse = process.env.NODE_ENV === 'development' ? { otp } : {};
    
    res.status(200).json({
      success: true,
      message: 'Login code sent to your phone',
      smsSent,
      ...devResponse
    });
  } catch (error) {
    console.error('Login OTP request failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send login code'
    });
  }
};

// Login with OTP
export const loginWithOTP = async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    
    if (!phone || !otp) {
      res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
      return;
    }
    
    // Verify OTP
    const isValid = await twilioService.verifyOTP(phone, otp, 'LOGIN');
    
    if (!isValid) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }
    
    // Get user
    const userResult = await db.query(
      'SELECT * FROM users WHERE phone = $1',
      [phone]
    );
    
    if (userResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }
    
    const user = userResult.rows[0];
    
    // Generate tokens
    const token = generateToken({ 
      userId: user.user_id, 
      email: user.email, 
      phone: user.phone 
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: user.user_id 
    });
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          userId: user.user_id,
          email: user.email,
          phone: user.phone,
          fullName: user.full_name,
          isVerified: user.is_verified
        },
        token,
        refreshToken
      }
    });
  } catch (error) {
    console.error('OTP login failed:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

export default {
  requestPhoneVerification,
  verifyPhone,
  signup,
  login,
  requestLoginOTP,
  loginWithOTP
};
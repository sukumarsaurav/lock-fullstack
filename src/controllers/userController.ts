import { Request, Response } from 'express';
import db from '../config/db';
import { hashPassword, comparePassword } from '../utils/auth';
import { ApiError } from '../middleware/error';

// Get user profile
export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    const query = `
      SELECT 
        u.user_id, 
        u.email, 
        u.phone, 
        u.full_name, 
        u.profile_image_url,
        u.is_verified,
        u.is_2fa_enabled,
        up.receive_email_notifications,
        up.receive_sms_notifications,
        up.marketing_opt_in
      FROM 
        users u
      LEFT JOIN 
        user_preferences up ON u.user_id = up.user_id
      WHERE 
        u.user_id = $1;
    `;
    
    const { rows } = await db.query(query, [userId]);
    
    if (rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }
    
    // Get user payment methods
    const paymentMethodsQuery = `
      SELECT 
        method_id, 
        type, 
        details,
        is_default
      FROM 
        payment_methods
      WHERE 
        user_id = $1;
    `;
    
    const paymentMethods = await db.query(paymentMethodsQuery, [userId]);
    
    res.status(200).json({
      success: true,
      data: {
        ...rows[0],
        paymentMethods: paymentMethods.rows
      }
    });
  } catch (error) {
    console.error('Failed to get user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
};

// Update user profile
export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { fullName, email } = req.body;
    
    // Start with empty update parts
    let updateFields = [];
    let queryParams = [];
    let paramIndex = 1;
    
    // Add fields if they exist
    if (fullName !== undefined) {
      updateFields.push(`full_name = $${paramIndex++}`);
      queryParams.push(fullName);
    }
    
    if (email !== undefined) {
      // Check if email is already in use
      const emailCheck = await db.query(
        'SELECT user_id FROM users WHERE email = $1 AND user_id != $2',
        [email, userId]
      );
      
      if (emailCheck.rows.length > 0) {
        res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
        return;
      }
      
      updateFields.push(`email = $${paramIndex++}`);
      queryParams.push(email);
    }
    
    // If nothing to update
    if (updateFields.length === 0) {
      res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
      return;
    }
    
    // Add updated_at and user_id
    updateFields.push(`updated_at = NOW()`);
    queryParams.push(userId);
    
    const query = `
      UPDATE users
      SET ${updateFields.join(', ')}
      WHERE user_id = $${paramIndex}
      RETURNING user_id, email, phone, full_name, profile_image_url, is_verified;
    `;
    
    const { rows } = await db.query(query, queryParams);
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Failed to update user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user profile'
    });
  }
};

// Change password
export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
      return;
    }
    
    // Get current password hash
    const userResult = await db.query(
      'SELECT password_hash FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }
    
    // Verify current password
    const isPasswordValid = await comparePassword(
      currentPassword, 
      userResult.rows[0].password_hash
    );
    
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
      return;
    }
    
    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);
    
    // Update password
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2',
      [newPasswordHash, userId]
    );
    
    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Failed to change password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

// Update user preferences
export const updateUserPreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { 
      receiveEmailNotifications, 
      receiveSmsNotifications, 
      marketingOptIn 
    } = req.body;
    
    // Check if preferences exist
    const preferencesResult = await db.query(
      'SELECT preference_id FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    
    let query;
    let queryParams;
    
    // Insert or update preferences
    if (preferencesResult.rows.length === 0) {
      // Insert new preferences
      query = `
        INSERT INTO user_preferences (
          preference_id, 
          user_id, 
          receive_email_notifications, 
          receive_sms_notifications, 
          marketing_opt_in
        ) VALUES (
          uuid_generate_v4(), 
          $1, 
          $2, 
          $3, 
          $4
        ) RETURNING *;
      `;
      
      queryParams = [
        userId, 
        receiveEmailNotifications !== undefined ? receiveEmailNotifications : true, 
        receiveSmsNotifications !== undefined ? receiveSmsNotifications : true,
        marketingOptIn !== undefined ? marketingOptIn : false
      ];
    } else {
      // Update existing preferences
      query = `
        UPDATE user_preferences
        SET 
          receive_email_notifications = COALESCE($1, receive_email_notifications),
          receive_sms_notifications = COALESCE($2, receive_sms_notifications),
          marketing_opt_in = COALESCE($3, marketing_opt_in)
        WHERE 
          user_id = $4
        RETURNING *;
      `;
      
      queryParams = [
        receiveEmailNotifications, 
        receiveSmsNotifications,
        marketingOptIn,
        userId
      ];
    }
    
    const { rows } = await db.query(query, queryParams);
    
    res.status(200).json({
      success: true,
      message: 'Preferences updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Failed to update preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences'
    });
  }
};

// Upload profile image
export const uploadProfileImage = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    // This would be handled by multer middleware in a real implementation
    // For now, we'll just mock it with a URL
    const profileImageUrl = req.body.imageUrl || 'https://example.com/default-avatar.png';
    
    const query = `
      UPDATE users
      SET profile_image_url = $1, updated_at = NOW()
      WHERE user_id = $2
      RETURNING user_id, profile_image_url;
    `;
    
    const { rows } = await db.query(query, [profileImageUrl, userId]);
    
    res.status(200).json({
      success: true,
      message: 'Profile image updated successfully',
      data: {
        userId: rows[0].user_id,
        profileImageUrl: rows[0].profile_image_url
      }
    });
  } catch (error) {
    console.error('Failed to upload profile image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile image'
    });
  }
};

// Get user reservation history
export const getUserReservationHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    const query = `
      SELECT 
        rh.history_id,
        rh.reservation_id,
        rh.start_time,
        rh.end_time,
        rh.total_hours,
        rh.total_cost,
        l.locker_code,
        loc.name as location_name,
        loc.address as location_address,
        ls.name as locker_size
      FROM 
        reservation_history rh
      JOIN 
        reservations r ON rh.reservation_id = r.reservation_id
      JOIN 
        lockers l ON r.locker_id = l.locker_id
      JOIN 
        locations loc ON l.location_id = loc.location_id
      JOIN 
        locker_sizes ls ON l.size_id = ls.size_id
      WHERE 
        r.user_id = $1
      ORDER BY 
        rh.end_time DESC;
    `;
    
    const { rows } = await db.query(query, [userId]);
    
    res.status(200).json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Failed to get reservation history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get reservation history'
    });
  }
};

export default {
  getUserProfile,
  updateUserProfile,
  changePassword,
  updateUserPreferences,
  uploadProfileImage,
  getUserReservationHistory
}; 
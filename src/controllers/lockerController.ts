import { Request, Response } from 'express';
import db from '../config/db';
import { generateUUID } from '../utils/auth';
import { ApiError } from '../middleware/error';

// Get all locker locations with available counts
export const getLockerLocations = async (req: Request, res: Response) => {
  try {
    const query = `
      SELECT 
        l.location_id, 
        l.name, 
        l.address,
        ST_AsGeoJSON(l.geo)::json AS geo,
        l.popularity_score,
        COUNT(CASE WHEN lk.status = 'AVAILABLE' THEN 1 END) AS available_count,
        json_object_agg(
          ls.name, 
          COUNT(CASE WHEN lk.status = 'AVAILABLE' AND ls.name = lk.size_id::text THEN 1 END)
        ) AS available_by_size
      FROM 
        locations l
      LEFT JOIN 
        lockers lk ON l.location_id = lk.location_id
      LEFT JOIN 
        locker_sizes ls ON lk.size_id = ls.size_id
      WHERE 
        l.is_active = true
      GROUP BY 
        l.location_id
      ORDER BY 
        l.popularity_score DESC;
    `;
    
    const { rows } = await db.query(query);
    
    res.status(200).json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Failed to get locker locations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get locker locations'
    });
  }
};

// Get nearby locker locations within a radius
export const getNearbyLockers = async (req: Request, res: Response) => {
  try {
    const { 
      latitude, 
      longitude, 
      radius = 5000 // Default radius: 5km
    } = req.query;
    
    if (!latitude || !longitude) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
      return;
    }
    
    const query = `
      SELECT 
        l.location_id, 
        l.name, 
        l.address,
        ST_AsGeoJSON(l.geo)::json AS geo,
        ST_Distance(
          l.geo, 
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance,
        COUNT(CASE WHEN lk.status = 'AVAILABLE' THEN 1 END) AS available_count,
        json_object_agg(
          ls.name, 
          COUNT(CASE WHEN lk.status = 'AVAILABLE' AND ls.name = lk.size_id::text THEN 1 END)
        ) AS available_by_size
      FROM 
        locations l
      LEFT JOIN 
        lockers lk ON l.location_id = lk.location_id
      LEFT JOIN 
        locker_sizes ls ON lk.size_id = ls.size_id
      WHERE 
        l.is_active = true
        AND ST_DWithin(
          l.geo, 
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
          $3
        )
      GROUP BY 
        l.location_id
      ORDER BY 
        distance;
    `;
    
    const { rows } = await db.query(query, [longitude, latitude, radius]);
    
    res.status(200).json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Failed to get nearby lockers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby lockers'
    });
  }
};

// Get locker location details with available lockers
export const getLocationDetails = async (req: Request, res: Response) => {
  try {
    const { locationId } = req.params;
    
    // Get location details
    const locationQuery = `
      SELECT 
        location_id, 
        name, 
        ST_AsGeoJSON(geo)::json AS geo,
        address, 
        operating_hours,
        popularity_score
      FROM 
        locations
      WHERE 
        location_id = $1 AND is_active = true;
    `;
    
    const locationResult = await db.query(locationQuery, [locationId]);
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }
    
    // Get available lockers by size
    const lockersQuery = `
      SELECT 
        ls.name as size_name,
        ls.base_price,
        ls.description,
        COUNT(CASE WHEN l.status = 'AVAILABLE' THEN 1 END) AS available_count,
        ARRAY_AGG(
          CASE WHEN l.status = 'AVAILABLE' THEN 
            json_build_object(
              'locker_id', l.locker_id,
              'locker_code', l.locker_code,
              'status', l.status
            )
          END
        ) FILTER (WHERE l.status = 'AVAILABLE') AS available_lockers
      FROM 
        locker_sizes ls
      LEFT JOIN 
        lockers l ON ls.size_id = l.size_id AND l.location_id = $1
      GROUP BY 
        ls.size_id
      ORDER BY 
        ls.name;
    `;
    
    const lockersResult = await db.query(lockersQuery, [locationId]);
    
    res.status(200).json({
      success: true,
      data: {
        location: locationResult.rows[0],
        locker_sizes: lockersResult.rows
      }
    });
  } catch (error) {
    console.error('Failed to get location details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get location details'
    });
  }
};

// Reserve a locker
export const reserveLocker = async (req: Request, res: Response) => {
  try {
    const { lockerId, duration } = req.body;
    const userId = req.user?.userId;
    
    if (!lockerId || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Locker ID and duration are required'
      });
    }
    
    // Check if locker is available
    const lockerQuery = `
      SELECT 
        l.*, 
        ls.base_price
      FROM 
        lockers l
      JOIN 
        locker_sizes ls ON l.size_id = ls.size_id
      WHERE 
        l.locker_id = $1 AND l.status = 'AVAILABLE';
    `;
    
    const lockerResult = await db.query(lockerQuery, [lockerId]);
    
    if (lockerResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Locker not available'
      });
    }
    
    const locker = lockerResult.rows[0];
    
    // Calculate cost (simple version for now)
    const durationHours = parseInt(duration);
    const totalCost = locker.base_price * durationHours;
    
    // Start transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update locker status
      await client.query(
        'UPDATE lockers SET status = $1 WHERE locker_id = $2',
        ['OCCUPIED', lockerId]
      );
      
      // Generate random access code
      const accessCode = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Create reservation
      const startTime = new Date();
      const endTime = new Date();
      endTime.setHours(endTime.getHours() + durationHours);
      
      const reservationId = generateUUID();
      const reservationResult = await client.query(
        `INSERT INTO reservations (
          reservation_id, user_id, locker_id, start_time, expected_end_time,
          status, total_cost, access_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          reservationId, 
          userId, 
          lockerId, 
          startTime, 
          endTime, 
          'ACTIVE', 
          totalCost, 
          accessCode
        ]
      );
      
      await client.query('COMMIT');
      
      res.status(200).json({
        success: true,
        message: 'Locker reserved successfully',
        data: {
          reservation: reservationResult.rows[0],
          accessCode,
          expiresAt: endTime
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to reserve locker:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reserve locker'
    });
  }
};

// Get user's active reservations
export const getUserReservations = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { status } = req.query;
    
    let statusFilter = '';
    if (status) {
      statusFilter = `AND r.status = '${status}'`;
    }
    
    const query = `
      SELECT 
        r.*,
        l.locker_code,
        loc.name as location_name,
        loc.address as location_address,
        ls.name as locker_size
      FROM 
        reservations r
      JOIN 
        lockers l ON r.locker_id = l.locker_id
      JOIN 
        locations loc ON l.location_id = loc.location_id
      JOIN 
        locker_sizes ls ON l.size_id = ls.size_id
      WHERE 
        r.user_id = $1
        ${statusFilter}
      ORDER BY 
        r.start_time DESC;
    `;
    
    const { rows } = await db.query(query, [userId]);
    
    // Add a property to check if reservation is expiring soon (less than 15 minutes)
    const reservations = rows.map((reservation: any) => {
      const now = new Date();
      const endTime = new Date(reservation.expected_end_time);
      const timeLeft = endTime.getTime() - now.getTime();
      const minutesLeft = Math.floor(timeLeft / (1000 * 60));
      
      return {
        ...reservation,
        expiring_soon: minutesLeft < 15 && minutesLeft > 0,
        minutes_left: minutesLeft > 0 ? minutesLeft : 0
      };
    });
    
    res.status(200).json({
      success: true,
      data: reservations
    });
  } catch (error) {
    console.error('Failed to get user reservations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user reservations'
    });
  }
};

// Extend a reservation
export const extendReservation = async (req: Request, res: Response) => {
  try {
    const { reservationId, additionalHours } = req.body;
    const userId = req.user?.userId;
    
    if (!reservationId || !additionalHours) {
      return res.status(400).json({
        success: false,
        message: 'Reservation ID and additional hours are required'
      });
    }
    
    // Check if reservation exists and belongs to the user
    const reservationQuery = `
      SELECT 
        r.*,
        l.size_id,
        ls.base_price
      FROM 
        reservations r
      JOIN 
        lockers l ON r.locker_id = l.locker_id
      JOIN 
        locker_sizes ls ON l.size_id = ls.size_id
      WHERE 
        r.reservation_id = $1 AND r.user_id = $2 AND r.status = 'ACTIVE';
    `;
    
    const reservationResult = await db.query(reservationQuery, [reservationId, userId]);
    
    if (reservationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Active reservation not found'
      });
    }
    
    const reservation = reservationResult.rows[0];
    
    // Calculate new end time and additional cost
    const additionalHoursNum = parseInt(additionalHours);
    const newEndTime = new Date(reservation.extended_end_time || reservation.expected_end_time);
    newEndTime.setHours(newEndTime.getHours() + additionalHoursNum);
    
    const additionalCost = reservation.base_price * additionalHoursNum;
    const newTotalCost = parseFloat(reservation.total_cost) + additionalCost;
    
    // Update reservation
    const updateQuery = `
      UPDATE reservations
      SET 
        extended_end_time = $1,
        extension_count = extension_count + 1,
        extension_cost = COALESCE(extension_cost, 0) + $2,
        total_cost = $3
      WHERE 
        reservation_id = $4
      RETURNING *;
    `;
    
    const updateResult = await db.query(
      updateQuery, 
      [newEndTime, additionalCost, newTotalCost, reservationId]
    );
    
    res.status(200).json({
      success: true,
      message: 'Reservation extended successfully',
      data: {
        reservation: updateResult.rows[0],
        additionalCost,
        newEndTime
      }
    });
  } catch (error) {
    console.error('Failed to extend reservation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extend reservation'
    });
  }
};

// Release a locker
export const releaseLocker = async (req: Request, res: Response) => {
  try {
    const { reservationId } = req.params;
    const userId = req.user?.userId;
    
    // Check if reservation exists and belongs to the user
    const reservationQuery = `
      SELECT * FROM reservations
      WHERE reservation_id = $1 AND user_id = $2 AND status = 'ACTIVE';
    `;
    
    const reservationResult = await db.query(reservationQuery, [reservationId, userId]);
    
    if (reservationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Active reservation not found'
      });
    }
    
    const reservation = reservationResult.rows[0];
    
    // Start transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update reservation status
      await client.query(
        `UPDATE reservations 
        SET status = $1, actual_end_time = NOW() 
        WHERE reservation_id = $2`,
        ['COMPLETED', reservationId]
      );
      
      // Update locker status
      await client.query(
        'UPDATE lockers SET status = $1 WHERE locker_id = $2',
        ['AVAILABLE', reservation.locker_id]
      );
      
      // Add to reservation history
      const startTime = new Date(reservation.start_time);
      const endTime = new Date();
      const totalHours = Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60));
      
      await client.query(
        `INSERT INTO reservation_history (
          history_id, reservation_id, start_time, end_time, total_hours, total_cost
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          generateUUID(), 
          reservationId, 
          reservation.start_time, 
          endTime, 
          totalHours, 
          reservation.total_cost
        ]
      );
      
      await client.query('COMMIT');
      
      res.status(200).json({
        success: true,
        message: 'Locker released successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to release locker:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to release locker'
    });
  }
};

export default {
  getLockerLocations,
  getNearbyLockers,
  getLocationDetails,
  reserveLocker,
  getUserReservations,
  extendReservation,
  releaseLocker
}; 
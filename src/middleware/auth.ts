import { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyToken } from '../utils/auth';

// Interface to extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        phone: string;
      };
    }
  }
}

// Authentication middleware
export const authenticate: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
      return;
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = verifyToken(token);
    
    if (!decoded) {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid token.' 
      });
      return;
    }
    
    // Add user to request
    req.user = decoded;
    
    next();
  } catch (err) {
    console.error('Authentication error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Authentication failed.' 
    });
  }
};

// Role-based authorization
export const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized access.' 
      });
    }
    
    // If roles are specified and user's role doesn't match
    // For future implementation - currently we don't have roles in our schema
    // if (roles.length && !roles.includes(req.user.role)) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: 'Forbidden access.' 
    //   });
    // }
    
    next();
  };
}; 
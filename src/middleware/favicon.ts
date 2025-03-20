import { Request, Response, NextFunction } from 'express';

export const handleFavicon = (req: Request, res: Response, next: NextFunction) => {
  if (req.url === '/favicon.ico') {
    res.status(204).end(); // No content response for favicon
    return;
  }
  next();
}; 
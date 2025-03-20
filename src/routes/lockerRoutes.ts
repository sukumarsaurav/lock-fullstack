import { Router, Request, Response } from 'express';
import lockerController from '../controllers/lockerController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public routes
router.get('/locations', (req: Request, res: Response) => { lockerController.getLockerLocations(req, res); });
router.get('/nearby', (req: Request, res: Response) => { lockerController.getNearbyLockers(req, res); });
router.get('/location/:locationId', (req: Request, res: Response) => { lockerController.getLocationDetails(req, res); });

// Protected routes (require authentication)
router.use(authenticate);
router.post('/reserve', (req: Request, res: Response) => { lockerController.reserveLocker(req, res); });
router.get('/reservations', (req: Request, res: Response) => { lockerController.getUserReservations(req, res); });
router.post('/extend', (req: Request, res: Response) => { lockerController.extendReservation(req, res); });
router.post('/release/:reservationId', (req: Request, res: Response) => { lockerController.releaseLocker(req, res); });

export default router;
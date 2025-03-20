import { Router, Request, Response } from 'express';
import userController from '../controllers/userController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Protected routes (require authentication)
router.use(authenticate);
router.get('/profile', (req: Request, res: Response) => userController.getUserProfile(req, res));
router.put('/profile', (req: Request, res: Response) => userController.updateUserProfile(req, res));
router.put('/password', userController.changePassword);
router.put('/preferences', (req: Request, res: Response) => userController.updateUserPreferences(req, res));
router.post('/profile-image', (req: Request, res: Response) => userController.uploadProfileImage(req, res));

export default router; 
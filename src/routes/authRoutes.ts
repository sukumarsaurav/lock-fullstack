import { Router, Request, Response } from 'express';
import authController from '../controllers/authController';

const router = Router();

// Public routes
router.post('/request-verification', (req: Request, res: Response) => authController.requestPhoneVerification(req, res));
router.post('/verify-phone', (req: Request, res: Response) => authController.verifyPhone(req, res));
router.post('/signup', (req: Request, res: Response) => authController.signup(req, res));
router.post('/login', (req: Request, res: Response) => authController.login(req, res));
router.post('/request-login-otp', (req: Request, res: Response) => authController.requestLoginOTP(req, res));
router.post('/login-with-otp', (req: Request, res: Response) => authController.loginWithOTP(req, res));

export default router;
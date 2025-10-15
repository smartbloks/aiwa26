/**
 * Routes for managing custom domains
 */

import { CustomDomainController } from '../controllers/customDomain/controller';
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';

/**
 * Setup custom domain routes
 * All routes are protected and require authentication
 */
export function setupCustomDomainRoutes(app: Hono<AppEnv>): void {
    // Create a sub-router for custom domain routes
    const customDomainRouter = new Hono<AppEnv>();

    // Custom Domain Routes
    // Add custom domain to an app
    customDomainRouter.post(
        '/:appId/custom-domain',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(CustomDomainController, CustomDomainController.addCustomDomain)
    );

    // Check custom domain status
    customDomainRouter.get(
        '/:appId/custom-domain/status',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(CustomDomainController, CustomDomainController.getCustomDomainStatus)
    );

    // Remove custom domain
    customDomainRouter.delete(
        '/:appId/custom-domain',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(CustomDomainController, CustomDomainController.removeCustomDomain)
    );

    // Verify/refresh custom domain status (manually trigger verification check)
    customDomainRouter.post(
        '/:appId/custom-domain/verify',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(CustomDomainController, CustomDomainController.verifyCustomDomain)
    );

    // Mount the router under /api/apps
    app.route('/api/apps', customDomainRouter);
}

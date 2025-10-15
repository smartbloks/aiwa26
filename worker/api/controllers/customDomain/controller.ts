/**
 * Custom Domain Controller
 * Handles custom domain management endpoints
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { ApiResponse, ControllerResponse } from '../types';
import { CustomDomainService } from '../../../services/custom-domains/customDomainService';
import { createLogger } from '../../../logger';

interface AddCustomDomainRequest {
    hostname: string;
}

interface CustomDomainResponse {
    hostname: string;
    status: string;
    sslStatus?: string;
    customHostnameId?: string;
    verificationInstructions: {
        type: string;
        name: string;
        target: string;
        instructions: string;
    };
}

interface CustomDomainStatusResponse {
    hostname: string;
    status: string;
    sslStatus?: string;
    verificationErrors?: string[];
    isActive: boolean;
}

export class CustomDomainController extends BaseController {
    static logger = createLogger('CustomDomainController');

    /**
     * Add custom domain to an app
     * POST /api/apps/:appId/custom-domain
     */
    static async addCustomDomain(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<CustomDomainResponse>>> {
        try {
            // Get authenticated user
            const user = context.user!;
            const appId = context.pathParams?.appId as string;

            if (!appId) {
                return CustomDomainController.createErrorResponse<CustomDomainResponse>('App ID is required', 400);
            }

            // Parse request body
            const bodyResult = await this.parseJsonBody<AddCustomDomainRequest>(request);
            if (!bodyResult.success || !bodyResult.data) {
                return bodyResult.response as ControllerResponse<ApiResponse<CustomDomainResponse>> ||
                    CustomDomainController.createErrorResponse<CustomDomainResponse>('Invalid request body', 400);
            }

            const { hostname } = bodyResult.data;

            // Validate hostname
            if (!hostname || !CustomDomainService.isValidHostname(hostname)) {
                return CustomDomainController.createErrorResponse<CustomDomainResponse>('Invalid hostname format', 400);
            }

            // Verify app ownership
            const app = await env.DB.prepare(
                'SELECT id, user_id FROM apps WHERE id = ? AND user_id = ?'
            )
                .bind(appId, user.id)
                .first();

            if (!app) {
                return CustomDomainController.createErrorResponse<CustomDomainResponse>('App not found or you do not have permission', 404);
            }

            // Check if custom domain already exists for this app
            const existingDomain = await env.DB.prepare(
                'SELECT custom_domain FROM apps WHERE id = ? AND custom_domain IS NOT NULL'
            )
                .bind(appId)
                .first();

            if (existingDomain) {
                return CustomDomainController.createErrorResponse<CustomDomainResponse>('This app already has a custom domain. Please remove it first.', 400);
            }

            // Check if hostname is already in use
            const duplicateCheck = await env.DB.prepare(
                'SELECT id FROM apps WHERE custom_domain = ?'
            )
                .bind(hostname)
                .first();

            if (duplicateCheck) {
                return CustomDomainController.createErrorResponse<CustomDomainResponse>('This domain is already in use by another app', 400);
            }

            // Create custom domain via Cloudflare
            const customDomainService = new CustomDomainService(env);
            const result = await customDomainService.createCustomDomain({
                hostname,
                appId,
                userId: user.id,
            });

            if (!result.success) {
                this.logger.error('Failed to create custom domain', {
                    hostname,
                    appId,
                    errors: result.verificationErrors,
                });
                return CustomDomainController.createErrorResponse<CustomDomainResponse>(
                    `Failed to create custom domain: ${result.verificationErrors?.join(', ') || 'Unknown error'}`,
                    500
                );
            }

            // Update database
            await env.DB.prepare(`
                UPDATE apps
                SET custom_domain = ?,
                    custom_hostname_id = ?,
                    custom_domain_status = ?,
                    custom_domain_verification_errors = ?,
                    custom_domain_created_at = CURRENT_TIMESTAMP,
                    custom_domain_updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `)
                .bind(
                    hostname,
                    result.customHostnameId,
                    result.status,
                    JSON.stringify(result.verificationErrors || []),
                    appId
                )
                .run();

            this.logger.info('Custom domain added successfully', {
                hostname,
                appId,
                customHostnameId: result.customHostnameId,
            });

            const responseData: CustomDomainResponse = {
                hostname,
                status: result.status || 'pending',
                sslStatus: result.sslStatus,
                customHostnameId: result.customHostnameId,
                verificationInstructions: {
                    type: 'CNAME',
                    name: hostname,
                    target: env.CUSTOM_DOMAIN,
                    instructions: `Create a CNAME record: ${hostname} → ${env.CUSTOM_DOMAIN}`,
                },
            };

            return CustomDomainController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error adding custom domain', { error });
            return this.handleError(error, 'add custom domain') as ControllerResponse<ApiResponse<CustomDomainResponse>>;
        }
    }

    /**
     * Get custom domain status
     * GET /api/apps/:appId/custom-domain/status
     */
    static async getCustomDomainStatus(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<CustomDomainStatusResponse>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams?.appId as string;

            if (!appId) {
				return CustomDomainController.createErrorResponse(
                    'App ID is required',
                    400
                );
            }

            // Verify app ownership and get custom domain info
            const app = await env.DB.prepare(`
                SELECT custom_domain, custom_hostname_id, custom_domain_status,
                       custom_domain_verification_errors
                FROM apps
                WHERE id = ? AND user_id = ?
            `)
                .bind(appId, user.id)
                .first();

            if (!app) {
				return CustomDomainController.createErrorResponse(
                   'App not found or you do not have permission',
                    404
                );
            }

            if (!app.custom_hostname_id) {
				return CustomDomainController.createErrorResponse(
					'No custom domain configured for this app',
					 404
				 );
            }

            // Check status with Cloudflare
            const customDomainService = new CustomDomainService(env);
            const result = await customDomainService.checkCustomDomainStatus(
                app.custom_hostname_id as string
            );

            if (!result.success) {
                this.logger.error('Failed to check custom domain status', {
                    appId,
                    customHostnameId: app.custom_hostname_id,
                });
                return CustomDomainController.createErrorResponse('Failed to check domain status', 500);
            }

            // Update database with latest status
            await env.DB.prepare(`
                UPDATE apps
                SET custom_domain_status = ?,
                    custom_domain_verification_errors = ?,
                    custom_domain_updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `)
                .bind(
                    result.status || app.custom_domain_status,
                    JSON.stringify(result.verificationErrors || []),
                    appId
                )
                .run();

            return CustomDomainController.createSuccessResponse<CustomDomainStatusResponse>({
                hostname: app.custom_domain as string,
                status: result.status || (app.custom_domain_status as string),
                sslStatus: result.sslStatus,
                verificationErrors: result.verificationErrors,
                isActive: result.status === 'active',
            });
        } catch (error) {
            this.logger.error('Error getting custom domain status', { error });
            return this.handleError(error, 'get custom domain status') as ControllerResponse<ApiResponse<CustomDomainStatusResponse>>;
        }
    }

    /**
     * Remove custom domain
     * DELETE /api/apps/:appId/custom-domain
     */
    static async removeCustomDomain(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<{ success: boolean }>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams?.appId as string;

            if (!appId) {
                return CustomDomainController.createErrorResponse('App ID is required', 400);
            }

            // Get app and verify ownership
            const app = await env.DB.prepare(`
                SELECT custom_hostname_id
                FROM apps
                WHERE id = ? AND user_id = ?
            `)
                .bind(appId, user.id)
                .first();

            if (!app) {
                return CustomDomainController.createErrorResponse('App not found or you do not have permission', 404);
            }

            if (!app.custom_hostname_id) {
                return CustomDomainController.createErrorResponse('No custom domain configured for this app', 404);
            }

            // Delete from Cloudflare
            const customDomainService = new CustomDomainService(env);
            const deleted = await customDomainService.deleteCustomDomain(
                app.custom_hostname_id as string
            );

            // Update database regardless of Cloudflare result
            // (in case the hostname was already deleted from Cloudflare)
            await env.DB.prepare(`
                UPDATE apps
                SET custom_domain = NULL,
                    custom_hostname_id = NULL,
                    custom_domain_status = NULL,
                    custom_domain_verification_errors = NULL,
                    custom_domain_updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `)
                .bind(appId)
                .run();

            this.logger.info('Custom domain removed', {
                appId,
                customHostnameId: app.custom_hostname_id,
                cloudflareDeleted: deleted,
            });

            return CustomDomainController.createSuccessResponse({ success: true });
        } catch (error) {
            this.logger.error('Error removing custom domain', { error });
            return this.handleError(error, 'remove custom domain') as ControllerResponse<ApiResponse<{ success: boolean }>>;
        }
    }

    /**
     * Verify custom domain (refresh status)
     * POST /api/apps/:appId/custom-domain/verify
     */
    static async verifyCustomDomain(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<CustomDomainStatusResponse>>> {
        // Same as getCustomDomainStatus but with a POST method
        // This allows users to manually trigger a verification check
        return this.getCustomDomainStatus(request, env, _ctx, context);
    }
}

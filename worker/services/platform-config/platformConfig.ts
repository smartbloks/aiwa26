/**
 * Platform configuration that should be available to all generated apps
 */
export interface PlatformConfig {
  /** Cloudflare AI Gateway base URL */
  CF_AI_BASE_URL: string;
  /** Cloudflare AI Gateway API key for authentication */
  CF_AI_API_KEY: string;
  /** Cloudflare account ID */
  CLOUDFLARE_ACCOUNT_ID: string;
  /** Cloudflare AI Gateway name */
  CLOUDFLARE_AI_GATEWAY: string;
}

/**
 * Service for managing platform-level configuration that generated apps inherit
 *
 * This service provides centralized configuration for resources like AI Gateway,
 * ensuring that all generated applications automatically have access to platform
 * infrastructure without requiring manual configuration in each app.
 *
 * @example
 * ```typescript
 * const platformEnvVars = PlatformConfigService.getEnvVarsForSandbox(env);
 * const sandbox = new SandboxSdkClient(sessionId, platformEnvVars);
 * ```
 */
export class PlatformConfigService {
  /**
   * Gets platform-level configuration from environment
   *
   * @param env - Worker environment bindings
   * @returns Platform configuration object
   */
  static getPlatformConfig(env: Env): PlatformConfig {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const gatewayName = env.CLOUDFLARE_AI_GATEWAY || 'vibesdk-gateway';

    // Construct AI Gateway URL from components if not explicitly provided
    // Format: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/{provider}
    const baseUrl = env.CLOUDFLARE_AI_GATEWAY_URL ||
      `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/google-ai-studio`;

    // Use AI Gateway token if available, otherwise fall back to API token
    // The AI Gateway token should have Run permissions
    const apiKey = env.CLOUDFLARE_AI_GATEWAY_TOKEN || env.CLOUDFLARE_API_TOKEN;

    return {
      CF_AI_BASE_URL: baseUrl,
      CF_AI_API_KEY: apiKey,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_AI_GATEWAY: gatewayName,
    };
  }

  /**
   * Returns environment variables that should be injected into sandbox instances
   *
   * These values come from the platform configuration and should be available
   * to all generated applications, allowing them to use AI Gateway and other
   * platform resources without explicit configuration.
   *
   * @param env - Worker environment bindings
   * @returns Record of environment variable name to value
   */
  static getEnvVarsForSandbox(env: Env): Record<string, string> {
    const config = this.getPlatformConfig(env);

    return {
      // AI Gateway Configuration
      CF_AI_BASE_URL: config.CF_AI_BASE_URL,
      CF_AI_API_KEY: config.CF_AI_API_KEY,

      // Account Information
      CLOUDFLARE_ACCOUNT_ID: config.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_AI_GATEWAY: config.CLOUDFLARE_AI_GATEWAY,
    };
  }

  /**
   * Logs platform configuration status for debugging
   * Useful for troubleshooting configuration issues
   *
   * @param env - Worker environment bindings
   */
  static logConfig(env: Env): void {
    const config = this.getPlatformConfig(env);
    console.log('Platform Configuration:', {
      hasAIGatewayURL: !!config.CF_AI_BASE_URL,
      hasAPIKey: !!config.CF_AI_API_KEY,
      accountId: config.CLOUDFLARE_ACCOUNT_ID,
      gateway: config.CLOUDFLARE_AI_GATEWAY,
      // Don't log actual sensitive values
      aiGatewayURLPrefix: config.CF_AI_BASE_URL.substring(0, 50) + '...',
      apiKeyPrefix: config.CF_AI_API_KEY.substring(0, 10) + '...',
    });
  }

  /**
   * Validates that required platform configuration is available
   *
   * @param env - Worker environment bindings
   * @returns True if configuration is valid, false otherwise
   */
  static validateConfig(env: Env): boolean {
    const config = this.getPlatformConfig(env);

    const isValid = !!(
      config.CF_AI_BASE_URL &&
      config.CF_AI_API_KEY &&
      config.CLOUDFLARE_ACCOUNT_ID &&
      config.CLOUDFLARE_AI_GATEWAY
    );

    if (!isValid) {
      console.error('Platform configuration validation failed:', {
        hasCF_AI_BASE_URL: !!config.CF_AI_BASE_URL,
        hasCF_AI_API_KEY: !!config.CF_AI_API_KEY,
        hasCLOUDFLARE_ACCOUNT_ID: !!config.CLOUDFLARE_ACCOUNT_ID,
        hasCLOUDFLARE_AI_GATEWAY: !!config.CLOUDFLARE_AI_GATEWAY,
      });
    }

    return isValid;
  }
}

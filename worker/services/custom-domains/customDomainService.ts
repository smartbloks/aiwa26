/**
 * Custom Domain Service
 * Manages custom domains via Cloudflare for SaaS (SSL for SaaS) API
 */
export interface CustomDomainConfig {
    hostname: string;
    appId: string;
    userId: string;
}

export interface CustomDomainResult {
    success: boolean;
    customHostnameId?: string;
    status?: string;
    verificationErrors?: string[];
    sslStatus?: string;
    ownershipVerification?: {
        type: string;
        name: string;
        value: string;
    };
}

export interface CustomDomainStatusCheck {
    customHostnameId: string;
    hostname: string;
    status: string;
    sslStatus: string;
    verificationErrors: string[];
}

export class CustomDomainService {
    private env: Env;
    private zoneIdCache: string | null = null;

    constructor(env: Env) {
        this.env = env;
    }

    /**
     * Create a custom hostname for an app
     */
    async createCustomDomain(config: CustomDomainConfig): Promise<CustomDomainResult> {
        const { hostname, appId } = config;

        try {
            // Get the zone ID for your SaaS domain
            const zoneId = await this.getZoneId();

            if (!zoneId) {
                return {
                    success: false,
                    verificationErrors: ['Failed to get zone ID for custom domain'],
                };
            }

            // Create custom hostname via Cloudflare API
            const response = await fetch(
                `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        hostname: hostname,
                        ssl: {
                            method: 'http', // HTTP validation
                            type: 'dv', // Domain Validation
                            settings: {
                                http2: 'on',
                                min_tls_version: '1.2',
                                tls_1_3: 'on',
                            },
                            bundle_method: 'ubiquitous',
                            wildcard: false,
                        },
                        custom_metadata: {
                            app_id: appId,
                        },
                    }),
                }
            );

            const data = await response.json() as any;

            if (!response.ok || !data.success) {
                console.error('Cloudflare API error:', data);
                return {
                    success: false,
                    verificationErrors: data.errors?.map((e: any) => e.message) || ['Failed to create custom hostname'],
                };
            }

            const result = data.result;

            return {
                success: true,
                customHostnameId: result.id,
                status: result.status,
                sslStatus: result.ssl?.status,
                ownershipVerification: {
                    type: 'CNAME',
                    name: hostname,
                    value: this.env.CUSTOM_DOMAIN,
                },
                verificationErrors: result.verification_errors || [],
            };
        } catch (error) {
            console.error('Error creating custom domain:', error);
            return {
                success: false,
                verificationErrors: [error instanceof Error ? error.message : 'Unknown error'],
            };
        }
    }

    /**
     * Check custom hostname status
     */
    async checkCustomDomainStatus(customHostnameId: string): Promise<CustomDomainResult> {
        try {
            const zoneId = await this.getZoneId();

            if (!zoneId) {
                return {
                    success: false,
                    verificationErrors: ['Failed to get zone ID'],
                };
            }

            const response = await fetch(
                `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${customHostnameId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            const data = await response.json() as any;

            if (!response.ok || !data.success) {
                return {
                    success: false,
                    verificationErrors: ['Failed to check status'],
                };
            }

            const result = data.result;

            return {
                success: true,
                customHostnameId: result.id,
                status: result.status,
                sslStatus: result.ssl?.status,
                verificationErrors: result.verification_errors || [],
            };
        } catch (error) {
            return {
                success: false,
                verificationErrors: [error instanceof Error ? error.message : 'Unknown error'],
            };
        }
    }

    /**
     * Delete custom hostname
     */
    async deleteCustomDomain(customHostnameId: string): Promise<boolean> {
        try {
            const zoneId = await this.getZoneId();

            if (!zoneId) {
                return false;
            }

            const response = await fetch(
                `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${customHostnameId}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            const data = await response.json() as any;
            return response.ok && data.success;
        } catch (error) {
            console.error('Error deleting custom domain:', error);
            return false;
        }
    }

    /**
     * Get zone ID for the main custom domain (cached)
     */
    private async getZoneId(): Promise<string | null> {
        // Return cached value if available
        if (this.zoneIdCache) {
            return this.zoneIdCache;
        }

        try {
            const customDomain = this.env.CUSTOM_DOMAIN;

            if (!customDomain) {
                console.error('CUSTOM_DOMAIN not set in environment');
                return null;
            }

            // Extract base domain from custom domain
            // For example: "abc.xyz.com" -> try "abc.xyz.com", "xyz.com", etc.
            const domainParts = customDomain.split('.');
            const possibleZones: string[] = [];

            for (let i = 0; i < domainParts.length - 1; i++) {
                const zoneName = domainParts.slice(i).join('.');
                possibleZones.push(zoneName);
            }

            // Try each possible zone
            for (const zoneName of possibleZones) {
                const response = await fetch(
                    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
                            'Content-Type': 'application/json',
                        },
                    }
                );

                const data = await response.json() as any;

                if (data.success && data.result && data.result.length > 0) {
                    const zone = data.result[0];
                    this.zoneIdCache = zone.id;
                    console.log(`Found zone: ${zoneName} (ID: ${zone.id})`);
                    return zone.id;
                }
            }

            console.error('No valid zone found for custom domain:', customDomain);
            return null;
        } catch (error) {
            console.error('Error getting zone ID:', error);
            return null;
        }
    }

    /**
     * Validate hostname format
     */
    static isValidHostname(hostname: string): boolean {
        // Basic hostname validation
        const hostnameRegex = /^(?=.{1,253}$)(([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/i;
        return hostnameRegex.test(hostname);
    }
}

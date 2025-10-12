/**
 * Image URL Validator
 *
 * Utility to validate image URLs and provide working alternatives
 * Addresses the recurring issue of 404 Unsplash images in generated code
 */

import { createLogger } from '../../logger';

const logger = createLogger('ImageUrlValidator');

export interface ImageValidationResult {
    url: string;
    isValid: boolean;
    statusCode?: number;
    error?: string;
    alternativeUrl?: string;
}

export interface BrokenImageFix {
    originalUrl: string;
    replacementUrl: string;
    reason: string;
}

/**
 * Reliable placeholder image services as fallbacks
 */
const FALLBACK_IMAGE_SERVICES = {
    picsum: (width: number = 800, height: number = 600, seed?: string) =>
        `https://picsum.photos/${width}/${height}${seed ? `?random=${seed}` : ''}`,
    placeholder: (width: number = 800, height: number = 600, text?: string) =>
        `https://via.placeholder.com/${width}x${height}${text ? `?text=${encodeURIComponent(text)}` : ''}`,
};

/**
 * Extract dimensions from image URL if present
 */
function extractDimensions(url: string): { width: number; height: number } {
    const widthMatch = url.match(/[?&]w=(\d+)/);
    const heightMatch = url.match(/[?&]h=(\d+)/);

    return {
        width: widthMatch ? parseInt(widthMatch[1]) : 800,
        height: heightMatch ? parseInt(heightMatch[1]) : 600,
    };
}

/**
 * Extract search term or context from URL for better fallback
 */
function extractImageContext(url: string): string {
    // Try to extract from Unsplash URL structure
    const photoIdMatch = url.match(/photo-([^?]+)/);
    if (photoIdMatch) {
        // Use photo ID as seed for consistent replacement
        return photoIdMatch[1].substring(0, 10);
    }

    // Generate a random seed
    return Math.random().toString(36).substring(2, 12);
}

/**
 * Validate if an image URL is accessible
 * Uses HEAD request to avoid downloading the entire image
 */
export async function validateImageUrl(
    url: string,
    timeout: number = 5000
): Promise<ImageValidationResult> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AIWA-ImageValidator/1.0)',
            },
        });

        clearTimeout(timeoutId);

        const isValid = response.ok;
        const statusCode = response.status;

        let alternativeUrl: string | undefined;
        if (!isValid) {
            const dimensions = extractDimensions(url);
            const context = extractImageContext(url);
            alternativeUrl = FALLBACK_IMAGE_SERVICES.picsum(
                dimensions.width,
                dimensions.height,
                context
            );
        }

        return {
            url,
            isValid,
            statusCode,
            alternativeUrl,
        };
    } catch (error) {
        logger.warn('Image URL validation failed:', { url, error });

        const dimensions = extractDimensions(url);
        const context = extractImageContext(url);

        return {
            url,
            isValid: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            alternativeUrl: FALLBACK_IMAGE_SERVICES.picsum(
                dimensions.width,
                dimensions.height,
                context
            ),
        };
    }
}

/**
 * Validate multiple image URLs in parallel
 */
export async function validateImageUrls(
    urls: string[],
    maxConcurrent: number = 5
): Promise<Map<string, ImageValidationResult>> {
    const results = new Map<string, ImageValidationResult>();

    // Process in batches to avoid overwhelming the network
    for (let i = 0; i < urls.length; i += maxConcurrent) {
        const batch = urls.slice(i, i + maxConcurrent);
        const batchResults = await Promise.all(
            batch.map(url => validateImageUrl(url))
        );

        batchResults.forEach(result => {
            results.set(result.url, result);
        });
    }

    return results;
}

/**
 * Extract all image URLs from code content
 */
export function extractImageUrls(content: string): string[] {
    const urlPattern = /https?:\/\/[^\s"'<>)]+\.(?:jpg|jpeg|png|gif|webp|svg)(?:[^\s"'<>)]*)?/gi;
    const matches = content.match(urlPattern) || [];
    return [...new Set(matches)]; // Remove duplicates
}

/**
 * Extract Unsplash URLs specifically
 */
export function extractUnsplashUrls(content: string): string[] {
    const unsplashPattern = /https?:\/\/images\.unsplash\.com\/[^\s"'<>)]+/gi;
    const matches = content.match(unsplashPattern) || [];
    return [...new Set(matches)];
}

/**
 * Generate fixes for broken image URLs
 */
export async function generateImageUrlFixes(
    content: string
): Promise<BrokenImageFix[]> {
    const fixes: BrokenImageFix[] = [];

    // Extract all Unsplash URLs (most likely to be broken)
    const unsplashUrls = extractUnsplashUrls(content);

    if (unsplashUrls.length === 0) {
        return fixes;
    }

    logger.info(`Validating ${unsplashUrls.length} Unsplash URLs...`);

    // Validate URLs in parallel
    const validationResults = await validateImageUrls(unsplashUrls);

    // Generate fixes for broken URLs
    validationResults.forEach((result, url) => {
        if (!result.isValid && result.alternativeUrl) {
            fixes.push({
                originalUrl: url,
                replacementUrl: result.alternativeUrl,
                reason: `URL returned ${result.statusCode || 'error'} - replaced with reliable alternative`,
            });

            logger.info('Found broken image URL:', {
                original: url,
                replacement: result.alternativeUrl,
                status: result.statusCode,
            });
        }
    });

    return fixes;
}

/**
 * Apply image URL fixes to content
 */
export function applyImageUrlFixes(
    content: string,
    fixes: BrokenImageFix[]
): string {
    let fixedContent = content;

    fixes.forEach(fix => {
        // Use regex to replace all occurrences, being careful with special characters
        const escapedOriginal = fix.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedOriginal, 'g');
        fixedContent = fixedContent.replace(regex, fix.replacementUrl);
    });

    return fixedContent;
}

/**
 * Create a curated list of reliable image URLs for common use cases
 * These are pre-validated and should always work
 */
export const RELIABLE_IMAGE_URLS = {
    hero: {
        tech: 'https://picsum.photos/1920/1080?random=tech',
        nature: 'https://picsum.photos/1920/1080?random=nature',
        business: 'https://picsum.photos/1920/1080?random=business',
        abstract: 'https://picsum.photos/1920/1080?random=abstract',
    },
    card: {
        square: (seed?: string) => `https://picsum.photos/400/400${seed ? `?random=${seed}` : ''}`,
        landscape: (seed?: string) => `https://picsum.photos/600/400${seed ? `?random=${seed}` : ''}`,
        portrait: (seed?: string) => `https://picsum.photos/400/600${seed ? `?random=${seed}` : ''}`,
    },
    thumbnail: {
        small: (seed?: string) => `https://picsum.photos/200/200${seed ? `?random=${seed}` : ''}`,
        medium: (seed?: string) => `https://picsum.photos/300/300${seed ? `?random=${seed}` : ''}`,
    },
};

/**
 * Get prompt guidance for using reliable image URLs
 */
export function getImageUrlGuidance(): string {
    return `
<IMAGE_URL_BEST_PRACTICES>
**CRITICAL: Use only reliable, validated image sources**

**Recommended Image Services (in priority order):**

1. **Picsum Photos (PREFERRED - 99.9% uptime)**
   - URL Pattern: https://picsum.photos/{width}/{height}?random={seed}
   - Examples:
     • Hero: https://picsum.photos/1920/1080?random=hero
     • Card: https://picsum.photos/600/400?random=card1
     • Thumbnail: https://picsum.photos/200/200?random=thumb
   - Use unique seed values for different images (e.g., user-1, product-2)
   - Always specify dimensions

2. **Placeholder.com (Fallback)**
   - URL Pattern: https://via.placeholder.com/{width}x{height}?text={text}
   - Example: https://via.placeholder.com/800x600?text=Product+Image

**AVOID Unsplash Direct URLs:**
- Many Unsplash photo IDs are invalid or deleted
- URLs like https://images.unsplash.com/photo-XXXXX often return 404
- If you must use Unsplash, use their official API or embed service

**Image URL Requirements:**
✓ Always include dimensions in URL
✓ Use consistent seed values for reproducible images
✓ Test URLs are accessible (valid photo IDs)
✓ Provide alt text for accessibility
✗ Never use hardcoded photo IDs without validation
✗ Never assume an Unsplash URL will work without checking

**Example Implementation:**
\`\`\`tsx
// ✓ GOOD - Reliable Picsum URLs
<img src="https://picsum.photos/800/600?random=hero" alt="Hero image" />
<img src="https://picsum.photos/400/400?random=avatar-1" alt="User avatar" />

// ✗ BAD - Unsplash URLs that may 404
<img src="https://images.unsplash.com/photo-1234567890" alt="Image" />
\`\`\`
</IMAGE_URL_BEST_PRACTICES>
`;
}

/**
 * Enhanced Fast Code Fixer - Image URL Fixes
 *
 * Extends the Fast Code Fixer to automatically detect and replace
 * broken image URLs (especially Unsplash 404s) with reliable alternatives
 */

import { FileOutputType } from '../schemas';
import {
    extractUnsplashUrls,
    generateImageUrlFixes,
    applyImageUrlFixes,
    BrokenImageFix,
    getImageUrlGuidance
} from '../utils/imageUrlValidator';
import { createLogger } from '../../logger';

const logger = createLogger('ImageUrlFixer');

export interface ImageFixResult {
    filesFixed: number;
    urlsReplaced: number;
    fixes: BrokenImageFix[];
}

/**
 * Additional system prompt content for image URL fixing
 */
export const IMAGE_FIX_SYSTEM_PROMPT = `
<IMAGE_URL_FIX_PATTERNS>

**Pattern: Broken Unsplash URLs**

Problem: Unsplash URLs return 404 errors
\`\`\`tsx
// ✗ BROKEN - These often 404
<img src="https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?..." />
<img src="https://images.unsplash.com/photo-1591291621265-b3488b693869?..." />
\`\`\`

Fix: Replace with reliable Picsum Photos
\`\`\`tsx
// ✓ FIXED - 99.9% uptime, reliable
<img src="https://picsum.photos/800/600?random=image1" />
<img src="https://picsum.photos/800/600?random=image2" />
\`\`\`

**Fix Confidence: HIGH**
**Priority: HIGH** (Broken images are deployment blockers)

**Fix Strategy:**
1. Extract dimensions from Unsplash URL query params (w= and h=)
2. Generate unique seed from photo ID for consistency
3. Replace with Picsum URL using same dimensions
4. Preserve alt text and other attributes

**Example Transformation:**

Before:
\`\`\`tsx
<div className="hero">
  <img
    src="https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=800&auto=format"
    alt="Mountain landscape"
    className="w-full h-96"
  />
</div>
\`\`\`

After:
\`\`\`tsx
<div className="hero">
  <img
    src="https://picsum.photos/800/384?random=1544367567"
    alt="Mountain landscape"
    className="w-full h-96"
  />
</div>
\`\`\`

**Dimension Extraction:**
• w=800 → width: 800
• h=600 → height: 600 (or calculate from aspect ratio)
• If no dimensions: use defaults (800x600)

**Seed Generation:**
• Extract photo ID: photo-1544367567-0f2fcb009e0b → 1544367567
• Use first 10 chars as seed for consistency
• Same photo ID → same replacement image

</IMAGE_URL_FIX_PATTERNS>

${getImageUrlGuidance()}
`;

/**
 * Automatically fix broken image URLs in files
 *
 * This function:
 * 1. Scans files for image URLs
 * 2. Validates Unsplash URLs (most likely to be broken)
 * 3. Generates replacement URLs
 * 4. Applies fixes to file contents
 *
 * @param files - Array of files to check and fix
 * @returns Fixed files and summary of changes
 */
export async function autoFixImageUrls(
    files: FileOutputType[]
): Promise<{ fixedFiles: FileOutputType[]; result: ImageFixResult }> {
    logger.info(`Scanning ${files.length} files for broken image URLs...`);

    const fixedFiles: FileOutputType[] = [];
    const allFixes: BrokenImageFix[] = [];
    let totalUrlsReplaced = 0;
    let filesFixed = 0;

    for (const file of files) {
        // Skip non-code files
        if (
            file.filePath.endsWith('.json') ||
            file.filePath.endsWith('.md') ||
            file.filePath.endsWith('.css')
        ) {
            fixedFiles.push(file);
            continue;
        }

        // Check if file contains Unsplash URLs
        const unsplashUrls = extractUnsplashUrls(file.fileContents);

        if (unsplashUrls.length === 0) {
            // No Unsplash URLs, no fixes needed
            fixedFiles.push(file);
            continue;
        }

        logger.info(`Found ${unsplashUrls.length} Unsplash URLs in ${file.filePath}`);

        // Generate fixes for this file
        const fileFixes = await generateImageUrlFixes(file.fileContents);

        if (fileFixes.length === 0) {
            // All URLs are valid, no fixes needed
            fixedFiles.push(file);
            continue;
        }

        logger.info(
            `Fixing ${fileFixes.length} broken image URLs in ${file.filePath}`,
            { fixes: fileFixes }
        );

        // Apply fixes to file content
        const fixedContent = applyImageUrlFixes(file.fileContents, fileFixes);

        // Create fixed file
        fixedFiles.push({
            ...file,
            fileContents: fixedContent,
        });

        // Update counters
        filesFixed++;
        totalUrlsReplaced += fileFixes.length;
        allFixes.push(...fileFixes);
    }

    const result: ImageFixResult = {
        filesFixed,
        urlsReplaced: totalUrlsReplaced,
        fixes: allFixes,
    };

    if (filesFixed > 0) {
        logger.info(
            `Image URL auto-fix completed: ${filesFixed} files fixed, ${totalUrlsReplaced} URLs replaced`
        );
    } else {
        logger.info('No broken image URLs detected');
    }

    return { fixedFiles, result };
}

/**
 * User prompt addition for image URL fixes
 * Add this to the FastCodeFixer USER_PROMPT
 */
export const IMAGE_FIX_USER_PROMPT = `
<IMAGE_URL_FIX_INSTRUCTIONS>

**CRITICAL PRIORITY: Fix Broken Image URLs**

Before analyzing other issues, scan ALL files for broken image URLs:

1. **Detection:**
   - Search for: https://images.unsplash.com/photo-*
   - These URLs frequently return 404 errors
   - Broken images are deployment blockers

2. **Validation:**
   - Unsplash URLs with random photo IDs are unreliable
   - Many Unsplash photos are deleted or unavailable
   - Without validation, assume Unsplash URLs may be broken

3. **Fix Application:**
   For EACH Unsplash URL found:

   a. Extract dimensions:
      - Look for w= and h= query parameters
      - Default to 800x600 if not specified

   b. Generate seed:
      - Use photo ID as seed for consistency
      - Example: photo-1544367567 → seed "1544367567"

   c. Create replacement:
      - Format: https://picsum.photos/{width}/{height}?random={seed}
      - Example: https://picsum.photos/800/600?random=1544367567

   d. Apply fix:
      - Replace entire Unsplash URL with Picsum URL
      - Preserve all other attributes (alt, className, etc.)

4. **Output Format:**
   For each file with broken images:
   \`\`\`tsx
   // File: src/components/Hero.tsx

   // Before:
   <img src="https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=800" />

   // After:
   <img src="https://picsum.photos/800/600?random=1544367567" />
   \`\`\`

**Example Complete Fix:**

File: src/pages/Home.tsx

Issues Detected:
- Line 23: Broken Unsplash URL (likely to 404)
- Line 45: Broken Unsplash URL (likely to 404)
- Line 67: Broken Unsplash URL (likely to 404)

Fixes Applied:
\`\`\`tsx
// Line 23 - Hero Image
- <img src="https://images.unsplash.com/photo-1544367567?w=1920&h=1080" alt="Hero" />
+ <img src="https://picsum.photos/1920/1080?random=1544367567" alt="Hero" />

// Line 45 - Card Image 1
- <img src="https://images.unsplash.com/photo-1591291621?w=600&h=400" alt="Card 1" />
+ <img src="https://picsum.photos/600/400?random=1591291621" alt="Card 1" />

// Line 67 - Card Image 2
- <img src="https://images.unsplash.com/photo-1234567890?w=600&h=400" alt="Card 2" />
+ <img src="https://picsum.photos/600/400?random=1234567890" alt="Card 2" />
\`\`\`

Verification Steps:
• Open browser and verify all images load
• Check that replacement images are appropriate
• Confirm no broken image icons appear

**Priority:** Treat broken image URLs as HIGH CONFIDENCE fixes
**Impact:** Deployment blockers - must be fixed before release

</IMAGE_URL_FIX_INSTRUCTIONS>
`;

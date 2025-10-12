import { Blueprint, ScreenshotAnalysisSchema, ScreenshotAnalysisType } from '../schemas';
import { createSystemMessage, createMultiModalUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { PROMPT_UTILS } from '../prompts';
import { ScreenshotData } from '../core/types';
import { AgentOperation, OperationOptions } from './common';
import { OperationError } from '../utils/operationError';
import {
    extractImageUrls,
    validateImageUrls,
    BrokenImageFix,
    getImageUrlGuidance
} from '../utils/imageUrlValidator';

export interface ScreenshotAnalysisInput {
    screenshotData: ScreenshotData,
}

// Extended analysis type to include image validation results
export interface EnhancedScreenshotAnalysisType extends ScreenshotAnalysisType {
    brokenImageUrls?: string[];
    imageFixes?: BrokenImageFix[];
}

const SYSTEM_PROMPT = `You are a UI/UX Quality Assurance Specialist at Apple analyzing application screenshots against blueprint specifications.

<ANALYSIS_FRAMEWORK>

**Systematic Visual Inspection (Time-Boxed: ~2-3 minutes total):**

1. LAYOUT STRUCTURE (30 seconds):
   Check fundamental page structure:
   ☐ Header present and positioned correctly?
   ☐ Sidebar/navigation where blueprint specifies?
   ☐ Main content area properly sized and positioned?
   ☐ Footer present if specified in blueprint?
   ☐ Grid/flexbox layout working as intended?

   Look for: Misalignment, overlapping elements, broken containers

2. COMPONENT PRESENCE (30 seconds):
   Verify all blueprint components are visible:
   ☐ All specified buttons/forms/cards rendered?
   ☐ Images loaded correctly (NO broken/missing images)?
   ☐ Text content present and readable?
   ☐ Interactive elements visible?
   ☐ Data displays showing properly?

   **CRITICAL: Flag ANY broken or missing images as HIGH PRIORITY issues**
   Look for: Missing components, placeholder content not replaced, broken images

3. IMAGE VALIDATION (30 seconds - NEW):
   Check all visible images:
   ☐ Are all images actually loading?
   ☐ Any placeholder icons or broken image indicators?
   ☐ Do images appear correctly sized and positioned?
   ☐ Are there alt text warnings in browser console?

   **Images are a common failure point - pay close attention**

4. VISUAL POLISH (30 seconds):
   Assess visual quality and professional appearance:
   ☐ Spacing consistent (not cramped or excessive)?
   ☐ Typography readable (appropriate size, contrast)?
   ☐ Colors match blueprint intent and design system?
   ☐ Alignment clean (no misaligned elements)?
   ☐ Shadows/borders where expected?
   ☐ Visual hierarchy clear?

   Look for: Unprofessional appearance, poor spacing, weak contrast

5. RESPONSIVE CHECK (30 seconds):
   Validate layout for given viewport:
   ☐ Content fits viewport (no unexpected overflow/scrolling)?
   ☐ Text readable at current screen size?
   ☐ Touch targets appropriate for device?
   ☐ Layout doesn't break at this width?
   ☐ Images scale appropriately?

   Look for: Broken responsive behavior, mobile usability issues

**Analysis Priority:**
1. **Critical Issues**: Broken images, missing components, broken layouts, unreadable text
2. **High Priority**: Incorrect positioning, poor spacing, missing states
3. **Medium Priority**: Color mismatches, minor alignment issues
4. **Low Priority**: Aesthetic improvements, subtle polish

**Focus:** Broken images and deployment-blocking issues first.
</ANALYSIS_FRAMEWORK>

${getImageUrlGuidance()}

<OUTPUT_STRUCTURE>
Return structured findings with clear prioritization:

{
  "hasIssues": boolean,
  "criticalIssues": [
    "Broken/missing images that prevent proper display",
    "Missing components that prevent core functionality",
    "Broken layouts that make content inaccessible",
    "Unreadable text (too small, insufficient contrast)"
  ],
  "highPriorityIssues": [
    "Components mispositioned compared to blueprint",
    "Image loading failures or broken image URLs",
    "Inconsistent or poor spacing affecting readability",
    "Missing loading/error states"
  ],
  "mediumPriorityIssues": [
    "Color scheme variations from blueprint",
    "Minor alignment inconsistencies",
    "Suboptimal visual hierarchy"
  ],
  "uiCompliance": {
    "matchesBlueprint": boolean,
    "complianceScore": 1-10,
    "deviations": [
      "Specific differences from blueprint specifications"
    ]
  },
  "suggestions": [
    "HIGH IMPACT: Fix broken image URLs - replace with reliable sources",
    "HIGH IMPACT: [Other high-impact suggestions]",
    "MEDIUM IMPACT: [Medium-impact suggestions]"
  ]
}

**Image-Specific Scoring Impact:**
• Broken images reduce score by 2-3 points
• Missing images reduce score by 1-2 points
• Low-quality images reduce score by 0.5-1 point

</OUTPUT_STRUCTURE>

<CRITICAL_IMAGE_DETECTION>
**How to Identify Broken Images in Screenshots:**

1. **Visual Indicators:**
   • Broken image icon (usually a small square with an X)
   • Placeholder text like "Image failed to load"
   • Empty rectangular spaces where images should be
   • Alt text displayed instead of image
   • Browser's broken image indicator (varies by browser)

2. **Context Clues:**
   • Image container present but no visible image
   • Layout gaps where images should fill space
   • Misaligned content suggesting missing images
   • Generic placeholder images instead of actual content

3. **Severity Classification:**
   • Hero images broken = CRITICAL
   • Product/content images broken = HIGH
   • Decorative images broken = MEDIUM
   • Background images broken = MEDIUM

**Always explicitly mention broken images in analysis**
</CRITICAL_IMAGE_DETECTION>`;

const USER_PROMPT = `Analyze this screenshot against blueprint requirements.

**Blueprint Context:**
{{blueprint}}

**Viewport:** {{viewport}}

**Analysis Task:**
Perform systematic inspection with **special focus on image loading**.

1. **FIRST**: Check for broken or missing images (CRITICAL)
2. Layout structure verification
3. Component presence check
4. Visual polish assessment
5. Responsive validation

**Image Validation Priority:**
• Broken images are deployment blockers
• Flag ANY image loading failures as CRITICAL or HIGH priority
• Suggest replacing broken image URLs with reliable alternatives
• Provide specific recommendations for image URL replacements

**Output Requirements:**
• Classify issues by priority: Critical, High, Medium
• **Explicitly call out broken images if detected**
• Provide compliance score (reduce by 2-3 points for broken images)
• List specific deviations from blueprint
• Give actionable suggestions prioritized by impact
• **For broken images, suggest using Picsum Photos or other reliable sources**

**Be Specific and Actionable:**
Instead of "images not loading", say "Hero image at top failed to load - replace Unsplash URL with https://picsum.photos/1920/1080?random=hero"
Instead of "broken images", say "3 product card images showing broken image icons - replace with Picsum URLs"`;

function userPromptFormatter(
    screenshotData: { viewport: { width: number; height: number } },
    blueprint: Blueprint
): string {
    const prompt = PROMPT_UTILS.replaceTemplateVariables(USER_PROMPT, {
        blueprint: JSON.stringify(blueprint, null, 2),
        viewport: `${screenshotData.viewport.width}x${screenshotData.viewport.height}`,
    });
    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class ScreenshotAnalysisOperation extends AgentOperation<
    ScreenshotAnalysisInput,
    EnhancedScreenshotAnalysisType
> {
    async execute(
        input: ScreenshotAnalysisInput,
        options: OperationOptions
    ): Promise<EnhancedScreenshotAnalysisType> {
        const { screenshotData } = input;
        const { env, context, logger } = options;

        try {
            logger.info('Analyzing screenshot with enhanced image validation', {
                url: screenshotData.url,
                viewport: screenshotData.viewport,
            });

            if (!screenshotData.screenshot) {
                throw new Error('No screenshot data available for analysis');
            }

            // Step 1: Perform AI-based screenshot analysis
            const messages = [
                createSystemMessage(SYSTEM_PROMPT),
                createMultiModalUserMessage(
                    userPromptFormatter(screenshotData, context.blueprint),
                    screenshotData.screenshot,
                    'high'
                ),
            ];

            const { object: analysisResult } = await executeInference({
                env: env,
                messages,
                schema: ScreenshotAnalysisSchema,
                agentActionName: 'screenshotAnalysis',
                context: options.inferenceContext,
                retryLimit: 3,
            });

            if (!analysisResult) {
                logger.warn('Screenshot analysis returned no result');
                throw new Error('No analysis result');
            }

            // Step 2: Validate image URLs in the current codebase
            logger.info('Validating image URLs in codebase...');
            const allFiles = context.allFiles;
            const imageUrls: string[] = [];

            // Extract all image URLs from all files
            allFiles.forEach(file => {
                const urls = extractImageUrls(file.fileContents);
                imageUrls.push(...urls);
            });

            // Remove duplicates
            const uniqueImageUrls = [...new Set(imageUrls)];

            if (uniqueImageUrls.length > 0) {
                logger.info(`Found ${uniqueImageUrls.length} image URLs to validate`);

                // Validate URLs (limit to 20 to avoid excessive requests)
                const urlsToValidate = uniqueImageUrls.slice(0, 20);
                const validationResults = await validateImageUrls(urlsToValidate, 5);

                // Collect broken URLs
                const brokenUrls: string[] = [];
                const fixes: BrokenImageFix[] = [];

                validationResults.forEach((result, url) => {
                    if (!result.isValid) {
                        brokenUrls.push(url);
                        if (result.alternativeUrl) {
                            fixes.push({
                                originalUrl: url,
                                replacementUrl: result.alternativeUrl,
                                reason: `URL validation failed (status: ${result.statusCode || 'error'})`,
                            });
                        }
                    }
                });

                if (brokenUrls.length > 0) {
                    logger.warn(`Found ${brokenUrls.length} broken image URLs`, { brokenUrls });
                }

                // Enhance analysis result with image validation data
                const enhancedResult: EnhancedScreenshotAnalysisType = {
                    ...analysisResult,
                    brokenImageUrls: brokenUrls,
                    imageFixes: fixes,
                };

                // If we found broken URLs but AI didn't detect them, add to issues
                if (brokenUrls.length > 0 && !analysisResult.hasIssues) {
                    enhancedResult.hasIssues = true;
                    enhancedResult.issues = [
                        ...(analysisResult.issues || []),
                        `${brokenUrls.length} broken image URL(s) detected in codebase - will cause loading failures`,
                    ];
                }

                logger.info('Enhanced screenshot analysis completed', {
                    hasIssues: enhancedResult.hasIssues,
                    issueCount: enhancedResult.issues.length,
                    brokenImages: brokenUrls.length,
                    matchesBlueprint: enhancedResult.uiCompliance.matchesBlueprint,
                });

                return enhancedResult;
            }

            // No images found to validate, return standard analysis
            logger.info('No image URLs found in codebase to validate');
            return {
                ...analysisResult,
                brokenImageUrls: [],
                imageFixes: [],
            };
        } catch (error) {
            OperationError.logAndThrow(logger, 'screenshot analysis', error);
        }
    }
}

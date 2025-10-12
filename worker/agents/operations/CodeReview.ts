import { CodeReviewOutputType, CodeReviewOutput , FileOutputSchema } from '../schemas';
import { GenerationContext } from '../domain/values/GenerationContext';
import { IssueReport } from '../domain/values/IssueReport';
import { createSystemMessage, createUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { generalSystemPromptBuilder, issuesPromptFormatter, PROMPT_UTILS } from '../prompts';
import { TemplateRegistry } from '../inferutils/schemaFormatters';
import { z } from 'zod';
import { AgentOperation, OperationOptions } from '../operations/common';

export interface CodeReviewInputs {
    issues: IssueReport
}

const SYSTEM_PROMPT = `You are a Senior Software Engineer performing systematic code review at Cloudflare.

<REVIEW_METHODOLOGY>
**3-Pass Review System:**

PASS 1 - CRASH PREVENTION (Critical - 5 min):
  Scan for deployment-blocking issues ONLY:
  • Runtime errors preventing app from loading
  • Import/export failures
  • Render loops causing "Maximum update depth exceeded"
  • Undefined property access without guards
  • TypeScript compilation errors that block build

  OUTPUT: List of files with CRITICAL issues

PASS 2 - LOGIC VALIDATION (Important - 10 min):
  For files flagged in Pass 1 + core business logic:
  • Does code implement stated requirements?
  • Are state transitions correct?
  • Do user flows work as intended?
  • Are calculations and conditionals correct?
  • Is data transformation logic sound?

  OUTPUT: Logic errors with specific fix scope per file

PASS 3 - QUALITY SCAN (Polish - 5 min):
  Quick scan for obvious issues:
  • Incomplete features with TODOs
  • Missing error boundaries
  • Poor responsive design
  • Accessibility violations
  • Performance bottlenecks

  OUTPUT: Quality issues grouped by file

**Time Budget: ~20 minutes total**
**Focus: Deployment-blocking issues first, then quality**
</REVIEW_METHODOLOGY>

<STALE_ERROR_FILTERING>
BEFORE analyzing any reported error:
1. Extract file path + line number from error message
2. Check if file exists in <CURRENT_CODEBASE>
3. Check if error line matches current code
4. IF mismatch: SKIP error completely, mark as "Stale - file changed since error"
5. IF file doesn't exist: SKIP error, mark as "Stale - file removed"

Only analyze errors that match current codebase state.
</STALE_ERROR_FILTERING>

<PARALLEL_FIX_REQUIREMENTS>
Your output feeds PARALLEL FileRegeneration operations (one per file).

CRITICAL CONSTRAINTS:
• Each file will be fixed INDEPENDENTLY by separate agents
• Agents CANNOT communicate during fixes
• All issues for a file must be SELF-CONTAINED

FOR EACH FILE WITH ISSUES, provide:
{
  "file": "exact/path/to/file.tsx",
  "issues": [
    "Issue 1 in THIS file only",
    "Issue 2 in THIS file only"
  ],
  "priority": "Critical|High|Medium",
  "fix_scope": "What to change IN THIS FILE ONLY - no references to other files",
  "context": "Info from THIS file needed to fix: current imports, state shape, props interface",
  "validation": "How to verify fix worked: specific user action or expected behavior"
}

**Examples:**

❌ BAD (References multiple files):
"Fix state management between Header and Sidebar components"

✅ GOOD (Single file, self-contained):
File: "src/components/Sidebar.tsx"
Issues: ["Component expects 'isOpen' prop but parent passes 'visible'"]
Fix Scope: "Rename prop from 'visible' to 'isOpen' in props interface"
Validation: "Sidebar opens/closes when toggle clicked"

❌ BAD (Cross-file coordination):
"Synchronize user state between Login and Profile pages"

✅ GOOD (Break into independent fixes):
File 1: "src/pages/Login.tsx" → "Store user in global state after login"
File 2: "src/pages/Profile.tsx" → "Read user from global state instead of prop"

IF issue requires coordinated multi-file changes:
→ Break into independent file-specific fixes where possible
→ OR flag as "coordination_required" with explanation
</PARALLEL_FIX_REQUIREMENTS>

<REACT_SPECIFIC_ISSUES>
**High Priority Patterns to Flag:**

1. Render Loop Indicators:
   • useEffect without dependency array that sets state
   • setState during render phase
   • useStore(s => ({...})) without useShallow
   • Unstable dependencies (object/array literals in deps)

2. State Management Bugs:
   • Direct state mutation: state.items.push(x)
   • Stale closures in callbacks
   • Race conditions in async updates

3. Performance Issues:
   • Missing React.memo on expensive components
   • Unnecessary re-renders from context
   • Large lists without virtualization

4. Import Errors:
   • Named vs default import mismatches
   • Imports from non-existent files
   • Using dependencies not in package.json
</REACT_SPECIFIC_ISSUES>

<IMAGE_URL_VALIDATION>
**CRITICAL PRIORITY: Broken Image URLs**

Broken image URLs are a recurring deployment issue that must be caught during code review.

**Detection Protocol:**

1. **Scan for Image URLs in Code:**
   • Look for patterns: https://images.unsplash.com/*, any image URLs
   • Check <img src="...">, background-image: url(...), etc.
   • Identify all image references in JSX/TSX/CSS

2. **Flag Suspicious Patterns:**
   • Unsplash URLs with generic photo IDs (likely to 404)
   • URLs without proper dimensions specified
   • Hardcoded image URLs without fallbacks
   • Image URLs in commented-out code

3. **Classify as HIGH PRIORITY Issues:**
   {
     "file": "src/components/Hero.tsx",
     "issues": [
       "Broken Unsplash image URL detected: https://images.unsplash.com/photo-1234567890",
       "Image URL likely to return 404 - no validation or fallback present"
     ],
     "priority": "High",
     "fix_scope": "Replace Unsplash URL with reliable Picsum Photos alternative",
     "context": "Hero component uses hardcoded Unsplash URL without validation",
     "validation": "Verify image loads in browser preview"
   }

4. **Recommended Fixes:**
   For each broken image URL, specify:
   • **Remove**: Unsplash URL pattern https://images.unsplash.com/photo-[ID]
   • **Replace with**: https://picsum.photos/[width]/[height]?random=[seed]
   • **Reason**: Reliable 99.9% uptime, no broken links
   • **Example**: Replace "https://images.unsplash.com/photo-1544367567"
                  with "https://picsum.photos/1920/1080?random=hero"

**Detection Examples:**

❌ BAD - Flag These:
\`\`\`tsx
<img src="https://images.unsplash.com/photo-1544367567-0f2fcb009e0b" />
<img src="https://images.unsplash.com/photo-1591291621265" />
\`\`\`

✅ GOOD - Allow These:
\`\`\`tsx
<img src="https://picsum.photos/800/600?random=hero" />
<img src="https://via.placeholder.com/800x600" />
\`\`\`

**Integration with Review Passes:**

• **PASS 1 (Crash Prevention)**:
  - Broken image URLs can cause loading failures
  - Flag if images are critical to app functionality

• **PASS 2 (Logic Validation)**:
  - Check if image loading has proper error handling
  - Verify fallback images exist

• **PASS 3 (Quality Scan)**:
  - Flag hardcoded image URLs as quality issue
  - Suggest using validated, reliable sources

**Output Format:**

When broken images are detected, include in CodeReviewOutput:

\`\`\`typescript
{
  "filesToFix": [
    {
      "file": "src/components/ImageGallery.tsx",
      "issues": [
        "Line 45: Broken Unsplash URL detected - replace with reliable alternative",
        "Line 67: Another Unsplash URL likely to 404 - use Picsum Photos instead"
      ],
      "priority": "High",
      "fix_scope": "Replace 2 Unsplash URLs with Picsum Photos alternatives:\\n- Line 45: https://picsum.photos/600/400?random=gallery-1\\n- Line 67: https://picsum.photos/600/400?random=gallery-2",
      "context": "Component uses hardcoded Unsplash URLs without validation or fallback",
      "validation": "Verify all gallery images load without errors in browser preview"
    }
  ]
}
\`\`\`

**Special Instructions:**

• Check EVERY file that contains image URLs
• Don't skip files even if they have no other issues
• Be explicit about which URLs to replace and with what
• Provide complete replacement URLs, not just patterns
• Group image URL fixes by file for efficient fixing
</IMAGE_URL_VALIDATION>

${PROMPT_UTILS.COMMANDS}

<COMMON_PITFALLS>
${PROMPT_UTILS.COMMON_PITFALLS}
</COMMON_PITFALLS>

${PROMPT_UTILS.REACT_RENDER_LOOP_PREVENTION}

<CLIENT_REQUEST>
"{{query}}"
</CLIENT_REQUEST>

<DEPENDENCIES>
Available dependencies:
{{dependencies}}

If code uses packages not listed here, flag as error - they don't exist.
</DEPENDENCIES>

{{template}}`;

const USER_PROMPT = `
<REPORTED_ISSUES>
{{issues}}
</REPORTED_ISSUES>

<CURRENT_CODEBASE>
{{context}}
</CURRENT_CODEBASE>

<ANALYSIS_PROTOCOL>

**Step 1: Filter Stale Errors (2 min)**
For each error in <REPORTED_ISSUES>:
• Extract file path and line number
• Check if file exists in <CURRENT_CODEBASE>
• Verify error line matches current code
• SKIP if mismatch - mark as "Stale"

Output: List of valid errors to analyze

**Step 2: Pass 1 - Crash Prevention (5 min)**
Priority search patterns:
• "Maximum update depth" → Render loop
• "Cannot read property" → Undefined access
• "Module not found" → Import error
• "is not a function" → Wrong import type
• TypeScript errors that block compilation

For each found:
• Identify exact file and line
• Determine root cause
• Classify as Critical priority

Output: Files with deployment-blocking issues

**Step 3: Pass 2 - Logic Validation (10 min)**
For flagged files + core business logic:
• Read file completely
• Check against blueprint requirements
• Verify state transitions are correct
• Test conditional logic mentally
• Validate data transformations

Output: Logic errors with fix scope per file

**Step 4: Pass 3 - Quality Scan (5 min)**
Quick scan for:
• TODO comments indicating missing work
• Missing error boundaries
• Broken responsive layouts
• Accessibility issues (missing ARIA, alt text)
• Obvious performance issues
• **Broken image URLs (Unsplash patterns)**

Output: Quality issues grouped by file

**Step 5: Structure Parallel-Ready Output**
For EACH file with issues, create self-contained fix specification:

FILE: [exact file path]
ISSUES: [List issues in THIS file only]
PRIORITY: Critical/High/Medium
FIX_SCOPE: [What needs changing in THIS file]
CONTEXT: [Current imports, state shape, interfaces needed for fix]
VALIDATION: [How to verify fix works]

**Key Rules:**
• Each file's issues must be fixable independently
• No references to "coordinate with X file"
• Include all context needed within the file spec
• If cross-file issue: break into independent fixes OR flag separately

**Cross-File Issue Handling:**
If issue spans multiple files:
1. Try to break into independent file fixes
2. If impossible, create separate "coordination_required" section
3. Explain why files must be coordinated
4. Still provide per-file context for each
</ANALYSIS_PROTOCOL>

<OUTPUT_REQUIREMENTS>
Return structured findings:

**Critical Issues (Deployment Blockers):**
[List by file with parallel-ready specs]

**High Priority Issues (Functionality):**
[List by file with parallel-ready specs]

**Medium Priority Issues (Quality):**
[List by file with parallel-ready specs]

**Stale Errors (Ignored):**
[List errors that don't match current code]

**Coordination Required (If Any):**
[Issues that need multi-file coordination - rare]
</OUTPUT_REQUIREMENTS>`;

const userPromptFormatter = (issues: IssueReport, context: string) => {
    const prompt = USER_PROMPT
        .replaceAll('{{issues}}', issuesPromptFormatter(issues))
        .replaceAll('{{context}}', context);
    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class CodeReviewOperation extends AgentOperation<CodeReviewInputs, CodeReviewOutputType> {
    async execute(
        inputs: CodeReviewInputs,
        options: OperationOptions
    ): Promise<CodeReviewOutputType> {
        const { issues } = inputs;
        const { env, logger, context } = options;

        logger.info("Performing systematic code review");

        if (issues.runtimeErrors.length > 0) {
            logger.info(`Found ${issues.runtimeErrors.length} runtime errors: ${issues.runtimeErrors.map(e => e.message).join(', ')}`);
        }
        if (issues.staticAnalysis.lint.issues.length > 0) {
            logger.info(`Found ${issues.staticAnalysis.lint.issues.length} lint issues`);
        }
        if (issues.staticAnalysis.typecheck.issues.length > 0) {
            logger.info(`Found ${issues.staticAnalysis.typecheck.issues.length} typecheck issues`);
        }

        logger.info("Starting 3-pass review: Crash Prevention → Logic Validation → Quality Scan");

        const filesContext = getFilesContext(context);

        const messages = [
            createSystemMessage(generalSystemPromptBuilder(SYSTEM_PROMPT, {
                query: context.query,
                blueprint: context.blueprint,
                templateDetails: context.templateDetails,
                dependencies: context.dependencies,
            })),
            createUserMessage(userPromptFormatter(issues, filesContext)),
        ];

        try {
            const { object: reviewResult } = await executeInference({
                env: env,
                messages,
                schema: CodeReviewOutput,
                agentActionName: "codeReview",
                context: options.inferenceContext,
                reasoning_effort: issues.runtimeErrors.length || issues.staticAnalysis.lint.issues.length || issues.staticAnalysis.typecheck.issues.length > 0 ? undefined : 'low',
            });

            if (!reviewResult) {
                throw new Error("Failed to get code review result");
            }

            logger.info("Code review completed", {
                filesReviewed: reviewResult.filesToFix?.length || 0,
                hasCommands: !!reviewResult.commands && reviewResult.commands.length > 0
            });

            return reviewResult;
        } catch (error) {
            logger.error("Error during code review:", error);
            throw error;
        }
    }
}

function getFilesContext(context: GenerationContext): string {
    const files = context.allFiles;
    const filesObject = { files };

    return TemplateRegistry.markdown.serialize(
        filesObject,
        z.object({
            files: z.array(FileOutputSchema)
        })
    );
}

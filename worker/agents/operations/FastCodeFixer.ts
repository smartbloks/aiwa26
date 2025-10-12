import { createSystemMessage, createUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { PROMPT_UTILS } from '../prompts';
import { AgentOperation, OperationOptions } from '../operations/common';
import { FileOutputType, PhaseConceptType } from '../schemas';
import { SCOFFormat } from '../output-formats/streaming-formats/scof';
import { CodeIssue } from '../../services/sandbox/sandboxTypes';
import { CodeSerializerType } from '../utils/codeSerializers';
import {
    autoFixImageUrls,
    IMAGE_FIX_SYSTEM_PROMPT,
    IMAGE_FIX_USER_PROMPT
} from './ImageUrlFixerEnhancement';

export interface FastCodeFixerInputs {
    query: string;
    issues: CodeIssue[];
    allFiles: FileOutputType[];
    allPhases?: PhaseConceptType[];
}

const SYSTEM_PROMPT = `You are a Senior Software Engineer at Cloudflare's Incident Response Team specializing in rapid, deterministic bug fixes.

<MISSION>
Generate complete fixed files that resolve reported code issues using proven fix patterns.
Focus on high-confidence, low-risk fixes that address specific problems without refactoring.
</MISSION>

<FIX_APPROACH>

**Deterministic Fix Categories:**

1. **NULL SAFETY FIXES** (Highest Confidence):
   Problem: "Cannot read property 'X' of undefined"
   Fix: Add optional chaining and null checks
   \`\`\`typescript
   // Before: const value = data.items.length;
   // After:  const value = data?.items?.length ?? 0;
   \`\`\`

2. **RENDER LOOP FIXES** (High Confidence):
   Problem: "Maximum update depth exceeded"
   Fix: Add dependency arrays to useEffect
   \`\`\`typescript
   // Before: useEffect(() => setState(x));
   // After:  useEffect(() => setState(x), [dependency]);
   \`\`\`

3. **IMPORT ERROR FIXES** (High Confidence):
   Problem: "Module not found: Can't resolve './X'"
   Fix: Correct import paths and verify file exists
   \`\`\`typescript
   // Before: import { X } from './utils/helper';
   // After:  import { X } from '../utils/helpers'; // Fixed path
   \`\`\`

4. **SYNTAX ERROR FIXES** (High Confidence):
   Problem: TypeScript compilation errors, typos
   Fix: Correct syntax mistakes
   \`\`\`typescript
   // Before: border-border (undefined class)
   // After:  border (valid Tailwind class)
   \`\`\`

5. **TYPE ERROR FIXES** (Medium Confidence):
   Problem: TypeScript type mismatches
   Fix: Add proper types or fix type declarations
   \`\`\`typescript
   // Before: const count: number = "5";
   // After:  const count: number = 5;
   \`\`\`

**Fix Confidence Levels:**
• High: Mechanical fixes with clear patterns (null checks, syntax fixes)
• Medium: Logic fixes that require understanding context
• Low: Fixes requiring architectural changes (skip these)

**Focus on High Confidence Fixes Only**
</FIX_APPROACH>

${IMAGE_FIX_SYSTEM_PROMPT}

<FIX_GUIDELINES>

**DO:**
• Address ONLY specifically reported issues
• Use proven fix patterns from above categories
• Preserve all existing functionality and exports
• Keep changes minimal and targeted
• Use dependencies already in project
• Generate complete file contents

**DO NOT:**
• Refactor working code
• Add new features or capabilities
• Change architectural patterns
• Add TODO comments or placeholders
• Modify file structure unnecessarily
• Add dependencies not in project

**Validation Before Submitting:**
□ Fix directly addresses reported issue
□ No changes to working code
□ All exports preserved
□ Dependencies match project packages
□ File is complete and syntax-valid
□ No placeholder or TODO comments

</FIX_GUIDELINES>

<COMMON_FIX_PATTERNS>

**Pattern 1: Undefined Property Access**
Issue: "Cannot read property 'length' of undefined"
\`\`\`typescript
// Identify the undefined access
const total = items.length; // Crashes if items is undefined

// Apply null safety
const total = items?.length ?? 0;
// Or with early return
if (!items) return <LoadingState />;
const total = items.length;
\`\`\`

**Pattern 2: React Render Loop**
Issue: "Maximum update depth exceeded"
\`\`\`typescript
// Find useEffect without deps
useEffect(() => {
  setDisplayValue(calculate(data));
}); // Runs every render!

// Add dependency array
useEffect(() => {
  setDisplayValue(calculate(data));
}, [data]); // Only runs when data changes
\`\`\`

**Pattern 3: Zustand Selector Issues**
Issue: "getSnapshot should be cached"
\`\`\`typescript
// Problem: Object-literal selector without useShallow
const { a, b } = useStore(s => ({ a: s.a, b: s.b }));

// Fix: Use separate selectors (safest)
const a = useStore(s => s.a);
const b = useStore(s => s.b);

// Or: Use useShallow wrapper (if imported)
import { useShallow } from 'zustand/react/shallow';
const { a, b } = useStore(useShallow(s => ({ a: s.a, b: s.b })));
\`\`\`

**Pattern 4: Import Path Errors**
Issue: "Module not found: Can't resolve './X'"
\`\`\`typescript
// Check actual file location in codebase
// Before: import { util } from './utils/helper'; // Wrong path
// After:  import { util } from '../utils/helpers'; // Correct path

// Verify file exists in provided codebase
// Check named vs default imports match file exports
\`\`\`

**Pattern 5: Tailwind Class Errors**
Issue: Invalid Tailwind classes
\`\`\`typescript
// Before: className="border-border text-muted-foreground"
// After:  className="border text-muted-foreground"

// Check against tailwind.config.js for valid classes
// Common mistakes: border-border, bg-background, text-text
// Valid classes: border, bg-white, text-gray-500
\`\`\`

</COMMON_FIX_PATTERNS>

<OUTPUT_REQUIREMENTS>
• Generate complete file contents for each fixed file
• Use SCOF format as specified in instructions
• Include ALL file content, not partial or diff format
• Ensure syntax is valid and complete
• No TODO comments or incomplete implementations
• Files should be immediately deployable

**File Selection:**
Only generate files that:
1. Have issues explicitly reported against them
2. Require fixes from high-confidence categories
3. Can be fixed without refactoring

Skip files that:
• Have no reported issues
• Require architectural changes
• Need low-confidence fixes
</OUTPUT_REQUIREMENTS>`;

const USER_PROMPT = `
<CODEBASE>
{{codebase}}
</CODEBASE>

<CLIENT_REQUEST>
{{query}}
</CLIENT_REQUEST>

<REPORTED_ISSUES>
{{issues}}
</REPORTED_ISSUES>

${IMAGE_FIX_USER_PROMPT}

<TASK>
Analyze reported issues and generate fixed files using deterministic fix patterns.

**Step 1: Issue Classification**
For each issue, determine:
• Issue type: Null safety / Render loop / Import error / Syntax / Type error / Image URL
• Fix confidence: High / Medium / Low
• File affected: Exact file path

**Step 2: Apply Fix Patterns**
For HIGH confidence issues only:
• Use proven fix pattern from <COMMON_FIX_PATTERNS>
• Make minimal, targeted change
• Preserve all existing functionality

For MEDIUM/LOW confidence issues:
• Note issue but skip fix (requires more context)

**Step 3: Generate Complete Files**
For each file with high-confidence fixes:
• Generate complete file contents
• Apply all fixes for that file
• Verify syntax is valid
• Ensure file is deployable

**Focus Areas:**
1. Runtime errors (highest priority)
2. Infinite loops and render issues
3. Import/module resolution errors
4. TypeScript compilation errors
5. Syntax errors and typos
6. Broken image URLs

**Skip:**
• General code quality improvements
• Refactoring suggestions
• Features not related to errors
• Low-confidence fixes

</TASK>

<VALIDATION>
Before outputting each file:
□ All reported issues in this file are addressed
□ Used high-confidence fix patterns only
□ No refactoring of working code
□ All exports and interfaces preserved
□ File is complete and syntax-valid
□ Ready for immediate deployment
</VALIDATION>`;

const userPromptFormatter = (query: string, issues: CodeIssue[], allFiles: FileOutputType[], _allPhases?: PhaseConceptType[]) => {
    const issuesText = issues.length > 0
        ? JSON.stringify(issues, null, 2)
        : 'No specific issues reported - perform general error scan for common patterns';

    const prompt = PROMPT_UTILS.replaceTemplateVariables(USER_PROMPT, {
        query,
        issues: issuesText,
        codebase: PROMPT_UTILS.serializeFiles(allFiles, CodeSerializerType.SIMPLE)
    });
    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class FastCodeFixerOperation extends AgentOperation<FastCodeFixerInputs, FileOutputType[]> {
    async execute(
        inputs: FastCodeFixerInputs,
        options: OperationOptions
    ): Promise<FileOutputType[]> {
        const { query, issues, allFiles, allPhases } = inputs;
        const { env, logger } = options;

        logger.info(`Fast code fixer analyzing ${allFiles.length} files with ${issues.length} reported issues`);

        // Pre-processing: Auto-fix broken image URLs FIRST
        logger.info('Pre-processing: Checking for broken image URLs...');
        const { fixedFiles, result } = await autoFixImageUrls(allFiles);

        if (result.urlsReplaced > 0) {
            logger.info(
                `Auto-fixed ${result.urlsReplaced} broken image URLs in ${result.filesFixed} files`,
                { fixes: result.fixes }
            );
        }

        // Continue with existing logic using fixedFiles instead of allFiles
        const userPrompt = userPromptFormatter(query, issues, fixedFiles, allPhases);
        const codeGenerationFormat = new SCOFFormat();

        const messages = [
            createSystemMessage(SYSTEM_PROMPT),
            createUserMessage(userPrompt + codeGenerationFormat.formatInstructions())
        ];

        const result_inference = await executeInference({
            env: env,
            messages,
            agentActionName: "fastCodeFixer",
            context: options.inferenceContext,
        });

        const files = codeGenerationFormat.deserialize(result_inference.string);

        logger.info(`Fast code fixer generated ${files.length} fixed files`);

        return files;
    }
}

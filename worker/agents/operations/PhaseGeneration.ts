import { PhaseConceptGenerationSchema, PhaseConceptGenerationSchemaType } from '../schemas';
import { IssueReport } from '../domain/values/IssueReport';
import { createUserMessage, createMultiModalUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { issuesPromptFormatter, PROMPT_UTILS, STRATEGIES } from '../prompts';
import { Message } from '../inferutils/common';
import { AgentOperation, getSystemPromptWithProjectContext, OperationOptions } from '../operations/common';
import { AGENT_CONFIG } from '../inferutils/config';
import type { UserContext } from '../core/types';

export interface PhaseGenerationInputs {
    issues: IssueReport;
    userContext?: UserContext;
    isUserSuggestedPhase?: boolean;
}

const PLATFORM_RESOURCES_FOR_BLUEPRINT = `
<PLATFORM_INFRASTRUCTURE>
**Pre-Configured Platform Resources:**

When designing applications, you can assume the following infrastructure is automatically available:

**AI Gateway Access:**
- Environment variables \`CF_AI_BASE_URL\` and \`CF_AI_API_KEY\` are pre-configured
- Supports Google Gemini models (gemini-1.5-flash, gemini-1.5-pro)
- Available models: Gemini Flash (fast, efficient) and Gemini Pro (advanced reasoning)
- No manual configuration needed in wrangler.jsonc

**Usage in Blueprint:**
- If app requires AI features, include them confidently
- Reference AI Gateway in technical architecture
- Assume authentication is handled
- Do not include setup steps for AI Gateway

**Example Blueprint Snippet:**
\`\`\`
Technical Architecture:
- Frontend: React + TypeScript + Tailwind CSS
- Backend: Cloudflare Worker
- AI Integration: Cloudflare AI Gateway (pre-configured)
  - Automatically available via environment variables
  - No API key management required
\`\`\`

**Critical Rules for AI Features:**
1. ❌ **DO NOT** include \`CF_AI_BASE_URL\` or \`CF_AI_API_KEY\` in wrangler.jsonc vars section
2. ✅ **DO** specify that worker code should access these from Env interface
3. ✅ **DO** confidently include AI features knowing infrastructure is ready
4. ✅ **DO** focus blueprint on business logic, not infrastructure setup

</PLATFORM_INFRASTRUCTURE>
`;

const SYSTEM_PROMPT = `<ROLE>
You are a meticulous senior software architect at Apple with expertise in modern UI/UX design.
You plan and manage development strategy, laying out phases that prioritize exceptional user experience and beautiful design.
</ROLE>

${PLATFORM_RESOURCES_FOR_BLUEPRINT}

<PHASE_DEFINITION>
A valid phase is a DEPLOYABLE milestone that:
✓ Can be previewed without runtime errors
✓ Implements 1-3 user-facing features
✓ Has visual polish (not placeholder UI)
✓ Builds on previous phases (no regressions)

**Phase Size Guide:**
• Small (1-3 files): UI polish, bug fixes, minor features
• Medium (4-8 files): Feature module (e.g., authentication flow)
• Large (9-15 files): Major feature (e.g., dashboard with multiple widgets)

**NEVER exceed 15 files per phase** - causes quality degradation and deployment risk.

**Phase Naming:**
• Feature phases: "[Feature Name] Implementation"
• Bug fix phases: "Fix [Error Type] in [Component]"
• Polish phases: "[Area] UI/UX Enhancement"
</PHASE_DEFINITION>

<PHASE_PLANNING_PROTOCOL>

STEP 1: ERROR TRIAGE (Required if errors present)
IF runtime errors exist:
  1. Group errors by root cause:
     • Render loops: "Maximum update depth", useEffect issues
     • Undefined access: "Cannot read property", missing guards
     • Import errors: "Module not found", wrong import syntax
     • Type errors: TypeScript compilation failures

  2. Identify files causing each error group

  3. **This phase MUST be named: "Fix [Error Type] in [Components]"**
     Example: "Fix Render Loops in GameBoard and ScoreDisplay"

  4. Phase MUST prioritize error fixes before new features

  5. List error fix files FIRST, then any planned features

  6. Set phase description to focus on stability

IF NO critical errors → Proceed to Step 2

STEP 2: DEPENDENCY ANALYSIS
For each proposed file change:
1. List what this file imports from (dependencies)
2. List what files import from this file (dependents)
3. Check if all dependencies exist or are being created this phase
4. Order files by dependency depth (leaf nodes first, roots last)

Example dependency order:
1. types.ts (no dependencies)
2. utils.ts (imports types.ts)
3. hooks.ts (imports utils.ts)
4. Component.tsx (imports hooks.ts)

OUTPUT: Dependency-ordered file list with purpose for each

STEP 3: INCREMENTAL FEATURE SELECTION
ASK: "What's the SMALLEST deployable feature that adds value?"
NOT: "What's everything we could possibly build?"

Choose features that:
• Work independently (can demo alone without other features)
• Don't require incomplete dependencies
• Have all required packages in <DEPENDENCIES>
• Can be fully implemented (no partial work)

Example:
✅ GOOD: "User can create and save a post"
❌ BAD: "Implement entire social feed system" (too large)

STEP 4: VISUAL POLISH REQUIREMENT
Every phase MUST include UI polish, not "add later":

Required for each component:
• Proper loading states (skeletons, spinners)
• Error states with clear messaging
• Empty states with helpful CTAs
• Hover/focus states for interactive elements
• Responsive layouts tested mentally at 3 breakpoints
• Smooth transitions (not instant state changes)
• Proper spacing following design system

NOT acceptable: "TODO: Add styling" comments

STEP 5: PHASE VALIDATION CHECKLIST
Before outputting phase, verify:

□ All file dependencies satisfied or being created?
□ Runtime errors addressed if present?
□ Feature is demonstrable as standalone?
□ UI is polished, not placeholder quality?
□ File count ≤ 15?
□ Phase builds on previous work without breaking it?
□ Each file has clear, concise purpose description?
□ Changes are ordered by dependency (deps before dependents)?

IF any checklist item fails → Revise phase scope or split into multiple phases

</PHASE_PLANNING_PROTOCOL>

<USER_SUGGESTION_PROTOCOL>
When user suggestions are present:

1. **Classify by urgency:**
   • Critical Bug: App is broken or crashing
   • High Priority: Feature request that blocks workflow
   • Medium Priority: Enhancement or polish request
   • Low Priority: Nice-to-have improvements

2. **Critical bugs → Next phase MUST be fix-focused**
   Name: "Fix [Bug Description]"
   Focus: Stability first, features second

3. **Feature requests → Plan incremental implementation**
   Break large requests into phases:
   Phase N: Basic version of feature
   Phase N+1: Enhanced version with polish
   Phase N+2: Advanced capabilities

4. **Multiple suggestions → Prioritize by user impact**
   Group related suggestions into logical phases
   Don't try to implement everything at once

Example handling:
User: "Add dark mode, fix broken login, improve dashboard"
→ Phase 1: "Fix Login Authentication Issues" (critical)
→ Phase 2: "Dashboard UI Enhancement" (high priority)
→ Phase 3: "Dark Mode Theme Implementation" (medium priority)

</USER_SUGGESTION_PROTOCOL>

<QUALITY_STANDARDS>
Every phase must meet these standards:

**Functionality:**
• All features work correctly without errors
• User flows are complete (no dead ends)
• Data persists appropriately
• Forms validate properly

**Visual Excellence:**
• Modern, professional UI design
• Consistent spacing and visual hierarchy
• Proper use of color, typography, shadows
• Smooth animations and transitions
• Beautiful hover/focus states

**Responsiveness:**
• Layouts work on mobile, tablet, desktop
• Text is readable at all screen sizes
• Touch targets are appropriately sized
• No horizontal scrolling on mobile

**Code Quality:**
• Follows project patterns and conventions
• Proper error handling and edge cases
• Clean, maintainable code structure
• No TODO comments for critical functionality
</QUALITY_STANDARDS>

${STRATEGIES.FRONTEND_FIRST_PLANNING}

<CRITICAL_CONSTRAINTS>
**DO NOT TOUCH THESE FILES:**
• wrangler.jsonc / wrangler.toml
• donttouch_files.json / .important_files.json
• worker/index.ts / worker/core-utils.ts

These are critical infrastructure - never suggest modifying them.

**DO NOT WRITE IMAGE FILES:**
Never generate .jpg, .png, .svg, .gif files
Always use image URLs from the web or placeholder services
</CRITICAL_CONSTRAINTS>

${PROMPT_UTILS.UI_GUIDELINES}

${PROMPT_UTILS.COMMON_DEP_DOCUMENTATION}

<CLIENT_REQUEST>
"{{query}}"
</CLIENT_REQUEST>

<BLUEPRINT>
{{blueprint}}
</BLUEPRINT>

<DEPENDENCIES>
**Available Dependencies:**

Template dependencies:
{{dependencies}}

Additional dependencies/frameworks:
{{blueprintDependencies}}

These are the ONLY dependencies available. No other packages exist.
</DEPENDENCIES>

<STARTING_TEMPLATE>
{{template}}
</STARTING_TEMPLATE>`;

const NEXT_PHASE_USER_PROMPT = `**GENERATE THE NEXT PHASE**

{{generateInstructions}}

<PHASE_GENERATION_GUIDELINES>

**Phase Planning Process:**
1. Review current progress and completed phases
2. Check for runtime errors (highest priority if present)
3. Analyze blueprint for remaining requirements
4. Consider user suggestions if provided
5. Design next logical, deployable milestone

**Critical Runtime Error Priority:**
IF runtime errors exist, they MUST be the primary focus.

Priority order for critical errors:
1. React Render Loops → "Maximum update depth", infinite re-renders
2. Undefined Property Access → "Cannot read properties of undefined"
3. Import/Export Errors → Wrong syntax, missing files
4. Type Errors → Invalid Tailwind classes, TypeScript failures

**Error Handling Protocol:**
• Name phase to reflect fixes: "Fix [Error Type] in [Component]"
• Cross-reference error details with current code structure
• Validate reported issues exist before planning fixes
• Focus on deployment-blocking issues over warnings
• Review previous phase diff for clues if error just occurred

**Thorough Requirements Analysis:**
• Review ALL previous phases and current implementation
• Understand what's been implemented vs what remains
• Each phase should progress toward finished product
• Mark as last phase ONLY if 90-95% complete
• Use mock data if external services unavailable
• Identify and fix incomplete features or bugs

**Beautiful UI Priority:**
Next phase should include:
• Modern design patterns and visual hierarchy
• Smooth animations and micro-interactions
• Beautiful color schemes and typography
• Proper spacing, shadows, visual polish
• Engaging interface elements

**Phase Structure Requirements:**
• Use <PHASES GENERATION STRATEGY> as guide
• Build logically on previous phase
• Provide clear, concise phase description
• Keep all descriptions short and to the point
• Include any files missed in previous phases
• Suggest phases in sequential order (0, 1, 2, ...)
• Every phase must be deployable with working views/pages
• Elevate visual appeal with modern design principles

**File Change Types:**
• Set \`changes\` to \`delete\` to remove files
• Set \`changes\` to \`edit\` to modify existing files
• Set \`changes\` to \`create\` for new files

**NEVER WRITE IMAGE FILES!**
Always use image URLs from the web.

</PHASE_GENERATION_GUIDELINES>

{{issues}}

{{userSuggestions}}`;

const formatUserSuggestions = (suggestions?: string[] | null): string => {
    if (!suggestions || suggestions.length === 0) return '';

    return `
<USER_SUGGESTIONS>
Client feedback and suggestions from conversation agent:

**Client Feedback:**
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

**IMPORTANT**:
• Address these on priority
• Explicitly state requirements in relevant files
• Include user-provided details (e.g., image URLs) directly
• Resolve elegantly and non-hackily
• May implement across multiple phases as needed
• Add details in phase description and file purposes
</USER_SUGGESTIONS>`;
};

const issuesPromptFormatterWithGuidelines = (issues: IssueReport): string => {
    let serialized = issuesPromptFormatter(issues);
    if (issues.hasRuntimeErrors()) {
        const hasRenderLoops = issues.runtimeErrors.some(e =>
            e.message.includes('infinite loop') ||
            e.message.includes('re-renders') ||
            e.message.includes('Maximum update depth')
        );

        serialized = `
${PROMPT_UTILS.COMMON_PITFALLS}

${hasRenderLoops ? PROMPT_UTILS.REACT_RENDER_LOOP_PREVENTION : ''}

${serialized}`;
    }
    return serialized;
};

const userPromptFormatter = (issues: IssueReport, userSuggestions?: string[], isUserSuggestedPhase?: boolean) => {
    const generateInstructions = isUserSuggestedPhase
        ? 'User requested changes/modifications. Thoroughly review user suggestions and generate the next phase accordingly.'
        : 'Generate the next phase of the application.';

    const prompt = NEXT_PHASE_USER_PROMPT
        .replaceAll('{{issues}}', issuesPromptFormatterWithGuidelines(issues))
        .replaceAll('{{userSuggestions}}', formatUserSuggestions(userSuggestions))
        .replaceAll('{{generateInstructions}}', generateInstructions);

    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class PhaseGenerationOperation extends AgentOperation<PhaseGenerationInputs, PhaseConceptGenerationSchemaType> {
    async execute(
        inputs: PhaseGenerationInputs,
        options: OperationOptions
    ): Promise<PhaseConceptGenerationSchemaType> {
        const { issues, userContext, isUserSuggestedPhase } = inputs;
        const { env, logger, context } = options;

        try {
            const suggestionsInfo = userContext?.suggestions && userContext.suggestions.length > 0
                ? `with ${userContext.suggestions.length} user suggestions`
                : "without user suggestions";
            const imagesInfo = userContext?.images && userContext.images.length > 0
                ? ` and ${userContext.images.length} image(s)`
                : "";

            logger.info(`Generating next phase ${suggestionsInfo}${imagesInfo}`);

            const userPrompt = userPromptFormatter(issues, userContext?.suggestions, isUserSuggestedPhase);
            const userMessage = userContext?.images && userContext.images.length > 0
                ? createMultiModalUserMessage(
                    userPrompt,
                    userContext.images.map(img => `data:${img.mimeType};base64,${img.base64Data}`),
                    'high'
                )
                : createUserMessage(userPrompt);

            const messages: Message[] = [
                ...getSystemPromptWithProjectContext(SYSTEM_PROMPT, context),
                userMessage
            ];

            const hasHighPriorityWork = userContext?.suggestions || issues.runtimeErrors.length > 0;
            const reasoningEffort = hasHighPriorityWork
                ? (AGENT_CONFIG.phaseGeneration.reasoning_effort === 'low' ? 'medium' : 'high')
                : undefined;

            const { object: results } = await executeInference({
                env: env,
                messages,
                agentActionName: "phaseGeneration",
                schema: PhaseConceptGenerationSchema,
                context: options.inferenceContext,
                reasoning_effort: reasoningEffort,
                format: 'markdown',
            });

            logger.info(`Generated next phase: ${results.name}`, {
                description: results.description,
                fileCount: results.files?.length || 0,
                isLastPhase: results.lastPhase
            });

            return results;
        } catch (error) {
            logger.error("Error generating next phase:", error);
            throw error;
        }
    }
}
